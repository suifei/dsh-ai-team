/**
 * 账本事件信封、canonical JSON、哈希链与 ID 生成。
 *
 * 对应 03-架构设计报告 §6.2 / §6.5：
 * - 每行一个 JSON 对象，字段固定为 ENVELOPE_FIELDS。
 * - hash = sha256(canonicalJson(除 hash 之外的全部字段))，小写 hex。
 * - prevHash 指向前一事件的 hash；创世为 64 个 "0"。
 * - id 为 ULID（时间有序），外部引用用 id，排序用 seq。
 *
 * 本文件不做 I/O，也不理解事件语义；writer / fold / checkpoint 共用这里的
 * 序列化与校验规则，避免同一规则出现第二份实现。
 */

import { createHash, randomBytes } from 'node:crypto';

/** 信封结构版本。读到更高版本时由 writer 拒绝并提示升级。 */
export const EVENT_VERSION = 1;

/** 创世前一事件的 hash（64 个 0）。 */
export const GENESIS_HASH = '0'.repeat(64);

/** 单事件上限 256 KB（含行尾 \n，见 03 §6.2）。 */
export const MAX_EVENT_BYTES = 256 * 1024;

/** hash / prevHash 的格式：小写 sha256 hex。 */
export const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** 信封字段顺序（也是 JSON 示例中的展示顺序）。 */
export const ENVELOPE_FIELDS = Object.freeze([
	'v',
	'id',
	'projectId',
	'seq',
	'type',
	'at',
	'actor',
	'correlationId',
	'causationId',
	'payload',
	'prevHash',
	'hash',
]);

const ENVELOPE_FIELD_SET = new Set(ENVELOPE_FIELDS);
const ACTOR_KINDS = new Set(['human', 'agent', 'system']);
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_PREFIX_PATTERN = /^[a-z][a-z0-9]*_$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/;

/**
 * 全账本统一的错误类型。
 * code 是稳定的错误码（E_*），details 只放可序列化的诊断信息。
 */
export class LedgerError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'LedgerError';
		this.code = code;
		this.details = details;
	}
}

