import test from 'node:test';
import assert from 'node:assert/strict';
import {
	acceptTask,
	assignTask,
	cancelTask,
	claimTask,
	createTask,
	deleteTask,
	reassignTask,
	releaseTask,
	reopenTask,
	requestChangesTask,
	submitTask,
} from '../lib/domain/task.js';
import { appendReply, createThread } from '../lib/domain/thread.js';
import { ackInboxItem, createInboxItem, inboxGroup, markAllRead } from '../lib/domain/inbox.js';
import { DomainError } from '../lib/domain/errors.js';

const human = { kind: 'human', memberId: 'h1' };
const a1 = { kind: 'agent', memberId: 'a1' };
const a2 = { kind: 'agent', memberId: 'a2' };

function make(overrides = {}) {
	return createTask({
		number: 1,
		title: '修复登录回归',
		resultDefinition: 'build 与 browser 门禁全绿',
		ownerId: 'a1',
		...overrides,
	}).task;
}

function expectCode(fn, code) {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof DomainError, 'expected DomainError');
		assert.equal(error.code, code);
		return true;
	});
}

test('create requires title, result definition and owner', () => {
	expectCode(() => createTask({ number: 1, title: '', resultDefinition: 'x', ownerId: 'a1' }), 'E_INVALID_ARGUMENT');
	expectCode(() => createTask({ number: 1, title: 'x', resultDefinition: '', ownerId: 'a1' }), 'E_INVALID_ARGUMENT');
	expectCode(() => createTask({ number: 1, title: 'x', resultDefinition: 'y', ownerId: '' }), 'E_INVALID_ARGUMENT');
	const task = make();
	assert.equal(task.status, 'pending');
	assert.equal(task.revision, 1);
	assert.deepEqual(task.claimHistory, []);
});

test('claim requires ready, unassigned, one in_progress per member; claimHistory is append-only', () => {
	let task = make();
	const claimed = claimTask(task, a1, {}, { expectedRevision: 1 });
	task = claimed.task;
	assert.equal(task.status, 'in_progress');
	assert.equal(task.assigneeId, 'a1');
	assert.deepEqual(task.claimHistory, ['a1']);
	assert.equal(task.revision, 2);

	expectCode(() => claimTask(task, a2, {}, { expectedRevision: 2 }), 'E_INVALID_STATE');

	const released = releaseTask(task, a1, { expectedRevision: 2, reason: '缺权限' });
	task = released.task;
	assert.equal(task.status, 'pending');
	assert.equal(task.assigneeId, null);
	assert.deepEqual(task.claimHistory, ['a1'], 'release must not clear claim history');
});

test('claim is blocked by dependencies and by another in_progress task', () => {
	const blocked = make({ blockedBy: ['dep'] });
	expectCode(() => claimTask(blocked, a1, { dep: { id: 'dep', status: 'in_progress' } }), 'E_TASK_BLOCKED');
	const busy = make();
	const other = { id: 'other', status: 'in_progress', assigneeId: 'a1' };
	expectCode(() => claimTask(busy, a1, { other }), 'E_CONFLICT');
});

test('submit requires evidence; independent reviewer can accept; claimant cannot', () => {
	let task = make();
	task = claimTask(task, a1, {}).task;
	expectCode(() => submitTask(task, a1, { summary: 'done', evidence: [] }), 'E_INVALID_ARGUMENT');
	const submitted = submitTask(task, a1, { summary: 'done', evidence: [{ kind: 'path', value: 'a.log' }] }, { expectedRevision: task.revision });
	task = submitted.task;
	assert.equal(task.status, 'pending_acceptance');
	expectCode(() => acceptTask(task, a1, { note: 'self' }), 'E_REVIEWER_NOT_ELIGIBLE');
	const accepted = acceptTask(task, a2, { note: 'verified' }, { expectedRevision: task.revision });
	assert.equal(accepted.task.status, 'done');
	assert.equal(accepted.task.reviewerId, 'a2');
	assert.equal(accepted.event.type, 'task/accepted');
});

test('request changes returns the task to in_progress and keeps history', () => {
	let task = make();
	task = claimTask(task, a1, {}).task;
	task = submitTask(task, a1, { summary: 'done', evidence: [{ kind: 'path', value: 'a.log' }] }).task;
	const changed = requestChangesTask(task, a2, { note: 'browser 8/8 失败' }, { expectedRevision: task.revision });
	assert.equal(changed.task.status, 'in_progress');
	assert.equal(changed.task.assigneeId, 'a1');
	assert.equal(changed.task.reviewRound, 1);
	assert.equal(changed.event.type, 'task/changes-requested');
});

test('Human self-accept is allowed but marked as human_self_accept', () => {
	let task = make();
	task = claimTask(task, human, {}).task;
	assert.equal(task.assigneeId, 'h1');
	task = submitTask(task, human, { summary: 'I fixed it', evidence: [{ kind: 'path', value: 'a.log' }] }).task;
	const accepted = acceptTask(task, human, { note: 'self-check' }, { expectedRevision: task.revision });
	assert.equal(accepted.task.status, 'done');
	assert.equal(accepted.event.type, 'review/human_self_accept');
	assert.equal(accepted.event.payload.selfExecuted, true);
});

