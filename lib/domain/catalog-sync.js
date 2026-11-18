/**
 * 人才市场第 3 步：官方在线人才库同步。
 *
 * 在线库是独立 npm 包 `@suifei/dsh-ai-team-catalog`，内容与插件内置同格式（talents/ + teams/），
 * 包根多一份 `index.json`：列出每个文件的相对路径、字节数与 sha256。同步时：
 *   1. 按镜像顺序（npmmirror → jsDelivr）问最新版本号；与本地 `current.json` 相同就不动；
 *   2. 取 index.json，校验格式号、版本、插件最低版本、路径白名单与大小上限；
 *   3. 逐个文件下载并核对 sha256，全部落进临时目录后整体改名为 `official/<版本>/`，再写 `current.json`；
 *      中途任何一步失败都丢掉临时目录，旧版本原样保留。
 * 读取时 `officialRoot()` 给出当前版本目录，插在用户自建与插件内置之间（lib/domain/catalog.js）。
 *
 * 打包在线库的脚本（bin/build-catalog.mjs）与这里共用 `isCatalogPath` / `buildIndex`，同一套规则。
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const CATALOG_PACKAGE = '@suifei/dsh-ai-team-catalog';
/** index.json 的格式号；格式变了才升。 */
export const CATALOG_FORMAT = 1;
/** 能读 CATALOG_FORMAT=1 的最低插件版本。 */
export const CATALOG_MIN_PLUGIN = '0.4.130';
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 2000;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SLUG = '[a-z0-9][a-z0-9-]{0,63}';
const SKILL = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const CATALOG_PATH = new RegExp(`^(?:talents/${SLUG}/talent\\.yml|teams/${SLUG}/team\\.yml|(?:talents|teams)/${SLUG}/skills/(?:${SKILL}/SKILL|${SKILL})\\.md)$`);
const HEX64 = /^[0-9a-f]{64}$/;

/** 镜像：先国内（npmmirror），再 jsDelivr。每个镜像自带「问最新版本」与「按文件取」两个地址。 */
export const MIRRORS = Object.freeze([
	Object.freeze({
		name: 'npmmirror',
		latest: (pkg) => `https://registry.npmmirror.com/${pkg}/latest`,
		file: (pkg, version, path) => `https://registry.npmmirror.com/${pkg}/${version}/files/${path}`,
	}),
	Object.freeze({
		name: 'jsdelivr',
		latest: (pkg) => `https://data.jsdelivr.com/v1/packages/npm/${pkg}/resolved?specifier=latest`,
		file: (pkg, version, path) => `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${path}`,
	}),
]);

/**
 * 实际用的镜像：设了 `DSH_AI_TEAM_CATALOG_MIRROR`（npmmirror / cnpmcore 同形的私有源根，
 * 如 `http://127.0.0.1:7001`）就只用它（内网、E2E）；否则用内置镜像。
 */
