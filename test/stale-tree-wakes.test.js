import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStaleTreeWakes, STALE_TREE_BACKOFF_MS, STALE_TREE_SETTLE_MS } from '../lib/runtime/stale-tree-wakes.js';
import { isStaleTreeError } from '../lib/runtime/wake-failure.js';
import { isErrorEvent } from '../lib/diaglog.js';

// il2c 11-19 04:47：插件热重载后唤醒玄策，宿主 dsh-subagent deliverToMember 抛的原样错误。
const staleTree = () => Object.assign(new Error('target belongs to another subagent tree'), { code: 'UNAUTHORIZED' });

function harness({ backoffMs = [30, 60, 120], settleDelayMs = 5 } = {}) {
	const rows = [];
	const timers = [];
	const delivered = [];
	const wakes = createStaleTreeWakes({
		redeliver: async (entry) => { delivered.push(entry); },
		diag: { append: (row) => rows.push(row) },
		backoffMs,
		settleDelayMs,
		setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
		clearTimer: (timer) => { if (timer) timer.cleared = true; },
	});
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	const live = () => timers.filter((timer) => !timer.cleared);
	const fireLive = async () => { const [timer] = live(); assert.ok(timer, 'expected one armed timer'); timer.fn(); await flush(); return timer; };
	return { wakes, rows, timers, live, fireLive, delivered, flush };
}

const plan = (reason) => ({ key: `${reason}:mem_coder`, memberId: 'mem_coder', taskId: 'tsk_1', reason });
const at = (sessionId) => ({ sessionId, projectId: 'prj_1', memberId: 'mem_coder' });
const turnEnd = { type: 'turn/end', data: { reason: { kind: 'completed' } } };

test('only the host refusal to deliver under another subagent tree root counts as stale-tree (il2c 11-19)', () => {
	assert.equal(isStaleTreeError(staleTree()), true);
	assert.equal(isStaleTreeError({ code: 'unauthorized', message: 'Target belongs to another subagent tree' }), true);
	// 同为 UNAUTHORIZED 的「另一个父会话」是血缘错配（index.js 有专门处理），不是热重载暂态。
	assert.equal(isStaleTreeError({ code: 'UNAUTHORIZED', message: 'target belongs to another parent session' }), false);
	// r43 第二轮：subagents.prompt 按旧根投递的拒绝是另一句话，不归这一类。
	assert.equal(isStaleTreeError({ code: 'subagent/unauthorized', message: 'subagent membership in the active tree could not be verified' }), false);
	assert.equal(isStaleTreeError({ code: 'NOT_RESUMABLE', message: 'another subagent tree' }), false);
	assert.equal(isStaleTreeError(null), false);
});

test('a refused wake is redelivered settle-ms after the member turn ends, once, with the latest plan', async () => {
	const { wakes, rows, live, fireLive, delivered, flush } = harness();
	assert.equal(wakes.defer({ ...at('sess-coder'), plan: plan('startup_resume') }), true);
	assert.equal(wakes.defer({ ...at('sess-coder'), plan: plan('member_message') }), true, '回合没结束又来新计划：换成最新的');
	assert.deepEqual(wakes.pendingSessions(), ['sess-coder']);
	assert.equal(live().length, 1, '同一会话只挂一个定时器');
	wakes.observe({ id: 'other' }, turnEnd);
	wakes.observe({ id: 'sess-coder' }, { type: 'step/end' });
	assert.equal(live()[0].ms, 30, '别的会话、非 turn/end 不改定时器');
	wakes.observe({ id: 'sess-coder' }, turnEnd);
	assert.equal(live().length, 1);
	assert.equal(live()[0].ms, 5, 'turn/end 后改为等宿主收尾（settlement）再投');
	await flush();
	assert.equal(delivered.length, 0, 'turn/end 当下不投：宿主还没把旧回合收掉');
	await fireLive();
	assert.deepEqual(delivered.map((entry) => [entry.sessionId, entry.projectId, entry.plan.reason]), [['sess-coder', 'prj_1', 'member_message']]);
	assert.equal(live().length, 0);
	wakes.observe({ id: 'sess-coder' }, turnEnd);
	assert.equal(live().length, 0, '已补投：再来 turn/end 不重投');
	wakes.delivered('sess-coder', { reason: 'member_message', messageId: 'm1' });
	assert.deepEqual(rows.map((row) => [row.ev, row.trigger ?? null]), [
		['wake.tree-stale', null], ['wake.tree-stale.redeliver', 'turn-end'], ['wake.tree-stale.recovered', null],
	]);
	assert.equal(rows.at(-1).messageId, 'm1');
	assert.ok(rows.every((row) => !row.ev.endsWith('.fail')), '暂态不刷 errors 级失败行');
	assert.equal(isErrorEvent('wake.tree-stale.recovered'), true, '救回来了在发布默认级别可见');
	assert.equal(isErrorEvent('wake.tree-stale'), false);
});

