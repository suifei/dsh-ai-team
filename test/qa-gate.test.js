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
	await service.dispatch({ type: 'project.create', actor: human, projectId: PROJECT_ID, payload: { name: 'P', goal: 'g', ownerId: 'w1' } });

	const created = await service.dispatch({
		type: 'task.create', actor: human, projectId: PROJECT_ID,
		payload: { title: 'QA 卡', resultDefinition: 'Thread 有 ok', ownerId: 'w1', qaRequired: true },
	});
	assert.equal(created.task.qaRequired, true);
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
	const accepted = await service.dispatch({
		type: 'task.accept', actor: qa, projectId: PROJECT_ID,
		payload: { taskId: created.task.id, expectedRevision: submitted.task.revision, note: 'QA ok' },
	});
	assert.equal(accepted.task.status, 'done');
	assert.equal(service.state.tasks[created.task.id].lastReview.reviewerId, 'q1');
});
