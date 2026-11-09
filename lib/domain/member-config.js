import { ERRORS, fail } from './errors.js';

/**
 * Member model/context configuration. The Project owner (Agent Lead) may
 * update it within the Team policy; Human may always update it. Config is
 * versioned and takes effect at the next wake, never mid-turn.
 */
export const MEMBER_CONFIG_VERSION = 1;

export const DEFAULT_MEMBER_CONFIG = Object.freeze({
	provider: '',
	model: '',
	reasoningEffort: null,
	maxTokens: null,
	contextWindow: null,
	compactionThreshold: 0.8,
	fallback: [],
	retry: { maxAttempts: 3 },
	memoryBudgetTokens: 4096,
	skillBudgetTokens: 2048,
	notesBudgetTokens: 2048,
});

export const CONFIG_FIELDS = Object.freeze([
	'provider', 'model', 'reasoningEffort', 'maxTokens', 'contextWindow',
	'compactionThreshold', 'fallback', 'retry',
	'memoryBudgetTokens', 'skillBudgetTokens', 'notesBudgetTokens',
]);

function isInt(value) {
	return Number.isSafeInteger(value);
}

function positiveInt(value, name, max) {
	if (!isInt(value) || value < 1 || value > max) fail(ERRORS.INVALID_ARGUMENT, `${name} must be an integer in 1..${max}`);
}

function textOrNull(value) {
	return typeof value === 'string' && value !== '' ? value : null;
}

function normalizeFallback(value) {
	if (!Array.isArray(value)) fail(ERRORS.INVALID_ARGUMENT, 'fallback must be an array');
	if (value.length > 3) fail(ERRORS.INVALID_ARGUMENT, 'fallback supports at most 3 entries');
	return value.map((entry, index) => {
		if (entry === null || typeof entry !== 'object') fail(ERRORS.INVALID_ARGUMENT, `fallback[${index}] must be an object`);
		if (typeof entry.provider !== 'string' || entry.provider === '') fail(ERRORS.INVALID_ARGUMENT, `fallback[${index}].provider is required`);
		if (typeof entry.model !== 'string' || entry.model === '') fail(ERRORS.INVALID_ARGUMENT, `fallback[${index}].model is required`);
		if (entry.maxTokens !== undefined) positiveInt(entry.maxTokens, `fallback[${index}].maxTokens`, 1_000_000);
		return {
			provider: entry.provider,
			model: entry.model,
			...(textOrNull(entry.reasoningEffort) === null ? {} : { reasoningEffort: entry.reasoningEffort }),
			...(entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens }),
		};
	});
}

/** Merge + validate one complete config; throws DomainError on invalid fields. */
export function normalizeMemberConfig(input = {}, base = DEFAULT_MEMBER_CONFIG) {
	const value = input ?? {};
	const provider = value.provider === undefined ? base.provider : value.provider;
	const model = value.model === undefined ? base.model : value.model;
	if (typeof provider !== 'string') fail(ERRORS.INVALID_ARGUMENT, 'provider must be a string');
	if (typeof model !== 'string') fail(ERRORS.INVALID_ARGUMENT, 'model must be a string');
	const reasoningEffort = value.reasoningEffort === undefined ? base.reasoningEffort : textOrNull(value.reasoningEffort);
	if (reasoningEffort !== null && typeof reasoningEffort !== 'string') fail(ERRORS.INVALID_ARGUMENT, 'reasoningEffort must be a string or null');
	const maxTokens = value.maxTokens === undefined ? base.maxTokens : value.maxTokens;
	if (maxTokens !== null) positiveInt(maxTokens, 'maxTokens', 1_000_000);
	const contextWindow = value.contextWindow === undefined ? base.contextWindow : value.contextWindow;
	if (contextWindow !== null) {
		if (!isInt(contextWindow) || contextWindow < 4_096 || contextWindow > 2_000_000) {
			fail(ERRORS.INVALID_ARGUMENT, 'contextWindow must be an integer in 4096..2000000 or null');
		}
	}
	const compactionThreshold = value.compactionThreshold === undefined ? base.compactionThreshold : value.compactionThreshold;
	if (typeof compactionThreshold !== 'number' || !Number.isFinite(compactionThreshold) || compactionThreshold < 0.5 || compactionThreshold > 0.95) {
		fail(ERRORS.INVALID_ARGUMENT, 'compactionThreshold must be in 0.5..0.95');
	}
	const fallback = value.fallback === undefined ? normalizeFallback(base.fallback) : normalizeFallback(value.fallback);
	const retryInput = value.retry === undefined ? base.retry : value.retry;
	if (retryInput === null || typeof retryInput !== 'object') fail(ERRORS.INVALID_ARGUMENT, 'retry must be an object');
	const maxAttempts = retryInput.maxAttempts === undefined ? base.retry.maxAttempts : retryInput.maxAttempts;
	positiveInt(maxAttempts, 'retry.maxAttempts', 5);
	const memoryBudgetTokens = value.memoryBudgetTokens === undefined ? base.memoryBudgetTokens : value.memoryBudgetTokens;
	const skillBudgetTokens = value.skillBudgetTokens === undefined ? base.skillBudgetTokens : value.skillBudgetTokens;
	const notesBudgetTokens = value.notesBudgetTokens === undefined ? base.notesBudgetTokens : value.notesBudgetTokens;
	for (const [name, amount] of [['memoryBudgetTokens', memoryBudgetTokens], ['skillBudgetTokens', skillBudgetTokens], ['notesBudgetTokens', notesBudgetTokens]]) {
		positiveInt(amount, name, 128_000);
	}
	return {
		provider,
		model,
		reasoningEffort,
		maxTokens,
		contextWindow,
		compactionThreshold,
		fallback,
		retry: { maxAttempts },
		memoryBudgetTokens,
		skillBudgetTokens,
		notesBudgetTokens,
	};
}

