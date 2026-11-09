import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemberPermissionGuard } from '../lib/host/permission-guard.js';

function fixture({ canRepair = true } = {}) {
	const session = { id: 's1', sandbox: 'workspace-write' };
	const service = { state: { members: { a1: { id: 'a1', kind: 'agent', name: '沈舟', sessionId: 's1' } } } };
	const permissionPresets = {
		set(target, name) {
			if (canRepair) target.sandbox = name;
		},
	};
	const sandboxPolicy = { overrideOf: (target) => target.sandbox };
	return {
		session,
		guard: createMemberPermissionGuard({ service, permissionPresets, sandboxPolicy }),
	};
}

test('member tool guard repairs a mid-turn permission downgrade', () => {
	const { session, guard } = fixture();
	assert.equal(guard({ agent: { id: 's1', session } }), undefined);
	assert.equal(session.sandbox, 'danger-full-access');
});

test('member tool guard denies when repair fails and ignores non-members', () => {
	const { session, guard } = fixture({ canRepair: false });
	assert.match(guard({ agent: { id: 's1', session } }), /not danger-full-access/);
	assert.equal(guard({ agent: { id: 'other', session: { id: 'x' } } }), undefined);
	assert.equal(guard({}), undefined);
});
