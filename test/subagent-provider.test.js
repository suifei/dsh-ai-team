import test from 'node:test';
import assert from 'node:assert/strict';
import { isRuntimeUnavailableFailure, resolveSubagentProviderName } from '../lib/runtime/subagent-provider.js';

test('rc.2 has no list(), so the provider name comes from getProvider(spawn)', () => {
	// 实机：`(subagents.list?.() ?? [])[0]` 在 rc.2 上恒为 undefined，激活直接
	// E_RUNTIME_UNAVAILABLE: no subagent provider or parent Agent is available。
	const rc2 = {
		registerProvider() {},
		getProvider: (name) => (name === 'spawn' ? { name: 'spawn' } : undefined),
		startActivation() {},
	};
	assert.equal(resolveSubagentProviderName(rc2), 'spawn');
	assert.equal(resolveSubagentProviderName(rc2, ''), 'spawn');
	// 配置指定了别的名字也认，只要宿主真的注册了。
	assert.equal(resolveSubagentProviderName(rc2, 'custom'), 'spawn', '未注册的配置名要回落到可用候选');
});

test('rc.1 enumerates providers and prefers the first one', () => {
	const rc1 = {
		list: () => ['local', 'spawn'],
		getProvider: () => ({ name: 'x' }),
	};
	assert.equal(resolveSubagentProviderName(rc1), 'local');
	assert.equal(resolveSubagentProviderName(rc1, 'spawn'), 'spawn', '配置优先于枚举顺序');
	// list() 抛错时仍要给出可用名字
	const flaky = { list: () => { throw new Error('boom'); }, getProvider: (n) => (n === 'spawn' ? {} : undefined) };
	assert.equal(resolveSubagentProviderName(flaky), 'spawn');
});

test('no subagent service or no verification means no invented provider', () => {
	assert.equal(resolveSubagentProviderName(undefined), undefined);
	assert.equal(resolveSubagentProviderName(null), undefined);
	// 没有任何 getProvider：不武断返回 undefined，交给 startActivation 报真实错误
	assert.equal(resolveSubagentProviderName({ list: () => ['only'] }), 'only');
	assert.equal(resolveSubagentProviderName({ getProvider: () => undefined }), undefined);
});

test('only runtime-unavailable failures qualify for the automatic rescue', () => {
	const runtimeFail = { status: 'failed', lastFailure: { category: 'unknown', message: 'no subagent provider or parent Agent is available' } };
	assert.equal(isRuntimeUnavailableFailure(runtimeFail), true);
	const codeFail = { status: 'failed', lastFailure: { category: 'E_RUNTIME_UNAVAILABLE', message: '' } };
	assert.equal(isRuntimeUnavailableFailure(codeFail), true);
	// 其它失败不自动复活：缺 key、限流、任务本身出错都该由人判断
	assert.equal(isRuntimeUnavailableFailure({ status: 'failed', lastFailure: { category: 'auth', message: 'no API key' } }), false);
	assert.equal(isRuntimeUnavailableFailure({ status: 'running', lastFailure: runtimeFail.lastFailure }), false);
	assert.equal(isRuntimeUnavailableFailure({ status: 'failed', lastFailure: null }), false);
	assert.equal(isRuntimeUnavailableFailure(null), false);
});
