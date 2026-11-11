/**
 * Human 直聊门（chatGate）→ 成员会话 header 的映射测试：
 * - allowHumanWrite=true（chatGate open）：activateDirect 不设 parentSession
 *   （宿主放行 Human 在 DSH 主界面直接输入）
 * - allowHumanWrite=false（chatGate closed）：activateDirect 设 parentSession
 *   （宿主 hasApiSessionSubagentOwner 判定 subagent-owned → Human 被拒）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemberRuntime } from '../lib/runtime/member-runtime.js';

function makeRuntime(allowHumanWrite) {
	const created = [];
	const agentHandle = {
		agent: {
			session: { id: 'sess_x', seq: 0 },
			status: 'idle',
			followup() {},
			inbox: { nextTurn: [], nextStep: [] },
		},
		dispose: async () => {},
	};
	const runtime = new MemberRuntime({
		subagents: { list: () => [] },
		sessions: { get: () => null, flush: async () => {} },
		agents: {
			create: async (options) => { created.push(options); return agentHandle; },
			get: () => null,
			resume: async () => agentHandle,
		},
		permissionPresets: { set() {}, overrideOf: () => 'danger-full-access' },
		sandboxPolicy: { overrideOf: () => 'danger-full-access' },
		agentPresets: null,
		parent: { id: 'parent_agent' },
		provider: 'test',
		preset: 'standard',
		cwd: 'E:/works/probe',
		direct: true,
		allowHumanWrite,
	});
	return { runtime, created };
}

const member = { id: 'mem_probe', name: '探针', role: '执行', preset: 'standard', config: {} };

test('chatGate open -> member session header carries NO parentSession (human can type in DSH)', async () => {
	const { runtime, created } = makeRuntime(true);
	await runtime.activate(member, { prompt: 'hello' });
	assert.equal(created.length, 1);
	assert.equal(created[0].meta.parentSession, undefined, 'open gate must not mark the session subagent-owned');
	assert.equal(created[0].meta.origin, undefined, 'open gate must not set origin:subagent');
	assert.ok(created[0].meta.cwd, 'cwd still set');
});

test('chatGate closed -> member session header sets parentSession (host rejects human input)', async () => {
	const { runtime, created } = makeRuntime(false);
	await runtime.activate(member, { prompt: 'hello' });
	assert.equal(created.length, 1);
	assert.equal(created[0].meta.parentSession, 'parent_agent', 'closed gate marks the session subagent-owned');
});
