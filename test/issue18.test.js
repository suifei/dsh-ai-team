import test from 'node:test';
import assert from 'node:assert/strict';
import { PMO_DISPATCH_LIMIT, planDispatch, planTaskNudges } from '../lib/host/pmo.js';
import { classifyLlmFailure, retryDecision } from '../lib/runtime/failure-policy.js';
import { FOLD_STATE_VERSION, applyEvent, initialState, isHumanIntent } from '../lib/ledger/fold.js';

// #18（0.4.91 审计）逐条复核后确认的缺陷。每条都先用 il2c 实账本量化过（.ptc/rounds/r27）。

const MINUTE = 60_000;
const now = 10_000_000;

const state = {
	members: {
		lead: { id: 'lead', kind: 'agent', status: 'running', sessionId: 's-lead' },
		maker: { id: 'maker', kind: 'agent', status: 'running', sessionId: 's-maker' },
		gone: { id: 'gone', kind: 'agent', status: 'retired', sessionId: 's-gone' },
		h1: { id: 'h1', kind: 'human' },
	},
};
const pending = { id: 't1', status: 'pending', ownerId: 'lead', assigneeId: 'maker' };
const idle = () => false;

test('pending re-dispatch judges busy by the live turn, not the ledger projection that never leaves running', () => {
	// 账本投影里两人都是 running（session-bound 之后永远如此）——旧判定因此从不补派。
	assert.equal(planDispatch(pending, state, { inTurn: idle, now }), 'maker', 'assignee first');
	assert.equal(planDispatch({ ...pending, assigneeId: null }, state, { inTurn: idle, now }), 'lead', 'owner when unassigned');
	assert.equal(planDispatch(pending, state, { inTurn: (id) => id === 's-maker', now }), null, 'a member mid-turn is not interrupted');
	assert.equal(planDispatch({ ...pending, assigneeId: 'gone' }, state, { inTurn: idle, now }), null, 'retired members are not woken');
	assert.equal(planDispatch({ ...pending, status: 'in_progress' }, state, { inTurn: idle, now }), null);
	assert.equal(planDispatch({ ...pending, tombstone: true }, state, { inTurn: idle, now }), null);
});

test('re-dispatch is bounded: at most once a minute and PMO_DISPATCH_LIMIT times per card', () => {
	assert.equal(planDispatch(pending, state, { inTurn: idle, now, last: { at: now - 30_000, count: 1 } }), null, 'within the minute');
	assert.equal(planDispatch(pending, state, { inTurn: idle, now, last: { at: now - MINUTE, count: PMO_DISPATCH_LIMIT - 1 } }), 'maker');
	assert.equal(planDispatch(pending, state, { inTurn: idle, now, last: { at: 0, count: PMO_DISPATCH_LIMIT } }), null, 'cap reached: stall/escalate take over');
});

test('a card awaiting acceptance is nudged for review whether or not it requires QA', () => {
	for (const qaRequired of [true, false]) {
		const task = { status: 'pending_acceptance', qaRequired, updatedAt: now - 15 * MINUTE };
		assert.deepEqual(planTaskNudges(task, { now }), ['review'], `qaRequired=${qaRequired}`);
		assert.deepEqual(planTaskNudges({ ...task, updatedAt: now - 5 * MINUTE }, { now }), [], 'not before 10 minutes');
	}
});

test('upper-case host failure codes are classified: billing codes stop, transient codes retry', () => {
	const quota = classifyLlmFailure({ code: 'QUOTA', message: '额度已用尽' });
	assert.equal(quota.category, 'billing', 'codeOf() is upper-case; the billing pattern must be too');
	for (const code of ['SERVER', 'TIMEOUT', 'TRANSPORT', 'STREAM_CLOSED', 'EMPTY_RESPONSE']) {
		const failure = classifyLlmFailure({ code, message: '上游失败' });
		assert.equal(failure.retryable, true, `${code} without an HTTP status is transient`);
		assert.equal(retryDecision(failure, {}, 1).action, 'retry', `${code} retries the same route once`);
	}
	assert.equal(classifyLlmFailure({ code: 'SOMETHING_NEW', message: '?' }).category, 'unknown', 'unknown codes still stop');
});

test('editing settings is not a Human instruction: the autonomy budget and PMO news stay as they were', () => {
	assert.ok(FOLD_STATE_VERSION >= 8, 'fold semantics changed: old checkpoints must be refolded');
	const human = { kind: 'human', memberId: 'h1' };
	for (const type of ['member/profile-updated', 'member/config-updated', 'project/pmo-updated']) {
		assert.equal(isHumanIntent({ type, actor: human }), false, type);
	}
	assert.equal(isHumanIntent({ type: 'stream/posted', actor: human }), true, 'a Human message still is');
	assert.equal(isHumanIntent({ type: 'task/created', actor: human }), true);
	// 折叠：预算用掉 2 轮后改一次成员资料，不得清零。
	const spent = { ...initialState(), lastSeq: 5, pmoFreeWave: false, pmoRoundsUsed: 2, pmoNews: false, members: { a1: { id: 'a1', kind: 'agent', name: 'A', status: 'idle' } } };
	const next = applyEvent(spent, { seq: 6, type: 'member/profile-updated', actor: human, at: now, payload: { memberId: 'a1', patch: { personality: 'x' } } });
	assert.equal(next.pmoRoundsUsed, 2);
	assert.equal(next.pmoFreeWave, false);
	assert.equal(next.pmoNews, false);
});
