/**
 * Pending 快速补派（R-14）测试：
 * - pmo/dispatch 事件只对仍处 pending 的任务产生唤醒（in_progress/done 不补）
 * - 责任位 = assignee 优先、owner 兜底；retired/failed 成员不唤醒
 * - prompt 携带补派语义（认领推进，不静默等待）
 * - bucket 参与 key：同一分钟去重，跨分钟可重复补派
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planWakes } from '../lib/host/waker.js';

const now = Date.now();

function stateWith({ taskStatus = 'pending', assigneeId = null, ownerStatus = undefined, assigneeStatus = undefined }) {
	return {
		lastSeq: 10,
		members: {
			h1: { id: 'h1', name: '你', kind: 'human' },
			a1: { id: 'a1', name: '青岚', kind: 'agent', status: ownerStatus },
			a2: { id: 'a2', name: '玄策', kind: 'agent', status: assigneeStatus },
		},
		tasks: {
			t1: { id: 't1', number: 1, title: '补派对象', status: taskStatus, ownerId: 'a1', assigneeId, tombstone: false },
		},
	};
}

const dispatchEvent = (bucket = 7) => ({ type: 'pmo/dispatch', payload: { taskId: 't1', bucket } });

test('pmo/dispatch wakes the assignee (fallback owner) for a pending task', () => {
	const state = stateWith({ assigneeId: 'a2', ownerStatus: 'running', assigneeStatus: undefined });
	const wakes = planWakes(state, { event: dispatchEvent() }, {});
	assert.equal(wakes.length, 1);
	assert.equal(wakes[0].memberId, 'a2', 'assignee has priority over owner');
	assert.equal(wakes[0].reason, 'pmo_dispatch');
	assert.match(wakes[0].key, /^pmo_dispatch:t1:7$/);
	assert.match(wakes[0].prompt, /仍处于待处理/);
	assert.match(wakes[0].prompt, /认领/);
});

test('pmo/dispatch is a no-op for non-pending tasks and for retired/failed members', () => {
	for (const status of ['in_progress', 'pending_acceptance', 'done']) {
		const wakes = planWakes(stateWith({ taskStatus: status, ownerStatus: 'idle' }), { event: dispatchEvent() }, {});
		assert.equal(wakes.length, 0, `${status} must not be re-dispatched`);
	}
	const retired = planWakes(stateWith({ ownerStatus: 'retired' }), { event: dispatchEvent() }, {});
	assert.equal(retired.length, 0);
	const failed = planWakes(stateWith({ ownerStatus: 'failed' }), { event: dispatchEvent() }, {});
	assert.equal(failed.length, 0);
});

test('pmo/dispatch keys carry the bucket so a later minute can re-dispatch', () => {
	const state = stateWith({ ownerStatus: undefined });
	const first = planWakes(state, { event: dispatchEvent(100) }, {});
	const second = planWakes(state, { event: dispatchEvent(101) }, {});
	assert.equal(first[0].key, 'pmo_dispatch:t1:100');
	assert.equal(second[0].key, 'pmo_dispatch:t1:101');
	assert.notEqual(first[0].key, second[0].key, 'different minutes must produce distinct dedupe keys');
});
