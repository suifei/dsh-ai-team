import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_WAKE_TOOLS, oneShotToolDenial, registerOneShotToolGuard, registerStopGuard, stoppedTeamDenial } from '../lib/runtime/stop-guard.js';
import { registerTeamDiscipline } from '../lib/runtime/deferral-guard.js';
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

// il2c night 8：作答子代理继承 danger-full-access、工作目录即 il2c，回放题里真去读仓库与账本「取证」。
test('SkillOpt one-shot children may not call any tool; other sessions are untouched', () => {
	let guard = null;
	const rows = [];
	const discipline = registerTeamDiscipline({ teamProjectOf: (id) => (id === 'pmo-1' ? { projectId: 'prj_a', stopped: false } : null), newId: () => 'x' });
	discipline.observe({ id: 'answer-1', header: { parentSession: 'pmo-1' } }, { type: 'subagent/descriptor', data: { label: 'skillopt-reviewer-handoff-846de7a7f7d2943d' } });
	discipline.exempt('judge-1');
	const dispose = registerOneShotToolGuard({ tools: { guard: (fn) => { guard = fn; return () => { guard = null; }; } }, isOneShot: discipline.isOneShot, diag: { append: (row) => rows.push(row) } });
	for (const name of ['read_file', 'pwsh', 'write_file', 'team', 'skillopt_status']) {
		assert.match(guard({ name, agent: { id: 'answer-1' } }), /只凭题面文字回答/, name);
	}
	assert.match(guard({ name: 'bash', agent: { id: 'judge-1' } }), /不得调用任何工具（bash）/);
	assert.equal(guard({ name: 'pwsh', agent: { id: 'pmo-1' } }), undefined, 'the PMO itself keeps its tools');
	assert.equal(guard({ name: 'pwsh', agent: { id: 'mem-9' } }), undefined);
	assert.equal(oneShotToolDenial({ name: 'pwsh', agent: {} }, () => true), null, 'agentless calls are not judged');
	assert.deepEqual(rows[0], { ev: 'skillopt.oneshot.tool.blocked', sessionId: 'answer-1', tool: 'read_file' });
	assert.equal(isErrorEvent('skillopt.oneshot.tool.blocked'), true, 'visible at the shipped errors level');
	registerOneShotToolGuard({ tools: { guard: (fn) => { guard = fn; return () => {}; } }, isOneShot: () => { throw new Error('boom'); } });
	assert.equal(guard({ name: 'pwsh', agent: { id: 'answer-1' } }), undefined, 'a guard error never breaks a call');
	dispose();
});
