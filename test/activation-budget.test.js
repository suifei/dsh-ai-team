import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivationBudget } from '../lib/runtime/activation-budget.js';

test('a reseat loop is capped inside the window and becomes visible', () => {
	// issue #1：一句「在吗」跑了 7 小时、200+ 子代理 —— 失败→重建→再失败无上限。
	const budget = createActivationBudget({ limit: 3, windowMs: 60_000 });
	const start = 1_000_000;
	assert.equal(budget.take('mem_lead', start).allowed, true);
	assert.equal(budget.take('mem_lead', start + 1_000).allowed, true);
	assert.equal(budget.take('mem_lead', start + 2_000).allowed, true);
	const denied = budget.take('mem_lead', start + 3_000);
	assert.equal(denied.allowed, false);
	assert.equal(denied.count, 3);
	assert.equal(denied.limit, 3);

	// 额度按成员独立
	assert.equal(budget.take('mem_coder', start + 3_000).allowed, true);
	// 只读查询不消耗额度
	assert.equal(budget.peek('mem_lead', start + 3_000), 3);

	// 窗口滑过之后恢复
	assert.equal(budget.take('mem_lead', start + 61_000).allowed, true);
});

test('reset clears one member and defaults are generous enough for real work', () => {
	const budget = createActivationBudget();
	const now = 5_000_000;
	for (let index = 0; index < 6; index += 1) {
		assert.equal(budget.take('mem_a', now + index).allowed, true, `take ${index}`);
	}
	assert.equal(budget.take('mem_a', now + 10).allowed, false);
	budget.reset('mem_a');
	assert.equal(budget.take('mem_a', now + 20).allowed, true);
	// 非法 id 直接放行（不记账）
	assert.equal(budget.take('', now).allowed, true);
});
