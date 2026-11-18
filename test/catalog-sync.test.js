// 人才市场第 3 步：官方在线人才库同步。用进程内 HTTP 假镜像（npmmirror 同形）真打下载、校验、落盘与路由。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { BUNDLED_CATALOG_DIR, catalogRoots, listTalents, loadCatalog, resolveTeam } from '../lib/domain/catalog.js';
import { buildIndex, catalogMirrors, compareVersions, CATALOG_PACKAGE, clearOfficialCatalog, isCatalogPath, MIRRORS, officialStatus, sha256, syncOfficialCatalog, validateIndex } from '../lib/domain/catalog-sync.js';

const PKG = CATALOG_PACKAGE;

/** 假镜像：versions = { '1.0.0': { 'path': 'content' } }，按 npmmirror 路由回 latest 与 files/。 */
async function mirrorServer(state) {
	const hits = [];
	const server = createServer((req, res) => {
		const url = decodeURIComponent(req.url);
		hits.push(url);
		if (url === `/${PKG}/latest`) {
			res.setHeader('content-type', 'application/json');
			return res.end(JSON.stringify({ name: PKG, version: state.latest }));
		}
		const m = url.match(new RegExp(`^/${PKG.replace('/', '\\/')}/([^/]+)/files/(.+)$`));
		const files = m ? state.versions[m[1]] : undefined;
		if (files && m[2] === 'index.json' && state.index?.[m[1]]) return res.end(JSON.stringify(state.index[m[1]]));
		if (files && m[2] in files) return res.end(files[m[2]]);
		res.statusCode = 404;
		res.end('not found');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	return { base, hits, mirrors: catalogMirrors({ DSH_AI_TEAM_CATALOG_MIRROR: base }), close: () => new Promise((r) => server.close(r)) };
}

const talentYml = (name, version = '1.0.0') => `version: ${version}\nname: ${name}\nrole: 执行\nduty: executor\ncategory: 测试\npersonality: 只做测试\nskills: [drill]\n`;

/** 给一组文件补上 index.json（与打包脚本同一个 buildIndex）。 */
function withIndex(dir, files, version) {
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, ...path.split('/'));
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, content);
	}
	const { index } = buildIndex(dir, { version });
	return { ...files, 'index.json': JSON.stringify(index) };
}

test('isCatalogPath only admits talent.yml / team.yml / skills markdown under talents/ and teams/', () => {
	for (const ok of ['talents/a/talent.yml', 'teams/default/team.yml', 'talents/a/skills/x/SKILL.md', 'teams/t/skills/ai-team-core/SKILL.md', 'talents/a/skills/x.md']) assert.equal(isCatalogPath(ok), true, ok);
	for (const bad of ['talents/a/team.yml', 'teams/a/talent.yml', '../x', 'talents/../a/talent.yml', 'talents/A/talent.yml', 'talents/a/skills/x/run.sh', 'talents/a/skills/x/SKILL.md/..', '/talents/a/talent.yml', 'index.json', 'talents\\a\\talent.yml']) assert.equal(isCatalogPath(bad), false, bad);
	assert.equal(compareVersions('0.4.130', '0.4.129'), 1);
	assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
	assert.ok(Number.isNaN(compareVersions('x', '1.0.0')));
	assert.deepEqual(MIRRORS.map((m) => m.name), ['npmmirror', 'jsdelivr']);
	assert.equal(MIRRORS[0].file(PKG, '1.0.0', 'index.json'), `https://registry.npmmirror.com/${PKG}/1.0.0/files/index.json`);
	assert.equal(MIRRORS[1].file(PKG, '1.0.0', 'teams/default/team.yml'), `https://cdn.jsdelivr.net/npm/${PKG}@1.0.0/teams/default/team.yml`);
	assert.equal(catalogMirrors({}), MIRRORS);
	assert.equal(catalogMirrors({ DSH_AI_TEAM_CATALOG_MIRROR: 'file:///etc' }), MIRRORS, '只认 http(s)');
});

