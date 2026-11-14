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

test('wake cold-resumes a member whose session is not live', async () => {
	const { runtime, calls } = makeRuntime();
	const result = await runtime.wake({ id: 'mem_1', name: '沈舟', sessionId: 'session-cold' }, { prompt: '继续' });
	assert.equal(result.cold, true);
	assert.equal(calls.send.length, 1);
	assert.equal(calls.send[0].targetId, 'session-cold');
	assert.equal(calls.set.length, 0, 'no live Session means no pre-delivery permission set');
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

// Issue #1 回归：唤醒只有一条投递路径（subagents.sendMessage）。插件自己 agents.resume
// 会持有写句柄，使 manager 下一次冷恢复以 NOT_RESUMABLE 失败 → 上层中止回合并重建会话
// （.ptc/rounds/r01-evidence：同一成员 15ms 内两次唤醒，第二次触发重建）。
test('wake never resumes the child itself, even when agents.resume is available', async () => {
	const { runtime, calls } = makeRuntime();
	let resumeCalls = 0;
	runtime.agents = { resume: async () => { resumeCalls += 1; throw new Error('must not be called'); } };
	const result = await runtime.wake({ id: 'mem_1', name: '沈舟', sessionId: 'session-cold' }, { prompt: '继续' });
	assert.equal(resumeCalls, 0);
	assert.equal(calls.send.length, 1);
	assert.equal(result.cold, true);
	assert.equal(result.messageId, 'msg-wake-1');
});

test('back-to-back wakes (cold, then live) all go through sendMessage to the same session', async () => {
	const { runtime, sessions, calls } = makeRuntime();
	const member = { id: 'mem_1', name: '沈舟', sessionId: 'session-x' };
	// A working agents.resume is available (as on a real host): the old code took
	// it for the cold wake and then fell back to sendMessage on the next one.
	const followed = [];
	runtime.agents = {
		resume: async ({ resumeSessionId }) => {
			sessions.set(resumeSessionId, { id: resumeSessionId, sandbox: 'danger-full-access' });
			return { agent: { id: resumeSessionId, followup: (message) => followed.push(message) }, dispose: async () => {} };
		},
	};
	// 1st: offline → manager cold-resumes it; model the session becoming live.
	runtime.subagents.sendMessage = async (parent, targetId, content) => {
		calls.send.push({ parent, targetId, content });
		sessions.set(targetId, { id: targetId, sandbox: 'danger-full-access' });
		return `msg-${calls.send.length}`;
	};
	const first = await runtime.wake(member, { prompt: 'task_created' });
	const second = await runtime.wake(member, { prompt: 'task_assigned' });
	const third = await runtime.wake(member, { prompt: 'pmo_review' });
	assert.deepEqual(calls.send.map((call) => call.targetId), ['session-x', 'session-x', 'session-x']);
	assert.equal(followed.length, 0, 'nothing is delivered around the manager');
	assert.deepEqual([first.cold, second.cold, third.cold], [true, false, false]);
	assert.equal(calls.send[0].parent.id, 'session-host', 'delivery is addressed from the Team host parent');
});

test('wake without a subagent runtime fails explicitly instead of delivering some other way', async () => {
	const { runtime } = makeRuntime();
	runtime.subagents = undefined;
	await assert.rejects(
		() => runtime.wake({ id: 'm', name: 'x', sessionId: 's' }, { prompt: '继续' }),
		(error) => error instanceof MemberRuntimeError && error.code === 'E_RUNTIME_UNAVAILABLE',
	);
});
