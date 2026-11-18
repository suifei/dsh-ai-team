import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { tarOf } from './tar-helper.js';
import { AVATAR_PACKAGE, avatarLibDir, avatarOptions, BASE_OPTIONS, DEFAULT_AVATAR, parseAvatar, renderAvatarSvg, startAvatarLib, syncAvatarLib, useAvatarLib } from '../lib/domain/avatar.js';
import { catalogMirrors } from '../lib/domain/catalog-sync.js';
import { listTalents, listTeams, loadCatalog, parseTalent, resolveTeam, talentFromMember, writeTalent } from '../lib/domain/catalog.js';
import { applyEvent, initialState } from '../lib/ledger/fold.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const bundled = () => loadCatalog({ roots: [{ source: 'bundled', dir: repo }] });

test('parseAvatar: absent is null, partial fills the defaults, typos are refused with the field named', () => {
	assert.equal(parseAvatar(undefined), null);
	assert.equal(parseAvatar(null), null);
	assert.deepEqual(parseAvatar({ gender: 'female' }), { ...DEFAULT_AVATAR, gender: 'female' });
	assert.deepEqual(parseAvatar({ gender: 'male', age: 'old', race: 'auto' }), { gender: 'male', age: 'old', race: 'auto' });
	assert.throws(() => parseAvatar({ age: 'elder' }), /avatar\.age/);
	assert.throws(() => parseAvatar('male'), /必须是对象/);
});

test('every bundled talent ships an Asian avatar preset; teams and the market carry it to the cards', () => {
	const catalog = bundled();
	const talents = listTalents(catalog);
	assert.equal(talents.length, 44);
	for (const talent of talents) {
		assert.ok(talent.avatar, `${talent.id} has an avatar`);
		assert.equal(talent.avatar.race, 'asian', `${talent.id} defaults to asian`);
	}
	assert.deepEqual(talents.find((x) => x.id === 'pmo-lead').avatar, { gender: 'male', age: 'middle', race: 'asian' });
	const team = resolveTeam(catalog, 'default').team;
	assert.deepEqual(team.members.find((m) => m.id === 'mem_lead').avatar, { gender: 'male', age: 'middle', race: 'asian' });
	assert.ok(listTeams(catalog).every((entry) => entry.members.every((m) => m.avatar && m.avatar.race === 'asian')));
	assert.throws(() => parseTalent('name: a\nrole: b\navatar: { gender: robot }\n', 'x'), /x: avatar\.gender/);
});

test('custom talents keep the chosen avatar; save-as-talent carries the member avatar', () => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-avatar-'));
	try {
		const saved = writeTalent(root, 'my-artist', { name: '画眉', role: '插画', avatar: { gender: 'female', age: 'teen', race: 'white' } });
		assert.deepEqual(saved.avatar, { gender: 'female', age: 'teen', race: 'white' });
		const plain = writeTalent(root, 'plain', { name: '素', role: '执行' });
		assert.equal(plain.avatar, null);
		assert.deepEqual(talentFromMember({ name: 'x', role: 'y', avatar: { gender: 'neutral', age: 'old', race: 'black' } }, 'executor').avatar, { gender: 'neutral', age: 'old', race: 'black' });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the ledger remembers a member avatar from member-added and profile-updated; bad shapes keep the old one', () => {
	let state = initialState();
	state = applyEvent(state, { seq: 1, type: 'project/member-added', at: 1, actor: { kind: 'human' }, payload: { memberId: 'mem_a', name: '甲', kind: 'agent', avatar: { gender: 'male', age: 'youth', race: 'asian' } } });
	assert.deepEqual(state.members.mem_a.avatar, { gender: 'male', age: 'youth', race: 'asian' });
	state = applyEvent(state, { seq: 2, type: 'member/profile-updated', at: 2, actor: { kind: 'human' }, payload: { memberId: 'mem_a', avatar: { gender: 'female', age: 'old', race: 'brown' } } });
	assert.deepEqual(state.members.mem_a.avatar, { gender: 'female', age: 'old', race: 'brown' });
	state = applyEvent(state, { seq: 3, type: 'member/profile-updated', at: 3, actor: { kind: 'human' }, payload: { memberId: 'mem_a', name: '乙', avatar: { gender: 'x' } } });
	assert.deepEqual(state.members.mem_a.avatar, { gender: 'female', age: 'old', race: 'brown' });
	assert.equal(state.members.mem_a.name, '乙');
});