export function catalogMirrors(env = process.env) {
	const base = typeof env?.DSH_AI_TEAM_CATALOG_MIRROR === 'string' ? env.DSH_AI_TEAM_CATALOG_MIRROR.trim().replace(/\/+$/, '') : '';
	if (!/^https?:\/\//.test(base)) return MIRRORS;
	return [{ name: 'custom', latest: (pkg) => `${base}/${pkg}/latest`, file: (pkg, version, path) => `${base}/${pkg}/${version}/files/${path}` }];
}

/** 在线库里允许出现的文件：人才 talent.yml、团队 team.yml、两者 skills/ 下的技能 Markdown。不允许 `..`、绝对路径、脚本。 */
export function isCatalogPath(path) {
	return typeof path === 'string' && CATALOG_PATH.test(path);
}

export function compareVersions(a, b) {
	const x = SEMVER.exec(a ?? '');
	const y = SEMVER.exec(b ?? '');
	if (x === null || y === null) return Number.NaN;
	for (let i = 1; i <= 3; i += 1) {
		const d = Number(x[i]) - Number(y[i]);
		if (d !== 0) return Math.sign(d);
	}
	return 0;
}

export function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

/** 官方在线库在本机的落盘目录：`<dshHome>/ai-team/catalog/official/`。 */
export function officialCatalogDir(dshHome) {
	if (typeof dshHome !== 'string' || dshHome === '') throw new Error('officialCatalogDir: 需要 dshHome');
	return join(dshHome, 'ai-team', 'catalog', 'official');
}

/** 本地当前同步到的版本（`current.json`）；没有或写坏返回 null。 */
export function officialStatus(dshHome) {
	try {
		const base = officialCatalogDir(dshHome);
		const current = JSON.parse(readFileSync(join(base, 'current.json'), 'utf8'));
		if (!SEMVER.test(current?.version ?? '')) return null;
		const dir = join(base, current.version);
		if (!existsSync(dir)) return null;
		return { version: current.version, syncedAt: current.syncedAt ?? null, mirror: current.mirror ?? null, files: current.files ?? null, dir };
	} catch {
		return null;
	}
}

/** catalogRoots 用：当前官方版本目录，没同步过返回 null。 */
export function officialRoot(dshHome) {
	const status = officialStatus(dshHome);
	return status === null ? null : { source: 'official', dir: status.dir, version: status.version };
}

/** 校验一份 index.json；返回规整后的文件清单，不合格抛错（中文说明给界面）。 */
export function validateIndex(index, { version, pluginVersion } = {}) {
	if (index === null || typeof index !== 'object') throw new Error('index.json 不是对象');
	if (index.format !== CATALOG_FORMAT) throw new Error(`index.json 格式号 ${String(index.format)} 不认识（本插件只认 ${CATALOG_FORMAT}），请先升级插件`);
	if (version !== undefined && index.version !== version) throw new Error(`index.json 版本 ${String(index.version)} 与包版本 ${version} 不一致`);
	if (typeof index.minPlugin === 'string' && pluginVersion !== undefined && compareVersions(pluginVersion, index.minPlugin) < 0) {
		throw new Error(`在线人才库 ${index.version} 需要插件 ≥ ${index.minPlugin}，当前 ${pluginVersion}，请先升级插件`);
	}
	if (!Array.isArray(index.files) || index.files.length === 0) throw new Error('index.json 没有文件清单');
	if (index.files.length > MAX_FILES) throw new Error(`文件太多（${index.files.length} > ${MAX_FILES}）`);
	const seen = new Set();
	let total = 0;
	const files = index.files.map((entry, i) => {
		const path = entry?.path;
		if (!isCatalogPath(path)) throw new Error(`第 ${i + 1} 个文件路径不允许：${String(path)}`);
		if (seen.has(path)) throw new Error(`文件重复：${path}`);
		seen.add(path);
		if (!Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) throw new Error(`文件大小不合格：${path}`);
		if (typeof entry.sha256 !== 'string' || !HEX64.test(entry.sha256)) throw new Error(`缺少 sha256：${path}`);
		total += entry.size;
		return { path, size: entry.size, sha256: entry.sha256 };
	});
	if (total > MAX_TOTAL_BYTES) throw new Error(`总大小超限（${total} > ${MAX_TOTAL_BYTES}）`);
	return files;
}

function walk(dir, base = dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir).sort()) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, base, out);
		else out.push(relative(base, full).split(sep).join('/'));
	}
	return out;
}

/** 打包用：从一个目录（含 talents/ teams/）算出 index.json；白名单外的文件列进 skipped，不进包。 */
export function buildIndex(sourceDir, { version, minPlugin = CATALOG_MIN_PLUGIN } = {}) {
	if (!SEMVER.test(version ?? '')) throw new Error('buildIndex: 需要 x.y.z 版本号');
	const files = [];
	const skipped = [];
	for (const kind of ['talents', 'teams']) {
		for (const rel of walk(join(sourceDir, kind))) {
			const path = `${kind}/${rel}`;
			if (!isCatalogPath(path)) {
				skipped.push(path);
				continue;
			}
			const buffer = readFileSync(join(sourceDir, path));
			files.push({ path, size: buffer.length, sha256: sha256(buffer) });
		}
	}
	const index = { format: CATALOG_FORMAT, name: CATALOG_PACKAGE, version, minPlugin, files };
	validateIndex(index, { version });
	return { index, skipped };
}

