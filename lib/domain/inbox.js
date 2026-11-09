import { ERRORS, fail } from './errors.js';
import { ids } from './ids.js';

/** The 12 closed inbox types from 02 FR-028. */
export const INBOX_TYPES = new Set([
	'mention',
	'assigned',
	'handoff',
	'review_requested',
	'review_result',
	'task_blocked',
	'dependency_cleared',
	'member_stalled',
	'project_recovered',
	'followed_task_update',
	'decision_required',
	'stale_reply_rejected',
]);

export const DECISION_TYPES = new Set(['decision_required']);

/**
 * Create one inbox item. It points at a source object; it is not a copy of the
 * message body (the reader pulls the source on demand).
 */
export function createInboxItem(input, options = {}) {
	if (typeof input.memberId !== 'string' || input.memberId === '') fail(ERRORS.INVALID_ARGUMENT, 'memberId is required');
	if (!INBOX_TYPES.has(input.type)) fail(ERRORS.INVALID_ARGUMENT, `unknown inbox type: ${String(input.type)}`);
	if (input.ref === undefined || input.ref === null) fail(ERRORS.INVALID_ARGUMENT, 'ref is required');
	const requiresDecision = input.requiresDecision ?? DECISION_TYPES.has(input.type);
	return {
		id: input.id ?? ids.inbox(),
		memberId: input.memberId,
		type: input.type,
		ref: input.ref,
		requiresDecision,
		state: 'unread',
		createdAt: options.at ?? Date.now(),
		ackedAt: null,
		disposition: null,
	};
}

/**
 * Acknowledge one item. Decision items may be marked read but cannot be marked
 * done without an explicit decision; they can never be bulk-acked.
 */
export function ackInboxItem(item, input, options = {}) {
	if (item.state === 'resolved' || item.state === 'dismissed' || item.state === 'superseded') return item;
	const disposition = input.disposition ?? 'read';
	if (disposition !== 'read' && disposition !== 'done' && disposition !== 'dismiss') {
		fail(ERRORS.INVALID_ARGUMENT, 'disposition must be read, done or dismiss');
	}
	if (item.requiresDecision && disposition === 'done' && input.decision === undefined) {
		fail(ERRORS.INVALID_STATE, 'a decision item requires an explicit decision before it can be done', {
			details: { itemId: item.id },
		});
	}
	return {
		...item,
		state: disposition === 'done' ? 'resolved' : disposition === 'dismiss' ? 'dismissed' : 'read',
		disposition,
		decision: input.decision ?? null,
		ackedAt: options.at ?? Date.now(),
	};
}

/** Bulk read only touches non-decision items; decision items stay unread. */
export function markAllRead(items, options = {}) {
	let changed = 0;
	const next = items.map((item) => {
		if (item.state !== 'unread' || item.requiresDecision) return item;
		changed += 1;
		return { ...item, state: 'read', disposition: 'read', ackedAt: options.at ?? Date.now() };
	});
	return { items: next, changed };
}

/** Five fixed Human-inbox groups, in product order. */
export function inboxGroup(item) {
	if (item.requiresDecision) return 'needs_decision';
	if (item.type === 'review_requested') return 'needs_review';
	if (item.type === 'mention') return 'mentions';
	if (item.type === 'followed_task_update') return 'following';
	if (item.type === 'member_stalled' || item.type === 'project_recovered' || item.type === 'task_blocked') return 'failures';
	return 'other';
}
