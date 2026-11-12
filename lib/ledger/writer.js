/**
 * 单项目账本写入器：append-only JSONL、分段、fsync、单写者锁、尾撕裂修复。
 *
 * 对应 03-架构设计报告 §6.5 / §6.6 / §8.1、附录 B §B.3.6：
 * - 一个 Project 一个 LedgerWriter；进程内 Promise 队列串行化写入。
 * - append 成功（默认 fsync 完成）后才更新内存 head；失败回滚到写前长度。
 * - 跨段 hash 链连续；打开时全量校验，尾部半行可截断修复并返回修复信息。
 * - 锁文件 `lock`：PID + host + startedAt + token，非 OS flock（ADR-11）。
 *
 * 同时提供 `openLedger()` 门面（供 host service 直接消费）：
 *   { append, appendMany, state, events, head, verify, repair, replay, close }
 * 门面在 append 成功之后才推进 state，失败不改变 state。
 */

import fsDefault from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
	GENESIS_HASH,
	HASH_PATTERN,
	MAX_EVENT_BYTES,
	EVENT_VERSION,
	LedgerError,
	canonicalJson,
	newEventId,
	sealEvent,
	serializeEvent,
	verifyChain,
	verifyEvent,
} from './events.js';
import { applyEvent, FOLD_STATE_VERSION, fold, initialState } from './fold.js';
import { loadCheckpoint, saveCheckpoint } from './checkpoint.js';

export { LedgerError };

/** 默认分段阈值（03 §6.5：32 MB 或 50,000 事件先到为准）。 */
export const DEFAULT_SEGMENT_EVENTS = 50_000;
export const DEFAULT_SEGMENT_BYTES = 32 * 1024 * 1024;

export const SEGMENT_PATTERN = /^ledger-(\d{6})\.jsonl$/;
export const LOCK_FILE = 'lock';

/**
 * Grace period for an unreadable lock record. The lock file is created empty and
 * filled immediately after, so a 0-byte file is normal for a live writer; only
 * an unreadable record older than this counts as a crashed writer.
 */
export const LOCK_WRITE_GRACE_MS = 10_000;

const DRAFT_FIELDS = new Set([
	'type',
	'payload',
	'actor',
	'at',
	'id',
	'v',
	'correlationId',
	'causationId',
	'projectId',
]);

function formatSegmentName(index) {
	if (!Number.isSafeInteger(index) || index < 1 || index > 999_999) {
		throw new LedgerError('E_SEGMENT_INDEX', 'segment index is out of range', { index });
	}
	return `ledger-${String(index).padStart(6, '0')}.jsonl`;
}

function isProcessAlive(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	if (pid === process.pid) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM 说明进程存在但无权限发信号；ESRCH 才是“不存在”。
		return error?.code === 'EPERM';
	}
}

/** 写一个 Buffer 到 fd，处理短写。 */
function writeAll(fs, fd, buffer) {
	let offset = 0;
	while (offset < buffer.length) {
		const written = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
		if (!Number.isFinite(written) || written <= 0) {
			throw new Error('short write');
		}
		offset += written;
	}
}

/**
 * 每 Project 的账本写入器。
 *
 * 选项：
 * - segmentEvents / segmentBytes：分段阈值，测试可调小。
 * - fsync：默认 true；false 仅供测试/基准，生产路径必须为 true。
 * - lock：默认 true；false 仅供只读检查或测试替身。
 * - repairTail：open 时是否修复最后一行半行，默认 true。
 * - fs：可注入的 fs 实现（故障注入测试），默认 node:fs。
 * - clock：时间源，默认 Date.now。
 */
export class LedgerWriter {
	constructor(options = {}) {
		const {
			dir,
			projectId,
			segmentEvents = DEFAULT_SEGMENT_EVENTS,
			segmentBytes = DEFAULT_SEGMENT_BYTES,
			fsync = true,
			lock = true,
			repairTail = true,
			fs = fsDefault,
			clock = Date.now,
		} = options;

		if (typeof dir !== 'string' || dir.length === 0) {
			throw new LedgerError('E_INVALID_OPTION', 'LedgerWriter requires a data directory');
		}
		if (typeof projectId !== 'string' || projectId.length === 0) {
			throw new LedgerError('E_INVALID_OPTION', 'LedgerWriter requires a projectId');
		}
		if (!Number.isSafeInteger(segmentEvents) || segmentEvents < 1) {
			throw new LedgerError('E_INVALID_OPTION', 'segmentEvents must be a positive integer');
		}
		if (!Number.isSafeInteger(segmentBytes) || segmentBytes < 1) {
			throw new LedgerError('E_INVALID_OPTION', 'segmentBytes must be a positive integer');
		}
		if (typeof clock !== 'function') {
			throw new LedgerError('E_INVALID_OPTION', 'clock must be a function');
		}

		this.dir = path.resolve(dir);
		this.projectId = projectId;
		this.segmentEvents = segmentEvents;
		this.segmentBytes = segmentBytes;
		this.fsync = fsync !== false;
		this.useLock = lock !== false;
		this.repairTailOnOpen = repairTail !== false;
		this._fs = fs;
		this._clock = clock;
		this._lockToken = randomBytes(8).toString('hex');

		this._opened = false;
		this._closed = false;
		this._head = { seq: 0, hash: GENESIS_HASH };
		this._eventCount = 0;
		this._current = null;
		this._segments = [];
		this._segmentCounts = new Map();
		this._hashes = new Map();
		this._ids = new Set();
		this._repairs = [];
		this._openResult = null;
		this._queue = Promise.resolve();
		// 回滚失败后置为非空：本句柄不可继续写，必须 close + open 重新扫描。
		this._poisoned = null;
	}