/** 是否为普通对象（拒绝 Date / Map / class 实例，保证 canonical JSON 无歧义）。 */
export function isPlainObject(value) {
	if (value === null || typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function fail(code, message, details = {}) {
	return { ok: false, code, message, details };
}

/**
 * 确定性 JSON（canonical JSON）：
 * - 对象键按 UTF-16 码元序升序；数组保持原序。
 * - 对象中值为 undefined 的键按 JSON 语义省略；数组中 undefined 变 null。
 * - 拒绝 NaN / Infinity / BigInt / 函数 / Symbol / 非普通对象 / 循环引用。
 * - 字符串使用 JSON.stringify 的转义，输出 UTF-8 文本。
 */
export function canonicalJson(value) {
	const stack = new Set();

	const encode = (input) => {
		if (input === null) return 'null';

		const type = typeof input;
		if (type === 'string') return JSON.stringify(input);
		if (type === 'boolean') return input ? 'true' : 'false';
		if (type === 'number') {
			if (!Number.isFinite(input)) {
				throw new TypeError('canonicalJson: non-finite numbers are not allowed');
			}
			return JSON.stringify(input);
		}

		if (type !== 'object') {
			throw new TypeError(`canonicalJson: unsupported value type "${type}"`);
		}

		if (stack.has(input)) {
			throw new TypeError('canonicalJson: circular reference');
		}
		stack.add(input);
		try {
			if (Array.isArray(input)) {
				const parts = input.map((item) => (item === undefined ? 'null' : encode(item)));
				return `[${parts.join(',')}]`;
			}
			if (!isPlainObject(input)) {
				throw new TypeError('canonicalJson: only plain objects and arrays are allowed');
			}
			const keys = Object.keys(input)
				.filter((key) => input[key] !== undefined)
				.sort();
			const parts = keys.map((key) => `${JSON.stringify(key)}:${encode(input[key])}`);
			return `{${parts.join(',')}}`;
		} finally {
			stack.delete(input);
		}
	};

	return encode(value);
}

/** sha256(text) 的小写 hex。 */
export function sha256Hex(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 计算事件 hash：对除 hash 外的全部字段取 canonical JSON 后 sha256。
 * 注意：不校验信封形状，只负责摘要；形状校验在 verifyEvent / sealEvent。
 */
export function hashEvent(event) {
	if (!isPlainObject(event)) {
		throw new TypeError('hashEvent: event must be a plain object');
	}
	const { hash: _ignored, ...rest } = event;
	return sha256Hex(canonicalJson(rest));
}

function normalizeActor(actor) {
	if (!isPlainObject(actor)) {
		throw new LedgerError('E_EVENT_ACTOR', 'event.actor must be a plain object');
	}
	for (const key of Object.keys(actor)) {
		if (key !== 'kind' && key !== 'memberId') {
			throw new LedgerError('E_EVENT_ACTOR', `event.actor has unknown field "${key}"`, { field: key });
		}
	}
	if (!ACTOR_KINDS.has(actor.kind)) {
		throw new LedgerError('E_EVENT_ACTOR', 'event.actor.kind must be human | agent | system', {
			kind: actor.kind,
		});
	}
	if (actor.kind === 'agent' && (typeof actor.memberId !== 'string' || actor.memberId.length === 0)) {
		throw new LedgerError('E_EVENT_ACTOR', 'agent actor requires a non-empty memberId');
	}
	if (actor.memberId !== undefined && typeof actor.memberId !== 'string') {
		throw new LedgerError('E_EVENT_ACTOR', 'event.actor.memberId must be a string when present');
	}
	return actor.memberId === undefined
		? { kind: actor.kind }
		: { kind: actor.kind, memberId: actor.memberId };
}

function validateEnvelope(event) {
	if (!isPlainObject(event)) return fail('E_EVENT_SHAPE', 'event must be a plain object');

	for (const key of Object.keys(event)) {
		if (!ENVELOPE_FIELD_SET.has(key)) {
			return fail('E_EVENT_FIELD', `event has unknown field "${key}"`, { field: key });
		}
	}
	for (const key of ENVELOPE_FIELDS) {
		if (!(key in event)) {
			return fail('E_EVENT_FIELD', `event is missing field "${key}"`, { field: key });
		}
	}

	if (!Number.isInteger(event.v) || event.v < 1) {
		return fail('E_EVENT_VERSION', 'event.v must be a positive integer', { v: event.v });
	}
	if (event.v !== EVENT_VERSION) {
		return fail('E_EVENT_VERSION', `unsupported event version ${event.v}`, {
			supported: EVENT_VERSION,
			actual: event.v,
		});
	}
	if (typeof event.id !== 'string' || event.id.length === 0) {
		return fail('E_EVENT_ID', 'event.id must be a non-empty string');
	}
	if (typeof event.projectId !== 'string' || event.projectId.length === 0) {
		return fail('E_EVENT_PROJECT', 'event.projectId must be a non-empty string');
	}
	if (!Number.isSafeInteger(event.seq) || event.seq < 1) {
		return fail('E_EVENT_SEQ', 'event.seq must be a positive safe integer', { seq: event.seq });
	}
	if (typeof event.type !== 'string' || !EVENT_TYPE_PATTERN.test(event.type)) {
		return fail('E_EVENT_TYPE', 'event.type must look like "<domain>/<name>"', { type: event.type });
	}
	if (!Number.isSafeInteger(event.at) || event.at < 0) {
		return fail('E_EVENT_AT', 'event.at must be a non-negative safe integer (epoch ms)', { at: event.at });
	}

	try {
		normalizeActor(event.actor);
	} catch (error) {
		return fail(error.code ?? 'E_EVENT_ACTOR', error.message, error.details ?? {});
	}

	if (event.correlationId !== null && typeof event.correlationId !== 'string') {
		return fail('E_EVENT_CORRELATION', 'event.correlationId must be a string or null');
	}
	if (event.causationId !== null && typeof event.causationId !== 'string') {
		return fail('E_EVENT_CAUSATION', 'event.causationId must be a string or null');
	}
	if (!isPlainObject(event.payload)) {
		return fail('E_EVENT_PAYLOAD', 'event.payload must be a plain object');
	}
	if (typeof event.prevHash !== 'string' || !HASH_PATTERN.test(event.prevHash)) {
		return fail('E_EVENT_PREV_HASH', 'event.prevHash must be 64 lowercase hex chars', {
			prevHash: event.prevHash,
		});
	}
	if (typeof event.hash !== 'string' || !HASH_PATTERN.test(event.hash)) {
		return fail('E_EVENT_HASH', 'event.hash must be 64 lowercase hex chars', { hash: event.hash });
	}
	return { ok: true };
}

/**
 * 生成 ULID 风格的 ID：`<prefix><10 字符时间><16 字符随机>`。
 * 前缀自带下划线（`evt_` / `cmd_` / `mem_`），时间部分为 48-bit 毫秒，
 * Crockford Base32；随机部分 80-bit。
 */
export function newId(prefix, now = Date.now()) {
	if (typeof prefix !== 'string' || !ID_PREFIX_PATTERN.test(prefix)) {
		throw new LedgerError('E_ID_PREFIX', 'id prefix must match /^[a-z][a-z0-9]*_$/', { prefix });
	}
	if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) {
		throw new LedgerError('E_ID_TIME', 'id timestamp must be a 48-bit non-negative integer', { now });
	}

	let time = now;
	const timeChars = new Array(10);
	for (let index = 9; index >= 0; index -= 1) {
		timeChars[index] = ULID_ALPHABET[time % 32];
		time = Math.floor(time / 32);
	}

	// 256 % 32 === 0，按字节取低 5 bit 无模偏差。
	const bytes = randomBytes(16);
	let randomChars = '';
	for (let index = 0; index < 16; index += 1) {
		randomChars += ULID_ALPHABET[bytes[index] % 32];
	}
	return `${prefix}${timeChars.join('')}${randomChars}`;
}

/** 生成事件 ID（`evt_` 前缀）。 */
export function newEventId(now = Date.now()) {
	return newId('evt_', now);
}

/**
 * 封事件：补默认字段、计算 hash，并返回“与落盘字节一致”的普通对象。
 *
 * 返回值经过 canonical JSON 往返，因此 undefined 字段已被省略 —— 内存中的
 * 事件与重新读盘得到的事件逐字段相等，避免检查点状态出现 JSON 往返差异。
 *
 * @param {object} fields 除 hash 外的信封字段；id/at/v/correlationId/causationId/payload/prevHash 可缺省。
 * @returns {object} 带 hash 的事件信封。
 */
export function sealEvent(fields = {}) {
	if (!isPlainObject(fields)) {
		throw new LedgerError('E_EVENT_SHAPE', 'sealEvent expects a plain object');
	}
	if ('hash' in fields) {
		throw new LedgerError('E_EVENT_HASH', 'sealEvent must not receive a hash; it is computed here');
	}
	for (const key of Object.keys(fields)) {
		if (!ENVELOPE_FIELD_SET.has(key) || key === 'hash') {
			throw new LedgerError('E_EVENT_FIELD', `sealEvent received unknown field "${key}"`, { field: key });
		}
	}

	const at = fields.at ?? Date.now();
	const envelope = {
		v: fields.v ?? EVENT_VERSION,
		id: fields.id ?? newEventId(at),
		projectId: fields.projectId,
		seq: fields.seq,
		type: fields.type,
		at,
		actor: normalizeActor(fields.actor),
		correlationId: fields.correlationId ?? null,
		causationId: fields.causationId ?? null,
		payload: fields.payload === undefined ? {} : fields.payload,
		prevHash: fields.prevHash ?? GENESIS_HASH,
	};

	let event;
	try {
		const hash = hashEvent(envelope);
		event = JSON.parse(canonicalJson({ ...envelope, hash }));
	} catch (error) {
		throw new LedgerError('E_EVENT_INVALID', `event is not canonical-JSON serializable: ${error.message}`, {
			cause: error.message,
		});
	}

	const check = validateEnvelope(event);
	if (!check.ok) {
		throw new LedgerError(check.code, check.message, check.details);
	}
	return event;
}

/**
 * 校验单个事件的信封与 hash（可同时校验链接位置）。
 * 返回 {ok:true} 或 {ok:false, code, message, details}；不抛异常。
 */
export function verifyEvent(event, options = {}) {
	const check = validateEnvelope(event);
	if (!check.ok) return check;

	let expectedHash;
	try {
		expectedHash = hashEvent(event);
	} catch (error) {
		return fail('E_EVENT_CANONICAL', `event cannot be canonicalized: ${error.message}`);
	}
	if (event.hash !== expectedHash) {
		return fail('E_HASH_MISMATCH', 'event hash does not match its content', {
			eventId: event.id,
			seq: event.seq,
			expected: expectedHash,
			actual: event.hash,
		});
	}

	if (options.expectedSeq !== undefined && event.seq !== options.expectedSeq) {
		return fail('E_SEQ_GAP', 'event seq is not the expected next seq', {
			eventId: event.id,
			expected: options.expectedSeq,
			actual: event.seq,
		});
	}
	if (options.expectedPrevHash !== undefined && event.prevHash !== options.expectedPrevHash) {
		return fail('E_HASH_CHAIN', 'event prevHash does not point at the previous event', {
			eventId: event.id,
			seq: event.seq,
			expected: options.expectedPrevHash,
			actual: event.prevHash,
		});
	}
	if (options.projectId !== undefined && event.projectId !== options.projectId) {
		return fail('E_EVENT_PROJECT', 'event belongs to a different project', {
			eventId: event.id,
			expected: options.projectId,
			actual: event.projectId,
		});
	}
	return { ok: true };
}

/**
 * 校验一段连续事件的 hash 链与 seq 连续性。
 * startPrevHash / startSeq 用于从检查点之后开始校验的场景。
 */
export function verifyChain(events, options = {}) {
	if (!Array.isArray(events)) {
		throw new TypeError('verifyChain: events must be an array');
	}
	let prevHash = options.startPrevHash ?? GENESIS_HASH;
	let seq = options.startSeq ?? 1;

	for (let index = 0; index < events.length; index += 1) {
		const result = verifyEvent(events[index], {
			expectedSeq: seq,
			expectedPrevHash: prevHash,
			projectId: options.projectId,
		});
		if (!result.ok) {
			return { ...result, index, eventId: events[index]?.id ?? null };
		}
		prevHash = events[index].hash;
		seq += 1;
	}
	return { ok: true, nextSeq: seq, lastHash: prevHash };
}

/** 事件落盘的唯一字节形式：canonical JSON + \n。 */
export function serializeEvent(event) {
	return `${canonicalJson(event)}\n`;
}
