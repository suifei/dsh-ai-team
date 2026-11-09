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
import { applyEvent, fold, initialState } from './fold.js';

export { LedgerError };

/** 默认分段阈值（03 §6.5：32 MB 或 50,000 事件先到为准）。 */
export const DEFAULT_SEGMENT_EVENTS = 50_000;
export const DEFAULT_SEGMENT_BYTES = 32 * 1024 * 1024;

export const SEGMENT_PATTERN = /^ledger-(\d{6})\.jsonl$/;
export const LOCK_FILE = 'lock';

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
		const scan = this._scan({ repairTail: true });
		this._adoptScan(scan);
		this._syncCurrentFromScan(scan);
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

		const plans = [];
		const seenIds = new Set(this._ids);
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
			if (seenIds.has(id)) {
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
					if (segFd !== null) this._fs.closeSync(segFd);
					// 段号 = 上一个已存在段的编号 + 1；全新账本的第一段仍是 000001。
					const lastIndex =
						created.length > 0
							? created[created.length - 1].index
							: origin.fd !== null
								? origin.index
								: origin.index - 1;
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
				const stale = this._isStaleLock(existing.data);
				if (!stale) {
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
				try {
					this._fs.unlinkSync(lockPath);
				} catch (unlinkError) {
					throw new LedgerError('E_LOCKED', `cannot remove stale ledger lock: ${unlinkError.message}`);
				}
				repairs.push({
					kind: 'stale-lock',
					pid: existing.data?.pid ?? null,
					host: existing.data?.host ?? null,
					startedAt: existing.data?.startedAt ?? null,
					reason: existing.error ?? 'owner-not-running',
				});
			}
		}
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

	_isStaleLock(data) {
		if (!data || !Number.isSafeInteger(data.pid) || data.pid <= 0) return true;
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
	const events = writer.readAll({ repairTail: false });
	const state = fold(events);

	let onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
	const ledger = {
		projectId: writer.projectId,
		writer,
		state,
		events,
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
			const event = await writer.append(draft);
			// 只有 append 成功（含 fsync）后才推进内存状态。
			Object.assign(state, applyEvent(state, event));
			events.push(event);
			try {
				onEvent?.(event);
			} catch {
				/* a projection listener must never break the append */
			}
			return event;
		},
		async appendMany(drafts) {
			const appended = await writer.appendMany(drafts);
			let next = state;
			for (const event of appended) {
				next = applyEvent(next, event);
				events.push(event);
			}
			Object.assign(state, next);
			for (const event of appended) {
				try {
					onEvent?.(event);
				} catch {
					/* a projection listener must never break the append */
				}
			}
			return appended;
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
			writer.close();
		},
	};

	return ledger;
}
