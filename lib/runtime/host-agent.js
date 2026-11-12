/**
 * Resolve the parent Agent that owns member activations.
 *
 * Preference order:
 *   1. an existing live root Agent (the Human's current session);
 *   2. a lazily created Team Host Agent (the Human owner has no
 *      session, e.g. the workbench was opened without a chat).
 *
 * The Host Agent is a runtime root, not a product member: it owns no Task,
 * has no product decision power.
 *
 * IMPORTANT — the Host Agent must never be archived. Members are subagent
 * descendants of it, and `archived-session-gate` (dsh-api-session-controller)
 * rejects every `agent/pre-step` whose Session, or any Session above it in the
 * subagent lineage, is archived. The loop then ends the turn as
 * `{kind:'blocked'}` **without issuing a model request**, so archiving the host
 * silently disables the whole team (observed: 453 blocked turns, 0 completed).
 * Earlier revisions archived it to hide it from the session list; that is
 * repaired here by unarchiving on resolve.
 */
import { randomUUID } from 'node:crypto';
import { reportFail } from '../diaglog.js';

/** Windows 路径大小写不敏感，末尾分隔符也不该影响判定。 */
const samePath = (left, right) => {
	const norm = (value) => String(value).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
	return norm(left) === norm(right);
};

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
 *   sessions?: any,
 *   cwd: string,
 *   newSessionId?: () => string
 * }} options
 */
export async function ensureHostAgent(options) {
	const agents = options.agents;
	if (agents === undefined || typeof agents.create !== 'function') {
		throw new HostAgentError('E_RUNTIME_UNAVAILABLE', 'agents service is unavailable');
	}
	// Repair a Host Agent archived by an earlier revision: the archive gate
	// covers the host's whole subagent lineage, so every member turn would end
	// blocked before any model request. `unarchiveSession` resolves without
	// writing when the id is not archived, so no read-back is needed — and
	// gating on the undocumented `archivedSessionIds` accessor is what silently
	// skipped this repair before.
	const unarchiveHost = async (sessionId) => {
		const registry = options.workspaceRegistry;
		if (typeof registry?.unarchiveSession !== 'function') return;
		try {
			await registry.unarchiveSession(sessionId);
		} catch (error) {
			reportFail('host.unarchive.fail', { sessionId: sessionId ?? null }, '[ai-team] could not unarchive Team Host session: ' + (error?.message ?? error));
		}
	};
	// Persist the resolved route into the session log. Live AgentOptions die
	// with the process; without a recorded selection a restored session renders
	// prompts with an unresolvable {{model}} variable.
	const persistSelection = (sessionId, selection) => {
		try {
			const session = options.sessions?.get?.(sessionId);
			if (session === undefined || session === null || typeof session.append !== 'function') return;
			if (typeof selection?.provider !== 'string' || typeof selection?.model !== 'string') return;
			session.append('model/selection', { provider: selection.provider, model: selection.model });
		} catch (error) {
			reportFail('host.model.persist.fail', {}, '[ai-team] host model selection persist failed: ' + (error?.message ?? error));
		}
	};
	if (typeof options.resumeSessionId === 'string' && options.resumeSessionId !== '') {
		const live = typeof agents.get === 'function' ? agents.get(options.resumeSessionId) : undefined;
		if (live !== undefined) {
			await unarchiveHost(options.resumeSessionId);
			const selection = typeof options.agentDefaultModel?.currentSelection === 'function' ? options.agentDefaultModel.currentSelection() : null;
			persistSelection(options.resumeSessionId, selection);
			return { agent: live, created: false, resumed: true, sessionId: options.resumeSessionId, dispose: async () => {} };
		}
		try {
			const handle = await agents.resume({ resumeSessionId: options.resumeSessionId });
			await unarchiveHost(options.resumeSessionId);
			// 持久化的 host 会话保留着**创建时的 cwd**，而成员子会话会继承它。
			// 实机事故：2026-11-09 建的 host 记的是 `…/.dsh/ai-team/default`，于是
			// 30 个成员会话全在插件数据目录里干活，`workspace.attachSession` 每天被拒
			// 上百次。cwd 不一致时不能复用这条 host——释放它，落到下面的创建分支。
			const expectedCwd = typeof options.cwd === 'string' ? options.cwd.trim() : '';
			const actualCwd = handle?.agent?.session?.header?.cwd ?? options.sessions?.get?.(options.resumeSessionId)?.header?.cwd ?? null;
			if (expectedCwd !== '' && typeof actualCwd === 'string' && actualCwd !== ''
				&& samePath(actualCwd, expectedCwd) === false) {
				try { await handle.dispose?.(); } catch { /* already gone */ }
				reportFail(
					'host.resume.cwd-mismatch.fail',
					{ sessionId: options.resumeSessionId, expectedCwd, actualCwd },
					'[ai-team] Team Host session cwd does not match the project workspace; creating a fresh host',
				);
			} else {
				const selection = typeof options.agentDefaultModel?.currentSelection === 'function' ? options.agentDefaultModel.currentSelection() : null;
				persistSelection(options.resumeSessionId, selection);
				return {
					agent: handle.agent,
					created: false,
					resumed: true,
					sessionId: options.resumeSessionId,
					dispose: async () => { try { await handle.dispose?.(); } catch { /* already gone */ } },
				};
			}
		} catch (error) {
			// A persisted host must be resumed: creating another one would break the
			// existing members' direct-child adjacency.
			throw new HostAgentError('E_HOST_AGENT', `Team Host Agent resume failed: ${error?.message ?? error}`, {
				sessionId: options.resumeSessionId,
			});
		}
	}
	const roots = typeof agents.roots === 'function' ? agents.roots() : [];
	if (roots.length > 0) {
		// roots() 只保证注册顺序，不保证某个元素是「Human 的根会话」；优先挑一个
		// 真正没有父会话、且不是 subagent 出来的根，避免把成员自己的父链当成
		// Human 通道（那会让成员成为彼此的 parent）。
		const rootAgent = roots.find((candidate) => {
			const header = candidate?.session?.header;
			if (header === undefined) return true;
			return header.origin !== 'subagent' && header.parentSession === undefined;
		}) ?? roots[0];
		// 被选中的 Human 根会话若已归档，成员血缘会被 gate 永久拒绝——这条快路径
		// 也必须解归档，否则 boot 期的 sweep 由于没有 hostSessionId 看不到它。
		await unarchiveHost(rootAgent.id);
		return { agent: rootAgent, created: false, sessionId: rootAgent.id, dispose: async () => {} };
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
	persistSelection(sessionId, selection);
	const host = handle.agent;
	await unarchiveHost(sessionId);
	return {
		agent: host,
		created: true,
		sessionId,
		dispose: async () => {
			try { await handle.dispose?.(); } catch { /* teardown already started */ }
		},
	};
}
