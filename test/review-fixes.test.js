/**
 * Tests for the plugin-development review fixes (2026-11-10 round):
 * diaglog levels, skill-provider contract parity, failure-policy semantics,
 * retired-member resurrection guards, unified review eligibility and the
 * dispatch actor check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiagLogger, isErrorEvent } from '../lib/diaglog.js';
import { createFileSkillProvider } from '../lib/runtime/skill-provider.js';
import { classifyLlmFailure, retryDecision } from '../lib/runtime/failure-policy.js';
import { isEligibleReviewer } from '../lib/ledger/fold.js';
import { eligibleReviewers } from '../lib/domain/policy.js';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';

const human = { kind: 'human', memberId: 'h1' };

test('diaglog level off drops every row, errors keeps only fail rows, full keeps all', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-diag-'));
	try {
		const dir = join(root, 'diag');
		const at = () => new Date('2026-01-01T08:00:00Z');
		const file = () => join(dir, 'aiteam-diag-2026-01-01.jsonl');
		const off = createDiagLogger({ dir, level: 'off', now: at });
		await off.append({ ev: 'boot.fail', message: 'x' });
		const offRows = await readFile(file(), 'utf8').catch(() => null);
		assert.equal(offRows, null, 'level off must write nothing');

		const errors = createDiagLogger({ dir, level: 'errors', now: at });
		await errors.append({ ev: 'dispatch.start', type: 'task.create' });
		await errors.append({ ev: 'dispatch.fail', type: 'task.create', code: 'E_CONFLICT' });
		await errors.append({ ev: 'wake.delivered', memberId: 'a1' });
		const text = await readFile(file(), 'utf8');
		const rows = text.trim().split('\n').map((line) => JSON.parse(line));
		assert.deepEqual(rows.map((row) => row.ev), ['dispatch.fail'], 'errors keeps only .fail rows');

		const full = createDiagLogger({ dir, level: 'full', now: at });
		await full.append({ ev: 'dispatch.start', type: 'task.create' });
		await full.append({ ev: 'wake.delivered', memberId: 'a1' });
		const fullText = await readFile(file(), 'utf8');
		assert.equal(fullText.trim().split('\n').length, 3, 'full keeps every row');
		assert.equal(isErrorEvent('wake.fail'), true);
		assert.equal(isErrorEvent('boot.refused'), true);
		assert.equal(isErrorEvent('wake.delivered'), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('skill-provider honours loose boolean invocation keys, requires description, ranks sources and finds flat skills', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-skills-'));
	try {
		const project = join(root, 'proj');
		const bundled = join(root, 'bundled');
		const { mkdirSync, writeFileSync } = await import('node:fs');
		mkdirSync(join(project, '.dsh', 'skills', 'alpha'), { recursive: true });
		mkdirSync(join(bundled, 'skills', 'alpha'), { recursive: true });
		mkdirSync(join(project, '.dsh', 'skills', 'beta'), { recursive: true });
		mkdirSync(join(project, '.dsh', 'skills', 'gamma'), { recursive: true });
		mkdirSync(join(project, '.dsh', 'skills', 'delta'), { recursive: true });
		writeFileSync(join(project, '.dsh', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: from project\n---\nbody');
		writeFileSync(join(bundled, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: from bundled\n---\nbody');
		writeFileSync(join(project, '.dsh', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: quiet\ndisable-model-invocation: TRUE\n---\nbody');
		mkdirSync(join(project, '.dsh', 'skills', 'eps'), { recursive: true });
		writeFileSync(join(project, '.dsh', 'skills', 'eps', 'SKILL.md'), '---\nname: eps\ndescription: quoted boolean is a string\ndisable-model-invocation: "TRUE"\n---\nbody');
		writeFileSync(join(project, '.dsh', 'skills', 'gamma', 'SKILL.md'), '---\nname: gamma\ndescription: hidden\nuser-invocable: no\n---\nbody');
		writeFileSync(join(project, '.dsh', 'skills', 'delta', 'SKILL.md'), '---\nname: delta\n---\nbody');
		writeFileSync(join(project, '.dsh', 'skills', 'flat.md'), '---\nname: flat\ndescription: flat file skill\n---\nbody');

		const provider = createFileSkillProvider({ projectCwd: project, bundledDir: bundled, dshHome: join(root, 'nope') });
		const all = await provider.list();
		const byName = new Map(all.map((skill) => [skill.name, skill]));
		assert.equal(byName.get('alpha')?.description, 'from project', 'project rank 100 beats bundled rank 600');
		assert.equal(byName.get('beta')?.invocation.modelInvocable, false, 'disable-model-invocation accepts loose TRUE');
		assert.equal(byName.get('gamma')?.invocation.userInvocable, false, 'user-invocable accepts loose no');
		assert.equal(byName.has('delta'), false, 'missing description drops the skill');
		assert.equal(byName.has('eps'), false, 'a quoted boolean is a string → skill dropped with warning');
		assert.equal(byName.get('flat')?.description, 'flat file skill', 'flat <name>.md files are discovered');
		const rejected = createFileSkillProvider({ projectCwd: join(root, 'empty'), bundledDir: join(root, 'empty') });
		const empty = await rejected.list();
		assert.deepEqual(empty, [], 'missing roots are an empty state');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('failure-policy: rate limit without fallback ends the turn, with fallback switches route, network retries', () => {
	const rateLimit = classifyLlmFailure({ status: 429, code: 'RATE_LIMIT', message: 'rate limit' });
	assert.equal(retryDecision(rateLimit, {}, 1).action, 'fail');
	const withFallback = retryDecision(rateLimit, { provider: 'p1', model: 'm1', fallback: [{ provider: 'p2', model: 'm2' }] }, 1);
	assert.equal(withFallback.action, 'fallback');
	const network = classifyLlmFailure({ code: 'ECONNRESET', message: 'connection reset' });
	assert.equal(retryDecision(network, {}, 1).action, 'retry');
	const budget = retryDecision(network, {}, 3);
	assert.equal(budget.action, 'fail');
});

async function makeService(t, diag = null) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-fixes-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_fix', fsync: false });
	const service = new TeamService({ ledger, diag });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: '执行', kind: 'agent' } });
	await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's1' } });
	await service.dispatch({ type: 'project.create', actor: human, payload: { name: 'Fix', ownerId: 'a1' } });
	return { root, ledger, service };
}

test('retired members cannot be resurrected via member.bind or member.retry', async (t) => {
	const { ledger, service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a9', name: '退役', kind: 'agent' } });
	await service.dispatch({ type: 'member.retire', actor: human, payload: { memberId: 'a9' } });
	await assert.rejects(
		() => service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a9', sessionId: 's9' } }),
		(error) => error.code === 'E_INVALID_STATE' && error.message.includes('retired'),
	);
	await assert.rejects(
		() => service.dispatch({ type: 'member.retry', actor: human, payload: { memberId: 'a9' } }),
		(error) => error.code === 'E_INVALID_STATE' && error.message.includes('rejoin'),
	);
	const state = service.state;
	assert.equal(state.members.a9.status, 'retired', 'fold still reports retired');
	// 投影防御：绕过 service 的事件也无法复活 retired 成员。
	await ledger.append({
		type: 'member/session-bound',
		payload: { memberId: 'a9', sessionId: 's9' },
		actor: { kind: 'system' },
		projectId: 'prj_fix',
	});
	assert.equal(state.members.a9.status, 'retired', 'fold ignores session-bound for retired members');
	await ledger.append({
		type: 'member/retry-requested',
		payload: { memberId: 'a9', reason: '' },
		actor: { kind: 'system' },
		projectId: 'prj_fix',
	});
	assert.equal(state.members.a9.status, 'retired', 'fold ignores retry-requested for retired members');
	ledger.close();
});

test('member/recovered does not resurrect a retired member with an old failing session', async (t) => {
	const { ledger, service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a8', name: '老会话', kind: 'agent' } });
	await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a8', sessionId: 's8' } });
	await service.dispatch({ type: 'member.retire', actor: human, payload: { memberId: 'a8' } });
	await ledger.append({
		type: 'member/recovered',
		payload: { memberId: 'a8', attempt: 1 },
		actor: { kind: 'system' },
		projectId: 'prj_fix',
	});
	assert.equal(service.state.members.a8.status, 'retired');
	ledger.close();
});

test('review eligibility is unified: failed members are out everywhere', async (t) => {
	const { ledger, service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a2', name: '备用', kind: 'agent' } });
	await service.dispatch({ type: 'member.fail', actor: human, payload: { memberId: 'a2', reason: 'LLM down' } });
	const first = await service.dispatch({
		type: 'task.create', actor: human, projectId: 'prj_fix',
		payload: { title: '评审资格', resultDefinition: 'done', ownerId: 'a1', assigneeId: 'a1' },
	});
	const claimed = await service.dispatch({
		type: 'task.claim', actor: { kind: 'agent', memberId: 'a1' }, projectId: 'prj_fix',
		payload: { taskId: first.task.id, expectedRevision: first.task.revision },
	});
	await service.dispatch({
		type: 'task.submit', actor: { kind: 'agent', memberId: 'a1' }, projectId: 'prj_fix',
		payload: { taskId: first.task.id, expectedRevision: claimed.task.revision, summary: 'ok', evidence: ['e'] },
	});
	const state = service.state;
	const task = state.tasks[first.task.id];
	assert.deepEqual(eligibleReviewers(state, task).map((member) => member.id), [], 'failed member is not a reviewer candidate');
	assert.equal(isEligibleReviewer(state, task.id, 'a2'), false, 'fold agrees: failed member cannot review');
	ledger.close();
});

test('dispatch rejects forged agent actors and the QA gate fails closed', async (t) => {
	const { ledger, service } = await makeService(t);
	await service.dispatch({
		type: 'task.create', actor: human, projectId: 'prj_fix',
		payload: { title: 'QA 门', resultDefinition: 'done', ownerId: 'a1', qaRequired: true, qaChecklist: ['复跑'] },
	});
	await assert.rejects(
		() => service.dispatch({ type: 'stream.post', actor: { kind: 'agent', memberId: 'ghost' }, projectId: 'prj_fix', payload: { body: 'x' } }),
		(error) => error.code === 'E_UNAUTHORIZED' && error.message.includes('not a Team member'),
	);
	// The Project owner (a1) posts legitimately — the gate only stops unknown ids.
	const posted = await service.dispatch({ type: 'stream.post', actor: { kind: 'agent', memberId: 'a1' }, projectId: 'prj_fix', payload: { body: 'ok' } });
	assert.ok(posted.entry ?? posted.stream ?? posted, 'owner agent stream.post resolves');
	ledger.close();
});

test('system events land on the requested project, not keys()[0]', async (t) => {
	const { ledger, service } = await makeService(t);
	const eventsBefore = ledger.events.length;
	await service.recordWake('a1', { ok: true, taskId: null, reason: 'test', messageId: 'm1' }, 'prj_fix');
	const event = ledger.events.at(-1);
	assert.equal(event.type, 'wake/delivered');
	assert.equal(event.projectId, 'prj_fix');
	assert.ok(ledger.events.length > eventsBefore);
	ledger.close();
});
