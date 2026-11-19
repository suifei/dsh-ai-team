import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeScope, scopesOverlap, writeScopeConflict } from '../lib/domain/policy.js';
import { claimTask } from '../lib/domain/task.js';
import { planIdleStaffing } from '../lib/host/pmo.js';
import { createTeamTool } from '../lib/host/member-tools.js';
import { ProjectRuntime } from '../lib/host/project-runtime.js';

// 用户 2026-11-20：多人并行写代码要防互相覆盖——卡声明写入范围，认领时与在做的卡重叠就拒绝。
test('scopes overlap when one is the other or below it; separators, trailing globs and case do not matter', () => {
	assert.equal(normalizeScope(String.raw`SRC\auth\**`), 'src/auth');
	assert.equal(normalizeScope('./lib/'), 'lib');
	const overlaps = [['src/a', 'src/a/b.js'], [String.raw`SRC\a\ `, 'src/a/x'], ['src/**', 'src/x'], ['.', 'anything'], ['README.md', 'readme.md']];
	for (const [a, b] of overlaps) assert.equal(scopesOverlap(a, b), true, `${a} ~ ${b}`);
	for (const [a, b] of [['src/a', 'src/ab'], ['docs', 'src'], ['lib/x.js', 'lib/y.js']]) assert.equal(scopesOverlap(a, b), false, `${a} !~ ${b}`);
});

const card = (id, status, writeScopes, extra = {}) => ({ id, number: Number(id.slice(1)), title: id, status, writeScopes, blockedBy: [], claimHistory: [], assigneeId: null, ownerId: 'lead', revision: 1, ...extra });

test('claim is refused while an in-progress task writes an overlapping path; free once it is submitted; undeclared scopes never block', () => {
	const tasks = { t1: card('t1', 'in_progress', ['src/auth/'], { assigneeId: 'dev1' }), t2: card('t2', 'pending', ['src/auth/login.js']), t3: card('t3', 'pending', ['docs/']), t4: card('t4', 'pending', []) };
	assert.throws(() => claimTask(tasks.t2, { kind: 'agent', memberId: 'dev2' }, tasks), (error) => error.code === 'E_CONFLICT' && error.details.conflictTaskId === 't1' && /overlaps/.test(error.message));
	assert.equal(claimTask(tasks.t3, { kind: 'agent', memberId: 'dev2' }, tasks).task.status, 'in_progress');
	assert.equal(claimTask(tasks.t4, { kind: 'agent', memberId: 'dev3' }, tasks).task.status, 'in_progress');
	const submitted = { ...tasks, t1: { ...tasks.t1, status: 'pending_acceptance' } };
	assert.equal(writeScopeConflict(submitted.t2, submitted), undefined);
	assert.equal(claimTask(submitted.t2, { kind: 'agent', memberId: 'dev2' }, submitted).task.status, 'in_progress');
});

test('idle staffing skips cards whose scope clashes with work in progress', () => {
	const state = {
		projects: { p1: { id: 'p1', ownerMemberId: 'lead' } },
		members: Object.fromEntries([
			{ id: 'lead', kind: 'agent', status: 'idle', duty: 'lead', createdAt: '0' },
			{ id: 'dev1', kind: 'agent', status: 'running', role: '编程', createdAt: '1' },
			{ id: 'dev2', kind: 'agent', status: 'idle', role: '编程', createdAt: '2' },
		].map((m) => [m.id, m])),
		tasks: { t1: card('t1', 'in_progress', ['src/'], { assigneeId: 'dev1' }), t2: card('t2', 'pending', ['src/x.js']), t3: card('t3', 'pending', ['docs/']) },
	};
	assert.deepEqual(planIdleStaffing(state, { now: 10 * 60_000, inTurn: () => false }).claims, [{ memberId: 'dev2', taskId: 't3' }]);
});

test('team create passes writeScopes and blockedBy through; cards show them; the description states the split rules', async () => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-scopes-'));
	try {
		const runtime = await ProjectRuntime.open({ rootDir: root });
		const service = runtime.service;
		const lead = Object.values(service.state.members).find((m) => m.duty === 'lead');
		await service.dispatch({ type: 'member.bind', payload: { memberId: lead.id, sessionId: 's-lead' }, actor: { kind: 'human', memberId: service.humanId() }, projectId: runtime.id });
		const tool = createTeamTool({ getState: () => service.state, dispatch: (command) => service.dispatch(command) });
		const exec = { agent: { id: 's-lead' } };
		const first = await tool.execute({ action: 'create', title: '登录接口', resultDefinition: '接口可用', writeScopes: ['src/auth/', ' '] }, exec);
		assert.equal(first.ok, true, JSON.stringify(first));
		assert.deepEqual(first.task.writeScopes, ['src/auth/']);
		const second = await tool.execute({ action: 'create', title: '登录页', resultDefinition: '页面可用', writeScopes: ['web/login/'], blockedBy: [first.task.id] }, exec);
		assert.equal(second.ok, true, JSON.stringify(second));
		assert.deepEqual(second.task.blockedBy, [first.task.id]);
		assert.equal(second.task.blocked, true);
		const bad = await tool.execute({ action: 'create', title: '坏依赖', resultDefinition: 'x', blockedBy: ['tsk_nope'] }, exec);
		assert.equal(bad.ok, false);
		assert.match(tool.description, /writeScopes that do not overlap/);
		assert.match(tool.description, /do not git commit\/push/);
		assert.equal(tool.parameters.properties.writeScopes.type, 'array');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
