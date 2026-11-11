import test from 'node:test';
import assert from 'node:assert/strict';
import { GUARDED_SKILLOPT_TOOLS, wrapToolsWithSkilloptAccess } from '../lib/skillopt/tool-access.js';

/** Minimal stand-in for ctx.tools that records what was registered. */
function fakeTools() {
	const registered = new Map();
	return {
		registered,
		register(definition) {
			registered.set(definition.name, definition);
			return () => registered.delete(definition.name);
		},
	};
}

function registerThrough(isAllowed, names = [...GUARDED_SKILLOPT_TOOLS, 'skillopt_status']) {
	const tools = fakeTools();
	const proxy = wrapToolsWithSkilloptAccess(tools, isAllowed);
	let calls = 0;
	for (const name of names) {
		proxy.register({ name, description: '', parameters: {}, output: { schema: {}, render: () => [] }, async execute() { calls += 1; return `${name}:ran`; } });
	}
	return { tools, calls: () => calls };
}

test('a delegated subagent cannot run the mutating skillopt tools', async () => {
	const { tools, calls } = registerThrough(() => false);
	const adopt = tools.registered.get('skillopt_adopt');
	const output = await adopt.execute({ project: '/tmp/p' }, { agent: { id: 'worker-1' } });
	assert.match(output, /refusing/);
	assert.equal(calls(), 0, 'the underlying execute must not run');
});

test('an allowed caller reaches the wrapped implementation', async () => {
	const { tools, calls } = registerThrough(() => true);
	const adopt = tools.registered.get('skillopt_adopt');
	assert.equal(await adopt.execute({ project: '/tmp/p' }, { agent: { id: 'member-1' } }), 'skillopt_adopt:ran');
	assert.equal(calls(), 1);
});

test('read-only skillopt tools are not gated', async () => {
	const { tools, calls } = registerThrough(() => false);
	const status = tools.registered.get('skillopt_status');
	assert.equal(await status.execute({}, { agent: { id: 'worker-1' } }), 'skillopt_status:ran');
	assert.equal(calls(), 1);
});

test('a throwing predicate fails closed instead of leaking through', async () => {
	const { tools, calls } = registerThrough(() => { throw new Error('boom'); });
	const run = tools.registered.get('skillopt_run');
	assert.match(await run.execute({}, { agent: { id: 'worker-1' } }), /refusing/);
	assert.equal(calls(), 0);
});
