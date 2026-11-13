import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWakeFailure, isMalformedTurnError } from '../lib/runtime/wake-failure.js';
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

test('a truncated tool-call argument is recognised as a retryable turn failure', () => {
	// 实机（2026-11-13）：team 调用只发到 `{"action": "tasks", "qaChecklist": ` 就断了。
	const real = {
		kind: 'error',
		error: {
			message: 'Tool call "team": Unexpected end of JSON input\n\nReceived arguments:\n{"action": "tasks", "qaChecklist": ',
			code: 'MALFORMED_RESPONSE',
		},
	};
	assert.equal(isMalformedTurnError(real), true);
	// 只认结构化码或该症状：别的回合错误（取消、限流、最大 token）不该走续跑。
	assert.equal(isMalformedTurnError({ kind: 'error', error: { code: 'RATE_LIMITED', message: 'slow down' } }), false);
	assert.equal(isMalformedTurnError({ kind: 'aborted', reason: { kind: 'user' } }), false);
	assert.equal(isMalformedTurnError({ kind: 'max-tokens' }), false);
	assert.equal(isMalformedTurnError(null), false);
	assert.equal(isMalformedTurnError(undefined), false);
	// 没有 code 但症状对得上（不同宿主版本的错误形状）也要认。
	assert.equal(isMalformedTurnError({ kind: 'error', error: { message: 'Unexpected end of JSON input' } }), true);
});
