/**
 * 优化 job 的宿主侧收割：每个 PMO tick 调用一次，把状态机的一步动作落到
 * 真实文件/子代理/结果记录上。
 *
 * 与 jobs.js（纯逻辑）分离；本模块只做注入式 I/O，因此测试可用内存实现。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { extractAssistantText } from './subagent-text.js';
import { isChildSettled, planJobStep, readJob, writeJob, listJobs } from './jobs.js';
import { decideByMajority, normalizeVoteCount, parseJudgeOutput, buildPairPrompt, voteFromParsed } from './judge.js';
import { validateCandidate } from './optimizer.js';
import { sha12 } from './proposal-store.js';

/** 观测一个在飞子代理：状态 + 会话事件（同步，供状态机使用）。 */
export function observeChild(ctx, childId, outputStart) {
	// 三条路径兜底：agents（活 agent）→ subagents activation → sessions。
	const agent = ctx.get('agents')?.get?.(childId);
	if (agent !== undefined && agent !== null) {
		let events = [];
		try {
			events = agent.session?.snapshotEvents?.(outputStart) ?? [];
		} catch { /* session may be gone */ }
		return { status: agent.status ?? null, events, text: extractAssistantText(events) };
	}
	// 刚启动的子代理可能不在 agents registry：用 sessions 服务读会话事件。
	const session = ctx.get('sessions')?.get?.(childId);
	if (session !== undefined && session !== null) {
		let events = [];
		try {
			events = session.snapshotEvents?.(outputStart) ?? [];
		} catch { /* session may be gone */ }
		return { status: null, events, text: extractAssistantText(events) };
	}
	// 完全查不到：不得视为已完成（由 TTL 兜底），调用方会继续等待。
	return { status: 'running', events: [] };
}

/**
 * 推进一个 job 一步。
 *
 * @param {object} input
 * @param {object} input.ctx DSH context
 * @param {string} input.projectDir
 * @param {object} input.job job 记录
 * @param {object} input.deps
 * @param {(name:string, spec:object)=>Promise<object>} input.deps.startChild 启动子代理（返回 {childId}）
 * @param {(path:string, text:string)=>void} input.deps.writeText
 * @param {(path:string)=>string} input.deps.readText
 * @param {object} input.deps.vcs makeVcs 结果
 * @param {(line:string)=>Promise<void>} input.deps.appendResult
 * @param {(text:string)=>object} input.deps.score
 * @param {() => number} input.deps.now
 * @param {string} input.deps.provider
 * @param {object} input.deps.parent
 * @param {number} [input.deps.votes]
 * @param {(row:object)=>void} [input.deps.diag]
 * @returns {Promise<{job:object, changed:boolean}>}
 */
