import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHostAgent, HostAgentError } from '../lib/runtime/host-agent.js';

test('reuses an existing live root Agent as the member parent', async () => {
	const root = { id: 'session-human' };
	let created = 0;
	const result = await ensureHostAgent({
		agents: { roots: () => [root], create: async () => { created += 1; } },
		cwd: 'E:/works/dsh-ai-team',
	});
	assert.equal(result.agent, root);
	assert.equal(result.created, false);
	assert.equal(created, 0);
});

test('creates a Team Host Agent and never archives it', async () => {
	const archived = [];
	const unarchived = [];
	const disposed = [];
	const result = await ensureHostAgent({
		agents: {
			roots: () => [],
			create: async (options) => {
				assert.equal(options.meta.cwd, 'E:/works/dsh-ai-team');
				assert.deepEqual(options.agentOptions, { provider: 'deepseek', model: 'deepseek-chat' });
				return { agent: { id: options.sessionId }, dispose: async () => { disposed.push(options.sessionId); } };
			},
		},
		agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
		workspaceRegistry: {
			archivedSessionIds: [],
			archiveSession: async (id) => { archived.push(id); },
			unarchiveSession: async (id) => { unarchived.push(id); },
		},
		cwd: 'E:/works/dsh-ai-team',
		newSessionId: () => 'session-team-host-1',
	});
	assert.equal(result.created, true);
	assert.equal(result.agent.id, 'session-team-host-1');
	// Regression: archiving the host gates every member turn (blocked, no request).
	assert.deepEqual(archived, []);
	// 新建后主动「解除归档」：unarchiveSession 对未归档 id 是 no-op，因此无需先读
	// archivedSessionIds（那是未文档化 API，之前正是它让修复静默跳过）。
	assert.deepEqual(unarchived, ['session-team-host-1']);
	await result.dispose();
	assert.deepEqual(disposed, ['session-team-host-1']);
});

test('unarchives a Team Host archived by an earlier revision', async () => {
	const unarchived = [];
	await ensureHostAgent({
		agents: {
			roots: () => [],
			get: () => undefined,
			create: async () => { throw new Error('must resume, not create'); },
			resume: async ({ resumeSessionId }) => ({ agent: { id: resumeSessionId }, dispose: async () => {} }),
		},
		workspaceRegistry: {
			archivedSessionIds: ['session-host-persisted'],
			unarchiveSession: async (id) => { unarchived.push(id); },
		},
		resumeSessionId: 'session-host-persisted',
		cwd: 'E:/works/dsh-ai-team',
	});
	assert.deepEqual(unarchived, ['session-host-persisted']);
});

test('resumes the persisted Team Host instead of creating a new parent', async () => {
	let created = 0;
	const result = await ensureHostAgent({
		agents: {
			get: () => undefined,
			roots: () => [],
			create: async () => { created += 1; },
			resume: async ({ resumeSessionId }) => ({
				agent: { id: resumeSessionId },
				dispose: async () => {},
			}),
		},
		workspaceRegistry: { archivedSessionIds: [], unarchiveSession: async () => {} },
		resumeSessionId: 'session-host-persisted',
		cwd: 'E:/works/dsh-ai-team',
	});
	assert.equal(result.agent.id, 'session-host-persisted');
	assert.equal(result.resumed, true);
	assert.equal(created, 0);
});

test('fails explicitly without a model or when creation fails', async () => {
	await assert.rejects(
		() => ensureHostAgent({ agents: { roots: () => [], create: async () => {} }, cwd: '/tmp' }),
		(error) => error instanceof HostAgentError && error.code === 'E_RUNTIME_UNAVAILABLE',
	);
	await assert.rejects(
		() => ensureHostAgent({
			agents: { roots: () => [], create: async () => { throw new Error('no model'); } },
			agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
			cwd: '/tmp',
		}),
		(error) => error.code === 'E_HOST_AGENT',
	);
});
