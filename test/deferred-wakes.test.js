import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDeferredWakes, DEFERRED_BACKOFF_MS, DEFERRED_SETTLE_MS } from '../lib/runtime/deferred-wakes.js';
import { deferredWakeKind, isCapacityError, isStaleTreeError } from '../lib/runtime/wake-failure.js';
import { isErrorEvent } from '../lib/diaglog.js';

// il2c 11-19 04:47：插件热重载后唤醒玄策，宿主 dsh-subagent deliverToMember 抛的原样错误。
const staleTree = () => Object.assign(new Error('target belongs to another subagent tree'), { code: 'UNAUTHORIZED' });
// dsh-subagent activation.ts reserve()：同时运行的子智能体达到上限时的原样错误。
const capacity = () => Object.assign(new Error('subagent limit reached (active child limit: 8); wait for an existing child to finish or complete this work with the current agents'), { code: 'ACTIVATION_LIMIT_REACHED' });

function harness({ backoffMs = [30, 60, 120], settleDelayMs = 5 } = {}) {
	const rows = [];
	const timers = [];
	const delivered = [];
	let clock = 1_000;
	const wakes = createDeferredWakes({
		redeliver: async (entry) => { delivered.push(entry); },
		diag: { append: (row) => rows.push(row) },
		backoffMs,
		settleDelayMs,
		setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
		clearTimer: (timer) => { if (timer) timer.cleared = true; },
		now: () => clock,
	});
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	const live = () => timers.filter((timer) => !timer.cleared);
	const fire = async (timer) => { timer.cleared = true; timer.fn(); await flush(); };
	const tick = (ms = 1) => { clock += ms; };
	return { wakes, rows, timers, live, fire, delivered, flush, tick };
}

const plan = (reason, memberId = 'mem_coder') => ({ key: `${reason}:${memberId}`, memberId, taskId: 'tsk_1', reason });
const stale = (sessionId, extra = {}) => ({ kind: 'stale-tree', sessionId, projectId: 'prj_1', memberId: 'mem_coder', ...extra });
const queued = (memberId, extra = {}) => ({ kind: 'capacity', sessionId: null, projectId: 'prj_1', memberId, plan: plan('task_assigned', memberId), ...extra });
const turnEnd = { type: 'turn/end', data: { reason: { kind: 'completed' } } };

test('error kinds: stale tree (il2c 11-19) and host capacity (ACTIVATION_LIMIT_REACHED), raw or wrapped by member activation', () => {
	assert.equal(isStaleTreeError(staleTree()), true);
	assert.equal(isStaleTreeError({ code: 'unauthorized', message: 'Target belongs to another subagent tree' }), true);
	// 同为 UNAUTHORIZED 的「另一个父会话」是血缘错配（index.js 有专门处理），不是热重载暂态。
	assert.equal(isStaleTreeError({ code: 'UNAUTHORIZED', message: 'target belongs to another parent session' }), false);
	assert.equal(isStaleTreeError({ code: 'subagent/unauthorized', message: 'subagent membership in the active tree could not be verified' }), false);
	assert.equal(isCapacityError(capacity()), true);
	// MemberRuntime.activate 把宿主错误包成 E_ACTIVATION，但保留原文。
	assert.equal(isCapacityError({ code: 'E_ACTIVATION', message: `member activation failed: ${capacity().message}` }), true);
	assert.equal(isCapacityError({ code: 'NOT_RESUMABLE', message: 'already owned by an active write handle' }), false);
	assert.deepEqual([staleTree(), capacity(), new Error('boom'), null].map(deferredWakeKind), ['stale-tree', 'capacity', null, null]);
});

