import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemberPermissionGuard, resolveTeamPreset, TEAM_PERMISSION } from '../lib/host/permission-guard.js';

/** 一个只有 `full` 这一档 danger-full-access 的部署。 */
function customPresets() {
	const table = { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' }, full: { sandbox: 'danger-full-access', approval: 'never' } };
	const sessions = new WeakMap();
	return {
		resolve(name) {
			if (table[name] === undefined) throw new Error(`unknown preset: ${name}`);
			return table[name];
		},
		list() { return Object.keys(table); },
		set(session, name) {
			if (table[name] === undefined) throw new Error(`unknown preset: ${name}`);
			sessions.set(session, name);
		},
		current(session) { return sessions.get(session); },
	};
}

test('resolves the deployed name for full access instead of hardcoding it', () => {
	const presets = customPresets();
	assert.equal(resolveTeamPreset(presets), 'full');
});

test('falls back to the conventional name when the table has no matching preset', () => {
	assert.equal(resolveTeamPreset({ resolve: () => ({ sandbox: 'workspace-write' }), list: () => ['workspace-write'] }), TEAM_PERMISSION);
});

test('the guard restores full access through the deployed preset name', () => {
	const presets = customPresets();
	const session = { id: 's1' };
	let mode = 'workspace-write';
	const guard = createMemberPermissionGuard({
		service: { state: { members: { m1: { id: 'm1', name: '沈舟', kind: 'agent', sessionId: 's1' } } } },
		permissionPresets: { ...presets, set: (target, name) => { presets.set(target, name); mode = presets.resolve(name).sandbox; } },
		sandboxPolicy: { overrideOf: () => mode },
	});
	// 硬编码 danger-full-access 时，这里会因为未知预设而直接返回拒绝字符串。
	assert.equal(guard({ agent: { id: 's1', session } }), undefined);
	assert.equal(mode, 'danger-full-access');
});
