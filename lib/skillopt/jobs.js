/**
 * 两阶段异步优化 job（tick 驱动状态机）。
 *
 * 为什么必须两阶段：插件工具**无法在 execute 内同步等待一次性子代理**——
 * `activation.result` 由宿主在子代理回合完成时 resolve，而工具执行本身就在
 * 一个回合内（实测等待 121s 超时、输出为空）。因此：
 *
 *   阶段 1（工具调用）：启动生成子代理，写 job 文件，立即返回 started；
 *   阶段 2（PMO tick）：每轮检查在飞子代理是否完成 → 取输出 → 校验候选 →
 *     写文件 → 启动 judge 组 → judge 完成 → 多数决 → keep/revert → results.tsv。
 *
 * job 状态：`generating` → `judging` → `done` | `failed`。
 * 全部为纯逻辑 + 注入式 I/O，便于在测试里用内存文件系统驱动任意 tick 序列。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const JOB_STATES = Object.freeze(['generating', 'judging', 'done', 'failed']);
const JOB_TTL_MS = 30 * 60 * 1000;

/** job 目录（项目内，随 .skillopt-sleep 一起被忽略/清理）。 */
export function jobsDir(projectDir) {
	return join(projectDir, '.skillopt-sleep', 'jobs');
}

/** 读取一个 job 文件（损坏视为不存在）。 */
export function readJob(projectDir, jobId) {
	try {
		return JSON.parse(readFileSync(join(jobsDir(projectDir), `${jobId}.json`), 'utf8'));
	} catch {
		return null;
	}
}

/** 列出全部 job（按创建时间升序）。 */
export function listJobs(projectDir) {
	const dir = jobsDir(projectDir);
	if (!existsSync(dir)) return [];
	const jobs = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.json')) continue;
		try {
			jobs.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
		} catch { /* skip corrupt */ }
	}
	return jobs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/** 写入 job（原子性靠单写者约定；插件 tick 单线程）。 */
export function writeJob(projectDir, job) {
	const dir = jobsDir(projectDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${job.id}.json`), JSON.stringify(job, null, 2), 'utf8');
	return job;
}

/** 删除 job 文件（done/failed 的收尾清理）。 */
export function removeJob(projectDir, jobId) {
	try { unlinkSync(join(jobsDir(projectDir), `${jobId}.json`)); } catch { /* already gone */ }
}

/**
 * 判定在飞子代理是否已完成。
 *
 * 关键：**查不到状态不等于已完成**。刚启动的子代理可能在宿主 registry 里
 * 暂不可见（agents.get 返回 undefined），此时必须继续等（有 TTL 兜底），
 * 否则会在子代理尚未产出时报「空候选」。只有明确 idle / 结束事件 /
 * 有事件且无状态时才算结束。
 *
 * @param {{status?: string|null, events?: Array}} observation
 * @returns {boolean}
 */
export function isChildSettled(observation) {
	const events = Array.isArray(observation?.events) ? observation.events : [];
	if (events.some((event) => event?.type === 'subagent/end' || event?.type === 'session/end')) return true;
	const status = observation?.status;
	if (status === 'idle') return true;
	if (status === 'running') return false;
	// 状态未知：有事件说明会话存在且可能已产出（无结束事件时由 TTL 兜底）。
	return events.length > 0;
}

/** job 是否超时（TTL）。 */
export function isJobExpired(job, nowMs, ttlMs = JOB_TTL_MS) {
	return typeof job?.createdAt === 'number' && nowMs - job.createdAt > ttlMs;
}

/**
 * 状态机的一步决策（纯函数）：
 * @param {object} job 当前 job
 * @param {{children: Record<string, {status?:string, events?:Array}>, now: number}} observation
 * @returns {{next: string, actions: Array<{type:string, payload?:object}>, reason?: string}}
 *   actions.type: 'finish-keep'|'finish-revert'|'fail'|'start-judges'|'apply-candidate'|'await'
 */
export function planJobStep(job, observation) {
	const state = job?.state;
	if (state === 'done' || state === 'failed') return { next: state, actions: [], reason: 'terminal' };
	if (isJobExpired(job, observation.now)) {
		return { next: 'failed', actions: [{ type: 'fail', payload: { reason: 'job timeout' } }], reason: 'timeout' };
	}
	if (state === 'generating') {
		const child = observation.children?.[job.generatorChildId];
		if (!isChildSettled(child)) return { next: state, actions: [{ type: 'await' }], reason: 'generator running' };
		const text = typeof child?.text === 'string' ? child.text : '';
		if (text.trim() === '') {
			return { next: 'failed', actions: [{ type: 'fail', payload: { reason: 'generator returned an empty candidate' } }], reason: 'empty candidate' };
		}
		return { next: 'judging', actions: [{ type: 'apply-candidate', payload: { text } }, { type: 'start-judges' }], reason: 'generator settled' };
	}
	if (state === 'judging') {
		const votes = [];
		let allSettled = true;
		for (const childId of job.judgeChildIds ?? []) {
			const child = observation.children?.[childId];
			if (!isChildSettled(child)) { allSettled = false; continue; }
			votes.push({ childId, text: typeof child?.text === 'string' ? child.text : '' });
		}
		if (!allSettled) return { next: state, actions: [{ type: 'await' }], reason: 'judges running' };
		return { next: 'done', actions: [{ type: 'finish', payload: { votes } }], reason: 'judges settled' };
	}
	return { next: 'failed', actions: [{ type: 'fail', payload: { reason: `unknown state ${String(state)}` } }], reason: 'unknown state' };
}
