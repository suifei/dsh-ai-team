/**
 * Resolve the parent Agent that owns member activations.
 *
 * Preference order:
 *   1. an existing live root Agent (the Human's current session);
 *   2. a lazily created, archived Team Host Agent (the Human owner has no
 *      session, e.g. the workbench was opened without a chat).
 *
 * The Host Agent is a runtime root, not a product member: it owns no Task,
 * has no product decision power, and is archived from the session list.
 */
import { randomUUID } from 'node:crypto';

export class HostAgentError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'HostAgentError';
		this.code = code;
		this.details = details;
	}
}

/**
 * @param {{
 *   agents: any,
 *   agentDefaultModel: any,
 *   workspaceRegistry?: any,
 *   cwd: string,
 *   newSessionId?: () => string
 * }} options
 */
export async function ensureHostAgent(options) {
	const agents = options.agents;
	if (agents === undefined || typeof agents.create !== 'function') {
		throw new HostAgentError('E_RUNTIME_UNAVAILABLE', 'agents service is unavailable');
	}
	const roots = typeof agents.roots === 'function' ? agents.roots() : [];
	if (roots.length > 0) {
		return { agent: roots[0], created: false, sessionId: roots[0].id, dispose: async () => {} };
	}

	const selection = typeof options.agentDefaultModel?.currentSelection === 'function'
		? options.agentDefaultModel.currentSelection()
		: null;
	if (selection === null || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
		throw new HostAgentError('E_RUNTIME_UNAVAILABLE', 'no default provider/model is configured for the Team Host Agent');
	}
	const sessionId = options.newSessionId?.() ?? `session-team-host-${randomUUID()}`;
	const agentOptions = { provider: selection.provider, model: selection.model };
	if (typeof selection.reasoningEffort === 'string') agentOptions.reasoningEffort = selection.reasoningEffort;
	let handle;
	try {
		handle = await agents.create({
			sessionId,
			meta: { cwd: options.cwd },
			agentOptions,
		});
	} catch (error) {
		throw new HostAgentError('E_HOST_AGENT', `Team Host Agent creation failed: ${error?.message ?? error}`, {
			cause: error?.code ?? null,
		});
	}
	const host = handle.agent;
	try {
		await options.workspaceRegistry?.archiveSession?.(sessionId);
	} catch (error) {
		// Hiding the host session is cosmetic; activation still works.
		console.warn('[ai-team] could not archive Team Host session:', error?.message ?? error);
	}
	return {
		agent: host,
		created: true,
		sessionId,
		dispose: async () => {
			try { await handle.dispose?.(); } catch { /* teardown already started */ }
		},
	};
}
