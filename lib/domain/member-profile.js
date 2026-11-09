/** Member profile semantics shared by the ledger, service, Waker and UI. */

const QA_PATTERN = /(^|[^a-z])(qa|quality|test|verification)([^a-z]|$)|质量|测试|验收/i;
const REVIEW_PATTERN = /review|验收|评审|审查/i;

export function isQaMember(member) {
	return typeof member?.role === 'string' && QA_PATTERN.test(member.role);
}

export function isReviewerMember(member) {
	return isQaMember(member) || (typeof member?.role === 'string' && REVIEW_PATTERN.test(member.role));
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
 */
export function eligibleReviewers(state, task) {
	if (task === undefined || task === null) return [];
	const candidates = Object.values(state.members ?? {}).filter((member) =>
		member.kind === 'agent'
		&& member.status !== 'retired'
		&& member.id !== task.assigneeId
		&& !(task.claimHistory ?? []).includes(member.id)
		&& (task.qaRequired !== true || isQaMember(member)));
	const rank = (member) => (isQaMember(member) ? 0 : isReviewerMember(member) ? 1 : 2);
	return candidates.sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
}