	get head() {
		return { ...this._head };
	}

	get eventCount() {
		return this._eventCount;
	}

	get opened() {
		return this._opened && !this._closed;
	}

	get closed() {
		return this._closed;
	}

	get repairs() {
		return [...this._repairs];
	}

	/**
	 * 打开账本：加锁 → 全量校验 → 尾撕裂修复 → 打开当前段。
	 * @returns {{projectId:string,segments:string[],eventCount:number,head:{seq:number,hash:string},repair:object|null,repairs:object[]}}
	 */
	open() {
		if (this._opened && !this._closed) return this._openResult;
		this._resetForOpen();

		try {
			this._fs.mkdirSync(this.dir, { recursive: true });
		} catch (error) {
			throw new LedgerError('E_STORAGE', `cannot create ledger directory: ${error.message}`, {
				sysCode: error.code ?? null,
			});
		}

		const repairs = [];
		this._poisoned = null;
		try {
			if (this.useLock) this._acquireLock(repairs);
			const scan = this._scan({ repairTail: this.repairTailOnOpen });
			this._adoptScan(scan);
			if (scan.repair) repairs.push(scan.repair);

			if (scan.segments.length === 0) {
				this._current = {
					index: 1,
					name: formatSegmentName(1),
					path: path.join(this.dir, formatSegmentName(1)),
					fd: null,
					size: 0,
					count: 0,
				};
			} else {
				const last = scan.segments[scan.segments.length - 1];
				const fd = this._fs.openSync(last.path, 'a');
				this._current = {
					...last,
					fd,
					size: this._fs.statSync(last.path).size,
					count: scan.counts.get(last.index) ?? 0,
				};
			}

			this._opened = true;
			this._closed = false;
			this._repairs = repairs;
			this._openResult = {
				projectId: this.projectId,
				segments: scan.segments.map((segment) => segment.name),
				eventCount: this._eventCount,
				head: { ...this._head },
				repair: scan.repair,
				repairs: [...repairs],
			};
			return this._openResult;
		} catch (error) {
			try {
				if (this._current?.fd !== null && this._current?.fd !== undefined) {
					this._fs.closeSync(this._current.fd);
				}
			} catch {
				// 打开失败时只尽力清理。
			}
			this._current = null;
			try {
				if (this.useLock) this._releaseLock();
			} catch {
				// 锁清理失败不能掩盖真正的打开错误。
			}
			throw error;
		}
	}

	/**
	 * 追加单条事件。返回 sealed event（含 seq / hash / prevHash）。
	 * Promise 在写入（以及默认 fsync）完成后 resolve；失败则文件回滚、head 不变。
	 */
	append(draft) {
		return this.appendMany([draft]).then((events) => events[0]);
	}

	/**
	 * 组提交：一批事件共享一次 fsync；任一失败整批回滚。
	 * @param {object[]} drafts
	 * @returns {Promise<object[]>} sealed events
	 */
	appendMany(drafts) {
		if (!Array.isArray(drafts)) {
			return Promise.reject(new LedgerError('E_EVENT_INVALID', 'appendMany expects an array'));
		}
		if (drafts.length === 0) return Promise.resolve([]);
		// 回滚失败过：本句柄的历史不再可信（可能已有半截写入留在段内），
		// 继续接单会把后续事件追加到未知状态之后。要求 close + open 重新扫描。
		if (this._poisoned !== null && this._poisoned !== undefined) {
			return Promise.reject(new LedgerError('E_LEDGER_POISONED',
				`ledger writer is unusable after a failed rollback (${this._poisoned}); close and open it again`, {
					rollbackError: this._poisoned,
				}));
		}
		return this._enqueue(() => this._appendBatch(drafts));
	}

	/**
	 * 读取全部事件并校验 hash 链 / seq / projectId。
	 * 未 open 的只读句柄默认修复尾部半行（open 会自动修复；已 open 的句柄
	 * 默认只读，需要再次修复时显式传 repairTail:true）。
	 */
	readAll(options = {}) {
		const repairTail = options.repairTail ?? !this._opened;
		const scan = this._scan({ repairTail });
		if (this._opened && scan.repair) {
			this._adoptScan(scan);
			this._syncCurrentFromScan(scan);
			this._openResult = {
				...this._openResult,
				segments: scan.segments.map((segment) => segment.name),
				eventCount: this._eventCount,
				head: { ...this._head },
				repair: scan.repair ?? this._openResult?.repair ?? null,
			};
		}
		return scan.events;
	}

