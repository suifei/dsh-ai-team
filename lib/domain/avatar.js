/**
 * 头像：参数校验（人才 talent.yml 的 `avatar`、成员资料的 `avatar`）与本机画图。
 *
 * 画图库 @suifei/hash-avatar 不随插件打包：插件运行时从 npm 取 latest（只走 registry 型镜像，
 * 整包核对 registry 给的 sha512 integrity，下载与解包复用 catalog-sync.js），落到
 * `<dshHome>/ai-team/vendor/hash-avatar/<版本>/hash-avatar.cjs`，`current.json` 记当前版本。
 * 库更新了，插件不用重发：启动时先用本机缓存，后台查新版，有就换上。
 *
 * 可选值（性别 / 年龄 / 种族 / 画风、种族分组）以当前加载的库为准（GENDERS / AGES / RACES / ARTS / GROUPS），
 * 库还没就绪时退回 BASE_OPTIONS（契约 v1 最早的五种人种）。人才市场、团队、成员共用这一份。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { catalogMirrors, latestVersion, packageReader } from './catalog-sync.js';

export const AVATAR_PACKAGE = '@suifei/hash-avatar';
/** 包里要的那一个文件：零依赖的 UMD 单文件。 */
export const AVATAR_FILE = 'src/hash-avatar.js';
export const MAX_AVATAR_LIB_BYTES = 4 * 1024 * 1024;
const SEMVER = /^\d+\.\d+\.\d+$/;
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

/** 库还没就绪时认的取值（契约 v1 的最小集合）。 */
export const BASE_OPTIONS = Object.freeze({
	genders: Object.freeze(['male', 'female', 'neutral']),
	ages: Object.freeze(['baby', 'teen', 'youth', 'middle', 'old']),
	races: Object.freeze(['asian', 'white', 'black', 'brown', 'auto']),
	groups: Object.freeze({ human: Object.freeze(['asian', 'white', 'black', 'brown', 'auto']) }),
	arts: Object.freeze(['flat']),
});

/** 默认：亚洲人、青年、性别不指定；画风不写即库的默认（flat）。 */
export const DEFAULT_AVATAR = Object.freeze({ gender: 'neutral', age: 'youth', race: 'asian' });

/** 当前加载的库：{ api, version（npm 版本）, contract, syncedAt, mirror } 或 null。 */
let active = null;

export function activeAvatarLib() {
	return active;
}

/** 测试与启动用：直接装上一个库对象（null 卸下）。 */
export function useAvatarLib(api, meta = {}) {
	if (api === null) {
		active = null;
		return null;
	}
	checkApi(api);
	active = { api, version: meta.version ?? null, contract: typeof api.version === 'string' ? api.version : null, syncedAt: meta.syncedAt ?? null, mirror: meta.mirror ?? null };
	return active;
}

function tokens(value, fallback) {
	const list = Array.isArray(value) ? value.filter((x) => typeof x === 'string' && TOKEN.test(x)) : [];
	return list.length > 0 ? Object.freeze(list) : fallback;
}

/** 当前可选值（界面挑选与校验共用）。 */
export function avatarOptions(lib = active) {
	if (lib === null) return BASE_OPTIONS;
	const { api } = lib;
	const races = tokens(api.RACES, BASE_OPTIONS.races);
	const groups = {};
	if (api.GROUPS !== null && typeof api.GROUPS === 'object') {
		for (const [group, list] of Object.entries(api.GROUPS)) {
			if (!TOKEN.test(group)) continue;
			const members = tokens(list, null);
			if (members !== null) groups[group] = members.filter((race) => races.includes(race));
		}
	}
	if (Object.keys(groups).length === 0) groups.human = races;
	// 没归进任何组的取值（如 1.3.0 的 any「随机」）收进 other，挑选界面才选得到。
	const grouped = new Set(Object.values(groups).flat());
	const other = races.filter((race) => !grouped.has(race));
	if (other.length > 0) groups.other = Object.freeze([...(groups.other ?? []), ...other]);
	return Object.freeze({ genders: tokens(api.GENDERS, BASE_OPTIONS.genders), ages: tokens(api.AGES, BASE_OPTIONS.ages), races, groups: Object.freeze(groups), arts: tokens(api.ARTS, BASE_OPTIONS.arts) });
}

/**
 * 校验头像参数。缺省（undefined / null）返回 null；gender / age / race 可只给一部分，缺的按 DEFAULT_AVATAR 补；
 * art 可选，不写就不带。写错的值抛错并说明哪一项，不静默改成别的。取值以当前库为准。
 * @returns {{ gender: string, age: string, race: string, art?: string } | null}
 */
