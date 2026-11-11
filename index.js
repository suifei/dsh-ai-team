/**
 * dsh-ai-team — Host half.
 *
 * M1: one default Project backed by the plugin-owned append-only ledger.
 * The workbench reads `GET /ai-team/api/bootstrap`; writes go through
 * `POST /ai-team/api/projects/:id/commands` (Human actor for now).
 *
 * The member runtime (real Agent sessions) lands in M2. Until then the
 * ledger/domain service is the only writer and the Host never fakes work.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';
import { ProjectRuntime } from './lib/host/project-runtime.js';
import { ProjectRegistry } from './lib/host/project-registry.js';
import { ids } from './lib/domain/ids.js';
import { MemberRuntime, validatePermissionProfile } from './lib/runtime/member-runtime.js';
import { ensureHostAgent } from './lib/runtime/host-agent.js';
import { classifyLlmFailure, retryDecision } from './lib/runtime/failure-policy.js';
import { memberIdentity } from './lib/domain/member-profile.js';
import { loadSkillContext } from './lib/runtime/skill-loader.js';
import { formatSkillCatalog } from './lib/runtime/skill-catalog.js';
import { isSkillExcluded } from './lib/runtime/skill-policy.js';
import { installFileSkillProvider } from './lib/runtime/skill-provider.js';
import { apply as applySkillOpt } from './lib/vendor/skillopt/src/index.js';
import { createMemberPermissionGuard } from './lib/host/permission-guard.js';
import { installFaultAdapter } from './lib/host/fault-adapter.js';
import { buildModelCatalog } from './lib/host/model-catalog.js';
import { createTeamTool } from './lib/host/member-tools.js';
import { describeWake, planWakes } from './lib/host/waker.js';
import { aggregatePeople } from './lib/host/people-view.js';
import { riskView } from './lib/host/risk-view.js';
import { weeklyView } from './lib/host/weekly-view.js';
import { isInformationalThreadMention } from './lib/domain/inbox.js';
import { createDiagLogger, defaultDiagDir } from './lib/diaglog.js';

export const name = 'ai-team';

/** The workbench only makes sense where the Web carrier exists. */
export const inject = ['webServer', 'permissionPresets', 'sandboxPolicy'];

const VERSION = '0.3.71';
const PROJECT_ID = 'prj_main';
const HUMAN_ID = 'mem_human';

const SKILLOPT_BACKENDS = ['mock', 'claude', 'codex', 'copilot', 'cursor', 'pi', 'opencode', 'handoff', 'azure_openai'];

/**
 * Tunable values live in the plugin Config so users edit their patch layer
 * (the user's patch survives upgrades). Integer fields use `.step(1)`: the
 * bundled schemastery zod face has no `.int()`.
 */
export const Config = z.object({
	// diaglog level: 'off' silent, 'errors' crash/fail rows only, 'full' all rows
	diagLevel: z.union(['off', 'errors', 'full']).default('errors'),
	// directory of the diagnostic JSONL log (one file per day)
	diagLogDir: z.string().default(defaultDiagDir()),
	// rotation cap for one diagnostic log file
	diagLogMaxBytes: z.number().step(1).min(65536).max(16777216).default(1048576),
	// default SkillOpt backend for skillopt_* tools; 'mock' is the safe shipped
	// default (no model calls, no live-file writes) — a real backend must be
	// configured here or passed per call.
	skilloptBackend: z.union(SKILLOPT_BACKENDS).default('mock'),
	// per-call timeout for skillopt_* engine runs
	skilloptTimeoutMs: z.number().step(1).min(10_000).max(600_000).default(120_000),
});

function send(res, body, status = 200) {
	if (res.writableEnded) return;
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(JSON.stringify(body));
}

async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 1_000_000) throw Object.assign(new Error('body too large'), { code: 'E_INVALID_ARGUMENT', status: 413 });
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function profileName() {
	// The web launcher does not export DSH_PROFILE; the selected profile is in
	// the process args. Prefer it over the ambient shell env so two profiles
	// never share a ledger namespace.
	const index = process.argv.indexOf('--profile');
	if (index >= 0 && typeof process.argv[index + 1] === 'string') return process.argv[index + 1];
	return process.env.DSH_PROFILE || 'default';
}

/**
 * Open the default Project ledger and seed the Human + Project skeleton once.
 * A torn tail is repaired by the writer; the repair is recorded as a system
 * event so the append-only history explains the gap.
 */
async function boot(diag) {
	const dataDir = join(dshHome(), 'ai-team', profileName());
	const registry = ProjectRegistry.load(dataDir);
	const runtimes = new Map();
	for (const project of registry.list()) {
		const runtime = await ProjectRuntime.open({
			rootDir: dataDir,
			projectId: project.id,
			projectName: project.name,
			projectGoal: project.goal,
			workspacePath: project.workspacePath ?? '',
			diag,
		});
		runtimes.set(project.id, runtime);
	}
	const activeProjectId = registry.activeProjectId;
	const runtime = runtimes.get(activeProjectId) ?? runtimes.values().next().value;
	diag?.append({
		ev: 'boot.done',
		dataDir,
		projects: [...runtimes.keys()],
		activeProjectId,
		events: [...runtimes.values()].reduce((sum, item) => sum + item.ledger.headSeq, 0),
	});
	return {
		...runtime,
		runtime,
		runtimes,
		registry,
		activeProjectId,
		ledger: runtime.ledger,
		service: runtime.service,
		dataDir,
	};
}

