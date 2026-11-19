import { ERRORS, fail } from './errors.js';
import { isQaMember, isReviewerMember } from './member-profile.js';

/** @typedef {{ kind: 'human'|'agent'|'system', memberId?: string }} Actor */

/** Member statuses allowed to hold work or review; failed members are out. */
export const ACTIVE_MEMBER_STATUSES = Object.freeze(['provisioning', 'running', 'idle']);

/**
 * The single authority for "which Agent may review this Task" (INV-04/Q-05):
 * active, not the current assignee, never a past claimant. QA-required Tasks
 * narrow candidates to QA members. The command layer additionally resolves the
 * acting member; Human review is the fallback (policy reasons live in
 * reviewEligibility below).
 */
/** 项目主理人（账本 owner）的成员 id；一个账本一个项目。 */
export function projectOwnerId(state) {
	const project = Object.values(state?.projects ?? {})[0];
	return project?.ownerMemberId ?? project?.ownerId ?? null;
}

/**
 * 主理人只调度交付，不核对产出（用户 2026-11-18）：项目 owner 或团队里职责是 lead 的成员。
 * 他们不进验收候选，也不能对别人的产出验收/退回——内容核对整体归验收人。
 */
export function isLeadMember(member, state) {
	if (member?.kind !== 'agent') return false;
	if (member.duty === 'lead') return true;
	const owner = projectOwnerId(state);
	return owner !== null && member.id === owner;
}

export function isReviewCandidate(member, task, state = null) {
	if (member?.kind !== 'agent') return false;
	if (state !== null && isLeadMember(member, state)) return false;
	if (!ACTIVE_MEMBER_STATUSES.includes(member.status)) return false;
	if (member.id === task.assigneeId) return false;
	if (Array.isArray(task.claimHistory) && task.claimHistory.includes(member.id)) return false;
	if (task.qaRequired === true && !isQaMember(member)) return false;
	return true;
}

/**
 * Ranked review candidates for the Waker: QA first, then reviewer roles,
 * then any other eligible Agent. Older members win ties.
 */
export function eligibleReviewers(state, task) {
	if (task === undefined || task === null) return [];
	const candidates = Object.values(state.members ?? {}).filter((member) => isReviewCandidate(member, task, state));
	const rank = (member) => (isQaMember(member) ? 0 : isReviewerMember(member) ? 1 : 2);
	return candidates.sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** 按入队先后排：createdAt，其次 id（稳定，不随状态抖动）。 */
const byJoin = (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id));

/**
 * 团队里干活的两类人（配对、空闲派活共用这一份判定）：在岗（provisioning/running/idle）、不是主理人的 Agent，
 * 验收人（isQaMember）归 qas，其余归 developers；各按入队先后排。
 * @returns {{ developers: any[], qas: any[] }}
 */
export function teamRoles(state) {
	const active = Object.values(state?.members ?? {})
		.filter((member) => member?.kind === 'agent' && ACTIVE_MEMBER_STATUSES.includes(member.status) && !isLeadMember(member, state));
	return {
		developers: active.filter((member) => !isQaMember(member)).sort(byJoin),
		qas: active.filter((member) => isQaMember(member)).sort(byJoin),
	};
}

/**
 * 开发↔验收配对（用户 2026-11-20：开发与验收 1:1 配对；只有 1 个验收人就都配给他、排队）。
 *
 * 开发 = 在岗的 Agent 里既不是主理人也不是验收人的；验收 = 在岗的验收人（isQaMember）。两边各按入队先后排，
 * 第 i 个开发配第 (i mod 验收人数) 个验收：验收人数 = 开发数时严格 1:1；只有 1 个验收人时所有开发都配给他；
 * 验收人少于开发时尽量平均。新加的人排在队尾，已有配对不变。
 * @returns {Map<string, string>} 开发 memberId → 验收 memberId；没有验收人时为空
 */
export function reviewPairs(state) {
	const { developers, qas } = teamRoles(state);
	const pairs = new Map();
	if (qas.length === 0) return pairs;
	developers.forEach((developer, index) => pairs.set(developer.id, qas[index % qas.length].id));
	return pairs;
}

/**
 * 这张待验收卡该叫谁验：交活人的配对验收人；他不合格（就是交活人、碰过这张卡、不在岗、不是 QA 而卡要求 QA）
 * 时退回原排名（QA 优先、入队早的优先）的第一位。
 */
export function pairedReviewer(state, task) {
	if (task === undefined || task === null) return undefined;
	const pairedId = reviewPairs(state).get(task.assigneeId);
	const paired = pairedId === undefined ? undefined : state.members?.[pairedId];
	if (paired !== undefined && isReviewCandidate(paired, task, state)) return paired;
	return eligibleReviewers(state, task)[0];
}

export function isHuman(actor) {
	return actor?.kind === 'human';
}

export function memberIdOf(actor) {
	return actor?.memberId ?? null;
}

export function assertRevision(task, expectedRevision) {
	if (expectedRevision === undefined || expectedRevision === null) return;
	if (task.revision !== expectedRevision) {
		fail(ERRORS.REVISION, `task ${task.id} revision ${String(expectedRevision)} is stale; current is ${String(task.revision)}`, {
			details: { taskId: task.id, expectedRevision, currentRevision: task.revision },
		});
	}
}

