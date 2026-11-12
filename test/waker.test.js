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
	assert.equal(plans[0].key, 'member_message:11:a2:');
});

test('restart resumes unfinished Tasks once without timers', () => {
	const plans = planWakes(state, { event: { type: 'team/startup' } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.taskId, item.reason]), [
		['a1', 't1', 'startup_resume'],
		['a2', 't2', 'startup_resume'],
	]);
	assert.match(plans[0].prompt, /DSH 已重启/);
	assert.ok(plans.every((item) => item.key.startsWith('startup:')));
	assert.equal(new Set(plans.map((item) => item.key)).size, plans.length, 'each recipient gets its own dedupe key');
});

test('PMO review nudge wakes every QA member for a pending Task', () => {
	const reviewState = {
		...state,
		members: { ...state.members, a4: { id: 'a4', name: '白砚', kind: 'agent', status: 'idle', role: '验收' } },
	};
	const plans = planWakes(reviewState, { event: { type: 'pmo/review', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a4', 'pmo_review']]);
	assert.match(plans[0].prompt, /pending_acceptance/);
});

test('PMO escalates a Task that stays in progress for 60 minutes to its owner', () => {
	const plans = planWakes(state, { event: { type: 'pmo/escalate', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a1', 'pmo_escalate']]);
	assert.match(plans[0].prompt, /拆分 Task/);
});

test('escalation also convenes the Project owner when the handoff sits elsewhere', () => {
	const handoff = {
		...state,
		members: { ...state.members, a9: { id: 'a9', name: '墨渊', kind: 'agent', status: 'idle', role: '主理人' } },
		projects: { p1: { id: 'p1', ownerMemberId: 'a9' } },
	};
	const plans = planWakes(handoff, { event: { type: 'pmo/escalate', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]).sort(), [
		['a1', 'pmo_escalate'],
		['a9', 'pmo_escalate'],
	]);
});

test('PMO heartbeat wakes the assignee to post visible progress', () => {
	const plans = planWakes(state, { event: { type: 'pmo/heartbeat', payload: { taskId: 't2', memberId: 'a2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a2', 'pmo_heartbeat']]);
	assert.match(plans[0].prompt, /简短进度/);
});

test('PMO stall detection wakes the task owner and assignee', () => {
	const plans = planWakes(state, { event: { type: 'pmo/stall', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a1', 'pmo_stall'], ['a2', 'pmo_stall']]);
	assert.match(plans[0].prompt, /长时间没有新进展/);
});

test('PMO continuation wakes the owner and convenes every member', () => {
	const meetingState = {
		...state,
		members: {
			...state.members,
			a4: { id: 'a4', name: '知微', kind: 'agent', status: 'idle', role: 'UX 设计' },
		},
	};
	const plans = planWakes(meetingState, { event: { type: 'pmo/continue', payload: { bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]).sort(), [
		['a1', 'pmo_continue'],
		['a2', 'pmo_meeting'],
		['a4', 'pmo_meeting'],
	]);
	const lead = plans.find((item) => item.reason === 'pmo_continue');
	assert.match(lead.prompt, /没有 active Task/);
	assert.match(lead.prompt, /下一批 Task/);
	const attendee = plans.find((item) => item.reason === 'pmo_meeting');
	assert.match(attendee.prompt, /PMO 会议/);
	assert.match(attendee.prompt, /专业视角/);
	// Retired members are never convened.
	assert.equal(plans.some((item) => item.memberId === 'a3'), false);
});

test('acceptance schedules a reflection wake for the executor', () => {
	const doneState = {
		...state,
		tasks: { ...state.tasks, t2: { ...state.tasks.t2, status: 'done', assigneeId: 'a2', claimHistory: ['a2'] } },
	};
	const plans = planWakes(doneState, { event: { type: 'task/accepted', seq: 10, payload: { taskId: 't2' } } }, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.reason]), [['a2', 'reflection_requested']]);
	assert.equal(plans[0].key, 'reflection:t2:a2:');
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

test('wake prompt is a Task delta, not a repeated identity block', () => {
	const customized = {
		...state,
		members: {
			...state.members,
			a1: { ...state.members.a1, name: '沈舟·二', role: 'Lead + QA', personality: '先复跑，再下结论。' },
		},
	};
	const prompt = describeWake({ memberId: 'a1', taskId: 't1', prompt: 'Team event.' }, customized);
	assert.match(prompt, /\[沈舟·二\]/);
	assert.match(prompt, /Task 边界/);
	assert.doesNotMatch(prompt, /先复跑/);
	assert.doesNotMatch(prompt, /你是/);
});

test('the current Task line is always attached, the thread tail only on cold paths', () => {
	// 实机背景：成员会话每次重建都会丢对话上下文，唤醒提示词里只有一句指令，
	// 成员只能自己去 team 里翻。冷路径（重建/无会话）必须把 Task 与最近对话递到手上；
	// 热路径上下文已在会话里，附上去只是白烧 token。
	const withThread = {
		...state,
		threads: {
			t1: {
				taskId: 't1',
				headSeq: 2,
				entries: [
					{ seq: 1, authorId: 'a1', body: '先把回归跑一遍' },
					{ seq: 2, authorId: 'a2', body: '已复现：CLI 参数被二次解析' },
				],
			},
		},
	};
	const hot = describeWake({ memberId: 'a1', taskId: 't1', prompt: '继续。' }, withThread);
	assert.match(hot, /【当前 Task】#1 修回归 \[pending\]/);
	assert.doesNotMatch(hot, /【最近对话】/, 'a live session already holds the conversation');

	const cold = describeWake({ memberId: 'a1', taskId: 't1', prompt: '继续。' }, withThread, { includeThread: true });
	assert.match(cold, /【最近对话】/);
	assert.match(cold, /沈舟：先把回归跑一遍/);
	assert.match(cold, /林岚：已复现/);

	// 没有 taskId 时不加任何上下文（纯成员级唤醒）。
	const memberOnly = describeWake({ memberId: 'a1', prompt: '看一下收件箱。' }, withThread, { includeThread: true });
	assert.equal(memberOnly.endsWith('看一下收件箱。'), true);
	assert.doesNotMatch(memberOnly, /【当前 Task】/);
});

test('the thread tail is bounded so a long conversation cannot flood the prompt', () => {
	const long = '词'.repeat(400);
	const flooded = {
		...state,
		threads: {
			t1: {
				taskId: 't1',
				headSeq: 6,
				entries: [1, 2, 3, 4, 5, 6].map((seq) => ({ seq, authorId: 'a1', body: `${seq}:${long}` })),
			},
		},
	};
	const prompt = describeWake({ memberId: 'a1', taskId: 't1', prompt: '继续。' }, flooded, { includeThread: true });
	assert.equal(prompt.includes('1:'), false, 'only the last entries survive');
	assert.equal(prompt.includes('4:'), true);
	// 正文截断到 120 字（含省略号）
	const lines = prompt.split('\n').filter((line) => line.startsWith('- '));
	assert.equal(lines.length, 3);
	assert.ok(lines.every((line) => line.length <= 130), `line too long: ${lines[0].length}`);
});

test('no wake is planned for a member who authored a thread reply', () => {	const plans = planWakes(state, {
		event: { type: 'thread/posted', seq: 8, payload: { taskId: 't1', entry: { seq: 1, authorId: 'a1' } } },
	}, { agentId: 'a1' });
	assert.equal(plans.length, 0);
});

test('PMO review never wakes the assignee or someone who already claimed the Task', () => {
	const reviewState = {
		...state,
		members: {
			...state.members,
			a4: { id: 'a4', name: '白砚', kind: 'agent', status: 'idle', role: '验收' },
			a5: { id: 'a5', name: '旧验收', kind: 'agent', status: 'idle', role: '验收' },
		},
		tasks: {
			...state.tasks,
			t2: { ...state.tasks.t2, assigneeId: 'a4', claimHistory: ['a5'] },
		},
	};
	const plans = planWakes(reviewState, { event: { type: 'pmo/review', payload: { taskId: 't2', bucket: 42 } } }, {});
	assert.deepEqual(plans.map((item) => item.memberId), [], 'nobody left to review without self-review');
});

test('an inbox item wakes its member using the flat ledger payload', () => {
	// 账本实际写的是扁平载荷（itemId/memberId/ref），不是嵌套的 payload.item。
	const plans = planWakes(state, {
		event: { type: 'inbox/item-created', seq: 31, payload: { itemId: 'inb_1', memberId: 'a2', kind: 'decision', ref: { taskId: 't1' } } },
	}, {});
	assert.deepEqual(plans.map((item) => [item.memberId, item.taskId, item.reason]), [['a2', 't1', 'inbox']]);
	assert.equal(plans[0].key, 'inbox:inb_1:a2:');
});

test('a route change wakes the member and rebuilds the session, even when it failed', () => {
	// 实机事故：成员 provider/model 改到 qwen 后仍在用 deepseek-official（缺 key），
	// 而且失败成员不会被自动唤醒，于是「改完模型」永远不生效。
	const failed = {
		...state,
		members: { ...state.members, a1: { ...state.members.a1, status: 'failed' } },
	};
	const plans = planWakes(failed, {
		event: { type: 'member/config-updated', seq: 30, payload: { memberId: 'a1', routeChanged: true } },
	}, {});
	assert.equal(plans.length, 1);
	assert.equal(plans[0].memberId, 'a1');
	assert.equal(plans[0].reason, 'route_changed');
	assert.match(plans[0].prompt, /模型\/提供方已切换/);

	// 非路由变更（例如只改编排预算）不唤醒：避免每次改配置都重建会话。
	const quiet = planWakes(failed, {
		event: { type: 'member/config-updated', seq: 31, payload: { memberId: 'a1', routeChanged: false } },
	}, {});
	assert.equal(quiet.length, 0);

	// 退役成员不因配置变更被复活。
	const retired = { ...state, members: { ...state.members, a1: { ...state.members.a1, status: 'retired' } } };
	assert.equal(planWakes(retired, {
		event: { type: 'member/config-updated', seq: 32, payload: { memberId: 'a1', routeChanged: true } },
	}, {}).length, 0);
});
