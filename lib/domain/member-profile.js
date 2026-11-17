/** Member profile semantics shared by the ledger, service, Waker and UI. */

const QA_PATTERN = /(^|[^a-z])(qa|quality|test|verification)([^a-z]|$)|质量|测试|验收/i;
const REVIEW_PATTERN = /review|验收|评审|审查/i;

export function isQaMember(member) {
	// 团队里写明职责 qa 的（稽真·事实核查、评骘·同行评审）也是验收人：只看岗位名会把它们漏掉，
	// 验收提醒反而排到主理人头上。
	if (member?.duty === 'qa') return true;
	return typeof member?.role === 'string' && QA_PATTERN.test(member.role);
}

export function isReviewerMember(member) {
	return isQaMember(member) || (typeof member?.role === 'string' && REVIEW_PATTERN.test(member.role));
}

/**
 * 成员工作个性的长度上限（字符）。
 *
 * il2c 实账本：复盘后的 evolve 只增不减，玄策从 58 字长到 2386 字、墨渊 41 → 1604、评审官 1601，
 * 条目里堆满单张卡的教训与「候票零写窗」「候验窗冻树不写」这类等待规则，每次激活全部注入。
 * 个性是「多数任务都适用的工作方式」，不是事故台账。
 */
export const PERSONALITY_LIMIT = 600;

/**
 * evolve / distill 写入前的唯一校验：去空白、非空、不超过上限。
 * @returns {{ ok: true, personality: string } | { ok: false, reason: string }}
 */
export function checkPersonality(value) {
	const personality = typeof value === 'string' ? value.trim() : '';
	if (personality === '') return { ok: false, reason: 'personality is required' };
	if (personality.length > PERSONALITY_LIMIT) {
		return {
			ok: false,
			reason: `personality is ${personality.length} characters; the limit is ${PERSONALITY_LIMIT}. Rewrite the whole personality instead of appending: merge overlapping items, keep only ways of working that apply to most future tasks, drop single-task lessons and waiting/freeze rules, write plain Chinese.`,
		};
	}
	return { ok: true, personality };
}

/** Prompt prefix that makes a member's name/role/personality effective on wake. */
export function memberIdentity(member) {
	if (member === undefined || member === null) return '';
	const parts = [`你是 ${member.name ?? member.id}（${member.role || 'Team member'}）。`];
	if (typeof member.personality === 'string' && member.personality.trim() !== '') {
		parts.push(`你的个性与工作方式：${member.personality.trim()}`);
	}
	if (Array.isArray(member.skills) && member.skills.length > 0) {
		parts.push(`你的技能：${member.skills.join('、')}`);
	}
	if (Array.isArray(member.notes) && member.notes.length > 0) {
		parts.push(`你最近的备忘：${member.notes.slice(-5).join('；')}`);
	}
	if (isQaMember(member)) parts.push('你承担 QA 职责：优先独立复跑门禁、核对证据，再决定是否验收。');
	return parts.join('\n');
}

/** Unfinished work a leaving member leaves behind. */
export function unfinishedTasksFor(state, memberId) {
	return Object.values(state.tasks ?? {}).filter((task) => {
		if (task.tombstone === true || ['done', 'cancelled', 'deleted'].includes(task.status)) return false;
		return task.ownerId === memberId || task.assigneeId === memberId;
	});
}

/**
 * Pick an Agent eligible to review this task: not the assignee, never claimed,
 * active, QA first, then any reviewer-role member, then any other Agent.
 *
 * The rule itself lives in `policy.js` (single implementation for ledger,
 * views and Waker); this re-export keeps the historical import path stable.
 */
export { eligibleReviewers } from './policy.js';
