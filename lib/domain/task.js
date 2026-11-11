import { ERRORS, fail } from './errors.js';
import { ids } from './ids.js';
import {
	assertAssignee,
	assertIrreversibleConfirmation,
	assertOwnerOrHuman,
	assertReviewEligible,
	assertRevision,
	dependenciesDone,
	memberHasInProgress,
	memberHasPendingAcceptance,
} from './policy.js';

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {number} number
 * @property {string} title
 * @property {string} resultDefinition
 * @property {'pending'|'in_progress'|'pending_acceptance'|'done'|'cancelled'|'deleted'} status
 * @property {string} ownerId
 * @property {string|null} assigneeId
 * @property {string[]} blockedBy
 * @property {string[]} writeScopes
 * @property {string[]} claimHistory
 * @property {number} reviewRound
 * @property {number} revision
 * @property {boolean} irreversible
 * @property {Array<{kind:string,value:string}>} evidence
 * @property {string} summary
 * @property {string|null} reviewerId
 * @property {string[]} originRefs
 */

const requireText = (value, field, max = 16_384) => {
	if (typeof value !== 'string' || value.trim() === '') {
		fail(ERRORS.INVALID_ARGUMENT, `${field} is required`);
	}
	if (value.length > max) fail(ERRORS.INVALID_ARGUMENT, `${field} is too long (max ${String(max)})`);
	return value.trim();
};

// 理由类可选文本：留空/缺省返回空串（事件里统一为 ''，不缺字段）。
const optionalText = (value, field, max = 16_384) => {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') fail(ERRORS.INVALID_ARGUMENT, `${field} must be a string`);
	if (value.length > max) fail(ERRORS.INVALID_ARGUMENT, `${field} is too long (max ${String(max)})`);
	return value.trim();
};

const next = (task, patch) => ({ ...task, ...patch, revision: task.revision + 1 });

/**
 * Create a task in `pending`; the creator becomes the accountable owner unless
 * an explicit owner is supplied. Only Human or a Team member should reach this
 * function; the service enforces membership.
 */
export function createTask(input) {
	const task = {
		id: input.id ?? ids.task(),
		number: input.number,
		title: requireText(input.title, 'title', 200),
		resultDefinition: requireText(input.resultDefinition, 'resultDefinition'),
		status: 'pending',
		ownerId: input.ownerId,
		assigneeId: input.assigneeId ?? null,
		blockedBy: [...(input.blockedBy ?? [])],
		writeScopes: [...(input.writeScopes ?? [])],
		claimHistory: [],
		reviewRound: 0,
		revision: 1,
		irreversible: input.irreversible === true,
		qaRequired: input.qaRequired === true,
		qaChecklist: Array.isArray(input.qaChecklist) ? input.qaChecklist.slice(0, 12) : [],
		humanExecuted: false,
		evidence: [],
		summary: '',
		reviewerId: null,
		originRefs: [...(input.originRefs ?? [])],
		createdAt: input.at ?? Date.now(),
		updatedAt: input.at ?? Date.now(),
	};
	if (!Number.isSafeInteger(task.number) || task.number < 1) {
		fail(ERRORS.INVALID_ARGUMENT, 'task number must be a positive safe integer');
	}
	if (typeof task.ownerId !== 'string' || task.ownerId === '') {
		fail(ERRORS.INVALID_ARGUMENT, 'ownerId is required');
	}
	return {
		task,
		event: { type: 'task/created', payload: { ...task, taskId: task.id } },
	};
}

