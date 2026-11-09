import { ERRORS, fail } from './errors.js';

/** A thread is one append-only conversation attached to a Task. */
export function createThread(taskId) {
	return { taskId, headSeq: 0, entries: [] };
}

/**
 * Append a reply. Agents must reply against the current head; a stale baseSeq
 * is rejected with the entries that changed since the reader last looked.
 * Human replies bypass the check (the Human sees the live thread).
 */
export function appendReply(thread, input, options = {}) {
	const body = typeof input.body === 'string' ? input.body.trim() : '';
	if (body === '') fail(ERRORS.INVALID_ARGUMENT, 'reply body is required');
	if (body.length > 16_384) fail(ERRORS.INVALID_ARGUMENT, 'reply body is too long');
	if (typeof input.authorId !== 'string' || input.authorId === '') fail(ERRORS.INVALID_ARGUMENT, 'authorId is required');
	const baseSeq = input.baseSeq ?? 0;
	if (!Number.isSafeInteger(baseSeq) || baseSeq < 0) fail(ERRORS.INVALID_ARGUMENT, 'baseSeq must be a non-negative integer');
	if (baseSeq > thread.headSeq) fail(ERRORS.INVALID_ARGUMENT, 'baseSeq is ahead of the thread head');
	if (input.actorKind !== 'human' && baseSeq !== thread.headSeq) {
		const changed = thread.entries.filter((entry) => entry.seq > baseSeq);
		fail(ERRORS.STALE_REPLY, 'thread changed since you read it; re-read before replying', {
			details: {
				taskId: thread.taskId,
				baseSeq,
				headSeq: thread.headSeq,
				changes: changed.map((entry) => ({
					seq: entry.seq,
					authorId: entry.authorId,
					at: entry.at,
					excerpt: entry.body.slice(0, 200),
				})),
			},
		});
	}
	const entry = {
		seq: thread.headSeq + 1,
		authorId: input.authorId,
		baseSeq,
		body,
		at: options.at ?? Date.now(),
		refs: [...(input.refs ?? [])],
	};
	return {
		thread: { ...thread, headSeq: entry.seq, entries: [...thread.entries, entry] },
		entry,
	};
}

/** Entries after `baseSeq`, used by the stale-reply error and the UI diff. */
export function entriesSince(thread, baseSeq) {
	return thread.entries.filter((entry) => entry.seq > baseSeq);
}