export async function stepJob(input) {
	const { ctx, projectDir, deps } = input;
	let job = input.job;
	const children = {};
	for (const childId of [job.generatorChildId, ...(job.judgeChildIds ?? [])].filter(Boolean)) {
		children[childId] = observeChild(ctx, childId, job.outputStart);
	}
	const plan = planJobStep(job, { children, now: deps.now() });
	if (plan.next === job.state && plan.actions.every((action) => action.type === 'await')) {
		return { job, changed: false };
	}
	for (const action of plan.actions) {
		if (action.type === 'fail') {
			await rollback({ deps, job, projectDir });
			job = { ...job, state: 'failed', error: action.payload?.reason ?? 'failed', updatedAt: deps.now() };
			deps.diag?.({ ev: 'skillopt.job.fail', jobId: job.id, reason: job.error });
		} else if (action.type === 'apply-candidate') {
			// 备份基线 → 写入候选 → 校验（超限时回滚）。
			const before = deps.readText(job.skillPath);
			const validation = validateCandidate({ before, after: action.payload?.text ?? '' });
			if (!validation.ok) {
				await rollback({ deps, job, projectDir });
				job = { ...job, state: 'failed', error: validation.reason, updatedAt: deps.now() };
				deps.diag?.({ ev: 'skillopt.job.fail', jobId: job.id, reason: validation.reason });
				break;
			}
			job = { ...job, before, candidate: action.payload.text, backup: await deps.vcs.backup(job.skillPath, before) };
			// 先落盘再改 live：中途崩溃时 job 里已有 before/backup，可据此回滚；
			// 反过来（先改 live）会让磁盘上的技能停在未审候选且无任何记录。
			writeJob(projectDir, job);
			deps.writeText(job.skillPath, action.payload.text);
		} else if (action.type === 'start-judges') {
			const votes = normalizeVoteCount(deps.votes ?? 3);
			const parentInfo = typeof deps.ensureParent === 'function' ? await deps.ensureParent() : null;
			const parent = parentInfo?.agent ?? deps.parent;
			const judgeChildIds = [];
			const judgeOrders = [];
			for (let index = 0; index < votes; index++) {
				const order = Math.random() < 0.5 ? 'ab' : 'ba';
				const { prompt } = buildPairPrompt({ before: job.before, after: job.candidate, order });
				const child = await deps.startChild(`skillopt-judge-${job.id}-${index + 1}`, {
					provider: deps.provider,
					request: {
						cwd: projectDir,
						prompt: [{ type: 'text', text: prompt }],
						parent,
					},
					delivery: 'parent',
					signal: new AbortController().signal,
				});
				judgeChildIds.push(child.childId);
				judgeOrders.push({ childId: child.childId, order });
			}
			job = { ...job, state: 'judging', judgeChildIds, judgeOrders, updatedAt: deps.now() };
		} else if (action.type === 'finish') {
			const votes = [];
			for (const row of action.payload?.votes ?? []) {
				const mapping = (job.judgeOrders ?? []).find((entry) => entry.childId === row.childId);
				const parsed = parseJudgeOutput(row.text);
				const vote = voteFromParsed(parsed === null ? null : { ...parsed, aIsAfter: mapping?.order === 'ba' });
				votes.push({ childId: row.childId, vote, margin: parsed?.margin ?? null, reason: parsed?.reason ?? '' });
			}
			const decision = decideByMajority(votes.map((entry) => entry.vote));
			const kept = decision.verdict === 'keep';
			if (!kept) await rollback({ deps, job, projectDir });
			job = { ...job, state: 'done', decision: { ...decision, votes, kept }, updatedAt: deps.now() };
			const afterText = kept ? job.candidate : job.before;
			const beforeScore = deps.score(job.before)?.total ?? null;
			const afterScore = deps.score(afterText)?.total ?? null;
			await deps.appendResult([
				new Date(deps.now()).toISOString().slice(0, 19),
				deps.vcs.kind === 'git' ? (job.commit ?? '-') : '-',
				job.skillName,
				String(beforeScore ?? '-'),
				String(afterScore ?? '-'),
				kept ? 'keep' : 'revert',
				job.dimension ?? '-',
				`${decision.better}-${decision.worse} ${decision.verdict}`,
				'paired',
				sha12(job.candidate),
			].join('\t'));
			deps.diag?.({ ev: 'skillopt.job.done', jobId: job.id, verdict: decision.verdict, better: decision.better, worse: decision.worse, kept });
		}
	}
	if (plan.next !== job.state && plan.next !== 'failed') job = { ...job, state: plan.next, updatedAt: deps.now() };
	writeJob(projectDir, job);
	return { job, changed: true };
}

async function rollback({ deps, job, projectDir }) {
	if (job?.candidate === undefined || job?.before === undefined) return;
	try {
		if (deps.vcs.kind === 'file' && typeof job.backup === 'string') {
			await deps.vcs.restore(job.skillPath, job.backup);
		} else {
			deps.writeText(job.skillPath, job.before);
		}
	} catch { /* best effort */ }
}

/** 收割全部 pending job（tick 入口）。 */
export async function reconcileJobs(input) {
	// 评审通道的 job（带 reviewTaskId）由 skillopt_jobs 收集，不走子代理 reconcile：
	// 否则 reconcile 会在评审官回帖前把它判成 inconclusive done。
	const jobs = listJobs(input.projectDir).filter((job) => (job.state === 'generating' || job.state === 'judging') && typeof job.reviewTaskId !== 'string');
	const results = [];
	for (const job of jobs) {
		results.push(await stepJob({ ...input, job }));
	}
	return results;
}

export { isChildSettled, readJob, writeJob };
