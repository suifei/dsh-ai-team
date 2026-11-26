import { STALLED_MEMBER_STATUSES, dependenciesDone, teamRoles, writeScopeConflict } from '../domain/policy.js';

/**
 * PMO decision policy.
 *
 * Human is not in the loop when PMO auto mode is on: choose the recommendation
 * when one exists, otherwise choose the option that protects delivery value
 * (complete/core) over minimum-effort options. The answer is intentionally
 * explicit so it is auditable in the Task Thread.
 */

const LOW_VALUE = /最小|暂缓|延后|不做|暂停|维持现状|先不|仅文档|只做骨架/i;
const HIGH_VALUE = /完整|核心|全量|生产可用|全平台|优先/i;
const NEGATED_RECOMMENDATION = /不\s*(?:推荐|建议)|\bnot\s+recommended\b/i;

function clean(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** 识别字母编号，也接受 `A（推荐）：…` 或 `B 核心方案`。 */
function optionLetter(value) {
	const match = /^\s*[（(]?([A-Za-z])(?:[（(][^）)]+[）)]\s*[.．、:：]|[)）.．、:：]|\s+)/.exec(value);
	return match === null ? null : match[1].toUpperCase();
}

/** 建议里点名的选项字母（`建议 B` / `推荐：C` / `选 A`）。 */
function recommendationLetter(recommendation) {
	const match = /(?:建议|推荐|选择|选|option|choose)\s*[：:]?\s*[（(]?([A-Za-z])\b/i.exec(recommendation)
		?? /^\s*[（(]?([A-Za-z])[)）.．、:：]/.exec(recommendation);
	return match === null ? null : match[1].toUpperCase();
}

/** 显式建议命中哪个选项：字母编号优先，其次双向包含。 */
function explicitPick(options, recommendation) {
	if (recommendation === '') return null;
	const exact = options.find((option) => option === recommendation);
	if (exact !== undefined) return exact;
	if (NEGATED_RECOMMENDATION.test(recommendation)) return null;
	const letter = recommendationLetter(recommendation);
	if (letter !== null) {
		const byLetter = options.find((option) => optionLetter(option) === letter);
		if (byLetter !== undefined) return byLetter;
	}
	return options.find((option) => recommendation.includes(option) || option.includes(recommendation)) ?? null;
}

function scoreOption(value) {
	// 否定说明优先于正向关键词；不把选项编号当作交付价值。
	if (NEGATED_RECOMMENDATION.test(value)) return -100;
	let score = 0;
	if (/推荐|\brecommended\b/i.test(value)) score += 20;
	if (HIGH_VALUE.test(value)) score += 12;
	if (/核心|完整/i.test(value)) score += 6;
	if (LOW_VALUE.test(value)) score -= 20;
	return score;
}

/** Return [ { id, value } ] for every question. */
export function chooseDecisionAnswers(questions) {
	return (Array.isArray(questions) ? questions : []).map((question, index) => {
		const id = typeof question?.id === 'string' && question.id !== '' ? question.id : `q${index + 1}`;
		const options = Array.isArray(question?.options) ? question.options.map(clean).filter(Boolean) : [];
		const recommendation = clean(question?.recommendation);
		if (options.length > 0) {
			// 问题里给了明确建议就按建议选——只有没有建议、或建议对不上任何选项时，
			// 才退回关键字打分。否则「建议 A」可能被关键词打分选成 B，PMO 自动决策
			// 就与问题给出的建议相反。
			const explicit = explicitPick(options, recommendation);
			if (explicit !== null) return { id, value: explicit };
			const picked = options
				.map((option) => ({ option, score: scoreOption(option) }))
				.sort((left, right) => right.score - left.score)[0];
			return { id, value: picked?.option || recommendation || '按完整核心方案执行' };
		}
		return { id, value: recommendation || '按完整、可验收、长期价值最高的方案执行' };
	});
}

const MINUTE = 60_000;

/**
 * PMO 巡检对一张 active Task 该发哪些提醒（按序：review / heartbeat / escalate / stall）。
 *
 * 两个时钟分开：
 *   - threadIdle：Thread 最后一条或 Task 状态变化以来——只用来判断「该发心跳了」；
 *   - stateIdle：Task 状态（claim/submit/accept…）最后一次变化以来——判断巡检与升级。
 * 实机（r06）：执行人把交付写在 Thread 里 @ 评审、没有 submit，于是每 10 分钟的心跳
 * 回帖都刷新了单一时钟，巡检（30 分钟）与升级（60 分钟）永远不触发，owner 从未被叫来，
 * 心跳每小时 6 次无休止。回帖不是进展，状态变化才是。
 * 验收中的 Task 只认状态时钟（执行人的 Thread 闲聊不能掩盖沉默的 QA）。
 *
 * @param {any} task
 * @param {{ threadAt?: number|null, now: number, last?: Record<string, number> }} options
 *   last：每种提醒上次发出的时间（review/heartbeat/escalate/stall）。
 * @returns {Array<'review'|'heartbeat'|'escalate'|'stall'>}
 */
export function planTaskNudges(task, { threadAt = null, now, last = {} }) {
	const taskAt = Number.isFinite(task?.updatedAt) ? task.updatedAt : 0;
	if (taskAt === 0) return [];
	const stateIdle = now - taskAt;
	const threadIdle = task.status === 'pending_acceptance'
		? stateIdle
		: now - Math.max(taskAt, Number.isFinite(threadAt) ? threadAt : 0);
	const due = (kind, every) => now - (last[kind] ?? 0) >= every;
	const out = [];
	// 待验收一律催验收人（#18）：qaRequired 只决定「谁有资格收」，不决定「要不要催」。
	if (task.status === 'pending_acceptance') {
		if (stateIdle < 10 * MINUTE) return out;
		if (due('review', 10 * MINUTE)) out.push('review');
		if (stateIdle >= 60 * MINUTE && due('escalate', 60 * MINUTE)) out.push('escalate');
		return out;
	}
	if (threadIdle >= 10 * MINUTE && stateIdle < 30 * MINUTE && due('heartbeat', 10 * MINUTE)) out.push('heartbeat');
	if (stateIdle >= 60 * MINUTE && due('escalate', 60 * MINUTE)) out.push('escalate');
	if (stateIdle >= 30 * MINUTE && due('stall', 30 * MINUTE)) out.push('stall');
	return out;
}

/** 每张 pending 卡的补派上限：补派是「唤醒可能没送达」的兜底，不是催办。 */
export const PMO_DISPATCH_LIMIT = 3;

/**
 * Pending 快速补派（R-14）是否该发：返回责任人 id，或 null。
 *
 * 判忙只看**实时回合**（宿主 turn/start → turn/end），不看账本投影：账本没有「回合结束」
 * 事件，成员一旦 session-bound 就永远是 running——#18 与 il2c 实账本（2997 次唤醒、
 * pmo_dispatch 0 次）都证明旧判定让补派成了死代码。每卡最多 PMO_DISPATCH_LIMIT 次、
 * 间隔至少 60 秒；责任人醒着却不认领，交给 stall/escalate 升级。
 *
 * @param {any} task
 * @param {any} state 账本投影
 * @param {{ inTurn: (sessionId: string) => boolean, last?: { at: number, count: number }, now: number }} options
 * @returns {string | null}
 */
export function planDispatch(task, state, { inTurn, last = { at: 0, count: 0 }, now }) {
	if (task?.status !== 'pending' || task.tombstone === true) return null;
	const responsibleId = task.assigneeId ?? task.ownerId;
	const responsible = state?.members?.[responsibleId];
	if (responsible === undefined || responsible.kind !== 'agent') return null;
	if (responsible.status === 'retired' || responsible.status === 'failed') return null;
	if (typeof responsible.sessionId === 'string' && inTurn(responsible.sessionId)) return null;
	if (last.count >= PMO_DISPATCH_LIMIT || now - last.at < 60_000) return null;
	return responsibleId;
}

/** 空看板静默后：首次立即重推；之后的间隔从这里起翻倍，封顶 PMO_IDLE_RETRY_MAX。 */
export const PMO_IDLE_RETRY_BASE = 10 * MINUTE;
export const PMO_IDLE_RETRY_MAX = 8 * 60 * MINUTE;

/**
 * 空看板且「PMO 已看过局面、此后无新进展」（pmoNews=false）时，是否再推进一次。
 *
 * 静默本是为了防目标完成后每 10 分钟空转开会（r09）；但永久静默会把团队卡死。il2c 11-17：
 * 03:55 wave_done 送达主理人（pmoNews→false），主理人说「波尾刀本回合即起」、起了后台批就收尾，
 * 后台批随会话释放被杀（job/settled killed/teardown），此后无人建卡、Human 也无输入，
 * PMO 每轮都判「无新进展」，看板空转到天亮。
 *
 * 规则（Human 11-17：「PMO 自动 · 开、项目运行 · 开，没有成员在跑就应该立即行动」）：
 * 没有成员在回合里就立即推进一次；推进过仍没人动，再隔 10 分钟 × 2^(次数-1)（封顶 8 小时）推进，
 * 防目标确已完成时每轮空转。预算闸（pmoGate）照旧把关，用尽即停。两个开关由 pmoTick 入口把关。
 *
 * @param {any} state 账本投影
 * @param {{ since: number, lastAt?: number, retries?: number, now: number, inTurn: (sessionId: string) => boolean }} options
 * @returns {boolean}
 */
export function planIdleRetry(state, { since, lastAt = since, retries = 0, now, inTurn }) {
	const busy = Object.values(state?.members ?? {}).some((member) =>
		member?.kind === 'agent' && typeof member.sessionId === 'string' && inTurn(member.sessionId));
	if (busy) return false;
	if (retries === 0) return true;
	const wait = Math.min(PMO_IDLE_RETRY_BASE * 2 ** (retries - 1), PMO_IDLE_RETRY_MAX);
	return now - lastAt >= wait;
}

/** 同一空闲局面再次叫主理人的起始间隔与封顶（逐次翻倍）。 */
export const PMO_STAFFING_BASE = 10 * MINUTE;
export const PMO_STAFFING_MAX = 2 * 60 * MINUTE;

/**
 * 空闲必派（用户 2026-11-20：有多少能开发的角色就分多少任务，确保及时；新加的人由 PMO 及时分配新任务）。
 *
 * 看板上还有活（调用方只在有 active Task 时调用；空看板另有 continue/wave_done 推进）时，找出**空闲开发**：
 * 在岗、不是主理人也不是验收人（teamRoles），名下没有未结束的卡（含待验收——那时按规则也不能领新卡），
 * 也不在回合里。然后：
 * - 有**可认领的待办**（pending、未指派、依赖已完成）：按入队先后一人一张，叫他们认领（claims）；
 * - 待办不够分：剩下的空闲开发（spare）交给主理人拆新卡、直接指派——team 工具没有改派动作，已指派的卡不动。
 * 新成员加入后下一次巡检（≤60s）就会被发现。同一局面（空闲名单 + 待办）重复出现时间隔从 10 分钟起逐次
 * 翻倍、封顶 2 小时，防止确实没有可拆的活时每 10 分钟空叫一次主理人；局面一变立即重新判定。
 *
 * @param {any} state 账本投影
 * @param {{ now: number, inTurn: (sessionId: string) => boolean, last?: { at: number, signature: string, repeats: number } }} options
 * @returns {{ claims: Array<{ memberId: string, taskId: string }>, spare: string[], signature: string, repeats: number } | null}
 */
/** 未结束的卡（待办 / 在做 / 待验收）。 */
function openTasks(state) {
	return Object.values(state?.tasks ?? {}).filter((task) => task?.tombstone !== true && ['pending', 'in_progress', 'pending_acceptance'].includes(task.status));
}

/** 现在就能被认领的待办：未指派、依赖已完成、写入范围不和在做的卡重叠；按编号排。 */
function claimableTasks(state, open) {
	return open
		.filter((task) => task.status === 'pending' && (task.assigneeId === null || task.assigneeId === undefined)
			&& dependenciesDone(task, state.tasks) && writeScopeConflict(task, state.tasks) === undefined)
		.sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || String(a.id).localeCompare(String(b.id)));
}