async function fetchOk(fetchImpl, url, timeoutMs) {
	const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json, text/plain, */*' } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res;
}

/** 只问最新版本（「检查更新」与同步共用）。 */
export async function latestVersion({ fetchImpl = globalThis.fetch, mirrors = catalogMirrors(), pkg = CATALOG_PACKAGE, timeoutMs = 15000 } = {}) {
	const errors = [];
	for (const mirror of mirrors) {
		try {
			const body = await (await fetchOk(fetchImpl, mirror.latest(pkg), timeoutMs)).json();
			if (!SEMVER.test(body?.version ?? '')) throw new Error('镜像没给出版本号');
			return { version: body.version, mirror: mirror.name };
		} catch (error) {
			errors.push(`${mirror.name}: ${error.message}`);
		}
	}
	throw new Error(`取不到在线人才库版本（${errors.join('；')}）`);
}

async function downloadFrom(mirror, { fetchImpl, pkg, version, pluginVersion, timeoutMs, staging }) {
	const indexRes = await fetchOk(fetchImpl, mirror.file(pkg, version, 'index.json'), timeoutMs);
	const files = validateIndex(JSON.parse(Buffer.from(await indexRes.arrayBuffer()).toString('utf8')), { version, pluginVersion });
	for (const file of files) {
		const buffer = Buffer.from(await (await fetchOk(fetchImpl, mirror.file(pkg, version, file.path), timeoutMs)).arrayBuffer());
		if (buffer.length !== file.size || sha256(buffer) !== file.sha256) throw new Error(`校验不符：${file.path}`);
		const target = join(staging, ...file.path.split('/'));
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, buffer);
	}
	return files.length;
}

/**
 * 同步官方在线人才库到 `<dshHome>/ai-team/catalog/official/<版本>/`。
 * 已是最新返回 `{ updated: false }`；成功返回 `{ updated: true, version, previous, files, mirror }`；失败抛错且不动旧版本。
 */
export async function syncOfficialCatalog({ dshHome, pluginVersion, fetchImpl = globalThis.fetch, mirrors = catalogMirrors(), pkg = CATALOG_PACKAGE, timeoutMs = 15000, force = false, now = () => new Date().toISOString() } = {}) {
	if (typeof fetchImpl !== 'function') throw new Error('当前宿主没有 fetch，无法联网同步');
	const base = officialCatalogDir(dshHome);
	const current = officialStatus(dshHome);
	const latest = await latestVersion({ fetchImpl, mirrors, pkg, timeoutMs });
	if (!force && current !== null && current.version === latest.version) return { updated: false, version: current.version, latest: latest.version };
	// 下载优先用刚给出版本号的镜像，失败再换其它镜像。
	const ordered = [...mirrors.filter((m) => m.name === latest.mirror), ...mirrors.filter((m) => m.name !== latest.mirror)];
	mkdirSync(base, { recursive: true });
	const errors = [];
	for (const mirror of ordered) {
		const staging = join(base, `.staging-${latest.version}-${randomBytes(4).toString('hex')}`);
		try {
			const count = await downloadFrom(mirror, { fetchImpl, pkg, version: latest.version, pluginVersion, timeoutMs, staging });
			const target = join(base, latest.version);
			rmSync(target, { recursive: true, force: true });
			renameSync(staging, target);
			const record = { version: latest.version, syncedAt: now(), mirror: mirror.name, files: count };
			writeFileSync(join(base, 'current.json.tmp'), JSON.stringify(record, null, 2) + '\n');
			renameSync(join(base, 'current.json.tmp'), join(base, 'current.json'));
			// 只留当前版本：旧版本目录与残留临时目录清掉。
			for (const name of readdirSync(base)) {
				if (name === latest.version || name === 'current.json') continue;
				rmSync(join(base, name), { recursive: true, force: true });
			}
			return { updated: true, version: latest.version, previous: current?.version ?? null, files: count, mirror: mirror.name };
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			errors.push(`${mirror.name}: ${error.message}`);
			// 包内容本身不合格（格式、版本、路径、插件版本）换镜像也没用，直接报。
			if (/格式号|需要插件|路径不允许|不一致|超限|太多/.test(error.message)) break;
		}
	}
	throw new Error(`同步在线人才库 ${latest.version} 失败（${errors.join('；')}）`);
}

/** 删掉本机的在线库（退回插件内置）。 */
export function clearOfficialCatalog(dshHome) {
	rmSync(officialCatalogDir(dshHome), { recursive: true, force: true });
}
