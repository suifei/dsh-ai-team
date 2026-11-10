/**
 * Risk-view projection tests (R-07): three risk families aggregated read-only
 * from existing ledger projections — blocked tasks, failed members, stale
 * Human decisions. Pure function: same input, same output, no new events.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { riskView, RISK_KINDS } from '../lib/host/risk-view.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const H = 60 * 60 * 1000;

function baseState({ tasks = [], members = [], inbox = [] } = {}) {
	return {
		lastSeq: 7,
		humanMemberId: 'h1',
		members: Object.fromEntries(members.map((member) => [member.id, member])),
		tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
		inbox: Object.fromEntries(inbox.map((item) => [item.id, item])),
	};
}

test('blocked pending tasks with unfinished dependencies are listed', () => {
	const state = baseState({
		members: [{ id: 'a1', name: '执行', kind: 'agent', role: '执行', status: 'running' }],
		tasks: [
			{ id: 't1', number: 1, title: '依赖卡', status: 'pending', ownerId: 'a1', blockedBy: ['t2'], updatedAt: NOW - 2 * H },
			{ id: 't2', number: 2, title: '未完成的前置', status: 'pending', ownerId: 'a1', blockedBy: [], updatedAt: NOW - 3 * H },
			{ id: 't3', number: 3, title: '自由卡', status: 'pending', ownerId: 'a1', blockedBy: [], updatedAt: NOW - 4 * H },
			{ id: 't4', number: 4, title: '已完成依赖不阻塞', status: 'pending', ownerId: 'a1', blockedBy: [], updatedAt: NOW - 5 * H },
		],
	});
	// t2 处于 pending 且无依赖 → 不是别人的阻塞源；t1 依赖 t2（未完成）→ 受阻。
	const view = riskView(state, { now: NOW });
	assert.deepEqual(view.blocked.map((row) => row.taskId), ['t1']);
	assert.equal(view.blocked[0].ownerName, '执行');
	assert.equal(view.counts.blocked, 1);
});

test('failed members and members carrying lastFailure are listed with human-readable category', () => {
	const state = baseState({
		members: [
			{ id: 'a1', name: '墨渊', kind: 'agent', role: '主理人', status: 'failed', lastFailure: { category: 'billing', attempt: 2, message: '402 insufficient balance' } },
			{ id: 'a2', name: '青岚', kind: 'agent', role: '执行', status: 'running', lastFailure: { category: 'rate_limit', attempt: 1 } },
			{ id: 'a3', name: '健康', kind: 'agent', role: '执行', status: 'idle' },
			{ id: 'h1', name: '你', kind: 'human', status: 'idle', lastFailure: { category: 'billing' } },
		],
	});
	const view = riskView(state, { now: NOW });
	assert.deepEqual(view.failures.map((row) => row.memberId), ['a1', 'a2'], 'human members are excluded');
	assert.equal(view.failures[0].category, 'billing');
	assert.equal(view.failures[0].status, 'failed');
});

test('stale decisions only include unread human decisions older than the threshold, newest-first', () => {
	const state = baseState({
		inbox: [
			{ id: 'd1', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: NOW - 30 * H, ref: { title: '老决策' } },
			{ id: 'd2', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: NOW - 80 * H, ref: { title: '更老决策', taskId: 't9' } },
			{ id: 'd3', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: NOW - 5 * H, ref: { title: '新鲜决策' } },
			{ id: 'd4', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'done', createdAt: NOW - 90 * H, ref: { title: '已处理' } },
			{ id: 'd5', memberId: 'a1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: NOW - 90 * H, ref: { title: '成员自己的' } },
		],
	});
	const view = riskView(state, { now: NOW, staleHours: 24 });
	assert.deepEqual(view.staleDecisions.map((row) => row.itemId), ['d2', 'd1'], 'newest-first among stale ones');
	assert.equal(view.staleDecisions[0].waitingHours, 80);
	assert.equal(view.counts.staleDecisions, 2);
});

test('empty state yields zero counts and stable shape', () => {
	const view = riskView(baseState(), { now: NOW });
	assert.deepEqual(view.counts, { blocked: 0, failures: 0, staleDecisions: 0 });
	assert.deepEqual(view.blocked, []);
	assert.deepEqual(view.failures, []);
	assert.deepEqual(view.staleDecisions, []);
	assert.equal(Object.keys(RISK_KINDS).length, 3);
});
