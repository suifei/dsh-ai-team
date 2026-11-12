/**
 * Plugin-owned diagnostic log: one JSONL file per day, appended serially,
 * rotated at a byte cap, and readable back through tail(). Both the Host
 * (boot, dispatch, wake, PMO, member failure/recovery) and the Client half
 * (via route rows) write into it, so "the panel shows no data" is answerable
 * from evidence. Levels: 'off' silent, 'errors' crash/fail rows only
 * (shipped default), 'full' everything (development).
 */
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The date-stamped file name carries the day; rows carry projectId/projectName. */
export function diagFileName(date = new Date()) {
	return `aiteam-diag-${date.toISOString().slice(0, 10)}.jsonl`;
}

export function defaultDiagDir() {
	// 必须与插件数据目录同源（`dshHome()`）：否则设置了 `DSH_HOME` 的隔离实例
	// （测试、临时 profile）会把诊断行写进**真实**的 `~/.dsh/ai-team`，污染生产日志
	// ——实机上就混进过 `E:/definitely-not-existing-dir-xyz` 这类测试夹具的行。
	const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
		? process.env.DSH_HOME
		: join(homedir(), '.dsh');
	return join(home, 'ai-team');
}

/** Rows worth keeping when the logger runs in `errors` mode. */
export function isErrorEvent(ev) {
	return typeof ev === 'string'
		&& (ev.endsWith('.fail') || ev === 'boot.refused' || ev === 'route.reject' || ev === 'ledger.repair'
			// 归档修复的**成功**行必须留在 `errors` 级别：否则「修没修」永远无法
			// 判定（只有 boot 瞬间那一行 deferred.fail 可见）。
			|| ev === 'host.repair.ok');
}

/**
 * @param options - { dir, maxBytes, now, enabled, level } seams for tests.
 * `level`: 'off' drops every row (published default footprint), 'errors' keeps
 * only crash/fail rows, 'full' writes everything (development).
 */
/**
 * 共享失败汇（进程级）：库模块（ledger / registry / host-agent / skill-provider /
 * jobs）拿不到 `diag` 实例，此前只能 `console.warn`——线上这些信息不可检索。
 * 插件在 boot 时用 `installDiagSink()` 把真正的 diag 接进来；所有 `reportFail`
 * 事件名以 `.fail` 结尾，因此在发布默认的 `errors` 级别下也会落盘。
 */
let sharedSink = null;

/** @returns {() => void} 卸载函数（teardown 时调用，避免热重载后写旧实例）。 */
export function installDiagSink(sink) {
	sharedSink = typeof sink === 'function' ? sink : null;
	return () => { if (sharedSink === sink) sharedSink = null; };
}

/**
 * 记录一条失败：既进 diag（可检索），也保留原有 console 输出（开发期可见）。
 * diag 写入永不抛出——诊断通道不能反过来把调用方弄挂。
 */
export function reportFail(event, payload = {}, consoleText = '') {
	try {
		if (sharedSink !== null) sharedSink({ ev: event, ...payload });
	} catch { /* diagnostics must never break the caller */ }
	if (consoleText !== '') {
		try { console.warn(consoleText); } catch { /* console may be gone */ }
	}
}
export function createDiagLogger(options = {}) {
	const dir = options.dir ?? defaultDiagDir();
	const maxBytes = options.maxBytes ?? 1048576;
	const enabled = options.enabled !== false;
	const level = ['off', 'errors', 'full'].includes(options.level) ? options.level : 'errors';
	const now = options.now ?? (() => new Date());
	let queue = Promise.resolve();
	let dirReady = null;
	/** @type {number} */
	let appended = 0;

	const ensureDir = () => {
		if (dirReady === null) dirReady = mkdir(dir, { recursive: true });
		return dirReady;
	};

	const path = () => join(dir, diagFileName(now()));

	function append(row) {
		if (!enabled || level === 'off' || (level === 'errors' && !isErrorEvent(row.ev))) return queue;
		const line = `${JSON.stringify({ t: now().toISOString(), ...row })}\n`;
		queue = queue.then(async () => {
			await ensureDir();
			appended++;
			if (appended % 20 === 1) {
				// Cheap periodic rotation: stat at most every 20 appends.
				try {
					const info = await stat(path());
					if (info.size > maxBytes) await rename(path(), `${path()}.1`);
				} catch { /* first write: nothing to rotate */ }
			}
			await appendFile(path(), line, 'utf8');
		}).catch(() => void 0);
		return queue;
	}

	/**
	 * Read back the newest rows of today's file.
	 * @param count - rows to return, newest last.
	 */
	async function tail(count = 50) {
		let text = '';
		try {
			text = await readFile(path(), 'utf8');
		} catch {
			return { file: path(), rows: [] };
		}
		const rows = text
			.split('\n')
			.filter((line) => line !== '')
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return { t: '?', ev: 'unparsed', line };
				}
			});
		return { file: path(), rows: rows.slice(-Math.max(1, Math.min(500, count))) };
	}

	return {
		append,
		tail,
		path,
		dir,
		get level() {
			return level;
		},
		get queueSize() {
			return appended;
		},
	};
}
