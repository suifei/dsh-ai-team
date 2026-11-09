import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '../lib/host/project-runtime.js';

test('ProjectRuntime owns one ledger and reopens the same Project', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-runtime-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const first = await ProjectRuntime.open({ rootDir: root, projectId: 'p1' });
	assert.equal(first.ledger.projectId, 'p1');
	assert.equal(first.service.state.members.mem_human.kind, 'human');
	assert.equal(first.service.state.projects.p1.name, '我的项目');
	await first.service.dispatch({
		type: 'task.create',
		actor: { kind: 'human', memberId: 'mem_human' },
		projectId: 'p1',
		payload: { title: '持久任务', resultDefinition: 'done', ownerId: 'mem_human' },
	});
	first.close();

	const reopened = await ProjectRuntime.open({ rootDir: root, projectId: 'p1' });
	assert.equal(reopened.service.state.tasks[Object.keys(reopened.service.state.tasks)[0]].title, '持久任务');
	reopened.close();

	const second = await ProjectRuntime.open({ rootDir: root, projectId: 'p2' });
	assert.equal(second.service.state.projects.p2.name, '我的项目');
	assert.equal(Object.keys(second.service.state.tasks).length, 0);
	second.close();
});