test('buildIndex over the repo covers every bundled talent and team file, and validateIndex rejects tampered indexes', () => {
	const { index, skipped } = buildIndex(BUNDLED_CATALOG_DIR, { version: '1.0.0' });
	const catalog = loadCatalog({ roots: [{ source: 'bundled', dir: BUNDLED_CATALOG_DIR }] });
	assert.deepEqual(skipped, []);
	assert.equal(index.files.filter((f) => f.path.endsWith('/talent.yml')).length, catalog.talents.size);
	assert.equal(index.files.filter((f) => f.path.endsWith('/team.yml')).length, catalog.teams.size);
	assert.equal(index.files.every((f) => f.sha256 === sha256(readFileSync(join(BUNDLED_CATALOG_DIR, f.path)))), true);
	const reject = (patch, re, opts = {}) => assert.throws(() => validateIndex({ ...index, ...patch }, { version: '1.0.0', ...opts }), re);
	reject({ format: 2 }, /格式号/);
	reject({ version: '9.9.9' }, /不一致/);
	reject({ minPlugin: '9.0.0' }, /需要插件/, { pluginVersion: '0.4.130' });
	reject({ files: [{ path: '../evil/talent.yml', size: 1, sha256: 'a'.repeat(64) }] }, /路径不允许/);
	reject({ files: [{ path: 'talents/a/talent.yml', size: 1, sha256: 'xyz' }] }, /sha256/);
	reject({ files: [{ path: 'talents/a/talent.yml', size: 10_000_000, sha256: 'a'.repeat(64) }] }, /大小/);
	reject({ files: [index.files[0], index.files[0]] }, /重复/);
	reject({ files: [] }, /没有文件/);
});

test('syncOfficialCatalog downloads, verifies and swaps in a version; official sits between user and bundled; bad updates keep the old version', async (t) => {
	const home = await mkdtemp(join(tmpdir(), 'ai-team-sync-'));
	const src = await mkdtemp(join(tmpdir(), 'ai-team-sync-src-'));
	const state = { latest: '1.0.0', versions: {}, index: {} };
	state.versions['1.0.0'] = withIndex(join(src, 'v1'), {
		'talents/executor/talent.yml': talentYml('在线执行', '9.0.0'),
		'talents/executor/skills/drill/SKILL.md': '---\nname: drill\n---\n在线版技能',
		'talents/online-only/talent.yml': talentYml('只在线有'),
		'talents/old-editor/talent.yml': talentYml('旧编辑', '0.0.1'),
	}, '1.0.0');
	const mirror = await mirrorServer(state);
	t.after(async () => { await mirror.close(); await rm(home, { recursive: true, force: true }); await rm(src, { recursive: true, force: true }); });
	const sync = (opts = {}) => syncOfficialCatalog({ dshHome: home, pluginVersion: '0.4.130', mirrors: mirror.mirrors, now: () => '2026-11-18T00:00:00.000Z', ...opts });

	assert.equal(officialStatus(home), null);
	assert.deepEqual(catalogRoots({ dshHome: home }).map((r) => r.source), ['user', 'bundled']);
	const first = await sync();
	assert.deepEqual(first, { updated: true, version: '1.0.0', previous: null, files: 4, mirror: 'custom' });
	assert.deepEqual(catalogRoots({ dshHome: home }).map((r) => r.source), ['user', 'official', 'bundled']);
	assert.deepEqual(readdirSync(join(home, 'ai-team', 'catalog', 'official')).sort(), ['1.0.0', 'current.json']);
	const cat = loadCatalog({ roots: catalogRoots({ dshHome: home }) });
	assert.deepEqual([cat.talents.get('executor').source, cat.talents.get('executor').name], ['official', '在线执行']);
	assert.equal(cat.talents.get('online-only').source, 'official');
	assert.equal(cat.talents.get('editor').source, 'bundled', '在线库没有的人才照旧用内置');
	assert.equal(listTalents(cat).find((x) => x.id === 'online-only').forked, false);
	// 内置团队引用在线版人才时，名单用在线版的。
	assert.equal(resolveTeam(cat, 'default').team.members.find((m) => m.talent.id === 'executor').talent.source, 'official');

	// 已是最新：只问版本，不再下文件。
	const before = mirror.hits.length;
	assert.deepEqual(await sync(), { updated: false, version: '1.0.0', latest: '1.0.0' });
	assert.deepEqual(mirror.hits.slice(before), [`/${PKG}/latest`]);

	// 新版本里一个文件被篡改：sha256 不符，旧版本原样保留、临时目录清掉。
	state.versions['1.1.0'] = withIndex(join(src, 'v2'), { 'talents/executor/talent.yml': talentYml('新版执行', '9.1.0') }, '1.1.0');
	state.versions['1.1.0']['talents/executor/talent.yml'] = talentYml('被篡改', '9.1.0');
	state.latest = '1.1.0';
	await assert.rejects(sync(), /校验不符：talents\/executor\/talent\.yml/);
	assert.equal(officialStatus(home).version, '1.0.0');
	assert.deepEqual(readdirSync(join(home, 'ai-team', 'catalog', 'official')).sort(), ['1.0.0', 'current.json']);

	// index 要求更新的插件：拒绝，换镜像也没用。
	state.versions['1.2.0'] = { 'talents/executor/talent.yml': 'x' };
	state.index['1.2.0'] = { format: 1, name: PKG, version: '1.2.0', minPlugin: '9.0.0', files: [{ path: 'talents/executor/talent.yml', size: 1, sha256: sha256(Buffer.from('x')) }] };
	state.latest = '1.2.0';
	await assert.rejects(sync(), /需要插件 ≥ 9\.0\.0/);
	assert.equal(officialStatus(home).version, '1.0.0');

	// 合格的新版本：整体替换，旧版本目录删掉；新版本里没了的人才退回内置/消失。
	state.versions['1.1.0'] = withIndex(join(src, 'v3'), { 'talents/executor/talent.yml': talentYml('新版执行', '9.1.0') }, '1.1.0');
	state.latest = '1.1.0';
	const second = await sync();
	assert.deepEqual([second.updated, second.version, second.previous, second.files], [true, '1.1.0', '1.0.0', 1]);
	assert.deepEqual(readdirSync(join(home, 'ai-team', 'catalog', 'official')).sort(), ['1.1.0', 'current.json']);
	const cat2 = loadCatalog({ roots: catalogRoots({ dshHome: home }) });
	assert.equal(cat2.talents.get('executor').name, '新版执行');
	assert.equal(cat2.talents.has('online-only'), false);

	// 镜像全挂：报错，不动现有。
	await assert.rejects(syncOfficialCatalog({ dshHome: home, pluginVersion: '0.4.130', mirrors: catalogMirrors({ DSH_AI_TEAM_CATALOG_MIRROR: 'http://127.0.0.1:1' }), timeoutMs: 2000 }), /取不到在线人才库版本/);
	assert.equal(officialStatus(home).version, '1.1.0');

	clearOfficialCatalog(home);
	assert.equal(officialStatus(home), null);
	assert.equal(loadCatalog({ roots: catalogRoots({ dshHome: home }) }).talents.get('executor').source, 'bundled');
});