/** Team-level allow-list; a Lead can only choose inside this envelope. */
export function validateMemberConfigPolicy(config, policy = {}) {
	if (Array.isArray(policy.allowedProviders) && !policy.allowedProviders.includes(config.provider)) {
		fail(ERRORS.CONFIG_POLICY, `provider ${config.provider} is not allowed by the Team policy`);
	}
	if (Array.isArray(policy.allowedModels) && !policy.allowedModels.includes(config.model)) {
		fail(ERRORS.CONFIG_POLICY, `model ${config.model} is not allowed by the Team policy`);
	}
	for (const [index, fallback] of config.fallback.entries()) {
		if (Array.isArray(policy.allowedProviders) && !policy.allowedProviders.includes(fallback.provider)) {
			fail(ERRORS.CONFIG_POLICY, `fallback[${index}].provider ${fallback.provider} is not allowed`);
		}
		if (Array.isArray(policy.allowedModels) && !policy.allowedModels.includes(fallback.model)) {
			fail(ERRORS.CONFIG_POLICY, `fallback[${index}].model ${fallback.model} is not allowed`);
		}
	}
	if (isInt(policy.maxAttempts) && config.retry.maxAttempts > policy.maxAttempts) {
		fail(ERRORS.CONFIG_POLICY, `retry.maxAttempts exceeds Team policy ${policy.maxAttempts}`);
	}
	if (isInt(policy.maxTokens) && config.maxTokens !== null && config.maxTokens > policy.maxTokens) {
		fail(ERRORS.CONFIG_POLICY, `maxTokens exceeds Team policy ${policy.maxTokens}`);
	}
	return true;
}

/**
 * Apply a patch. The caller is responsible for the actor check (Lead/Human);
 * this function only validates and versions. A no-op patch does not bump.
 */
export function applyMemberConfigPatch(current, patch, options = {}) {
	const before = normalizeMemberConfig(current);
	const merged = normalizeMemberConfig({ ...before, ...patch }, before);
	validateMemberConfigPolicy(merged, options.policy ?? {});
	const changed = CONFIG_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(merged[field]));
	if (!changed) return { config: { ...before, configVersion: options.configVersion ?? 0 }, before, changed: false };
	return {
		config: { ...merged, configVersion: (options.configVersion ?? 0) + 1 },
		before,
		changed: true,
	};
}

/** Only the fields DSH AgentOptions understands. */
export function buildAgentOptions(config) {
	const options = {};
	if (config.provider) options.provider = config.provider;
	if (config.model) options.model = config.model;
	if (typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '') options.reasoningEffort = config.reasoningEffort;
	if (Number.isSafeInteger(config.maxTokens)) options.maxTokens = config.maxTokens;
	return options;
}
