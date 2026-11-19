import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { createTeamTool } from '../lib/host/member-tools.js';

// Grok 4.7 在第一条回复前回 HTTP 400：工具的 function.parameters 必须是完整的对象 JSON Schema
// （type: 'object' + properties），不能是裸的属性表。宿主把注册时的 parameters 原样转给模型，
// 一个工具不合规整个请求就被拒（PR #88：桌面端 93 个工具）。这里走插件真实的 apply()，
// 捕获插件注册的**每一个**工具——SkillOpt 内置 7 个之外，index.js 自己注册的
// skillopt_rubric / judge / optimize / jobs 同样必须合规，以后新加的工具也逃不过这条断言。
function bootTools() {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-tool-schemas-'));
	const prev = process.env.DSH_HOME;
	process.env.DSH_HOME = root;
	const registered = new Map();
	const tools = {
		register(definition) {
			registered.set(definition.name, definition);
			return () => registered.delete(definition.name);
		},
	};
	const disposers = [];
	const ctx = {
		effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); },
		on() { return () => {}; },
		get(id) {
			if (id === 'tools') return tools;
			if (id === 'connection') return { requestRejection: () => undefined };
			if (id === 'webServer') return { register() { return () => {}; } };
			if (id === 'permissionPresets') return { catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }), resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }) };
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
	apply(ctx);
	const close = () => {
		for (const dispose of disposers.reverse()) { try { dispose(); } catch { /* best effort */ } }
		if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
		rmSync(root, { recursive: true, force: true });
	};
	return { registered, close };
}

/** 一个 JSON Schema 节点是否「对象 schema」：type 'object'，properties 是普通对象，每个属性都带 type。 */
function assertObjectSchema(name, schema) {
	assert.equal(schema?.type, 'object', `${name}: parameters.type must be 'object'`);
	assert.ok(schema.properties !== null && typeof schema.properties === 'object' && !Array.isArray(schema.properties), `${name}: parameters.properties must be an object`);
	for (const [key, property] of Object.entries(schema.properties)) {
		assert.equal(typeof property?.type, 'string', `${name}.${key}: every property needs a JSON Schema type`);
		assert.notEqual(key, 'type', `${name}: a property named 'type' means a bare property map leaked through`);
	}
	if (schema.required !== undefined) {
		assert.ok(Array.isArray(schema.required), `${name}: required must be an array`);
		for (const key of schema.required) assert.ok(key in schema.properties, `${name}: required '${key}' is not a property`);
	}
}

test('every tool the plugin registers has an object JSON Schema for parameters (Grok 4.7 HTTP 400, PR #88)', (t) => {
	const { registered, close } = bootTools();
	t.after(close);
	const names = [...registered.keys()].sort();
	// 11 个 SkillOpt 工具全在：内置 7 个 + index.js 自己注册的 4 个。
	for (const name of [
		'skillopt_status', 'skillopt_dry_run', 'skillopt_run', 'skillopt_adopt',
		'skillopt_harvest', 'skillopt_schedule', 'skillopt_unschedule',
		'skillopt_rubric', 'skillopt_judge', 'skillopt_optimize', 'skillopt_jobs',
	]) assert.ok(registered.has(name), `${name} was not registered (got ${names.join(', ')})`);
	for (const [name, definition] of registered) assertObjectSchema(name, definition.parameters);
});

test('the four index.js SkillOpt tools keep their exact argument names', (t) => {
	const { registered, close } = bootTools();
	t.after(close);
	const keys = (name) => Object.keys(registered.get(name).parameters.properties);
	assert.deepEqual(keys('skillopt_rubric'), ['project', 'skillPath', 'dim8', 'measured']);
	assert.deepEqual(keys('skillopt_judge'), ['project', 'beforePath', 'afterPath']);
	assert.deepEqual(keys('skillopt_optimize'), ['project', 'skillPath', 'candidate']);
	assert.deepEqual(keys('skillopt_jobs'), ['project']);
	assert.equal(registered.get('skillopt_rubric').parameters.properties.dim8.type, 'number');
	assert.equal(registered.get('skillopt_rubric').parameters.properties.measured.type, 'boolean');
});

test('the per-Agent team tool (not registered through the global tool registry) has an object schema too', () => {
	const team = createTeamTool({ getState: () => ({}), dispatch: async () => ({}) });
	assertObjectSchema('team', team.parameters);
	assert.equal(team.parameters.properties.action.type, 'string');
});
