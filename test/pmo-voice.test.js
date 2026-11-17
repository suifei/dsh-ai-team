import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { createTeamTool } from '../lib/host/member-tools.js';
import { describeWake, planWakes } from '../lib/host/waker.js';

// Core model: the PMO is the team's single voice to Human in the Main stream —
// it answers chat directly, announces the tasks it opens, and reports results
// back when a wave is done. Before this, members had no way to post to the Main
// stream at all, so "在吗" was forced into a Task and finished work never came
// back to the conversation (r08: Human only saw their own message).

const human = { kind: 'human', memberId: 'h1' };

async function withTeam(run) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-voice-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_v', fsync: false });
	const service = new TeamService({ ledger });
	try {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'lead', name: '墨渊', kind: 'agent' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'coder', name: '玄策', kind: 'agent' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'lead', sessionId: 's-lead' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'coder', sessionId: 's-coder' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'V', ownerId: 'lead' } });
		const tool = createTeamTool({ getState: () => service.state, dispatch: (command) => service.dispatch(command) });
		const as = (sessionId) => ({ agent: { id: sessionId } });
		await run({ service, tool, as });
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
}

test('only the PMO speaks in the Main stream, as a milestone that never reads as a Human instruction', async () => {
	await withTeam(async ({ service, tool, as }) => {
		const said = await tool.execute({ action: 'say', body: '在的，有什么需要？' }, as('s-lead'));
		assert.equal(said.ok, true);
		const entry = service.state.stream.at(-1);
		assert.equal(entry.authorId, 'lead');
		assert.equal(entry.kind, 'milestone');
		assert.equal(entry.body, '在的，有什么需要？');

		const denied = await tool.execute({ action: 'say', body: '我也来说两句' }, as('s-coder'));
		assert.equal(denied.ok, false);
		assert.equal(denied.error.code, 'E_UNAUTHORIZED');

		// A PMO post must not wake the PMO as if Human had spoken.
		const plans = planWakes(service.state, { event: { type: 'stream/posted', payload: entry, seq: entry.seq } }, { agentId: 'lead' });
		assert.deepEqual(plans, []);
	});
});

test('say attaches only real task ids as cards', async () => {
	await withTeam(async ({ service, tool, as }) => {
		const created = await tool.execute({ action: 'create', title: '3 种排序', resultDefinition: 'node test.js 全部通过', ownerId: 'coder' }, as('s-lead'));
		const said = await tool.execute({ action: 'say', body: '已安排玄策实现', taskIds: [created.task.id, 'tsk_missing', created.task.id] }, as('s-lead'));
		assert.equal(said.ok, true);
		assert.deepEqual(service.state.stream.at(-1).taskIds, [created.task.id]);
	});
});

test('the last acceptance on the board wakes the PMO to report back; earlier ones do not', async () => {
	await withTeam(async ({ service, tool, as }) => {
		const first = await tool.execute({ action: 'create', title: 'A', resultDefinition: 'x', ownerId: 'coder' }, as('s-lead'));
		const second = await tool.execute({ action: 'create', title: 'B', resultDefinition: 'x', ownerId: 'coder' }, as('s-lead'));
		const finish = async (task) => {
			const claimed = await tool.execute({ action: 'claim', taskId: task.id, expectedRevision: task.revision }, as('s-coder'));
			const submitted = await tool.execute({ action: 'submit', taskId: task.id, expectedRevision: claimed.task.revision, summary: 'done', evidence: ['node test.js'] }, as('s-coder'));
			const accepted = await service.dispatch({ type: 'task.accept', actor: human, projectId: 'prj_v', payload: { taskId: task.id, expectedRevision: submitted.task.revision } });
			return planWakes(service.state, { event: { type: 'task/accepted', payload: { taskId: task.id }, seq: service.state.lastSeq }, task: accepted.task }, {});
		};
		const afterFirst = await finish(first.task);
		assert.equal(afterFirst.some((plan) => plan.reason === 'wave_done'), false, 'B is still open');
		const afterSecond = await finish(second.task);
		const report = afterSecond.find((plan) => plan.reason === 'wave_done');
		assert.equal(report?.memberId, 'lead');
		const prompt = describeWake(report, service.state);
		assert.match(prompt, /action=say/);
		// il2c 11-16：旧提示词「只汇报，不要在本回合续开新任务」+ wave_done 消耗新进展 = 看板空转 7 小时。
		// 自动推进开启时，汇报完在同一回合判断下一步（预算由建卡门禁把关）。
		assert.match(prompt, /同一回合里接着判断下一步/);
		assert.match(prompt, /不要把下一步推迟到某个时间点或等 Human 说「继续」/);
		assert.doesNotMatch(prompt, /不要在本回合续开新任务/);
		// 自动推进关闭：只汇报并写明建议，由 Human 决定。
		await service.dispatch({ type: 'project.pmo.update', actor: human, projectId: 'prj_v', payload: { projectId: 'prj_v', pmoAuto: false } });
		const replanned = planWakes(service.state, { event: { type: 'task/accepted', payload: { taskId: second.task.id }, seq: service.state.lastSeq } }, {});
		const manual = describeWake(replanned.find((plan) => plan.reason === 'wave_done'), service.state);
		assert.match(manual, /PMO 自动推进已关闭/);
		assert.doesNotMatch(manual, /同一回合里接着判断下一步/);
	});
});

test('a Human message no longer forces a Task: the PMO decides between answering and opening cards', async () => {
	await withTeam(async ({ service }) => {
		const posted = await service.dispatch({ type: 'stream.post', actor: human, payload: { body: '在吗' } });
		const plans = planWakes(service.state, { event: { type: 'stream/posted', payload: posted.entry, seq: posted.entry.seq } }, {});
		const wake = plans.find((plan) => plan.reason === 'human_message');
		assert.equal(wake.memberId, 'lead');
		const prompt = wake.prompt ?? describeWake(wake, service.state);
		assert.doesNotMatch(prompt, /必须.*创建至少一个 Task/);
		assert.match(prompt, /不建卡/);
		assert.match(prompt, /action=say/);
	});
});

test('a member Human @-mentioned answers that mention once in the Main stream, then the floor returns to the PMO (il2c 11-17 21:44)', async () => {
	// il2c 11-17 21:44：Human「@tony老师 hi」，tony 老师被直接叫醒，可 say 被拒，只能请墨渊代发。
	await withTeam(async ({ service, tool, as }) => {
		await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_v', payload: { body: '@玄策 hi，进度如何？' } });
		const answered = await tool.execute({ action: 'say', body: '在推 #3，今晚交单。' }, as('s-coder'));
		assert.equal(answered.ok, true);
		assert.deepEqual([service.state.stream.at(-1).authorId, service.state.stream.at(-1).kind], ['coder', 'milestone']);
		const again = await tool.execute({ action: 'say', body: '再补一句' }, as('s-coder'));
		assert.equal(again.ok, false);
		assert.match(again.error.message, /@-mentioned/);
		// 下一次点名再换一次发言；没被点名的普通 Human 消息不给发言权。
		await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_v', payload: { body: '大家辛苦' } });
		assert.equal((await tool.execute({ action: 'say', body: '不客气' }, as('s-coder'))).ok, false);
		await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_v', payload: { body: '@玄策 再确认下' } });
		assert.equal((await tool.execute({ action: 'say', body: '确认，今晚交单。' }, as('s-coder'))).ok, true);
		assert.equal((await tool.execute({ action: 'say', body: '照常发言' }, as('s-lead'))).ok, true);
	});
});