/** 空闲开发：teamRoles 的开发里名下没有未结束的卡、也不在回合里的。 */
function idleDevelopers(state, open, inTurn) {
	return teamRoles(state).developers.filter((member) =>
		!open.some((task) => task.assigneeId === member.id)
		&& !(typeof member.sessionId === 'string' && inTurn(member.sessionId)));
}

export function planIdleStaffing(state, { now, inTurn, last = { at: 0, signature: '', repeats: 0 } }) {
	const open = openTasks(state);
	if (open.length === 0) return null;
	const idle = idleDevelopers(state, open, inTurn);
	if (idle.length === 0) return null;
	const claimable = claimableTasks(state, open);
	const claims = idle.slice(0, claimable.length).map((member, index) => ({ memberId: member.id, taskId: claimable[index].id }));
	const spare = idle.slice(claimable.length).map((member) => member.id);
	const signature = JSON.stringify([idle.map((member) => member.id), claimable.map((task) => task.id)]);
	const repeats = signature === last.signature ? last.repeats + 1 : 0;
	if (repeats > 0) {
		const wait = Math.min(PMO_STAFFING_BASE * 2 ** (repeats - 1), PMO_STAFFING_MAX);
		if (now - last.at < wait) return null;
	} else if (now - last.at < MINUTE) {
		return null;
	}
	return { claims, spare, signature, repeats };
}