	/**
	 * 重放：读取全部事件，从 fromSeq（含）开始对 state 调 apply。
	 * 用于 checkpoint 之后的 tail replay。
	 */
	replay(initialStateValue, apply, options = {}) {
		if (typeof apply !== 'function') {
			throw new LedgerError('E_INVALID_OPTION', 'replay requires an apply(state,event) function');
		}
		const fromSeq = options.fromSeq ?? 1;
		if (!Number.isSafeInteger(fromSeq) || fromSeq < 1) {
			throw new LedgerError('E_INVALID_OPTION', 'fromSeq must be a positive integer');
		}
		if (fromSeq > this._head.seq + 1) {
			throw new LedgerError('E_FROM_SEQ_FUTURE', 'fromSeq is beyond the ledger head', {
				fromSeq,
				headSeq: this._head.seq,
			});
		}

		const events = this.readAll({ repairTail: false });
		let state = initialStateValue;
		for (const event of events) {
			if (event.seq >= fromSeq) state = apply(state, event);
		}
		return state;
	}

	/** seq 对应事件的 hash；seq=0 返回创世 hash。 */
	hashAt(seq) {
		if (seq === 0) return GENESIS_HASH;
		return this._hashes.get(seq);
	}

	/** 再次扫描账本，修复尾部半行，并让内存索引追平。 */
	repair() {
		if (!this._opened || this._closed) {
			throw new LedgerError('E_LEDGER_CLOSED', 'ledger is not open');
		}
		const wasPoisoned = this._poisoned;
		const scan = this._scan({ repairTail: true });
		this._adoptScan(scan);
		this._syncCurrentFromScan(scan);
		// repair 会按磁盘真相重建 head/ids/segments，因此 poison（回滚失败留下的
		// 不一致内存态）在此刻已经不再成立。不解除的话，错误信息里建议的
		// 「close and open it again」在生产代码里没有任何调用点，writer 只能等重启。
		this._poisoned = null;
		if (scan.repair) this._repairs.push(scan.repair);
		this._openResult = {
			...this._openResult,
			segments: scan.segments.map((segment) => segment.name),
			eventCount: this._eventCount,
			head: { ...this._head },
			repair: scan.repair ?? this._openResult?.repair ?? null,
			repairs: [...this._repairs],
		};
		return {
			repair: scan.repair,
			repairs: [...this._repairs],
			head: { ...this._head },
			eventCount: this._eventCount,
			segments: scan.segments.map((segment) => segment.name),
			recoveredFromPoison: wasPoisoned !== null && wasPoisoned !== undefined,
			...(wasPoisoned === null || wasPoisoned === undefined ? {} : { poisonError: wasPoisoned }),
		};
	}

	/** 账本统计（文件列表 + 当前 head）。 */
	stats() {
		return {
			projectId: this.projectId,
			eventCount: this._eventCount,
			head: { ...this._head },
			segments: this._segments.map((segment) => ({
				...segment,
				bytes: this._fs.statSync(segment.path).size,
			})),
		};
	}

	/** 关闭写句柄并释放锁；已提交事件保持不变。 */
	close() {
		if (this._closed) return;
		this._closed = true;
		this._opened = false;
		if (this._current?.fd !== null && this._current?.fd !== undefined) {
			try {
				this._fs.closeSync(this._current.fd);
			} catch {
				// close 失败不改变已落盘事实。
			}
			this._current = { ...this._current, fd: null };
		}
		if (this.useLock) this._releaseLock();
		this._queue = Promise.resolve();
	}

	_resetForOpen() {
		if (!this._closed) return;
		this._closed = false;
		this._opened = false;
		this._current = null;
		this._segments = [];
		this._segmentCounts = new Map();
		this._hashes = new Map();
		this._ids = new Set();
		this._repairs = [];
		this._openResult = null;
	}

