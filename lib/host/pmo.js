/**
 * PMO decision policy.
 *
 * Human is not in the loop when PMO auto mode is on: choose the recommendation
 * when one exists, otherwise choose the option that protects delivery value
 * (complete/core) over minimum-effort options. The answer is intentionally
 * explicit so it is auditable in the Task Thread.
 */

const LOW_VALUE = /最小|暂缓|延后|不做|暂停|维持现状|先不|仅文档|只做骨架/i;
const HIGH_VALUE = /完整|核心|全量|推荐|生产可用|全平台|优先/i;

function clean(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** 选项开头的字母编号（`B.` / `B、` / `B)` / `B：`）。 */
function optionLetter(value) {
	const match = /^\s*[（(]?([A-Za-z])[)）.．、:：]/.exec(value);
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
	const letter = recommendationLetter(recommendation);
	if (letter !== null) {
		const byLetter = options.find((option) => optionLetter(option) === letter);
		if (byLetter !== undefined) return byLetter;
	}
	return options.find((option) => recommendation.includes(option) || option.includes(recommendation)) ?? null;
}

function scoreOption(option, question) {
	const value = clean(option);
	if (value === '') return -100;
	let score = 0;
	if (/推荐/i.test(value)) score += 20;
	if (HIGH_VALUE.test(value)) score += 12;
	if (/B\b|C\b|核心|完整/i.test(value)) score += 6;
	if (LOW_VALUE.test(value)) score -= 20;
	if (/A\b|最小/i.test(value)) score -= 8;
	const recommendation = clean(question?.recommendation);
	if (recommendation !== '' && recommendation.includes(value)) score += 30;
	if (recommendation !== '' && value.includes(recommendation)) score += 20;
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
				.map((option) => ({ option, score: scoreOption(option, question) }))
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
