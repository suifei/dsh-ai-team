// 团队推进纪律：不把行动挂在钟点上、不提前收兵、个性不无限膨胀。
// 正例 / 反例全部取自 il2c 实机会话（.ptc/rounds/r35，7413 条助手回复，宽规则误报已逐条排除）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectDeferral, deferralCorrection, registerTeamDiscipline, TEAM_DISCIPLINE_TEXT } from '../lib/runtime/deferral-guard.js';
import { PERSONALITY_LIMIT, checkPersonality } from '../lib/domain/member-profile.js';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { planWakes, describeWake } from '../lib/host/waker.js';

const DEFERRALS = [
	'六席会议意见全部注入装载面，评审官并已立约今夜 03:17 自然相裁决点（cron.log 携 11-17 相行⇒夜拍环全闭；仍零拍⇒升「投递/触发相」重查——这条我也会在明早盯一眼结果）。',
	'52h 无拍因由=11-15 凌晨窗口 Harness 离线跳拍，不是条目失活。恢复形制=今夜自然相，无需人工修。',
	'账上的两个时点 - 今夜 03:17：夜拍环自然相裁决点（评审官值守）',
	'done 后我留一份完整收口摘要，明早你直接看结论即可。',
	'先放着，等到 22:00 再统一跑。',
	'We will re-run it tonight and check the result.',
];

const NOT_DEFERRALS = [
	'白砚在 23:03:05 被唤醒，现在正在复点。',
	'wake 已于 02:44:39（#102）派发。',
	'02:59 前无票面动作我即点名催办。',
	'夜间你不用盯了，268 波开卡就是常规滚动。',
	'夜拍环停摆≈52h（三盘锚全冻 11-14）。',
	'板末拍 at≡11-16 03:05:01+08，早于 03:17 触发点 12min。',
	'commit 单拍闭」制下窗口收敛——我不预干预。',
	'每 2 分钟查一次 CI，最多盯 20 分钟，超时就换路。',
];

test('detectDeferral catches actions hung on a clock time and ignores narration of past times', () => {
	for (const text of DEFERRALS) assert.notEqual(detectDeferral(text), null, `should flag: ${text}`);
	for (const text of NOT_DEFERRALS) assert.equal(detectDeferral(text), null, `should not flag: ${text}`);
	assert.equal(detectDeferral(''), null);
	assert.equal(detectDeferral(undefined), null);
	assert.match(detectDeferral(DEFERRALS[0]).phrase, /今夜 03:17/);
});

test('the correction quotes the phrase and leaves an exit for a real clock dependency', () => {
	const text = deferralCorrection('今夜 03:17 自然相裁决点');
	assert.match(text, /今夜 03:17 自然相裁决点/);
	assert.match(text, /现在手动跑一次/);
	assert.match(text, /真实时钟/);
});

function harness({ stopped = false } = {}) {
	const sections = [];
	const listeners = new Map();
	const diag = [];
	const team = new Map([['s-host', { projectId: 'prj', stopped }], ['s-member', { projectId: 'prj', stopped }]]);
	const guard = registerTeamDiscipline({
		systemPrompt: {
			section: (section) => { sections.push(section); return () => sections.splice(sections.indexOf(section), 1); },
			getSectionOrder: (name) => (name === 'TEAM_POLICY' ? 600 : 0),
		},
		on: (name, listener) => { listeners.set(name, listener); return () => listeners.delete(name); },
		teamProjectOf: (sessionId) => team.get(sessionId) ?? null,
		diag: { append: (row) => diag.push(row) },
		newId: () => 'm-1',
	});
	const agent = (id, parentSession) => {
		const steers = [];
		return { id, steers, steer: (message) => steers.push(message), session: { header: { parentSession } } };
	};
	const say = (sessionId, text, parentSession) => guard.observe({ id: sessionId, header: { parentSession } }, { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '今夜再说' }, { type: 'text', text }] } } });
	return { guard, sections, listeners, diag, agent, say };
}

test('the discipline section reaches team sessions only: the PMO host and members, not the Human chat', () => {
	const { sections, guard } = harness();
	assert.equal(sections.length, 1);
	const [section] = sections;
	assert.equal(section.order, 600);
	assert.equal(section.interpolate, false);
	assert.equal(section.text({ agent: { id: 's-host' } }), TEAM_DISCIPLINE_TEXT);
	assert.equal(section.text({ agent: { id: 's-member' } }), TEAM_DISCIPLINE_TEXT);
	assert.equal(section.text({ agent: { id: 's-someone-else' } }), '');
	assert.equal(section.text({}), '');
	// 成员激活的第一个回合：账本还没记下 sessionId，靠父会话（PMO 宿主）认出；PMO 派生的临时子智能体同理。
	assert.equal(section.text({ agent: { id: 's-new-child', session: { header: { parentSession: 's-host' } } } }), TEAM_DISCIPLINE_TEXT);
	assert.equal(section.text({ agent: { id: 's-other-child', session: { header: { parentSession: 's-human-chat' } } } }), '');
	assert.match(TEAM_DISCIPLINE_TEXT, /不把行动挂在钟点上/);
	assert.match(TEAM_DISCIPLINE_TEXT, /不提前收兵/);
	guard.dispose();
	assert.equal(sections.length, 0, 'dispose removes the section');
});

