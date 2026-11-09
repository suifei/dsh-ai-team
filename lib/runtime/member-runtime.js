/**
 * Member runtime adapter (M2 foundation).
 *
 * The registry owns names and ledger events; this module owns the one thing
 * that can actually start an Agent: a direct child activation under the
 * Project's host Agent, followed by the danger-full-access permission check.
 *
 * It is dependency-injected so it can be tested without a live DSH process:
 *   subagents.startActivation / sendMessage
 *   sessions.get
 *   permissionPresets.resolve / set / catalog
 *   sandboxPolicy.overrideOf / defaultMode
 */

import { buildAgentOptions } from '../domain/member-config.js';

const TEAM_PRESET = 'danger-full-access';

export class MemberRuntimeError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = 'MemberRuntimeError';
		this.code = code;
		this.details = details;
	}
}

function fail(code, message, details) {
	throw new MemberRuntimeError(code, message, details);
}

/**
 * Validate the deployment before any Team feature is offered.
 * A profile without danger-full-access must not silently run Team mode.
 */
export function validatePermissionProfile({ permissionPresets, sandboxPolicy }) {
	if (permissionPresets === undefined || sandboxPolicy === undefined) {
		return { ok: false, code: 'E_PERMISSION_PROFILE', reason: 'permission services are unavailable' };
	}
	let catalog;
	try {
		catalog = permissionPresets.catalog();
	} catch (error) {
		return { ok: false, code: 'E_PERMISSION_PROFILE', reason: `catalog failed: ${error?.message ?? error}` };
	}
	const presetName = catalog?.defaultPreset;
	if (typeof presetName !== 'string' || presetName === '') {
		return { ok: false, code: 'E_PERMISSION_PROFILE', reason: 'no default permission preset' };
	}
	let spec;
	try {
		spec = permissionPresets.resolve(presetName);
	} catch (error) {
		return { ok: false, code: 'E_PERMISSION_PROFILE', reason: `preset ${presetName} cannot resolve` };
	}
	if (spec?.sandbox !== TEAM_PRESET || spec?.approval !== 'never') {
		return { ok: false, code: 'E_PERMISSION_PROFILE', reason: `default preset ${presetName} is not danger-full-access/never` };
	}
	if (sandboxPolicy.defaultMode !== TEAM_PRESET) {
		return { ok: false, code: 'E_PERMISSION_PROFILE', reason: `sandbox default is ${String(sandboxPolicy.defaultMode)}` };
	}
	return { ok: true, preset: presetName, spec };
}

export class MemberRuntime {
	/**
	 * @param {{
	 *   subagents: any,
	 *   sessions: any,
	 *   permissionPresets: any,
	 *   sandboxPolicy: any,
	 *   parent: any,
	 *   provider: string,
	 *   cwd: string,
	 *   preset?: string,
	 *   clock?: () => number
	 * }} options
	 */
	constructor(options) {
		this.subagents = options.subagents;
		this.sessions = options.sessions;
		this.permissionPresets = options.permissionPresets;
		this.sandboxPolicy = options.sandboxPolicy;
		this.parent = options.parent;
		this.provider = options.provider;
		this.cwd = options.cwd;
		this.preset = options.preset ?? null;
		this.clock = options.clock ?? (() => Date.now());
	}

	/** Re-apply and verify danger-full-access on one live member session. */
	async ensurePermission(sessionId) {
		const session = this.sessions?.get?.(sessionId);
		if (session === undefined || session === null) {
			fail('E_SESSION_MISSING', `member session ${String(sessionId)} is not live`);
		}
		if (this.sandboxPolicy.overrideOf(session) !== TEAM_PRESET) {
			this.permissionPresets.set(session, TEAM_PRESET);
		}
		if (this.sandboxPolicy.overrideOf(session) !== TEAM_PRESET) {
			fail('E_PERMISSION', `member session ${String(sessionId)} is not ${TEAM_PRESET}`, { sessionId });
		}
		return session;
	}

	/** Start a new continuable child Agent and bind it to a member. */
	async activate(member, options = {}) {
		if (this.subagents === undefined || this.parent === undefined || typeof this.provider !== 'string') {
			fail('E_RUNTIME_UNAVAILABLE', 'no subagent provider or parent Agent is available');
		}
		const prompt = Array.isArray(options.prompt) ? options.prompt : [{ type: 'text', text: options.prompt ?? '' }];
		const signal = options.signal ?? new AbortController().signal;
		const agentOptions = buildAgentOptions(member.config ?? {});
		let activation;
		try {
			activation = await this.subagents.startActivation({
				provider: options.provider ?? this.provider,
				label: member.name,
				request: {
					cwd: member.workspace ?? this.cwd,
					...(member.preset ?? this.preset ? { agentPreset: member.preset ?? this.preset } : {}),
					prompt,
					parent: this.parent,
					...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
				},
				signal,
				delivery: 'parent',
			});
		} catch (error) {
			fail('E_ACTIVATION', `member activation failed: ${error?.message ?? error}`, { memberId: member.id });
		}
		try {
			await this.ensurePermission(activation.childId);
		} catch (error) {
			try { await activation.dispose?.(); } catch { /* already gone */ }
			throw error;
		}
		return {
			childId: activation.childId,
			messageId: activation.messageId ?? null,
			activation,
			member: { ...member, sessionId: activation.childId, status: 'running', activatedAt: this.clock() },
		};
	}

	/** Wake an existing member; cold resume is the subagents service's job. */
	async wake(member, options = {}) {
		if (member.sessionId === undefined || member.sessionId === null) {
			fail('E_SESSION_MISSING', `member ${member.id} has no session`);
		}
		const content = Array.isArray(options.prompt) ? options.prompt : [{ type: 'text', text: options.prompt ?? '' }];
		const session = this.sessions?.get?.(member.sessionId);
		// An idle child may be cold: sendMessage restores it from persistence.
		// Its danger-full-access preset is already in the session log; there is no
		// live Session object to inspect before delivery, so the pre-check is
		// skipped for this one path (V-10 remains open for the resumed timing).
		if (session === undefined || session === null) {
			const messageId = await this.subagents.sendMessage(this.parent, member.sessionId, content, {
				signal: options.signal ?? new AbortController().signal,
			});
			return { messageId, sessionId: member.sessionId, cold: true };
		}
		await this.ensurePermission(member.sessionId);
		const messageId = await this.subagents.sendMessage(this.parent, member.sessionId, content, {
			signal: options.signal ?? new AbortController().signal,
		});
		return { messageId, sessionId: member.sessionId, cold: false };
	}
}

export { TEAM_PRESET };
