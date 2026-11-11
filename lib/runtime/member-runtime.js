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

import { randomUUID } from 'node:crypto';
import { buildAgentOptions } from '../domain/member-config.js';

const TEAM_PRESET = 'danger-full-access';

function userMessage(text) {
	return {
		id: randomUUID(),
		role: 'user',
		content: [{ type: 'text', text }],
		source: { kind: 'user' },
	};
}

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
		this.agentPresets = options.agentPresets ?? null;
		this.direct = options.direct === true;
		// Cold resumes produce AgentHandles the caller does not store; the owner
		// tracks them here so teardown can dispose every member activation.
		this.trackHandle = typeof options.trackHandle === 'function' ? options.trackHandle : null;
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
		if (this.direct) return await this.activateDirect(member, options);
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
					...(member.preset ?? member.config?.preset ?? this.preset ? { agentPreset: member.preset ?? member.config?.preset ?? this.preset } : {}),
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
	 * Direct child mode: create the Agent through agents.create and start the
	 * turn with agent.followup. This avoids the subagent manager's disposable
	 * activation when its cold-resume edge is not usable for a long-lived member.
	 */
	async activateDirect(member, options = {}) {
		if (this.agents?.create === undefined || this.parent === undefined) {
			fail('E_RUNTIME_UNAVAILABLE', 'agent creation or parent Agent is unavailable');
		}
		const sessionId = randomUUID();
		const preset = member.preset ?? member.config?.preset ?? this.preset;
		let handle;
		try {
			handle = await this.agents.create({
				sessionId,
				parentAgent: this.parent,
				meta: {
					cwd: member.workspace ?? this.cwd,
					parentSession: this.parent.id,
					delegationDepth: 1,
					...(preset ? { agentPreset: preset } : {}),
				},
				agentOptions: buildAgentOptions(member.config ?? {}),
				...(preset && this.agentPresets?.mount ? {
					setup: async (agentCtx) => { await this.agentPresets.mount(agentCtx, preset); },
				} : {}),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			});
		} catch (error) {
			fail('E_ACTIVATION', `member activation failed: ${error?.message ?? error}`, { memberId: member.id });
		}
		const session = handle.agent.session;
		try {
			if (this.sandboxPolicy.overrideOf(session) !== TEAM_PRESET) this.permissionPresets.set(session, TEAM_PRESET);
			if (this.sandboxPolicy.overrideOf(session) !== TEAM_PRESET) {
				fail('E_PERMISSION', `member session ${sessionId} is not ${TEAM_PRESET}`, { sessionId });
			}
			const message = userMessage(typeof options.prompt === 'string' ? options.prompt : '开始工作');
			handle.agent.followup(message);
			if (typeof this.sessions?.flush === 'function') await this.sessions.flush(session);
			return {
				childId: sessionId,
				messageId: message.id,
				activation: { dispose: async () => { await handle.dispose?.(); } },
				member: { ...member, sessionId, status: 'running', activatedAt: this.clock() },
				debug: {
					agentStatus: handle.agent.status ?? null,
					sessionSeq: handle.agent.session?.seq ?? null,
					inboxNextTurn: handle.agent.inbox?.nextTurn?.length ?? null,
					inboxNextStep: handle.agent.inbox?.nextStep?.length ?? null,
				},
			};
		} catch (error) {
			try { await handle.dispose?.(); } catch { /* rollback */ }
			throw error;
		}
	}

	/** Wake an existing member; cold resume is the subagents service's job. */
	async wake(member, options = {}) {
		if (member.sessionId === undefined || member.sessionId === null) {
			fail('E_SESSION_MISSING', `member ${member.id} has no session`);
		}
		const content = Array.isArray(options.prompt) ? options.prompt : [{ type: 'text', text: options.prompt ?? '' }];
		if (this.direct) {
			let agent = this.agents?.get?.(member.sessionId);
			if (agent === undefined || agent === null) {
				try {
					const preset = member.preset ?? member.config?.preset ?? this.preset;
					const handle = await this.agents.resume({
						resumeSessionId: member.sessionId,
						parentAgent: this.parent,
						...(preset && this.agentPresets?.mount ? {
							setup: async (agentCtx) => { await this.agentPresets.mount(agentCtx, preset); },
						} : {}),
					});
					this.trackHandle?.(member.sessionId, handle);
					agent = handle.agent;
				} catch (error) {
					fail('E_SESSION_MISSING', `member ${member.id} cannot be resumed: ${error?.message ?? error}`);
				}
			}
			await this.ensurePermission(member.sessionId);
			const message = userMessage(typeof options.prompt === 'string' ? options.prompt : '继续');
			agent.followup(message);
			const live = this.sessions?.get?.(member.sessionId);
			if (live !== undefined && live !== null && typeof this.sessions.flush === 'function') await this.sessions.flush(live);
			return { messageId: message.id, sessionId: member.sessionId, direct: true };
		}
		let session = this.sessions?.get?.(member.sessionId);
		// 冷会话：只走**一条**恢复路径。先 agents.resume 再 sendMessage 会让
		// subagent manager 再做一次冷恢复并以 NOT_RESUMABLE 失败（它的 continuable
		// 句柄已被前一次 resume 消耗），进而触发上层强制重建、丢成员历史。
		if (session === undefined || session === null) {
			if (this.agents?.resume !== undefined) {
				let handle = null;
				try {
					handle = await this.agents.resume({ resumeSessionId: member.sessionId, parentAgent: this.parent });
				} catch { handle = null; }
				if (handle?.agent !== undefined && handle?.agent !== null && typeof handle.agent.followup === 'function') {
					this.trackHandle?.(member.sessionId, handle);
					await this.ensurePermission(member.sessionId);
					const message = userMessage(typeof options.prompt === 'string' ? options.prompt : '继续');
					handle.agent.followup(message);
					const live = this.sessions?.get?.(member.sessionId);
					if (live !== undefined && live !== null && typeof this.sessions.flush === 'function') await this.sessions.flush(live);
					return { messageId: message.id, sessionId: member.sessionId, cold: true, resumed: true };
				}
			}
			// resume 不可用：只剩 subagent manager 的冷投递（其权限预设已在会话日志里）。
			const messageId = await this.subagents.sendMessage(this.parent, member.sessionId, content, {
				signal: options.signal ?? new AbortController().signal,
			});
			return { messageId, sessionId: member.sessionId, cold: true };
		}
		await this.ensurePermission(member.sessionId);
		const messageId = await this.subagents.sendMessage(this.parent, member.sessionId, content, {
			signal: options.signal ?? new AbortController().signal,
		});
		const live = this.sessions?.get?.(member.sessionId);
		if (live !== undefined && live !== null && typeof this.sessions.flush === 'function') {
			await this.sessions.flush(live);
		}
		return { messageId, sessionId: member.sessionId, cold: false };
	}
}

export { TEAM_PRESET };
