import test from 'node:test';
import assert from 'node:assert/strict';
import { planTaskNudges } from '../lib/host/pmo.js';

const MIN = 60_000;

/**
 * Drive the 60s PMO tick for `minutes` over one task, with the executor answering
 * every heartbeat in the Thread (r06: 观澜 replied to each heartbeat while the card
 * sat in_progress, waiting on a Thread @mention that wakes nobody).
 */
function simulate(task, minutes, { replyToHeartbeat = true } = {}) {
	const last = {};
	let threadAt = task.updatedAt;
	const fired = [];
	for (let minute = 1; minute <= minutes; minute += 1) {
		const now = task.updatedAt + minute * MIN;
		for (const kind of planTaskNudges(task, { threadAt, now, last })) {
			last[kind] = now;
			fired.push({ minute, kind });
			if (kind === 'heartbeat' && replyToHeartbeat) threadAt = now + 15_000;
		}
	}
	return fired;
}

test('heartbeat replies no longer mask a stalled in_progress task: stall at 30 min, escalate at 60 min', () => {
	const fired = simulate({ id: 't', status: 'in_progress', updatedAt: 1_000_000 }, 90);
	const at = (kind) => fired.filter((item) => item.kind === kind).map((item) => item.minute);
	// The reply lands 15 s after each heartbeat, so the next Thread-idle window
	// closes one tick later; none fire once the state clock passes 30 min.
	assert.deepEqual(at('heartbeat'), [10, 21], 'heartbeats stop once the state clock passes 30 min');
	assert.deepEqual(at('stall'), [30, 60, 90]);
	assert.deepEqual(at('escalate'), [60], 'the owner is called in after an hour without a state change');
});

test('heartbeats stay quiet while the executor keeps posting real Thread progress', () => {
	const task = { id: 't', status: 'in_progress', updatedAt: 0 + 1_000_000 };
	const last = {};
	// Thread post 2 min ago: not idle → no heartbeat at minute 12.
	assert.deepEqual(planTaskNudges(task, { threadAt: task.updatedAt + 10 * MIN, now: task.updatedAt + 12 * MIN, last }), []);
});

test('a state change resets both clocks', () => {
	const task = { id: 't', status: 'in_progress', updatedAt: 1_000_000 };
	const now = task.updatedAt + 5 * MIN;
	assert.deepEqual(planTaskNudges(task, { threadAt: null, now, last: {} }), []);
});

test('QA review reminders run on the submission clock and escalate hourly', () => {
	const fired = simulate({ id: 't', status: 'pending_acceptance', qaRequired: true, updatedAt: 1_000_000 }, 60);
	assert.deepEqual(fired.filter((item) => item.kind === 'review').map((item) => item.minute), [10, 20, 30, 40, 50, 60]);
	assert.deepEqual(fired.filter((item) => item.kind === 'escalate').map((item) => item.minute), [60]);
	assert.equal(fired.some((item) => item.kind === 'heartbeat' || item.kind === 'stall'), false);
});

test('a task with no timestamp is skipped', () => {
	assert.deepEqual(planTaskNudges({ id: 't', status: 'in_progress' }, { now: 10 * MIN }), []);
});

test('an idle board that PMO already looked at is pushed again, with doubling gaps, only while nobody is in a turn', async () => {
	// il2c 11-17：03:55 wave_done 送达后主理人起了后台批就收尾，后台批随会话释放被杀；
	// 此后无人建卡、无 Human 输入，PMO 每轮判「无新进展」，看板空转到天亮。
	const { planIdleRetry, PMO_IDLE_RETRY_BASE, PMO_IDLE_RETRY_MAX } = await import('../lib/host/pmo.js');
	const state = { members: { mem_lead: { kind: 'agent', sessionId: 's-lead' }, h: { kind: 'human' } } };
	const since = 1_000_000;
	const idle = () => false;
	assert.equal(planIdleRetry(state, { since, now: since + 29 * MIN, inTurn: idle }), false, 'not before 30 minutes');
	assert.equal(planIdleRetry(state, { since, now: since + 30 * MIN, inTurn: idle }), true, 'first push at 30 minutes');
	assert.equal(planIdleRetry(state, { since, now: since + 30 * MIN, inTurn: (id) => id === 's-lead' }), false, 'a member in a turn is progress');
	// 推进过一次后：下一次要再等 60 分钟，然后 120 分钟……
	const lastAt = since + 30 * MIN;
	assert.equal(planIdleRetry(state, { since, lastAt, retries: 1, now: lastAt + 59 * MIN, inTurn: idle }), false);
	assert.equal(planIdleRetry(state, { since, lastAt, retries: 1, now: lastAt + 60 * MIN, inTurn: idle }), true);
	assert.equal(planIdleRetry(state, { since, lastAt, retries: 2, now: lastAt + 119 * MIN, inTurn: idle }), false);
	assert.equal(planIdleRetry(state, { since, lastAt, retries: 9, now: lastAt + PMO_IDLE_RETRY_MAX, inTurn: idle }), true, 'gap is capped');
	assert.equal(PMO_IDLE_RETRY_BASE, 30 * MIN);

	// 接线：pmoTick 在 pmoNews=false 时不再永久 return，而是交给 planIdleRetry。
	const { readFileSync } = await import('node:fs');
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	assert.match(index, /if \(!planIdleRetry\(state, \{ \.\.\.quiet, now, inTurn: \(id\) => turnsInFlight\.has\(id\) \}\)\) return;/);
});