	_enqueue(job) {
		if (!this._opened || this._closed) {
			return Promise.reject(new LedgerError('E_LEDGER_CLOSED', 'ledger is not open'));
		}
		const run = this._queue.then(job, job);
		this._queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	_appendBatch(drafts) {
		if (this._closed) throw new LedgerError('E_LEDGER_CLOSED', 'ledger is closed');
		// poison 必须在**队列内**复核：appendMany 入口的检查发生在入队之前，
		// 同一 tick 内并发提交的两个批次会同时通过入口检查，先失败的那个把
		// writer 置为 poisoned 后，后一个已经排在队列里，仍会按旧 head 算出重复
		// seq 写进新段——账本此后永久打不开。
		if (this._poisoned !== null && this._poisoned !== undefined) {
			throw new LedgerError('E_LEDGER_POISONED',
				`ledger writer is unusable after a failed rollback (${this._poisoned}); close and open it again`, {
					rollbackError: this._poisoned,
				});
		}

		const plans = [];
		// 批内查重只用临时小集合；全局查重直接查 _ids（O(1)），避免每次
		// append 全量拷贝已存事件集合带来的平方级开销。
		const seenIds = new Set();
		const hasId = (id) => seenIds.has(id) || this._ids.has(id);
		let seq = this._head.seq;
		let prevHash = this._head.hash;

		for (const draft of drafts) {
			if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
				throw new LedgerError('E_EVENT_INVALID', 'each draft must be a plain object');
			}
			for (const key of Object.keys(draft)) {
				if (!DRAFT_FIELDS.has(key)) {
					throw new LedgerError('E_EVENT_FIELD', `draft has unknown field "${key}"`, { field: key });
				}
			}
			if (typeof draft.type !== 'string' || draft.type.length === 0) {
				throw new LedgerError('E_EVENT_INVALID', 'draft.type must be a non-empty string');
			}
			if (draft.projectId !== undefined && draft.projectId !== this.projectId) {
				throw new LedgerError('E_EVENT_PROJECT', 'draft.projectId does not match this ledger', {
					expected: this.projectId,
					actual: draft.projectId,
				});
			}
			if (draft.id !== undefined && typeof draft.id !== 'string') {
				throw new LedgerError('E_EVENT_ID', 'draft.id must be a string when present');
			}

			const at = draft.at ?? this._clock();
			const id = draft.id ?? newEventId(at);
			if (hasId(id)) {
				throw new LedgerError('E_DUPLICATE_ID', 'event id already exists in this ledger', { id });
			}
			seenIds.add(id);

			let event;
			try {
				event = sealEvent({
					v: draft.v ?? EVENT_VERSION,
					id,
					projectId: this.projectId,
					seq: seq + 1,
					type: draft.type,
					at,
					actor: draft.actor,
					correlationId: draft.correlationId,
					causationId: draft.causationId,
					payload: draft.payload,
					prevHash,
				});
			} catch (error) {
				if (error instanceof LedgerError) throw error;
				throw new LedgerError('E_EVENT_INVALID', `cannot seal event: ${error.message}`, {
					cause: error.message,
				});
			}

			const line = Buffer.from(serializeEvent(event), 'utf8');
			if (line.length > MAX_EVENT_BYTES) {
				throw new LedgerError('E_EVENT_TOO_LARGE', 'event exceeds the 256 KB limit', {
					bytes: line.length,
					limit: MAX_EVENT_BYTES,
					seq: event.seq,
				});
			}
			plans.push({ event, line });
			seq = event.seq;
			prevHash = event.hash;
		}

		const origin = { ...this._current };
		const counts = new Map(this._segmentCounts);
		const created = [];
		let segIndex = this._current.index;
		let segPath = this._current.path;
		let segName = this._current.name;
		let segFd = this._current.fd;
		let segSize = this._current.size;
		let segCount = this._current.count;

		try {
			for (const plan of plans) {
				const needRoll =
					segFd === null ||
					(segCount > 0 &&
						(segCount >= this.segmentEvents || segSize + plan.line.length > this.segmentBytes));
				if (needRoll) {
					if (segFd !== null) {
						// 落盘后再关闭旧段：closeSync 不保证刷盘，若旧段尾部整行
						// 只留在 OS 缓冲而崩溃丢失，新段首行的 prevHash/seq 将与
						// 截断后的旧段尾对不上，哈希链断裂且无法修复。
						if (this.fsync) this._fs.fsyncSync(segFd);
						this._fs.closeSync(segFd);
					}
					// 段号 = 磁盘上已存在段的最大编号 + 1（全新账本的第一段是 000001）。
					// 不能从 origin.index 推导：回滚失败会留下 fd=null 的当前段，
					// 而 origin.index 是「下一个待用编号」，据此新建会复用已存在的段号。
					const lastIndex = Math.max(
						created.length > 0 ? created[created.length - 1].index : 0,
						this._lastSegmentIndexOnDisk(),
					);
					segIndex = lastIndex + 1;
					segName = formatSegmentName(segIndex);
					segPath = path.join(this.dir, segName);
					segFd = this._fs.openSync(segPath, 'ax');
					segSize = 0;
					segCount = 0;
					created.push({ index: segIndex, name: segName, path: segPath });
				}
				writeAll(this._fs, segFd, plan.line);
				segSize += plan.line.length;
				segCount += 1;
				counts.set(segIndex, segCount);
			}

			if (this.fsync) this._fs.fsyncSync(segFd);
		} catch (writeError) {
			const rollbackError = this._rollback(origin, created, segFd);
			if (rollbackError) this._poisoned = rollbackError;
			if (writeError instanceof LedgerError) {
				if (rollbackError) writeError.details = { ...writeError.details, rollbackError };
				throw writeError;
			}
			throw new LedgerError('E_STORAGE', `ledger append failed: ${writeError.message}`, {
				sysCode: writeError.code ?? null,
				...(rollbackError ? { rollbackError } : {}),
			});
		}

		this._current = {
			index: segIndex,
			name: segName,
			path: segPath,
			fd: segFd,
			size: segSize,
			count: segCount,
		};
		this._segmentCounts = counts;
		this._head = { seq, hash: prevHash };
		this._eventCount += plans.length;
		for (const segment of created) this._segments.push(segment);
		for (const plan of plans) {
			this._hashes.set(plan.event.seq, plan.event.hash);
			this._ids.add(plan.event.id);
		}
		return plans.map((plan) => plan.event);
	}

	/**
	 * 回滚本批次写入：删除新建段，把原段 ftruncate 回写前长度。
	 * 返回错误描述（尽力而为，不抛出，避免掩盖原始写失败）。
	 */
	_rollback(origin, created, segFd) {
		let problem = null;
		if (segFd !== null && segFd !== undefined) {
			try {
				this._fs.closeSync(segFd);
			} catch (error) {
				problem = `close: ${error.message}`;
			}
		}
		for (let index = created.length - 1; index >= 0; index -= 1) {
			try {
				this._fs.unlinkSync(created[index].path);
			} catch (error) {
				problem = problem ?? `unlink: ${error.message}`;
			}
		}

		if (origin.fd !== null && origin.fd !== undefined) {
			try {
				// Windows 上 O_APPEND 句柄不能 ftruncate（EPERM），必须用 r+ 打开截断，
				// 成功后再用 a 重新打开为追加句柄。
				const truncateFd = this._fs.openSync(origin.path, 'r+');
				try {
					this._fs.ftruncateSync(truncateFd, origin.size);
					try {
						this._fs.fsyncSync(truncateFd);
					} catch {
						// fsync 本身失败时 truncate 已经是当前能做到的最好回滚。
					}
				} finally {
					this._fs.closeSync(truncateFd);
				}
				const fd = this._fs.openSync(origin.path, 'a');
				this._current = { ...origin, fd, size: origin.size, count: origin.count };
			} catch (error) {
				problem = problem ?? `truncate: ${error.message}`;
				this._current = { ...origin, fd: null };
			}
		} else {
			this._current = { ...origin, fd: null, size: 0, count: 0 };
		}
		return problem;
	}

