/**
 * 检查点：{ v, stateVersion, lastSeq, lastHash, state } 的原子保存/加载/备份/校验。
 *
 * 对应 03-架构设计报告 §6.4 / §6.5 / §6.7、附录 B §B.3.6-4：
 * - 原子写：同目录 tmp → fsync → rename 覆盖 checkpoint.json。
 * - 备份：覆盖前把上一份“有效”检查点复制为 checkpoint.bak.json。
 * - 加载：JSON/结构/stateVersion/lastSeq+lastHash 全部校验；失败回退备份，
 *   再失败由 recoverCheckpoint 从 seq 1 全量重放。
 * - 检查点绝不领先账本：lastHash 必须等于账本中 lastSeq 行的事件 hash。
 */

import fsDefault from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
	GENESIS_HASH,
	HASH_PATTERN,
	LedgerError,
	canonicalJson,
	isPlainObject,
} from './events.js';

export const CHECKPOINT_VERSION = 1;
export const CHECKPOINT_FILE = 'checkpoint.json';
export const CHECKPOINT_BACKUP_FILE = 'checkpoint.bak.json';

/** <dataDir>/checkpoint.json */
export function checkpointPath(dir) {
	return path.join(dir, CHECKPOINT_FILE);
}

/** <dataDir>/checkpoint.bak.json */
export function checkpointBackupPath(dir) {
	return path.join(dir, CHECKPOINT_BACKUP_FILE);
}

function invalid(code, message, details = {}) {
	return { ok: false, code, message, details };
}

function writeAll(fs, fd, buffer) {
	let offset = 0;
	while (offset < buffer.length) {
		const written = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
		if (!Number.isFinite(written) || written <= 0) throw new Error('short write');
		offset += written;
	}
}

function writeAtomic(fs, filePath, text) {
	const fd = fs.openSync(filePath, 'wx');
	try {
		writeAll(fs, fd, Buffer.from(text, 'utf8'));
		fs.fsyncSync(fd);
	} catch (error) {
		try {
			fs.closeSync(fd);
		} catch {
			// 忽略清理失败。
		}
		try {
			fs.unlinkSync(filePath);
		} catch {
			// 忽略清理失败。
		}
		throw error;
	}
	fs.closeSync(fd);
}

