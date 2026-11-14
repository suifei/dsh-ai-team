/**
 * Resolve one project's PMO session: the parent Agent of that project's members.
 *
 * Core model: one PMO per project, resident in the project's workspace; every
 * member is its subagent child, so member sessions live in the same workspace.
 * The PMO session is owned by the plugin — it never borrows the Human's own
 * chat session (doing so parented members under whatever conversation the
 * Human had open, in whatever workspace, and delivered their results into it).
 *
 * Order: the project's persisted PMO session (live or cold-resumed) when its
 * cwd is the project workspace; otherwise a fresh one created in that cwd.
 *
 * IMPORTANT — the PMO session must never be archived. Members are subagent
 * descendants of it, and `archived-session-gate` (dsh-api-session-controller)
 * rejects every `agent/pre-step` whose Session, or any Session above it in the
 * subagent lineage, is archived. The loop then ends the turn as
 * `{kind:'blocked'}` **without issuing a model request**, so archiving it
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
			// 推理等级一并记下，否则恢复出来的会话按模型默认档走。
			const effort = typeof selection.reasoningEffort === 'string' && selection.reasoningEffort !== ''
				? selection.reasoningEffort
				: null;
			session.append('model/selection', {
				provider: selection.provider,
				model: selection.model,
				...(effort === null ? {} : { reasoningEffort: effort }),
			});
		} catch (error) {
			reportFail('host.model.persist.fail', {}, '[ai-team] host model selection persist failed: ' + (error?.message ?? error));
		}
	};
	if (typeof options.resumeSessionId === 'string' && options.resumeSessionId !== '') {
		const live = typeof agents.get === 'function' ? agents.get(options.resumeSessionId) : undefined;
		let agent = live;
		let release = async () => {};
		if (agent === undefined) {
			try {
				const handle = await agents.resume({ resumeSessionId: options.resumeSessionId });
				agent = handle?.agent;
				release = async () => { try { await handle?.dispose?.(); } catch { /* already gone */ } };
			} catch (error) {
				// A persisted PMO session must be resumed: creating another one would
				// break the existing members' direct-child adjacency.
				throw new HostAgentError('E_HOST_AGENT', `Team Host Agent resume failed: ${error?.message ?? error}`, {
					sessionId: options.resumeSessionId,
				});
			}
		}
		// 会话的 cwd 创建后不可变，成员子会话继承它。cwd 不是本项目工作区时不能复用
		// （实机：host 记着插件数据目录，30 个成员全在数据目录里干活、attach 每天被拒上百次；
		// 多项目共用一条 host 时，B 项目成员会落进 A 的工作区）。在线与冷恢复同一判定。
		const expectedCwd = typeof options.cwd === 'string' ? options.cwd.trim() : '';
		const actualCwd = agent?.session?.header?.cwd ?? options.sessions?.get?.(options.resumeSessionId)?.header?.cwd ?? null;
		if (expectedCwd !== '' && typeof actualCwd === 'string' && actualCwd !== '' && samePath(actualCwd, expectedCwd) === false) {
			if (live === undefined) await release();
			reportFail(
				'host.resume.cwd-mismatch.fail',
				{ sessionId: options.resumeSessionId, expectedCwd, actualCwd, live: live !== undefined },
				'[ai-team] PMO session cwd does not match the project workspace; creating a fresh one',
			);
		} else {
			await unarchiveHost(options.resumeSessionId);
			const selection = typeof options.agentDefaultModel?.currentSelection === 'function' ? options.agentDefaultModel.currentSelection() : null;
			persistSelection(options.resumeSessionId, selection);
			return { agent, created: false, resumed: true, sessionId: options.resumeSessionId, dispose: release };
		}
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
