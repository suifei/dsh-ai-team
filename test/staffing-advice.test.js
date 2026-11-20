import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_SUBAGENT_LIMIT, STAFFING_ADVICE_COOLDOWN, STAFFING_ADVICE_WAIT, planStaffingAdvice } from '../lib/host/pmo.js';
import { capacityLimit } from '../lib/runtime/wake-failure.js';
import { ProjectRuntime } from '../lib/host/project-runtime.js';

// 用户 2026-11-20：推进过慢就建议加人（开发或验收），由 Human 决定；超过宿主并发上限的人排队。
const MIN = 60_000;
const NOW = 1000 * MIN;
const agent = (id, role, createdAt, extra = {}) => ({ id, name: id, kind: 'agent', status: 'running', role, createdAt, ...extra });
const card = (id, status, updatedAt, extra = {}) => ({ id, number: Number(id.slice(1)), title: id, status, updatedAt, assigneeId: null, ownerId: 'lead', blockedBy: [], writeScopes: [], claimHistory: [], ...extra });
function team(members, tasks, inbox = {}) {
	return {
		projects: { p1: { id: 'p1', ownerMemberId: 'lead' } },
		members: Object.fromEntries([{ id: 'human', kind: 'human' }, agent('lead', '主理人', '0', { duty: 'lead' }), ...members].map((m) => [m.id, m])),
		tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
		inbox,
	};
}
const advise = (state, extra = {}) => planStaffingAdvice(state, { now: NOW, inTurn: () => false, humanId: 'human', ...extra });
const devs = [agent('dev1', '编程', '1'), agent('dev2', '编程', '2')];
const busy = [card('t1', 'in_progress', NOW, { assigneeId: 'dev1' }), card('t2', 'in_progress', NOW, { assigneeId: 'dev2' })];

test('ready work waiting 30+ minutes with every developer busy → suggest that many developers (max 3)', () => {
	const waiting = [card('t3', 'pending', NOW - 40 * MIN), card('t4', 'pending', NOW - 31 * MIN), card('t5', 'pending', NOW - 5 * MIN)];
	const [advice, ...rest] = advise(team([...devs, agent('qa1', '验收', '3')], [...busy, ...waiting]));
	assert.equal(rest.length, 0);
	assert.equal(advice.role, 'developer');
	assert.equal(advice.count, 2, '只算等够 30 分钟的');
	assert.deepEqual(advice.taskIds, ['t3', 't4']);
	assert.match(advice.title, /^建议加 2 名开发：2 张待办已等 40 分钟，开发都在忙$/);
	assert.equal(STAFFING_ADVICE_WAIT, 30 * MIN);
	assert.equal(advise(team([...devs, agent('qa1', '验收', '3')], [...busy, ...waiting]), { wait: 3 * MIN })[0].count, 3, '配置更短的门槛：三张都算');
});

test('no developer advice when someone is idle (staffing hands them the card), the wait is short, or the card is blocked', () => {
	const old = NOW - 60 * MIN;
	assert.deepEqual(advise(team([...devs, agent('dev3', '编程', '3', { status: 'idle' })], [...busy, card('t3', 'pending', old)])), [], 'dev3 空闲');
	assert.deepEqual(advise(team(devs, [...busy, card('t3', 'pending', NOW - 10 * MIN)])), []);
	assert.deepEqual(advise(team(devs, [...busy, card('t3', 'pending', old, { blockedBy: ['t1'] })])), [], '依赖没完成，加人也做不了');
	assert.deepEqual(advise(team(devs, [card('t1', 'in_progress', NOW, { assigneeId: 'dev1', writeScopes: ['src/'] }), card('t2', 'in_progress', NOW, { assigneeId: 'dev2' }), card('t3', 'pending', old, { writeScopes: ['src/a.js'] })])), [], '写入范围冲突，加人也得等');
});

test('acceptance queue: suggest one QA when there is none, or each QA has 2+ cards waiting 30+ minutes', () => {
	const old = NOW - 45 * MIN;
	const twoWaiting = [card('t1', 'pending_acceptance', old, { assigneeId: 'dev1' }), card('t2', 'pending_acceptance', old, { assigneeId: 'dev2' })];
	const none = advise(team(devs, [twoWaiting[0]]));
	assert.deepEqual(none.map((a) => [a.role, a.count]), [['qa', 1]]);
	assert.match(none[0].title, /团队没有验收人/);
	const one = advise(team([...devs, agent('qa1', '验收', '3')], twoWaiting));
	assert.match(one[0].title, /^建议加 1 名验收：2 张卡待验收已等 45 分钟，1 位验收人每人摊到 2 张$/);
	assert.deepEqual(advise(team([...devs, agent('qa1', '验收', '3'), agent('qa2', '验收', '4')], twoWaiting)), [], '两位验收人各一张：不算慢');
});