function fsyncDirectory(fs, dir) {
	// Windows 不支持对目录 fsync；这是 best-effort，不影响 rename 的原子性。
	try {
		const fd = fs.openSync(dir, 'r');
		try {
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		// EPERM / EISDIR / EINVAL：忽略。
	}
}

/**
 * 校验检查点结构与版本。返回 {ok:true} 或 {ok:false, code, message, details}。
 * options.stateVersion 给定时要与检查点一致（不一致即丢弃重放）。
 */
export function validateCheckpoint(checkpoint, options = {}) {
	if (!isPlainObject(checkpoint)) {
		return invalid('E_CHECKPOINT_INVALID', 'checkpoint must be a plain object');
	}
	if (checkpoint.v !== CHECKPOINT_VERSION) {
		return invalid('E_CHECKPOINT_VERSION', 'unsupported checkpoint version', {
			supported: CHECKPOINT_VERSION,
			actual: checkpoint.v,
		});
	}
	if (!Number.isSafeInteger(checkpoint.stateVersion) || checkpoint.stateVersion < 1) {
		return invalid('E_CHECKPOINT_INVALID', 'checkpoint.stateVersion must be a positive integer', {
			stateVersion: checkpoint.stateVersion,
		});
	}
	if (
		options.stateVersion !== undefined &&
		checkpoint.stateVersion !== options.stateVersion
	) {
		return invalid('E_CHECKPOINT_STATE_VERSION', 'checkpoint stateVersion does not match the fold', {
			expected: options.stateVersion,
			actual: checkpoint.stateVersion,
		});
	}
	if (!Number.isSafeInteger(checkpoint.lastSeq) || checkpoint.lastSeq < 0) {
		return invalid('E_CHECKPOINT_INVALID', 'checkpoint.lastSeq must be a non-negative integer', {
			lastSeq: checkpoint.lastSeq,
		});
	}
	if (typeof checkpoint.lastHash !== 'string' || !HASH_PATTERN.test(checkpoint.lastHash)) {
		return invalid('E_CHECKPOINT_INVALID', 'checkpoint.lastHash must be 64 lowercase hex chars', {
			lastHash: checkpoint.lastHash,
		});
	}
	if (checkpoint.lastSeq === 0 && checkpoint.lastHash !== GENESIS_HASH) {
		return invalid('E_CHECKPOINT_INVALID', 'seq 0 checkpoint must carry the genesis hash');
	}
	if (checkpoint.lastSeq > 0 && checkpoint.lastHash === GENESIS_HASH) {
		return invalid('E_CHECKPOINT_INVALID', 'non-empty checkpoint cannot carry the genesis hash');
	}
	if (!isPlainObject(checkpoint.state)) {
		return invalid('E_CHECKPOINT_INVALID', 'checkpoint.state must be a plain object');
	}
	return { ok: true };
}

function hashMatches(checkpoint, hashAt) {
	if (typeof hashAt !== 'function') return true;
	try {
		const expected = checkpoint.lastSeq === 0 ? GENESIS_HASH : hashAt(checkpoint.lastSeq);
		return typeof expected === 'string' && expected === checkpoint.lastHash;
	} catch {
		return false;
	}
}

/**
 * 原子保存检查点，并把上一份有效检查点备份为 checkpoint.bak.json。
 *
 * @param {string} dir
 * @param {{stateVersion:number,lastSeq:number,lastHash:string,state:object}} input
 * @param {{fs?:object,hashAt?:(seq:number)=>string|undefined}} [options]
 *   hashAt 用于在备份前确认旧检查点仍与账本一致；不一致则保留更旧的备份。
 * @returns {{path:string,bytes:number,backedUp:boolean,backupPath:string,backupError:string|null}}
 */
export function saveCheckpoint(dir, input, options = {}) {
	const fs = options.fs ?? fsDefault;
	if (typeof dir !== 'string' || dir.length === 0) {
		throw new LedgerError('E_INVALID_OPTION', 'saveCheckpoint requires a directory');
	}
	if (!isPlainObject(input)) {
		throw new LedgerError('E_CHECKPOINT_INVALID', 'saveCheckpoint expects a checkpoint object');
	}

	const checkpoint = {
		v: CHECKPOINT_VERSION,
		stateVersion: input.stateVersion,
		lastSeq: input.lastSeq,
		lastHash: input.lastHash,
		state: input.state,
	};
	const validation = validateCheckpoint(checkpoint, { stateVersion: input.stateVersion });
	if (!validation.ok) {
		throw new LedgerError(validation.code, validation.message, validation.details);
	}
	// 调用方给了账本 hashAt 时，拒绝保存“检查点领先账本”的错误快照。
	if (!hashMatches(checkpoint, options.hashAt)) {
		throw new LedgerError('E_CHECKPOINT_HASH', 'checkpoint.lastHash does not match the ledger', {
			lastSeq: checkpoint.lastSeq,
			lastHash: checkpoint.lastHash,
		});
	}

	let text;
	try {
		text = `${canonicalJson(checkpoint)}\n`;
	} catch (error) {
		throw new LedgerError('E_CHECKPOINT_INVALID', `checkpoint is not JSON serializable: ${error.message}`, {
			cause: error.message,
		});
	}

	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (error) {
		throw new LedgerError('E_STORAGE', `cannot create checkpoint directory: ${error.message}`, {
			sysCode: error.code ?? null,
		});
	}

	const primary = checkpointPath(dir);
	const backup = checkpointBackupPath(dir);
	const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`;
	const temp = path.join(dir, `.checkpoint.${suffix}.tmp`);

	try {
		writeAtomic(fs, temp, text);
	} catch (error) {
		throw new LedgerError('E_STORAGE', `cannot write checkpoint temp file: ${error.message}`, {
			sysCode: error.code ?? null,
		});
	}

	let backedUp = false;
	let backupError = null;
	if (fs.existsSync(primary)) {
		try {
			const previousText = fs.readFileSync(primary, 'utf8');
			const previous = JSON.parse(previousText);
			// 只有结构有效、且（给了 hashAt 时）与账本对得上的旧检查点才值得备份。
			if (validateCheckpoint(previous).ok && hashMatches(previous, options.hashAt)) {
				const backupTemp = path.join(dir, `.checkpoint-bak.${suffix}.tmp`);
				writeAtomic(fs, backupTemp, previousText.endsWith('\n') ? previousText : `${previousText}\n`);
				fs.renameSync(backupTemp, backup);
				backedUp = true;
			}
		} catch (error) {
			// 旧检查点损坏时不要覆盖已有的好备份。
			backupError = error.message;
		}
	}

	try {
		fs.renameSync(temp, primary);
	} catch (error) {
		try {
			fs.unlinkSync(temp);
		} catch {
			// 忽略清理失败。
		}
		throw new LedgerError('E_STORAGE', `cannot install checkpoint: ${error.message}`, {
			sysCode: error.code ?? null,
		});
	}
	fsyncDirectory(fs, dir);

	return {
		path: primary,
		bytes: Buffer.byteLength(text, 'utf8'),
		backedUp,
		backupPath: backup,
		backupError,
	};
}

/**
 * 加载检查点：先 primary，再 backup；每一步都校验结构与 lastHash。
 * 不抛“损坏”异常（I/O 之外的损坏都记入 errors）；调用方据 source=null 决定重放。
 *
 * @returns {{checkpoint:object|null,source:'primary'|'backup'|null,errors:object[]}}
 */
export function loadCheckpoint(dir, options = {}) {
	const fs = options.fs ?? fsDefault;
	const errors = [];
	const sources = [
		['primary', checkpointPath(dir)],
		['backup', checkpointBackupPath(dir)],
	];

	for (const [source, file] of sources) {
		let text;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch (error) {
			errors.push({
				source,
				file,
				code: error.code ?? 'E_STORAGE',
				reason: error.code === 'ENOENT' ? 'missing' : error.message,
			});
			continue;
		}

		let checkpoint;
		try {
			checkpoint = JSON.parse(text);
		} catch (error) {
			errors.push({
				source,
				file,
				code: 'E_CHECKPOINT_PARSE',
				reason: error.message,
			});
			continue;
		}

		const validation = validateCheckpoint(checkpoint, { stateVersion: options.stateVersion });
		if (!validation.ok) {
			errors.push({
				source,
				file,
				code: validation.code,
				reason: validation.message,
				details: validation.details,
			});
			continue;
		}

		if (!hashMatches(checkpoint, options.hashAt)) {
			errors.push({
				source,
				file,
				code: 'E_CHECKPOINT_HASH',
				reason: 'checkpoint.lastHash does not match the ledger at lastSeq',
				details: {
					lastSeq: checkpoint.lastSeq,
					lastHash: checkpoint.lastHash,
				},
			});
			continue;
		}

		return { checkpoint, source, errors };
	}

	return { checkpoint: null, source: null, errors };
}

/**
 * 恢复：加载检查点并重放尾部；检查点不可用时从 seq 1 全量重放。
 * 返回的 lastSeq/lastHash 以账本 head 为准，不从检查点“继承”。
 *
 * @param {{
 *   dir:string,
 *   writer:import('./writer.js').LedgerWriter,
 *   stateVersion:number,
 *   apply:(state:object,event:object)=>object,
 *   initialState:object,
 *   save?:boolean,
 *   fs?:object
 * }} options
 */
export function recoverCheckpoint(options) {
	const { dir, writer, stateVersion, apply, initialState: emptyState, save = false } = options;
	const fs = options.fs ?? fsDefault;
	if (!writer || typeof writer.replay !== 'function' || typeof writer.hashAt !== 'function') {
		throw new LedgerError('E_INVALID_OPTION', 'recoverCheckpoint requires an open ledger writer');
	}
	if (typeof apply !== 'function') {
		throw new LedgerError('E_INVALID_OPTION', 'recoverCheckpoint requires apply(state,event)');
	}
	if (!isPlainObject(emptyState)) {
		throw new LedgerError('E_INVALID_OPTION', 'recoverCheckpoint requires an initialState object');
	}

	const loaded = loadCheckpoint(dir, {
		fs,
		stateVersion,
		hashAt: (seq) => writer.hashAt(seq),
	});

	const checkpoint = loaded.checkpoint;
	const fromSeq = checkpoint ? checkpoint.lastSeq + 1 : 1;
	const startState = checkpoint ? checkpoint.state : emptyState;
	const state = writer.replay(startState, apply, { fromSeq });
	const replayed = Math.max(0, writer.head.seq - (fromSeq - 1));

	const result = {
		state,
		source: loaded.source ?? 'replay',
		checkpoint,
		fromSeq,
		replayed,
		lastSeq: writer.head.seq,
		lastHash: writer.head.hash,
		errors: loaded.errors,
		saved: null,
	};

	if (save) {
		result.saved = saveCheckpoint(
			dir,
			{
				stateVersion,
				lastSeq: writer.head.seq,
				lastHash: writer.head.hash,
				state,
			},
			{
				fs,
				hashAt: (seq) => writer.hashAt(seq),
			},
		);
	}

	return result;
}
