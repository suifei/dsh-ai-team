import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCauseChain } from '../lib/runtime/error-chain.js';

test('renders the cause chain with codes, innermost last', () => {
	// 实机形态：外层 NOT_RESUMABLE 只说「is unavailable」，真正原因在 cause 上。
	const inner = Object.assign(new Error('failed to read stored session "abc": ENOENT'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' });
	const outer = Object.assign(new Error('subagent "abc" is unavailable'), { code: 'NOT_RESUMABLE', cause: inner });
	const text = describeCauseChain(outer);
	assert.match(text, /SESSION_QUERY_PERSISTENCE_FAILED: failed to read stored session "abc": ENOENT/);
	assert.equal(text.includes('is unavailable'), false, 'the outer message is already logged separately');
});

test('walks several levels and stops at the depth limit', () => {
	let error = new Error('root');
	for (let depth = 0; depth < 6; depth += 1) {
		error = Object.assign(new Error(`level-${depth}`), { cause: error });
	}
	const text = describeCauseChain(error);
	// 外层 message（level-5）不进链；只摊平它的 cause，最多 4 层。
	assert.equal(text.split(' ← ').length, 4);
	assert.match(text, /^level-4 ← level-3 ← level-2 ← level-1$/);
});

test('survives cycles, missing causes and non-error payloads', () => {
	const a = new Error('a');
	const b = Object.assign(new Error('b'), { cause: a });
	a.cause = b; // 循环
	assert.ok(describeCauseChain(a).length > 0);
	assert.equal(describeCauseChain(new Error('no cause')), null);
	assert.equal(describeCauseChain(undefined), null);
	assert.equal(describeCauseChain(null), null);
	// 非 Error 的 cause（SDK 里出现过字符串/对象）也要能渲染
	assert.equal(describeCauseChain({ message: 'x', cause: { message: 'plain' } }), 'plain');
});