export function isOwnerOrHuman(task, actor) {
	return isHuman(actor) || (memberIdOf(actor) !== null && task.ownerId === memberIdOf(actor));
}

export function assertOwnerOrHuman(task, actor) {
	if (!isOwnerOrHuman(task, actor)) {
		fail(ERRORS.UNAUTHORIZED, 'only the accountable owner or Human may perform this action', {
			details: { taskId: task.id, ownerId: task.ownerId, actor: memberIdOf(actor) },
		});
	}
}

export function assertAssignee(task, actor) {
	if (memberIdOf(actor) === null || task.assigneeId !== memberIdOf(actor)) {
		fail(ERRORS.UNAUTHORIZED, 'only the current assignee may perform this action', {
			details: { taskId: task.id, assigneeId: task.assigneeId, actor: memberIdOf(actor) },
		});
	}
}

/**
 * 写入范围（用户 2026-11-20：多人并行写代码要防互相覆盖）。范围是工作区里的相对路径——文件或目录，
 * `/` 或 `\` 分隔都行，末尾的 `/`、`/*`、`/**` 视为整个目录；`.` 或空串是整个工作区。比较不分大小写
 * （Windows 工作区）。两个范围重叠 = 一个是另一个本身或其下级。
 */
export function normalizeScope(scope) {
	const text = String(scope ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/(\/\*\*?)+$/, '').replace(/^\.\//, '').replace(/\/$/, '');
	return text === '.' ? '' : text.toLowerCase();
}

export function scopesOverlap(left, right) {
	const a = normalizeScope(left);
	const b = normalizeScope(right);
	if (a === '' || b === '') return true;
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * 这张卡的写入范围和别人正在做（in_progress）的卡重叠：返回第一张冲突卡与重叠的那对范围；没声明范围的卡不参与判定。
 * @returns {{ task: any, mine: string, theirs: string } | undefined}
 */
export function writeScopeConflict(task, tasksById) {
	const mine = task?.writeScopes ?? [];
	if (mine.length === 0) return undefined;
	for (const other of Object.values(tasksById ?? {})) {
		if (other === task || other.id === task.id || other.status !== 'in_progress' || other.tombstone === true) continue;
		for (const theirs of other.writeScopes ?? []) {
			const hit = mine.find((scope) => scopesOverlap(scope, theirs));
			if (hit !== undefined) return { task: other, mine: hit, theirs };
		}
	}
	return undefined;
}

export function dependenciesDone(task, tasksById) {
	return (task.blockedBy ?? []).every((id) => tasksById?.[id]?.status === 'done');
}

export function memberHasInProgress(tasksById, memberId) {
	if (memberId === null) return undefined;
	return Object.values(tasksById ?? {}).find((candidate) => candidate.assigneeId === memberId && candidate.status === 'in_progress');
}

/** A member must not start the next Task while their previous Task awaits QA. */
export function memberHasPendingAcceptance(tasksById, memberId) {
	if (memberId === null) return undefined;
	return Object.values(tasksById ?? {}).find((candidate) => candidate.assigneeId === memberId && candidate.status === 'pending_acceptance');
}

/**
 * A reviewer is eligible when the task is in pending_acceptance and the
 * reviewer never claimed it (Agent) or is Human. Human self-accept is allowed
 * but must be recorded as non-independent.
 */
export function reviewEligibility(task, actor) {
	if (task.status !== 'pending_acceptance') {
		return { eligible: false, reason: 'task is not pending_acceptance', code: ERRORS.INVALID_STATE };
	}
	const memberId = memberIdOf(actor);
	if (isHuman(actor)) {
		return {
			eligible: true,
			selfExecuted: memberId !== null && task.claimHistory.includes(memberId),
			reason: 'human fallback',
		};
	}
	if (memberId === null) {
		return { eligible: false, reason: 'unknown member', code: ERRORS.UNAUTHORIZED };
	}
	if (task.assigneeId === memberId) {
		return { eligible: false, reason: 'current assignee cannot review', code: ERRORS.NOT_ELIGIBLE };
	}
	if (task.claimHistory.includes(memberId)) {
		return { eligible: false, reason: 'a past claimant cannot review', code: ERRORS.NOT_ELIGIBLE };
	}
	return { eligible: true, selfExecuted: false, reason: 'independent reviewer' };
}

export function assertReviewEligible(task, actor) {
	const result = reviewEligibility(task, actor);
	if (!result.eligible) {
		fail(result.code ?? ERRORS.NOT_ELIGIBLE, result.reason ?? 'reviewer is not eligible', {
			details: { taskId: task.id, actor: memberIdOf(actor) },
		});
	}
	return result;
}

export function assertIrreversibleConfirmation(task, actor, confirmed) {
	if (!task.irreversible) return;
	if (!isHuman(actor)) {
		fail(ERRORS.IRREVERSIBLE_CONFIRM, 'an Agent may only suggest acceptance for an irreversible Task', {
			details: { taskId: task.id },
		});
	}
	if (confirmed !== true) {
		fail(ERRORS.IRREVERSIBLE_CONFIRM, 'Human confirmation is required for an irreversible Task', {
			details: { taskId: task.id },
		});
	}
}
