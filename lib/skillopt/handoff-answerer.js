/**
 * SkillOpt-Sleep handoff 后端的自动应答：夜间环用 handoff 后端时，引擎把需要模型
 * 回答的调用写进 `<workspace>/.skillopt-sleep-handoff/pending.json` 后以退出码 3
 * 停下，等有人把每题的原文答案写到 `answers/<id>.md` 再重跑同一条命令。
 * 无人应答时夜间环永远停在这里（il2c 实机：10 题等答、结果码一直是 3）。
 *
 * 本模块由 PMO tick 驱动，评审官身份应答：
 *   - 每题起一个**一次性**子代理（上下文干净）——引擎要求每题在新上下文里回答，
 *     长驻成员会话的历史会污染留出验证门；
 *   - 收齐后重跑计划任务写下的 `<workspace>/.skillopt-sleep/run.ps1`（与 03:17
 *     触发的是同一条命令，输出照旧进 cron.log），引擎从答案目录续跑；
 *   - 同一批题只重跑一次：引擎消费了答案会换一批题（或跑完归档 handoff 目录），
 *     批次不变说明重跑没推进，记一行停滞日志而不是反复重跑。
 *
 * 只做注入式 I/O（子代理启动/观测、重跑、时间），测试可用内存实现。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isChildSettled } from './jobs.js';
import { sha12 } from './proposal-store.js';

export const HANDOFF_DIR = '.skillopt-sleep-handoff';
const STATE_FILE = 'answerer.json';
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 2;
const ANSWER_RULE = '只输出这道题的答案原文：不要调用工具、不要解释、不要代码围栏。';

/** 读 pending.json，归一成 [{id, prompt, answerFile}]；没有或读不了返回 null。 */
export function readPendingCalls(workspace) {
	const dir = join(workspace, HANDOFF_DIR);
	const file = join(dir, 'pending.json');
	if (!existsSync(file)) return null;
	let doc;
	try {
		doc = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
	const answersDir = typeof doc?.answers_dir === 'string' && doc.answers_dir !== '' ? doc.answers_dir : join(dir, 'answers');
	const calls = [];
	for (const row of Array.isArray(doc?.pending) ? doc.pending : []) {
		if (typeof row?.id !== 'string' || row.id === '' || typeof row?.prompt !== 'string') continue;
		const answerFile = typeof row.answer_file === 'string' && row.answer_file !== '' ? row.answer_file : join(answersDir, `${row.id}.md`);
		calls.push({ id: row.id, prompt: row.prompt, answerFile });
	}
	return calls;
}

function hasAnswer(file) {
	try {
		return statSync(file).size > 0;
	} catch {
		return false;
	}
}

function readState(dir) {
	try {
		const state = JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8'));
		return state !== null && typeof state === 'object' ? state : {};
	} catch {
		return {};
	}
}

/**
 * 推进一个工作区的 handoff 应答一步（tick 入口）。
 *
 * @param {object} input
 * @param {string} input.workspace 项目工作区（夜间任务的 project）
 * @param {object} input.deps
 * @param {(label:string, request:{cwd:string, prompt:string}) => Promise<{childId:string, outputStart?:any}>} input.deps.startChild
 * @param {(childId:string, outputStart:any) => {status?:string|null, events?:Array, text?:string}} input.deps.observe
 * @param {(runScript:string) => Promise<{exitCode:number|null}>} input.deps.rerun
 * @param {() => number} input.deps.now
 * @param {(row:object) => void} [input.deps.diag]
 * @param {number} [input.deps.concurrency]
 * @param {number} [input.deps.ttlMs]
 * @param {number} [input.deps.maxAttempts]
 * @returns {Promise<{status:'idle'|'answering'|'rerun'|'stalled'|'blocked', answered:number, total:number}>}
 */
export async function stepHandoff({ workspace, deps }) {
	const calls = readPendingCalls(workspace);
	if (calls === null || calls.length === 0) return { status: 'idle', answered: 0, total: 0 };
	const dir = join(workspace, HANDOFF_DIR);
	const diag = deps.diag ?? (() => {});
	const now = deps.now();
	const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
	const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
	const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const batch = sha12(calls.map((call) => call.id).join('\n'));
	const saved = readState(dir);
	const state = saved.batch === batch ? saved : { batch, calls: {}, rerunAt: null, stalled: false };
	state.calls ??= {};
	const save = () => writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2), 'utf8');

	let answered = 0;
	let running = 0;
	let exhausted = 0;
	for (const call of calls) {
		if (hasAnswer(call.answerFile)) {
			answered += 1;
			delete state.calls[call.id]?.childId;
			continue;
		}
		const entry = state.calls[call.id] ?? { attempts: 0 };
		state.calls[call.id] = entry;
		if (typeof entry.childId === 'string') {
			const seen = deps.observe(entry.childId, entry.outputStart ?? null);
			if (isChildSettled(seen)) {
				const text = String(seen?.text ?? '').trim();
				delete entry.childId;
				if (text !== '') {
					writeFileSync(call.answerFile, `${text}\n`, 'utf8');
					answered += 1;
					diag({ ev: 'skillopt.handoff.answered', workspace, id: call.id, chars: text.length });
					continue;
				}
				entry.attempts += 1;
				diag({ ev: 'skillopt.handoff.empty', workspace, id: call.id, attempts: entry.attempts });
			} else if (now - (entry.startedAt ?? now) > ttlMs) {
				delete entry.childId;
				entry.attempts += 1;
				diag({ ev: 'skillopt.handoff.timeout', workspace, id: call.id, attempts: entry.attempts });
			} else {
				running += 1;
				continue;
			}
		}
		if (entry.attempts >= maxAttempts) {
			exhausted += 1;
			continue;
		}
		if (running >= concurrency) continue;
		try {
			const child = await deps.startChild(`skillopt-reviewer-handoff-${call.id}`, {
				cwd: workspace,
				prompt: `${ANSWER_RULE}\n\n${call.prompt}`,
			});
			entry.childId = child.childId;
			entry.outputStart = child.outputStart ?? null;
			entry.startedAt = now;
			running += 1;
			diag({ ev: 'skillopt.handoff.ask', workspace, id: call.id, childId: child.childId, attempt: entry.attempts + 1 });
		} catch (error) {
			entry.attempts += 1;
			diag({ ev: 'skillopt.handoff.ask.fail', workspace, id: call.id, message: error?.message ?? String(error) });
		}
	}

	const total = calls.length;
	if (answered < total) {
		save();
		if (exhausted > 0 && running === 0 && answered + exhausted === total) {
			if (state.blocked !== true) diag({ ev: 'skillopt.handoff.blocked', workspace, batch, unanswered: exhausted });
			state.blocked = true;
			save();
			return { status: 'blocked', answered, total };
		}
		return { status: 'answering', answered, total };
	}
	// 全部答完：同一批只重跑一次。
	if (state.rerunAt !== null && state.rerunAt !== undefined) {
		if (state.stalled !== true) {
			state.stalled = true;
			save();
			diag({ ev: 'skillopt.handoff.stalled', workspace, batch, rerunAt: state.rerunAt });
		}
		return { status: 'stalled', answered, total };
	}
	const runScript = join(workspace, '.skillopt-sleep', 'run.ps1');
	if (!existsSync(runScript)) {
		save();
		diag({ ev: 'skillopt.handoff.rerun.skip', workspace, reason: 'no scheduled run script' });
		return { status: 'stalled', answered, total };
	}
	state.rerunAt = now;
	save();
	diag({ ev: 'skillopt.handoff.rerun', workspace, batch, answers: total });
	try {
		const result = await deps.rerun(runScript);
		diag({ ev: 'skillopt.handoff.rerun.done', workspace, batch, exitCode: result?.exitCode ?? null });
	} catch (error) {
		diag({ ev: 'skillopt.handoff.rerun.fail', workspace, batch, message: error?.message ?? String(error) });
	}
	return { status: 'rerun', answered, total };
}
