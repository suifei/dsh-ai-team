import test from 'node:test';
import assert from 'node:assert/strict';
import {
	MemberRuntime,
	MemberRuntimeError,
	TEAM_PRESET,
	validatePermissionProfile,
} from '../lib/runtime/member-runtime.js';

function permissionPresets({ valid = true } = {}) {
	return {
		catalog() {
			return { defaultPreset: valid ? 'danger-full-access' : 'workspace-write', options: [], defaultOptions: [] };
		},
		resolve(name) {
			return name === 'danger-full-access'
				? { sandbox: 'danger-full-access', approval: 'never' }
				: { sandbox: 'workspace-write', approval: 'ask' };
		},
		set(session, name) {
			session.preset = name;
			session.sandbox = name === 'danger-full-access' ? 'danger-full-access' : 'workspace-write';
		},
	};
}

function sandboxPolicy() {
	return {
		defaultMode: 'danger-full-access',
		overrideOf(session) {
			return session?.sandbox;
		},
	};
}

function makeRuntime(overrides = {}) {
	const sessions = new Map();
	const calls = { start: [], send: [], disposed: 0, set: [] };
	const subagents = {
		async startActivation(spec) {
			calls.start.push(spec);
			const childId = 'session-member-1';
			sessions.set(childId, { id: childId, sandbox: 'workspace-write' });
			return {
				childId,
				messageId: 'msg-1',
				result: Promise.resolve({ output: [], stopReason: 'completed' }),
				async dispose() { calls.disposed += 1; },
			};
		},
		async sendMessage(parent, targetId, content, options) {
			calls.send.push({ parent, targetId, content, options });
			return 'msg-wake-1';
		},
	};
	const presets = permissionPresets();
	const policy = sandboxPolicy();
	const runtime = new MemberRuntime({
		subagents,
		sessions,
		permissionPresets: {
			...presets,
			set(session, name) {
				calls.set.push({ session, name });
				presets.set(session, name);
			},
		},
		sandboxPolicy: policy,
		parent: { id: 'session-host' },
		provider: 'local',
		cwd: 'E:/works/dsh-ai-team',
		clock: () => 100,
		...overrides,
	});
	return { runtime, sessions, calls, presets, policy };
}

test('validatePermissionProfile accepts only danger-full-access/never', () => {
	assert.equal(validatePermissionProfile({ permissionPresets: permissionPresets(), sandboxPolicy: sandboxPolicy() }).ok, true);
	assert.equal(validatePermissionProfile({ permissionPresets: permissionPresets({ valid: false }), sandboxPolicy: sandboxPolicy() }).ok, false);
	assert.equal(validatePermissionProfile({
		permissionPresets: permissionPresets(),
		sandboxPolicy: { defaultMode: 'workspace-write', overrideOf: () => 'workspace-write' },
	}).ok, false);
	assert.equal(validatePermissionProfile({}).code, 'E_PERMISSION_PROFILE');
});

test('activate starts a child, sets danger-full-access and returns a bound member', async () => {
	const { runtime, sessions, calls } = makeRuntime();
	const result = await runtime.activate({
		id: 'mem_1',
		name: '沈舟',
		workspace: 'E:/works/dsh-ai-team',
		config: { provider: 'p1', model: 'm1', maxTokens: 4096 },
	}, { prompt: '开始工作' });
	assert.equal(result.childId, 'session-member-1');
	assert.equal(result.member.status, 'running');
	assert.equal(result.member.sessionId, 'session-member-1');
	assert.equal(calls.start.length, 1);
	assert.equal(calls.start[0].request.cwd, 'E:/works/dsh-ai-team');
	assert.equal(calls.start[0].request.parent.id, 'session-host');
	assert.deepEqual(calls.start[0].request.agentOptions, { provider: 'p1', model: 'm1', maxTokens: 4096 });
	assert.equal(sessions.get('session-member-1').sandbox, TEAM_PRESET);
	assert.equal(calls.disposed, 0);
});

test('activate disposes the child and refuses when permission repair fails', async () => {
	const { runtime, calls } = makeRuntime({
		permissionPresets: {
			catalog: () => ({ defaultPreset: 'danger-full-access' }),
			resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
			set() { calls.set.push('noop'); },
		},
	});
	await assert.rejects(
		() => runtime.activate({ id: 'mem_1', name: '沈舟' }, { prompt: '开始' }),
		(error) => error instanceof MemberRuntimeError && error.code === 'E_PERMISSION',
	);
	assert.equal(calls.disposed, 1);
});

test('wake re-checks permission before sendMessage', async () => {
	const { runtime, sessions, calls } = makeRuntime();
	sessions.set('session-member-1', { id: 'session-member-1', sandbox: 'workspace-write' });
	const result = await runtime.wake({ id: 'mem_1', name: '沈舟', sessionId: 'session-member-1' }, { prompt: '继续' });
	assert.equal(result.messageId, 'msg-wake-1');
	assert.equal(calls.send.length, 1);
	assert.equal(calls.send[0].targetId, 'session-member-1');
	assert.equal(sessions.get('session-member-1').sandbox, TEAM_PRESET);
});

