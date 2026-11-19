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
	for (const [toolName, { parameters }] of tools) {
		assert.equal(parameters.type, 'object', toolName + ' must register a complete object schema');
		assert.equal(parameters.properties.project.type, 'string');
	}
	assert.deepEqual(Object.keys(tools.get('skillopt_dry_run').parameters.properties), [
		'project', 'source', 'backend', 'model', 'maxTasks', 'progress',
	]);
	assert.equal(typeof dispose, 'function');
	dispose();
	assert.equal(tools.size, 0);
});