test('irreversible task requires Human confirmation and rejects Agent acceptance', () => {
	let task = make({ irreversible: true });
	task = claimTask(task, a1, {}).task;
	task = submitTask(task, a1, { summary: 'merged', evidence: [{ kind: 'path', value: 'pr' }] }).task;
	expectCode(() => acceptTask(task, a2, { note: 'ok' }), 'E_IRREVERSIBLE_CONFIRM_REQUIRED');
	expectCode(() => acceptTask(task, human, { note: 'ok' }), 'E_IRREVERSIBLE_CONFIRM_REQUIRED');
	const accepted = acceptTask(task, human, { note: 'ok', confirmed: true }, { expectedRevision: task.revision });
	assert.equal(accepted.task.status, 'done');
});

test('owner/Human can cancel, reopen, reassign and delete under the stated bounds', () => {
	let task = make();
	expectCode(() => cancelTask(task, a2, { reason: 'x' }), 'E_UNAUTHORIZED');
	const cancelled = cancelTask(task, a1, { reason: '方向取消' }, { expectedRevision: 1 });
	assert.equal(cancelled.task.status, 'cancelled');
	expectCode(() => reopenTask(cancelled.task, a1, { reason: '重开' }), 'E_INVALID_STATE');

	let done = make();
	done = claimTask(done, a1, {}).task;
	done = submitTask(done, a1, { summary: 's', evidence: [{ kind: 'path', value: 'p' }] }).task;
	done = acceptTask(done, a2, { note: 'ok' }).task;
	expectCode(() => cancelTask(done, human, { reason: 'x' }), 'E_INVALID_STATE');
	const reopened = reopenTask(done, human, { reason: '回归' }, { expectedRevision: done.revision });
	assert.equal(reopened.task.status, 'in_progress');

	const reassigned = reassignTask(make(), human, 'a2', { reason: '换 owner' });
	assert.equal(reassigned.task.ownerId, 'a2');
	expectCode(() => deleteTask(make({ blockedBy: [] }), a2), 'E_UNAUTHORIZED');
	const deleted = deleteTask(make(), a1, { expectedRevision: 1 });
	assert.equal(deleted.task.status, 'pending');
	assert.equal(deleted.task.tombstone, true);
});

test('reopen with a retired assignee returns to pending and clears the assignee', () => {
	let task = make();
	task = claimTask(task, a1, {}).task;
	const submitted = submitTask(task, a1, { summary: 's', evidence: [{ kind: 'path', value: 'p' }] }).task;
	const reopened = reopenTask(submitted, human, {
		reason: '原执行者已退役',
		expectedRevision: submitted.revision,
		members: { a1: { id: 'a1', status: 'retired' } },
	});
	assert.equal(reopened.task.status, 'pending');
	assert.equal(reopened.task.assigneeId, null);
	assert.equal(reopened.event.payload.status, 'pending');
});

test('pre-assignment does not enter claimHistory; only claim does', () => {
	let task = make();
	task = assignTask(task, a1, 'a2').task;
	assert.equal(task.assigneeId, 'a2');
	assert.deepEqual(task.claimHistory, []);
	expectCode(() => claimTask(task, a1, {}), 'E_ALREADY_CLAIMED');
	const claimed = claimTask(task, a2, {}).task;
	assert.deepEqual(claimed.claimHistory, ['a2']);
});

test('a late Agent reply is accepted and reports what it missed; a reply ahead of the head is rejected', () => {
	// r09：会议里 5 名成员读同一个 head 后同时回帖，旧规则只放行第一条，其余反复
	// E_STALE_REPLY（一轮 46 次，「三次回帖均因会议并发被拒」）。迟到不等于错误。
	let thread = createThread('tsk_1');
	thread = appendReply(thread, { authorId: 'a1', baseSeq: 0, body: '第一条' }, { at: 1 }).thread;
	thread = appendReply(thread, { authorId: 'a2', baseSeq: 1, body: '第二条' }, { at: 2 }).thread;
	const late = appendReply(thread, { authorId: 'a3', baseSeq: 0, body: '旧回复' }, { at: 3 });
	assert.equal(late.thread.headSeq, 3);
	assert.equal(late.entry.baseSeq, 0, 'the entry records the head it was written against');
	assert.deepEqual(late.missed.map((entry) => entry.seq), [1, 2]);
	const current = appendReply(late.thread, { authorId: 'a1', baseSeq: 3, body: '最新' });
	assert.deepEqual(current.missed, []);
	expectCode(() => appendReply(thread, { authorId: 'a1', baseSeq: 9, body: '超前' }), 'E_INVALID_ARGUMENT');
});

test('inbox decision items cannot be bulk-read or done without a decision', () => {
	const decision = createInboxItem({ memberId: 'h1', type: 'decision_required', ref: { taskId: 't1' } });
	const update = createInboxItem({ memberId: 'h1', type: 'followed_task_update', ref: { taskId: 't1' } });
	const bulk = markAllRead([decision, update], { at: 1 });
	assert.equal(bulk.changed, 1);
	assert.equal(bulk.items[0].state, 'unread');
	assert.equal(bulk.items[1].state, 'read');
	const read = ackInboxItem(decision, { disposition: 'read' }, { at: 2 });
	assert.equal(read.state, 'read');
	expectCode(() => ackInboxItem(decision, { disposition: 'done' }), 'E_INVALID_STATE');
	const done = ackInboxItem(decision, { disposition: 'done', decision: 'approve' }, { at: 3 });
	assert.equal(done.state, 'resolved');
	assert.equal(inboxGroup(decision), 'needs_decision');
});
