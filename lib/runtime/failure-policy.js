/**
 * LLM failure classification and the deterministic retry/fallback decision.
 *
 * The listener on `agent/request-error` owns the retry for transient
 * server/network failures and re-dispatches the same request immediately
 * (DSH's agent loop supports that via `{ kind: 'retry' }`). There are no
 * timers: a fallback patch only rewrites the member's persisted config, so it
 * takes effect on the next wake — the current turn ends (`fail`). Rate limits
 * also end the turn: hammering the same route at once burns the retry budget
 * without a backoff clock. Auth/billing/policy failures are fail-closed and
 * require a Human or the Project owner to change the environment.
 */

export const FAILURE_CATEGORY = Object.freeze({
	AUTH: 'auth',
	BILLING: 'billing',
	RATE_LIMIT: 'rate_limit',
	NETWORK: 'network',
	SERVER: 'server',
	MODEL_UNAVAILABLE: 'model_unavailable',
	CONTEXT_OVERFLOW: 'context_overflow',
	POLICY: 'policy',
	UNKNOWN: 'unknown',
});

const NETWORK_CODES = new Set([
	'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
]);

function statusOf(error) {
	const value = error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.details?.status;
	return Number.isSafeInteger(value) ? value : null;
}

function codeOf(error) {
	return String(error?.code ?? error?.details?.code ?? '').toUpperCase();
}

function textOf(error) {
	return String(error?.message ?? error?.details?.message ?? '').toLowerCase();
}

/** Map a provider/network error to one stable category + policy. */
export function classifyLlmFailure(error) {
	const status = statusOf(error);
	const code = codeOf(error);
	const text = textOf(error);
	const base = { status, code: code || null, message: error?.message ?? '' };

	if (status === 401 || status === 403 || code.includes('INVALID_API_KEY') || code.includes('UNAUTHORIZED')) {
		return { ...base, category: FAILURE_CATEGORY.AUTH, retryable: false, humanRequired: true, action: 'stop' };
	}
	if (
		status === 402 ||
		/insufficient|balance|quota|billing|payment|credit/.test(code) ||
		/insufficient|balance|quota|billing|payment|credit/.test(text)
	) {
		return { ...base, category: FAILURE_CATEGORY.BILLING, retryable: false, humanRequired: true, action: 'stop' };
	}
	if (status === 429 || code.includes('RATE_LIMIT') || /rate limit/.test(text)) {
		return { ...base, category: FAILURE_CATEGORY.RATE_LIMIT, retryable: true, humanRequired: false, action: 'retry_or_fallback' };
	}
	if (status !== null && status >= 500) {
		return { ...base, category: FAILURE_CATEGORY.SERVER, retryable: true, humanRequired: false, action: 'retry_or_fallback' };
	}
	if (NETWORK_CODES.has(code) || /network|timeout|timed out|socket|connection reset|dns/.test(text)) {
		return { ...base, category: FAILURE_CATEGORY.NETWORK, retryable: true, humanRequired: false, action: 'retry_or_fallback' };
	}
	if (status === 404 || /model.*(not found|unavailable)|unknown model/.test(text)) {
		return { ...base, category: FAILURE_CATEGORY.MODEL_UNAVAILABLE, retryable: false, humanRequired: false, action: 'fallback' };
	}
	if (/context.*(length|window|overflow)|too many tokens|maximum context/.test(text)) {
		return { ...base, category: FAILURE_CATEGORY.CONTEXT_OVERFLOW, retryable: false, humanRequired: false, action: 'compact_or_fallback' };
	}
	if (status === 400 && /content|policy|refus|safety/.test(text)) {
		return { ...base, category: FAILURE_CATEGORY.POLICY, retryable: false, humanRequired: true, action: 'stop' };
	}
	return { ...base, category: FAILURE_CATEGORY.UNKNOWN, retryable: false, humanRequired: true, action: 'stop' };
}

function fallbackAt(config, index) {
	const list = Array.isArray(config?.fallback) ? config.fallback : [];
	return list[index] ?? null;
}

/**
 * Decide what the request-error listener does next. `retry` re-dispatches the
 * same request immediately; `fallback` writes the config patch and ends the
 * turn (it can only take effect on the next wake, because a step's route is
 * captured before dispatch); `fail` ends the turn unchanged.
 */
export function retryDecision(failure, config = {}, attempt = 1) {
	const maxAttempts = Number.isSafeInteger(config.retry?.maxAttempts)
		? Math.max(1, Math.min(config.retry.maxAttempts, 5))
		: 3;
	if (!failure?.retryable) return { action: 'fail', attempt, reason: `${failure?.category ?? 'unknown'} is not retryable` };
	if (attempt >= maxAttempts) return { action: 'fail', attempt, reason: `retry budget exhausted (${maxAttempts})` };
	const nextFallbackIndex = attempt - 1;
	const fallback = fallbackAt(config, nextFallbackIndex);
	if (fallback !== null) {
		return {
			action: 'fallback',
			attempt,
			fallbackIndex: nextFallbackIndex,
			patch: {
				provider: fallback.provider ?? config.provider,
				model: fallback.model ?? config.model,
				...(fallback.reasoningEffort === undefined ? {} : { reasoningEffort: fallback.reasoningEffort }),
				...(fallback.maxTokens === undefined ? {} : { maxTokens: fallback.maxTokens }),
			},
			reason: `fallback to ${fallback.provider ?? config.provider}/${fallback.model ?? config.model}`,
		};
	}
	// No fallback route configured: a rate limit would hit again at once
	// without a backoff clock — end the turn and let the next event/startup
	// try fresh instead of burning the budget on a throttled route.
	if (failure.category === FAILURE_CATEGORY.RATE_LIMIT) {
		return { action: 'fail', attempt, reason: 'rate limited; left to the next wake' };
	}
	return { action: 'retry', attempt, reason: 'same route, immediate retry' };
}

export function describeFailure(failure) {
	return `${failure.category}${failure.status ? ` HTTP ${failure.status}` : ''}${failure.code ? ` ${failure.code}` : ''}`;
}
