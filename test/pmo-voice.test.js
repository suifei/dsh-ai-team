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
		assert.match(prompt, /不要在本回合续开新任务/);
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