test('a bundled talent newer than the stale online copy wins; user copies still shadow both and are marked edited', async (t) => {
	const home = await mkdtemp(join(tmpdir(), 'ai-team-sync-ver-'));
	t.after(() => rm(home, { recursive: true, force: true }));
	const bundledVersion = loadCatalog({ roots: [{ source: 'bundled', dir: BUNDLED_CATALOG_DIR }] }).talents.get('editor').version;
	const official = join(home, 'ai-team', 'catalog', 'official');
	for (const [path, body] of [['talents/editor/talent.yml', talentYml('旧在线编辑', '0.0.1')], ['talents/copywriter/talent.yml', talentYml('新在线文案', '99.0.0')], ['talents/online-x/talent.yml', talentYml('在线X')]]) {
		mkdirSync(join(official, '1.0.0', ...path.split('/').slice(0, -1)), { recursive: true });
		writeFileSync(join(official, '1.0.0', ...path.split('/')), body);
	}
	writeFileSync(join(official, 'current.json'), JSON.stringify({ version: '1.0.0' }));
	const user = join(home, 'ai-team', 'catalog', 'user', 'talents', 'online-x');
	mkdirSync(user, { recursive: true });
	writeFileSync(join(user, 'talent.yml'), talentYml('我改的X'));
	const cat = loadCatalog({ roots: catalogRoots({ dshHome: home }) });
	assert.deepEqual([cat.talents.get('editor').source, cat.talents.get('editor').version], ['bundled', bundledVersion]);
	assert.deepEqual([cat.talents.get('copywriter').source, cat.talents.get('copywriter').version], ['official', '99.0.0']);
	const x = listTalents(cat).find((entry) => entry.id === 'online-x');
	assert.deepEqual([x.source, x.forked], ['user', true], '遮盖在线人才的用户副本也标「已改」');
	// current.json 指向不存在的目录 / 写坏：当没同步过。
	writeFileSync(join(official, 'current.json'), '{bad');
	assert.equal(officialStatus(home), null);
	assert.ok(existsSync(join(official, '1.0.0')));
});

