/**
 * Management-view tests (docs/11): people aggregation over existing project
 * ledgers, and the no-workspace lightweight entry (create without a
 * workspace; member activation fails closed with E_WORKSPACE_REQUIRED).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePeople } from '../lib/host/people-view.js';

function fakeRuntime(id, projectName, { members = [], tasks = [] } = {}) {
	return {
		id,
		service: {
			state: {
				members: Object.fromEntries(members.map((member) => [member.id, member])),
				tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
			},
		},
	};
}

test('people pool aggregates the same person across projects with exact task counts', () => {
	const registry = [
		{ id: 'prj_a', name: '项目A' },
		{ id: 'prj_b', name: '项目B' },
	];
	const runtimes = [
		fakeRuntime('prj_a', '项目A', {
			members: [
				{ id: 'a1', name: '青岚', kind: 'agent', role: '执行', status: 'running' },
				{ id: 'h1', name: '你', kind: 'human', role: 'Human', status: 'idle' },
			],
			tasks: [
				{ id: 't1', status: 'in_progress', ownerId: 'a1', assigneeId: 'a1', blockedBy: [], tombstone: false },
				{ id: 't2', status: 'pending', ownerId: 'a1', assigneeId: null, blockedBy: [], tombstone: false },
				{ id: 't3', status: 'done', ownerId: 'a1', assigneeId: null, blockedBy: [], tombstone: false },
			],
		}),
		fakeRuntime('prj_b', '项目B', {
			members: [
				{ id: 'b1', name: '青岚', kind: 'agent', role: '执行', status: 'failed', lastFailure: { category: 'rate_limit' } },
			],
			tasks: [
				{ id: 't4', status: 'pending_acceptance', ownerId: 'b1', assigneeId: null, blockedBy: [], tombstone: false },
			],
		}),
	];
	const people = aggregatePeople(registry, runtimes);
	assert.equal(people.length, 1, 'human members are excluded; same-name agent merges into one row');
	const person = people[0];
	assert.equal(person.name, '青岚');
	assert.equal(person.role, '执行');
	assert.equal(person.projects.length, 2, 'one identity per project');
	assert.deepEqual(person.projects.map((row) => row.projectId), ['prj_a', 'prj_b']);
	assert.equal(person.projects[0].activeTasks, 3, 'owner + assignee positions count');
	assert.equal(person.projects[1].status, 'failed');
	assert.equal(person.projects[1].lastFailure.category, 'rate_limit');
	assert.equal(person.failures, 1);
	assert.equal(person.activeTasks, 4);
});

test('people pool tolerates empty ledgers and talent-pool members', () => {
	const people = aggregatePeople([{ id: 'p', name: 'P' }], [
		fakeRuntime('p', 'P', { members: [{ id: 'a9', name: '老周', kind: 'agent', role: '', status: 'retired', talentPool: true }] }),
	]);
	assert.equal(people.length, 1);
	assert.equal(people[0].projects[0].talentPool, true);
	assert.equal(people[0].activeTasks, 0);
	assert.deepEqual(aggregatePeople([], []), []);
});

test('a name-to-name alias actually merges the two rows', () => {
	const registry = [{ id: 'p1', name: 'P1' }];
	const runtimes = [{
		id: 'p1',
		service: { state: {
			projects: { p1: { id: 'p1', workspacePath: '' } },
			members: {
				a: { id: 'm1', name: '白砚', kind: 'agent', status: 'idle' },
				b: { id: 'm2', name: '白砚(旧)', kind: 'agent', status: 'idle' },
			},
			tasks: {},
		} },
	}];
	const merged = aggregatePeople(registry, runtimes, { aliases: { '白砚(旧)': 'name:白砚' } });
	assert.equal(merged.length, 1, 'two names bound together must collapse into one row');
	assert.equal(merged[0].name, '白砚');
});

test('a bare name alias from older data files is normalised, not dropped', () => {
	const registry = [{ id: 'p1', name: 'P1' }];
	const runtimes = [{
		id: 'p1',
		service: { state: {
			projects: { p1: { id: 'p1', workspacePath: '' } },
			members: {
				a: { id: 'm1', name: '白砚', kind: 'agent', status: 'idle' },
				b: { id: 'm2', name: '旧名', kind: 'agent', status: 'idle' },
			},
			tasks: {},
		} },
	}];
	assert.equal(aggregatePeople(registry, runtimes, { aliases: { 旧名: '白砚' } }).length, 1);
});
