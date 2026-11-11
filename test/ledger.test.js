import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	ENVELOPE_FIELDS,
	GENESIS_HASH,
	canonicalJson,
	hashEvent,
	newEventId,
	sealEvent,
	verifyChain,
	verifyEvent,
} from '../lib/ledger/events.js';
import { LOCK_FILE, LOCK_WRITE_GRACE_MS, LedgerWriter, openLedger } from '../lib/ledger/writer.js';
import {
	CHECKPOINT_BACKUP_FILE,
	CHECKPOINT_FILE,
	checkpointBackupPath,
	checkpointPath,
	loadCheckpoint,
	recoverCheckpoint,
	saveCheckpoint,
} from '../lib/ledger/checkpoint.js';
import {
	FOLD_STATE_VERSION,
	TASK_STATUS,
	applyEvent,
	fold,
	initialState,
	isEligibleReviewer,
	isTaskBlocked,
	replay,
} from '../lib/ledger/fold.js';
import { TeamService } from '../lib/host/service.js';

const PROJECT_ID = 'prj_ledger_test';
const BASE_AT = 1_760_000_000_000;

function tempLedger(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ledger-'));
	const writers = [];
	const track = (writer) => {
		writers.push(writer);
		return writer;
	};
	t.after(() => {
		for (const writer of writers) {
			try {
				writer.close();
			} catch {
				// 测试清理尽力而为。
			}
		}
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});
	return { dir, track };
}

function draft(type, payload = {}, extra = {}) {
	return { type, actor: { kind: 'system' }, payload, ...extra };
}

/** 生成一段 hash 链连续的 sealed events（测试夹具）。 */
function chain(projectId, specs) {
	let prevHash = GENESIS_HASH;
	let seq = 0;
	return specs.map((spec) => {
		seq += 1;
		const event = sealEvent({
			projectId,
			seq,
			type: spec.type,
			at: spec.at ?? BASE_AT + seq,
			actor: spec.actor ?? { kind: 'agent', memberId: 'mem_system' },
			correlationId: spec.correlationId ?? null,
			causationId: spec.causationId ?? null,
			payload: spec.payload ?? {},
			prevHash,
		});
		prevHash = event.hash;
		return event;
	});
}

const projectSpec = {
	type: 'project/created',
	payload: {
		name: 'Ledger Test',
		goal: 'verify ledger core',
		ownerMemberId: 'mem_a',
		workspacePath: 'E:/works/dsh-ai-team',
	},
};

function memberSpec(memberId, name, kind = 'agent') {
	return {
		type: 'project/member-added',
		payload: { memberId, name, kind, status: 'active' },
	};
}

test('canonical JSON 稳定；hash 覆盖除 hash 外全部字段', () => {
	assert.equal(canonicalJson({ b: 1, a: [true, null, '中'] }), '{"a":[true,null,"中"],"b":1}');
	assert.equal(canonicalJson({ a: undefined, b: 2 }), '{"b":2}');
	assert.equal(canonicalJson({ z: { b: 1, a: 2 } }), '{"z":{"a":2,"b":1}}');
	assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError);
	assert.throws(() => canonicalJson({ a: 1n }), TypeError);

	const fields = {
		id: 'evt_fixed',
		projectId: PROJECT_ID,
		seq: 1,
		type: 'project/created',
		at: BASE_AT,
		actor: { kind: 'human' },
		payload: { b: 1, a: 2 },
	};
	const first = sealEvent(fields);
	const second = sealEvent({ ...fields, payload: { a: 2, b: 1 } });
	assert.equal(first.hash, second.hash);
	assert.equal(first.hash, hashEvent(first));
	assert.match(first.hash, /^[0-9a-f]{64}$/);
	assert.equal(first.prevHash, GENESIS_HASH);
	assert.deepEqual(Object.keys(first).sort(), [...ENVELOPE_FIELDS].sort());
	assert.deepEqual(verifyEvent(first), { ok: true });
	assert.match(newEventId(), /^evt_[0-9A-HJKMNP-TV-Z]{26}$/);

	const tampered = { ...first, payload: { ...first.payload, b: 3 } };
	const result = verifyEvent(tampered);
	assert.equal(result.ok, false);
	assert.equal(result.code, 'E_HASH_MISMATCH');
});

test('append 三条后重开继续：seq 单调、分段与跨段 hash 链连续', async (t) => {
	const { dir, track } = tempLedger(t);
	const first = track(
		new LedgerWriter({ dir, projectId: PROJECT_ID, segmentEvents: 2, segmentBytes: 1_000_000 }),
	);
	const opened = first.open();
	assert.equal(opened.head.seq, 0);
	assert.equal(opened.eventCount, 0);

	const e1 = await first.append(draft('project/created', { name: 'P', goal: 'g' }));
	const e2 = await first.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	const e3 = await first.append(draft('task/created', { taskId: 'tsk_1', title: 'T' }));
	assert.deepEqual([e1.seq, e2.seq, e3.seq], [1, 2, 3]);
	assert.equal(e2.prevHash, e1.hash);
	assert.equal(e3.prevHash, e2.hash);
	assert.deepEqual(
		fs.readdirSync(dir).filter((name) => name.startsWith('ledger-')).sort(),
		['ledger-000001.jsonl', 'ledger-000002.jsonl'],
	);
	first.close();

	const second = track(new LedgerWriter({ dir, projectId: PROJECT_ID, segmentEvents: 2 }));
	const reopened = second.open();
	assert.equal(reopened.head.seq, 3);
	assert.equal(reopened.eventCount, 3);
	const all = second.readAll();
	assert.deepEqual(all.map((event) => event.seq), [1, 2, 3]);
	assert.equal(verifyChain(all, { projectId: PROJECT_ID }).ok, true);

	const e4 = await second.append(draft('stream/posted', { kind: 'milestone', body: 'continue' }));
	assert.equal(e4.seq, 4);
	assert.equal(e4.prevHash, e3.hash);
	assert.deepEqual(second.readAll().map((event) => event.seq), [1, 2, 3, 4]);
	second.close();
});