test('routes: GET /api/catalog, POST /api/catalog/sync against a mirror, the market shows online talents, clear goes back to built-in', async (t) => {
	const { apply } = await import('../index.js');
	const routes = [];
	const root = await mkdtemp(join(tmpdir(), 'ai-team-sync-routes-'));
	const src = await mkdtemp(join(tmpdir(), 'ai-team-sync-routes-src-'));
	const state = { latest: '1.0.0', versions: {}, index: {} };
	state.versions['1.0.0'] = withIndex(src, { 'talents/online-only/talent.yml': talentYml('只在线有'), 'talents/online-only/skills/drill/SKILL.md': '---\nname: drill\n---\n练' }, '1.0.0');
	const mirror = await mirrorServer(state);
	const prev = { home: process.env.DSH_HOME, profile: process.env.DSH_PROFILE, mirror: process.env.DSH_AI_TEAM_CATALOG_MIRROR };
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'sync';
	process.env.DSH_AI_TEAM_CATALOG_MIRROR = mirror.base;
	const realError = console.error; const realWarn = console.warn;
	console.error = () => {}; console.warn = () => {};
	let server = null;
	t.after(async () => {
		console.error = realError; console.warn = realWarn;
		if (server) await new Promise((r) => server.close(r));
		await mirror.close();
		for (const [k, v] of [['DSH_HOME', prev.home], ['DSH_PROFILE', prev.profile], ['DSH_AI_TEAM_CATALOG_MIRROR', prev.mirror]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
		await rm(root, { recursive: true, force: true });
		await rm(src, { recursive: true, force: true });
	});
	const ctx = {
		effect(fn) { fn(); },
		on() { return () => {}; },
		get(id) {
			if (id === 'connection') return { requestRejection: () => undefined };
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') return { catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }), resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }), set: () => {} };
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
	apply(ctx);
	server = createServer((req, res) => routes[0].handler(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };

	assert.deepEqual((await call('GET', '/ai-team/api/catalog')).body, { package: PKG, official: null });
	const synced = await call('POST', '/ai-team/api/catalog/sync', {});
	assert.equal(synced.status, 200, JSON.stringify(synced.body));
	assert.deepEqual([synced.body.updated, synced.body.version, synced.body.files, synced.body.official.version], [true, '1.0.0', 2, '1.0.0']);
	assert.equal(JSON.stringify(synced.body).includes('ai-team-sync-routes-'), false, '不回本机路径');
	const online = (await call('GET', '/ai-team/api/talents')).body.talents.find((x) => x.id === 'online-only');
	assert.deepEqual([online?.source, online?.skills], ['official', ['drill']]);
	// 在线人才只读：删 / 装技能被拒；可以 fork 成可编辑副本。
	assert.equal((await call('POST', '/ai-team/api/talents/delete', { id: 'online-only' })).status, 409);
	assert.equal((await call('POST', '/ai-team/api/talents/online-only/skills', { name: 'x', markdown: 'x' })).status, 409);
	const forked = await call('POST', '/ai-team/api/talents/online-only/fork', {});
	assert.deepEqual([forked.status, forked.body.forked, forked.body.talent.forked], [200, true, true]);
	assert.ok(existsSync(join(root, 'ai-team', 'catalog', 'user', 'talents', 'online-only', 'skills', 'drill', 'SKILL.md')));
	assert.equal((await call('POST', '/ai-team/api/catalog/sync', {})).body.updated, false);
	// 上游坏了：502 + 现有状态。
	state.latest = '2.0.0';
	const bad = await call('POST', '/ai-team/api/catalog/sync', {});
	assert.deepEqual([bad.status, bad.body.error.code, bad.body.official.version], [502, 'E_UPSTREAM', '1.0.0']);
	assert.deepEqual((await call('POST', '/ai-team/api/catalog/clear', {})).body, { ok: true, official: null });
	assert.equal(existsSync(join(root, 'ai-team', 'catalog', 'official')), false);
	// 发布默认 diagLevel=errors：只留失败行 catalog.sync.fail（成功行在 full 下才记）。
	const diagText = (function walk(dir) { let out = ''; for (const e of readdirSync(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) out += walk(f); else if (/diag/i.test(f)) out += readFileSync(f, 'utf8'); } return out; })(root);
	assert.ok(diagText.includes('"catalog.sync.fail"'), 'catalog.sync.fail');
});