export function apply(ctx, config = {}) {
	// Diagnostic log first: every later row (boot, wake, PMO, dispatch) lands
	// here with the configured level ('off'/'errors'/'full', errors shipped).
	// The `??` chain keeps direct apply() calls (tests) on shipped defaults.
	const diag = createDiagLogger({
		dir: config.diagLogDir ?? defaultDiagDir(),
		maxBytes: config.diagLogMaxBytes ?? 1048576,
		level: config.diagLevel ?? 'errors',
	});
	// HTTP 层失败/拒绝的统一落点（route.reject 在 errors 白名单内）。
	const errorResponse = (res, error) => {
		diag.append({
			ev: 'route.reject',
			code: typeof error?.code === 'string' ? error.code : 'INTERNAL',
			message: error?.message ?? String(error ?? 'command failed'),
		});
		const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
		const status = typeof error?.status === 'number' ? error.status : (code === 'E_STORAGE' ? 503 : 409);
		send(res, { error: { code, message: error?.message ?? 'command failed', details: error?.details ?? null } }, status);
	};
	ctx.effect(() => {
		const webServer = ctx.get('webServer');
		if (webServer === undefined) return () => {};

		let booted = null;
		let bootError = null;
		const projectRuntime = (projectId) => booted?.runtimes?.get(projectId) ?? null;
		const runtimeForAgent = (sessionId) => {
			if (sessionId === undefined || sessionId === null) return null;
			for (const runtime of booted?.runtimes?.values() ?? []) {
				const member = Object.values(runtime.service.state.members ?? {})
					.find((entry) => entry.sessionId === sessionId);
				if (member !== undefined) return runtime;
			}
			return null;
		};
		const workspaceForProject = async (projectRuntime) => {
			const registry = ctx.get('workspaceRegistry');
			const path = projectRuntime?.service?.state?.projects?.[projectRuntime.id]?.workspacePath;
			if (registry === undefined || typeof path !== 'string' || path === '') return null;
			try {
				const existing = await registry.resolveByPath?.(path);
				if (existing !== undefined && existing !== null) return existing;
				const created = await registry.create?.(path, projectRuntime.service.state.projects[projectRuntime.id]?.name ?? '文渊阁');
				return created ?? null;
			} catch (error) {
				diag.append({ ev: 'workspace.fail', projectId: projectRuntime.id, path, message: error?.message ?? String(error) });
				console.warn('[ai-team] workspace unavailable:', error?.message ?? error);
				return null;
			}
		};
		// 会话标题带项目前缀：多项目同名成员在 DSH 侧栏无法区分（用户实证）。
		const memberSessionTitle = (member, projectName) => `${projectName ? '【' + projectName + '】' : ''}${member?.name ?? 'Agent'}（${member?.role ?? 'Agent'}）`.trim().slice(0, 120);
		const projectNameOf = (projectRuntime) => projectRuntime?.service?.state?.projects?.[projectRuntime?.id]?.name ?? '';
		const titleMemberSession = async (projectRuntime, member) => {
			if (member === undefined) return;
			const sessions = ctx.get('sessions');
			const titleService = ctx.get('sessionTitle');
			const session = sessions?.get?.(member.sessionId);
			if (session === undefined || session === null || typeof titleService?.rename !== 'function') return;
			const title = memberSessionTitle(member, projectNameOf(projectRuntime));
			try {
				if (typeof titleService.get === 'function' && titleService.get(session)?.title === title) return;
				titleService.rename(session, title);
				diag.append({ ev: 'session.title', sessionId: member.sessionId, title, projectId: projectRuntime.id });
			} catch (error) {
				diag.append({ ev: 'session.title.fail', sessionId: member.sessionId, message: error?.message ?? String(error) });
				console.warn('[ai-team] session title failed:', error?.message ?? error);
			}
		};
		const attachMemberWorkspace = async (projectRuntime, sessionId) => {
			if (typeof sessionId !== 'string' || sessionId === '') return;
			const workspace = await workspaceForProject(projectRuntime);
			if (workspace === null || workspace === undefined || typeof workspace.attachSession !== 'function') return;
			try {
				await workspace.attachSession(sessionId);
			} catch (error) {
				diag.append({ ev: 'workspace.attach.fail', sessionId, message: error?.message ?? String(error) });
				console.warn('[ai-team] member session workspace attach failed:', error?.message ?? error);
			}
		};
		// A restored member session has no live AgentOptions; without a recorded
		// model/selection event its prompt renders with an unresolvable {{model}}.
		const modelSelectionLogged = new Map();
		const persistModelSelection = (sessionId, selection, label) => {
			if (typeof sessionId !== 'string' || sessionId === '') return;
			if (typeof selection?.provider !== 'string' || selection.provider === ''
				|| typeof selection?.model !== 'string' || selection.model === '') return;
			const route = `${selection.provider}/${selection.model}`;
			if (modelSelectionLogged.get(sessionId) === route) return;
			try {
				const session = ctx.get('sessions')?.get?.(sessionId);
				if (session === undefined || session === null || typeof session.append !== 'function') return;
				session.append('model/selection', { provider: selection.provider, model: selection.model });
				modelSelectionLogged.set(sessionId, route);
				diag.append({ ev: 'model.selection', sessionId, route, label: label ?? null });
			} catch (error) {
				diag.append({ ev: 'model.selection.fail', sessionId, label: label ?? null, message: error?.message ?? String(error) });
				console.warn('[ai-team] model selection persist failed:', label ?? sessionId, error?.message ?? error);
			}
		};
		const access = validatePermissionProfile({
			permissionPresets: ctx.get('permissionPresets'),
			sandboxPolicy: ctx.get('sandboxPolicy'),
		});
		const ready = access.ok
			? Promise.resolve().then(() => boot(diag))
				.then(async (value) => {
					booted = value;
					for (const runtime of value.runtimes.values()) {
						for (const member of Object.values(runtime.service.state.members ?? {})) {
							if (member.kind === 'agent' && typeof member.sessionId === 'string') {
								await attachMemberWorkspace(runtime, member.sessionId);
								await titleMemberSession(runtime, member);
								persistModelSelection(member.sessionId, member.config, member.name);
							}
						}
						// Attach the broadcast/wake hook before the first tick: events
						// produced by the tick must reach SSE clients immediately.
						attachRuntime(runtime);
						void pmoTick(runtime).catch((error) => {
							diag.append({ ev: 'pmo.tick.fail', projectId: runtime.id, message: error?.message ?? String(error) });
							console.warn('[ai-team] PMO tick failed:', error?.message ?? error);
						});
					}
					if (pmoTimer === null) {
						pmoTimer = setInterval(() => {
							for (const runtime of booted?.runtimes?.values() ?? []) {
								void pmoTick(runtime).catch((error) => {
									diag.append({ ev: 'pmo.tick.fail', projectId: runtime.id, message: error?.message ?? String(error) });
									console.warn('[ai-team] PMO tick failed:', error?.message ?? error);
								});
							}
						}, 60_000);
						pmoTimer.unref?.();
					}
					return value;
				})
				.catch((error) => {
					bootError = error;
					diag.append({ ev: 'boot.fail', message: error?.message ?? String(error) });
					console.error('[ai-team] ledger boot failed:', error?.message ?? error);
					return null;
				})
			: Promise.resolve(null);
		if (!access.ok) {
			bootError = Object.assign(new Error(access.reason), { code: access.code, status: 503 });
			diag.append({ ev: 'boot.refused', code: access.code, reason: access.reason });
			console.error('[ai-team] refused to start:', access.code, access.reason);
		}

		const sseClients = new Set();
		const activations = new Map();
		// DSH exposes a model-request failure waterfall. We classify the failure,
		// record it, and own the immediate retry only for transient server/network
		// failures ({ kind: 'retry' } re-dispatches the same request). A fallback
		// patch rewrites the persisted config, which a live step cannot pick up —
		// so the turn ends there and the next wake runs on the new route. Rate
		// limits end the turn too: no backoff clock means an immediate retry just
		// burns the budget against a throttled route.
		const offRequestError = typeof ctx.on === 'function'
			? ctx.on('agent/request-error', async (payload, next) => {
				if (booted === null) return next();
				const failureRuntime = runtimeForAgent(payload?.agent?.id);
				const member = failureRuntime === null ? undefined : Object.values(failureRuntime.service.state.members ?? {})
					.find((candidate) => candidate.sessionId === payload?.agent?.id);
				if (member === undefined || failureRuntime === null) return next();
				const failure = classifyLlmFailure(payload.failure);
				let recorded;
				try {
					recorded = await failureRuntime.service.recordMemberFailure(member.id, {
						...failure,
						provider: payload.provider ?? null,
						model: member.config?.model ?? null,
					}, failureRuntime.id);
				} catch (error) {
					console.warn('[ai-team] member failure record failed:', member.id, error?.message ?? error);
					return next();
				}
				if (!failure.retryable) return next();
				const decision = retryDecision(failure, member.config ?? {}, recorded.member.attempts ?? 1);
				if (decision.action === 'fallback' && decision.patch !== undefined) {
					try {
						await failureRuntime.service.applySystemFallback(member.id, decision.patch, 'llm-fallback', failureRuntime.id);
					} catch (error) {
						console.warn('[ai-team] member fallback failed:', member.id, error?.message ?? error);
					}
				}
				if (decision.action !== 'retry') return next();
				return { kind: 'retry' };
			})
			: () => {};
		const offSessionEvent = typeof ctx.on === 'function'
			? ctx.on('session/event', async (session, event) => {
				if (booted === null || event?.type !== 'turn/end') return;
				const eventRuntime = runtimeForAgent(session?.id);
				const member = eventRuntime === null ? undefined : Object.values(eventRuntime.service.state.members ?? {})
					.find((candidate) => candidate.sessionId === session?.id);
				if (member === undefined || eventRuntime === null) return;
				// The child Agent owns a persisted session, but its live events are
				// buffered by the JSONL writer until a session/flush checkpoint. Flush
				// every member turn boundary so restart/memory can replay the history.
				const sessions = ctx.get('sessions');
				try {
					await sessions?.flush?.(session);
				} catch (error) {
					diag.append({ ev: 'session.flush.fail', sessionId: session?.id ?? null, message: error?.message ?? String(error) });
					console.warn('[ai-team] member session flush failed:', error?.message ?? error);
				}
				if (event?.data?.reason?.kind !== 'completed') return;
				if (member.lastFailure === undefined || member.lastFailure === null) return;
				try {
					await eventRuntime.service.recordMemberRecovery(member.id, member.attempts ?? 0, member.config ?? null, eventRuntime.id);
					broadcast(undefined, eventRuntime);
				} catch (error) {
					console.warn('[ai-team] member recovery record failed:', member.id, error?.message ?? error);
				}
			})
			: () => {};
		let llmFaultMode = null;
		const offLlmFault = process.env.DSH_AI_TEAM_TEST === '1'
			? installFaultAdapter(ctx.get('llm'), () => llmFaultMode)
			: () => {};
		let host = null;
		let hostPromise = null;
		const wakeKeys = new Map();
		const activationTasks = new Map();
		const pmoLastKick = new Map();
		const pmoLastStall = new Map();
		const pmoLastHeartbeat = new Map();
		const pmoLastDispatch = new Map();
		const pmoLastEscalate = new Map();
		const pmoLastReview = new Map();
		// Members resumed from cold sessions produce AgentHandles nobody stored;
		// track them by session id so teardown — and session reseat — can
		// dispose exactly the handle they own.
		const resumedHandles = new Map();
		let pmoTimer = null;
		// 项目工作目录（显式，无兜底）：null 表示尚未设置。历史版本在此处用
		// runtime.dir（账本目录）兜底，曾把成员会话 cwd 钉进插件数据目录。
		const projectWorkspace = (projectRuntime, member) => member?.workspace
			|| projectRuntime?.service?.state?.projects?.[projectRuntime.id]?.workspacePath
			|| null;
		const wakeFromResult = async (projectRuntime, result, actor = {}) => {
			if (projectRuntime === null || projectRuntime === undefined) return;
			// P6 停止门（事件 hook 侧）：stopped 项目停止**自动派发**；Human
			// 主动触发的唤醒（如私信 member.message）仍放行——停止的是机器
			// 驱动，不断 Human 通道。
			const gateProject = projectRuntime.service.state.projects?.[projectRuntime.id];
			if (gateProject !== undefined && gateProject.runState === 'stopped' && actor?.kind !== 'human') return;
			const plans = planWakes(projectRuntime.service.state, result, actor);
			if (plans.length === 0) return;
			// Window eviction: a key older than this horizon can no longer dedupe
			// a relevant event, so drop it instead of growing the Map forever.
			const head = projectRuntime?.ledger?.head?.seq ?? 0;
			for (const [key, seq] of wakeKeys) {
				if (Number.isSafeInteger(seq) && head - seq > 500) wakeKeys.delete(key);
			}
			const subagents = ctx.get('subagents');
			const sessions = ctx.get('sessions');
			const permissionPresets = ctx.get('permissionPresets');
			const sandboxPolicy = ctx.get('sandboxPolicy');
			if (subagents === undefined || sessions === undefined || permissionPresets === undefined || sandboxPolicy === undefined) return;
			const providers = typeof subagents.list === 'function' ? subagents.list() : [];
			if (providers.length === 0) return;
			const parentInfo = await ensureParent();
			// A live member already carries the activation context (identity,
			// personality, skills). A wake is only the Task delta; re-sending the
			// whole activation prompt caused the duplicated blocks users saw.
			const wakePrompt = async (plan) => describeWake(plan, projectRuntime.service.state);
			for (const plan of plans) {
				if (wakeKeys.has(plan.key)) continue;
				let member = projectRuntime.service.state.members?.[plan.memberId];
				if (member === undefined) continue;
				// Reserve before the async delivery: the HTTP result and the ledger
				// event both schedule the same plan, and only one may deliver it.
				wakeKeys.set(plan.key, result?.event?.seq ?? head);
				// 无工作目录的项目不 wake（与 activate 的 fail-closed 同一不变量）：
				// 冷恢复/直连唤醒都会在会话原 cwd 里干活，不该落到插件数据目录。
				const projectWorkspacePath = projectWorkspace(projectRuntime, member);
				if (projectWorkspacePath === null || projectWorkspacePath.trim?.() === '') {
					diag?.append({ ev: 'wake.skip', projectId: projectRuntime.id, memberId: plan.memberId, reason: 'E_WORKSPACE_REQUIRED' });
					continue;
				}
				const cwd = projectWorkspacePath;
				try {
					// Idle default members have no Agent session yet. A wake must
					// activate them first; otherwise the first Human message is
					// silently dropped in a fresh Project.
					let messageId = null;
					if (member.sessionId === undefined || member.sessionId === null) {
						const activationKey = `${projectRuntime.id}:${member.id}`;
						let activation = activationTasks.get(activationKey);
						if (activation === undefined) {
							activation = activateMember({
								payload: { memberId: member.id, prompt: await wakePrompt(plan, member) },
							}, projectRuntime);
							activationTasks.set(activationKey, activation);
							activation.finally(() => activationTasks.delete(activationKey)).catch(() => {});
						}
						const activated = await activation;
						if (activated.error !== undefined) {
							throw Object.assign(new Error(activated.error.message), { code: activated.error.code });
						}
						messageId = activated.messageId ?? null;
						member = projectRuntime.service.state.members?.[member.id] ?? member;
						await titleMemberSession(projectRuntime, member);
					} else {
						await titleMemberSession(projectRuntime, member);
						const runtime = new MemberRuntime({
							subagents, sessions, permissionPresets, sandboxPolicy,
							agents: ctx.get('agents'),
							agentPresets: ctx.get('agentPresets'),
							direct: true,
							parent: parentInfo.agent,
							provider: providers[0],
							preset: 'standard',
							cwd,
							trackHandle: (sessionId, handle) => resumedHandles.set(sessionId, handle),
						});
						const delivered = await runtime.wake(member, { prompt: await wakePrompt(plan, member) });
						messageId = delivered.messageId ?? null;
						// A cold session cannot be renamed before wake; retry once it is live.
						await titleMemberSession(projectRuntime, member);
						persistModelSelection(member.sessionId, member.config, member.name);
					}
					await projectRuntime.service.recordWake(plan.memberId, {
						ok: true, taskId: plan.taskId, reason: plan.reason, messageId,
					}, projectRuntime.id);
					diag.append({
						ev: 'wake.delivered',
						projectId: projectRuntime.id,
						memberId: plan.memberId,
						taskId: plan.taskId ?? null,
						reason: plan.reason,
						activated: member.sessionId === undefined || messageId === null ? 'activation' : 'wake',
						messageId,
					});
				} catch (error) {
					wakeKeys.delete(plan.key);
					diag.append({
						ev: 'wake.fail',
						projectId: projectRuntime.id,
						memberId: plan.memberId,
						taskId: plan.taskId ?? null,
						reason: plan.reason,
						code: error?.code ?? null,
						message: error?.message ?? String(error),
					});
					console.warn('[ai-team] wake failed:', plan.memberId, error?.code ?? error?.message ?? error);
					try {
						await projectRuntime.service.recordWake(plan.memberId, {
							ok: false, taskId: plan.taskId, reason: plan.reason, error: error?.code ?? error?.message ?? String(error),
						}, projectRuntime.id);
					} catch { /* ledger may be closed */ }
				}
			}
		};
		const pmoTick = async (projectRuntime) => {
			if (projectRuntime === null || projectRuntime === undefined) return;
			const state = projectRuntime.service.state;
			const project = state.projects?.[projectRuntime.id];
			if (project === undefined || project.pmoAuto === false || project.status === 'archived') return;
			// P6 停止门：stopped 项目停止一切派发（补派/心跳/升级/continue 全停），
			// 正在执行的回合自然完成；唤醒事件 hook 同样检查（见 wakeFromResult）。
			if (project.runState === 'stopped') return;
			for (const member of Object.values(state.members ?? {})) {
				if (member.kind === 'agent' && typeof member.sessionId === 'string') {
					await titleMemberSession(projectRuntime, member);
				}
			}
			const results = await projectRuntime.service.autoAnswerDecisions(projectRuntime.id);
			for (const result of results) {
				const taskId = result?.item?.ref?.taskId;
				if (typeof taskId === 'string' && result.entry !== null && result.entry !== undefined) {
					await wakeFromResult(projectRuntime, {
						event: { type: 'thread/posted', payload: { taskId, entry: result.entry } },
					}, { agentId: 'mem_pmo' });
				}
			}
			const active = Object.values(state.tasks ?? {}).filter((task) =>
				task.tombstone !== true && ['pending', 'in_progress', 'pending_acceptance'].includes(task.status));
			const now = Date.now();
			// R-14 pending 快速补派：task/created 的事件唤醒可能在责任位正忙时
			// 被投递语义吞掉，而账本没有「回合结束/空闲」事件可挂钩（member.status
			// 只有 running/failed 写点，idle 是 bootstrap 显示兜底）——所以用
			// 60s tick + 责任位状态检查兜底：pending 且责任位非 running → 每分钟
			// 最多一次补派。pending 开工等待从最长 10 分钟压到一个 tick。
			for (const task of active) {
				if (task.status !== 'pending') continue;
				const responsibleId = task.assigneeId ?? task.ownerId;
				const responsible = state.members?.[responsibleId];
				if (responsible === undefined || responsible.kind !== 'agent') continue;
				if (responsible.status === 'running') continue; // 正在执行别的回合：不打断
				if (responsible.status === 'retired' || responsible.status === 'failed') continue; // 不自动唤醒
				const lastDispatch = pmoLastDispatch.get(task.id) ?? 0;
				if (now - lastDispatch < 60_000) continue;
				pmoLastDispatch.set(task.id, now);
				await wakeFromResult(projectRuntime, {
					event: { type: 'pmo/dispatch', payload: { taskId: task.id, bucket: Math.floor(now / 60_000) } },
				}, {});
			}
			for (const task of active) {
				const thread = state.threads?.[task.id];
				const threadAt = thread?.entries?.at(-1)?.at;
				const taskAt = Number.isFinite(task.updatedAt) ? task.updatedAt : 0;
				// For acceptance, assignee Thread chatter must not mask a silent QA.
				// Use the submission timestamp (task.updatedAt) as the review clock.
				const updatedAt = task.status === 'pending_acceptance'
					? taskAt
					: Math.max(taskAt, Number.isFinite(threadAt) ? threadAt : 0);
				if (updatedAt === 0) continue;
				const idleFor = now - updatedAt;
				if (task.status === 'pending_acceptance' && task.qaRequired === true && idleFor >= 10 * 60_000) {
					const lastReview = pmoLastReview.get(task.id) ?? 0;
					if (now - lastReview >= 10 * 60_000) {
						pmoLastReview.set(task.id, now);
						await wakeFromResult(projectRuntime, {
							event: { type: 'pmo/review', payload: { taskId: task.id, bucket: Math.floor(now / 600_000) } },
						}, {});
					}
					// Acceptance waiting on a Thread-only handoff needs the same
					// hourly escalation as in-progress work, or the review loop
					// nudges QA forever while the decided executor never wakes.
					if (idleFor >= 60 * 60_000) {
						const lastEscalate = pmoLastEscalate.get(task.id) ?? 0;
						if (now - lastEscalate >= 60 * 60_000) {
							pmoLastEscalate.set(task.id, now);
							await wakeFromResult(projectRuntime, {
								event: { type: 'pmo/escalate', payload: { taskId: task.id, bucket: Math.floor(now / 3_600_000) } },
							}, {});
						}
					}
					continue;
				}
				if (idleFor >= 10 * 60_000 && idleFor < 30 * 60_000) {
					const lastHeartbeat = pmoLastHeartbeat.get(task.id) ?? 0;
					if (now - lastHeartbeat >= 10 * 60_000) {
						pmoLastHeartbeat.set(task.id, now);
						await wakeFromResult(projectRuntime, {
							event: {
								type: 'pmo/heartbeat',
								payload: { taskId: task.id, memberId: task.assigneeId ?? task.ownerId, bucket: Math.floor(now / 600_000) },
							},
						}, {});
					}
				}
				if (idleFor >= 60 * 60_000) {
					const lastEscalate = pmoLastEscalate.get(task.id) ?? 0;
					if (now - lastEscalate >= 60 * 60_000) {
						pmoLastEscalate.set(task.id, now);
						await wakeFromResult(projectRuntime, {
							event: { type: 'pmo/escalate', payload: { taskId: task.id, bucket: Math.floor(now / 3_600_000) } },
						}, {});
					}
				}
				if (idleFor < 30 * 60_000) continue;
				const lastPing = pmoLastStall.get(task.id) ?? 0;
				if (now - lastPing < 30 * 60_000) continue;
				pmoLastStall.set(task.id, now);
				await wakeFromResult(projectRuntime, {
					event: { type: 'pmo/stall', payload: { taskId: task.id, bucket: Math.floor(now / 1_800_000) } },
				}, {});
			}
			if (active.length > 0) {
				// Prune per-task clock entries whose task left the active set, so
				// the five Map keys track live work instead of growing forever.
				const live = new Set(active.map((task) => task.id));
				for (const map of [pmoLastReview, pmoLastHeartbeat, pmoLastEscalate, pmoLastStall, pmoLastDispatch]) {
					for (const taskId of map.keys()) {
						if (!live.has(taskId)) map.delete(taskId);
					}
				}
				return;
			}
			// P1a 门更新：空项目且未被 Human 显式启动 → 等待首条指令；显式启动
			// （project.runState=running）即视为指令，解除等待。
			const hasAnyTaskHistory = Object.keys(state.tasks ?? {}).length > 0;
			if (!hasAnyTaskHistory && project.explicitStart !== true) return;
			const last = pmoLastKick.get(projectRuntime.id) ?? 0;
			if (now - last < 10 * 60_000) return;
			pmoLastKick.set(projectRuntime.id, now);
			await wakeFromResult(projectRuntime, {
				event: { type: 'pmo/continue', payload: { bucket: Math.floor(now / 600_000) } },
			}, {});
		};

		const distillMemberWithModel = async (projectRuntime, payload) => {
			const member = projectRuntime?.service.state.members?.[payload.memberId];
			if (member === undefined || member.kind !== 'agent') {
				return { error: { code: 'E_NOT_FOUND', message: 'agent not found' }, status: 404 };
			}
			const llm = ctx.get('llm');
			if (llm?.stream === undefined) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'llm service is unavailable' }, status: 503 };
			}
			const selection = member.config?.provider && member.config?.model
				? { provider: member.config.provider, model: member.config.model }
				: ctx.get('agentDefaultModel')?.currentSelection?.();
			if (!selection?.provider || !selection?.model) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no provider/model configured' }, status: 503 };
			}
			const tasks = Object.values(projectRuntime.service.state.tasks ?? {})
				.filter((task) => task.ownerId === member.id || task.assigneeId === member.id)
				.slice(-8)
				.map((task) => `#${task.number ?? '?'} ${task.title} [${task.status}]`)
				.join('\n');
			const prompt = [
				`成员：${member.name}`,
				`角色：${member.role || 'Team member'}`,
				`现有个性：${member.personality || '（空）'}`,
				`备忘：${(member.notes ?? []).slice(-8).join('；') || '（空）'}`,
				`技能：${(member.skills ?? []).join('、') || '（空）'}`,
				`最近任务：\n${tasks || '（无）'}`,
				'',
				'请基于以上材料，把这个成员的工作个性重新蒸馏成一段简洁、可执行、可验证的中文描述。',
				'只输出 JSON：{"personality":"..."}；不要输出 Markdown、解释或代码块。',
			].join('\n');
			let text = '';
			try {
				const stream = llm.stream({
					provider: selection.provider,
					model: selection.model,
					// GenerateOptions has no top-level `system` field; the distiller
					// constraint travels as a system-role message.
					messages: [
						{ role: 'system', content: [{ type: 'text', text: '你是团队的人格蒸馏器。只输出要求的 JSON，不调用工具。' }] },
						{ role: 'user', content: [{ type: 'text', text: prompt }] },
					],
					maxTokens: 400,
				});
				for await (const chunk of stream) {
					if (chunk.type === 'text-delta') text += chunk.text;
					if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
						throw Object.assign(new Error(chunk.reason.failure?.message ?? 'model failed'), { code: chunk.reason.failure?.code ?? 'LLM_ERROR' });
					}
				}
			} catch (error) {
				return { error: { code: error?.code ?? 'E_DISTILL', message: error?.message ?? String(error) }, status: 502 };
			}
			const match = text.match(/\{[\s\S]*\}/);
			let personality = text.trim();
			if (match) {
				try { personality = JSON.parse(match[0]).personality ?? personality; } catch { /* keep text */ }
			}
			if (typeof personality !== 'string' || personality.trim() === '') {
				return { error: { code: 'E_DISTILL', message: 'model returned no personality' }, status: 502 };
			}
			const result = await projectRuntime.service.dispatch({
				type: 'member.distill',
				payload: { memberId: member.id, personality: personality.trim(), reason: payload.reason ?? 'model re-distill' },
				actor: { kind: 'human', memberId: HUMAN_ID },
				projectId: projectRuntime.id,
			});
			return { ok: true, member: result.member, distilled: { provider: selection.provider, model: selection.model } };
		};

		const skillsService = ctx.get('skills');
		let disposeSkillProvider = () => {};
		try {
			// A vendor failure must never fail composition activation: that left
			// fresh installs with a half-activated host until a process restart.
			disposeSkillProvider = installFileSkillProvider(skillsService, {
				dshHome: dshHome(),
				projectCwd: process.cwd(),
				bundledDir: fileURLToPath(new URL('./', import.meta.url)),
			}) ?? (() => {});
		} catch (error) {
			diag.append({ ev: 'skill.provider.fail', message: error?.message ?? String(error) });
			console.warn('[ai-team] file skill provider failed:', error?.message ?? error);
		}
		const tools = ctx.get('tools');
		let disposeSkillOpt = () => {};
		try {
			const shell = ctx.get('shell');
			if (tools?.register && shell) {
				// Backend/timeout come from the plugin Config (patch layer), so an
				// operator can move the skillopt_* tools off the safe mock default.
				disposeSkillOpt = applySkillOpt({
					tools,
					shell,
					logger: console,
				}, {
					backend: config.skilloptBackend ?? 'mock',
					project: process.cwd(),
					timeoutMs: config.skilloptTimeoutMs ?? 120_000,
				}) ?? (() => {});
				diag.append({ ev: 'skillopt.registered', backend: config.skilloptBackend ?? 'mock', timeoutMs: config.skilloptTimeoutMs ?? 120_000 });
			}
		} catch (error) {
			diag.append({ ev: 'skillopt.fail', message: error?.message ?? String(error) });
			console.warn('[ai-team] bundled SkillOpt tools failed:', error?.message ?? error);
		}
		let disposeTool = () => {};
		try {
			disposeTool = tools?.register
				? tools.register(createTeamTool({
					getState: (exec) => runtimeForAgent(exec?.agent?.id)?.service.state
						?? booted?.service.state
						?? { projects: {}, members: {}, tasks: {}, threads: {}, inbox: {} },
					dispatch: (command, exec) => {
						const runtime = runtimeForAgent(exec?.agent?.id) ?? projectRuntime(command?.projectId) ?? null;
						if (runtime === null) return Promise.reject(new Error('no Project runtime'));
						return runtime.service.dispatch(command);
					},
				}), {
					when: (activation) => runtimeForAgent(activation?.agent?.id) !== null,
				})
				: () => {};
		} catch (error) {
			diag.append({ ev: 'team.tool.fail', message: error?.message ?? String(error) });
			console.warn('[ai-team] team tool registration failed:', error?.message ?? error);
		}

		const ensureParent = async () => {
			if (host !== null) return host;
			if (hostPromise === null) {
				const existingHost = [...(booted?.runtimes?.values() ?? [])]
					.map((runtime) => runtime.service.state.hostSessionId)
					.find((value) => value !== undefined && value !== null);
				hostPromise = ensureHostAgent({
					agents: ctx.get('agents'),
					agentDefaultModel: ctx.get('agentDefaultModel'),
					workspaceRegistry: ctx.get('workspaceRegistry'),
					sessions: ctx.get('sessions'),
					cwd: booted?.dataDir ?? process.cwd(),
					resumeSessionId: existingHost,
				}).then(async (value) => {
					if (value.created === true && existingHost === undefined) {
						for (const runtime of booted?.runtimes?.values() ?? []) {
							await runtime.service.bindHostSession(value.sessionId, runtime.id);
						}
					}
					host = value;
					return value;
				}).catch((error) => {
					hostPromise = null;
					throw error;
				});
			}
			return hostPromise;
		};
		const activateMember = async (body, projectRuntime) => {
			const member = projectRuntime.service.state.members?.[body.payload?.memberId];
			if (member === undefined) return { error: { code: 'E_NOT_FOUND', message: 'member not found' }, status: 404 };
			if (member.status === 'retired') return { error: { code: 'E_INVALID_STATE', message: 'member is retired' }, status: 409 };
			if (member.status === 'running' && body.payload?.force !== true) return { error: { code: 'E_INVALID_STATE', message: 'member is already running' }, status: 409 };
			// 无目录项目 fail-closed：成员绝不落到宿主默认目录或插件数据目录
			// （projectCwd 的 dir 兜底）里执行。显式判工作目录，不吃兜底。
			// 先于 reseat 释放旧句柄——否则无目录的 force 会先杀句柄再 409。
			const workspacePath = projectRuntime?.service?.state?.projects?.[projectRuntime.id]?.workspacePath;
			const effectiveDir = member?.workspace || (typeof workspacePath === 'string' ? workspacePath.trim() : '');
			if (effectiveDir === '') {
				diag?.append({ ev: 'activate.reject', projectId: projectRuntime.id, memberId: member.id, code: 'E_WORKSPACE_REQUIRED' });
				return {
					error: {
						code: 'E_WORKSPACE_REQUIRED',
						message: 'this Project has no workspace yet; set a workspace directory before activating members',
					},
					status: 409,
				};
			}
			// 会话重建（reseat）：成员已有会话且本次为 force 时，先释放旧会话的
			// 运行时句柄（activation / resume handle），旧 DSH 会话本体由宿主持
			// 久管理，插件不再持有或唤醒它；新会话落在当前项目工作目录。这是
			// 修复历史"账本目录兜底 cwd"游离会话的唯一路径（会话 cwd 创建时
			// 钉死，resume 不覆盖，DSH 不提供原地改 cwd 的 API）。
			if (typeof member.sessionId === 'string' && member.sessionId !== '' && body.payload?.force === true) {
				const staleId = member.sessionId;
				const staleActivation = activations.get(staleId);
				if (staleActivation !== undefined) {
					activations.delete(staleId);
					try { await staleActivation.dispose?.(); } catch { /* already gone */ }
				}
				const staleHandle = resumedHandles.get(staleId);
				if (staleHandle !== undefined) {
					resumedHandles.delete(staleId);
					try { await staleHandle.dispose?.(); } catch { /* already gone */ }
				}
				diag?.append({ ev: 'member.reseat', memberId: member.id, oldSessionId: staleId, projectId: projectRuntime.id });
			}
			const subagents = ctx.get('subagents');
			const sessions = ctx.get('sessions');
			const permissionPresets = ctx.get('permissionPresets');
			const sandboxPolicy = ctx.get('sandboxPolicy');
			if (subagents === undefined || sessions === undefined || permissionPresets === undefined || sandboxPolicy === undefined) {
				diag?.append({ ev: 'activate.reject', projectId: projectRuntime.id, memberId: member.id, code: 'E_RUNTIME_UNAVAILABLE' });
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'member runtime services are unavailable' }, status: 503 };
			}
			const providers = typeof subagents.list === 'function' ? subagents.list() : [];
			if (providers.length === 0) {
				diag?.append({ ev: 'activate.reject', projectId: projectRuntime.id, memberId: member.id, code: 'E_RUNTIME_UNAVAILABLE', detail: 'no provider' });
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no subagent provider is registered' }, status: 503 };
			}
			try {
				const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
				const activationMember = member.config?.provider && member.config?.model
					? member
					: {
						...member,
						config: {
							...member.config,
							...(selection?.provider ? { provider: selection.provider } : {}),
							...(selection?.model ? { model: selection.model } : {}),
						},
					};
				if (!activationMember.config?.provider || !activationMember.config?.model) {
					return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no member or default provider/model is configured' }, status: 503 };
				}
				const parentInfo = await ensureParent();
				const runtime = new MemberRuntime({
					subagents,
					sessions,
					permissionPresets,
					sandboxPolicy,
					agents: ctx.get('agents'),
					agentPresets: ctx.get('agentPresets'),
					direct: true,
					parent: parentInfo.agent,
					provider: providers[0],
					preset: 'standard',
					cwd: effectiveDir,
					trackHandle: (sessionId, handle) => resumedHandles.set(sessionId, handle),
				});
				const result = await runtime.activate(activationMember, {
					prompt: `${memberIdentity(activationMember)}\n\n${typeof body.payload?.prompt === 'string'
						? body.payload.prompt
						: '你被加入 AI Team。先读取项目简报与收件箱，再处理分配给你的任务。'}${await formatSkillCatalog(skillsService, { cwd: effectiveDir })}${await loadSkillContext(activationMember, projectRuntime.dir)}`,
				});
				let bound;
				try {
					bound = await projectRuntime.service.bindMemberSession(
						{ actor: { kind: 'human', memberId: HUMAN_ID }, projectId: projectRuntime.id },
						{ memberId: member.id, sessionId: result.childId },
					);
				} catch (error) {
					try { await result.activation.dispose?.(); } catch { /* already gone */ }
					throw error;
				}
				activations.set(result.childId, result.activation);
				await attachMemberWorkspace(projectRuntime, result.childId);
				persistModelSelection(result.childId, activationMember.config, member.name);
				return {
					ok: true,
					member: bound.member,
					sessionId: result.childId,
					messageId: result.messageId,
					debug: result.debug ?? null,
				};
			} catch (error) {
				try {
					await projectRuntime.service.failMember(
						{ actor: { kind: 'human', memberId: HUMAN_ID }, projectId: projectRuntime.id },
						{ memberId: member.id, reason: `${error.code ?? 'E_RUNTIME'}: ${error.message ?? error}` },
					);
				} catch { /* member may already be gone */ }
				return { error: { code: error.code ?? 'E_RUNTIME', message: error.message ?? String(error) }, status: 409 };
			}
		};
		let attachRuntime = null;
		const currentRuntime = () => projectRuntime(booted?.activeProjectId) ?? booted?.runtime ?? null;
		const snapshot = (runtime = currentRuntime()) => ({
			rev: runtime?.ledger?.head?.seq ?? 0,
			generatedAt: Date.now(),
			board: runtime?.service?.board(runtime.id),
			quadrants: runtime?.service?.quadrants(runtime.id),
		});
		attachRuntime = (runtime) => {
			runtime.ledger.onEvent = (event) => {
				broadcast(event, runtime);
				const actorId = event?.actor?.kind === 'agent' ? event.actor.memberId : undefined;
				void wakeFromResult(runtime, { event }, actorId === undefined ? {} : { agentId: actorId }).catch((error) => {
					diag.append({ ev: 'wake.plan.fail', projectId: runtime.id, eventType: event?.type ?? null, message: error?.message ?? String(error) });
					console.warn('[ai-team] event wake planner failed:', error?.message ?? error);
				});
			};
		};
		let disposePermissionGuard = () => {};
		ready.then((value) => {
			if (value !== null && value !== undefined) {
				for (const runtime of value.runtimes.values()) attachRuntime(runtime);
				if (tools?.guard) {
					const allMembers = {
						get state() {
							const members = {};
							for (const runtime of booted?.runtimes?.values() ?? []) {
								Object.assign(members, runtime.service.state.members ?? {});
							}
							return { members };
						},
					};
					disposePermissionGuard = tools.guard(createMemberPermissionGuard({
						service: allMembers,
						permissionPresets: ctx.get('permissionPresets'),
						sandboxPolicy: ctx.get('sandboxPolicy'),
					})) ?? (() => {});
				}
				// A restart is an explicit lifecycle event: resume unfinished Tasks
				// once per Project, without timers or periodic polling.
				for (const runtime of value.runtimes.values()) {
					void wakeFromResult(runtime, { event: { type: 'team/startup' } }, {}).catch((error) => {
						diag.append({ ev: 'wake.plan.fail', projectId: runtime.id, eventType: 'team/startup', message: error?.message ?? String(error) });
						console.warn('[ai-team] startup wake planner failed:', error?.message ?? error);
					});
				}
			}
		}).catch(() => {});
		const broadcastNow = (event, runtime = currentRuntime()) => {
			if (runtime === null || runtime === undefined) return;
			const payload = {
				...snapshot(runtime),
				projectId: runtime.id,
				type: 'change',
				event: event === undefined ? null : { id: event.id, type: event.type, seq: event.seq },
			};
			const frame = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
			for (const client of sseClients) {
				if (client.projectId !== runtime.id) continue;
				if (client.res.writableEnded || client.res.destroyed) {
					sseClients.delete(client);
					continue;
				}
				try {
					client.res.write(frame);
				} catch {
					sseClients.delete(client);
				}
			}
		};
		// 合帧：一条 wake 链会连发 2-4 条账本事件，每条都全量重算 board+quadrants
		// 并整帧广播是平方级放大。按 Project 250ms 窗口合并为一次快照帧；
		// 帧内 event 取窗口最后一条（客户端 toast 仍有通知，rev 守卫保证幂等）。
		const pendingFrames = new Map();
		const broadcast = (event, runtime = currentRuntime()) => {
			if (runtime === null || runtime === undefined) return;
			const queued = pendingFrames.get(runtime.id);
			if (queued !== undefined) {
				queued.lastEvent = event ?? queued.lastEvent;
				return;
			}
			const entry = { runtime, lastEvent: event ?? null };
			pendingFrames.set(runtime.id, entry);
			entry.timer = setTimeout(() => {
				pendingFrames.delete(runtime.id);
				broadcastNow(entry.lastEvent ?? undefined, entry.runtime);
			}, 250);
			entry.timer.unref?.();
		};

		async function activateProject(nextProjectId, projectName, projectGoal, workspacePath = '') {
			await ready;
			if (booted === null) throw new Error('team ledger is unavailable');
			let next = projectRuntime(nextProjectId);
			if (next === null) {
				next = await ProjectRuntime.open({
					rootDir: booted.dataDir,
					projectId: nextProjectId,
					projectName,
					projectGoal,
					workspacePath,
					diag,
				});
				booted.runtimes.set(nextProjectId, next);
				attachRuntime(next);
			}
			booted.registry.setActive(nextProjectId);
			booted = {
				...booted,
				runtime: next,
				activeProjectId: nextProjectId,
				ledger: next.ledger,
				service: next.service,
			};
			broadcast(undefined, next);
			return next;
		}

		const dispose = webServer.register({
			kind: 'prefix',
			path: '/ai-team',
			handler: async (req, res) => {
				try {
					const url = new URL(req.url, 'http://local');
					await ready;
					if (booted === null) {
						return send(res, {
							error: { code: 'BOOT_FAILED', message: 'team ledger is unavailable', details: bootError?.message ?? null },
						}, 503);
					}

					if (req.method === 'GET' && url.pathname === '/ai-team/api/skills-debug') {
						// Developer diagnostic; gated like the test.* hooks so production
						// does not expose the installed skill inventory.
						if (process.env.DSH_AI_TEAM_TEST !== '1') {
							return send(res, { error: { code: 'E_FORBIDDEN', message: 'debug endpoint is disabled' } }, 403);
						}
						const variants = {};
						for (const [label, options] of [
							['none', {}],
							['repo', { cwd: process.cwd() }],
							['data', { cwd: booted.dataDir }],
						]) {
							try {
								variants[label] = (await skillsService.list(options)).map((skill) => skill.name);
							} catch (error) {
								variants[label] = [error?.message ?? String(error)];
							}
						}
						return send(res, {
							variants,
							get: await skillsService.get('distilly', {}).then((skill) => skill?.name ?? null).catch(() => null),
						});
					}
					if (req.method === 'GET' && url.pathname === '/ai-team/api/models') {
						const catalog = await buildModelCatalog(ctx.get('llm'), ctx.get('agentDefaultModel'));
						return send(res, catalog);
					}
				// R-17 person 别名：视图层绑定（name → personId），文件存策略数据
				// 目录；聚合时别名生效，未绑定回落同名聚合（可回退路径）。
				const aliasesPath = join(booted.dataDir, 'people-aliases.json');
				const readAliases = () => {
					try {
						const parsed = JSON.parse(readFileSync(aliasesPath, 'utf8'));
						return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
					} catch {
						return null;
					}
				};
				// 人员池：按"人"聚合各项目账本的成员身份/状态/失败/任务数
				//（11-管理视角与信息架构 §2；只读，复用既有投影，不建新数据）。
				if (req.method === 'GET' && url.pathname === '/ai-team/api/people') {
					const registryEntries = booted.registry.list();
					const people = aggregatePeople(registryEntries, [...booted.runtimes.values()], { aliases: readAliases() });
					return send(res, { ok: true, people });
				}
				// R-17 绑定：把一个名字并到某个 personId（Human 在人员池显式确认）。
				if (req.method === 'POST' && url.pathname === '/ai-team/api/people-aliases') {
					const body = await readJson(req);
					const memberName = typeof body?.name === 'string' ? body.name.trim() : '';
					const personId = typeof body?.personId === 'string' ? body.personId.trim() : '';
					if (memberName === '' || personId === '') {
						return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: 'name and personId are required' } }, 400);
					}
					const aliases = readAliases() ?? {};
					aliases[memberName] = personId;
					writeFileSync(aliasesPath, JSON.stringify(aliases, null, 2) + '\n', 'utf8');
					diag?.append({ ev: 'people.alias', name: memberName, personId });
					return send(res, { ok: true, aliases });
				}
					// 待验收跨项目队列（R-09）：各项目 q1 中需要 Human 验收的任务
					//（review/irreversible 类目，复用 quadrantsView 既有投影）。
					if (req.method === 'GET' && url.pathname === '/ai-team/api/pending-acceptance') {
						const registryEntries = booted.registry.list();
						const rows = [];
						for (const runtime of booted.runtimes.values()) {
							const projectName = registryEntries.find((project) => project.id === runtime.id)?.name ?? runtime.id;
							const q1 = runtime.service.quadrants(runtime.id).q1;
							for (const item of q1.items ?? []) {
								if (item.kind !== 'task' || (item.category !== 'review' && item.category !== 'irreversible')) continue;
								rows.push({ ...item, projectId: runtime.id, projectName });
							}
						}
						return send(res, { ok: true, rows });
					}
					// 风险清单（R-07）：当前项目账本的三类风险只读投影（受阻/失败/待决超时）。
					if (req.method === 'GET' && url.pathname === '/ai-team/api/risks') {
						const requested = url.searchParams.get('project');
						const runtime = (requested === null ? null : projectRuntime(requested)) ?? currentRuntime();
						if (runtime === null || runtime === undefined) {
							return send(res, { ok: true, risks: { rev: 0, generatedAt: Date.now(), blocked: [], failures: [], staleDecisions: [], counts: { blocked: 0, failures: 0, staleDecisions: 0 } } });
						}
						const staleHours = Number.parseFloat(url.searchParams.get('staleHours') ?? '');
						const risks = riskView(runtime.service.state, {
							now: Date.now(),
							staleHours: Number.isFinite(staleHours) && staleHours > 0 ? staleHours : 24,
						});
						return send(res, { ok: true, projectId: runtime.id, risks });
					}
					// 项目周报（R-11）：同一投影的正向/负向双解读数据面。
					const weekly = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/weekly$/);
					if (req.method === 'GET' && weekly !== null) {
						const runtime = projectRuntime(decodeURIComponent(weekly[1]));
						if (runtime === null) return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						const weeks = Number.parseInt(url.searchParams.get('weeks') ?? '', 10);
						return send(res, {
							ok: true,
							projectId: runtime.id,
							weekly: weeklyView(runtime.service.state, {
								now: Date.now(),
								weeks: Number.isSafeInteger(weeks) && weeks > 0 ? Math.min(weeks, 12) : 1,
							}),
						});
					}
					// 任务事件历史（R-18）：Human 侧可追溯入口的只读数据面。
					const taskEvents = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/events$/);
					if (req.method === 'GET' && taskEvents !== null) {
						const runtime = projectRuntime(decodeURIComponent(taskEvents[1]));
						const taskId = decodeURIComponent(taskEvents[2]);
						if (runtime === null || runtime === undefined) return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						const events = runtime.ledger.events.filter((event) => {
							const pid = event.payload?.taskId ?? event.payload?.id ?? null;
							return typeof pid === 'string' && pid === taskId;
						});
						return send(res, {
							ok: true,
							taskId,
							events: events.map((event) => ({
								seq: event.seq, type: event.type, at: event.at,
								actor: event.actor ?? null,
							})),
						});
					}
					if (req.method === 'GET' && url.pathname === '/ai-team/api/health') {						const head = booted.ledger.head;
						return send(res, {
							ok: true,
							plugin: name,
							version: VERSION,
							projectId: booted.activeProjectId,
							activeProjectId: booted.activeProjectId,
							ledger: { events: booted.ledger.headSeq, head },
							projects: [...booted.runtimes.values()].map((runtime) => ({
								id: runtime.id,
								events: runtime.ledger.headSeq,
								head: runtime.ledger.head.seq,
								active: runtime.id === booted.activeProjectId,
							})),
							runtime: {
								roots: ctx.get('agents')?.roots?.().length ?? null,
								defaultModel: ctx.get('agentDefaultModel')?.currentSelection?.() ?? null,
								llmProviders: ctx.get('llm')?.listProviders?.() ?? [],
								providers: ctx.get('subagents')?.list?.() ?? [],
								providerCaps: (ctx.get('subagents')?.list?.() ?? []).map((providerName) => {
									const provider = ctx.get('subagents')?.getProvider?.(providerName);
									return {
										name: providerName,
										capabilities: provider?.capabilities ?? null,
										inheritsParentContext: provider?.inheritsParentContext ?? null,
										continuable: typeof provider?.prepareContinuable === 'function',
										start: typeof provider?.start === 'function',
									};
								}),
								teamTool: ctx.get('tools')?.definitions?.().some((definition) => definition.name === 'team') ?? null,
								skillsService: skillsService !== null && skillsService !== undefined,
								skillNames: skillsService?.list
									? await Promise.resolve(skillsService.list({})).then((rows) => rows.map((skill) => skill.name).filter((skillName) => !isSkillExcluded(skillName))).catch(() => [])
									: [],
								skilloptTools: tools?.definitions?.().map((definition) => definition.name).filter((name) => name.startsWith('skillopt_')) ?? [],
								presets: await Promise.resolve(ctx.get('agentPresets')?.list?.()).catch(() => []),
								members: Object.values(booted.service.state.members ?? {})
									.filter((member) => member.kind === 'agent')
									.map((member) => {
										const agent = ctx.get('agents')?.get?.(member.sessionId);
										let lastEvent = null;
										let seq = null;
										try {
											const events = agent?.session?.snapshotEvents?.() ?? [];
											lastEvent = events.at(-1)?.type ?? null;
											seq = events.at(-1)?.seq ?? null;
										} catch { /* diagnostic only */ }
										let tail = [];
										try {
											tail = (agent?.session?.snapshotEvents?.() ?? []).slice(-20).map((entry) => ({
												seq: entry.seq,
												type: entry.type,
												tool: entry.type === 'tool/call' ? entry.data?.name ?? null : undefined,
												reason: entry.type === 'turn/end' ? entry.data?.reason ?? null : undefined,
												inbox: entry.type === 'agent/inbox/spliced'
													? {
														target: entry.data?.target ?? null,
														inserted: Array.isArray(entry.data?.inserted) ? entry.data.inserted.length : null,
													}
													: undefined,
											}));
										} catch { /* diagnostic only */ }
										return { id: member.id, status: agent?.status ?? null, lastEvent, seq, tail };
									}),
							},
						});
					}
					if (req.method === 'GET' && url.pathname === '/ai-team/api/bootstrap') {
						const requested = url.searchParams.get('project');
						const requestedRuntime = requested === null ? null : projectRuntime(requested);
						const bootstrapRuntime = requestedRuntime ?? currentRuntime();
						const bootstrap = bootstrapRuntime.service.bootstrap(bootstrapRuntime.id);
						// 跨项目收件箱聚合：其它项目只读 state.inbox 过滤（此前对每个
						// 项目整调 bootstrap——board+quadrants+threads 全算，O(项目数×
						// 全视图)/请求）。
						const inbox = [];
						for (const runtime of booted.runtimes.values()) {
							const projectName = booted.registry.list().find((project) => project.id === runtime.id)?.name ?? runtime.id;
							if (runtime.id === bootstrapRuntime.id) {
								for (const item of bootstrap.inbox ?? []) {
									inbox.push({ ...item, projectId: runtime.id, projectName });
								}
								continue;
							}
							const humanId = runtime.service.humanId();
							for (const item of Object.values(runtime.service.state.inbox ?? {})) {
								if (humanId === null || item.memberId !== humanId) continue;
								if (isInformationalThreadMention(item)) continue;
								inbox.push({ ...item, projectId: runtime.id, projectName });
							}
						}
						inbox.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
						return send(res, {
							...bootstrap,
							inbox,
							inboxUnread: inbox.filter((item) => item.state === 'unread').length,
							projects: booted.registry.list().map((project) => {
								const active = bootstrap.projects?.find((entry) => entry.id === project.id);
								return {
									...project,
									owner: active?.owner ?? null,
									goal: active?.goal ?? '',
									workspacePath: active?.workspacePath ?? project.workspacePath ?? '',
									pmoAuto: project.pmoAuto ?? active?.pmoAuto ?? true,
									archived: false,
									active: project.id === booted.activeProjectId,
								};
							}),
							runtime: {
								defaultModel: ctx.get('agentDefaultModel')?.currentSelection?.() ?? null,
								providers: ctx.get('subagents')?.list?.() ?? [],
							},
						});
					}

					const events = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/events$/);
					if (req.method === 'GET' && events !== null) {
						const projectId = decodeURIComponent(events[1]);
						const runtime = projectRuntime(projectId);
						if (runtime === null) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						res.writeHead(200, {
							'content-type': 'text/event-stream; charset=utf-8',
							'cache-control': 'no-cache, no-transform',
							connection: 'keep-alive',
							'x-accel-buffering': 'no',
						});
						res.write(`event: ready\ndata: ${JSON.stringify({ ...snapshot(runtime), type: 'ready' })}\n\n`);
						const client = { res, projectId };
						sseClients.add(client);
						const cleanup = () => sseClients.delete(client);
						req.on('close', cleanup);
						res.on('close', cleanup);
						return;
					}

					const board = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/board$/);
					if (req.method === 'GET' && board !== null) {
						const projectId = decodeURIComponent(board[1]);
						const runtime = projectRuntime(projectId);
						if (runtime === null) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						try {
							const doneLimit = Number.parseInt(url.searchParams.get('doneLimit') ?? '', 10);
							return send(res, runtime.service.board(projectId, {
								doneLimit: Number.isSafeInteger(doneLimit) ? doneLimit : undefined,
							}));
						} catch (error) {
							return errorResponse(res, error);
						}
					}

					const quadrants = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/quadrants$/);
					if (req.method === 'GET' && quadrants !== null) {
						const projectId = decodeURIComponent(quadrants[1]);
						const runtime = projectRuntime(projectId);
						if (runtime === null) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						try {
							const q4Limit = Number.parseInt(url.searchParams.get('q4Limit') ?? '', 10);
							const q4Days = Number.parseFloat(url.searchParams.get('q4Days') ?? '');
							return send(res, runtime.service.quadrants(projectId, {
								q4Limit: Number.isSafeInteger(q4Limit) ? q4Limit : undefined,
								q4Days: Number.isFinite(q4Days) ? q4Days : undefined,
							}));
						} catch (error) {
							return errorResponse(res, error);
						}
					}

					const commands = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/commands$/);
					if (req.method === 'POST' && commands !== null) {
						const projectId = decodeURIComponent(commands[1]);
						const runtime = projectRuntime(projectId);
						if (runtime === null) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						let body;
						try {
							body = await readJson(req);
						} catch (error) {
							return errorResponse(res, error.code === 'E_INVALID_ARGUMENT' ? error : Object.assign(error, {
								code: 'E_INVALID_ARGUMENT',
								message: 'JSON body is required',
								status: 400,
							}));
						}
						if (typeof body?.type !== 'string' || body.type === '') {
							return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: 'command type is required' } }, 400);
						}
						if (body.type === 'test.llm.fault') {
							if (process.env.DSH_AI_TEAM_TEST !== '1') {
								return send(res, { error: { code: 'E_FORBIDDEN', message: 'test hook is disabled' } }, 403);
							}
							const mode = body.payload?.mode ?? null;
							if (mode !== null && mode !== 'billing' && mode !== 'network') {
								return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: 'mode must be billing, network or null' } }, 400);
							}
							llmFaultMode = mode;
							return send(res, { ok: true, mode });
						}
						if (body.type === 'test.permission.downgrade') {
							if (process.env.DSH_AI_TEAM_TEST !== '1') {
								return send(res, { error: { code: 'E_FORBIDDEN', message: 'test hook is disabled' } }, 403);
							}
							const member = runtime.service.state.members?.[body.payload?.memberId];
							const agent = member?.sessionId === undefined ? undefined : ctx.get('agents')?.get?.(member.sessionId);
							const session = agent?.session;
							if (session === undefined || session === null) {
								return send(res, { error: { code: 'E_NOT_FOUND', message: 'member session not found' } }, 404);
							}
							const permissionPresets = ctx.get('permissionPresets');
							permissionPresets?.set?.(session, 'workspace-write');
							return send(res, {
								ok: true,
								mode: ctx.get('sandboxPolicy')?.overrideOf?.(session) ?? null,
							});
						}
						if (body.type === 'test.permission.read') {
							if (process.env.DSH_AI_TEAM_TEST !== '1') {
								return send(res, { error: { code: 'E_FORBIDDEN', message: 'test hook is disabled' } }, 403);
							}
							const member = runtime.service.state.members?.[body.payload?.memberId];
							const agent = member?.sessionId === undefined ? undefined : ctx.get('agents')?.get?.(member.sessionId);
							const session = agent?.session;
							return send(res, {
								ok: true,
								mode: session === undefined || session === null
									? null
									: ctx.get('sandboxPolicy')?.overrideOf?.(session) ?? null,
							});
						}
						if (body.type === 'member.distill' && body.payload?.mode === 'model') {
							const distilled = await distillMemberWithModel(runtime, body.payload ?? {});
							if (distilled.error !== undefined) return send(res, { error: distilled.error }, distilled.status ?? 502);
							return send(res, distilled);
						}
						if (body.type === 'project.create') {
							const name = typeof body.payload?.name === 'string' ? body.payload.name.trim() : '';
							const goal = typeof body.payload?.goal === 'string' ? body.payload.goal.trim() : '';
							const workspacePath = typeof body.payload?.workspacePath === 'string' ? body.payload.workspacePath.trim() : '';
							if (name === '') return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: 'project name is required' } }, 400);
							// 工作目录可空（稍后设置）：讨论与建卡不受限；成员激活在
							// activateMember 处 fail-closed，绝不落到宿主默认目录执行。
							const id = ids.project();
							booted.registry.add({ id, name, goal, workspacePath });
							const next = await activateProject(id, name, goal, workspacePath);
							return send(res, { ok: true, project: next.service.state.projects[id] ?? { id, name } });
						}
						if (body.type === 'project.activate') {
							const target = body.payload?.projectId;
							if (typeof target !== 'string' || !booted.registry.list().some((project) => project.id === target)) {
								return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
							}
							const record = booted.registry.list().find((project) => project.id === target);
							const next = await activateProject(target, record?.name, record?.goal);
							return send(res, { ok: true, project: next.service.state.projects[target] ?? record });
						}
						if (body.type === 'member.activate') {
							const activated = await activateMember(body, runtime);
							if (activated.error !== undefined) return send(res, { error: activated.error }, activated.status ?? 409);
							broadcast(undefined);
							return send(res, activated);
						}
						try {
							const result = await runtime.service.dispatch({
								type: body.type,
								payload: body.payload ?? {},
								actor: { kind: 'human', memberId: HUMAN_ID },
								projectId: runtime.id,
								correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
							});
							send(res, { ok: true, ...result });
							void wakeFromResult(runtime, result, { agentId: HUMAN_ID }).catch((error) => {
								diag.append({ ev: 'wake.plan.fail', projectId: runtime.id, eventType: result?.event?.type ?? null, message: error?.message ?? String(error) });
								console.warn('[ai-team] wake planner failed:', error?.message ?? error);
							});
							return;
						} catch (error) {
							return errorResponse(res, error);
						}
					}

					return send(res, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
				} catch (error) {
					return errorResponse(res, error);
				}
			},
		});

		return () => {
			// Teardown must fully settle before the loader activates the next
			// composition: a racing parent-agent dispose left the previous
			// session-controller graph half-disposed and broke plugin toggles.
			const cleanup = [];
			for (const client of sseClients) {
				try { client.res.end(); } catch { /* socket already gone */ }
			}
			sseClients.clear();
			for (const entry of pendingFrames.values()) {
				try { clearTimeout(entry.timer); } catch { /* already fired */ }
			}
			pendingFrames.clear();
			if (pmoTimer !== null) { clearInterval(pmoTimer); pmoTimer = null; }
			for (const activation of activations.values()) {
				cleanup.push(Promise.resolve().then(async () => {
					try { await activation.dispose?.(); } catch { /* already gone */ }
				}));
			}
			activations.clear();
			for (const handle of resumedHandles.values()) {
				cleanup.push(Promise.resolve().then(async () => {
					try { await handle?.dispose?.(); } catch { /* already gone */ }
				}));
			}
			resumedHandles.clear();
			if (host !== null) cleanup.push(Promise.resolve().then(async () => {
				try { await host.dispose?.(); } catch { /* already gone */ }
			}));
			try { disposePermissionGuard(); } catch { /* already disposed */ }
			try { offLlmFault(); } catch { /* already disposed */ }
			try { disposeSkillProvider(); } catch { /* already disposed */ }
			try { disposeSkillOpt(); } catch { /* already disposed */ }
			offRequestError();
			offSessionEvent();
			disposeTool();
			dispose();
			for (const runtime of booted?.runtimes?.values() ?? []) {
				cleanup.push(Promise.resolve().then(async () => {
					try { await runtime.close(); } catch { /* ledger already closed */ }
				}));
			}
			return Promise.allSettled(cleanup).then(() => undefined);
		};
	}, 'ai-team: workbench routes');
}
