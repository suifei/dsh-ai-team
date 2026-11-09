import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLlmFailure, FAILURE_CATEGORY, retryDecision } from '../lib/runtime/failure-policy.js';
import {
	applyMemberConfigPatch,
	buildAgentOptions,
	DEFAULT_MEMBER_CONFIG,
	normalizeMemberConfig,
	validateMemberConfigPolicy,
} from '../lib/domain/member-config.js';
import { DomainError } from '../lib/domain/errors.js';

test('classifies auth, billing, rate limit, network, model, context and policy failures', () => {
	assert.equal(classifyLlmFailure({ status: 401 }).category, FAILURE_CATEGORY.AUTH);
	assert.equal(classifyLlmFailure({ status: 402 }).humanRequired, true);
	assert.equal(classifyLlmFailure({ status: 429 }).retryable, true);
	assert.equal(classifyLlmFailure({ code: 'ECONNRESET' }).category, FAILURE_CATEGORY.NETWORK);
	assert.equal(classifyLlmFailure({ status: 500 }).category, FAILURE_CATEGORY.SERVER);
	assert.equal(classifyLlmFailure({ status: 404, message: 'model not found' }).action, 'fallback');
	assert.equal(classifyLlmFailure({ message: 'maximum context length exceeded' }).category, FAILURE_CATEGORY.CONTEXT_OVERFLOW);
	assert.equal(classifyLlmFailure({ status: 400, message: 'content policy refusal' }).category, FAILURE_CATEGORY.POLICY);
	assert.equal(classifyLlmFailure({ message: 'odd failure' }).retryable, false);
});

test('retryDecision falls back within budget and stops when exhausted', () => {
	const config = {
		provider: 'p1',
		model: 'm1',
		fallback: [{ provider: 'p2', model: 'm2' }],
		retry: { maxAttempts: 2 },
	};
	const first = retryDecision(classifyLlmFailure({ status: 429 }), config, 1);
	assert.equal(first.action, 'fallback');
	assert.deepEqual(first.patch, { provider: 'p2', model: 'm2' });
	const second = retryDecision(classifyLlmFailure({ status: 429 }), config, 2);
	assert.equal(second.action, 'fail');
	const noFallback = retryDecision(classifyLlmFailure({ status: 500 }), { ...config, fallback: [] }, 1);
	assert.equal(noFallback.action, 'retry');
	assert.equal(retryDecision(classifyLlmFailure({ status: 402 }), config, 1).action, 'fail');
});

test('member config validates model, context, fallback and budgets', () => {
	const config = normalizeMemberConfig({
		provider: 'deepseek',
		model: 'deepseek-chat',
		maxTokens: 8192,
		contextWindow: 65536,
		compactionThreshold: 0.8,
		fallback: [{ provider: 'deepseek', model: 'deepseek-reasoner' }],
		retry: { maxAttempts: 3 },
	});
	assert.equal(config.retry.maxAttempts, 3);
	assert.equal(config.fallback.length, 1);
	assert.deepEqual(buildAgentOptions(config), { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 8192 });
	assert.throws(() => normalizeMemberConfig({ fallback: [1, 2, 3, 4] }), DomainError);
	assert.throws(() => normalizeMemberConfig({ contextWindow: 100 }), DomainError);
	assert.throws(() => normalizeMemberConfig({ compactionThreshold: 1.2 }), DomainError);
});

test('config patch versions only on real change and enforces Team policy', () => {
	const current = normalizeMemberConfig({ provider: 'p1', model: 'm1' });
	const changed = applyMemberConfigPatch(current, { model: 'm2' }, { policy: { allowedModels: ['m1', 'm2'] } });
	assert.equal(changed.changed, true);
	assert.equal(changed.config.configVersion, 1);
	assert.equal(changed.config.model, 'm2');
	const same = applyMemberConfigPatch(changed.config, { model: 'm2' }, { configVersion: 1 });
	assert.equal(same.changed, false);
	assert.equal(same.config.configVersion, 1);
	assert.throws(
		() => applyMemberConfigPatch(current, { model: 'other' }, { policy: { allowedModels: ['m1'] } }),
		(error) => error instanceof DomainError && error.code === 'E_CONFIG_POLICY',
	);
	assert.throws(
		() => validateMemberConfigPolicy(normalizeMemberConfig({ retry: { maxAttempts: 5 } }), { maxAttempts: 2 }),
		DomainError,
	);
});

test('defaults keep context budgets bounded and no timer fields exist', () => {
	assert.equal(DEFAULT_MEMBER_CONFIG.retry.maxAttempts, 3);
	assert.equal(DEFAULT_MEMBER_CONFIG.fallback.length, 0);
	assert.equal('retryDelayMs' in DEFAULT_MEMBER_CONFIG.retry, false);
});