	_adoptScan(scan) {
		this._segments = scan.segments;
		this._segmentCounts = new Map(scan.counts);
		this._hashes = new Map(scan.events.map((event) => [event.seq, event.hash]));
		this._ids = new Set(scan.events.map((event) => event.id));
		this._head = { ...scan.head };
		this._eventCount = scan.events.length;
	}

	_syncCurrentFromScan(scan) {
		if (scan.segments.length === 0) {
			// 空账本：**不要**预创建段文件——空段会被扫描当成可修复的尾段删掉，
			// 段号就跳到 2 了。fd 留空，首次 append 会按需创建 000001。
			this._current = {
				index: 1,
				name: formatSegmentName(1),
				path: path.join(this.dir, formatSegmentName(1)),
				fd: null,
				size: 0,
				count: 0,
			};
			return;
		}
		const last = scan.segments[scan.segments.length - 1];
		const reuseFd = this._current?.path === last.path ? this._current.fd : null;
		this._current = {
			...last,
			fd: reuseFd,
			size: this._fs.statSync(last.path).size,
			count: scan.counts.get(last.index) ?? 0,
		};
		this._reopenCurrent();
	}

	/** Re-open the current segment for append when the rollback left no usable fd. */
	_reopenCurrent() {
		if (this._current === null || this._current.fd !== null) return;
		try {
			this._current = {
				...this._current,
				fd: this._fs.openSync(this._current.path, 'a'),
			};
		} catch {
			// 段文件可能已被回滚删除；保持 fd=null，append 会按磁盘最大段号新建。
			this._current = { ...this._current, fd: null };
		}
	}

	/** Highest segment index that actually exists on disk (0 when the dir is empty). */
	_lastSegmentIndexOnDisk() {
		let max = 0;
		for (const segment of this._listSegments()) {
			if (segment.index > max) max = segment.index;
		}
		return max;
	}

	_listSegments() {
		let entries;
		try {
			entries = this._fs.readdirSync(this.dir, { withFileTypes: true });
		} catch (error) {
			if (error.code === 'ENOENT') return [];
			throw error;
		}

		const found = [];
		for (const entry of entries) {
			const name = typeof entry === 'string' ? entry : entry.name;
			const match = SEGMENT_PATTERN.exec(name);
			if (!match) continue;
			found.push({
				index: Number.parseInt(match[1], 10),
				name,
				path: path.join(this.dir, name),
			});
		}
		found.sort((left, right) => left.index - right.index);

		if (found.length === 0) return [];
		if (found[0].index !== 1) {
			throw new LedgerError('E_LEDGER_CORRUPT', 'ledger is missing segment 1', {
				reason: 'missing-segment',
				expected: 1,
				actual: found[0].index,
			});
		}
		for (let index = 0; index < found.length; index += 1) {
			if (found[index].index !== index + 1) {
				throw new LedgerError('E_LEDGER_CORRUPT', 'ledger segments are not contiguous', {
					reason: 'segment-gap',
					expected: index + 1,
					actual: found[index].index,
				});
			}
		}
		return found;
	}

	_scan(options = {}) {
		const repairTail = options.repairTail === true;
		const segments = this._listSegments();
		const events = [];
		const counts = new Map();
		const seenIds = new Set();
		let prevHash = GENESIS_HASH;
		let expectedSeq = 1;
		let repair = null;

		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index];
			const isLast = index === segments.length - 1;
			const buffer = this._fs.readFileSync(segment.path);

