import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWake, planWakes } from '../lib/host/waker.js';

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
	assert.deepEqual(submitted.map((item) => [item.memberId, item.reason]), [['a1', 'review_requested']]);
	const changes = planWakes(state, { event: { type: 'task/changes-requested', seq: 6, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(changes.map((item) => [item.memberId, item.reason]), [['a2', 'changes_requested']]);
});

test('a Human DM wakes exactly the target member', () => {
	const plans = planWakes(state, {
		event: { type: 'member/message', seq: 11, payload: { memberId: 'a2', authorId: 'h1', body: '看一下 #2' } },
	}, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a2', 'member_message']]);
	assert.match(plans[0].prompt, /看一下 #2/);
	assert.equal(plans[0].key, 'member_message:11');
});

test('restart resumes unfinished Tasks once without timers', () => {
	const plans = planWakes(state, { event: { type: 'team/startup' } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.taskId, item.reason]), [
		['a1', 't1', 'startup_resume'],
		['a2', 't2', 'startup_resume'],
	]);
	assert.match(plans[0].prompt, /DSH 已重启/);
	assert.ok(plans.every((item) => item.key.startsWith('startup:')));
});

test('PMO stall detection wakes the task owner and assignee', () => {
	const plans = planWakes(state, { event: { type: 'pmo/stall', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a1', 'pmo_stall'], ['a2', 'pmo_stall']]);
	assert.match(plans[0].prompt, /长时间没有新进展/);
});

test('PMO continuation wakes the Project owner when nothing is active', () => {
	const plans = planWakes(state, { event: { type: 'pmo/continue', payload: { bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a1', 'pmo_continue']]);
	assert.match(plans[0].prompt, /没有 active Task/);
	assert.match(plans[0].prompt, /下一批 Task/);
});

test('acceptance schedules a reflection wake for the executor', () => {
	const doneState = {
		...state,
		tasks: { ...state.tasks, t2: { ...state.tasks.t2, status: 'done', assigneeId: 'a2', claimHistory: ['a2'] } },
	};
	const plans = planWakes(doneState, { event: { type: 'task/accepted', seq: 10, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a2', 'reflection_requested']]);
	assert.equal(plans[0].key, 'reflection:t2');
	assert.match(plans[0].prompt, /evolve/);
});

test('a QA member is preferred as the submitted reviewer', () => {
	const qaState = {
		...state,
		members: {
			...state.members,
			a4: { id: 'a4', name: '关关', role: 'QA 质量', kind: 'agent', status: 'idle', sessionId: 's4' },
		},
		tasks: {
			...state.tasks,
			t2: { ...state.tasks.t2, assigneeId: 'a2', claimHistory: ['a1', 'a2'] },
		},
	};
	const plans = planWakes(qaState, { event: { type: 'task/submitted', seq: 8, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a4', 'review_requested']]);
	assert.match(plans[0].prompt, /QA/);
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

test('wake prompt carries the customized name, role and personality', () => {
	const customized = {
		...state,
		members: {
			...state.members,
			a1: { ...state.members.a1, name: '沈舟·二', role: 'Lead + QA', personality: '先复跑，再下结论。' },
		},
	};
	const prompt = describeWake({ memberId: 'a1', taskId: 't1', prompt: 'Team event.' }, customized);
	assert.match(prompt, /沈舟·二/);
	assert.match(prompt, /Lead \+ QA/);
	assert.match(prompt, /先复跑/);
	assert.match(prompt, /QA 职责/);
});

test('no wake is planned for a member who authored a thread reply', () => {
	const plans = planWakes(state, {
		event: { type: 'thread/posted', seq: 8, payload: { taskId: 't1', entry: { seq: 1, authorId: 'a1' } } },
	}, { agentId: 'a1' });
	assert.equal(plans.length, 0);
});