// 实机 il2c 2026-11-20：验收人白砚 06:53 模型报错停摆（member/llm-failed），两张卡待验收 555 分钟，
// 旧版把停摆的人当成不存在，提示「团队没有验收人，建议加 1 名」——人还在，恢复即可。
test('a stalled QA or developer is recovered, not replaced: the advice names them and skips the queue note', () => {
	const old = NOW - 555 * MIN;
	const waiting = [card('t1', 'pending_acceptance', old, { assigneeId: 'dev1' }), card('t2', 'pending_acceptance', old, { assigneeId: 'dev2' })];
	const many = Array.from({ length: 7 }, (_, i) => agent(`d${i}`, '编程', String(i)));
	const [qa] = advise(team([...many, agent('qa1', '验收', '9', { name: '白砚', status: 'failed' })], waiting));
	assert.equal(qa.role, 'qa');
	assert.equal(qa.action, 'recover');
	assert.deepEqual(qa.memberIds, ['qa1']);
	assert.equal(qa.title, '建议恢复停摆的验收：2 张卡待验收已等 555 分钟，而验收人 白砚 停摆了（收件箱里有失败提醒）：恢复后即可接手，不必加人');
	assert.doesNotMatch(qa.title, /没有验收人|排队/);
	assert.equal(advise(team([...devs, agent('qa1', '验收', '3', { status: 'retired' })], waiting))[0].action, 'add', '退役是有意离队：照常建议加人');

	const [dev] = advise(team([...devs, agent('dev3', '编程', '3', { name: '青岚', status: 'unavailable' }), agent('qa1', '验收', '4')], [...busy, card('t3', 'pending', NOW - 40 * MIN)]));
	assert.equal(dev.action, 'recover');
	assert.match(dev.title, /^建议恢复停摆的开发：1 张待办已等 40 分钟，开发都在忙，而开发 青岚 停摆了/);
});

test('over the host limit the advice says the extra members queue; one per kind per 4 hours, none while the last is unread', () => {
	const many = Array.from({ length: 7 }, (_, i) => agent(`d${i}`, '编程', String(i)));
	const tasks = [...many.map((m, i) => card(`t${i}`, 'in_progress', NOW, { assigneeId: m.id })), card('t9', 'pending', NOW - 50 * MIN)];
	const [advice] = advise(team(many, tasks));
	assert.match(advice.title, /团队现有 8 名 AI 成员，宿主同时在跑上限 8，加人后超出的部分会排队，提速有限/);
	assert.doesNotMatch(advise(team(many, tasks), { capacity: 12 })[0].title, /排队/);
	assert.equal(HOST_SUBAGENT_LIMIT, 8);
	const item = (state, createdAt) => ({ i1: { id: 'i1', memberId: 'human', type: 'decision_required', state, createdAt, ref: { kind: 'staffing_advice', role: 'developer' } } });
	assert.deepEqual(advise(team(many, tasks, item('unread', NOW - 10 * 60 * MIN))), [], '上一条还没处理');
	assert.deepEqual(advise(team(many, tasks, item('read', NOW - 60 * MIN))), [], '冷却中');
	assert.equal(advise(team(many, tasks, item('read', NOW - STAFFING_ADVICE_COOLDOWN))).length, 1);
});

test('capacity limit is read from the host refusal message', () => {
	assert.equal(capacityLimit({ code: 'ACTIVATION_LIMIT_REACHED', message: 'subagent limit reached (active child limit: 2); wait for an existing child to finish' }), 2);
	assert.equal(capacityLimit({ code: 'E_ACTIVATION', message: 'subagent limit reached (active child limit: 12); wait' }), 12);
	assert.equal(capacityLimit({ code: 'UNAUTHORIZED', message: 'active child limit: 3' }), null);
	assert.equal(capacityLimit({ code: 'ACTIVATION_LIMIT_REACHED', message: 'limit' }), null);
});

test('the advice lands in the Human inbox without questions, so it is never auto-answered', async () => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-advice-'));
	try {
		const runtime = await ProjectRuntime.open({ rootDir: root });
		const service = runtime.service;
		const item = await service.recordStaffingAdvice(runtime.id, { role: 'developer', count: 2, title: '建议加 2 名开发：x', reasons: ['x'], taskIds: ['t3'] });
		const stored = service.state.inbox[item.id];
		assert.equal(stored.memberId, service.humanId());
		assert.equal(stored.ref.kind, 'staffing_advice');
		assert.equal(stored.ref.title, '建议加 2 名开发：x');
		assert.equal(stored.ref.questions, undefined);
		assert.equal(stored.ref.action, 'add');
		assert.deepEqual(stored.ref.taskNumbers, {}, '卡不在看板上时不写卡号，界面按序号显示');
		assert.deepEqual(await service.autoAnswerDecisions(runtime.id), []);
		assert.equal(service.state.inbox[item.id].state, 'unread');
		assert.equal(planStaffingAdvice({ ...service.state, tasks: { t3: card('t3', 'pending', 0) } }, { now: Date.now(), inTurn: () => false, humanId: service.humanId() }).some((a) => a.role === 'developer'), false, '账本里的未读建议挡住重复');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('index.js records advice each PMO tick and learns the host limit from capacity refusals', async () => {
	const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
	assert.match(index, /for \(const advice of planStaffingAdvice\(state, \{ now, inTurn: \(id\) => turnsInFlight\.has\(id\), capacity: hostCapacity, humanId: projectRuntime\.service\.humanId\(\), wait: \(config\.staffingAdviceMinutes \?\? 30\) \* 60_000 \}\)\)/);
	assert.match(index, /staffingAdviceMinutes: z\.number\(\)\.step\(1\)\.min\(1\)\.max\(1440\)\.default\(30\)/);
	assert.match(index, /await projectRuntime\.service\.recordStaffingAdvice\(projectRuntime\.id, advice\)/);
	assert.equal((index.match(/noteHostCapacity\(error\);/g) ?? []).length, 2, '激活与投递两处');
});
