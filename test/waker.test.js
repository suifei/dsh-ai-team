import test from 'node:test';
import assert from 'node:assert/strict';
import { planWakes } from '../lib/host/waker.js';

const state = {
	members: {
		h1: { id: 'h1', name: 'Human', kind: 'human', status: 'idle' },
		a1: { id: 'a1', name: '沈舟', kind: 'agent', status: 'running', sessionId: 's1' },
		a2: { id: 'a2', name: '林岚', kind: 'agent', status: 'idle', sessionId: 's2' },
		a3: { id: 'a3', name: '旧成员', kind: 'agent', status: 'retired', sessionId: 's3' },
	},
	tasks: {
		t1: { id: 't1', number: 1, title: '修回归', status: 'pending', ownerId: 'a1', assigneeId: null },
		t2: { id: 't2', number: 2, title: '验收', status: 'pending_acceptance', ownerId: 'a1', assigneeId: 'a2' },
	},
	inbox: {},
	projects: { p1: { id: 'p1', ownerMemberId: 'a1' } },
};

test('task creation wakes the Agent owner but not Human or retired', () => {
	const plans = planWakes(state, { task: { ...state.tasks.t1 } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a1', 'task_created']]);
	const humanOwned = planWakes({ ...state, tasks: { ...state.tasks, t1: { ...state.tasks.t1, ownerId: 'h1' } } }, { task: { ...state.tasks.t1, ownerId: 'h1' } }, {});
	assert.equal(humanOwned.length, 0);
});

test('assignment and submission wake the responsible Agent', () => {
	const assigned = planWakes(state, { event: { type: 'task/assigned', seq: 4, payload: { taskId: 't1', assigneeId: 'a2' } } }, {});
	assert.deepEqual(assigned.map((item) => [item.memberId, item.reason]), [['a2', 'task_assigned']]);
	const submitted = planWakes(state, { event: { type: 'task/submitted', seq: 5, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(submitted.map((item) => [item.memberId, item.reason]), [['a1', 'task_submitted']]);
	const changes = planWakes(state, { event: { type: 'task/changes-requested', seq: 6, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(changes.map((item) => [item.memberId, item.reason]), [['a2', 'changes_requested']]);
});

test('thread reply wakes owner/assignee except the author', () => {
	const plans = planWakes(state, {
		event: {
			type: 'thread/posted', seq: 7,
			payload: { taskId: 't2', entry: { seq: 1, authorId: 'a1' } },
		},
	}, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a2', 'thread_reply']]);
	assert.match(plans[0].prompt, /Thread/);
});

test('a Human Main-stream message wakes the Agent Project owner', () => {
	const plans = planWakes(state, {
		event: { type: 'stream/posted', seq: 9, payload: { kind: 'human_message', authorId: 'h1', body: '把回归清干净' } },
	}, {});
	assert.equal(plans.length, 1);
	assert.equal(plans[0].memberId, 'a1');
	assert.equal(plans[0].reason, 'human_message');
	assert.match(plans[0].prompt, /把回归清干净/);
	assert.match(plans[0].prompt, /create/);
});

test('no wake is planned for a member who authored the event', () => {
	const plans = planWakes(state, { event: { type: 'task/assigned', seq: 8, payload: { taskId: 't1', assigneeId: 'a1' } } }, { agentId: 'a1' });
	assert.equal(plans.length, 0);
});
