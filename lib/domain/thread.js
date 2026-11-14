import { ERRORS, fail } from './errors.js';

/** A thread is one append-only conversation attached to a Task. */
export function createThread(taskId) {
	return { taskId, headSeq: 0, entries: [] };
}

/**
 * Append a reply. `baseSeq` is the head the author read; it is recorded on the
 * entry, and every entry that landed after it comes back as `missed`, so the
 * author learns what it did not see and can follow up if that changes its view.
 *
 * A stale `baseSeq` used to be rejected (E_STALE_REPLY). In a meeting five
 * members read the same head and answer at once: only the first got through,
 * the rest re-read, re-wrote and lost again ("三次回帖均因会议并发被拒";
 * r09: 46 rejections in one round). The reply itself was never wrong — only
 * late — so it is accepted and the gap is reported instead.
 */
export function appendReply(thread, input, options = {}) {
	const body = typeof input.body === 'string' ? input.body.trim() : '';
	if (body === '') fail(ERRORS.INVALID_ARGUMENT, 'reply body is required');
	if (body.length > 16_384) fail(ERRORS.INVALID_ARGUMENT, 'reply body is too long');
	if (typeof input.authorId !== 'string' || input.authorId === '') fail(ERRORS.INVALID_ARGUMENT, 'authorId is required');
	const baseSeq = input.baseSeq ?? 0;
	if (!Number.isSafeInteger(baseSeq) || baseSeq < 0) fail(ERRORS.INVALID_ARGUMENT, 'baseSeq must be a non-negative integer');
	if (baseSeq > thread.headSeq) fail(ERRORS.INVALID_ARGUMENT, 'baseSeq is ahead of the thread head');
	const missed = entriesSince(thread, baseSeq);
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
		missed,
	};
}

/** Entries after `baseSeq`, reported as `missed` on a late reply and used by the UI diff. */
export function entriesSince(thread, baseSeq) {
	return thread.entries.filter((entry) => entry.seq > baseSeq);
}