test('a team turn that ends on a clock deferral is steered once, in the same turn', async () => {
	const { listeners, diag, agent, say } = harness();
	const stopping = listeners.get('agent/turn-stopping');
	assert.equal(typeof stopping, 'function');
	const host = agent('s-host');
	say('s-host', DEFERRALS[0]);
	await stopping({ agent: host, turn: 7 });
	assert.equal(host.steers.length, 1);
	const [message] = host.steers;
	assert.equal(message.role, 'user');
	assert.deepEqual(message.source, { kind: 'ai-team' });
	assert.match(message.content[0].text, /今夜 03:17/);
	assert.equal(diag.at(-1).ev, 'team.deferral.steered');
	// 模型回应后同一回合再次收尾：放行（它可能写明了真实的时钟依赖）。
	await stopping({ agent: host, turn: 7 });
	assert.equal(host.steers.length, 1);
	// 下一回合重新判定。
	await stopping({ agent: host, turn: 8 });
	assert.equal(host.steers.length, 2);
});

test('no steering without a deferral, outside the team, after turn/start resets, or when the project is stopped', async () => {
	const { listeners, guard, agent, say } = harness();
	const stopping = listeners.get('agent/turn-stopping');
	const member = agent('s-member');
	say('s-member', '格⑤ 已落刀，现在跑终闸。');
	await stopping({ agent: member, turn: 1 });
	assert.equal(member.steers.length, 0);
	const outsider = agent('s-human-chat');
	say('s-human-chat', DEFERRALS[0]);
	await stopping({ agent: outsider, turn: 1 });
	assert.equal(outsider.steers.length, 0, 'the Human’s own chat is not governed');
	const child = agent('s-pmo-child', 's-host');
	say('s-pmo-child', DEFERRALS[0], 's-host');
	await stopping({ agent: child, turn: 1 });
	assert.equal(child.steers.length, 1, 'a subagent spawned by the PMO is team work too');
	say('s-member', DEFERRALS[0]);
	guard.observe({ id: 's-member' }, { type: 'turn/start' });
	await stopping({ agent: member, turn: 2 });
	assert.equal(member.steers.length, 0, 'a new turn forgets the previous reply');

	const stoppedTeam = harness({ stopped: true });
	const host = stoppedTeam.agent('s-host');
	stoppedTeam.say('s-host', DEFERRALS[0]);
	await stoppedTeam.listeners.get('agent/turn-stopping')({ agent: host, turn: 1 });
	assert.equal(host.steers.length, 0, 'a stopped project is not pushed to act');
});

test('a host without systemPrompt still gets the turn-stopping guard and records the gap', () => {
	const diag = [];
	const listeners = new Map();
	registerTeamDiscipline({ on: (name, listener) => { listeners.set(name, listener); return () => {}; }, teamProjectOf: () => null, diag: { append: (row) => diag.push(row) }, newId: () => 'x' });
	assert.equal(diag[0].ev, 'team.discipline.section.unavailable.fail');
	assert.equal(typeof listeners.get('agent/turn-stopping'), 'function');
});

test('personality is capped: evolve must rewrite, not append', async () => {
	assert.equal(checkPersonality('  先定义结果，再拆 Task。  ').personality, '先定义结果，再拆 Task。');
	assert.equal(checkPersonality('').ok, false);
	const long = '候'.repeat(PERSONALITY_LIMIT + 1);
	const verdict = checkPersonality(long);
	assert.equal(verdict.ok, false);
	assert.match(verdict.reason, /Rewrite the whole personality/);

	const root = await mkdtemp(join(tmpdir(), 'ai-team-personality-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_p', fsync: false });
	try {
		const human = { kind: 'human', memberId: 'h1' };
		const agent = { kind: 'agent', memberId: 'coder' };
		const service = new TeamService({ ledger });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'lead', name: '墨渊', kind: 'agent', role: '主理人' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'coder', name: '玄策', kind: 'agent', role: '编程' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'P', ownerId: 'lead' } });
		await assert.rejects(
			service.dispatch({ type: 'member.evolve', actor: agent, projectId: 'prj_p', payload: { personality: long } }),
			(error) => error.code === 'E_INVALID_ARGUMENT' && /limit is 600/.test(error.message),
		);
		await service.dispatch({ type: 'member.evolve', actor: agent, projectId: 'prj_p', payload: { personality: '先读结果定义，再动手；每条结论带实测证据。' } });
		assert.equal(service.state.members.coder.personality, '先读结果定义，再动手；每条结论带实测证据。');
		await assert.rejects(
			service.dispatch({ type: 'member.distill', actor: human, projectId: 'prj_p', payload: { memberId: 'coder', personality: long } }),
			(error) => error.code === 'E_INVALID_ARGUMENT',
		);

		// 已经超长的个性（升级前写入的）：复盘提示词点明字数，要求精简重写。
		await service.dispatch({ type: 'member.profile.update', actor: human, projectId: 'prj_p', payload: { memberId: 'coder', personality: '冻'.repeat(2386) } });
		const created = await service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_p', payload: { title: '排序', resultDefinition: 'x', ownerId: 'lead', assigneeId: 'coder' } });
		const claimed = await service.dispatch({ type: 'task.claim', actor: agent, projectId: 'prj_p', payload: { taskId: created.task.id, expectedRevision: created.task.revision } });
		const submitted = await service.dispatch({ type: 'task.submit', actor: agent, projectId: 'prj_p', payload: { taskId: created.task.id, expectedRevision: claimed.task.revision, summary: 'ok', evidence: ['node t.js'] } });
		await service.dispatch({ type: 'task.accept', actor: human, projectId: 'prj_p', payload: { taskId: created.task.id, expectedRevision: submitted.task.revision } });
		const reflection = planWakes(service.state, { event: { type: 'task/accepted', payload: { taskId: created.task.id }, seq: service.state.lastSeq } }, {})
			.find((plan) => plan.reason === 'reflection_requested');
		const prompt = describeWake(reflection, service.state);
		assert.match(prompt, /你的个性现在 2386 字，已超过 600 字上限/);
		assert.match(prompt, /整段重写而不是追加/);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