test('rejections while the old turn is still open never exhaust the budget; only rejections after turn/end do (r43: 3 refusals in a 2-minute turn)', async () => {
	const { wakes, rows, timers, fireLive, delivered } = harness({ backoffMs: [30, 60, 120] });
	wakes.defer({ ...at('s'), plan: plan('member_message') });
	for (let i = 0; i < 6; i += 1) {
		await fireLive();
		assert.equal(wakes.defer({ ...at('s'), plan: plan('member_message'), retry: true }), true, `旧回合里第 ${i + 1} 次补投被拒：继续等`);
	}
	assert.deepEqual(timers.map((timer) => timer.ms), [30, 60, 120, 120, 120, 120, 120], '间隔逐档退避，封顶最后一档');
	assert.equal(delivered.length, 6);
	wakes.observe({ id: 's' }, turnEnd);
	for (let i = 0; i < 2; i += 1) {
		await fireLive();
		assert.equal(wakes.defer({ ...at('s'), plan: plan('member_message'), retry: true }), true);
	}
	await fireLive();
	assert.equal(wakes.defer({ ...at('s'), plan: plan('member_message'), retry: true }), false, '旧回合已结束仍连续被拒、用尽：交还调用方按普通失败处理');
	assert.deepEqual(wakes.pendingSessions(), []);
	assert.deepEqual(rows.filter((row) => row.ev.endsWith('.fail')).map((row) => [row.ev, row.attempts, row.tries]), [['wake.tree-stale.giveup.fail', 3, 9]]);
	wakes.delivered('s');
	assert.equal(rows.at(-1).ev, 'wake.tree-stale.giveup.fail', '放弃后计数已清，后续成功不冒充 recovered');
});

test('delivered is a no-op for sessions never deferred; dispose clears every timer and stops redelivery', async () => {
	const { wakes, rows, live, delivered, flush } = harness();
	wakes.delivered('never-deferred');
	assert.equal(rows.length, 0, '普通投递成功不写行');
	wakes.defer({ ...at('t'), plan: plan('c') });
	wakes.defer({ ...at('u'), plan: plan('d') });
	assert.equal(live().length, 2);
	wakes.dispose();
	assert.equal(live().length, 0);
	wakes.observe({ id: 't' }, turnEnd);
	await flush();
	assert.equal(delivered.length, 0);
	assert.equal(wakes.defer({ ...at('v'), plan: plan('e') }), false, '卸载后不再暂存');
});

test('redeliver failures are logged, not thrown', async () => {
	const rows = [];
	const timers = [];
	const wakes = createStaleTreeWakes({
		redeliver: async () => { throw new Error('ledger closed'); },
		diag: { append: (row) => rows.push(row) },
		setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.at(-1); },
		clearTimer: () => {},
	});
	wakes.defer({ ...at('s'), plan: plan('x') });
	timers[0].fn();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(rows.map((row) => row.ev), ['wake.tree-stale', 'wake.tree-stale.redeliver', 'wake.tree-stale.redeliver.fail']);
	assert.equal(rows.at(-1).message, 'ledger closed');
});

test('defaults: bounded backoff and a short settle delay', () => {
	assert.deepEqual([...STALE_TREE_BACKOFF_MS], [30_000, 60_000, 120_000, 300_000, 600_000]);
	assert.equal(STALE_TREE_SETTLE_MS, 5_000);
});

test('index.js defers stale-tree wakes instead of recording a failure, redelivers through the same wake path, observes turn/end and disposes', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	const catchAt = index.indexOf('if (isStaleTreeError(error)');
	assert.ok(catchAt > 0);
	const catchBlock = index.slice(catchAt, catchAt + 400);
	assert.match(catchBlock, /staleTreeWakes\.defer\(\{ sessionId: staleMember\.sessionId, projectId: projectRuntime\.id, memberId: plan\.memberId, plan, retry \}\)/);
	assert.match(catchBlock, /continue;/, '暂存后跳过失败记录（recordWake ok:false / member failure）');
	assert.ok(catchAt < index.indexOf('const causeChain = describeCauseChain(error);'), '判定在失败记录之前');
	assert.match(index, /await deliverWakePlans\(runtime, \[plan\], \{ retry: true \}\);/, '补投与规划同一份投递实现');
	assert.match(index, /runState === 'stopped'\) return;\s*await deliverWakePlans\(runtime/, '停止的项目不补投');
	assert.match(index, /await deliverWakePlans\(projectRuntime, plans, \{ seq: result\?\.event\?\.seq \?\? head \}\);/);
	assert.match(index, /staleTreeWakes\.delivered\(member\.sessionId, /);
	assert.match(index, /try \{ staleTreeWakes\.observe\(session, event\); \}/);
	assert.match(index, /try \{ staleTreeWakes\.dispose\(\); \}/);
	assert.equal((index.match(/const deliverWakePlans = /g) ?? []).length, 1);
	assert.equal((index.match(/subagents\.prompt\(/g) ?? []).length, 0, 'prompt 兜底实测无效（r43 第二轮），不得引入');
});
