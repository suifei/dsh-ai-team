import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_WAKE_TOOLS, registerStopGuard, stoppedTeamDenial } from '../lib/runtime/stop-guard.js';
import { isErrorEvent } from '../lib/diaglog.js';

// 实机（il2c 11-14 20:14）：停止后成员回合被中断（生效），但 PMO 收到「成员被停」通知后
// 用宿主内置 send_message 发「续跑唤醒」，成员又跑了 25 分钟。

const teams = {
	'pmo-1': { projectId: 'prj_a', projectName: 'il2c', stopped: true },
	'mem-1': { projectId: 'prj_a', projectName: 'il2c', stopped: true },
	'mem-2': { projectId: 'prj_b', projectName: 'B', stopped: false },
};
const projectOf = (sessionId) => teams[sessionId] ?? null;

test('while stopped, team sessions cannot wake or spawn agents through host tools', () => {
	for (const name of ['send_message', 'subagent', 'subagent_fork', 'subagent_oar', 'ralph']) {
		assert.ok(AGENT_WAKE_TOOLS.has(name));
		const denial = stoppedTeamDenial({ name, agent: { id: 'pmo-1' } }, projectOf);
		assert.equal(denial?.projectId, 'prj_a', `${name} from the PMO is refused`);
		assert.match(denial.reason, /项目「il2c」已被 Human 停止/);
		assert.match(denial.reason, /不要续跑/, 'tells the model this was Human, not a crash');
	}
	assert.ok(stoppedTeamDenial({ name: 'send_message', agent: { id: 'mem-1' } }, projectOf), 'members too');
	assert.equal(stoppedTeamDenial({ name: 'send_message', agent: { id: 'mem-2' } }, projectOf), null, 'a running project is untouched');
	assert.equal(stoppedTeamDenial({ name: 'send_message', agent: { id: 'someone-else' } }, projectOf), null, 'sessions outside any team are untouched');
	assert.equal(stoppedTeamDenial({ name: 'pwsh', agent: { id: 'mem-1' } }, projectOf), null, 'other tools are untouched');
	assert.equal(stoppedTeamDenial({ name: 'send_message' }, projectOf), null);
});

test('the guard registers on tools.guard, logs a visible row, and never breaks a call on its own error', () => {
	let guard = null;
	const rows = [];
	const dispose = registerStopGuard({ tools: { guard: (fn) => { guard = fn; return () => { guard = null; }; } }, projectOf, diag: { append: (row) => rows.push(row) } });
	assert.match(guard({ name: 'send_message', agent: { id: 'mem-1' } }), /已被 Human 停止/);
	assert.deepEqual(rows, [{ ev: 'team.stopped.blocked', projectId: 'prj_a', sessionId: 'mem-1', tool: 'send_message' }]);
	assert.equal(isErrorEvent('team.stopped.blocked'), true, 'visible at the shipped errors level');
	assert.equal(guard({ name: 'send_message', agent: { id: 'mem-2' } }), undefined);
	const broken = registerStopGuard({ tools: { guard: (fn) => { guard = fn; return () => {}; } }, projectOf: () => { throw new Error('boom'); } });
	assert.equal(guard({ name: 'send_message', agent: { id: 'mem-1' } }), undefined);
	broken();
	dispose();
	assert.equal(typeof registerStopGuard({ tools: {} , projectOf }), 'function', 'no guard API: no-op disposer');
});