/** A member claims a ready pending task; only `claim` enters claimHistory. */
export function claimTask(task, actor, tasksById, options = {}) {
	assertRevision(task, options.expectedRevision);
	if (task.status !== 'pending') {
		fail(ERRORS.INVALID_STATE, `task ${task.id} is not pending`, { details: { status: task.status } });
	}
	const memberId = actor?.memberId;
	if ((actor?.kind !== 'agent' && actor?.kind !== 'human') || typeof memberId !== 'string') {
		fail(ERRORS.UNAUTHORIZED, 'only a Team member can claim a task');
	}
	if (task.assigneeId !== null && task.assigneeId !== memberId) {
		fail(ERRORS.ALREADY_CLAIMED, 'task is assigned to another member', {
			details: { taskId: task.id, assigneeId: task.assigneeId },
		});
	}
	if (!dependenciesDone(task, tasksById)) {
		fail(ERRORS.BLOCKED, 'task has unfinished dependencies', {
			details: { taskId: task.id, blockedBy: task.blockedBy },
		});
	}
	const awaiting = memberHasPendingAcceptance(tasksById, memberId);
	if (awaiting !== undefined) {
		fail(ERRORS.CONFLICT, 'member has a task awaiting acceptance; wait for QA before claiming the next one', {
			details: { memberId, taskId: awaiting.id },
		});
	}
	const busy = memberHasInProgress(tasksById, memberId);
	if (busy !== undefined) {
		fail(ERRORS.CONFLICT, 'member already has an in_progress task', {
			details: { memberId, taskId: busy.id },
		});
	}
	const patch = {
		status: 'in_progress',
		assigneeId: memberId,
		claimHistory: task.claimHistory.includes(memberId) ? task.claimHistory : [...task.claimHistory, memberId],
		updatedAt: options.at ?? Date.now(),
	};
	const updated = next(task, patch);
	return {
		task: updated,
		event: {
			type: 'task/claimed',
			payload: {
				taskId: task.id,
				revision: updated.revision,
				assigneeId: memberId,
				claimHistory: updated.claimHistory,
			},
		},
	};
}

/** The assignee returns the task to the pool; claimHistory is never cleared. */
export function releaseTask(task, actor, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertAssignee(task, actor);
	if (task.status !== 'in_progress') {
		fail(ERRORS.INVALID_STATE, 'only an in_progress task can be released');
	}
	const updated = next(task, {
		status: 'pending',
		assigneeId: null,
		updatedAt: options.at ?? Date.now(),
	});
	return {
		task: updated,
		event: { type: 'task/released', payload: { taskId: task.id, revision: updated.revision, reason: options.reason ?? '' } },
	};
}

/** Pre-assign an executor without claiming; only the owner or Human may do it. */
export function assignTask(task, actor, assigneeId, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertOwnerOrHuman(task, actor);
	if (task.status !== 'pending') fail(ERRORS.INVALID_STATE, 'only a pending task can be assigned');
	if (typeof assigneeId !== 'string' || assigneeId === '') fail(ERRORS.INVALID_ARGUMENT, 'assigneeId is required');
	const updated = next(task, { assigneeId, updatedAt: options.at ?? Date.now() });
	return {
		task: updated,
		event: { type: 'task/assigned', payload: { taskId: task.id, revision: updated.revision, assigneeId, by: actor.memberId ?? 'human' } },
	};
}

/** Submit the current assignment for acceptance. Evidence is mandatory. */
export function submitTask(task, actor, input, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertAssignee(task, actor);
	if (task.status !== 'in_progress') fail(ERRORS.INVALID_STATE, 'only an in_progress task can be submitted');
	const summary = requireText(input.summary, 'summary', 8_000);
	const evidence = Array.isArray(input.evidence) ? input.evidence : [];
	if (evidence.length < 1) fail(ERRORS.INVALID_ARGUMENT, 'at least one evidence item is required');
	const updated = next(task, {
		status: 'pending_acceptance',
		summary,
		evidence: [...evidence],
		reviewerId: null,
		humanExecuted: task.humanExecuted === true || actor.kind === 'human',
		updatedAt: options.at ?? Date.now(),
	});
	return {
		task: updated,
		event: {
			type: 'task/submitted',
			payload: { taskId: task.id, revision: updated.revision, summary, evidence },
		},
	};
}

/**
 * Accept a pending_acceptance task. Agents must be independent (never claimed);
 * Human may self-accept but it is recorded as `review/human_self_accept` and is
 * not independent. Irreversible tasks require explicit Human confirmation.
 */
export function acceptTask(task, actor, input, options = {}) {
	assertRevision(task, options.expectedRevision);
	const eligibility = assertReviewEligible(task, actor);
	assertIrreversibleConfirmation(task, actor, input.confirmed);
	const selfExecuted = eligibility.selfExecuted === true || task.humanExecuted === true;
	const updated = next(task, {
		status: 'done',
		reviewerId: actor.memberId ?? 'human',
		reviewRound: task.reviewRound + 1,
		qaChecks: Array.isArray(input.qaChecks) ? input.qaChecks : [],
		updatedAt: options.at ?? Date.now(),
	});
	return {
		task: updated,
		event: {
			type: selfExecuted ? 'review/human_self_accept' : 'task/accepted',
			payload: {
				taskId: task.id,
				revision: updated.revision,
				reviewerId: updated.reviewerId,
				note: input.note ?? '',
				selfExecuted,
				...(Array.isArray(input.qaChecks) && input.qaChecks.length > 0 ? { qaChecks: input.qaChecks } : {}),
			},
		},
	};
}

