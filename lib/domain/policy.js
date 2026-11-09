import { ERRORS, fail } from './errors.js';

/** @typedef {{ kind: 'human'|'agent'|'system', memberId?: string }} Actor */

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

export function dependenciesDone(task, tasksById) {
	return (task.blockedBy ?? []).every((id) => tasksById?.[id]?.status === 'done');
}

export function memberHasInProgress(tasksById, memberId) {
	if (memberId === null) return undefined;
	return Object.values(tasksById ?? {}).find((candidate) => candidate.assigneeId === memberId && candidate.status === 'in_progress');
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
