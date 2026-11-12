import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWakeFailure } from '../lib/runtime/wake-failure.js';
import { describeCauseChain } from '../lib/runtime/error-chain.js';

test('a busy write handle is a known condition, not an unknown failure', () => {
	// 实机形态：外层 NOT_RESUMABLE，cause 指明会话仍被活跃写句柄占用。
	const outer = Object.assign(new Error('subagent "x" is unavailable'), {
		code: 'NOT_RESUMABLE',
		cause: Object.assign(new Error('session "x" is already owned by an active write handle'), { code: 'SESSION_PERSISTENCE_OWNED' }),
	});
	assert.equal(classifyWakeFailure(describeCauseChain(outer)), 'wake.session-busy');
});

test('every other cause still counts as a real failure', () => {
	const cases = [
		Object.assign(new Error('subagent "y" is unavailable'), { cause: new Error('no supported continuation state') }),
		Object.assign(new Error('subagent "z" is unavailable'), { cause: new Error('subagent "z" has no agent preset projection') }),
		new Error('plain failure without a cause'),
	];
	for (const error of cases) {
		assert.equal(classifyWakeFailure(describeCauseChain(error)), 'wake.fail', error.message);
	}
	assert.equal(classifyWakeFailure(null), 'wake.fail');
	assert.equal(classifyWakeFailure(undefined), 'wake.fail');
	// 只认 "active write handle"，不要在无关文本上误判
	assert.equal(classifyWakeFailure('session closed by a write handle timeout'), 'wake.fail');
});
