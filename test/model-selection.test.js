import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHostAgent } from '../lib/runtime/host-agent.js';

const selection = { provider: 'p1', model: 'm1' };

function fakeAgents(extra = {}) {
	const created = [];
	return {
		created,
		async create(request) {
			created.push(request);
			return { agent: { id: request.sessionId }, dispose: async () => {} };
		},
		...extra,
	};
}

function fakeSessions() {
	const appended = [];
	return {
		appended,
		get: (sessionId) => ({
			id: sessionId,
			append: (type, data) => appended.push({ sessionId, type, data }),
		}),
	};
}

test('host agent persists the resolved model selection into the session log', async () => {
	const sessions = fakeSessions();
	const agents = fakeAgents();
	const value = await ensureHostAgent({
		agents,
		agentDefaultModel: { currentSelection: () => selection },
		sessions,
		cwd: 'C:/tmp',
		newSessionId: () => 'session-host-1',
	});
	assert.equal(value.created, true);
	assert.deepEqual(sessions.appended, [
		{ sessionId: 'session-host-1', type: 'model/selection', data: { provider: 'p1', model: 'm1' } },
	]);
});

test('resumed host agent also records its model selection', async () => {
	const sessions = fakeSessions();
	const agents = fakeAgents({
		get: () => undefined,
		async resume() {
			return { agent: { id: 'session-host-2' }, dispose: async () => {} };
		},
	});
	const value = await ensureHostAgent({
		agents,
		agentDefaultModel: { currentSelection: () => selection },
		sessions,
		cwd: 'C:/tmp',
		resumeSessionId: 'session-host-2',
	});
	assert.equal(value.resumed, true);
	assert.deepEqual(sessions.appended, [
		{ sessionId: 'session-host-2', type: 'model/selection', data: { provider: 'p1', model: 'm1' } },
	]);
});

test('missing selection fails creation without touching the session log', async () => {
	const sessions = fakeSessions();
	const agents = fakeAgents();
	await assert.rejects(() => ensureHostAgent({
		agents,
		agentDefaultModel: { currentSelection: () => null },
		sessions,
		cwd: 'C:/tmp',
		newSessionId: () => 'session-host-3',
	}), (error) => error.code === 'E_RUNTIME_UNAVAILABLE');
	assert.equal(sessions.appended.length, 0);
});
