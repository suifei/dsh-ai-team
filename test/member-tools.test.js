import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { createTeamTool } from '../lib/host/member-tools.js';

const human = { kind: 'human', memberId: 'h1' };

test('the team tool reads, claims, submits, threads and accepts through real TeamService', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-tool-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_test', fsync: false });
	const service = new TeamService({ ledger });
	try {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: '沈舟', kind: 'agent' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a2', name: '林岚', kind: 'agent' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's1' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a2', sessionId: 's2' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { name: 'P', ownerId: 'a1' } });
		const created = await service.dispatch({
			type: 'task.create', actor: human, projectId: 'prj_test',
			payload: { title: 'T', resultDefinition: 'done', ownerId: 'a1' },
		});
		const tool = createTeamTool({ getState: () => service.state, dispatch: (command) => service.dispatch(command) });
		const exec = (sessionId) => ({ agent: { id: sessionId } });

		const tasks = await tool.execute({ action: 'tasks' }, exec('s1'));
		assert.equal(tasks.ok, true);
		assert.equal(tasks.tasks[0].id, created.task.id);

		const leadCreate = await tool.execute({
			action: 'create', title: 'Lead 开的卡', resultDefinition: 'a2 认领并完成', ownerId: 'a2',
		}, exec('s1'));
		assert.equal(leadCreate.ok, true);
		assert.equal(leadCreate.task.status, 'pending');
		assert.equal(leadCreate.task.owner, '林岚');
		const a2Claim = await tool.execute({
			action: 'claim', taskId: leadCreate.task.id, expectedRevision: leadCreate.task.revision,
		}, exec('s2'));
		assert.equal(a2Claim.ok, true);
		assert.equal(a2Claim.task.status, 'in_progress');

		const claim = await tool.execute({
			action: 'claim', taskId: created.task.id, expectedRevision: created.task.revision,
		}, exec('s1'));
		assert.equal(claim.ok, true);
		assert.equal(claim.task.status, 'in_progress');

		const submit = await tool.execute({
			action: 'submit', taskId: created.task.id, expectedRevision: claim.task.revision,
			summary: 'done', evidence: ['test.log'],
		}, exec('s1'));
		assert.equal(submit.ok, true);
		assert.equal(submit.task.status, 'pending_acceptance');

		const thread = await tool.execute({ action: 'thread', taskId: created.task.id }, exec('s2'));
		assert.equal(thread.ok, true);
		assert.equal(thread.headSeq, 0);
		const reply = await tool.execute({
			action: 'reply', taskId: created.task.id, baseSeq: thread.headSeq, body: '复跑通过',
		}, exec('s2'));
		assert.equal(reply.ok, true);
		assert.equal(reply.headSeq, 1);

		const accept = await tool.execute({
			action: 'accept', taskId: created.task.id, expectedRevision: submit.task.revision, note: 'ok',
		}, exec('s2'));
		assert.equal(accept.ok, true);
		assert.equal(accept.task.status, 'done');

		const selfReview = await tool.execute({
			action: 'requestChanges', taskId: created.task.id, expectedRevision: accept.task.revision, note: 'x',
		}, exec('s1'));
		assert.equal(selfReview.ok, false);
		assert.equal(selfReview.error.code, 'E_INVALID_STATE');

		const info = await tool.execute({ action: 'member', memberId: 'a2' }, exec('s1'));
		assert.equal(info.ok, true);
		assert.equal(info.member.name, '林岚');
		const note = await tool.execute({ action: 'note', text: '先读 Thread 再回复' }, exec('s1'));
		assert.equal(note.ok, true);
		assert.deepEqual(note.member.notes, ['先读 Thread 再回复']);
		const skill = await tool.execute({ action: 'skill', skill: 'nuwa-skill' }, exec('s1'));
		assert.equal(skill.ok, true);
		assert.deepEqual(skill.member.skills, ['nuwa-skill']);
		const recall = await tool.execute({ action: 'recall', query: 'Thread' }, exec('s1'));
		assert.equal(recall.ok, true);
		assert.ok(recall.hits.some((hit) => hit.kind === 'note' && hit.text.includes('Thread')));
		const distilled = await tool.execute({
			action: 'distill', memberId: 'a2', personality: '复核证据优先，先跑门禁。', reason: 'Lead distill',
		}, exec('s1'));
		assert.equal(distilled.ok, true);
		assert.equal(distilled.member.distillVersion, 1);
		assert.match(distilled.member.personality, /门禁/);

		const notMember = await tool.execute({ action: 'tasks' }, exec('other'));
		assert.equal(notMember.ok, false);
		assert.equal(notMember.error.code, 'E_NOT_MEMBER');
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
