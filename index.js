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
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';
import { ProjectRuntime } from './lib/host/project-runtime.js';
import { ProjectRegistry } from './lib/host/project-registry.js';
import { resolveDefaultWorkspace } from './lib/host/default-workspace.js';
import { hostPlatform, workspaceExample } from './lib/host/workspace-path.js';
import { migrateLegacyNamespace, resolveProfile } from './lib/ledger/namespace.js';
import { ids } from './lib/domain/ids.js';
import { MemberRuntime, validatePermissionProfile } from './lib/runtime/member-runtime.js';
import { ensureHostAgent } from './lib/runtime/host-agent.js';
import { repairArchivedHosts as repairHostSessions } from './lib/runtime/host-repair.js';
import { classifyLlmFailure, nextRequestAttempt, retryDecision } from './lib/runtime/failure-policy.js';
import { memberIdentity } from './lib/domain/member-profile.js';
import { loadSkillContext } from './lib/runtime/skill-loader.js';
import { formatSkillCatalog } from './lib/runtime/skill-catalog.js';
import { isSkillExcluded } from './lib/runtime/skill-policy.js';
import { installFileSkillProvider } from './lib/runtime/skill-provider.js';
import { apply as applySkillOpt } from './lib/vendor/skillopt/src/index.js';
import { createAdoptGate, wrapToolsWithAdoptGate } from './lib/skillopt/adopt-gate.js';
import { wrapToolsWithSkilloptAccess } from './lib/skillopt/tool-access.js';
import { applyLiveAtomically, backupLive, sha12 } from './lib/skillopt/proposal-store.js';
import { formatRubric, scoreSkillRubric } from './lib/skillopt/rubric.js';
import { makeJudge, makeReadPair } from './lib/skillopt/gate-wiring.js';
import { runOptimizeLoop, validateCandidate, weakestDimension } from './lib/skillopt/optimizer.js';
import { hasPairedKeepRecord, makeGenerator, makeResultAppender, makeVcs } from './lib/skillopt/optimize-wiring.js';
import { isJobExpired, listJobs, readJob, writeJob } from './lib/skillopt/jobs.js';

/** 评审通道 job 的兜底 TTL：与子代理通道（jobs.js JOB_TTL_MS）保持一致。 */
const REVIEW_JOB_TTL_MS = 30 * 60 * 1000;
import { reconcileJobs } from './lib/skillopt/job-runner.js';
import { collectReview, startReview } from './lib/skillopt/review-runner.js';
import { REVIEWER_NAME } from './lib/skillopt/reviewer.js';
import { createMemberPermissionGuard } from './lib/host/permission-guard.js';
import { installFaultAdapter } from './lib/host/fault-adapter.js';
import { buildModelCatalog } from './lib/host/model-catalog.js';
import { createTeamTool } from './lib/host/member-tools.js';
import { describeTaskContext, describeWake, planWakes } from './lib/host/waker.js';
import { describeCauseChain } from './lib/runtime/error-chain.js';
import { classifyWakeFailure } from './lib/runtime/wake-failure.js';
import { registerShellGuard } from './lib/runtime/shell-guard.js';
import { createActivationBudget } from './lib/runtime/activation-budget.js';
import { blocksActivation, probeProviderRegistration } from './lib/runtime/subagent-probe.js';
import { aggregatePeople } from './lib/host/people-view.js';
import { riskView } from './lib/host/risk-view.js';
import { weeklyView } from './lib/host/weekly-view.js';
import { isInformationalThreadMention } from './lib/domain/inbox.js';
import { createDiagLogger, defaultDiagDir, installDiagSink } from './lib/diaglog.js';

export const name = 'ai-team';

/** The workbench only makes sense where the Web carrier exists. */
// cordis 按 inject 保证属性注入；未声明的属性访问会抛错，因此这里列全插件
// 实际使用的服务（含可选服务：缺失时 serviceOf 回退 ctx.get 并返回 undefined）。
export const inject = ['webServer', 'permissionPresets', 'sandboxPolicy', 'tools', 'shell', 'agents', 'subagents', 'sessions'];

// 版本号只有一处真源：package.json。硬编码字面量曾让 /health 在升版后仍报旧版本，
// 误导「运行实例是否加载了新代码」的判断。
const VERSION = (() => {
	try {
		return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
})();
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
	// Darwin paired judge：独立子代理票数，奇数 ≥3（接近平局可升 5）。
	skilloptJudgeVotes: z.number().step(1).min(3).max(9).default(3),
	// 初装默认项目与「新建项目」对话框的默认工作目录；留空则取宿主 cwd（见 boot）。
	defaultWorkspace: z.string().default(''),
	// 同一成员 30 分钟内允许的自动重建次数（失败→自愈→再失败的死循环闸门）。
	autoReseatLimitPer30Min: z.number().step(1).min(1).max(100).default(6),
	// 成员 shell 风险守卫：'warn' 只记诊断（默认），'block' 直接拒绝，'off' 不介入。
	// 实机事故：成员写 serve.ps1 并用隐藏窗口拉起常驻进程，触发杀软报毒。
	shellGuard: z.union(['off', 'warn', 'block']).default('warn'),
});

/**
 * 惰性 shell 服务代理：插件注入时机可能早于 shell 服务就绪，注册与 tick 都
 * 必须在调用时现取，避免「boot 时未就绪 → 整条技能链静默跳过」。
 */
/**
 * 取 DSH 服务：cordis 以属性形式注入（ctx.tools / ctx.shell …），
 * ctx.get(name) 是另一套查询；两者在不同宿主版本上可用性不同，故先属性后 get。
 */
function serviceOf(ctx, name) {
	// cordis Context 是 Proxy：访问未注入的属主会抛错，故必须 try/catch；
	// 属性不可用时回退 ctx.get(name)（可选服务缺失返回 undefined）。
	try {
		const direct = ctx?.[name];
		if (direct !== undefined && direct !== null) return direct;
	} catch { /* not injected: fall back to ctx.get */ }
	return ctx?.get?.(name);
}

function lazyShellService(ctx) {
	const get = () => {
		const service = serviceOf(ctx, 'shell');
		if (service === undefined || service === null) throw new Error('shell service is not available');
		return service;
	};
	return {
		resolve: (spec) => {
			const service = get();
			return typeof service.resolve === 'function' ? service.resolve(spec) : spec;
		},
		execute: async (spec) => {
			const service = get();
			return typeof service.execute === 'function' ? service.execute(spec) : service.run(spec);
		},
	};
}

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

function resolvedProfile() {
	return resolveProfile(process.argv, process.env);
}

function profileName() {
	// 桌面启动器不导出 DSH_PROFILE，而是把 profile 目录作为**位置参数**传进来
	// （… <dsh-root> C:\Users\…\.dsh\profiles\desktop …）。解析规则抽到
	// lib/ledger/namespace.js：`--profile x`、`--profile=x`、位置路径与 env 都要认。
	return resolvedProfile().name;
}

/**
 * Open the default Project ledger and seed the Human + Project skeleton once.
 * A torn tail is repaired by the writer; the repair is recorded as a system
 * event so the append-only history explains the gap.
 */
