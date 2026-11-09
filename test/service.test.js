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
		await service.dispatch({ type: 'member.add', actor: human, payload: { name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { name: '沈舟', kind: 'agent', role: '架构' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { name: '林岚', kind: 'agent', role: '验收' } });
		await service.dispatch({
			type: 'project.create',
			actor: human,
			payload: { name: 'Main-Dev', goal: '把回归清干净', ownerId: 'a1' },
		});

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
		assert.equal(boot.thread.headSeq, 1);
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
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
