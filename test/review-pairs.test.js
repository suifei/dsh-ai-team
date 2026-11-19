import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedReviewer, reviewPairs } from '../lib/domain/policy.js';
import { planWakes } from '../lib/host/waker.js';
import { createTeamTool } from '../lib/host/member-tools.js';

// 用户 2026-11-20：开发与验收 1:1 配对；只有 1 个验收人就都配给他、排队。
const agent = (id, role, createdAt, extra = {}) => ({ id, name: id, kind: 'agent', status: 'idle', role, createdAt, ...extra });
function team(members, tasks = {}) {
	return {
		projects: { p1: { id: 'p1', ownerMemberId: 'lead' } },
		members: Object.fromEntries([agent('lead', '主理人', '2026-01-01', { duty: 'lead' }), ...members].map((m) => [m.id, m])),
		tasks,
	};
}
const pending = (id, assigneeId, extra = {}) => ({ id, title: id, status: 'pending_acceptance', assigneeId, claimHistory: [assigneeId], ownerId: 'lead', qaRequired: false, revision: 3, ...extra });
const pairsOf = (state) => Object.fromEntries(reviewPairs(state));

test('pairs developers with QA by join order: 1:1 when equal, all to the single QA, evenly when fewer; the lead is never paired', () => {
	const two = team([agent('dev1', '编程', '2026-01-02'), agent('dev2', '编程', '2026-01-03'), agent('qa1', '验收', '2026-01-04'), agent('qa2', '测试', '2026-01-05')]);
	assert.deepEqual(pairsOf(two), { dev1: 'qa1', dev2: 'qa2' });
	const single = team([agent('dev1', '编程', '2026-01-02'), agent('dev2', '执行', '2026-01-03'), agent('ux', 'UX 设计', '2026-01-04'), agent('qa1', '验收', '2026-01-05')]);
	assert.deepEqual(pairsOf(single), { dev1: 'qa1', dev2: 'qa1', ux: 'qa1' }, '只有 1 个验收人：都配给他');
	const fewer = team([agent('d1', '编程', '1'), agent('d2', '编程', '2'), agent('d3', '编程', '3'), agent('q1', '验收', '4'), agent('q2', '验收', '5')]);
	assert.deepEqual(pairsOf(fewer), { d1: 'q1', d2: 'q2', d3: 'q1' });
	assert.equal(reviewPairs(team([agent('d1', '编程', '1')])).size, 0, '没有验收人时不配对');
	// duty: qa（稽真·事实核查这类岗位名不带「验收」的）同样是验收人。
	assert.deepEqual(pairsOf(team([agent('d1', '编程', '1'), agent('fact', '事实核查', '2', { duty: 'qa' })])), { d1: 'fact' });
});

test('adding a developer or a QA appends to the queue: existing developers keep their reviewer when a developer joins', () => {
	const before = team([agent('dev1', '编程', '1'), agent('qa1', '验收', '2'), agent('qa2', '验收', '3')]);
	assert.deepEqual(pairsOf(before), { dev1: 'qa1' });
	const joined = team([agent('dev1', '编程', '1'), agent('qa1', '验收', '2'), agent('qa2', '验收', '3'), agent('dev2', '编程', '9')]);
	assert.deepEqual(pairsOf(joined), { dev1: 'qa1', dev2: 'qa2' }, '新来的开发配到下一位验收，dev1 不变');
	const failed = team([agent('dev1', '编程', '1'), agent('dev2', '编程', '2', { status: 'failed' }), agent('qa1', '验收', '3', { status: 'retired' }), agent('qa2', '验收', '4')]);
	assert.deepEqual(pairsOf(failed), { dev1: 'qa2' }, '不在岗的成员不参与配对');
});

test('the paired QA reviews; if the pair cannot (touched the card, not active), the old ranking takes over', () => {
	const base = [agent('dev1', '编程', '1'), agent('dev2', '编程', '2'), agent('qa1', '验收', '3'), agent('qa2', '验收', '4')];
	const state = team(base, { t1: pending('t1', 'dev1'), t2: pending('t2', 'dev2') });
	assert.equal(pairedReviewer(state, state.tasks.t1).id, 'qa1');
	assert.equal(pairedReviewer(state, state.tasks.t2).id, 'qa2', '此前永远叫排第一的 qa1，qa2 闲着');
	const touched = team(base, { t2: pending('t2', 'dev2', { claimHistory: ['qa2', 'dev2'] }) });
	assert.equal(pairedReviewer(touched, touched.tasks.t2).id, 'qa1', '搭档碰过这张卡：退回原排名');
	const busyOut = team([...base.slice(0, 3), agent('qa2', '验收', '4', { status: 'failed' })], { t2: pending('t2', 'dev2') });
	assert.equal(pairedReviewer(busyOut, busyOut.tasks.t2).id, 'qa1');
	assert.equal(pairedReviewer(state, undefined), undefined);
});

test('waker: submit and the PMO review nudge both wake only the paired QA (no longer every QA on qaRequired cards)', () => {
	const members = [agent('dev1', '编程', '1'), agent('dev2', '编程', '2'), agent('qa1', '验收', '3'), agent('qa2', '验收', '4')];
	const state = team(members, { t2: pending('t2', 'dev2', { qaRequired: true }) });
	const submitted = planWakes(state, { event: { type: 'task/submitted', seq: 7, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(submitted.filter((plan) => plan.reason === 'review_requested').map((plan) => plan.memberId), ['qa2']);
	const nudged = planWakes(state, { event: { type: 'pmo/review', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(nudged.map((plan) => [plan.memberId, plan.reason]), [['qa2', 'pmo_review']], '两个验收人时同一张卡不再被两人同时验');
	// 只有 1 个验收人：所有开发的卡都排给他。
	const single = team([agent('dev1', '编程', '1'), agent('dev2', '编程', '2'), agent('qa1', '验收', '3')], { t1: pending('t1', 'dev1'), t2: pending('t2', 'dev2') });
	for (const taskId of ['t1', 't2']) {
		assert.deepEqual(planWakes(single, { event: { type: 'pmo/review', payload: { taskId, bucket: 1 } } }, {}).map((plan) => plan.memberId), ['qa1']);
	}
});

test('team members action shows each developer reviewer pair', async () => {
	const state = team([agent('dev1', '编程', '1', { sessionId: 's-dev1' }), agent('dev2', '编程', '2'), agent('qa1', '验收', '3')]);
	const tool = createTeamTool({ getState: () => state, dispatch: async () => ({}) });
	const view = await tool.execute({ action: 'members' }, { agent: { id: 's-dev1' } });
	assert.equal(view.ok, true, JSON.stringify(view));
	const byId = Object.fromEntries(view.members.map((member) => [member.id, member.reviewerId]));
	assert.deepEqual(byId, { lead: null, dev1: 'qa1', dev2: 'qa1', qa1: null });
});