/** Request changes; the task returns to in_progress and keeps its assignee. */
export function requestChangesTask(task, actor, input, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertReviewEligible(task, actor);
	const note = requireText(input.note, 'note', 8_000);
	const updated = next(task, {
		status: 'in_progress',
		reviewerId: actor.memberId ?? 'human',
		reviewRound: task.reviewRound + 1,
		updatedAt: options.at ?? Date.now(),
	});
	return {
		task: updated,
		event: {
			type: 'task/changes-requested',
			payload: { taskId: task.id, revision: updated.revision, reviewerId: updated.reviewerId, note, round: updated.reviewRound },
		},
	};
}

/** Cancel is reserved to the accountable owner and Human. */
export function cancelTask(task, actor, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertOwnerOrHuman(task, actor);
	if (task.status === 'done') fail(ERRORS.INVALID_STATE, 'a done task must be reopened before it can be cancelled');
	if (task.status === 'cancelled' || task.tombstone === true) {
		fail(ERRORS.INVALID_STATE, 'task is already terminal');
	}
	const reason = optionalText(options.reason, 'reason', 2_000);
	const updated = next(task, { status: 'cancelled', updatedAt: options.at ?? Date.now() });
	return {
		task: updated,
		event: { type: 'task/cancelled', payload: { taskId: task.id, revision: updated.revision, reason } },
	};
}

/** Reopen a done or pending_acceptance task; owner/Human only. */
export function reopenTask(task, actor, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertOwnerOrHuman(task, actor);
	if (task.status !== 'done' && task.status !== 'pending_acceptance') {
		fail(ERRORS.INVALID_STATE, 'only done or pending_acceptance tasks can be reopened');
	}
	const reason = optionalText(options.reason, 'reason', 2_000);
	const assignee = task.assigneeId === null ? null : options.members?.[task.assigneeId] ?? null;
	const assigneeInvalid =
		assignee !== null && (assignee.status === 'retired' || assignee.status === 'unavailable' || assignee.status === 'failed');
	const status = task.assigneeId === null || assigneeInvalid ? 'pending' : 'in_progress';
	const updated = next(task, {
		status,
		assigneeId: status === 'pending' ? null : task.assigneeId,
		updatedAt: options.at ?? Date.now(),
	});
	return {
		task: updated,
		event: {
			type: 'task/reopened',
			payload: { taskId: task.id, revision: updated.revision, reason, status, assigneeId: updated.assigneeId },
		},
	};
}

/** Transfer accountability; does not change the executor or claimHistory. */
export function reassignTask(task, actor, newOwnerId, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertOwnerOrHuman(task, actor);
	if (typeof newOwnerId !== 'string' || newOwnerId === '') fail(ERRORS.INVALID_ARGUMENT, 'newOwnerId is required');
	if (newOwnerId === task.ownerId) fail(ERRORS.INVALID_ARGUMENT, 'new owner equals current owner');
	// fold's applyTaskReassigned drops the event for any other status; failing here
	// keeps the domain contract identical to the projection instead of reporting a
	// change that never lands (and bumping revision past the committed one).
	if (task.status !== 'pending' && task.status !== 'in_progress' && task.status !== 'pending_acceptance') {
		fail(ERRORS.INVALID_STATE, `owner cannot be reassigned while the task is ${task.status}`);
	}
	const updated = next(task, { ownerId: newOwnerId, updatedAt: options.at ?? Date.now() });
	return {
		task: updated,
		event: { type: 'task/reassigned', payload: { taskId: task.id, revision: updated.revision, from: task.ownerId, to: newOwnerId, reason: options.reason ?? '' } },
	};
}

/** Delete only a never-claimed pending task; the tombstone keeps history. */
export function deleteTask(task, actor, options = {}) {
	assertRevision(task, options.expectedRevision);
	assertOwnerOrHuman(task, actor);
	if (task.status !== 'pending') fail(ERRORS.INVALID_STATE, 'only a pending task can be deleted');
	if (task.claimHistory.length > 0) fail(ERRORS.INVALID_STATE, 'a task that was ever claimed cannot be deleted; cancel it instead');
	// 02 §8.8 #5：deleted 是删除事件 + tombstone，不是第六种存储状态。
	const updated = next(task, { tombstone: true, updatedAt: options.at ?? Date.now() });
	return {
		task: updated,
		event: { type: 'task/deleted', payload: { taskId: task.id, revision: updated.revision, tombstone: true } },
	};
}
