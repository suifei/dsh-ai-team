/** Stable domain errors; HTTP/tool adapters map `code` to user-facing text. */
export class DomainError extends Error {
	/**
	 * @param {string} code - stable machine code, e.g. E_TASK_BLOCKED.
	 * @param {string} message - developer-readable message.
	 * @param {{ status?: number, details?: unknown }} [options]
	 */
	constructor(code, message, options = {}) {
		super(message);
		this.name = 'DomainError';
		this.code = code;
		this.status = options.status ?? 409;
		this.details = options.details;
	}
}

export const ERRORS = {
	NOT_FOUND: 'E_NOT_FOUND',
	INVALID_STATE: 'E_INVALID_STATE',
	UNAUTHORIZED: 'E_UNAUTHORIZED',
	CONFLICT: 'E_CONFLICT',
	REVISION: 'E_REVISION',
	ALREADY_CLAIMED: 'E_ALREADY_CLAIMED',
	BLOCKED: 'E_TASK_BLOCKED',
	NOT_READY: 'E_TASK_NOT_READY',
	NOT_ELIGIBLE: 'E_REVIEWER_NOT_ELIGIBLE',
	STALE_REPLY: 'E_STALE_REPLY',
	LIMIT: 'E_LIMIT',
	IRREVERSIBLE_CONFIRM: 'E_IRREVERSIBLE_CONFIRM_REQUIRED',
	INVALID_ARGUMENT: 'E_INVALID_ARGUMENT',
	CONFIG_POLICY: 'E_CONFIG_POLICY',
};

export function fail(code, message, options) {
	throw new DomainError(code, message, options);
}
