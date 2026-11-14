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

import { resolveTeamPreset } from '../host/permission-guard.js';
import { activationSpec } from './activation-spec.js';

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
		this.agents = options.agents;
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
			this.permissionPresets.set(session, resolveTeamPreset(this.permissionPresets));
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
			activation = await this.subagents.startActivation(activationSpec({
				provider: options.provider ?? this.provider,
				label: member.name,
				request: {
					cwd: member.workspace ?? this.cwd,
					...(member.preset ?? member.config?.preset ?? this.preset ? { agentPreset: member.preset ?? member.config?.preset ?? this.preset } : {}),
					prompt,
					parent: this.parent,
					...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
				},
				signal,
				delivery: 'parent',
			}));
		} catch (error) {
			fail('E_ACTIVATION', `member activation failed: ${error?.message ?? error}`, { memberId: member.id });
		}
		try {
			await this.ensurePermission(activation.childId);
			// The subagent setup appends the descriptor before the first prompt; flush
			// it so a later cold resume can reconstruct the continuable child.
			const session = this.agents?.get?.(activation.childId)?.session ?? this.sessions?.get?.(activation.childId);
			if (session !== undefined && session !== null && typeof this.sessions.flush === 'function') {
				await this.sessions.flush(session);
			}
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

	/**
	 * Wake an existing member. Delivery has exactly ONE path: `subagents.sendMessage`.
	 *
	 * The SubagentManager owns the continuable child: it steers a running child,
	 * starts a turn on an idle one and cold-resumes an offline one (official
	 * contract, reference/subsystems/subagent). The plugin must never resume the
	 * child itself: a resume handle held by the plugin is the write lease that made
	 * the manager's next cold resume fail with NOT_RESUMABLE ("already owned by an
	 * active write handle"), which the Host then "repaired" by aborting the running
	 * turn and reseating the member (Issue #1; .ptc/rounds/r01-evidence).
	 */
	async wake(member, options = {}) {
		if (member.sessionId === undefined || member.sessionId === null) {
			fail('E_SESSION_MISSING', `member ${member.id} has no session`);
		}
		if (typeof this.subagents?.sendMessage !== 'function' || this.parent === undefined) {
			fail('E_RUNTIME_UNAVAILABLE', 'no subagent runtime or parent Agent is available');
		}
		const content = Array.isArray(options.prompt) ? options.prompt : [{ type: 'text', text: options.prompt ?? '' }];
		// 在线会话：投递前复核 danger-full-access。离线会话的权限预设在会话日志里，
		// 由 manager 冷恢复；之后每次工具调用前还有权限守卫兜底。
		const live = this.sessions?.get?.(member.sessionId);
		const cold = live === undefined || live === null;
		if (!cold) await this.ensurePermission(member.sessionId);
		const messageId = await this.subagents.sendMessage(this.parent, member.sessionId, content, {
			signal: options.signal ?? new AbortController().signal,
		});
		const after = this.sessions?.get?.(member.sessionId);
		if (after !== undefined && after !== null && typeof this.sessions.flush === 'function') {
			await this.sessions.flush(after);
		}
		return { messageId, sessionId: member.sessionId, cold };
	}
}

export { TEAM_PRESET };