export function parseAvatar(value, label = 'avatar') {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象（gender / age / race / art）`);
	const options = avatarOptions();
	const check = (key, allowed) => {
		const raw = value[key];
		if (typeof raw !== 'string' || !allowed.includes(raw)) {
			const shown = allowed.length > 12 ? `${allowed.slice(0, 12).join(' / ')} …（共 ${allowed.length} 个）` : allowed.join(' / ');
			throw new Error(`${label}.${key} 只认 ${shown}`);
		}
		return raw;
	};
	const pick = (key, allowed) => (value[key] === undefined || value[key] === null || value[key] === '' ? DEFAULT_AVATAR[key] : check(key, allowed));
	const out = { gender: pick('gender', options.genders), age: pick('age', options.ages), race: pick('race', options.races) };
	if (value.art !== undefined && value.art !== null && value.art !== '') out.art = check('art', options.arts);
	return out;
}

/**
 * 画一张头像 SVG；库还没就绪返回 null（路由回 503，界面退回首字母）。参数宽松：写错或缺省的按默认；
 * 尺寸夹到 16..1024；小于 128px（客户端按 2 倍像素取图，即显示不到 64px）时去掉外圈指纹与动效：
 * 太密看不清，几十张卡片一起动也费 CPU（见 hash-avatar README）。
 */
export function renderAvatarSvg(name, options = {}) {
	if (active === null) return null;
	const allowed = avatarOptions();
	const pick = (key, list) => (list.includes(options[key]) ? options[key] : DEFAULT_AVATAR[key]);
	const size = Math.max(16, Math.min(1024, Math.round(Number(options.size) || 64)));
	const input = String(name ?? '').trim().slice(0, 200) || '?';
	const art = allowed.arts.includes(options.art) ? { art: options.art } : {};
	const large = size >= 128;
	return active.api.svg(input, { gender: pick('gender', allowed.genders), age: pick('age', allowed.ages), race: pick('race', allowed.races), ...art, size, fingerprint: large, animate: large });
}

function checkApi(api) {
	if (api === null || typeof api !== 'object' || typeof api.svg !== 'function') throw new Error('不是 hash-avatar：缺 svg()');
	const probe = api.svg('probe', { size: 32 });
	if (typeof probe !== 'string' || !probe.startsWith('<svg')) throw new Error('hash-avatar 的 svg() 没画出 SVG');
}

function requireFresh(file) {
	const req = createRequire(file);
	delete req.cache[file];
	return req(file);
}

/** 头像库在本机的落盘目录：`<dshHome>/ai-team/vendor/hash-avatar/`。 */
export function avatarLibDir(dshHome) {
	if (typeof dshHome !== 'string' || dshHome === '') throw new Error('avatarLibDir: 需要 dshHome');
	return join(dshHome, 'ai-team', 'vendor', 'hash-avatar');
}

function readCurrent(dshHome) {
	try {
		const current = JSON.parse(readFileSync(join(avatarLibDir(dshHome), 'current.json'), 'utf8'));
		return SEMVER.test(current?.version ?? '') ? current : null;
	} catch {
		return null;
	}
}

/** 装上本机缓存的库；没有或坏了返回 null（不抛）。 */
export function loadAvatarLib(dshHome) {
	const current = readCurrent(dshHome);
	if (current === null) return null;
	try {
		const file = join(avatarLibDir(dshHome), current.version, 'hash-avatar.cjs');
		if (!existsSync(file)) return null;
		return useAvatarLib(requireFresh(file), current);
	} catch {
		return null;
	}
}

/** 取代码只走 registry 型镜像（整包有 sha512 integrity 可核对）；CDN 按文件取没有校验，不用来取代码。 */
export function avatarMirrors(env = process.env) {
	return catalogMirrors(env).filter((mirror) => mirror.kind === 'registry');
}

/**
 * 从 npm 取 latest 头像库；已是这个版本且已加载就不动。成功后立即换上。失败抛错，旧版本原样保留。
 * @returns {Promise<{ updated: boolean, version: string, previous?: string|null, mirror?: string, contract?: string|null }>}
 */
export async function syncAvatarLib({ dshHome, fetchImpl = globalThis.fetch, mirrors = avatarMirrors(), timeoutMs = 15000, now = () => new Date().toISOString() } = {}) {
	if (typeof fetchImpl !== 'function') throw new Error('当前宿主没有 fetch，取不到头像库');
	const base = avatarLibDir(dshHome);
	const current = readCurrent(dshHome);
	const latest = await latestVersion({ fetchImpl, mirrors, pkg: AVATAR_PACKAGE, timeoutMs });
	if (current !== null && current.version === latest.version) {
		if (active === null || active.version !== latest.version) loadAvatarLib(dshHome);
		if (active !== null && active.version === latest.version) return { updated: false, version: latest.version };
	}
	const ordered = [...mirrors.filter((m) => m.name === latest.mirror), ...mirrors.filter((m) => m.name !== latest.mirror)];
	mkdirSync(base, { recursive: true });
	const errors = [];
	for (const mirror of ordered) {
		const staging = join(base, `.staging-${latest.version}-${randomBytes(4).toString('hex')}`);
		try {
			const read = await packageReader(mirror, { fetchImpl, pkg: AVATAR_PACKAGE, version: latest.version, timeoutMs });
			const code = await read(AVATAR_FILE);
			if (code.length === 0 || code.length > MAX_AVATAR_LIB_BYTES) throw new Error(`${AVATAR_FILE} 大小不合格（${code.length}）`);
			mkdirSync(staging, { recursive: true });
			writeFileSync(join(staging, 'hash-avatar.cjs'), code);
			checkApi(requireFresh(join(staging, 'hash-avatar.cjs')));
			const target = join(base, latest.version);
			rmSync(target, { recursive: true, force: true });
			renameSync(staging, target);
			const record = { version: latest.version, syncedAt: now(), mirror: mirror.name };
			writeFileSync(join(base, 'current.json.tmp'), JSON.stringify(record, null, 2) + '\n');
			renameSync(join(base, 'current.json.tmp'), join(base, 'current.json'));
			for (const name of readdirSync(base)) {
				if (name === latest.version || name === 'current.json') continue;
				rmSync(join(base, name), { recursive: true, force: true });
			}
			if (loadAvatarLib(dshHome) === null) throw new Error('新版本装不上');
			return { updated: true, version: latest.version, previous: current?.version ?? null, mirror: mirror.name, contract: active.contract };
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			errors.push(`${mirror.name}: ${error.message}`);
		}
	}
	throw new Error(`取头像库 ${AVATAR_PACKAGE}@${latest.version} 失败（${errors.join('；')}）`);
}

/**
 * 插件启动用：先装本机缓存；查新版按需触发，不设定时器——界面取头像或 meta 时才查，
 * 之后每 checkEveryMs 最多查一次（没用到头像的场景不联网）。
 * `ready(ms)` 给路由用：库已就绪立即返回（顺带按节流查新版）；没就绪就等一次在途的同步（最多 ms），仍没有返回 null。
 */
export function startAvatarLib({ dshHome, diag = null, fetchImpl = globalThis.fetch, mirrors, checkEveryMs = 6 * 3600 * 1000, clock = () => Date.now() } = {}) {
	const loaded = loadAvatarLib(dshHome);
	diag?.append(loaded === null ? { ev: 'avatar.lib.missing' } : { ev: 'avatar.lib.load', version: loaded.version, contract: loaded.contract });
	let inflight = null;
	let lastCheck = -Infinity;
	let disposed = false;
	const refresh = () => {
		if (disposed) return Promise.resolve(null);
		if (inflight !== null) return inflight;
		lastCheck = clock();
		inflight = syncAvatarLib({ dshHome, fetchImpl, ...(mirrors ? { mirrors } : {}) })
			.then((result) => {
				diag?.append(result.updated ? { ev: 'avatar.lib.update', version: result.version, previous: result.previous, mirror: result.mirror, contract: result.contract } : { ev: 'avatar.lib.current', version: result.version });
				return result;
			}, (error) => {
				diag?.append({ ev: 'avatar.lib.sync.fail', message: error.message });
				return null;
			})
			.finally(() => { inflight = null; });
		return inflight;
	};
	return {
		refresh,
		async ready(ms = 15000) {
			if (active !== null) {
				if (clock() - lastCheck >= checkEveryMs) void refresh();
				return active;
			}
			// 刚失败过（离线）就别让每张图都再试一次：60 秒内直接回 null。
			const recentlyFailed = inflight === null && clock() - lastCheck < 60 * 1000;
			if (ms <= 0 || recentlyFailed) {
				if (!recentlyFailed) void refresh();
				return null;
			}
			let timer = null;
			await Promise.race([refresh(), new Promise((resolve) => { timer = setTimeout(resolve, ms); })]);
			clearTimeout(timer);
			return active;
		},
		dispose() {
			disposed = true;
		},
	};
}