async function boot(diag, config = {}) {
	const dataDir = join(dshHome(), 'ai-team', profileName());
	// 旧版本把 desktop profile 的数据写进了 `ai-team/default/`（profile 名只认
	// `--profile`，而桌面启动器按位置参数传）。这里做一次性、数据驱动、可回退的
	// 搬迁：只有旧命名空间的数据明显更多时才搬，目标原有内容改名保留、不删除。
	const legacyDir = join(dshHome(), 'ai-team', 'default');
	// 只在**桌面启动器**（profile 以位置参数传入）时搬迁：那个坑正是它造成的。
	// 从 --profile ai-team 起一个 CLI 不该把 GUI 的团队偷走。
	if (dataDir !== legacyDir && ['argv-path', 'profiles-single'].includes(resolvedProfile().source)) {
		migrateLegacyNamespace({ fromDir: legacyDir, toDir: dataDir, diag });
	}
	// 默认工作目录：规则与优先级见 lib/host/default-workspace.js（有独立测试）。
	let defaultWorkspace = resolveDefaultWorkspace({
		configured: typeof config?.defaultWorkspace === 'string' ? config.defaultWorkspace : '',
		cwd: process.cwd(),
		home: homedir(),
		dataDir,
		// 整个 ~/.dsh 都不能当工作目录（桌面启动器的 cwd 就是 profile 目录）。
		// 同时排除**真实** home 下的 `.dsh`：`DSH_HOME` 被改到别处时（测试、隔离实例），
		// dshHome() 不再覆盖桌面 profile 目录，那条路径仍可能被当成建议值。
		excludeRoots: [...new Set([dshHome(), join(homedir(), '.dsh')])],
	});
	// 兜底建议是 `~/works`：它可能还不存在，而 `project.workspace.update` 只接受
	// 已存在的目录。用户确认的就是这个子目录，所以在这里建出来（失败则不提供建议）。
	if (defaultWorkspace !== '' && !existsSync(defaultWorkspace)) {
		try { mkdirSync(defaultWorkspace, { recursive: true }); } catch { defaultWorkspace = ''; }
	}
	const registry = ProjectRegistry.load(dataDir, { defaultWorkspacePath: defaultWorkspace });
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

	// 索引补同步：账本里已有工作目录、但 registry 还是空的老数据（`project.activate`
	// 会用 registry 的值去开新 runtime）。只补空值，不覆盖已有设置。
	for (const runtime of runtimes.values()) {
		const ledgerPath = runtime.service.state.projects?.[runtime.id]?.workspacePath;
		const indexEntry = registry.list().find((project) => project.id === runtime.id);
		if (typeof ledgerPath !== 'string' || ledgerPath.trim() === '') continue;
		if (indexEntry !== undefined && typeof indexEntry.workspacePath === 'string' && indexEntry.workspacePath.trim() !== '') continue;
		try { registry.setWorkspace(runtime.id, ledgerPath.trim()); } catch { /* best-effort */ }
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
		defaultWorkspace,
		sessionIds: [...runtimes.values()]
			.flatMap((entry) => [
				entry.service.state.hostSessionId,
				...Object.values(entry.service.state.members ?? {}).map((member) => member?.sessionId),
			])
			.filter((id) => typeof id === 'string' && id !== ''),
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
	// 库模块（ledger / registry / host-agent / skill-provider / jobs）拿不到 diag，
	// 之前只能 console.warn——线上不可检索。这里把共享失败汇接到真正的 diag。
	const removeDiagSink = installDiagSink((row) => diag.append(row));
	// 启动探针：实机 `NOT_RESUMABLE` 的两种可能都指向「取不到服务」——
	// `agents.resume` 在 `sessionPersistence` 缺失时抛 "cannot resume: session
	// persistence is not configured"，`subagents.coldResume` 在同一个服务缺失时
	// 直接 notFound。这里把缺失的关键服务记成 `.fail`（发布默认级别可见），
	// 不必再靠猜。
	try {
		const required = ['sessions', 'sessionPersistence', 'subagents', 'agents', 'workspaceRegistry'];
		const missing = required.filter((name) => serviceOf(ctx, name) === undefined);
		const present = required.filter((name) => !missing.includes(name));
		diag.append({ ev: 'service.probe', present });
		if (missing.length > 0) diag.append({ ev: 'service.missing.fail', missing });
	} catch (probeError) {
		diag.append({ ev: 'service.probe.fail', message: probeError?.message ?? String(probeError) });
	}
	/**
	 * boot 之后真实读一次已知会话，把 persistence 的原始错误暴露出来。
	 *
	 * 实机 `NOT_RESUMABLE` 排查到最后只剩「persistence 读不出会话」这一种可能：
	 * 会话文件健康（87 事件、descriptor continuable）、目录键与文件名均符合后端规则、
	 * 工作区登记齐全。`persistence.stat` 是 `sessionQuery.observeSession` 的第一道
	 * 真实读取，成功/失败都能定性。
	 */
	const probePersistence = async (sessionIds = []) => {
		const persistence = serviceOf(ctx, 'sessionPersistence');
		if (persistence === undefined || typeof persistence.stat !== 'function') return;
		const probeId = (Array.isArray(sessionIds) ? sessionIds : []).find((id) => typeof id === 'string' && id !== '');
		if (probeId === undefined) return;
		try {
			const snapshot = await persistence.stat(probeId);
			diag.append({
				ev: 'persistence.stat.ok',
				sessionId: probeId,
				revision: snapshot?.revision ?? null,
				headerId: snapshot?.header?.id ?? null,
			});
		} catch (error) {
			diag.append({
				ev: 'persistence.stat.fail',
				sessionId: probeId,
				code: error?.code ?? error?.name ?? null,
				message: error?.message ?? String(error),
			});
		}
	};
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
		const webServer = serviceOf(ctx, 'webServer');
		if (webServer === undefined) return () => {};

		let booted = null;
		let bootError = null;
		// 卸载闸门：teardown 之后仍在飞的异步链（boot 续体、ensureParent、归档修复重试）
		// 不能继续写状态，否则会把句柄塞进已清空的表里、或在清理之后重建定时器。
		let disposed = false;
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
			const registry = serviceOf(ctx, 'workspaceRegistry');
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
			const sessions = serviceOf(ctx, 'sessions');
			const titleService = serviceOf(ctx, 'sessionTitle');
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
			// 归档项目（只读视图）的成员不会再干活：给它们 attach 只会每轮 boot 产生
			// 一对注定失败的 `workspace.attach.fail`（会话 cwd 是历史的插件数据目录）。
			// 这类项目交给「更换目录 + 重建会话」处理，不在这里制造噪音。
			const projectState = projectRuntime?.service?.state?.projects?.[projectRuntime?.id ?? ''];
			if (projectState?.status === 'archived') return;
			const workspace = await workspaceForProject(projectRuntime);
			if (workspace === null || workspace === undefined || typeof workspace.attachSession !== 'function') return;
			try {
				await workspace.attachSession(sessionId);
			} catch (error) {
				diag.append({ ev: 'workspace.attach.fail', sessionId, projectId: projectRuntime?.id ?? null, message: error?.message ?? String(error) });
				// cwd 不会随 attach 改变：这类失败只能靠重建会话修复，日志里直接给出动作，
				// 否则用户只看到一行警告，成员仍旧在插件数据目录里干活。
				console.warn('[ai-team] member session workspace attach failed:', error?.message ?? error, '— reseat the member (team member.reseat) to recreate its session in the project workspace');
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
				const session = serviceOf(ctx, 'sessions')?.get?.(sessionId);
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
			permissionPresets: serviceOf(ctx, 'permissionPresets'),
			sandboxPolicy: serviceOf(ctx, 'sandboxPolicy'),
		});
		const ready = access.ok
			? Promise.resolve().then(() => boot(diag, config))
				.then(async (value) => {
					booted = value;
					// 决定性探针：真实读一次已知会话。冷恢复失败的两种表现
					// （`agents.resume` 报 persistence 未配置、`coldResume` 报 notFound）
					// 都会在这里露出原始错误码——不再靠日志里那句
					// 「subagent X is unavailable」猜。
					await probePersistence(value.sessionIds);
					// 路由过期对账：账本重新折叠时，凡是「上次失败的路由 ≠ 当前配置」的成员
					// 都会带上 routeStale（老数据无需迁移脚本），但那条标记只有**新配置事件**
					// 才会触发唤醒计划，失败成员又被排除在自动唤醒之外。所以 boot 后补一次
					// 强制重建，让升级本身就把卡住的成员救回来。
					for (const runtime of value.runtimes.values()) {
						for (const member of Object.values(runtime.service.state.members ?? {})) {
							if (member.kind !== 'agent' || member.routeStale !== true) continue;
							if (member.status === 'retired') continue;
							const budget = activationBudget.take(member.id);
							if (budget.allowed !== true) {
								diag.append({ ev: 'member.route-reconcile.suppressed.fail', projectId: runtime.id, memberId: member.id, count: budget.count, limit: budget.limit });
								continue;
							}
							void activateMember({
								payload: {
									memberId: member.id,
									force: true,
									prompt: '模型/提供方已切换，会话按新路由重建。先读 tasks 与 thread 的当前状态，继续未完成的工作，不要重复已完成的事。',
								},
							}, runtime).then((result) => {
								diag.append({
									ev: result?.error === undefined ? 'member.route-reconciled' : 'member.route-reconcile.fail',
									projectId: runtime.id,
									memberId: member.id,
									sessionId: result?.member?.sessionId ?? null,
									error: result?.error ?? null,
								});
							}).catch((error) => {
								diag.append({ ev: 'member.route-reconcile.fail', projectId: runtime.id, memberId: member.id, message: error?.message ?? String(error) });
							});
						}
					}
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
						if (!pmoBusy.has(runtime.id)) {
							pmoBusy.add(runtime.id);
							void pmoTick(runtime).catch((error) => {
								diag.append({ ev: 'pmo.tick.fail', projectId: runtime.id, message: error?.message ?? String(error) });
								console.warn('[ai-team] PMO tick failed:', error?.message ?? error);
							}).finally(() => pmoBusy.delete(runtime.id));
						}
					}
					// 归档修复不能等 tick：workspaceRegistry 要等 sessionPersistence 与
					// 历史 bootstrap 完成才 active，boot 时通常还取不到。这里先试一次，
					// 再用一个短重试窗口（2s × 30）兜住就绪时间，不必等 60s 的 tick。
					void (async () => {
						for (let attempt = 0; attempt < 30; attempt += 1) {
							if (disposed) return;
							await repairArchivedHosts();
							if (hostRepaired || disposed) return;
							await new Promise((resolve) => { const timer = setTimeout(resolve, 2000); timer.unref?.(); });
						}
					})();
					if (disposed) return;
					if (pmoTimer === null) {
						pmoTimer = setInterval(() => {
							for (const runtime of booted?.runtimes?.values() ?? []) {
								if (pmoBusy.has(runtime.id)) {
									diag.append({ ev: 'pmo.tick.skip', projectId: runtime.id, reason: 'in-flight' });
									continue;
								}
								pmoBusy.add(runtime.id);
								void pmoTick(runtime).catch((error) => {
									diag.append({ ev: 'pmo.tick.fail', projectId: runtime.id, message: error?.message ?? String(error) });
									console.warn('[ai-team] PMO tick failed:', error?.message ?? error);
								}).finally(() => pmoBusy.delete(runtime.id));
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
					// diag 是唯一持久化通道：只打 console 等于线上不可诊断。
					diag.append({ ev: 'member.failure.record.fail', memberId: member.id, message: error?.message ?? String(error) });
					console.warn('[ai-team] member failure record failed:', member.id, error?.message ?? error);
					return next();
				}
				// 不可重试 ≠ 不可恢复：model_unavailable / context_overflow 声明的是
				// fallback（换路），此前一律 next() 让它们的 fallback 永远不可达。
				const fallbackCapable = failure.action === 'fallback' || failure.action === 'compact_or_fallback';
				if (!failure.retryable && !fallbackCapable) return next();
				// 用「本次请求」的连续失败数，而不是成员生命周期的 attempts：后者会让换路索引
				// 被跳过、重试预算被历史失败提前耗尽。
				const attempt = nextRequestAttempt(requestAttempts, member.sessionId);
				const decision = retryDecision(failure, member.config ?? {}, attempt);
				if (decision.action === 'fallback' && decision.patch !== undefined) {
					try {
						await failureRuntime.service.applySystemFallback(member.id, decision.patch, 'llm-fallback', failureRuntime.id);
					} catch (error) {
						diag.append({ ev: 'member.fallback.fail', memberId: member.id, message: error?.message ?? String(error) });
						console.warn('[ai-team] member fallback failed:', member.id, error?.message ?? error);
					}
				}
				if (decision.action !== 'retry') return next();
				return { kind: 'retry' };
			})
			: () => {};
		// 诊断：记录成员 agent 可见的工具名与 preset。规范签名（cordis_inspect_query
		// Event/agent/created 实测）：单参 payload = { agent, source, signal }，
		// 不是 (scopeCarrier, agent)。此前按双参取会把 payload 当 agent，agentId 恒 null。
		const offAgentCreated = typeof ctx.on === 'function'
			? ctx.on('agent/created', (payload) => {
				try {
					const agent = payload?.agent;
					const agentId = agent?.id ?? null;
					if (agentId === null) return;
					const runtime = runtimeForAgent(agentId);
					if (runtime === null) return; // 只关注成员会话
					const presets = serviceOf(ctx, 'agentPresets');
					const tools = agent?.ctx?.tools ?? presets?.serviceFor?.(agent, 'tools');
					const names = (tools?.definitions?.() ?? []).map((definition) => definition.name);
					let preset = null;
					try { preset = presets?.composedPreset?.(agent.ctx) ?? null; } catch { /* preset is optional */ }
					diag.append({
						ev: 'agent.created.probe',
						agentId,
						preset,
						toolCount: names.length,
						hasTeam: names.includes('team'),
						names: names.slice(0, 40),
					});
				} catch (error) {
					diag.append({ ev: 'agent.created.probe.fail', error: error?.message ?? String(error) });
				}
			})
			: () => {};
		const offSessionEvent = typeof ctx.on === 'function'
			? ctx.on('session/event', async (session, event) => {
				// 成员输出探针：直接观察成员回合产出了什么（判定「成员是否真的在
				// 工作 / 是否调用工具」的唯一插件侧可见通道）。
				try {
					if (booted !== null && event?.type === 'assistant/message' && runtimeForAgent(session?.id) !== null) {
						const content = event?.data?.message?.content ?? [];
						const text = (Array.isArray(content) ? content : [])
							.map((block) => (typeof block === 'string' ? block : block?.text ?? ``))
							.filter(Boolean)
							.join('\n');
						diag.append({
							ev: 'member.output.probe',
							sessionId: session?.id ?? null,
							chars: text.length,
							preview: text.slice(0, 240),
						});
					}
				} catch (probeError) {
					diag.append({ ev: 'member.output.probe.fail', error: probeError?.message ?? String(probeError) });
				}
				if (booted === null || event?.type !== 'turn/end') return;
				const eventRuntime = runtimeForAgent(session?.id);
				const member = eventRuntime === null ? undefined : Object.values(eventRuntime.service.state.members ?? {})
					.find((candidate) => candidate.sessionId === session?.id);
				if (member === undefined || eventRuntime === null) return;
				// The child Agent owns a persisted session, but its live events are
				// buffered by the JSONL writer until a session/flush checkpoint. Flush
				// every member turn boundary so restart/memory can replay the history.
				const sessions = serviceOf(ctx, 'sessions');
				try {
					await sessions?.flush?.(session);
				} catch (error) {
					const message = error?.message ?? String(error);
					// 回合结束时句柄可能已经关闭（turn/end 之后会话被回收）：这不是缺陷，
					// 记成 `.fail` 会让发布默认的 errors 级别日志看起来一直在出错。
					if (/closed handle/i.test(message)) {
						diag.append({ ev: 'session.flush.skipped', sessionId: session?.id ?? null, message });
					} else {
						diag.append({ ev: 'session.flush.fail', sessionId: session?.id ?? null, message });
						console.warn('[ai-team] member session flush failed:', message);
					}
				}
				// 回合结局必须全部可见：`blocked` 表示回合在发出模型请求前就被拒绝
				// （典型原因：会话或血缘祖先被归档），`error` 表示模型/工具链失败。
				// 旧实现只认 completed，这两种结局被静默丢弃，恢复链路永不触发。
				const endKind = event?.data?.reason?.kind ?? 'unknown';
				if (endKind !== 'completed') {
					diag.append({
						ev: 'member.turn.blocked',
						memberId: member.id,
						sessionId: session?.id ?? null,
						kind: endKind,
						reason: event?.data?.reason?.error?.message ?? null,
					});
					// blocked 最常见的原因是归档 gate：立刻复核一次血缘归档状态。
					if (endKind === 'blocked') void repairArchivedHosts();
					return;
				}
				if (member.lastFailure === undefined || member.lastFailure === null) return;
				try {
					await eventRuntime.service.recordMemberRecovery(member.id, member.attempts ?? 0, member.config ?? null, eventRuntime.id);
					broadcast(undefined, eventRuntime);
				} catch (error) {
					diag.append({ ev: 'member.recovery.fail', memberId: member.id, message: error?.message ?? String(error) });
					console.warn('[ai-team] member recovery record failed:', member.id, error?.message ?? error);
				}
			})
			: () => {};
		let llmFaultMode = null;
		const offLlmFault = process.env.DSH_AI_TEAM_TEST === '1'
			? installFaultAdapter(serviceOf(ctx, 'llm'), () => llmFaultMode)
			: () => {};
		let host = null;
		let hostPromise = null;
		const wakeKeys = new Map();
			// provider 探测状态去重：能力缺失/确认无 provider 只各记一次，避免每轮刷日志。
			let lastProviderState = '';
		// PMO tick 是 fire-and-forget：慢 tick（模型/IO）会被下一分钟的定时器再入，
		// 造成 autoAnswerDecisions/reconcileJobs 并发执行同一条账本。按 Project 去重。
		const pmoBusy = new Set();
		// 同一项目目录的 reconcile 互斥：PMO tick 与 skillopt_jobs 工具会同时收割同一批
		// job，两边都在「读 job 状态 → 写回」，并发时后到的一次判断会覆盖前一次的结果。
		const reconcileBusy = new Set();
		const reconcileWithLock = async (projectDir, options) => {
			const key = typeof projectDir === 'string' ? projectDir : '';
			if (key !== '' && reconcileBusy.has(key)) return false;
			if (key !== '') reconcileBusy.add(key);
			try {
				await reconcileJobs(options);
				return true;
			} finally {
				if (key !== '') reconcileBusy.delete(key);
			}
		};
		// 本次请求的连续失败计数（按成员会话、10 分钟窗口）。
		const requestAttempts = new Map();
		const activationTasks = new Map();
		// 自动重建预算：见 lib/runtime/activation-budget.js（issue #1 的 7 小时循环）。
		const activationBudget = createActivationBudget({
			limit: Number.isSafeInteger(config?.autoReseatLimitPer30Min) ? config.autoReseatLimitPer30Min : 6,
		});
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
			const plans = planWakes(projectRuntime.service.state, result, actor, { projectId: projectRuntime.id });
			if (plans.length === 0) return;
			// Window eviction: a key older than this horizon can no longer dedupe
			// a relevant event, so drop it instead of growing the Map forever.
			// 只淘汰**本项目**的键：`head` 是当前项目的账本水位，拿它去比较别的项目的
			// seq，会把水位较低的项目里刚产生的键全部删掉（那些键还没发挥去重作用）。
			const head = projectRuntime?.ledger?.head?.seq ?? 0;
			const projectSuffix = `:${projectRuntime.id}`;
			for (const [key, seq] of wakeKeys) {
				if (!key.endsWith(projectSuffix)) continue;
				if (Number.isSafeInteger(seq) && head - seq > 500) wakeKeys.delete(key);
			}
			const subagents = serviceOf(ctx, 'subagents');
			const sessions = serviceOf(ctx, 'sessions');
			const permissionPresets = serviceOf(ctx, 'permissionPresets');
			const sandboxPolicy = serviceOf(ctx, 'sandboxPolicy');
			if (subagents === undefined || sessions === undefined || permissionPresets === undefined || sandboxPolicy === undefined) return;
			const providers = probeProviderRegistration(subagents);
			if (blocksActivation(providers)) {
				if (lastProviderState !== 'empty') {
					lastProviderState = 'empty';
					diag.append({ ev: 'wake.no-provider', projectId: projectRuntime.id });
				}
				return;
			}
			if (providers === 'unknown' && lastProviderState !== 'unknown') {
				// 宿主（rc.2+）没有 list() 自省：能力缺失 ≠ 没有 provider，放行并留一条痕。
				lastProviderState = 'unknown';
				diag.append({ ev: 'subagents.introspect-missing' });
			}
			const parentInfo = await ensureParent();
			// A live member already carries the activation context (identity,
			// personality, skills). A wake is only the Task delta; re-sending the
			// whole activation prompt caused the duplicated blocks users saw.
			const wakePrompt = async (plan, member, options = {}) => describeWake(plan, projectRuntime.service.state, options);
			for (const plan of plans) {
				if (wakeKeys.has(plan.key)) continue;
				let member = projectRuntime.service.state.members?.[plan.memberId];
				if (member === undefined) continue;
				// 无工作目录的项目不 wake（与 activate 的 fail-closed 同一不变量）：
				// 冷恢复/直连唤醒都会在会话原 cwd 里干活，不该落到插件数据目录。
				// 必须在占用去重键**之前**判定：这些键多数不带时间桶，跳过时若已占用，
				// 同一事件（startup/thread/reflection）之后再也不会被重新规划。
				const projectWorkspacePath = projectWorkspace(projectRuntime, member);
				if (projectWorkspacePath === null || projectWorkspacePath.trim?.() === '') {
					diag?.append({ ev: 'wake.skip', projectId: projectRuntime.id, memberId: plan.memberId, reason: 'E_WORKSPACE_REQUIRED' });
					continue;
				}
				// Reserve before the async delivery: the HTTP result and the ledger
				// event both schedule the same plan, and only one may deliver it.
				wakeKeys.set(plan.key, result?.event?.seq ?? head);
				const cwd = projectWorkspacePath;
				try {
					// Idle default members have no Agent session yet. A wake must
					// activate them first; otherwise the first Human message is
					// silently dropped in a fresh Project.
					let messageId = null;
					// 路由过期（成员 provider/model 改过）：已存活会话的 provider 是创建时
					// 固定的，直接唤醒只会继续用旧路由——实机表现就是「模型换成 Qwen，
					// provider 还是 deepseek-official，一直报缺 DEEPSEEK_API_KEY」。
					// 重建一次会话，让新配置真正生效；上下文由 wakePrompt 带上。
					const routeStale = member.routeStale === true;
					if (routeStale) {
						diag?.append({ ev: 'wake.route-stale', projectId: projectRuntime.id, memberId: plan.memberId, reason: plan.reason });
					}
					if (member.sessionId === undefined || member.sessionId === null || routeStale) {
						const activationKey = `${projectRuntime.id}:${member.id}`;
						let activation = activationTasks.get(activationKey);
						if (activation === undefined) {
							// 占位必须在**同步**段完成：此前 `prompt: await wakePrompt(...)` 写在
							// 调用里，await 先让出执行权、单飞表还没登记，并发的两个计划会各自
							// 启动一次激活（两个子会话）。
							activation = (async () => activateMember({
								payload: {
									memberId: member.id,
									...(routeStale ? { force: true } : {}),
									prompt: await wakePrompt(plan, member, { includeThread: true }),
								},
							}, projectRuntime))();
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
							agents: serviceOf(ctx, 'agents'),
							agentPresets: serviceOf(ctx, 'agentPresets'),
							direct: false,
							parent: parentInfo.agent,
							provider: (serviceOf(ctx, 'subagents')?.list?.() ?? [])[0],
							preset: 'standard',
							cwd,
							trackHandle: (sessionId, handle) => resumedHandles.set(sessionId, handle),
						});
						const delivered = await runtime.wake(member, {
							// 冷路径（会话不在线）才附 Thread 尾巴：成员靠它续跑，不必从零回忆；
							// 热路径上下文已在会话里，附上去只是白烧 token。
							prompt: await wakePrompt(plan, member, { includeThread: sessions?.get?.(member.sessionId) === undefined }),
						});
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
					const causeChain = describeCauseChain(error);
					// 实机根因：成员会话的**写句柄没有释放**——`sessions.get()` 已取不到它，
					// 但 persistence 仍判定它「already owned by an active write handle」，
					// 于是冷恢复必然失败。这是 Harness 侧的句柄泄漏，插件只能重建。
					// 归类成单独事件：不再让这类必然失败每天刷上百条 `wake.fail`，
					// 但仍在 `full` 级别可见，且重建路径不变。
					diag.append({
						ev: classifyWakeFailure(causeChain),
						projectId: projectRuntime.id,
						memberId: plan.memberId,
						taskId: plan.taskId ?? null,
						reason: plan.reason,
						code: error?.code ?? null,
						message: error?.message ?? String(error),
						// 外层错误只写「subagent X is unavailable」，真实原因在 cause 里
						// （persistence 读不出会话 / descriptor 不可续 / 血缘校验失败）。
						// 不把它带出来，每次只能看到同一句无从下手的提示。
						cause: causeChain,
					});
					console.warn('[ai-team] wake failed:', plan.memberId, error?.code ?? error?.message ?? error);
					// 一次性迁移自愈：旧形态成员会话（历史上由 agents.create 创建、
					// 不在 subagent catalog）或重启后不可恢复的会话（NOT_RESUMABLE /
					// is unavailable）无法经父→子通道投递。识别该失败后自动以 subagent
					// 形态重建一次（重置会话），避免成员静默不再被唤醒。
					// 注意：member 是 try 块内变量，catch 里必须从 state 取成员。
					const targetMember = projectRuntime.service.state.members?.[plan.memberId];
					const failureText = `${error?.code ?? ''} ${error?.message ?? String(error)}`;
					// 探针（.fail 后缀以便 errors 级可见）：自愈为什么没触发。
					diag.append({
						ev: 'wake.catch.probe.fail',
						memberId: plan.memberId,
						reason: plan.reason,
						hasTarget: targetMember !== undefined && targetMember !== null,
						sessionIdType: typeof targetMember?.sessionId,
						failureText: failureText.slice(0, 160),
					});
					// 只按结构化错误码判定：对整段 message 做宽词匹配会把「sessions
					// service is unavailable」「task not found」这类瞬时/无关错误也算命中，
					// 进而 force reseat 丢掉成员会话上下文。
					const failureCode = String(error?.code ?? '').toUpperCase();
					const deadSessionPool = failureCode === 'E_SESSION_MISSING'
						|| failureCode === 'NOT_RESUMABLE'
						|| failureCode === 'ENOTFOUND';
					const legacySession = deadSessionPool
						&& typeof targetMember?.sessionId === 'string' && targetMember.sessionId !== '';
					diag.append({
						ev: 'wake.catch.probe.fail',
						stage: 'decision',
						memberId: plan.memberId,
						legacySession,
						hasActivateMember: typeof activateMember === 'function',
					});
					if (legacySession) {
						// 自动重建必须限额：issue #1 的「7 小时 / 200+ 子代理」就是这条路径
						// 无上限地循环。超额后不再重建，成员保持 failed 并留可见诊断。
						const budget = activationBudget.take(plan.memberId);
						if (budget.allowed !== true) {
							diag.append({
								ev: 'member.reseat.suppressed.fail',
								projectId: projectRuntime.id,
								memberId: plan.memberId,
								reason: plan.reason,
								count: budget.count,
								limit: budget.limit,
								windowMs: budget.windowMs,
							});
							return;
						}
						try {
							const reseated = await activateMember({
								payload: {
									memberId: plan.memberId,
									force: true,
									// 重建 = 上下文清零：把当前 Task 与 Thread 尾巴直接递到手上，
									// 不让成员靠猜测恢复现场（数据来自账本投影，不另存一份）。
									prompt: `会话已重建（原会话不可恢复）。先读 tasks/thread 当前状态，继续推进；不要重复已完成的工作。${describeTaskContext(projectRuntime.service.state, plan.taskId, { includeThread: true })}`,
								},
							}, projectRuntime);
							diag.append({
								ev: 'member.autoreseat',
								projectId: projectRuntime.id,
								memberId: plan.memberId,
								oldSessionId: targetMember.sessionId,
								newSessionId: reseated?.sessionId ?? null,
								ok: reseated?.error === undefined,
								error: reseated?.error ?? null,
							});
						} catch (reseatError) {
							diag.append({
								ev: 'member.autoreseat.fail',
								projectId: projectRuntime.id,
								memberId: plan.memberId,
								message: reseatError?.message ?? String(reseatError),
							});
						}
					}
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
			// 归档修复重试点：boot 时 workspaceRegistry 往往还没 active，等 tick
			// （60s 后）再试一次；修好即置位，之后每个 tick 直接返回。
			await repairArchivedHosts();
			const state = projectRuntime.service.state;
			// job 收割先于 pmoAuto 门：Human 启动的优化 job 与 PMO 派发无关，
			// PMO 自动关闭时也必须收敛（否则 job 永远停在 generating）。
			// 两阶段异步优化 job 收割：与任务派发无关，放在停止门之前——
			// Human 启动的 job 必须在任意运行态下收敛（生成/评审/落盘）。
			let reconciled = true;
			try {
				reconciled = await reconcileWithLock(projectRuntime.dir, {
					ctx,
					// job 归属项目数据目录（与 skillopt_optimize 写入处一致）：
					// 与工作区/激活项目无关，保证任意 tick 都能找到待收割 job。
					projectDir: projectRuntime.dir,
					deps: {
						now: () => Date.now(),
						provider: (serviceOf(ctx, 'subagents')?.list?.() ?? [])[0],
						// parent 惰性解析：仅启动 judge 子代理时需要；generating 阶段
						// 不依赖 agents 服务，避免 tick 阶段服务不可用时整块失败。
						ensureParent: () => ensureParent(),
						votes: config.skilloptJudgeVotes ?? 3,
						startChild: async (label, spec) => {
							// 必须走 serviceOf：这里不在 activateMember/wakeFromResult 的
							// 词法作用域内，裸写 subagents 会在判官轮抛 ReferenceError。
							const child = await serviceOf(ctx, 'subagents').startActivation({ ...spec, label });
							return { childId: child.childId, outputStart: child.outputStart ?? null };
						},
						readText: (file) => readFileSync(file, 'utf8'),
						writeText: (file, next) => writeFileSync(file, next, 'utf8'),
						score: (value) => scoreSkillRubric(value, { measured: false }),
						appendResult: makeResultAppender({ projectDir: projectRuntime.dir }),
						vcs: await makeVcs({ shell: lazyShellService(ctx), projectDir: projectRuntime.dir }),
						diag: (row) => diag.append(row),
					},
				});
			} catch (error) {
				diag.append({ ev: 'skillopt.job.tick.fail', message: error?.message ?? String(error) });
			}
			if (reconciled === false) diag.append({ ev: 'skillopt.reconcile.skip', projectId: projectRuntime.id, reason: 'in-flight' });
			// 门禁必须在 await 之后重新取：reconcileJobs 可能耗时数秒，期间 Human
			// 可能已经停用 PMO / 归档 / 停止项目，用 await 之前的快照会继续写账本。
			const project = projectRuntime.service.state.projects?.[projectRuntime.id];
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
			const llm = serviceOf(ctx, 'llm');
			if (llm?.stream === undefined) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'llm service is unavailable' }, status: 503 };
			}
			const selection = member.config?.provider && member.config?.model
				? { provider: member.config.provider, model: member.config.model }
				: serviceOf(ctx, 'agentDefaultModel')?.currentSelection?.();
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

		const skillsService = serviceOf(ctx, 'skills');
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
		const tools = serviceOf(ctx, 'tools');
		let disposeSkillOpt = () => {};
		try {
			// shell 惰性代理：注入时机早于 shell 服务就绪时，注册仍必须完成——
			// 每次调用现取，避免「boot 时 shell 未就绪 → 整条技能链静默跳过」。
			const shellProxy = lazyShellService(ctx);
			if (!tools?.register) {
				diag.append({ ev: 'skillopt.skip.fail', hasToolsRegister: false, hasShell: Boolean(serviceOf(ctx, 'shell')) });
				console.warn('[ai-team] SkillOpt tools not registered: no tool registry');
			}
			if (tools?.register) {
				// Darwin validation gate（对齐 darwin-skill v2.1）：adopt 之前必须
				// 通过 paired 独立 judge 的多数决；绝对 rubric 分只做 triage。
				const engineScript = fileURLToPath(new URL('./lib/vendor/skillopt/scripts/sleep.py', import.meta.url));
				const readPair = makeReadPair({ shell: shellProxy, engineScript, diag });
				const judge = makeJudge({
					subagents: serviceOf(ctx, 'subagents'),
					// 惰性解析：ensureParent 在 apply 之后才定义（const TDZ），
					// judge 只在 adopt 时调用，此处不能立即取值。
					ensureParent: () => ensureParent(),
					providerName: () => (serviceOf(ctx, 'subagents')?.list?.() ?? [])[0],
					votes: config.skilloptJudgeVotes ?? 3,
					diag,
				});
				const adoptGate = createAdoptGate({
					readPair,
					// 两阶段异步模式：工具 execute 内无法等待子代理，判据改为
					// results.tsv 中该 skill 已存在 paired keep 记录（同步可查）。
					// results.tsv 的写入根是插件数据目录（job.project = runtime.dir），而
					// adopt 门拿到的是模型传入的 args.project（通常是工作区）。只查后者的
					// 话，keep 记录永远找不到、adopt 恒被拒——这里把两个根都查。
					hasKeepRecord: async ({ projectDir, skillPath, candidate }) => {
						const roots = new Set();
						if (typeof projectDir === 'string' && projectDir !== '') roots.add(projectDir);
						for (const runtime of booted?.runtimes?.values() ?? []) {
							if (typeof runtime?.dir === 'string' && runtime.dir !== '') roots.add(runtime.dir);
						}
						for (const root of roots) {
							if (hasPairedKeepRecord(root, skillPath, candidate)) return true;
						}
						diag.append({ ev: 'skillopt.adoptgate.norecord.fail', projectDir: projectDir ?? null, skillPath: skillPath ?? null, roots: roots.size });
						return false;
					},
					diag: (line, extra) => diag.append({
						ev: extra?.ev ?? 'skillopt.adoptgate',
						message: line,
						...(extra?.project === undefined ? {} : { project: extra.project }),
					}),
				});
				// 授权门：这批工具是全局注册的，但 adopt/schedule 会改 live 文件与系统
				// cron。只允许 Team 成员与 Human 面对的根会话；一次性子代理一律拒绝。
				const skilloptCallerAllowed = (exec) => {
					const agentId = exec?.agent?.id;
					if (typeof agentId !== 'string' || agentId === '') return false;
					if (runtimeForAgent(agentId) !== null) return true;
					return exec?.agent?.session?.header?.origin !== 'subagent';
				};
				const guardedTools = wrapToolsWithSkilloptAccess(tools, skilloptCallerAllowed);
				// Backend/timeout come from the plugin Config (patch layer), so an
				// operator can move the skillopt_* tools off the safe mock default.
				disposeSkillOpt = applySkillOpt({
					tools: wrapToolsWithAdoptGate(guardedTools, adoptGate),
					shell: shellProxy,
					logger: console,
				}, {
					backend: config.skilloptBackend ?? 'mock',
					project: process.cwd(),
					timeoutMs: config.skilloptTimeoutMs ?? 120_000,
				}) ?? (() => {});
				// 9 维 rubric（triage）与独立 judge（keep/revert）作为新工具暴露。
				const rubricTool = guardedTools.register({
					name: 'skillopt_rubric',
					description: 'Score a SKILL.md against the 9-dimension Darwin rubric (triage only — absolute scores must not be used for keep/revert).',
					parameters: {
						project: { type: 'string', description: 'Project directory (defaults to cwd)' },
						skillPath: { type: 'string', description: 'Path to SKILL.md to score' },
						dim8: { type: 'number', description: 'Measured effect score 1-10 (omit for dry-run)' },
						measured: { type: 'boolean', description: 'Set when dim8 came from a real prompt run' },
					},
					// DSH 工具输出协议：render 必须返回 content 数组（与 vendored 一致）。
					output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
					async execute(args) {
						const project = typeof args?.project === 'string' && args.project !== '' ? args.project : process.cwd();
						const skillPath = typeof args?.skillPath === 'string' && args.skillPath !== ''
							? args.skillPath
							: join(project, 'SKILL.md');
						if (!existsSync(skillPath)) return `[skillopt rubric] SKILL.md not found: ${skillPath}`;
						const result = scoreSkillRubric(readFileSync(skillPath, 'utf8'), {
							dim8: typeof args?.dim8 === 'number' ? args.dim8 : undefined,
							measured: args?.measured === true,
						});
						diag.append({ ev: 'skillopt.rubric', project, skillPath, total: result.total, measured: result.evaluated });
						return formatRubric(result);
					},
				});
				const judgeTool = guardedTools.register({
					name: 'skillopt_judge',
					description: 'Paired independent-judge verdict (N odd votes, majority) for before/after SKILL.md — the authoritative keep/revert signal.',
					parameters: {
						project: { type: 'string', description: 'Project directory' },
						beforePath: { type: 'string', description: 'Baseline file path (default: current live SKILL.md)' },
						afterPath: { type: 'string', description: 'Candidate file path (default: latest staged proposal)' },
					},
					// DSH 工具输出协议：render 必须返回 content 数组（与 vendored 一致）。
					output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
					async execute(args) {
						const project = typeof args?.project === 'string' && args.project !== '' ? args.project : process.cwd();
						let pair;
						try {
							pair = await readPair(project);
						} catch (error) {
							return `[skillopt judge] cannot read pair: ${error?.message ?? error}`;
						}
						const before = typeof args?.beforePath === 'string' && existsSync(args.beforePath) ? readFileSync(args.beforePath, 'utf8') : pair.before;
						const after = typeof args?.afterPath === 'string' && existsSync(args.afterPath) ? readFileSync(args.afterPath, 'utf8') : pair.after;
						const result = await judge({ before, after, projectDir: project });
						const lines = result.votes.map((vote) => `  judge${vote.index}: ${vote.vote ?? 'invalid'} (margin ${vote.margin ?? '-'}) ${vote.reason}`);
						return [
							`[skillopt judge] verdict=${result.verdict} better=${result.better} worse=${result.worse} tie=${result.ties} valid=${result.valid}`,
							...lines,
							result.errors.length > 0 ? `  errors: ${result.errors.join('; ')}` : '',
						].filter(Boolean).join('\n');
					},
				});
				// Darwin Phase 2：自动 hill-climbing（诊断→生成→写入→judge→keep/revert）。
				// 同一轮只改一个维度，版本化走干净 git 仓库，否则 .bak 备份。
				// 两阶段异步：工具只启动生成子代理并写 job，收割由 PMO tick 完成
				// （工具 execute 内无法同步等待一次性子代理——实测 result 永不 settle）。
				const optimizeTool = guardedTools.register({
					name: 'skillopt_optimize',
					description: 'Start a Darwin hill-climbing job for one SKILL.md (diagnose, generate candidate, paired judge, keep/revert). The PMO tick harvests it; poll skillopt_jobs for the outcome.',
					parameters: {
						project: { type: 'string', description: 'Project directory' },
						skillPath: { type: 'string', description: 'Path to SKILL.md to optimize' },
						candidate: { type: 'string', description: 'Full improved SKILL.md text. Omit to get the diagnosis + rewrite request first; pass it to start the reviewer round.' },
					},
					output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
					async execute(args) {
						const project = typeof args?.project === 'string' && args.project !== '' ? args.project : process.cwd();
						const skillPath = typeof args?.skillPath === 'string' && args.skillPath !== '' ? args.skillPath : join(project, 'SKILL.md');
						if (!existsSync(skillPath)) return `[skillopt optimize] SKILL.md not found: ${skillPath}`;
						const text0 = readFileSync(skillPath, 'utf8');
						const rubric = scoreSkillRubric(text0, { measured: false });
						const dimension = weakestDimension(rubric);
						if (dimension === null) return '[skillopt optimize] rubric produced no scorable dimension';
						const candidate = typeof args?.candidate === 'string' ? args.candidate : '';
						if (candidate.trim() === '') {
							// 阶段一：只给诊断与改写要求（候选由调用方 agent 生成——它才是 LLM；
							// 插件不再尝试读一次性子代理的输出）。
							// 复用 weakestDimension（已排除 dim8：实测表现不可静态改写）。
							const weakest = dimension;
							return [
								`[skillopt optimize] diagnosis: total=${rubric.total} weakest=dim${weakest.id} ${weakest.name} (${weakest.score}/10 ×${weakest.weight})`,
								'  next: rewrite SKILL.md addressing ONLY that dimension (keep failure branches/checkpoints/counterexamples, stay under 150% size, no soft wording), then call skillopt_optimize again with the full text as `candidate`. A dedicated reviewer member will blind-compare the two versions.',
							].join('\n');
						}
						const validation = validateCandidate({ before: text0, after: candidate });
						if (!validation.ok) return `[skillopt optimize] candidate rejected: ${validation.reason}`;
						const runtime = currentRuntime();
						if (runtime === null) return '[skillopt optimize] no active project runtime';
						const jobId = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
						const actor = { kind: 'human', memberId: HUMAN_ID };
						// 评审前先刷新评审官会话：subagent provider 不提供 continuable
						// 会话，旧会话在重启/回合结束后即不可投递（NOT_RESUMABLE）。
						// 这一步让评审投递落在**新鲜会话**上，闭环才成立。
						try {
							const reviewer = Object.values(runtime.service.state.members ?? {})
								.find((member) => member.kind === 'agent' && (member.role === '评审' || member.name === '评审官'));
							if (reviewer !== undefined) {
								const refreshed = await activateMember({
									payload: {
										memberId: reviewer.id,
										force: true,
										prompt: '会话已刷新（评审官）。职责不变：只做 A/B 盲评，把一行 JSON 结论用 team 工具发到评审卡。',
									},
								}, runtime);
								diag.append({ ev: refreshed.error === undefined ? 'skillopt.reviewer.refreshed' : 'skillopt.reviewer.refresh.fail', projectId: runtime.id, memberId: reviewer.id, sessionId: refreshed.sessionId ?? null, message: refreshed.error?.message ?? null });
							}
						} catch (error) {
							diag.append({ ev: 'skillopt.reviewer.refresh.fail', projectId: runtime.id, message: error?.message ?? String(error) });
						}
						const jobRecord = {
							id: jobId,
							state: 'judging',
							project: runtime.dir,
							skillPath,
							skillName: skillPath.split(/[\\/]/).slice(-2, -1)[0] ?? skillPath,
							dimension: `dim${dimension.id} ` + dimension.name,
							before: text0,
							candidate,
							createdAt: Date.now(),
						};
						const started = await startReview({
							service: runtime.service,
							projectRuntime: runtime,
							job: jobRecord,
							actor,
							votes: config.skilloptJudgeVotes ?? 3,
							// 卡片一创建就把 job 落盘：进程若在投递评审请求期间崩溃，下一轮仍能
							// 从 job 里读到卡 id，超时终态会把它收口，而不是留下孤儿卡。
							onCard: async (reviewTaskId) => {
								writeJob(runtime.dir, { ...jobRecord, reviewTaskId, reviewOrders: [], cardCreatedAt: Date.now() });
							},
						});
						writeJob(runtime.dir, {
							...jobRecord,
							reviewTaskId: started.reviewTaskId,
							reviewerId: started.reviewerId,
							reviewOrders: started.orders,
						});
						diag.append({ ev: 'skillopt.job.started', jobId, project: runtime.dir, skillPath, dimension: `dim${dimension.id}`, reviewTaskId: started.reviewTaskId, votes: started.orders.length });
						return [
							`[skillopt optimize] reviewing job=${jobId} target=dim${dimension.id} ${dimension.name} baseline=${rubric.total}`,
							`  reviewer=${REVIEWER_NAME} card=${started.reviewTaskId} votes=${started.orders.length} (blind A/B, odd majority)`,
							'  call skillopt_jobs to collect the verdict when the reviewer answers.',
						].join('\n');
					},
				});
				const jobsTool = guardedTools.register({
					name: 'skillopt_jobs',
					description: 'List optimize jobs (state, target dimension, verdict) for a project.',
					parameters: { project: { type: 'string', description: 'Project directory' } },
					output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
					async execute(args) {
						// 主动收割：工具调用即驱动（不依赖 PMO 定时器——实测宿主热重载/
						// 重启后 setInterval 可能不重建，工具驱动保证链路可用）。
						const explicit = typeof args?.project === 'string' && args.project !== '' ? args.project : null;
						// job 归属项目数据目录（runtime.dir），显式路径只作为额外搜索根。
					const runtimeRoots = [...(booted?.runtimes?.values?.() ?? [])].map((runtime) => runtime.dir).filter((root) => typeof root === 'string' && root !== '');
					const jobRoots = [...new Set([...runtimeRoots, ...(explicit !== null ? [explicit] : [])])];
						for (const jobRoot of jobRoots) {
							if (typeof jobRoot !== 'string' || jobRoot === '') continue;
							let reconciledHere = true;
							try {
								reconciledHere = await reconcileWithLock(jobRoot, {
									ctx,
									projectDir: jobRoot,
									deps: {
										now: () => Date.now(),
										provider: (serviceOf(ctx, 'subagents')?.list?.() ?? [])[0],
										ensureParent: () => ensureParent(),
										votes: config.skilloptJudgeVotes ?? 3,
										startChild: async (label, spec) => {
											const child = await serviceOf(ctx, 'subagents').startActivation({ ...spec, label });
											return { childId: child.childId, outputStart: child.outputStart ?? null };
										},
										readText: (file) => readFileSync(file, 'utf8'),
										writeText: (file, next) => writeFileSync(file, next, 'utf8'),
										score: (value) => scoreSkillRubric(value, { measured: false }),
										appendResult: makeResultAppender({ projectDir: jobRoot }),
										vcs: await makeVcs({ shell: lazyShellService(ctx), projectDir: jobRoot }),
										diag: (row) => diag.append(row),
									},
								});
							} catch (error) {
								diag.append({ ev: 'skillopt.jobs.step.fail', message: error?.message ?? String(error), jobRoot });
							}
							if (reconciledHere === false) {
								diag.append({ ev: 'skillopt.reconcile.skip', projectId: jobRoot, reason: 'in-flight' });
							}
						}
						const roots = jobRoots.length > 0 ? jobRoots : [process.cwd()];
						const jobs = roots.flatMap((jobRoot) => listJobs(jobRoot));
						// judging 状态的 job：从评审卡收票（账本通道），不走子代理 reconcile。
						const actor = { kind: 'human', memberId: HUMAN_ID };
						// 评审卡收口：成功、超时、冲突三条终态都要关。否则卡保持 pending 进入
						// PMO 的 active 集合，被 heartbeat/stall/escalate 反复唤醒评审官。
						const closeReviewCard = async (runtime, taskId, reason) => {
							try {
								const card = runtime.service.state.tasks?.[taskId];
								if (card === undefined || card.status === 'done' || card.status === 'cancelled' || card.tombstone === true) return;
								await runtime.service.dispatch({
									type: 'task.cancel',
									payload: { taskId, expectedRevision: card.revision, reason },
									actor,
									projectId: runtime.id,
								});
							} catch (error) {
								diag.append({ ev: 'skillopt.review.card.close.fail', taskId, message: error?.message ?? String(error) });
							}
						};
						// failed 终态成行（与 job-runner.recordFail 同 10 列制式；257-#60②）。
						const appendFailResult = async (jobDir, job, reason) => {
							await makeResultAppender({ projectDir: jobDir })([
								new Date().toISOString().slice(0, 19),
								'-',
								job.skillName ?? '-',
								'-',
								'-',
								'failed',
								job.dimension ?? '-',
								String(reason).replace(/[\t\r\n]+/g, ' '),
								'paired',
								typeof job.candidate === 'string' ? sha12(job.candidate) : '-',
							].join('\t'));
						};
						for (const job of jobs) {
							if (job.state !== 'judging' || typeof job.reviewTaskId !== 'string') continue;
							// job.project 是绝对路径；命名空间迁移后它会指向旧目录，精确比较会让
							// 这些 judging job 永久跳过（既收不到票也不再超时）。目录相同优先，
							// 否则按项目 id（目录名）匹配。
							const allRuntimes = [...(booted?.runtimes?.values?.() ?? [])];
							const dirName = (value) => String(value ?? '').split(/[\\\\/]/).filter(Boolean).pop() ?? '';
							const runtime = allRuntimes.find((entry) => entry.dir === job.project)
								?? allRuntimes.find((entry) => entry.id === dirName(job.project));
							if (runtime === undefined) continue;
							const collected = collectReview({ service: runtime.service, job });
							const expected = collected.expected ?? job.reviewOrders?.length ?? 3;
							// 与 decideByMajority 的最少有效票契约一致：等「多数」而不是「全票」。
							// 等全票时，评审官漏回一票就要空等 30 分钟再判 failed。
							const minValid = Math.max(1, Math.ceil(expected / 2));
							if (collected.votes.length < minValid || collected.decision?.verdict === 'inconclusive') {
								// 评审通道被 reconcileJobs 明确排除，没有 TTL 兜底：评审官不回帖
								// 时 job 会永久停在 judging、评审卡永久 active。这里补超时终态。
								if (isJobExpired(job, Date.now(), REVIEW_JOB_TTL_MS)) {
									const timeoutReason = `review timed out after ${Math.round(REVIEW_JOB_TTL_MS / 60000)}min (${collected.votes.length}/${expected} votes)`;
									writeJob(job.project, {
										...job,
										state: 'failed',
										error: timeoutReason,
										updatedAt: Date.now(),
									});
									await appendFailResult(job.project, job, timeoutReason);
									// 超时也要收口：否则这张卡永久 pending，PMO 会一直唤醒评审官。
									await closeReviewCard(runtime, job.reviewTaskId, 'blind review timed out');
									diag.append({ ev: 'skillopt.job.timeout', jobId: job.id, got: collected.votes.length, expected });
									continue;
								}
								diag.append({ ev: 'skillopt.review.waiting', jobId: job.id, got: collected.votes.length, expected });
								continue;
							}
							const kept = collected.decision.verdict === 'keep';
							const jobDir = job.project;
							// 落盘前先确认 live 仍是评审时的基线：评审期间的人工修改不能被
							// 一次 revert 用陈旧快照覆盖（反之亦然）。
							let liveText = null;
							try { liveText = existsSync(job.skillPath) ? readFileSync(job.skillPath, 'utf8') : null; } catch { liveText = null; }
							// live 与候选一致 = 上一次已经落过盘、只差收尾（进程在「改 live」与
							// 「写 results/终态」之间崩溃）。这不是 conflict：按 conflict 处理会把
							// 一次成功的 keep 在下一轮判成失败。
							const liveSha = liveText === null ? null : sha12(liveText);
							const candidateSha = typeof job.candidate === 'string' ? sha12(job.candidate) : null;
							const alreadyApplied = liveSha !== null && candidateSha !== null && liveSha === candidateSha;
							if (!alreadyApplied && liveText !== null && typeof job.before === 'string' && liveSha !== sha12(job.before)) {
								const conflictReason = 'live SKILL.md changed during review (conflict)';
								writeJob(jobDir, { ...job, state: 'failed', error: conflictReason, updatedAt: Date.now() });
								await appendFailResult(jobDir, job, conflictReason);
								await closeReviewCard(runtime, job.reviewTaskId, 'blind review aborted: live file changed');
								diag.append({ ev: 'skillopt.job.conflict', jobId: job.id, skillPath: job.skillPath });
								continue;
							}
							if (alreadyApplied) diag.append({ ev: 'skillopt.job.resume', jobId: job.id, reason: 'candidate already applied' });
							let backupPath = null;
							try {
								backupPath = backupLive({ projectDir: jobDir, skillPath: job.skillPath, text: liveText ?? job.before ?? '' });
							} catch (error) {
								diag.append({ ev: 'skillopt.job.backup.fail', jobId: job.id, message: error?.message ?? String(error) });
							}
							// 先把决定落成 job 记录：进程若在「改 live」之后崩溃，下一次仍能看出
							// 这次要收尾成什么（配合上面的 alreadyApplied 幂等判定）。
							writeJob(jobDir, { ...job, decision: collected.decision, backup: backupPath ?? job.backup ?? null, applyingSince: Date.now() });
							// keep → 落盘候选；revert → 恢复基线（评审卡收票后才动文件）。
							if (!alreadyApplied) applyLiveAtomically(job.skillPath, kept ? job.candidate : job.before);
							const beforeScore = scoreSkillRubric(job.before, { measured: false })?.total ?? null;
							const afterScore = scoreSkillRubric(kept ? job.candidate : job.before, { measured: false })?.total ?? null;
							const appender = makeResultAppender({ projectDir: jobDir });
							await appender([
								new Date().toISOString().slice(0, 19),
								'-',
								job.skillName,
								String(beforeScore ?? '-'),
								String(afterScore ?? '-'),
								kept ? 'keep' : 'revert',
								job.dimension ?? '-',
								`${collected.decision.better}-${collected.decision.worse} ${collected.decision.verdict}` ,
								'paired',
								sha12(job.candidate),
							].join('\t'));
							writeJob(jobDir, { ...job, state: 'done', decision: collected.decision, backup: backupPath ?? job.backup ?? null, updatedAt: Date.now() });
							// 评审卡必须收口：否则它保持 pending 进入 PMO 的 active 集合，
							// 会被 heartbeat/stall/escalate 反复唤醒评审官（每 job 永久留一张卡）。
							await closeReviewCard(runtime, job.reviewTaskId, `blind review collected: ${collected.decision.verdict}`);
							diag.append({ ev: 'skillopt.job.done', jobId: job.id, verdict: collected.decision.verdict, better: collected.decision.better, worse: collected.decision.worse, kept, source: 'reviewer-card' });
						}
						if (jobs.length === 0) return '[skillopt jobs] none';
						// 重新读一遍再打印：本次调用刚把某些 job 判成 keep/revert/done，
						// 用调用前的快照会显示成 judging 且没有 verdict，用户看到的与实际相反。
						const after = roots.flatMap((jobRoot) => listJobs(jobRoot));
						const view = after.length > 0 ? after : jobs;
						return ['[skillopt jobs]', ...view.map((job) => `  ${job.id} ${job.state} ${job.dimension ?? '-'}${job.decision ? ` verdict=${job.decision.verdict} (${job.decision.better}-${job.decision.worse})` : ''}${job.error ? ` error=${job.error}` : ''}`)].join('\n');
					},
				});
				// 先保存 applySkillOpt 的真实 disposer：直接把 disposeSkillOpt 指向
				// disposeExtra 会形成自引用递归（teardown 时栈溢出且原始 disposer 永不可达）。
				const innerSkillOptDispose = disposeSkillOpt;
				const disposeExtra = () => {
					try { innerSkillOptDispose?.(); } catch { /* already disposed */ }
					try { rubricTool?.(); } catch { /* noop */ }
					try { judgeTool?.(); } catch { /* noop */ }
					try { optimizeTool?.(); } catch { /* noop */ }
					try { jobsTool?.(); } catch { /* noop */ }
				};
				disposeSkillOpt = disposeExtra;
				diag.append({ ev: 'skillopt.registered', backend: config.skilloptBackend ?? 'mock', timeoutMs: config.skilloptTimeoutMs ?? 120_000, adoptGate: true, judgeVotes: config.skilloptJudgeVotes ?? 3, optimize: true });
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
					// 可见性判定不能按「请求者是已知成员」来算：
					//   * 成员的首个 model step 发生在 bindMemberSession 写入 sessionId 之前
					//     （activate() 返回后才写），此时 runtimeForAgent(请求者) 为 null，
					//     实测首个 header 43 个工具、第二个起 44 个，差集恰好是 team；
					//   * owner/宿主永远不是成员，按此判定它也拿不到 team。
					// 因此只要本进程内 AI Team runtime 已 boot，团队板工具即对 agent 可见。
					when: () => booted !== null,
				})
				: () => {};
		} catch (error) {
			diag.append({ ev: 'team.tool.fail', message: error?.message ?? String(error) });
			console.warn('[ai-team] team tool registration failed:', error?.message ?? error);
		}
		// 成员 shell 风险守卫：实机事故是「成员写 serve.ps1 + Start-Process -WindowStyle
		// Hidden」被杀软报毒。默认只记录（warn），配置 shellGuard='block' 才拒绝。
		let disposeShellGuard = () => {};
		try {
			const memberSessions = () => {
				const ids = new Set();
				for (const runtime of booted?.runtimes?.values() ?? []) {
					for (const member of Object.values(runtime.service.state.members ?? {})) {
						if (typeof member?.sessionId === 'string' && member.sessionId !== '') ids.add(member.sessionId);
					}
				}
				return ids;
			};
			disposeShellGuard = registerShellGuard({
				tools: tools ?? serviceOf(ctx, 'tools'),
				memberSessions,
				diag,
				mode: config.shellGuard ?? 'warn',
			});
			diag.append({ ev: 'shell.guard', mode: config.shellGuard ?? 'warn' });
		} catch (error) {
			diag.append({ ev: 'shell.guard.fail', message: error?.message ?? String(error) });
		}

		// 历史归档修复：成员是 host 的子会话，`archived-session-gate` 会沿 subagent
		// 血缘上溯，父会话被归档即拒绝整条血缘 —— 回合以 {kind:'blocked'} 结束且不发
		// 模型请求（实测 453 blocked / 0 completed）。旧版本把 host 归档用于隐藏会话。
		let hostRepaired = false;
		let hostRepairWarned = false;
		const repairArchivedHosts = async () => {
			if (hostRepaired) return;
			try {
				const registry = serviceOf(ctx, 'workspaceRegistry');
				const repaired = await repairHostSessions({
					runtimes: booted?.runtimes?.values() ?? [],
					sessions: serviceOf(ctx, 'sessions'),
					workspaceRegistry: registry,
					diag,
				});
				// null = workspaceRegistry 尚未 active（它要等 sessionPersistence 与
				// 历史 bootstrap）。保持未修复状态，交给下一次 tick/ensureParent 重试；
				// 否则一次早跑就永久放弃，正是上一版静默失效的原因。
				if (repaired === null) {
					if (!hostRepairWarned) {
						hostRepairWarned = true;
						let keys = [];
						try { keys = registry === null || registry === undefined ? [] : Object.keys(registry).slice(0, 8); } catch { keys = ['<unreadable>']; }
						diag.append({
							ev: 'host.repair.deferred.fail',
							reason: 'workspaceRegistry not ready',
							registryType: typeof registry,
							hasUnarchive: typeof registry?.unarchiveSession,
							keys,
						});
					}
					return;
				}
				hostRepaired = true;
				// 成功行必须留在 errors 级别：否则「归档修复有没有跑过」永远无法判定
				// （只有 boot 瞬间那一行 deferred.fail 可见，见 lib/diaglog.js 白名单）。
				diag.append({
					ev: 'host.repair.ok',
					archived: Array.isArray(repaired) ? repaired.length : 0,
					sessionIds: Array.isArray(repaired) ? repaired.slice(0, 5) : [],
				});
			} catch (error) {
				hostRepaired = true;
				diag.append({ ev: 'host.unarchive.sweep.fail', error: error?.message ?? String(error) });
			}
		};
		const ensureParent = async () => {
			if (host !== null) return host;
			await repairArchivedHosts();
			if (hostPromise === null) {
				const existingHost = [...(booted?.runtimes?.values() ?? [])]
					.map((runtime) => runtime.service.state.hostSessionId)
					.find((value) => value !== undefined && value !== null);
				// Host 会话的 cwd 必须是**项目工作区**，不能是插件数据目录：成员会话是它的
				// 子会话，会继承这个 cwd，于是 workspace.attachSession 报
				// "its cwd resolves to <…>/ai-team/<profile>" 而被拒，成员实际在数据目录里干活。
				// 取当前活动项目的 workspacePath，没有才退回数据目录。
				const hostCwd = () => {
					const active = booted?.runtime?.service?.state?.projects?.[booted?.activeProjectId ?? ''];
					const fromActive = typeof active?.workspacePath === 'string' ? active.workspacePath.trim() : '';
					if (fromActive !== '') return fromActive;
					const fromRegistry = (booted?.registry?.list?.() ?? [])
						.map((project) => (typeof project.workspacePath === 'string' ? project.workspacePath.trim() : ''))
						.find((value) => value !== '');
					return fromRegistry !== undefined && fromRegistry !== '' ? fromRegistry : (booted?.dataDir ?? process.cwd());
				};
				hostPromise = ensureHostAgent({
					agents: serviceOf(ctx, 'agents'),
					agentDefaultModel: serviceOf(ctx, 'agentDefaultModel'),
					workspaceRegistry: serviceOf(ctx, 'workspaceRegistry'),
					sessions: serviceOf(ctx, 'sessions'),
					cwd: hostCwd(),
					resumeSessionId: existingHost,
				}).then(async (value) => {
					// 卸载后才完成的父代理：句柄不能留在进程里，也不能写账本。
					if (disposed) {
						try { await value.dispose?.(); } catch { /* already gone */ }
						diag.append({ ev: 'host.created.after-dispose', sessionId: value.sessionId ?? null });
						return value;
					}
					// Host 会话必须落账：它决定冷恢复与 sendMessage 的 parent，也决定归档
					// 修复 sweep 能不能看见根会话。除了「首次创建」，从 roots() 里选中
					// 既有会话、以及父级发生变化（换成了另一条根会话）时同样要重绑——
					// 否则之后每次 sendMessage/coldResume 都以 UNAUTHORIZED 失败且无自愈。
					for (const runtime of booted?.runtimes?.values() ?? []) {
						if (runtime.service.state.hostSessionId === value.sessionId) continue;
						try {
							await runtime.service.bindHostSession(value.sessionId, runtime.id);
						} catch (error) {
							diag.append({ ev: 'host.bind.fail', projectId: runtime.id, sessionId: value.sessionId, message: error?.message ?? String(error) });
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
			const subagents = serviceOf(ctx, 'subagents');
			const sessions = serviceOf(ctx, 'sessions');
			const permissionPresets = serviceOf(ctx, 'permissionPresets');
			const sandboxPolicy = serviceOf(ctx, 'sandboxPolicy');
			if (subagents === undefined || sessions === undefined || permissionPresets === undefined || sandboxPolicy === undefined) {
				diag?.append({ ev: 'activate.reject', projectId: projectRuntime.id, memberId: member.id, code: 'E_RUNTIME_UNAVAILABLE' });
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'member runtime services are unavailable' }, status: 503 };
			}
			const providers = probeProviderRegistration(subagents);
			if (blocksActivation(providers)) {
				diag?.append({ ev: 'activate.reject', projectId: projectRuntime.id, memberId: member.id, code: 'E_RUNTIME_UNAVAILABLE', detail: 'no provider' });
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no subagent provider is registered' }, status: 503 };
			}
			try {
				const selection = serviceOf(ctx, 'agentDefaultModel')?.currentSelection?.();
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
					agents: serviceOf(ctx, 'agents'),
					agentPresets: serviceOf(ctx, 'agentPresets'),
					direct: false,
					parent: parentInfo.agent,
					provider: (serviceOf(ctx, 'subagents')?.list?.() ?? [])[0],
					preset: 'standard',
					cwd: effectiveDir,
					trackHandle: (sessionId, handle) => resumedHandles.set(sessionId, handle),
				});
				const result = await runtime.activate(activationMember, {
					prompt: `${memberIdentity(activationMember)}\n\n${typeof body.payload?.prompt === 'string'
						? body.payload.prompt
						: '你被加入 AI Team。先读取项目简报与收件箱，再处理分配给你的任务。'}${await formatSkillCatalog(skillsService, { cwd: effectiveDir })}${await loadSkillContext(activationMember, [join(effectiveDir, '.dsh'), dshHome(), projectRuntime.dir])}`,
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
				// 卸载后才完成的激活：直接释放，不登记（否则句柄留在已清空的表里）。
				if (disposed) {
					try { await result.activation.dispose?.(); } catch { /* already gone */ }
					diag.append({ ev: 'member.activated.after-dispose', memberId: member.id, sessionId: result.childId });
					return { error: { code: 'E_RUNTIME', message: 'plugin is shutting down' }, status: 503 };
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
				// 并发场景：激活进行中成员被退役，bind 会以 retired 拒绝。这里若无条件
				// failMember，会把 retired 覆写成 failed——退役是终态，之后 member.bind
				// 还能把成员复活。所以只对仍在册的成员记失败。
				const currentStatus = projectRuntime.service.state.members?.[member.id]?.status;
				if (currentStatus !== 'retired') {
					try {
						await projectRuntime.service.failMember(
							{ actor: { kind: 'human', memberId: HUMAN_ID }, projectId: projectRuntime.id },
							{ memberId: member.id, reason: `${error.code ?? 'E_RUNTIME'}: ${error.message ?? error}` },
						);
					} catch { /* member may already be gone */ }
				} else {
					diag.append({ ev: 'member.activate.aborted', memberId: member.id, projectId: projectRuntime.id, reason: 'member retired during activation' });
				}
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
						permissionPresets: serviceOf(ctx, 'permissionPresets'),
						sandboxPolicy: serviceOf(ctx, 'sandboxPolicy'),
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
						const catalog = await buildModelCatalog(serviceOf(ctx, 'llm'), serviceOf(ctx, 'agentDefaultModel'));
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
					// 读失败/文件损坏不能当成空表：那会把用户已有的别名整文件覆盖掉。
					const existing = readAliases();
					if (existing === null && existsSync(aliasesPath)) {
						return send(res, { error: { code: 'E_UNREADABLE', message: 'people-aliases.json 无法解析；请先修正或删除该文件再绑定' } }, 409);
					}
					const aliases = existing ?? {};
					// 归一到视图层的桶键：接受 `person:<id>`、`name:<名字>` 或裸名字。
					// 归一后才能与 aggregatePeople 的桶键对齐（裸名字曾让两行永不合并，
					// 而界面还提示「已绑定」）。
					const normalized = personId.startsWith('person:') || personId.startsWith('name:') ? personId : `name:${personId}`;
					aliases[memberName] = normalized;
					// 原子写：先写临时文件再改名，半个文件会让下一次读取直接判损坏。
					const tempPath = `${aliasesPath}.tmp`;
					writeFileSync(tempPath, JSON.stringify(aliases, null, 2) + '\n', 'utf8');
					renameSync(tempPath, aliasesPath);
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
								roots: serviceOf(ctx, 'agents')?.roots?.().length ?? null,
								// 服务探测（技能进化链路依赖 tools.register + shell）：
								// 同步可观测，避免历史「静默未启用」盲区。
								services: {
									tools: typeof serviceOf(ctx, 'tools')?.register === 'function',
									shell: Boolean(serviceOf(ctx, 'shell')),
									skilloptTools: (serviceOf(ctx, 'tools')?.definitions?.() ?? []).map((definition) => definition.name).filter((toolName) => String(toolName).startsWith('skillopt_')),
								},
								defaultModel: serviceOf(ctx, 'agentDefaultModel')?.currentSelection?.() ?? null,
								llmProviders: serviceOf(ctx, 'llm')?.listProviders?.() ?? [],
								providers: serviceOf(ctx, 'subagents')?.list?.() ?? [],
								providerCaps: (serviceOf(ctx, 'subagents')?.list?.() ?? []).map((providerName) => {
									const provider = serviceOf(ctx, 'subagents')?.getProvider?.(providerName);
									return {
										name: providerName,
										capabilities: provider?.capabilities ?? null,
										inheritsParentContext: provider?.inheritsParentContext ?? null,
										continuable: typeof provider?.prepareContinuable === 'function',
										start: typeof provider?.start === 'function',
									};
								}),
								teamTool: serviceOf(ctx, 'tools')?.definitions?.().some((definition) => definition.name === 'team') ?? null,
								skillsService: skillsService !== null && skillsService !== undefined,
								skillNames: skillsService?.list
									? await Promise.resolve(skillsService.list({})).then((rows) => rows.map((skill) => skill.name).filter((skillName) => !isSkillExcluded(skillName))).catch(() => [])
									: [],
								skilloptTools: tools?.definitions?.().map((definition) => definition.name).filter((name) => name.startsWith('skillopt_')) ?? [],
								presets: await Promise.resolve(serviceOf(ctx, 'agentPresets')?.list?.()).catch(() => []),
								members: Object.values(booted.service.state.members ?? {})
									.filter((member) => member.kind === 'agent')
									.map((member) => {
										const agent = serviceOf(ctx, 'agents')?.get?.(member.sessionId);
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
						// 账本里真实存在的项目（registry 的 active 可能与正在服务的账本脱钩）。
						const servedProjects = (runtime) => Object.keys(runtime?.service?.state?.projects ?? {});
						// 显式指定了不存在的项目：必须 404，不能静默回退到活动项目——
						// 否则删掉项目后，指向它的旧链接/书签会悄悄显示另一个项目的数据。
						if (requested !== null && requestedRuntime === null) {
							return send(res, { error: { code: 'NOT_FOUND', message: `project ${requested} not found` } }, 404);
						}
						let bootstrapRuntime = requestedRuntime ?? currentRuntime();
						if (requested === null && servedProjects(bootstrapRuntime).length === 0 && servedProjects(booted?.runtime).length > 0) {
							bootstrapRuntime = booted.runtime;
						}
						// 隐式请求用该 runtime 账本里的第一个项目；显式传了不存在的 id 仍由
						// service 的严格校验报错（保留审计修复，不再静默返回空壳）。
						const servedProjectId = servedProjects(bootstrapRuntime)[0] ?? bootstrapRuntime.id;
						const bootstrap = bootstrapRuntime.service.bootstrap(requested === null ? servedProjectId : bootstrapRuntime.id);
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
							// 新建项目对话框的默认「工作目录」：初装默认项目也用它，避免
							// 建出一个没有工作目录的项目（成员只能在插件数据目录里跑）。
							defaultWorkspace: booted.defaultWorkspace ?? '',
							// 目录输入框的示例必须跟宿主平台一致：WSL/Linux 要 /mnt/... 形式，
							// 给 Windows 的 D:/... 在 POSIX 上只是带反斜杠的文件名。
							platform: hostPlatform(),
							workspaceExample: workspaceExample(),
							// 首次使用：当前项目还没有工作目录时，界面必须先让用户设定目录。
							setupRequired: (bootstrap.project?.workspacePath ?? '') === '',
							inbox,
							inboxUnread: inbox.filter((item) => item.state === 'unread').length,
							projects: booted.registry.list()
								.filter((project) => project.archived !== true)
								.map((project) => {
									const active = bootstrap.projects?.find((entry) => entry.id === project.id);
									return {
										...project,
										owner: active?.owner ?? null,
										goal: active?.goal ?? '',
										workspacePath: active?.workspacePath ?? project.workspacePath ?? '',
										pmoAuto: project.pmoAuto ?? active?.pmoAuto ?? true,
										runState: active?.runState ?? 'running',
										archived: project.archived === true,
										active: project.id === booted.activeProjectId,
									};
								}),
							runtime: {
								defaultModel: serviceOf(ctx, 'agentDefaultModel')?.currentSelection?.() ?? null,
								providers: serviceOf(ctx, 'subagents')?.list?.() ?? [],
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
						// 归档保护在实际的全局清单上判定（registry 跨项目；service 只见
						// 自己的账本，旧实现在 service 内判定导致所有归档被误拒）。
						if (body.type === 'project.archive' && body.payload?.archived !== false) {
							const others = booted.registry.list().filter((project) => project.archived !== true && project.id !== projectId);
							if (others.length === 0) {
								return send(res, { error: { code: 'E_INVALID_STATE', message: 'cannot archive the last active project' } }, 409);
							}
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
							const agent = member?.sessionId === undefined ? undefined : serviceOf(ctx, 'agents')?.get?.(member.sessionId);
							const session = agent?.session;
							if (session === undefined || session === null) {
								return send(res, { error: { code: 'E_NOT_FOUND', message: 'member session not found' } }, 404);
							}
							const permissionPresets = serviceOf(ctx, 'permissionPresets');
							permissionPresets?.set?.(session, 'workspace-write');
							return send(res, {
								ok: true,
								mode: serviceOf(ctx, 'sandboxPolicy')?.overrideOf?.(session) ?? null,
							});
						}
						if (body.type === 'test.permission.read') {
							if (process.env.DSH_AI_TEAM_TEST !== '1') {
								return send(res, { error: { code: 'E_FORBIDDEN', message: 'test hook is disabled' } }, 403);
							}
							const member = runtime.service.state.members?.[body.payload?.memberId];
							const agent = member?.sessionId === undefined ? undefined : serviceOf(ctx, 'agents')?.get?.(member.sessionId);
							const session = agent?.session;
							return send(res, {
								ok: true,
								mode: session === undefined || session === null
									? null
									: serviceOf(ctx, 'sandboxPolicy')?.overrideOf?.(session) ?? null,
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
							// 每个项目都必须指定工作目录：先在这里挡，别把一行没有目录的
							// registry 记录写进去（service 也会再校验一次）。
							if (workspacePath === '') {
								return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: '工作目录是必填项：请选择一个已存在的目录' } }, 400);
							}
							// 工作目录可空（稍后设置）：讨论与建卡不受限；成员激活在
							// activateMember 处 fail-closed，绝不落到宿主默认目录执行。
							// 但给了就必须真实存在：非法路径若先写进 registry，boot 会在
							// 该项上抛出，导致整个插件起不来（所有路由 503），只能手工改
							// projects.json 才能恢复。
							if (workspacePath !== '') {
								let stat = null;
								try { stat = statSync(workspacePath); } catch { stat = null; }
								if (stat === null || (typeof stat.isDirectory === 'function' && stat.isDirectory() !== true)) {
									return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: `工作目录不存在或不是目录：${workspacePath}` } }, 400);
								}
							}
							const id = ids.project();
							// 先校验工作目录（上面已做），再写 registry、最后开 runtime：
							// activateProject 内部会调用 registry.setActive(id)，因此该行必须已
							// 存在。校验前置后，不会再把一个打不开的项目写进 projects.json。
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
							// 透传 workspacePath：否则账本里的 project/created 会把工作目录写成空，
							// 之后该项目的成员激活永远 E_WORKSPACE_REQUIRED。
							const next = await activateProject(target, record?.name, record?.goal, record?.workspacePath);
							return send(res, { ok: true, project: next.service.state.projects[target] ?? record });
						}
						if (body.type === 'member.activate') {
							const activated = await activateMember(body, runtime);
							if (activated.error !== undefined) return send(res, { error: activated.error }, activated.status ?? 409);
							broadcast(undefined);
							return send(res, activated);
						}
						// 成员恢复巡检（不依赖 boot/tick）：subagent provider 不提供
						// continuable 会话，唤醒失败后必须重建会话——单成员或全量。
						if (body.type === 'member.reseat') {
							const payload = body.payload ?? {};
							const state = runtime.service.state;
							const targets = Array.isArray(payload.memberIds) && payload.memberIds.length > 0
								? payload.memberIds
								: typeof payload.memberId === 'string' && payload.memberId !== ''
									? [payload.memberId]
									: payload.all === true
										? Object.values(state.members ?? {}).filter((member) => member.kind === 'agent' && member.status !== 'retired').map((member) => member.id)
										: [];
							if (targets.length === 0) {
								return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: 'memberIds, memberId or all:true is required' } }, 400);
							}
							const results = [];
							for (const memberId of targets) {
								const before = state.members?.[memberId]?.sessionId ?? null;
								try {
									const activated = await activateMember({
										payload: {
											memberId,
											force: true,
											prompt: typeof payload.prompt === 'string' && payload.prompt !== ''
												? payload.prompt
												: '会话已重建（成员恢复）。先读 tasks/thread 当前状态，继续推进；不要重复已完成的工作。',
										},
									}, runtime);
									// reseat 后旧会话不再使用：清掉选择日志缓存，避免随重建累积（泄漏）。
									if (before !== null) modelSelectionLogged.delete(before);
									results.push({
										memberId,
										ok: activated.error === undefined,
										oldSessionId: before,
										newSessionId: activated.sessionId ?? null,
										error: activated.error ?? null,
									});
								} catch (error) {
									results.push({ memberId, ok: false, oldSessionId: before, newSessionId: null, error: { code: 'E_RUNTIME', message: error?.message ?? String(error) } });
								}
								if (typeof diag?.append === 'function') {
									diag.append({
										ev: results.at(-1)?.ok === true ? 'member.reseat' : 'member.reseat.fail',
										projectId: projectId,
										memberId,
										oldSessionId: before,
										newSessionId: results.at(-1)?.newSessionId ?? null,
										message: results.at(-1)?.error?.message ?? null,
									});
								}
							}
							broadcast(undefined);
							return send(res, { ok: results.every((row) => row.ok), results });
						}
						try {
							const result = await runtime.service.dispatch({
								type: body.type,
								payload: body.payload ?? {},
								actor: { kind: 'human', memberId: HUMAN_ID },
								projectId: runtime.id,
								correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
							});
							// 归档必须同时落到全局 registry：否则 bootstrap 仍报 archived:false，
							// 项目留在树上，且「最后一个 active 项目」保护对后续归档永远失效。
							if (body.type === 'project.archive' && body.payload?.archived !== false) {
								try {
									booted.registry.setArchived(runtime.id, true);
								} catch (error) {
									diag.append({ ev: 'project.archive.registry.fail', projectId: runtime.id, message: error?.message ?? String(error) });
								}
								// 归档的正是当前 active：必须同步把 booted 指向 registry 选出的
								// fallback，否则无参 bootstrap 仍落在已归档 runtime 上 → 工作台
								// 直接 UNREACHABLE，刷新后也没有项目树可切走，只能重启宿主。
								if (booted.activeProjectId === runtime.id) {
									const fallbackId = booted.registry.activeProjectId;
									const fallback = booted.registry.list().find((project) => project.id === fallbackId);
									if (fallback !== undefined && fallback.id !== runtime.id) {
										try {
											await activateProject(fallback.id, fallback.name, fallback.goal, fallback.workspacePath);
											diag.append({ ev: 'project.archive.reactivated', from: runtime.id, to: fallback.id });
										} catch (error) {
											diag.append({ ev: 'project.archive.reactivate.fail', from: runtime.id, to: fallback.id, message: error?.message ?? String(error) });
										}
									}
								}
							}
							// 退役/离队后必须释放常驻子代理：否则 activation 句柄只在 force
							// 重建或插件卸载时才回收，退役成员的会话会一直挂在进程里。
							if (body.type === 'member.retire' || body.type === 'member.leave') {
								const retiredId = body.payload?.memberId;
								const retired = runtime.service.state.members?.[retiredId];
								const retiredSession = retired?.sessionId;
								if (typeof retiredSession === 'string') {
									const activation = activations.get(retiredSession);
									if (activation !== undefined) {
										activations.delete(retiredSession);
										try { await activation.dispose?.(); } catch { /* already gone */ }
										diag.append({ ev: 'member.activation.disposed', memberId: retiredId, sessionId: retiredSession, reason: body.type });
									}
									// 冷恢复得到的 handle 也要回收：它同样常驻进程，且不会因为
									// activation 被 dispose 而消失（两套句柄分开登记）。
									const resumed = resumedHandles.get(retiredSession);
									if (resumed !== undefined) {
										resumedHandles.delete(retiredSession);
										try { await resumed.dispose?.(); } catch { /* already gone */ }
										diag.append({ ev: 'member.resumed-handle.disposed', memberId: retiredId, sessionId: retiredSession, reason: body.type });
									}
								}
							}
							send(res, { ok: true, ...result });
							// 唤醒只由账本事件路径规划（attachRuntime 的 onEvent）：dispatch 的
							// 返回值只有投影、没有 event，这里再算一次要么算不出计划、要么与
							// 事件路径用不同的键重复唤醒。同一能力保留一份实现。
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
			disposed = true;
			try { removeDiagSink(); } catch { /* sink already replaced */ }
			try { disposeShellGuard(); } catch { /* already disposed */ }
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
			offAgentCreated();
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