test('wake resumes the cold child exactly once and delivers through the resumed agent', async () => {
	const { runtime, sessions, calls } = makeRuntime();
	let resumed = null;
	const followed = [];
	runtime.agents = {
		resume: async ({ resumeSessionId }) => {
			resumed = resumeSessionId;
			sessions.set(resumeSessionId, { id: resumeSessionId, sandbox: 'workspace-write' });
			return { agent: { id: resumeSessionId, followup: (message) => { followed.push(message); } }, dispose: async () => {} };
		},
	};
	const result = await runtime.wake({ id: 'mem_1', name: '沈舟', sessionId: 'session-cold' }, { prompt: '继续' });
	assert.equal(resumed, 'session-cold');
	assert.equal(result.cold, true);
	assert.equal(result.resumed, true);
	assert.equal(sessions.get('session-cold').sandbox, TEAM_PRESET);
	// 关键回归：resume 之后不得再走 sendMessage 的冷恢复（那会以 NOT_RESUMABLE
	// 失败并触发上层强制重建、丢掉成员历史）。
	assert.equal(calls.send.length, 0, 'the resumed agent delivers the message itself');
	assert.equal(followed.length, 1);
});

test('wake cold-resumes a member whose session is not live', async () => {
	const { runtime, calls } = makeRuntime();
	const result = await runtime.wake({ id: 'mem_1', name: '沈舟', sessionId: 'session-cold' }, { prompt: '继续' });
	assert.equal(result.cold, true);
	assert.equal(calls.send.length, 1);
	assert.equal(calls.send[0].targetId, 'session-cold');
	assert.equal(calls.set.length, 0, 'no live Session means no pre-delivery permission set');
});

test('direct cold resume mounts the member preset again', async () => {
	const session = { id: 'cold-1', sandbox: 'workspace-write' };
	const agent = { id: 'cold-1', session, followup: () => {} };
	const mounted = [];
	let resumeOptions = null;
	const runtime = new MemberRuntime({
		agents: {
			get: () => undefined,
			resume: async (options) => {
				resumeOptions = options;
				await options.setup?.({ id: 'cold-ctx' });
				return { agent, dispose: async () => {} };
			},
		},
		agentPresets: { mount: async (agentCtx, preset) => { mounted.push([agentCtx.id, preset]); } },
		preset: 'standard',
		sessions: { get: () => session, flush: async () => true },
		permissionPresets: { set: (target, name) => { target.sandbox = name; } },
		sandboxPolicy: { overrideOf: (target) => target.sandbox },
		parent: { id: 'session-host' },
		cwd: 'E:/works/dsh-ai-team',
		direct: true,
	});
	await runtime.wake({ id: 'm1', name: '沈舟', sessionId: 'cold-1', config: { preset: 'standard' } }, { prompt: '继续' });
	assert.equal(resumeOptions.parentAgent.id, 'session-host');
	assert.deepEqual(mounted, [['cold-ctx', 'standard']]);
	assert.equal(session.sandbox, 'danger-full-access');
});

test('direct mode creates an Agent and starts it with followup', async () => {
	const sessions = new Map();
	const followups = [];
	const agent = {
		id: 'direct-1',
		session: { id: 'direct-1', sandbox: 'workspace-write' },
		followup: (message) => { followups.push(message.content[0].text); },
	};
	sessions.set('direct-1', agent.session);
	const mounted = [];
	const runtime = new MemberRuntime({
		agents: {
			create: async (options) => {
				assert.equal(options.parentAgent.id, 'session-host');
				assert.equal(options.meta.agentPreset, 'standard');
				await options.setup?.({ id: 'agent-ctx' });
				agent.id = options.sessionId;
				agent.session.id = options.sessionId;
				sessions.set(options.sessionId, agent.session);
				return { agent, dispose: async () => {} };
			},
			get: (id) => (id === agent.id ? agent : undefined),
		},
		agentPresets: { mount: async (agentCtx, preset) => { mounted.push([agentCtx.id, preset]); } },
		preset: 'standard',
		sessions: { get: (id) => sessions.get(id), flush: async () => true },
		permissionPresets: { set: (session, name) => { session.sandbox = name; } },
		sandboxPolicy: { overrideOf: (session) => session.sandbox },
		parent: { id: 'session-host' },
		cwd: 'E:/works/dsh-ai-team',
		direct: true,
	});
	const result = await runtime.activate({ id: 'm1', name: '沈舟' }, { prompt: '开始' });
	assert.equal(result.childId, agent.id);
	assert.equal(result.member.status, 'running');
	assert.deepEqual(mounted, [['agent-ctx', 'standard']]);
	assert.equal(agent.session.sandbox, 'danger-full-access');
	assert.deepEqual(followups, ['开始']);
	await runtime.wake({ id: 'm1', name: '沈舟', sessionId: agent.id }, { prompt: '继续' });
	assert.deepEqual(followups, ['开始', '继续']);
});

test('missing parent/provider or session is rejected explicitly', async () => {
	const { runtime } = makeRuntime();
	await assert.rejects(
		() => new MemberRuntime({ parent: undefined, provider: undefined }).activate({ id: 'm', name: 'x' }),
		(error) => error.code === 'E_RUNTIME_UNAVAILABLE',
	);
	await assert.rejects(
		() => runtime.wake({ id: 'm', name: 'x' }),
		(error) => error.code === 'E_SESSION_MISSING',
	);
});