			if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
				throw new LedgerError('E_LEDGER_CORRUPT', 'ledger segment must not start with a UTF-8 BOM', {
					reason: 'bom',
					file: segment.name,
				});
			}

			let chunk = buffer;
			let truncatedBytes = 0;
			if (isLast && buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a) {
				if (!repairTail) {
					throw new LedgerError('E_LEDGER_TORN_TAIL', 'ledger has an incomplete last line', {
						file: segment.name,
						bytes: buffer.length,
					});
				}
				const cut = buffer.lastIndexOf(0x0a) + 1;
				truncatedBytes = buffer.length - cut;
				chunk = buffer.subarray(0, cut);
			}

			const text = chunk.toString('utf8');
			let lines = text.length === 0 ? [] : text.split('\n');
			if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

			for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
				const line = lines[lineIndex];
				if (line.trim() === '') {
					throw new LedgerError('E_LEDGER_CORRUPT', 'ledger contains an empty line', {
						reason: 'empty-line',
						file: segment.name,
						line: lineIndex + 1,
					});
				}
				let event;
				try {
					event = JSON.parse(line);
				} catch (error) {
					throw new LedgerError('E_LEDGER_CORRUPT', 'ledger line is not valid JSON', {
						reason: 'invalid-json',
						file: segment.name,
						line: lineIndex + 1,
						cause: error.message,
					});
				}
				const result = verifyEvent(event, {
					expectedSeq,
					expectedPrevHash: prevHash,
					projectId: this.projectId,
				});
				if (!result.ok) {
					const code = result.code === 'E_SEQ_GAP' ? 'E_SEQ_GAP' : 'E_LEDGER_CORRUPT';
					throw new LedgerError(code, `ledger verification failed: ${result.message}`, {
						file: segment.name,
						line: lineIndex + 1,
						...result,
					});
				}
				// 事件 id 是外部引用的唯一键：append 路径保证不重复，但双写者/外部
				// 合并/手工修复都可能造出重复 id。载入时静默折叠会让引用产生歧义，
				// 因此在这里按损坏账本处理（open 与 verify 都会报出来）。
				if (seenIds.has(event.id)) {
					throw new LedgerError('E_LEDGER_CORRUPT', 'ledger contains a duplicate event id', {
						reason: 'duplicate-id',
						file: segment.name,
						line: lineIndex + 1,
						id: event.id,
					});
				}
				seenIds.add(event.id);
				events.push(event);
				prevHash = event.hash;
				expectedSeq += 1;
			}

			counts.set(segment.index, lines.length);

			if (truncatedBytes > 0) {
				// 先完成本段全部行校验，确认不是中间损坏，再截断尾部半行。
				const fd = this._fs.openSync(segment.path, 'r+');
				try {
					this._fs.ftruncateSync(fd, buffer.length - truncatedBytes);
					this._fs.fsyncSync(fd);
				} finally {
					this._fs.closeSync(fd);
				}
				repair = {
					kind: 'torn-tail',
					file: segment.name,
					truncatedBytes,
					recoveredSeq: expectedSeq - 1,
					recoveredHash: prevHash,
				};
			}
		}

		return {
			events,
			counts,
			segments,
			head: { seq: expectedSeq - 1, hash: prevHash },
			repair,
		};
	}

	_acquireLock(repairs) {
		const lockPath = path.join(this.dir, LOCK_FILE);
		const takeoverPath = `${lockPath}.takeover`;

		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const fd = this._fs.openSync(lockPath, 'wx');
				try {
					const payload = {
						pid: process.pid,
						host: os.hostname(),
						startedAt: this._clock(),
						token: this._lockToken,
					};
					writeAll(this._fs, fd, Buffer.from(`${canonicalJson(payload)}\n`, 'utf8'));
					this._fs.fsyncSync(fd);
				} finally {
					this._fs.closeSync(fd);
				}
				return;
			} catch (error) {
				if (error.code !== 'EEXIST') {
					throw new LedgerError('E_STORAGE', `cannot create ledger lock: ${error.message}`, {
						sysCode: error.code ?? null,
					});
				}

				const existing = this._readLock(lockPath);
				// 锁在 fopen 与读取之间消失：没有锁可接管，直接重试创建。
				if (existing.error === 'missing') continue;
				if (!this._isStaleLock(existing.data, lockPath)) {
					throw new LedgerError('E_LOCKED', 'project ledger is locked by another writer', {
						pid: existing.data?.pid ?? null,
						host: existing.data?.host ?? null,
						startedAt: existing.data?.startedAt ?? null,
					});
				}
				if (attempt === 1) {
					throw new LedgerError('E_LOCKED', 'project ledger lock could not be taken over', {
						pid: existing.data?.pid ?? null,
					});
				}
				// 单赢家接管：只有成功创建 takeover 标记的进程可以删除陈旧锁。
				// 否则两个进程会各自"读到陈旧 → unlink → 新建"，把对方的活锁删掉。
				// 标记必须带所有者且可判陈旧：否则一次崩溃（或 unlink 失败）留下的
				// 空标记会让该项目**永久** E_LOCKED，只能手工删文件才能恢复。
				let held = false;
				for (let markerAttempt = 0; markerAttempt < 2 && !held; markerAttempt += 1) {
					try {
						const marker = this._fs.openSync(takeoverPath, 'wx');
						try {
							writeAll(this._fs, marker, Buffer.from(`${canonicalJson({ pid: process.pid, startedAt: this._clock() })}\n`, 'utf8'));
						} finally {
							this._fs.closeSync(marker);
						}
						held = true;
					} catch (markerError) {
						if (markerError.code !== 'EEXIST') {
							throw new LedgerError('E_LOCKED', `cannot create ledger takeover marker: ${markerError.message}`, {
								pid: existing.data?.pid ?? null,
								sysCode: markerError.code ?? null,
							});
						}
						// 陈旧标记（创建者已死或超时）直接回收，避免永久卡死。
						if (this._lockRecordAge(takeoverPath) > LOCK_WRITE_GRACE_MS) {
							try { this._fs.unlinkSync(takeoverPath); } catch { /* someone else reclaimed it */ }
							continue;
						}
						throw new LedgerError('E_LOCKED', 'another writer is taking over the ledger lock', {
							pid: existing.data?.pid ?? null,
						});
					}
				}
				if (!held) {
					throw new LedgerError('E_LOCKED', 'ledger takeover marker could not be acquired', {});
				}
				try {
					// 标记生效后重新读取：原主可能已经写完（或已被别人接管成新锁）。
					const fresh = this._readLock(lockPath);
					if (fresh.error !== 'missing' && !this._isStaleLock(fresh.data, lockPath)) {
						throw new LedgerError('E_LOCKED', 'ledger lock was refreshed by its owner during takeover', {
							pid: fresh.data?.pid ?? null,
						});
					}
					try {
						this._fs.unlinkSync(lockPath);
					} catch (unlinkError) {
						if (unlinkError.code !== 'ENOENT') {
							throw new LedgerError('E_LOCKED', `cannot remove stale ledger lock: ${unlinkError.message}`);
						}
					}
					repairs.push({
						kind: 'stale-lock',
						pid: existing.data?.pid ?? null,
						host: existing.data?.host ?? null,
						startedAt: existing.data?.startedAt ?? null,
						reason: existing.error ?? 'owner-not-running',
					});
				} finally {
					try {
						this._fs.unlinkSync(takeoverPath);
					} catch (markerCleanupError) {
						// 不静默：残留标记会被陈旧回收逻辑接管，但要在日志里留痕。
						if (markerCleanupError.code !== 'ENOENT') {
							console.warn(`[ai-team] ledger takeover marker could not be removed (${takeoverPath}): ${markerCleanupError.message}`);
						}
					}
				}
			}
		}
		throw new LedgerError('E_LOCKED', 'project ledger lock could not be acquired', {});
	}

	_readLock(lockPath) {
		try {
			const text = this._fs.readFileSync(lockPath, 'utf8');
			const data = JSON.parse(text);
			if (data === null || typeof data !== 'object') {
				return { data: null, error: 'invalid-lock-record' };
			}
			return { data, error: null };
		} catch (error) {
			if (error.code === 'ENOENT') return { data: null, error: 'missing' };
			return { data: null, error: error.name === 'SyntaxError' ? 'invalid-json' : error.message };
		}
	}

	/** Age of the on-disk lock record in ms; Infinity when it cannot be stat'd. */
	_lockRecordAge(lockPath) {
		try {
			return this._clock() - this._fs.statSync(lockPath).mtimeMs;
		} catch {
			return Number.POSITIVE_INFINITY;
		}
	}

	_isStaleLock(data, lockPath) {
		if (!data || !Number.isSafeInteger(data.pid) || data.pid <= 0) {
			// 锁创建与写入 payload 之间文件是 0 字节：无条件判陈旧会让并发进程
			// 接管一个仍然活着的锁。给写入一个宽限期，超时后才认为是崩溃残留。
			return this._lockRecordAge(lockPath) > LOCK_WRITE_GRACE_MS;
		}
		// 不同主机共享目录：无法用本机 PID 判断，保守视为仍持有。
		if (typeof data.host === 'string' && data.host.length > 0 && data.host !== os.hostname()) {
			return false;
		}
		return !isProcessAlive(data.pid);
	}

	_releaseLock() {
		const lockPath = path.join(this.dir, LOCK_FILE);
		try {
			const text = this._fs.readFileSync(lockPath, 'utf8');
			const data = JSON.parse(text);
			if (data?.token !== this._lockToken) return;
			this._fs.unlinkSync(lockPath);
		} catch {
			// 锁已不存在或已不是自己的：不要误删别人的锁。
		}
	}
}

