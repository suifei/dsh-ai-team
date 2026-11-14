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
	if (task.status === 'pending_acceptance' && task.qaRequired === true) {
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
