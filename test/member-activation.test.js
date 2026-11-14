/**
 * 成员激活契约（0.3.82 新设计）：成员由 DSH 作为**子智能体**管理——
 * activate 走 `subagents.startActivation`（登记 subagent catalog → 出现在
 * DSH「管理的子智能体」面板、不在工作区会话列表），而不是 agents.create
 * 的独立会话。唤醒走 `subagents.sendMessage`（父→子投递，保留会话上下文）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemberRuntime } from '../lib/runtime/member-runtime.js';

function makeRuntime() {
	const activations = [];
	const messages = [];
	const runtime = new MemberRuntime({
		subagents: {
			list: () => ['local'],
			startActivation: async (spec) => {
				activations.push(spec);
				return {
					childId: 'child-1',
					messageId: 'msg-1',
					result: Promise.resolve({ output: [], stopReason: 'completed' }),
					dispose: async () => {},
				};
			},
			sendMessage: async (parent, targetId, content, options) => {
				messages.push({ parent, targetId, content, options });
				return 'msg-wake';
			},
		},
		sessions: { get: () => ({ id: 'child-1', sandbox: 'workspace-write' }), flush: async () => {} },
		agents: { get: (id) => ({ session: { id, sandbox: 'workspace-write' } }) },
		permissionPresets: { set() {}, overrideOf: () => 'danger-full-access' },
		sandboxPolicy: { overrideOf: () => 'danger-full-access' },
		agentPresets: null,
		parent: { id: 'parent_agent' },
		provider: 'local',
		preset: 'standard',
		cwd: 'E:/works/probe',
		direct: false,
	});
	return { runtime, activations, messages };
}

const member = { id: 'mem_sub', name: '青岚', role: '执行', sessionId: 'child-1', preset: 'standard', config: {}, workspace: 'E:/works/probe' };

test('activation goes through subagents.startActivation (catalog-managed child)', async () => {
	const { runtime, activations } = makeRuntime();
	const result = await runtime.activate({ ...member, sessionId: null }, { prompt: '开始' });
	assert.equal(result.childId, 'child-1');
	assert.equal(activations.length, 1);
	const spec = activations[0];
	assert.equal(spec.label, '青岚', 'label feeds the managed-subagents panel');
	assert.equal(spec.request.cwd, 'E:/works/probe');
	assert.equal(spec.request.parent.id, 'parent_agent');
	assert.equal(spec.request.prompt[0].type, 'text');
	assert.equal(spec.delivery, 'parent');
});

test('the activation spec reads correctly on both host shapes (rc.1 nested, rc.2+ flat)', async () => {
	// rc.2+ 把 SubagentActivationSpec 扁平化（extends SubagentStartRequest），只读
	// spec.parent / spec.cwd；只给嵌套 request 时 100% 激活失败（"requires the exact
	// live parent agent"）。rc.1 仍读 spec.request.*。同一个 spec 两边都要能读。
	const { runtime, activations } = makeRuntime();
	await runtime.activate({ ...member, sessionId: null, config: { provider: 'p', model: 'm' } }, { prompt: '开始' });
	const spec = activations[0];
	const rc1 = { parent: spec.request.parent, cwd: spec.request.cwd, prompt: spec.request.prompt, agentOptions: spec.request.agentOptions, agentPreset: spec.request.agentPreset };
	const flat = { parent: spec.parent, cwd: spec.cwd, prompt: spec.prompt, agentOptions: spec.agentOptions, agentPreset: spec.agentPreset };
	assert.deepEqual(flat, rc1);
	assert.equal(flat.parent.id, 'parent_agent');
	assert.equal(flat.cwd, 'E:/works/probe');
	assert.equal(flat.agentPreset, 'standard');
	assert.equal(typeof flat.agentOptions, 'object');
	assert.equal(spec.provider, 'local');
	assert.equal(spec.label, '青岚');
	assert.ok(spec.signal instanceof AbortSignal);
});

test('wake of a live member uses subagents.sendMessage (parent -> child delivery)', async () => {
	const { runtime, messages } = makeRuntime();
	await runtime.wake(member, { prompt: '继续处理高风险项' });
	assert.equal(messages.length, 1);
	assert.equal(messages[0].parent.id, 'parent_agent');
	assert.equal(messages[0].targetId, 'child-1');
});
