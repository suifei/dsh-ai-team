import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, name } from '../lib/vendor/skillopt/src/index.js';

test('bundled SkillOpt registers its seven tools and unregisters on dispose', () => {
	const tools = new Map();
	const disposers = [];
	const dispose = apply({
		tools: {
			register(definition) {
				tools.set(definition.name, definition);
				const remove = () => tools.delete(definition.name);
				disposers.push(remove);
				return remove;
			},
		},
		shell: { execute: async () => ({ result: async () => ({ exitCode: 0 }) }) },
		logger: { info() {} },
	}, { backend: 'mock', project: 'E:/works/dsh-ai-team' });
	assert.equal(name, 'skillopt');
	assert.deepEqual([...tools.keys()], [
		'skillopt_status', 'skillopt_dry_run', 'skillopt_run', 'skillopt_adopt',
		'skillopt_harvest', 'skillopt_schedule', 'skillopt_unschedule',
	]);
	assert.equal(typeof dispose, 'function');
	dispose();
	assert.equal(tools.size, 0);
});