/** 加人建议：卡要等够这么久才算「慢」；同一类建议发过后的冷却。 */
export const STAFFING_ADVICE_WAIT = 30 * MINUTE;
export const STAFFING_ADVICE_COOLDOWN = 4 * 60 * MINUTE;
/** 宿主同时运行的子智能体上限默认值（dsh-subagent maxActiveSubagents）；实际值以容量报错里的数字为准。 */
export const HOST_SUBAGENT_LIMIT = 8;

/**
 * 加人建议（用户 2026-11-20：从管理角度看推进过慢就该加人，由 Human 决定）。插件自己按看板判定，不靠模型：
 * - 开发不够：有可认领的待办等了 ≥ 30 分钟，却没有空闲开发（空闲开发会先被 planIdleStaffing 派活）。
 *   建议人数 = 等着的待办数，最多 3。
 * - 验收不够：待验收的卡等了 ≥ 30 分钟，且没有验收人，或每位验收人摊到 ≥ 2 张。建议加 1 名。
 * 团队人数加上建议人数超过宿主同时在跑的上限时，理由里写明多出的人会排队、提速有限。
 * 该岗位有人停摆（failed / unavailable，等 Human 恢复）时改为「建议恢复」：人还在，只是停了，恢复比加人快，
 * 也不占新名额（实机 il2c 2026-11-20：验收人白砚 06:53 模型报错停摆，两张卡待验收 9 小时，旧版却说「团队没有验收人，建议加 1 名」）。
 * 同一类建议 4 小时内只提一次；上一条还没处理（unread）时不再提。冷却读账本里的收件箱，重启不丢。
 *
 * @param {any} state 账本投影
 * @param {{ now: number, inTurn: (sessionId: string) => boolean, capacity?: number, humanId?: string | null, wait?: number }} options 「慢」的门槛 wait 来自配置 staffingAdviceMinutes
 * @returns {Array<{ role: 'developer' | 'qa', action: 'add' | 'recover', count: number, memberIds: string[], title: string, reasons: string[], taskIds: string[] }>}
 */