test('stale-tree: redelivered settle-ms after that member turn ends, once, with the latest plan', async () => {
	const { wakes, rows, live, fire, delivered, flush } = harness();
	assert.equal(wakes.defer({ ...stale('sess-coder'), plan: plan('startup_resume') }), true);
	assert.equal(wakes.defer({ ...stale('sess-coder'), plan: plan('member_message') }), true, '没投出去又来新计划：换成最新的');
	assert.deepEqual(wakes.pending(), [{ kind: 'stale-tree', projectId: 'prj_1', memberId: 'mem_coder' }]);
	assert.equal(live().length, 1, '同一成员只挂一个定时器');
	wakes.observe({ id: 'other' }, turnEnd);
	wakes.observe({ id: 'sess-coder' }, { type: 'step/end' });
	assert.equal(live()[0].ms, 30, '别的会话、非 turn/end 不改 stale-tree 的定时器');
	wakes.observe({ id: 'sess-coder' }, turnEnd);
	assert.equal(live()[0].ms, 5, 'turn/end 后改为等宿主收尾（settlement）再投');
	await flush();
	assert.equal(delivered.length, 0, 'turn/end 当下不投');
	await fire(live()[0]);
	assert.deepEqual(delivered.map((entry) => [entry.kind, entry.sessionId, entry.plan.reason]), [['stale-tree', 'sess-coder', 'member_message']]);
	wakes.delivered('prj_1', 'mem_coder', { messageId: 'm1' });
	assert.deepEqual(rows.map((row) => [row.ev, row.trigger ?? null]), [
		['wake.tree-stale', null], ['wake.tree-stale.redeliver', 'turn-end'], ['wake.tree-stale.recovered', null],
	]);
	assert.ok(rows.every((row) => !row.ev.endsWith('.fail')), '暂态不刷 errors 级失败行');
});

test('stale-tree: refusals while the old turn is open never exhaust the budget; only refusals after turn/end do', async () => {
	const { wakes, rows, timers, live, fire } = harness({ backoffMs: [30, 60, 120] });
	wakes.defer({ ...stale('s'), plan: plan('member_message') });
	for (let i = 0; i < 6; i += 1) {
		await fire(live()[0]);
		assert.equal(wakes.defer({ ...stale('s'), plan: plan('member_message'), retry: true }), true, `旧回合里第 ${i + 1} 次补投被拒：继续等`);
	}
	assert.deepEqual(timers.map((timer) => timer.ms), [30, 60, 120, 120, 120, 120, 120], '间隔逐档退避，封顶最后一档');
	wakes.observe({ id: 's' }, turnEnd);
	for (let i = 0; i < 2; i += 1) {
		await fire(live()[0]);
		assert.equal(wakes.defer({ ...stale('s'), plan: plan('member_message'), retry: true }), true);
	}
	await fire(live()[0]);
	assert.equal(wakes.defer({ ...stale('s'), plan: plan('member_message'), retry: true }), false, '旧回合已结束仍连续被拒、用尽：交还调用方按普通失败处理');
	assert.deepEqual(rows.filter((row) => row.ev.endsWith('.fail')).map((row) => [row.ev, row.attempts, row.tries]), [['wake.tree-stale.giveup.fail', 3, 9]]);
});

test('capacity: a team larger than the host limit queues; each turn/end anywhere frees a slot for the oldest waiter, FIFO, and never gives up', async () => {
	const { wakes, rows, live, fire, delivered, tick } = harness({ backoffMs: [30, 60] });
	for (const memberId of ['mem_9', 'mem_10', 'mem_11']) { wakes.defer(queued(memberId)); tick(); }
	assert.deepEqual(wakes.pending().map((entry) => entry.memberId), ['mem_9', 'mem_10', 'mem_11']);
	assert.equal(rows.at(-1).queued, 3, '入队行带当前排队人数');
	// 任意会话（不是排队者自己的）结束一个回合 → 只叫排队最久的那一位。
	wakes.observe({ id: 'sess-of-mem_2' }, turnEnd);
	const armed = live().filter((timer) => timer.ms === 5);
	assert.equal(armed.length, 1);
	await fire(armed[0]);
	assert.deepEqual(delivered.map((entry) => [entry.kind, entry.memberId]), [['capacity', 'mem_9']]);
	// 名额被别人抢走：mem_9 补投又被拒 → 重新入队但保持原位（不掉到队尾）。
	wakes.defer(queued('mem_9', { retry: true }));
	assert.deepEqual(wakes.pending().map((entry) => entry.memberId), ['mem_9', 'mem_10', 'mem_11']);
	// 两个回合同时结束 → 依次叫最早的两位，同一位不叫两遍。
	wakes.observe({ id: 'a' }, turnEnd);
	wakes.observe({ id: 'b' }, turnEnd);
	const settle = live().filter((timer) => timer.ms === 5);
	assert.equal(settle.length, 2);
	for (const timer of settle) await fire(timer);
	assert.deepEqual(delivered.slice(1).map((entry) => entry.memberId), ['mem_9', 'mem_10']);
	// 排多久都等：反复被拒也不放弃，间隔封顶最后一档。
	for (let i = 0; i < 10; i += 1) assert.equal(wakes.defer(queued('mem_10', { retry: true })), true);
	assert.equal(rows.filter((row) => row.ev.endsWith('.fail')).length, 0);
	wakes.delivered('prj_1', 'mem_9', { reason: 'task_assigned' });
	assert.equal(rows.at(-1).ev, 'wake.capacity.recovered');
	assert.equal(isErrorEvent('wake.capacity.recovered'), true, '排到了在发布默认级别可见');
	assert.equal(isErrorEvent('wake.capacity'), false);
});

