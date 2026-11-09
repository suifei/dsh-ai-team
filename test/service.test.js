import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';

const human = { kind: 'human', memberId: 'h1' };
const a1 = { kind: 'agent', memberId: 'a1' };
const a2 = { kind: 'agent', memberId: 'a2' };

test('TeamService drives a real ledger from project setup to accepted task and thread', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-service-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_test', fsync: false });
	const service = new TeamService({ ledger });
	try {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: '沈舟', kind: 'agent', role: '架构' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a2', name: '林岚', kind: 'agent', role: '验收' } });
		const bound = await service.dispatch({
			type: 'member.bind',
			actor: human,
			payload: { memberId: 'a1', sessionId: 'session-a1' },
		});
		assert.equal(bound.member.status, 'running');
		assert.equal(service.state.members.a1.sessionId, 'session-a1');
		assert.equal(service.state.members.a1.status, 'running');
		await service.dispatch({
			type: 'project.create',
			actor: human,
			payload: { name: 'Main-Dev', goal: '把回归清干净', ownerId: 'a1' },
		});
		await service.bindHostSession('session-host');
		assert.equal(service.state.hostSessionId, 'session-host');
		await service.dispatch({ type: 'project.owner.update', actor: human, projectId: 'prj_test', payload: { ownerMemberId: 'a1', reason: 'Lead' } });
		assert.equal(service.state.projects.prj_test.ownerMemberId, 'a1');
		const stream = await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_test', payload: { body: '把回归清干净' } });
		assert.equal(stream.entry.body, '把回归清干净');
		assert.equal(service.state.stream.at(-1).body, '把回归清干净');
		const config = await service.dispatch({
			type: 'member.config.update',
			actor: human,
			projectId: 'prj_test',
			payload: { memberId: 'a1', patch: { provider: 'p1', model: 'm1', maxTokens: 4096 }, reason: 'default model' },
		});
		assert.equal(config.config.model, 'm1');
		assert.equal(config.config.configVersion, 1);
		assert.equal(service.state.members.a1.config.model, 'm1');
		await assert.rejects(
			() => service.dispatch({ type: 'member.config.update', actor: a1, projectId: 'prj_test', payload: { memberId: 'a1', patch: { model: 'm2' } } }),
			(error) => error.code === 'E_UNAUTHORIZED',
		);
		const leadUpdate = await service.dispatch({
			type: 'member.config.update',
			actor: a1,
			projectId: 'prj_test',
			payload: { memberId: 'a2', patch: { provider: 'p2', model: 'm2' }, reason: 'Lead fallback' },
		});
		assert.equal(leadUpdate.config.model, 'm2');

		const failure = await service.recordMemberFailure('a2', {
			category: 'rate_limit', attempt: 1, retryable: true, provider: 'p2', model: 'm2', nextAction: 'retry',
		});
		assert.equal(failure.member.status, 'idle');
		assert.equal(service.state.members.a2.lastFailure.category, 'rate_limit');
		const recovered = await service.recordMemberRecovery('a2', 2, { model: 'm2' });
		assert.equal(recovered.member.status, 'running');
		assert.equal(service.state.members.a2.status, 'running');
		const authFailure = await service.recordMemberFailure('a2', {
			category: 'auth', attempt: 1, retryable: false, provider: 'p2', model: 'm2', nextAction: 'stop', message: 'invalid key',
		});
		assert.equal(authFailure.member.status, 'failed');
		assert.ok(authFailure.inboxItem !== null);
		const decisions = Object.values(service.state.inbox).filter((item) => item.requiresDecision);
		assert.equal(decisions.length, 1);
		assert.equal(decisions[0].ref.memberId, 'a2');
		await service.recordMemberRecovery('a2', 1, { model: 'm2' });

		const created = await service.dispatch({
			type: 'task.create',
			actor: human,
			projectId: 'prj_test',
			payload: { title: '修复登录回归', resultDefinition: '门禁全绿', ownerId: 'a1' },
		});
		assert.equal(created.task.status, 'pending');
		const taskId = created.task.id;
		const claimed = await service.dispatch({
			type: 'task.claim',
			actor: a1,
			projectId: 'prj_test',
			payload: { taskId, expectedRevision: created.task.revision },
		});
		assert.equal(claimed.task.status, 'in_progress');
		const submitted = await service.dispatch({
			type: 'task.submit',
			actor: a1,
			projectId: 'prj_test',
			payload: {
				taskId,
				expectedRevision: claimed.task.revision,
				summary: '已修复',
				evidence: [{ kind: 'path', value: 'test.log' }],
			},
		});
		assert.equal(submitted.task.status, 'pending_acceptance');

		const posted = await service.dispatch({
			type: 'thread.post',
			actor: a2,
			projectId: 'prj_test',
			payload: { taskId, baseSeq: 0, body: '我先复跑门禁。' },
		});
		assert.equal(posted.thread.headSeq, 1);
		assert.equal(service.state.threads[taskId].headSeq, 1);
		const mention = await service.dispatch({
			type: 'thread.post',
			actor: a2,
			projectId: 'prj_test',
			payload: { taskId, baseSeq: 1, body: '请 Human 决定：是否继续扩大范围。' },
		});
		assert.equal(mention.entry.authorId, 'a2');
		assert.equal(
			Object.values(service.state.inbox ?? {}).some((item) => item.memberId === 'h1' && item.ref?.taskId === taskId && item.ref?.entrySeq === mention.entry.seq),
			true,
		);
		assert.equal(await service.backfillHumanMentions(), 0);
		const decision = await service.dispatch({
			type: 'decision.request',
			actor: a1,
			projectId: 'prj_test',
			payload: { title: '需要拍板', taskId, questions: [{ text: '范围？', options: ['A', 'B'] }, '时间？'] },
		});
		assert.equal(decision.item.ref.questions.length, 2);
		assert.equal(decision.item.ref.questions[0].options.length, 2);
		const answered = await service.dispatch({
			type: 'decision.answer',
			actor: human,
			projectId: 'prj_test',
			payload: { itemId: decision.item.id, answers: [{ id: 'q1', value: 'A' }, { id: 'q2', value: '本周' }] },
		});
		assert.equal(answered.item.state, 'resolved');
		assert.match(answered.entry.body, /范围？: A/);

		const accepted = await service.dispatch({
			type: 'task.accept',
			actor: a2,
			projectId: 'prj_test',
			payload: { taskId, expectedRevision: submitted.task.revision, note: '门禁复跑通过' },
		});
		assert.equal(accepted.task.status, 'done');
		assert.equal(service.state.tasks[taskId].status, 'done');
		assert.equal(service.state.tasks[taskId].reviewerId, 'a2');

		const boot = service.bootstrap('prj_test', taskId);
		assert.equal(boot.projects.length, 1);
		assert.equal(boot.projects[0].name, 'Main-Dev');
		assert.equal(boot.tasks.length, 1);
		assert.equal(boot.tasks[0].status, 'done');
		assert.equal(boot.thread.headSeq, 3);
		assert.equal(boot.agents.length, 2);

		const converted = await service.dispatch({
			type: 'task.convert',
			actor: human,
			projectId: 'prj_test',
			payload: {
				sourceEventIds: [posted.entry.eventId ?? 'str_1'],
				title: '补一条回归证据',
				doneCriteria: '证据入 Thread',
				ownerId: 'a1',
			},
		});
		assert.equal(converted.task.originRefs.length, 1);
		assert.equal(service.state.tasks[converted.task.id].originRefs.length, 1);
		assert.deepEqual(service.state.followers, {});

		const failed = await service.dispatch({ type: 'member.fail', actor: human, payload: { memberId: 'a2', reason: 'session lost' } });
		assert.equal(failed.member.status, 'failed');
		assert.equal(service.state.members.a2.failure, 'session lost');
		const retired = await service.dispatch({ type: 'member.retire', actor: human, payload: { memberId: 'a2' } });
		assert.equal(retired.member.status, 'retired');
		assert.equal(service.state.members.a2.status, 'retired');
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