export function planStaffingAdvice(state, { now, inTurn, capacity = HOST_SUBAGENT_LIMIT, humanId = null, wait = STAFFING_ADVICE_WAIT }) {
	const open = openTasks(state);
	if (open.length === 0) return [];
	const age = (task) => now - Number(task.updatedAt ?? task.createdAt ?? now);
	const minutes = (ms) => Math.round(ms / MINUTE);
	const { qas, stalled } = teamRoles(state);
	const advice = [];
	const longest = (tasks) => minutes(Math.max(...tasks.map(age)));
	const names = (members) => members.map((member) => member.name ?? member.id).join('、');
	const recover = (role, members, waited) => ({ role, action: 'recover', count: members.length, memberIds: members.map((member) => member.id),
		reasons: [`${waited}，而${role === 'developer' ? '开发' : '验收人'} ${names(members)} 停摆了（收件箱里有失败提醒）：恢复后即可接手，不必加人`] });
	const waitingWork = claimableTasks(state, open).filter((task) => age(task) >= wait);
	if (waitingWork.length > 0 && idleDevelopers(state, open, inTurn).length === 0) {
		const waited = `${waitingWork.length} 张待办已等 ${longest(waitingWork)} 分钟，开发都在忙`;
		advice.push({ taskIds: waitingWork.map((task) => task.id), ...(stalled.developers.length > 0
			? recover('developer', stalled.developers, waited)
			: { role: 'developer', action: 'add', count: Math.min(waitingWork.length, 3), memberIds: [], reasons: [waited] }) });
	}
	const waitingReview = open.filter((task) => task.status === 'pending_acceptance' && age(task) >= wait);
	if (waitingReview.length > 0 && (qas.length === 0 || waitingReview.length >= 2 * qas.length)) {
		const waited = `${waitingReview.length} 张卡待验收已等 ${longest(waitingReview)} 分钟`;
		advice.push({ taskIds: waitingReview.map((task) => task.id), ...(stalled.qas.length > 0
			? recover('qa', stalled.qas, waited)
			: { role: 'qa', action: 'add', count: 1, memberIds: [], reasons: [qas.length === 0
				? `${waited}，团队没有验收人`
				: `${waited}，${qas.length} 位验收人每人摊到 ${Math.ceil(waitingReview.length / qas.length)} 张`] }) });
	}
	const headcount = Object.values(state?.members ?? {}).filter((member) => member?.kind === 'agent' && member.status !== 'retired' && !STALLED_MEMBER_STATUSES.includes(member.status)).length;
	const recent = (role) => Object.values(state?.inbox ?? {}).some((item) =>
		item.ref?.kind === 'staffing_advice' && item.ref.role === role
		&& (humanId === null || item.memberId === humanId)
		&& (item.state === 'unread' || now - Number(item.createdAt ?? 0) < STAFFING_ADVICE_COOLDOWN));
	return advice.filter((entry) => !recent(entry.role)).map((entry) => {
		const reasons = [...entry.reasons];
		const who = entry.role === 'developer' ? '开发' : '验收';
		if (entry.action === 'recover') return { ...entry, reasons, title: `建议恢复停摆的${who}：${reasons.join('；')}` };
		if (headcount + entry.count > capacity) reasons.push(`团队现有 ${headcount} 名 AI 成员，宿主同时在跑上限 ${capacity}，加人后超出的部分会排队，提速有限`);
		return { ...entry, reasons, title: `建议加 ${entry.count} 名${who}：${reasons.join('；')}` };
	});
}