/**
 * 稳定门面：打开账本、重放当前状态，并保证 append 成功后才推进 state。
 *
 * @param {object} options 透传 LedgerWriter 选项：dir/projectId/fsync/segmentBytes/segmentEvents/lock/fs/clock
 * @returns {{
 *   projectId: string,
 *   writer: LedgerWriter,
 *   state: object,
 *   events: object[],
 *   head: {seq:number,hash:string},
 *   append: (draft:object)=>Promise<object>,
 *   appendMany: (drafts:object[])=>Promise<object[]>,
 *   readAll: (options?:object)=>object[],
 *   replay: (state?:object)=>object,
 *   verify: ()=>object,
 *   repair: ()=>object,
 *   close: ()=>void
 * }}
 */
export function openLedger(options = {}) {
	const writer = new LedgerWriter(options);
	const opened = writer.open();
	// checkpoint 命中且账本与检查点齐平时，跳过全量 readAll（boot 的大头）：
	// state 直接取自检查点，events 惰性化（首次访问才读盘，append 只增新事件）。
	// 尾部存在时才需要一次 readAll 来续放投影。
	const checkpointOptions = options.checkpoint ?? null;
	const checkpointDir = checkpointOptions?.dir ?? writer.dir;
	const stateVersion = checkpointOptions?.stateVersion ?? FOLD_STATE_VERSION;
	let state;
	let recovery = null;
	let events = null;
	const ensureEvents = () => {
		if (events === null) events = writer.readAll({ repairTail: false });
		return events;
	};
	if (checkpointOptions) {
		const loaded = loadCheckpoint(checkpointDir, {
			stateVersion,
			hashAt: (seq) => writer.hashAt(seq),
		});
		if (loaded.checkpoint && loaded.checkpoint.lastSeq === writer.head.seq) {
			// 齐平：零尾放，账本事件列表不进内存。
			state = loaded.checkpoint.state;
			recovery = {
				source: loaded.source,
				fromSeq: loaded.checkpoint.lastSeq + 1,
				tailReplayed: 0,
				errors: loaded.errors,
			};
		} else {
			const fromSeq = loaded.checkpoint ? loaded.checkpoint.lastSeq + 1 : 1;
			state = loaded.checkpoint ? loaded.checkpoint.state : initialState();
			const all = ensureEvents();
			for (const event of all) {
				if (event.seq >= fromSeq) Object.assign(state, applyEvent(state, event));
			}
			recovery = {
				source: loaded.source ?? 'replay',
				fromSeq,
				tailReplayed: Math.max(0, writer.head.seq - fromSeq + 1),
				errors: loaded.errors,
			};
		}
	} else {
		events = writer.readAll({ repairTail: false });
		state = fold(events);
	}

	let onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
	// 检查点节奏：boot 后落一次地板，之后每 saveEvery 次追加落一次，close
	// 前必落——崩溃窗口最多丢 saveEvery 个事件的投影进度（账本本体无损）。
	const saveEvery = Number.isSafeInteger(checkpointOptions?.saveEvery)
		? Math.max(50, checkpointOptions.saveEvery)
		: 500;
	let eventsSinceCheckpoint = 0;
	const saveCheckpointNow = () => {
		if (!checkpointOptions) return null;
		try {
			// 水位取"fold 已应用前缀"而非 writer.head：跨调用交错下（B 批次可在
			// A 的 facade 续体推进 state 之前提交），head 可能领先 state——按
			// head 落盘会持久化一个 state 落后于 lastSeq 的检查点，崩溃重开时
			// 零尾放静默吞掉投影。state.lastSeq/lastHash 由 advance() 逐事件
			// 维护，永远 ≤ head，尾放从其 +1 重放天然自洽。
			return saveCheckpoint(
				checkpointDir,
				{ stateVersion, lastSeq: state.lastSeq, lastHash: state.lastHash, state },
				{ hashAt: (seq) => writer.hashAt(seq) },
			);
		} catch (error) {
			// 检查点保存失败绝不影响追加，但必须可见：静默失败会让检查点
			// 名存实亡（boot 退化为全量重放而无人知晓）。
			console.warn(`[ai-team] ledger ${writer.projectId} checkpoint save failed:`, error?.message ?? error);
			return { error: error.message ?? String(error) };
		}
	};
	if (checkpointOptions) {
		const saved = saveCheckpointNow();
		recovery.saved = saved && !saved.error ? saved.path : (saved?.error ?? null);
	}
	const ledger = {
		projectId: writer.projectId,
		writer,
		state,
		/** 账本事件全列表（checkpoint 模式下惰性读盘，append 持续追加）。 */
		get events() {
			return ensureEvents();
		},
		opened,
		get onEvent() {
			return onEvent;
		},
		set onEvent(handler) {
			onEvent = typeof handler === 'function' ? handler : null;
		},
		get head() {
			return { ...writer.head };
		},
		get headSeq() {
			return writer.head.seq;
		},
		async append(draft) {
			// 先齐平 events：checkpoint 齐平启动时 events 还是 null，若等 append 之后再
			// readAll，刚写入的事件会被读出来、再被 push 一次（重复）。
			const list = ensureEvents();
			const event = await writer.append(draft);
			// 只有 append 成功（含 fsync）后才推进内存状态。
			Object.assign(state, applyEvent(state, event));
			list.push(event);
			try {
				onEvent?.(event);
			} catch {
				/* a projection listener must never break the append */
			}
			if (checkpointOptions) {
				eventsSinceCheckpoint += 1;
				if (eventsSinceCheckpoint >= saveEvery) {
					eventsSinceCheckpoint = 0;
					saveCheckpointNow();
				}
			}
			return event;
		},
		async appendMany(drafts) {
			const list = ensureEvents();
			const appended = await writer.appendMany(drafts);
			let next = state;
			for (const event of appended) {
				next = applyEvent(next, event);
				list.push(event);
			}
			Object.assign(state, next);
			for (const event of appended) {
				try {
					onEvent?.(event);
				} catch {
					/* a projection listener must never break the append */
				}
			}
			if (checkpointOptions) {
				eventsSinceCheckpoint += appended.length;
				if (eventsSinceCheckpoint >= saveEvery) {
					eventsSinceCheckpoint = 0;
					saveCheckpointNow();
				}
			}
			return appended;
		},
		/** boot 时检查点恢复方式：'primary'/'backup'/'replay' 与尾放区间。 */
		get recovery() {
			return recovery;
		},
		readAll(readOptions = {}) {
			return writer.readAll(readOptions);
		},
		replay(from = initialState()) {
			return writer.replay(from, applyEvent);
		},
		verify() {
			try {
				const all = writer.readAll({ repairTail: false });
				const chain = verifyChain(all, { projectId: writer.projectId });
				return {
					ok: chain.ok,
					eventCount: all.length,
					head: writer.head,
					error: chain.ok
						? null
						: {
								code: chain.code,
								message: chain.message,
								details: chain.details ?? {},
								index: chain.index,
							},
				};
			} catch (error) {
				return {
					ok: false,
					eventCount: null,
					head: writer.head,
					error: {
						code: error.code ?? 'E_LEDGER_CORRUPT',
						message: error.message,
						details: error.details ?? {},
					},
				};
			}
		},
		repair() {
			return writer.repair();
		},
		close() {
			if (checkpointOptions) saveCheckpointNow();
			writer.close();
		},
	};

	return ledger;
}
