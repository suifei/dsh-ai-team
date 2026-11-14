import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHostAgent, HostAgentError } from '../lib/runtime/host-agent.js';

test('never borrows the Human\'s live root session: each project owns its PMO session', async () => {
	// Core model: members are children of their project's PMO session in the project
	// workspace. Borrowing the Human's open chat parented them under that chat (any
	// workspace, results delivered into it) and left the team "未分组" in the sidebar.
	const humanRoot = { id: 'session-human', session: { header: { cwd: 'E:/elsewhere' } } };
	const created = [];
	const result = await ensureHostAgent({
		agents: {
			roots: () => [humanRoot],
			create: async (options) => { created.push(options); return { agent: { id: options.sessionId }, dispose: async () => {} }; },
		},
		agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
		cwd: 'E:/works/il2c',
		newSessionId: () => 'session-team-host-pmo',
	});
	assert.equal(result.agent.id, 'session-team-host-pmo');
	assert.equal(result.created, true);
	assert.equal(created.length, 1);
	assert.equal(created[0].meta.cwd, 'E:/works/il2c');
});

test('a live persisted PMO session in another project\'s workspace is not reused', async () => {
	// Two ledgers that once shared one host: project B must not adopt A's live
	// session, or B's members would be created in A's workspace.
	let created = 0;
	const result = await ensureHostAgent({
		agents: {
			get: (id) => ({ id, session: { header: { cwd: 'E:/works/project-a' } } }),
			create: async (options) => { created += 1; return { agent: { id: options.sessionId }, dispose: async () => {} }; },
			resume: async () => { throw new Error('a live session is never resumed'); },
		},
		agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
		resumeSessionId: 'session-host-shared',
		newSessionId: () => 'session-host-b',
		cwd: 'E:/works/project-b',
	});
	assert.equal(created, 1);
	assert.equal(result.agent.id, 'session-host-b');
	assert.equal(result.created, true);
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

test('a persisted Host whose cwd is the plugin data dir is replaced, not reused', async () => {
	// 实机事故：2026-11-09 创建的 host 会话记着 `…/.dsh/ai-team/default`，成员子会话
	// 继承它，于是 30 个会话都在插件数据目录里干活、attachSession 每天被拒上百次。
	// 复用时必须核对 cwd：不一致就释放旧 host 并新建一条，让子会话拿到正确目录。
	const disposed = [];
	let created = 0;
	const result = await ensureHostAgent({
		agents: {
			get: () => undefined,
			roots: () => [],
			create: async (options) => {
				created += 1;
				return { agent: { id: options.sessionId }, dispose: async () => {} };
			},
			resume: async ({ resumeSessionId }) => ({
				agent: { id: resumeSessionId, session: { header: { cwd: 'C:\\Users\\u\\.dsh\\ai-team\\default' } } },
				dispose: async () => { disposed.push(resumeSessionId); },
			}),
		},
		agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
		workspaceRegistry: { unarchiveSession: async () => {} },
		resumeSessionId: 'session-host-old',
		newSessionId: () => 'session-host-new',
		cwd: 'E:/works/il2c',
	});
	assert.deepEqual(disposed, ['session-host-old'], 'the stale host handle must be released');
	assert.equal(created, 1, 'a fresh host is created with the project workspace');
	assert.equal(result.agent.id, 'session-host-new');
	assert.equal(result.created, true);
});

test('a persisted Host with a matching cwd is still resumed (case and trailing slash ignored)', async () => {
	let created = 0;
	const result = await ensureHostAgent({
		agents: {
			get: () => undefined,
			roots: () => [],
			create: async () => { created += 1; },
			resume: async ({ resumeSessionId }) => ({
				agent: { id: resumeSessionId, session: { header: { cwd: 'e:\\works\\il2c\\' } } },
				dispose: async () => {},
			}),
		},
		workspaceRegistry: { unarchiveSession: async () => {} },
		resumeSessionId: 'session-host-persisted',
		cwd: 'E:/works/il2c',
	});
	assert.equal(result.resumed, true);
	assert.equal(result.agent.id, 'session-host-persisted');
	assert.equal(created, 0);
});

test('fails explicitly without a model or when creation fails', async () => {	await assert.rejects(
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
