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
	assert.equal(first.service.state.members.mem_lead.name, '墨渊');
	assert.equal(first.service.state.members.mem_maker.name, '青岚');
	assert.equal(first.service.state.members.mem_check.name, '白砚');
	assert.equal(first.service.state.members.mem_lead.role, '主理人');
	assert.equal(first.service.state.members.mem_maker.role, '执行');
	assert.equal(first.service.state.members.mem_check.role, '验收');
	assert.equal(first.service.state.projects.p1.name, '我的项目');
	assert.equal(first.service.state.projects.p1.ownerMemberId, 'mem_lead');
	await first.service.dispatch({
		type: 'task.create',
		actor: { kind: 'human', memberId: 'mem_human' },
		projectId: 'p1',
		payload: { title: '持久任务', resultDefinition: 'done', ownerId: 'mem_human' },
	});
	first.close();

	const reopened = await ProjectRuntime.open({ rootDir: root, projectId: 'p1' });
	assert.equal(reopened.service.state.tasks[Object.keys(reopened.service.state.tasks)[0]].title, '持久任务');
	assert.equal(Object.keys(reopened.service.state.members).length, 5);
	reopened.close();

	const second = await ProjectRuntime.open({ rootDir: root, projectId: 'p2' });
	assert.equal(second.service.state.projects.p2.name, '我的项目');
	assert.equal(second.service.state.projects.p2.ownerMemberId, 'mem_lead');
	assert.equal(Object.keys(second.service.state.members).length, 5);
	assert.equal(Object.keys(second.service.state.tasks).length, 0);
	second.close();
});

test('legacy default names are upgraded once without touching custom names', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-runtime-legacy-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = await ProjectRuntime.open({ rootDir: root, projectId: 'p3' });
	await first.service.dispatch({
		type: 'member.profile.update',
		actor: { kind: 'human', memberId: 'mem_human' },
		projectId: 'p3',
		payload: { memberId: 'mem_lead', name: '沈舟' },
	});
	await first.service.dispatch({
		type: 'member.profile.update',
		actor: { kind: 'human', memberId: 'mem_human' },
		projectId: 'p3',
		payload: { memberId: 'mem_maker', name: '我自己起的名字' },
	});
	first.close();
	const reopened = await ProjectRuntime.open({ rootDir: root, projectId: 'p3' });
	assert.equal(reopened.service.state.members.mem_lead.name, '墨渊');
	assert.equal(reopened.service.state.members.mem_maker.name, '我自己起的名字');
	reopened.close();
});
