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
			const picked = options
				.map((option) => ({ option, score: scoreOption(option, question) }))
				.sort((left, right) => right.score - left.score)[0];
			return { id, value: picked?.option || recommendation || '按完整核心方案执行' };
		}
		return { id, value: recommendation || '按完整、可验收、长期价值最高的方案执行' };
	});
}
