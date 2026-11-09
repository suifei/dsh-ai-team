import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';

const PROJECT_ID = 'prj_test';

function temp(t) {
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-profile-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test('member profile, self-evolution, talent pool and takeover are append-only', async (t) => {
	const dir = temp(t);
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const service = new TeamService({ ledger });
	const human = { kind: 'human', memberId: 'h1' };
	const a1 = { kind: 'agent', memberId: 'a1' };
	const a2 = { kind: 'agent', memberId: 'a2' };

	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'h1', name: '你', kind: 'human', role: 'Human' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'a1', name: '沈舟', role: 'Lead' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'a2', name: '林岚', role: 'Reviewer' } });
	await service.dispatch({ type: 'project.create', actor: human, projectId: PROJECT_ID, payload: { name: 'P', goal: 'g', ownerId: 'a1' } });

	const updated = await service.dispatch({
		type: 'member.profile.update',
		actor: human,
		projectId: PROJECT_ID,
		payload: { memberId: 'a1', name: '沈舟·二', role: 'Lead + QA', personality: '先复跑，再下结论。' },
	});
	assert.equal(updated.member.name, '沈舟·二');
	assert.equal(updated.member.profileVersion, 2);
	assert.equal(service.state.members.a1.personality, '先复跑，再下结论。');
	const blankPersonality = await service.dispatch({
		type: 'member.profile.update',
		actor: human,
		projectId: PROJECT_ID,
		payload: { memberId: 'a1', name: '沈舟·三', personality: '' },
	});
	assert.equal(blankPersonality.member.name, '沈舟·三');
	assert.equal(blankPersonality.member.personality, '先复跑，再下结论。');

	const evolved = await service.dispatch({
		type: 'member.evolve',
		actor: a1,
		projectId: PROJECT_ID,
		payload: { personality: '先复跑，再下结论；把每次失败写进证据。' },
	});
	assert.equal(evolved.member.distillVersion, 1);
	assert.equal(evolved.member.profileVersion, 4);
	const distilled = await service.dispatch({
		type: 'member.distill',
		actor: human,
		projectId: PROJECT_ID,
		payload: { memberId: 'a1', personality: '先复跑，再下结论；QA 优先。', reason: 'Human re-distill' },
	});
	assert.equal(distilled.member.distillVersion, 2);
	assert.equal(distilled.member.profileVersion, 5);
	assert.match(distilled.member.personality, /QA 优先/);
	await assert.rejects(
		() => service.dispatch({ type: 'member.evolve', actor: a2, projectId: PROJECT_ID, payload: { memberId: 'a1', personality: 'x' } }),
		(error) => error.code === 'E_UNAUTHORIZED',
	);

	await service.dispatch({ type: 'member.note', actor: a1, projectId: PROJECT_ID, payload: { text: 'Thread 先读 headSeq' } });
	await service.dispatch({ type: 'member.skill', actor: a1, projectId: PROJECT_ID, payload: { name: 'nuwa-skill' } });
	assert.deepEqual(service.state.members.a1.notes, ['Thread 先读 headSeq']);
	assert.deepEqual(service.state.members.a1.skills, ['nuwa-skill']);
	await assert.rejects(
		() => service.dispatch({ type: 'member.note', actor: a2, projectId: PROJECT_ID, payload: { memberId: 'a1', text: 'x' } }),
		(error) => error.code === 'E_UNAUTHORIZED',
	);
	const task = await service.dispatch({
		type: 'task.create',
		actor: human,
		projectId: PROJECT_ID,
		payload: { title: '遗留任务', resultDefinition: 'Thread 有结论', ownerId: 'a2' },
	});
	await service.dispatch({ type: 'task.claim', actor: a2, projectId: PROJECT_ID, payload: { taskId: task.task.id, expectedRevision: task.task.revision } });
	const left = await service.dispatch({ type: 'member.leave', actor: human, projectId: PROJECT_ID, payload: { memberId: 'a2' } });
	assert.equal(left.member.status, 'retired');
	assert.equal(left.member.talentPool, true);
	assert.equal(left.unfinishedTasks.length, 1);

	const rejoined = await service.dispatch({ type: 'member.rejoin', actor: human, projectId: PROJECT_ID, payload: { memberId: 'a2' } });
	assert.equal(rejoined.member.status, 'provisioning');
	assert.equal(rejoined.member.talentPool, false);
	const taken = await service.dispatch({ type: 'member.takeover', actor: human, projectId: PROJECT_ID, payload: { fromMemberId: 'a2', toMemberId: 'a1', reason: '原成员离开' } });
	assert.equal(taken.tasks.length, 1);
	const latest = service.state.tasks[task.task.id];
	assert.equal(latest.ownerId, 'a1');
	assert.equal(latest.assigneeId, 'a1');
	assert.deepEqual(latest.claimHistory, ['a2', 'a1']);
	assert.equal(latest.takeoverHistory[0].from, 'a2');

	assert.ok(ledger.events.some((event) => event.type === 'member/profile-updated'));
	assert.ok(ledger.events.some((event) => event.type === 'member/distilled'));
	assert.ok(ledger.events.some((event) => event.type === 'member/left-team'));
	assert.ok(ledger.events.some((event) => event.type === 'task/taken-over'));
});
