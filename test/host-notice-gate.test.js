import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHostNoticeGate } from '../lib/runtime/host-notice-gate.js';

const HOST = 'session-team-host-1';
const notice = (from) => ({ role: 'user', content: [{ type: 'text', text: 'Background subagent agent-1 finished' }], source: { kind: 'subagent-settled', form: 'notice', senderSessionId: from } });
const human = { role: 'user', content: [{ type: 'text', text: '你好' }] };
const agentOf = (id) => ({ id, session: { header: { id } } });

function gate() {
	const rows = [];
	const hooks = [];
	const g = registerHostNoticeGate({
		on: (name, listener) => { hooks.push(name); return () => hooks.splice(hooks.indexOf(name), 1); },
		isHostSession: (id) => (id === HOST ? { projectId: 'prj_1' } : null),
		diag: { append: (row) => rows.push(row) },
	});
	const run = (payload) => g.preStep(payload, () => Promise.resolve({ kind: 'enter', messages: payload.messages }));
	return { g, rows, hooks, run };
}

test('a host turn woken only by member-settled notices is rejected without a model request (il2c 11-17)', async () => {
	// il2c 11-17：宿主被「子智能体已完成」叫醒后自当 PMO，send_message 催成员撞 NOT_RESUMABLE。
	const { g, rows, hooks, run } = gate();
	assert.deepEqual(hooks, ['agent/pre-step']);
	const decision = await run({ agent: agentOf(HOST), messages: [notice('mem-a'), notice('mem-b')], turn: 7, step: 1 });
	assert.equal(decision.kind, 'reject');
	assert.equal(rows.length, 1);
	assert.equal(rows[0].ev, 'host.notice.dropped');
	assert.deepEqual(rows[0].from, ['mem-a', 'mem-b']);
	g.dispose();
	assert.deepEqual(hooks, []);
});

test('the gate leaves every other step alone', async () => {
	const { rows, run } = gate();
	// 成员会话收到通知（它派的子代理结束）照常进步骤
	assert.equal((await run({ agent: agentOf('member-1'), messages: [notice('x')], turn: 1, step: 1 })).kind, 'enter');
	// 混有真实输入（Human 打开宿主会话说话）放行
	assert.equal((await run({ agent: agentOf(HOST), messages: [notice('x'), human], turn: 1, step: 1 })).kind, 'enter');
	// 回合中途的步骤不碰
	assert.equal((await run({ agent: agentOf(HOST), messages: [notice('x')], turn: 1, step: 2 })).kind, 'enter');
	// 空批次交给循环自己收口
	assert.equal((await run({ agent: agentOf(HOST), messages: [], turn: 1, step: 1 })).kind, 'enter');
	assert.equal(rows.length, 0);
});

test('index.js registers the gate against the project host sessions and disposes it', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	assert.match(index, /registerHostNoticeGate\(\{/);
	assert.match(index, /runtime\.service\.state\.hostSessionId === sessionId\) return \{ projectId: runtime\.id \}/);
	assert.match(index, /hostNoticeGate\.dispose\(\);/);
});