test('appendMany 在全新账本上跨多段时仍连续编号', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(
		new LedgerWriter({ dir, projectId: PROJECT_ID, segmentEvents: 1, segmentBytes: 1_000_000 }),
	);
	writer.open();
	const events = await writer.appendMany([
		draft('project/created', { name: 'P' }),
		draft('project/member-added', { memberId: 'mem_a', name: 'A' }),
		draft('task/created', { taskId: 'tsk_batch', title: 'Batch' }),
	]);
	assert.deepEqual(events.map((event) => event.seq), [1, 2, 3]);
	assert.deepEqual(
		fs.readdirSync(dir).filter((name) => name.startsWith('ledger-')).sort(),
		['ledger-000001.jsonl', 'ledger-000002.jsonl', 'ledger-000003.jsonl'],
	);
	assert.equal(writer.readAll().length, 3);
	assert.equal(verifyChain(writer.readAll(), { projectId: PROJECT_ID }).ok, true);
	writer.close();
});

test('账本被篡改 1 字节时 hash 链检出，且不会误当尾撕裂截断', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	writer.open();
	await writer.append(draft('stream/posted', { kind: 'milestone', body: 'alpha' }));
	await writer.append(draft('stream/posted', { kind: 'milestone', body: 'bravo' }));
	await writer.append(draft('stream/posted', { kind: 'milestone', body: 'charlie' }));
	writer.close();

	const file = path.join(dir, 'ledger-000001.jsonl');
	const buffer = fs.readFileSync(file);
	const offset = buffer.indexOf(Buffer.from('bravo'));
	assert.ok(offset > 0);
	buffer[offset] = buffer[offset] === 0x62 ? 0x63 : 0x62;
	fs.writeFileSync(file, buffer);
	const tamperedSize = fs.statSync(file).size;

	const bad = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	assert.throws(
		() => bad.open(),
		(error) => {
			assert.equal(error.code, 'E_LEDGER_CORRUPT');
			return true;
		},
	);
	assert.equal(fs.statSync(file).size, tamperedSize);
});

test('尾部半行被识别并修复，修复后 seq 从最后完整事件继续', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	await writer.append(draft('task/created', { taskId: 'tsk_1' }));
	writer.close();

	const file = path.join(dir, 'ledger-000001.jsonl');
	const buffer = fs.readFileSync(file);
	const cutBuffer = buffer.subarray(0, buffer.length - 10);
	const lastNewline = cutBuffer.lastIndexOf(0x0a);
	const expectedTruncated = cutBuffer.length - (lastNewline + 1);
	fs.writeFileSync(file, cutBuffer);

	const repairedWriter = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	const opened = repairedWriter.open();
	assert.equal(opened.head.seq, 2);
	assert.equal(opened.eventCount, 2);
	assert.ok(opened.repair);
	assert.equal(opened.repair.kind, 'torn-tail');
	assert.equal(opened.repair.truncatedBytes, expectedTruncated);
	assert.ok(opened.repair.truncatedBytes >= 10);
	assert.equal(opened.repair.recoveredSeq, 2);
	assert.equal(repairedWriter.readAll().length, 2);

	const next = await repairedWriter.append(draft('stream/posted', { kind: 'milestone', body: 'after' }));
	assert.equal(next.seq, 3);
	assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));
	assert.deepEqual(repairedWriter.readAll().map((event) => event.seq), [1, 2, 3]);
	repairedWriter.close();
});

test('readAll 在未 open 的只读句柄上也默认修复尾部半行', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	writer.close();

	const file = path.join(dir, 'ledger-000001.jsonl');
	const buffer = fs.readFileSync(file);
	fs.writeFileSync(file, buffer.subarray(0, buffer.length - 5));

	const reader = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	const events = reader.readAll();
	assert.equal(events.length, 1);
	assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));
	reader.close();
});

test('单写者锁生效；陈旧锁可被接管并记录修复', async (t) => {
	const { dir, track } = tempLedger(t);
	const first = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	first.open();
	const second = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	assert.throws(
		() => second.open(),
		(error) => {
			assert.equal(error.code, 'E_LOCKED');
			return true;
		},
	);
	first.close();
	assert.equal(fs.existsSync(path.join(dir, LOCK_FILE)), false);

	const lockPath = path.join(dir, LOCK_FILE);
	fs.writeFileSync(
		lockPath,
		`${JSON.stringify({ pid: 2 ** 30, host: os.hostname(), startedAt: 1 })}\n`,
	);
	const third = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	const opened = third.open();
	assert.ok(opened.repairs.some((repair) => repair.kind === 'stale-lock'));
	third.close();
	assert.equal(fs.existsSync(lockPath), false);
});

test('空锁记录在写入宽限期内不被接管，超过宽限期才视为崩溃残留', async (t) => {
	const { dir, track } = tempLedger(t);
	const lockPath = path.join(dir, LOCK_FILE);
	// 锁文件在写入 payload 之前就是 0 字节的正常形态。
	fs.writeFileSync(lockPath, '');
	const racing = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	assert.throws(
		() => racing.open(),
		(error) => error.code === 'E_LOCKED',
		'a live writer holds an empty lock record while writing its payload',
	);
	assert.equal(fs.existsSync(lockPath), true, 'takeover must not delete a lock inside the grace window');

	// 把 mtime 退到宽限期之外：此时才认定是崩溃残留。
	const past = new Date(Date.now() - LOCK_WRITE_GRACE_MS * 3);
	fs.utimesSync(lockPath, past, past);
	const recover = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	const opened = recover.open();
	assert.ok(opened.repairs.some((repair) => repair.kind === 'stale-lock'));
	recover.close();
});