test('service: member.add keeps the avatar, an avatar-only profile update is a change, a typo is INVALID_ARGUMENT', async (t) => {
	const { openLedger } = await import('../lib/ledger/writer.js');
	const { TeamService } = await import('../lib/host/service.js');
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-avatar-svc-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const service = new TeamService({ ledger: openLedger({ dir, projectId: 'prj_av' }) });
	const human = { kind: 'human', memberId: 'h1' };
	await service.dispatch({ type: 'member.add', actor: human, projectId: 'prj_av', payload: { id: 'h1', name: '你', kind: 'human', role: 'Human' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: 'prj_av', payload: { id: 'a1', name: '甲', role: '执行', avatar: { gender: 'female', age: 'youth', race: 'asian' } } });
	assert.deepEqual(service.state.members.a1.avatar, { gender: 'female', age: 'youth', race: 'asian' });
	await service.dispatch({ type: 'member.profile.update', actor: human, projectId: 'prj_av', payload: { memberId: 'a1', avatar: { gender: 'male', age: 'old', race: 'white' } } });
	assert.deepEqual(service.state.members.a1.avatar, { gender: 'male', age: 'old', race: 'white' });
	await assert.rejects(service.dispatch({ type: 'member.profile.update', actor: human, projectId: 'prj_av', payload: { memberId: 'a1', avatar: { gender: 'male', age: 'old', race: 'white' } } }), /required/);
	await assert.rejects(service.dispatch({ type: 'member.add', actor: human, projectId: 'prj_av', payload: { id: 'a2', name: '乙', avatar: { age: 'elder' } } }), (error) => error.code === 'E_INVALID_ARGUMENT' || /avatar\.age/.test(error.message));
	assert.equal(service.state.members.a2, undefined);
});

/** 假 hash-avatar：形状与真库一致（GENDERS / AGES / RACES / ARTS / GROUPS / svg），svg 回显收到的参数，便于核对。 */
const fakeLib = (tag, extra = '') => `const RACES = ['asian', 'white', 'black', 'brown', 'auto', 'elf'${extra}];
module.exports = { version: 'v1', GENDERS: ['male', 'female', 'neutral'], AGES: ['baby', 'teen', 'youth', 'middle', 'old'], RACES, ARTS: ['flat', 'pixel'],
	GROUPS: { human: RACES.slice(0, 5), fantasy: RACES.slice(5) },
	svg: (name, options) => '<svg data-lib="${tag}">' + JSON.stringify([name, options]) + '</svg>' };
`;
const loadFake = (tag, extra) => { const m = { exports: {} }; new Function('module', 'exports', fakeLib(tag, extra))(m, m.exports); return m.exports; };

/** 假 registry（npmmirror / npmjs 同形）：state.versions[v] = 包内文件；state.badIntegrity 给错 integrity；state.down 全回 503。 */
async function avatarRegistry(state) {
	const hits = [];
	let base = '';
	const server = createServer((req, res) => {
		const url = decodeURIComponent(req.url);
		hits.push(url);
		if (state.down) { res.statusCode = 503; return res.end('down'); }
		const json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
		if (url === `/${AVATAR_PACKAGE}/latest`) return json({ name: AVATAR_PACKAGE, version: state.latest });
		const manifest = url.match(/^\/@suifei\/hash-avatar\/(\d+\.\d+\.\d+)$/);
		if (manifest && state.versions[manifest[1]]) {
			const tgz = tarOf(state.versions[manifest[1]]);
			return json({ name: AVATAR_PACKAGE, version: manifest[1], dist: { tarball: `${base}/tgz/${manifest[1]}.tgz`, integrity: state.badIntegrity ? 'sha512-AAAA' : 'sha512-' + createHash('sha512').update(tgz).digest('base64') } });
		}
		const tgz = url.match(/^\/tgz\/(.+)\.tgz$/);
		if (tgz && state.versions[tgz[1]]) return res.end(tarOf(state.versions[tgz[1]]));
		res.statusCode = 404;
		res.end('not found');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
	return { base, hits, mirrors: catalogMirrors({ DSH_AI_TEAM_CATALOG_MIRROR: base }), close: () => new Promise((r) => server.close(r)) };
}

test('options and validation follow the loaded library: new kinds and styles pass, typos still fail, no library means the v1 base set', (t) => {
	t.after(() => useAvatarLib(null));
	useAvatarLib(null);
	assert.equal(avatarOptions(), BASE_OPTIONS);
	assert.throws(() => parseAvatar({ race: 'elf' }), /avatar\.race/);
	assert.equal(renderAvatarSvg('墨渊', {}), null, 'no library yet: the route answers 503 and the client falls back to the initial');
	useAvatarLib(loadFake('A'), { version: '1.3.0' });
	const options = avatarOptions();
	assert.ok(options.races.includes('elf'));
	assert.deepEqual(plainGroups(options.groups), { human: ['asian', 'white', 'black', 'brown', 'auto'], fantasy: ['elf'] });
	assert.deepEqual(parseAvatar({ gender: 'female', race: 'elf', art: 'pixel' }), { gender: 'female', age: 'youth', race: 'elf', art: 'pixel' });
	assert.throws(() => parseAvatar({ race: 'asain' }), /avatar\.race 只认/);
	assert.throws(() => parseAvatar({ art: 'oil' }), /avatar\.art/);
	assert.equal(parseTalent('name: 精灵\nrole: 设计\navatar: { gender: female, age: youth, race: elf, art: pixel }\n', 'x').avatar.race, 'elf');
	// 渲染：参数原样交给库；小图去指纹、去动效，大图都开；写错的按默认；画风只带库认的。
	const args = (svg) => JSON.parse(svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('<')));
	assert.deepEqual(args(renderAvatarSvg('墨渊', { gender: 'male', age: 'middle', race: 'elf', art: 'pixel', size: 64 })), ['墨渊', { gender: 'male', age: 'middle', race: 'elf', art: 'pixel', size: 64, fingerprint: false, animate: false }]);
	assert.deepEqual(args(renderAvatarSvg('', { gender: 'robot', race: 'x', art: 'oil', size: 99999 })), ['?', { ...DEFAULT_AVATAR, size: 1024, fingerprint: true, animate: true }]);
	assert.throws(() => useAvatarLib({ version: 'v1' }), /缺 svg/);
	// 没归组的取值（真库 1.3.0 的 any）落进 other。
	const lib = loadFake('B', ", 'any'");
	useAvatarLib({ ...lib, GROUPS: { human: lib.RACES.slice(0, 5), fantasy: ['elf'] } });
	assert.deepEqual(plainGroups(avatarOptions().groups).other, ['any']);
});
const plainGroups = (groups) => JSON.parse(JSON.stringify(groups));

test('syncAvatarLib pulls the latest hash-avatar from npm at runtime, verifies the tarball, swaps versions and keeps the old one on failure', async (t) => {
	const home = mkdtempSync(join(tmpdir(), 'ai-team-avatar-lib-'));
	const state = { latest: '1.0.0', versions: { '1.0.0': { 'package.json': '{}', 'src/hash-avatar.js': fakeLib('one') } } };
	const registry = await avatarRegistry(state);
	t.after(async () => { useAvatarLib(null); await registry.close(); rmSync(home, { recursive: true, force: true }); });
	useAvatarLib(null);
	const first = await syncAvatarLib({ dshHome: home, mirrors: registry.mirrors });
	assert.deepEqual([first.updated, first.version, first.previous, first.contract], [true, '1.0.0', null, 'v1']);
	assert.match(renderAvatarSvg('青岚', { size: 64 }), /data-lib="one"/);
	assert.ok(existsSync(join(avatarLibDir(home), '1.0.0', 'hash-avatar.cjs')));
	assert.equal(JSON.parse(readFileSync(join(avatarLibDir(home), 'current.json'), 'utf8')).version, '1.0.0');
	assert.equal((await syncAvatarLib({ dshHome: home, mirrors: registry.mirrors })).updated, false, 'same version: nothing downloaded');
	// npm 上出了新版：换上，旧目录清掉。
	state.latest = '1.3.0';
	state.versions['1.3.0'] = { 'src/hash-avatar.js': fakeLib('three', ", 'cat'") };
	const second = await syncAvatarLib({ dshHome: home, mirrors: registry.mirrors });
	assert.deepEqual([second.updated, second.version, second.previous], [true, '1.3.0', '1.0.0']);
	assert.match(renderAvatarSvg('青岚', { size: 64 }), /data-lib="three"/);
	assert.ok(avatarOptions().races.includes('cat'));
	assert.deepEqual(readdirSync(avatarLibDir(home)).sort(), ['1.3.0', 'current.json']);
	// 坏包：integrity 不符、缺文件、不是头像库——都拒绝，当前版本不动。
	state.latest = '1.4.0';
	state.versions['1.4.0'] = { 'src/hash-avatar.js': fakeLib('four') };
	state.badIntegrity = true;
	await assert.rejects(syncAvatarLib({ dshHome: home, mirrors: registry.mirrors }), /integrity/);
	state.badIntegrity = false;
	state.versions['1.4.0'] = { 'src/other.js': 'x' };
	await assert.rejects(syncAvatarLib({ dshHome: home, mirrors: registry.mirrors }), /缺文件/);
	state.versions['1.4.0'] = { 'src/hash-avatar.js': 'module.exports = { version: "v1" };' };
	await assert.rejects(syncAvatarLib({ dshHome: home, mirrors: registry.mirrors }), /缺 svg/);
	assert.match(renderAvatarSvg('青岚', {}), /data-lib="three"/);
	assert.deepEqual(readdirSync(avatarLibDir(home)).sort(), ['1.3.0', 'current.json']);
	// 重启：从本机缓存装上，不联网。
	useAvatarLib(null);
	const hitsBefore = registry.hits.length;
	const runtime = startAvatarLib({ dshHome: home, mirrors: registry.mirrors, clock: () => 0, checkEveryMs: 1000 });
	assert.match(renderAvatarSvg('青岚', {}), /data-lib="three"/);
	assert.equal(registry.hits.length, hitsBefore, 'loading the cache does not touch the network');
	runtime.dispose();
});

test('startAvatarLib: first use waits for the download, later uses only re-check on the throttle, offline fails fast without hammering', async (t) => {
	const home = mkdtempSync(join(tmpdir(), 'ai-team-avatar-rt-'));
	const state = { latest: '1.3.0', versions: { '1.3.0': { 'src/hash-avatar.js': fakeLib('rt') } }, down: true };
	const registry = await avatarRegistry(state);
	t.after(async () => { useAvatarLib(null); await registry.close(); rmSync(home, { recursive: true, force: true }); });
	useAvatarLib(null);
	let now = 0;
	const rows = [];
	const runtime = startAvatarLib({ dshHome: home, mirrors: registry.mirrors, diag: { append: (row) => rows.push(row) }, clock: () => now, checkEveryMs: 10_000 });
	assert.deepEqual(rows.map((r) => r.ev), ['avatar.lib.missing']);
	// 离线：等一次、失败，60 秒内的后续请求直接回 null，不再打网。
	assert.equal(await runtime.ready(5000), null);
	assert.ok(rows.some((r) => r.ev === 'avatar.lib.sync.fail'));
	const offlineHits = registry.hits.length;
	assert.equal(await runtime.ready(5000), null);
	assert.equal(registry.hits.length, offlineHits);
	// 恢复联网、过了节流：下载并装上。
	state.down = false;
	now = 61_000;
	assert.equal((await runtime.ready(5000))?.version, '1.3.0');
	assert.ok(rows.some((r) => r.ev === 'avatar.lib.update' && r.version === '1.3.0'));
	// 已就绪：节流内不查；过了节流在后台查一次。
	const readyHits = registry.hits.length;
	await runtime.ready();
	assert.equal(registry.hits.length, readyHits);
	now += 10_000;
	await runtime.ready();
	await runtime.refresh();
	assert.ok(registry.hits.length > readyHits);
	assert.ok(rows.some((r) => r.ev === 'avatar.lib.current'));
	runtime.dispose();
});

test('GET /ai-team/api/avatar/meta and avatar.svg: the plugin fetches the library on first use and serves it; unreachable npm is a 503', async (t) => {
	const { apply } = await import('../index.js');
	const state = { latest: '1.3.0', versions: { '1.3.0': { 'src/hash-avatar.js': fakeLib('route') } } };
	const registry = await avatarRegistry(state);
	const routes = [];
	const root = mkdtempSync(join(tmpdir(), 'ai-team-avatar-route-'));
	const prev = { home: process.env.DSH_HOME, mirror: process.env.DSH_AI_TEAM_CATALOG_MIRROR };
	process.env.DSH_HOME = root;
	process.env.DSH_AI_TEAM_CATALOG_MIRROR = registry.base;
	useAvatarLib(null);
	const ctx = {
		effect(fn) { fn(); },
		on() { return () => {}; },
		get(id) {
			if (id === 'connection') return { requestRejection: () => undefined };
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') return { catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }), resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }) };
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
	apply(ctx);
	const server = createServer((req, res) => routes[0].handler(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		useAvatarLib(null);
		await new Promise((r) => server.close(r));
		await registry.close();
		for (const [key, value] of [['DSH_HOME', prev.home], ['DSH_AI_TEAM_CATALOG_MIRROR', prev.mirror]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
		rmSync(root, { recursive: true, force: true });
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const meta = await (await fetch(`${base}/ai-team/api/avatar/meta?wait=5000`)).json();
	assert.deepEqual([meta.package, meta.version, meta.contract, meta.ready], [AVATAR_PACKAGE, '1.3.0', 'v1', true]);
	assert.ok(meta.options.races.includes('elf'));
	assert.deepEqual(meta.options.arts, ['flat', 'pixel']);
	const r = await fetch(`${base}/ai-team/api/avatar.svg?name=${encodeURIComponent('青岚')}&gender=female&age=youth&race=elf&art=pixel&size=80&v=1.3.0`);
	assert.equal(r.status, 200);
	assert.match(r.headers.get('content-type'), /^image\/svg\+xml/);
	assert.match(r.headers.get('cache-control'), /immutable/);
	assert.equal(await r.text(), renderAvatarSvg('青岚', { gender: 'female', age: 'youth', race: 'elf', art: 'pixel', size: 80 }));
	useAvatarLib(null);
	rmSync(join(root, 'ai-team', 'vendor'), { recursive: true, force: true });
	state.latest = '9.9.9';
	const missing = await fetch(`${base}/ai-team/api/avatar.svg?name=x`);
	assert.equal(missing.status, 503);
});

test('client: the picker and image URLs follow the library meta (version in the URL, art only when not the default, unknown ids shown raw)', () => {
	const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
	const between = (tag) => source.slice(source.indexOf(`// <${tag}>`), source.indexOf(`// </${tag}>`));
	const c = vm.runInNewContext(`${between('member-copy')}\n({ avatarUrl, setAvatarMeta, avatarLabel, avatarPickNext, AVATAR_META })`);
	assert.equal(c.avatarUrl('墨渊', { gender: 'male', age: 'middle', race: 'elf' }, 24), '/ai-team/api/avatar.svg?name=%E5%A2%A8%E6%B8%8A&gender=male&age=middle&race=asian&size=48', 'before meta: only the base set, no version');
	c.setAvatarMeta({ version: '1.3.0', options: { genders: ['male', 'female', 'neutral'], ages: ['youth', 'middle'], races: ['asian', 'elf'], groups: { human: ['asian'], fantasy: ['elf'] }, arts: ['flat', 'pixel'] } });
	assert.equal(c.avatarUrl('墨渊', { gender: 'male', age: 'middle', race: 'elf', art: 'pixel' }, 24), '/ai-team/api/avatar.svg?name=%E5%A2%A8%E6%B8%8A&gender=male&age=middle&race=elf&art=pixel&size=48&v=1.3.0');
	assert.equal(c.avatarUrl('墨渊', { gender: 'male', age: 'middle', race: 'elf', art: 'flat' }, 24), '/ai-team/api/avatar.svg?name=%E5%A2%A8%E6%B8%8A&gender=male&age=middle&race=elf&size=48&v=1.3.0');
	assert.deepEqual(JSON.parse(JSON.stringify(c.avatarPickNext({ gender: 'male', art: 'pixel' }, 'art', 'flat'))), { gender: 'male' });
	const t = (key) => ({ avatar_elf: '精灵', avatar_art_pixel: '像素' })[key] ?? key;
	assert.deepEqual([c.avatarLabel(t, 'elf'), c.avatarLabel(t, 'pixel', 'avatar_art_'), c.avatarLabel(t, 'capybara2')], ['精灵', '像素', 'capybara2']);
});
