import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { eligibleReviewers } from '../lib/domain/member-profile.js';

const PROJECT_ID = 'prj_qa';

test('qaRequired routes the reviewer to QA and rejects non-QA acceptance', async (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-qa-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const service = new TeamService({ ledger });
	const human = { kind: 'human', memberId: 'h1' };
	const worker = { kind: 'agent', memberId: 'w1' };
	const qa = { kind: 'agent', memberId: 'q1' };

	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'h1', name: '你', kind: 'human' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'w1', name: '工人', role: 'Dev' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'q1', name: '关关', role: 'QA 质量' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload: { id: 'n1', name: '路人', role: 'Reviewer' } });
	await service.dispatch({ type: 'project.create', actor: human, projectId: PROJECT_ID, payload: { workspacePath: process.cwd(), name: 'P', goal: 'g', ownerId: 'w1' } });

	const created = await service.dispatch({
		type: 'task.create', actor: human, projectId: PROJECT_ID,
		payload: { title: 'QA 卡', resultDefinition: 'Thread 有 ok', ownerId: 'w1', qaRequired: true, qaChecklist: ['Thread 有 ok', '证据存在'] },
	});
	assert.equal(created.task.qaRequired, true);
	assert.deepEqual(created.task.qaChecklist, ['Thread 有 ok', '证据存在']);
	await service.dispatch({ type: 'task.claim', actor: worker, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: 1 } });
	await service.dispatch({ type: 'thread.post', actor: worker, projectId: PROJECT_ID, payload: { taskId: created.task.id, baseSeq: 0, body: 'ok' } });
	const submitted = await service.dispatch({
		type: 'task.submit', actor: worker, projectId: PROJECT_ID,
		payload: { taskId: created.task.id, expectedRevision: 2, summary: 'done', evidence: [{ kind: 'text', value: 'thread' }] },
	});
	assert.equal(submitted.task.status, 'pending_acceptance');

	const reviewers = eligibleReviewers(service.state, service.state.tasks[created.task.id]);
	assert.deepEqual(reviewers.map((member) => member.id), ['q1']);

	await assert.rejects(
		() => service.dispatch({ type: 'task.accept', actor: { kind: 'agent', memberId: 'n1' }, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: submitted.task.revision } }),
		(error) => error.code === 'E_INVALID_STATE',
	);
	await service.dispatch({ type: 'task.follow', actor: human, projectId: PROJECT_ID, payload: { taskId: created.task.id, following: true } });
	await assert.rejects(
		() => service.dispatch({
			type: 'task.accept', actor: qa, projectId: PROJECT_ID,
			payload: { taskId: created.task.id, expectedRevision: submitted.task.revision, note: 'QA ok' },
		}),
		(error) => error.code === 'E_INVALID_STATE',
	);
	const accepted = await service.dispatch({
		type: 'task.accept', actor: qa, projectId: PROJECT_ID,
		payload: {
			taskId: created.task.id, expectedRevision: submitted.task.revision, note: 'QA ok',
			checks: [{ item: 'Thread 有 ok', passed: true }, { item: '证据存在', passed: true }],
		},
	});
	assert.equal(accepted.task.status, 'done');
	assert.equal(service.state.tasks[created.task.id].lastReview.reviewerId, 'q1');
	const report = Object.values(service.state.inbox).find((item) => item.type === 'followed_task_update' && item.ref.taskId === created.task.id);
	assert.ok(report !== undefined);
	assert.equal(report.memberId, 'h1');
});

test('lead delivery-only: the lead is never a review candidate, duty qa ranks as QA, and the lead cannot accept or send back', async () => {
	const { isLeadMember, isReviewCandidate } = await import('../lib/domain/policy.js');
	const { isQaMember } = await import('../lib/domain/member-profile.js');
	const state = {
		projects: { p: { id: 'p', ownerMemberId: 'mem_lead' } },
		members: {
			mem_lead: { id: 'mem_lead', kind: 'agent', status: 'idle', role: '主理人', createdAt: '1' },
			mem_pi: { id: 'mem_pi', kind: 'agent', status: 'idle', role: '课题负责人', duty: 'lead', createdAt: '2' },
			mem_fact: { id: 'mem_fact', kind: 'agent', status: 'idle', role: '事实核查', duty: 'qa', createdAt: '9' },
			mem_dev: { id: 'mem_dev', kind: 'agent', status: 'idle', role: '执行', createdAt: '3' },
			mem_w: { id: 'mem_w', kind: 'agent', status: 'idle', role: '写手', createdAt: '4' },
		},
	};
	const task = { id: 't', assigneeId: 'mem_dev', claimHistory: ['mem_dev'], qaRequired: false };
	assert.equal(isLeadMember(state.members.mem_lead, state), true, 'project owner is the lead');
	assert.equal(isLeadMember(state.members.mem_pi, state), true, 'duty lead is a lead');
	assert.equal(isQaMember(state.members.mem_fact), true, '「事实核查」靠 duty: qa 认成验收人');
	assert.deepEqual(eligibleReviewers(state, task).map((m) => m.id), ['mem_fact', 'mem_w'], 'QA by duty first; leads never');
	assert.equal(isReviewCandidate(state.members.mem_lead, task), true, 'without state the old check stands (fold replay unaffected)');
});

test('lead delivery-only: TeamService refuses accept and request_changes from the lead; the QA member still accepts', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-lead-'));
	try {
		const ledger = openLedger({ dir, projectId: PROJECT_ID });
		const service = new TeamService({ ledger });
		const human = { kind: 'human', memberId: 'h1' };
		const add = (payload) => service.dispatch({ type: 'member.add', actor: human, projectId: PROJECT_ID, payload });
		await add({ id: 'h1', name: '你', kind: 'human' });
		await add({ id: 'l1', name: '墨渊', role: '主理人' });
		await add({ id: 'w1', name: '青岚', role: '执行' });
		await add({ id: 'f1', name: '稽真', role: '事实核查', duty: 'qa' });
		await service.dispatch({ type: 'project.create', actor: human, projectId: PROJECT_ID, payload: { workspacePath: process.cwd(), name: 'P', goal: 'g', ownerId: 'l1' } });
		const created = await service.dispatch({ type: 'task.create', actor: human, projectId: PROJECT_ID, payload: { title: '写一章', resultDefinition: '章节文件存在', ownerId: 'w1' } });
		const worker = { kind: 'agent', memberId: 'w1' };
		await service.dispatch({ type: 'task.claim', actor: worker, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: 1 } });
		const submitted = await service.dispatch({ type: 'task.submit', actor: worker, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: 2, summary: 'done', evidence: [{ kind: 'text', value: 'ch1.md' }] } });
		const lead = { kind: 'agent', memberId: 'l1' };
		const refused = (error) => error.code === 'E_REVIEWER_NOT_ELIGIBLE' && /lead does not review/.test(error.message);
		await assert.rejects(() => service.dispatch({ type: 'task.accept', actor: lead, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: submitted.task.revision, note: 'ok' } }), refused);
		await assert.rejects(() => service.dispatch({ type: 'task.request_changes', actor: lead, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: submitted.task.revision, note: '再改改' } }), refused);
		assert.deepEqual(eligibleReviewers(service.state, service.state.tasks[created.task.id]).map((m) => m.id), ['f1']);
		const accepted = await service.dispatch({ type: 'task.accept', actor: { kind: 'agent', memberId: 'f1' }, projectId: PROJECT_ID, payload: { taskId: created.task.id, expectedRevision: submitted.task.revision, note: '核查通过' } });
		assert.equal(accepted.task.status, 'done');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
