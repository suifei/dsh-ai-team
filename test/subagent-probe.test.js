import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksActivation, probeProviderRegistration } from '../lib/runtime/subagent-probe.js';

test('a host without list() is unknown, not empty — activation must not be blocked (rc.2 regression)', () => {
	// 实机（issue #1 借楼）：0.2.2-rc.2 移除了 SubagentRuntime.list()，
	// 旧探测 `typeof list === 'function' ? list() : []` 把能力缺失当状态为空 → 恒 503。
	const rc2 = { startActivation() {}, registerProvider() {}, getProvider() {}, listDescendants() {} };
	assert.equal(probeProviderRegistration(rc2), 'unknown');
	assert.equal(blocksActivation('unknown'), false);

	// list 抛错同样按问不到处理。
	assert.equal(probeProviderRegistration({ list() { throw new Error('cordis transport'); } }), 'unknown');
});

test('rc.1-style introspection still distinguishes empty from ready', () => {
	assert.equal(probeProviderRegistration({ list: () => ['local'] }), 'ready');
	assert.equal(probeProviderRegistration({ list: () => [] }), 'empty');
	assert.equal(blocksActivation('empty'), true);
	assert.equal(blocksActivation('ready'), false);
});

test('a missing service is reported separately and never pretends to be ready', () => {
	assert.equal(probeProviderRegistration(undefined), 'no-service');
	assert.equal(probeProviderRegistration(null), 'no-service');
	// no-service 由调用方既有的 E_RUNTIME_UNAVAILABLE 分支处理，探测器不挡也不放。
	assert.equal(blocksActivation('no-service'), false);
});