test('接管标记存在时拒绝第二个接管者，避免互相删除活锁', async (t) => {
	const { dir, track } = tempLedger(t);
	const lockPath = path.join(dir, LOCK_FILE);
	fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 2 ** 30, host: os.hostname(), startedAt: 1 })}\n`);
	fs.writeFileSync(`${lockPath}.takeover`, '');
	const loser = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	assert.throws(
		() => loser.open(),
		(error) => error.code === 'E_LOCKED' && /taking over the ledger lock/.test(error.message),
	);
});

test('写入/fsync 失败回滚到写前长度，内存 head 不变且可继续写', async (t) => {
	const { dir, track } = tempLedger(t);
	const originalFsync = fs.fsyncSync.bind(fs);
	let fail = false;
	const faultyFs = {
		...fs,
		fsyncSync(fd) {
			if (fail) {
				const error = new Error('disk full');
				error.code = 'ENOSPC';
				throw error;
			}
			return originalFsync(fd);
		},
	};

	const writer = track(
		new LedgerWriter({ dir, projectId: PROJECT_ID, fs: faultyFs, lock: false }),
	);
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	const file = path.join(dir, 'ledger-000001.jsonl');
	const beforeSize = fs.statSync(file).size;
	const beforeHead = writer.head;

	fail = true;
	await assert.rejects(
		writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' })),
		(error) => {
			assert.equal(error.code, 'E_STORAGE');
			assert.equal(error.details.sysCode, 'ENOSPC');
			return true;
		},
	);
	fail = false;

	assert.equal(fs.statSync(file).size, beforeSize);
	assert.deepEqual(writer.head, beforeHead);
	assert.equal(writer.readAll().length, 1);
	const next = await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	assert.equal(next.seq, 2);
	writer.close();
});

test('fold：Task 全生命周期（含 delete tombstone 与失效 assignee reopen）', () => {
	const events = chain(PROJECT_ID, [
		projectSpec,
		memberSpec('mem_a', 'A'),
		memberSpec('mem_b', 'B'),
		memberSpec('mem_c', 'C'),
		memberSpec('mem_h', 'H', 'human'),
		{
			type: 'task/created',
			payload: {
				taskId: 'tsk_1',
				number: 1,
				title: 'Fix race',
				resultDefinition: 'tests pass',
				accountableOwnerId: 'mem_a',
			},
		},
		{
			type: 'task/claimed',
			actor: { kind: 'agent', memberId: 'mem_a' },
			payload: { taskId: 'tsk_1', revision: 2, assigneeId: 'mem_a' },
		},
		{
			type: 'task/released',
			actor: { kind: 'agent', memberId: 'mem_a' },
			payload: { taskId: 'tsk_1', revision: 3, reason: 'context' },
		},
		{
			type: 'task/assigned',
			actor: { kind: 'agent', memberId: 'mem_a' },
			payload: { taskId: 'tsk_1', revision: 4, assigneeId: 'mem_b', by: 'mem_a' },
		},
		{
			type: 'task/claimed',
			actor: { kind: 'agent', memberId: 'mem_b' },
			payload: { taskId: 'tsk_1', revision: 5, assigneeId: 'mem_b' },
		},
		{
			type: 'task/submitted',
			actor: { kind: 'agent', memberId: 'mem_b' },
			payload: {
				taskId: 'tsk_1',
				revision: 6,
				summary: 'ready',
				evidence: ['test.log'],
			},
		},
		{
			type: 'task/changes-requested',
			actor: { kind: 'agent', memberId: 'mem_c' },
			payload: { taskId: 'tsk_1', revision: 7, reviewerId: 'mem_c', note: 'add case' },
		},
		{
			type: 'task/submitted',
			actor: { kind: 'agent', memberId: 'mem_b' },
			payload: {
				taskId: 'tsk_1',
				revision: 8,
				summary: 'ready again',
				evidence: ['test.log', 'review.md'],
			},
		},
		{
			type: 'task/accepted',
			actor: { kind: 'agent', memberId: 'mem_c' },
			payload: { taskId: 'tsk_1', revision: 9, reviewerId: 'mem_c', note: 'ok' },
		},
		{
			type: 'task/reopened',
			actor: { kind: 'human' },
			payload: { taskId: 'tsk_1', revision: 10, reason: 'regression' },
		},
		{
			type: 'task/reassigned',
			actor: { kind: 'human' },
			payload: { taskId: 'tsk_1', revision: 11, from: 'mem_a', to: 'mem_c' },
		},
		{
			type: 'task/cancelled',
			actor: { kind: 'human' },
			payload: { taskId: 'tsk_1', revision: 12, reason: 'superseded' },
		},
		{
			type: 'task/created',
			payload: { taskId: 'tsk_2', number: 2, title: 'Never started' },
		},
		{
			type: 'task/deleted',
			actor: { kind: 'human' },
			payload: { taskId: 'tsk_2', revision: 2, reason: 'withdraw' },
		},
		{
			type: 'task/created',
			payload: { taskId: 'tsk_3', number: 3, title: 'Reopen with retired assignee' },
		},
		{
			type: 'task/claimed',
			actor: { kind: 'agent', memberId: 'mem_b' },
			payload: { taskId: 'tsk_3', revision: 2, assigneeId: 'mem_b' },
		},
		{
			type: 'task/submitted',
			actor: { kind: 'agent', memberId: 'mem_b' },
			payload: { taskId: 'tsk_3', revision: 3, summary: 'done', evidence: ['e2e.log'] },
		},
		{
			type: 'task/accepted',
			actor: { kind: 'agent', memberId: 'mem_c' },
			payload: { taskId: 'tsk_3', revision: 4, reviewerId: 'mem_c' },
		},
		{
			type: 'project/member-retired',
			payload: { memberId: 'mem_b', reason: 'left' },
		},
		{
			type: 'task/reopened',
			actor: { kind: 'human' },
			payload: { taskId: 'tsk_3', revision: 5, reason: 'recheck' },
		},
	]);

	let offset = 0;
	const next = () => events[offset++];
	let state = initialState();

	state = applyEvent(state, next());
	assert.equal(state.projects[PROJECT_ID].name, 'Ledger Test');
	assert.equal(state.projects[PROJECT_ID].ownerMemberId, 'mem_a');

	for (let index = 0; index < 4; index += 1) state = applyEvent(state, next());
	assert.equal(Object.keys(state.members).length, 4);
	assert.equal(state.members.mem_h.kind, 'human');

	state = applyEvent(state, next());
	let task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.PENDING);
	assert.equal(task.revision, 1);
	assert.equal(task.ownerId, 'mem_a');
	assert.equal(task.accountableOwnerId, 'mem_a');
	assert.deepEqual(task.claimHistory, []);
	assert.equal(task.humanExecuted, false);
	assert.equal(task.resultDefinition, 'tests pass');

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
	assert.equal(task.assigneeId, 'mem_a');
	assert.equal(task.revision, 2);
	assert.deepEqual(task.claimHistory, ['mem_a']);
	assert.equal(task.claimedAt !== null, true);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.PENDING);
	assert.equal(task.assigneeId, null);
	assert.equal(task.revision, 3);
	assert.deepEqual(task.claimHistory, ['mem_a']);
	assert.equal(task.releaseReason, 'context');

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	// 预分派不改变状态，也不进入 claimHistory（INV-07）。
	assert.equal(task.status, TASK_STATUS.PENDING);
	assert.equal(task.assigneeId, 'mem_b');
	assert.equal(task.revision, 4);
	assert.deepEqual(task.claimHistory, ['mem_a']);
	assert.equal(task.humanExecuted, false);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
	assert.equal(task.assigneeId, 'mem_b');
	assert.equal(task.revision, 5);
	assert.deepEqual(task.claimHistory, ['mem_a', 'mem_b']);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.PENDING_ACCEPTANCE);
	// 提交不递增 reviewRound；验收结论才递增。
	assert.equal(task.reviewRound, 0);
	assert.equal(task.summary, 'ready');
	assert.deepEqual(task.evidence, ['test.log']);
	assert.equal(task.reviewerId, null);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
	assert.equal(task.revision, 7);
	assert.equal(task.reviewRound, 1);
	assert.equal(task.reviewerId, 'mem_c');
	assert.equal(task.lastReview.verdict, 'changes_requested');
	assert.equal(task.lastReview.round, 1);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.PENDING_ACCEPTANCE);
	assert.equal(task.reviewRound, 1);
	assert.equal(task.reviewerId, null);
	assert.deepEqual(task.evidence, ['test.log', 'review.md']);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.DONE);
	assert.equal(task.revision, 9);
	assert.equal(task.reviewerId, 'mem_c');
	assert.equal(task.reviewRound, 2);
	assert.equal(task.lastReview.verdict, 'accepted');
	assert.equal(task.lastReview.round, 2);
	assert.ok(task.acceptedAt !== null);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
	assert.equal(task.assigneeId, 'mem_b');
	assert.equal(task.reopenedFrom, TASK_STATUS.DONE);
	assert.equal(task.revision, 10);
	assert.equal(task.reviewRound, 2);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.ownerId, 'mem_c');
	assert.equal(task.accountableOwnerId, 'mem_c');
	assert.equal(task.assigneeId, 'mem_b');
	assert.equal(task.status, TASK_STATUS.IN_PROGRESS);

	state = applyEvent(state, next());
	task = state.tasks.tsk_1;
	assert.equal(task.status, TASK_STATUS.CANCELLED);
	assert.equal(task.cancelReason, 'superseded');
	assert.deepEqual(task.claimHistory, ['mem_a', 'mem_b']);

	state = applyEvent(state, next());
	assert.equal(state.tasks.tsk_2.status, TASK_STATUS.PENDING);
	state = applyEvent(state, next());
	assert.equal(state.tasks.tsk_2.tombstone, true);
	assert.equal(state.tasks.tsk_2.status, TASK_STATUS.PENDING);
	assert.equal(state.tasks.tsk_2.tombstone, true);
	assert.ok(state.tasks.tsk_2.deletedAt !== null);

	state = applyEvent(state, next());
	state = applyEvent(state, next());
	assert.deepEqual(state.tasks.tsk_3.claimHistory, ['mem_b']);
	assert.equal(isEligibleReviewer(state, 'tsk_3', 'mem_b'), false);
	assert.equal(isEligibleReviewer(state, 'tsk_3', 'mem_a'), true);
	assert.equal(isEligibleReviewer(state, 'tsk_3', 'mem_c'), true);
	assert.equal(isEligibleReviewer(state, 'tsk_3', 'mem_h'), true);

	state = applyEvent(state, next());
	assert.equal(state.tasks.tsk_3.status, TASK_STATUS.PENDING_ACCEPTANCE);
	state = applyEvent(state, next());
	assert.equal(state.tasks.tsk_3.status, TASK_STATUS.DONE);
	assert.equal(state.tasks.tsk_3.reviewRound, 1);
	assert.equal(state.tasks.tsk_3.reviewerId, 'mem_c');

	state = applyEvent(state, next());
	assert.equal(state.members.mem_b.status, 'retired');
	state = applyEvent(state, next());
	task = state.tasks.tsk_3;
	assert.equal(task.status, TASK_STATUS.PENDING);
	assert.equal(task.assigneeId, null);
	assert.equal(task.reopenedFrom, TASK_STATUS.DONE);
	assert.equal(task.reviewRound, 1);
	assert.equal(isEligibleReviewer(state, 'tsk_3', 'mem_b'), false);
	assert.equal(isTaskBlocked(state, task), false);
	assert.equal(offset, events.length);
});

test('纯 fold 并发 claim：同 revision 只有先到者成功', () => {
	const setup = [
		projectSpec,
		memberSpec('mem_a', 'A'),
		memberSpec('mem_b', 'B'),
		{ type: 'task/created', payload: { taskId: 'tsk_race', title: 'Race' } },
	];
	const claim = (memberId) => ({
		type: 'task/claimed',
		actor: { kind: 'agent', memberId },
		payload: { taskId: 'tsk_race', revision: 2, assigneeId: memberId },
	});

	const left = fold(chain(PROJECT_ID, [...setup, claim('mem_a'), claim('mem_b')]));
	assert.equal(left.tasks.tsk_race.assigneeId, 'mem_a');
	assert.equal(left.tasks.tsk_race.revision, 2);
	assert.deepEqual(left.tasks.tsk_race.claimHistory, ['mem_a']);

	const right = fold(chain(PROJECT_ID, [...setup, claim('mem_b'), claim('mem_a')]));
	assert.equal(right.tasks.tsk_race.assigneeId, 'mem_b');
	assert.equal(right.tasks.tsk_race.revision, 2);
	assert.deepEqual(right.tasks.tsk_race.claimHistory, ['mem_b']);
});

test('Thread headSeq 单调：baseSeq 不回退 headSeq，重复 seq 不追加', () => {
	const events = chain(PROJECT_ID, [
		projectSpec,
		{
			type: 'task/created',
			payload: { taskId: 'tsk_thread', title: 'Thread', blockedBy: ['tsk_missing'] },
		},
		{
			type: 'thread/posted',
			payload: { taskId: 'tsk_thread', seq: 1, baseSeq: 0, authorId: 'mem_a', body: 'one' },
		},
		{
			type: 'thread/posted',
			payload: { taskId: 'tsk_thread', seq: 2, baseSeq: 1, authorId: 'mem_b', body: 'two' },
		},
		{
			type: 'thread/posted',
			payload: { taskId: 'tsk_thread', seq: 3, baseSeq: 5, authorId: 'mem_a', body: 'three' },
		},
		{
			type: 'thread/posted',
			payload: { taskId: 'tsk_thread', seq: 2, baseSeq: 1, authorId: 'mem_b', body: 'duplicate' },
		},
	]);

	const state = fold(events);
	const thread = state.threads.tsk_thread;
	assert.equal(thread.headSeq, 3);
	assert.deepEqual(thread.entries.map((entry) => entry.seq), [1, 2, 3]);
	assert.deepEqual(thread.entries.map((entry) => entry.baseSeq), [0, 1, 5]);
	assert.equal(thread.entries[thread.entries.length - 1].authorId, 'mem_a');
	assert.equal(isTaskBlocked(state, 'tsk_thread'), true);
	// 已应用事件再次 apply 返回原引用。
	assert.equal(applyEvent(state, events[2]), state);
});

test('同一事件重放幂等；未知事件返回原引用', () => {
	const events = chain(PROJECT_ID, [
		projectSpec,
		memberSpec('mem_a', 'A'),
		{ type: 'task/created', payload: { taskId: 'tsk_replay', title: 'Replay' } },
		{
			type: 'thread/posted',
			payload: { taskId: 'tsk_replay', seq: 1, baseSeq: 0, authorId: 'mem_a', body: 'hi' },
		},
	]);
	const once = fold(events);
	const twice = fold(events, once);
	assert.deepEqual(twice, once);
	assert.equal(twice, once);
	assert.deepEqual(replay(events), once);

	const unknown = sealEvent({
		projectId: PROJECT_ID,
		seq: once.lastSeq + 1,
		type: 'custom/unknown',
		at: BASE_AT + 100,
		actor: { kind: 'system' },
		payload: { note: 'ignored' },
		prevHash: once.lastHash,
	});
	assert.equal(applyEvent(once, unknown), once);
	assert.equal(applyEvent(once, events[0]), once);
	assert.equal(fold([], once), once);
});

test('checkpoint 原子保存/加载一致；损坏回退备份，再坏全量重放', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P', goal: 'g' }));
	await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	await writer.append(draft('task/created', { taskId: 'tsk_cp', title: 'Checkpoint' }));

	const full3 = fold(writer.readAll());
	const firstSave = saveCheckpoint(dir, {
		stateVersion: FOLD_STATE_VERSION,
		lastSeq: writer.head.seq,
		lastHash: writer.head.hash,
		state: full3,
	});
	assert.equal(firstSave.backedUp, false);
	assert.ok(fs.existsSync(checkpointPath(dir)));
	assert.deepEqual(
		fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')),
		[],
	);

	const loaded = loadCheckpoint(dir, {
		stateVersion: FOLD_STATE_VERSION,
		hashAt: (seq) => writer.hashAt(seq),
	});
	assert.equal(loaded.source, 'primary');
	assert.deepEqual(loaded.checkpoint.state, full3);
	assert.equal(loaded.checkpoint.lastSeq, 3);
	assert.deepEqual(
		Object.keys(loaded.checkpoint).sort(),
		['lastHash', 'lastSeq', 'state', 'stateVersion', 'v'],
	);
	assert.equal(fs.existsSync(path.join(dir, CHECKPOINT_FILE)), true);

	const recovered = recoverCheckpoint({
		dir,
		writer,
		stateVersion: FOLD_STATE_VERSION,
		apply: applyEvent,
		initialState: initialState(),
	});
	assert.equal(recovered.source, 'primary');
	assert.equal(recovered.replayed, 0);
	assert.deepEqual(recovered.state, full3);

	const secondSave = saveCheckpoint(dir, {
		stateVersion: FOLD_STATE_VERSION,
		lastSeq: writer.head.seq,
		lastHash: writer.head.hash,
		state: full3,
	});
	assert.equal(secondSave.backedUp, true);
	assert.ok(fs.existsSync(checkpointBackupPath(dir)));

	await writer.append(draft('stream/posted', { kind: 'milestone', body: 'tail' }));
	const full4 = fold(writer.readAll());
	const tailRecovered = recoverCheckpoint({
		dir,
		writer,
		stateVersion: FOLD_STATE_VERSION,
		apply: applyEvent,
		initialState: initialState(),
	});
	assert.equal(tailRecovered.replayed, 1);
	assert.deepEqual(tailRecovered.state, full4);

	fs.writeFileSync(checkpointPath(dir), '{"v":1');
	const fallback = loadCheckpoint(dir, {
		stateVersion: FOLD_STATE_VERSION,
		hashAt: (seq) => writer.hashAt(seq),
	});
	assert.equal(fallback.source, 'backup');
	assert.ok(fallback.errors.some((error) => error.source === 'primary' && error.code === 'E_CHECKPOINT_PARSE'));

	const backupRecovered = recoverCheckpoint({
		dir,
		writer,
		stateVersion: FOLD_STATE_VERSION,
		apply: applyEvent,
		initialState: initialState(),
	});
	assert.equal(backupRecovered.source, 'backup');
	assert.deepEqual(backupRecovered.state, full4);

	fs.rmSync(checkpointPath(dir), { force: true });
	fs.rmSync(checkpointBackupPath(dir), { force: true });
	const replayRecovered = recoverCheckpoint({
		dir,
		writer,
		stateVersion: FOLD_STATE_VERSION,
		apply: applyEvent,
		initialState: initialState(),
	});
	assert.equal(replayRecovered.source, 'replay');
	assert.equal(replayRecovered.replayed, 4);
	assert.deepEqual(replayRecovered.state, full4);
	writer.close();
});

test('checkpoint lastHash 与账本不一致时被拒绝并触发全量重放', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	const full = fold(writer.readAll());

	assert.throws(
		() =>
			saveCheckpoint(
				dir,
				{
					stateVersion: FOLD_STATE_VERSION,
					lastSeq: writer.head.seq,
					lastHash: 'f'.repeat(64),
					state: full,
				},
				{ hashAt: (seq) => writer.hashAt(seq) },
			),
		(error) => {
			assert.equal(error.code, 'E_CHECKPOINT_HASH');
			return true;
		},
	);
	// 不传 hashAt 时只做结构校验（用于构造“被外部写坏”的样本）。
	saveCheckpoint(dir, {
		stateVersion: FOLD_STATE_VERSION,
		lastSeq: writer.head.seq,
		lastHash: 'f'.repeat(64),
		state: full,
	});
	const loaded = loadCheckpoint(dir, {
		stateVersion: FOLD_STATE_VERSION,
		hashAt: (seq) => writer.hashAt(seq),
	});
	assert.equal(loaded.checkpoint, null);
	assert.ok(loaded.errors.some((error) => error.code === 'E_CHECKPOINT_HASH'));

	const recovered = recoverCheckpoint({
		dir,
		writer,
		stateVersion: FOLD_STATE_VERSION,
		apply: applyEvent,
		initialState: initialState(),
	});
	assert.equal(recovered.source, 'replay');
	assert.equal(recovered.replayed, 2);
	assert.deepEqual(recovered.state, full);
	writer.close();
});

test('openLedger 门面：append 成功才推进 state，重开后状态一致', async (t) => {
	const { dir } = tempLedger(t);
	const ledger = openLedger({ dir, projectId: PROJECT_ID, segmentEvents: 2 });
	assert.deepEqual(ledger.state, initialState());
	assert.equal(ledger.events.length, 0);

	// 验证调用方提前解构 state 也能看到后续更新（门面保持同一对象引用）。
	const liveState = ledger.state;
	const created = await ledger.append({
		type: 'project/created',
		actor: { kind: 'human' },
		payload: { name: 'P', goal: 'g', ownerMemberId: 'mem_a' },
	});
	assert.equal(created.seq, 1);
	assert.equal(liveState.projects[PROJECT_ID].name, 'P');

	await ledger.appendMany([
		draft('project/member-added', { memberId: 'mem_a', name: 'A' }),
		draft('task/created', {
			taskId: 'tsk_facade',
			title: 'Facade',
			accountableOwnerId: 'mem_a',
		}),
	]);
	const task = ledger.state.tasks.tsk_facade;
	assert.equal(task.ownerId, 'mem_a');
	assert.equal(task.accountableOwnerId, 'mem_a');
	assert.equal(task.humanExecuted, false);
	assert.equal(ledger.events.length, 3);
	assert.equal(ledger.head.seq, 3);
	assert.equal(ledger.headSeq, 3);
	assert.equal(ledger.verify().ok, true);
	assert.equal(ledger.repair().head.seq, 3);
	ledger.close();

	const reopened = openLedger({ dir, projectId: PROJECT_ID, segmentEvents: 2 });
	assert.deepEqual(reopened.state, ledger.state);
	assert.equal(reopened.events.length, 3);
	assert.equal(reopened.verify().ok, true);
	reopened.close();
});

test('fold：stream / inbox 投影与 ack 终态幂等', () => {
	const events = chain(PROJECT_ID, [
		projectSpec,
		{ type: 'stream/posted', payload: { kind: 'milestone', body: 'hi' } },
		{
			type: 'inbox/item-created',
			payload: {
				itemId: 'inb_1',
				memberId: 'mem_a',
				type: 'mention',
				ref: { taskId: 'tsk_x' },
				requiresDecision: false,
			},
		},
		{ type: 'inbox/acked', payload: { itemId: 'inb_1', memberId: 'mem_a', disposition: 'read' } },
		{ type: 'inbox/acked', payload: { itemId: 'inb_1', memberId: 'mem_a', disposition: 'done' } },
		{ type: 'inbox/acked', payload: { itemId: 'inb_1', memberId: 'mem_a', disposition: 'read' } },
	]);

	const state = fold(events);
	assert.equal(state.stream.length, 1);
	assert.equal(state.stream[0].projectId, PROJECT_ID);
	assert.equal(state.stream[0].kind, 'milestone');
	assert.equal(state.stream[0].body, 'hi');
	assert.equal(state.inbox.inb_1.state, 'done');
	assert.equal(state.inbox.inb_1.disposition, 'done');
	// 终态后 ack 不覆盖（A-INV-09）。
	assert.equal(state.inbox.inb_1.ackedAt, events[4].at);
});

test('ledger.onEvent fires after state is updated', async (t) => {
	const { dir } = tempLedger(t);
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const seen = [];
	ledger.onEvent = (event) => seen.push({ seq: event.seq, hasState: ledger.state.stream?.length ?? 0 });
	await ledger.append({
		type: 'stream/posted',
		payload: { kind: 'human_message', authorId: 'h1', body: 'hello', at: BASE_AT },
		actor: { kind: 'human', memberId: 'h1' },
		projectId: PROJECT_ID,
		at: BASE_AT,
	});
	assert.deepEqual(seen, [{ seq: 1, hasState: 1 }]);
});

test('fold 可直接重放 host service/domain 写入的快照事件', async (t) => {
	const { dir } = tempLedger(t);
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const service = new TeamService({ ledger, now: () => BASE_AT });
	const human = { kind: 'human', memberId: 'h1' };
	const agent1 = { kind: 'agent', memberId: 'a1' };
	const agent2 = { kind: 'agent', memberId: 'a2' };

	await service.dispatch({
		type: 'project.create',
		actor: human,
		payload: { id: PROJECT_ID, name: 'P', goal: 'g', ownerId: 'h1' },
	});
	assert.equal(ledger.state.projects[PROJECT_ID].name, 'P');
	assert.equal(ledger.state.projects[PROJECT_ID].ownerId, 'h1');

	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: 'A' } });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a2', name: 'B' } });
	await service.dispatch({
		type: 'member.add',
		actor: human,
		payload: { id: 'h1', name: 'Human', kind: 'human' },
	});
	assert.equal(ledger.state.humanMemberId, 'h1');
	assert.equal(ledger.state.members.a1.kind, 'agent');

	const created = await service.dispatch({
		type: 'task.create',
		actor: human,
		projectId: PROJECT_ID,
		payload: { title: 'Fix race', resultDefinition: 'tests pass' },
	});
	let task = ledger.state.tasks[created.task.id];
	assert.equal(task.status, TASK_STATUS.PENDING);
	assert.equal(task.ownerId, 'h1');
	assert.deepEqual(task.claimHistory, []);
	assert.equal(task.revision, 1);

	const claimed = await service.dispatch({
		type: 'task.claim',
		actor: agent1,
		projectId: PROJECT_ID,
		payload: { taskId: created.task.id, expectedRevision: 1 },
	});
	task = ledger.state.tasks[created.task.id];
	assert.equal(task.status, TASK_STATUS.IN_PROGRESS);
	assert.equal(task.assigneeId, 'a1');
	assert.equal(task.revision, claimed.task.revision);
	assert.deepEqual(task.claimHistory, ['a1']);

	await service.dispatch({
		type: 'task.submit',
		actor: agent1,
		projectId: PROJECT_ID,
		payload: {
			taskId: created.task.id,
			expectedRevision: 2,
			summary: 'done',
			evidence: [{ kind: 'path', value: 'a.log' }],
		},
	});
	task = ledger.state.tasks[created.task.id];
	assert.equal(task.status, TASK_STATUS.PENDING_ACCEPTANCE);
	assert.equal(task.reviewRound, 0);
	assert.deepEqual(task.evidence, [{ kind: 'path', value: 'a.log' }]);

	await service.dispatch({
		type: 'task.accept',
		actor: agent2,
		projectId: PROJECT_ID,
		payload: { taskId: created.task.id, expectedRevision: 3, note: 'ok' },
	});
	task = ledger.state.tasks[created.task.id];
	assert.equal(task.status, TASK_STATUS.DONE);
	assert.equal(task.reviewerId, 'a2');
	assert.equal(task.reviewRound, 1);
	assert.equal(task.lastReview.verdict, 'accepted');

	await service.dispatch({
		type: 'thread.post',
		actor: agent2,
		projectId: PROJECT_ID,
		payload: { taskId: created.task.id, baseSeq: 0, body: 'verified' },
	});
	const thread = ledger.state.threads[created.task.id];
	assert.equal(thread.headSeq, 1);
	assert.equal(thread.entries[0].body, 'verified');
	assert.equal(thread.entries[0].authorId, 'a2');

	const item = await service.notify(
		{ memberId: 'h1', type: 'mention', ref: { taskId: created.task.id } },
		{ actor: { kind: 'system' }, projectId: PROJECT_ID },
	);
	assert.equal(ledger.state.inbox[item.id].state, 'unread');
	await service.dispatch({
		type: 'inbox.ack',
		actor: human,
		projectId: PROJECT_ID,
		payload: { itemId: item.id, disposition: 'read' },
	});
	assert.equal(ledger.state.inbox[item.id].state, 'read');

	const doomed = await service.dispatch({
		type: 'task.create',
		actor: human,
		projectId: PROJECT_ID,
		payload: { title: 'Doomed', resultDefinition: 'x' },
	});
	await service.dispatch({
		type: 'task.delete',
		actor: human,
		projectId: PROJECT_ID,
		payload: { taskId: doomed.task.id, expectedRevision: 1 },
	});
	assert.equal(ledger.state.tasks[doomed.task.id].status, TASK_STATUS.PENDING);
	assert.equal(ledger.state.tasks[doomed.task.id].tombstone, true);
	assert.equal(ledger.state.tasks[doomed.task.id].tombstone, true);

	const bootstrap = service.bootstrap(PROJECT_ID);
	assert.ok(bootstrap.tasks.every((entry) => entry.id !== doomed.task.id));
	assert.ok(bootstrap.tasks.some((entry) => entry.id === created.task.id));
	assert.ok(bootstrap.members.some((member) => member.id === 'a1' && member.kind === 'agent'));

	// 检查点必须能保存/恢复同一份快照投影（含 JSON 往返）。
	const snapshot = ledger.state;
	saveCheckpoint(
		dir,
		{
			stateVersion: FOLD_STATE_VERSION,
			lastSeq: ledger.head.seq,
			lastHash: ledger.head.hash,
			state: snapshot,
		},
		{ hashAt: (seq) => ledger.writer.hashAt(seq) },
	);
	ledger.close();

	const checkpointWriter = new LedgerWriter({ dir, projectId: PROJECT_ID });
	checkpointWriter.open();
	const recovered = recoverCheckpoint({
		dir,
		writer: checkpointWriter,
		stateVersion: FOLD_STATE_VERSION,
		apply: applyEvent,
		initialState: initialState(),
	});
	assert.equal(recovered.source, 'primary');
	assert.equal(recovered.replayed, 0);
	assert.deepEqual(recovered.state, snapshot);
	checkpointWriter.close();
});

test('checkpoint 状态自述水位与账本水位不一致时被拒绝', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));
	const full = fold(writer.readAll());
	assert.equal(full.lastSeq, writer.head.seq, 'fold state carries its own watermark');
	assert.throws(
		() =>
			saveCheckpoint(
				dir,
				{
					stateVersion: FOLD_STATE_VERSION,
					lastSeq: writer.head.seq,
					lastHash: writer.hashAt(writer.head.seq),
					// 投影被截断/错位而外层水位仍然有效
					state: { ...full, lastSeq: full.lastSeq - 1 },
				},
				{ hashAt: (seq) => writer.hashAt(seq) },
			),
		(error) => {
			assert.equal(error.code, 'E_CHECKPOINT_STATE_MISMATCH');
			return true;
		},
	);
	writer.close();
});

test('回滚本身失败时把 writer 置为 poisoned，后续写入必须重新 open', async (t) => {
	const { dir, track } = tempLedger(t);
	const original = { fsyncSync: fs.fsyncSync.bind(fs), openSync: fs.openSync.bind(fs) };
	let failWrite = false;
	let failTruncate = false;
	const faultyFs = {
		...fs,
		fsyncSync(fd) {
			if (failWrite) {
				const error = new Error('disk full');
				error.code = 'ENOSPC';
				throw error;
			}
			return original.fsyncSync(fd);
		},
		openSync(target, flags, ...rest) {
			// 回滚路径用 'r+' 打开原段做 ftruncate；让它失败 → 回滚不完整。
			if (failTruncate && flags === 'r+') {
				const error = new Error('EPERM: cannot truncate');
				error.code = 'EPERM';
				throw error;
			}
			return original.openSync(target, flags, ...rest);
		},
	};
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID, fs: faultyFs, lock: false }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	const beforeHead = writer.head;

	failWrite = true;
	failTruncate = true;
	await assert.rejects(
		writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' })),
		(error) => {
			assert.equal(error.code, 'E_STORAGE');
			assert.match(String(error.details?.rollbackError ?? ''), /truncate|EPERM/);
			return true;
		},
	);
	assert.deepEqual(writer.head, beforeHead, 'head must not advance on a failed append');

	failWrite = false;
	failTruncate = false;
	// 回滚不完整：本句柄不可继续写，避免把新事件追加到未知状态之后。
	await assert.rejects(
		writer.append(draft('project/member-added', { memberId: 'mem_b', name: 'B' })),
		(error) => error.code === 'E_LEDGER_POISONED',
	);
});

test('当前段 fd 丢失时按磁盘最大段号续写，不会复用已存在的段号', async (t) => {
	const { dir, track } = tempLedger(t);
	const writer = track(new LedgerWriter({ dir, projectId: PROJECT_ID, lock: false }));
	writer.open();
	await writer.append(draft('project/created', { name: 'P' }));
	const firstSegment = path.join(dir, 'ledger-000001.jsonl');
	assert.equal(fs.existsSync(firstSegment), true);

	// 模拟「回滚失败留下 fd=null 的当前段」：段文件仍在，句柄不可用。
	writer._current = { ...writer._current, fd: null };
	await writer.append(draft('project/member-added', { memberId: 'mem_a', name: 'A' }));

	const segments = fs.readdirSync(dir).filter((name) => /^ledger-\d{6}\.jsonl$/.test(name)).sort();
	assert.deepEqual(segments, ['ledger-000001.jsonl', 'ledger-000002.jsonl']);
	assert.equal(writer.head.seq, 2);
	assert.equal(writer.readAll().length, 2);
	writer.close();
});