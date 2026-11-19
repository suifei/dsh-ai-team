import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PMO_STAFFING_BASE, planIdleStaffing } from '../lib/host/pmo.js';
import { planWakes } from '../lib/host/waker.js';

// 用户 2026-11-20：有多少能开发的角色就分多少任务，确保及时；新加的人由 PMO 及时分配新任务。
const MIN = 60_000;
const agent = (id, role, createdAt, extra = {}) => ({ id, name: id, kind: 'agent', status: 'idle', role, createdAt, ...extra });
const task = (id, number, extra = {}) => ({ id, number, title: `卡${number}`, status: 'pending', assigneeId: null, ownerId: 'lead', claimHistory: [], blockedBy: [], revision: 1, ...extra });
function team(members, tasks) {
	return {
		projects: { p1: { id: 'p1', ownerMemberId: 'lead' } },
		members: Object.fromEntries([agent('lead', '主理人', '0', { duty: 'lead' }), agent('qa1', '验收', '9'), ...members].map((m) => [m.id, m])),
		tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
	};
}
const idleNow = (state, extra = {}) => planIdleStaffing(state, { now: 100 * MIN, inTurn: () => false, ...extra });

test('idle developers each get a distinct claimable card in join order; the rest go to the lead to split new work', () => {
	const state = team(
		[agent('dev1', '编程', '1'), agent('dev2', '编程', '2'), agent('dev3', '执行', '3'), agent('busy', '编程', '4')],
		[task('t1', 1), task('t2', 2, { blockedBy: ['t9'] }), task('t3', 3), task('t9', 9, { status: 'in_progress', assigneeId: 'busy' })],
	);
	const plan = idleNow(state);
	assert.deepEqual(plan.claims, [{ memberId: 'dev1', taskId: 't1' }, { memberId: 'dev2', taskId: 't3' }], '依赖未完成的 t2 不可认领');
	assert.deepEqual(plan.spare, ['dev3']);
	assert.equal(plan.repeats, 0);
});

test('not idle: lead, QA, a developer holding any open card (incl. awaiting acceptance), one in a turn, failed members; empty board is left to continue/wave_done', () => {
	const members = [
		agent('dev1', '编程', '1', { sessionId: 's1' }), agent('dev2', '编程', '2'), agent('dev3', '编程', '3'), agent('gone', '编程', '4', { status: 'failed' }),
	];
	const state = team(members, [task('t1', 1, { status: 'pending_acceptance', assigneeId: 'dev2' }), task('t2', 2, { status: 'in_progress', assigneeId: 'dev3' })]);
	assert.deepEqual(idleNow(state, { inTurn: (id) => id === 's1' }), null, 'dev1 在回合里、dev2 待验收、dev3 在做、gone 失败');
	assert.deepEqual(idleNow(state).spare, ['dev1']);
	assert.equal(idleNow(team(members, [task('t1', 1, { status: 'done' })])), null, '没有 open 卡：交给空看板的推进逻辑');
});

test('a new member is picked up at the next tick; the same situation backs off 10 → 20 → 40 minutes, capped', () => {
	const before = team([agent('dev1', '编程', '1')], [task('t1', 1, { status: 'in_progress', assigneeId: 'dev1' })]);
	assert.equal(idleNow(before), null);
	const joined = team([agent('dev1', '编程', '1'), agent('newbie', '编程', '5')], [task('t1', 1, { status: 'in_progress', assigneeId: 'dev1' })]);
	const first = planIdleStaffing(joined, { now: 100 * MIN, inTurn: () => false, last: { at: 99.5 * MIN, signature: 'older', repeats: 0 } });
	assert.equal(first, null, '局面变了也至少隔 1 分钟');
	const fresh = planIdleStaffing(joined, { now: 101 * MIN, inTurn: () => false, last: { at: 99.5 * MIN, signature: 'older', repeats: 0 } });
	assert.deepEqual(fresh.spare, ['newbie']);
	let last = { at: 101 * MIN, signature: fresh.signature, repeats: 0 };
	const fired = [];
	for (let minute = 102; minute <= 400; minute += 1) {
		const plan = planIdleStaffing(joined, { now: minute * MIN, inTurn: () => false, last });
		if (plan === null) continue;
		fired.push(minute - last.at / MIN);
		last = { at: minute * MIN, signature: plan.signature, repeats: plan.repeats };
	}
	assert.deepEqual(fired.slice(0, 4), [10, 20, 40, 80]);
	assert.ok(fired.every((gap) => gap <= 120), '封顶 2 小时');
	assert.equal(PMO_STAFFING_BASE, 10 * MIN);
});

test('waker: claims wake each idle developer for their card; spare developers wake the lead with names and review pairs', () => {
	const state = team([agent('dev1', '编程', '1'), agent('dev2', '编程', '2'), agent('dev3', '执行', '3')], [task('t1', 1), task('t2', 2, { status: 'in_progress', assigneeId: 'x' })]);
	const plans = planWakes(state, { event: { type: 'pmo/staffing', payload: { claims: [{ memberId: 'dev1', taskId: 't1' }, { memberId: 'dev2', taskId: 't2' }], spare: ['dev3'], bucket: 7 } } }, {});
	assert.deepEqual(plans.map((plan) => [plan.memberId, plan.reason, plan.taskId]), [['dev1', 'pmo_claim', 't1'], ['lead', 'pmo_staffing', null]], 't2 已不在 pending：不再叫认领');
	assert.match(plans[0].prompt, /认领（claim）/);
	assert.match(plans[1].prompt, /dev3（执行，id dev3，验收搭档 qa1）/);
	assert.match(plans[1].prompt, /assigneeId/);
	assert.deepEqual(planWakes(state, { event: { type: 'pmo/staffing', payload: { claims: [], spare: [], bucket: 7 } } }, {}), []);
});

test('index.js runs staffing every PMO tick before the active-board return, throttled per project', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	const at = index.indexOf('const staffing = planIdleStaffing(state, { now, inTurn: (id) => turnsInFlight.has(id), last: pmoLastStaffing.get(projectRuntime.id) });');
	assert.ok(at > 0);
	assert.ok(at < index.indexOf('// Prune per-task clock entries'), '在「有 active 卡就 return」之前');
	assert.ok(at > index.indexOf("if (project.runState === 'stopped') return;"), '停止门之后');
	assert.match(index.slice(at, at + 900), /type: 'pmo\/staffing', payload: \{ claims: staffing\.claims, spare: staffing\.spare/);
});