test('delivered is a no-op for members never deferred; dispose clears every timer and stops redelivery; redeliver errors are logged', async () => {
	const { wakes, rows, live, delivered, flush } = harness();
	wakes.delivered('prj_1', 'never-deferred');
	assert.equal(rows.length, 0, '普通投递成功不写行');
	wakes.defer({ ...stale('t'), plan: plan('c') });
	wakes.defer(queued('mem_9'));
	assert.equal(wakes.defer({ kind: 'nope', projectId: 'prj_1', memberId: 'x', plan: plan('z') }), false, '未知类不暂存');
	wakes.dispose();
	assert.equal(live().length, 0);
	wakes.observe({ id: 't' }, turnEnd);
	await flush();
	assert.equal(delivered.length, 0);
	assert.equal(wakes.defer(queued('mem_10')), false, '卸载后不再暂存');

	const errRows = [];
	const timers = [];
	const failing = createDeferredWakes({
		redeliver: async () => { throw new Error('ledger closed'); },
		diag: { append: (row) => errRows.push(row) },
		setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.at(-1); },
		clearTimer: () => {},
	});
	failing.defer(queued('mem_9'));
	timers[0].fn();
	await flush();
	assert.deepEqual(errRows.map((row) => row.ev), ['wake.capacity', 'wake.capacity.redeliver', 'wake.capacity.redeliver.fail']);
});

test('defaults: bounded backoff and a short settle delay', () => {
	assert.deepEqual([...DEFERRED_BACKOFF_MS], [30_000, 60_000, 120_000, 300_000, 600_000]);
	assert.equal(DEFERRED_SETTLE_MS, 5_000);
});

test('index.js defers both kinds instead of recording a failure, redelivers through the same wake path, and never fails a member for host capacity', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	const catchAt = index.indexOf('const deferKind = deferredWakeKind(error);');
	assert.ok(catchAt > 0);
	const catchBlock = index.slice(catchAt, catchAt + 500);
	assert.match(catchBlock, /deferredWakes\.defer\(\{ kind: deferKind, sessionId: deferMember\?\.sessionId \?\? null, projectId: projectRuntime\.id, memberId: plan\.memberId, plan, retry \}\)/);
	assert.match(catchBlock, /continue;/, '暂存后跳过失败记录');
	assert.ok(catchAt < index.indexOf('const causeChain = describeCauseChain(error);'), '判定在失败记录之前');
	assert.match(index, /await deliverWakePlans\(runtime, \[plan\], \{ retry: true \}\);/, '补投与规划同一份投递实现');
	assert.match(index, /runState === 'stopped'\) return;\s*await deliverWakePlans\(runtime/, '停止的项目不补投');
	assert.match(index, /deferredWakes\.delivered\(projectRuntime\.id, plan\.memberId, /);
	assert.match(index, /try \{ deferredWakes\.observe\(session, event\); \}/);
	assert.match(index, /try \{ deferredWakes\.dispose\(\); \}/);
	assert.match(index, /if \(isCapacityError\(error\)\) \{\s*(?:noteHostCapacity\(error\);\s*)?diag\.append\(\{ ev: 'member\.activate\.capacity'[^\n]*\n\s*\} else if \(currentStatus !== 'retired'\) \{/, '容量满不 failMember');
	assert.equal((index.match(/const deliverWakePlans = /g) ?? []).length, 1);
	assert.equal((index.match(/subagents\.prompt\(/g) ?? []).length, 0, 'prompt 兜底实测无效（r43 第二轮），不得引入');
});
