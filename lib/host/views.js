/**
 * Read models derived from one Project's ledger state.
 *
 * These are pure functions: no I/O, no clocks beyond the passed `now`, no
 * new events. The Host routes and the workbench both consume the same shapes.
 */

const ACTIVE_MEMBER_STATUSES = new Set(['provisioning', 'running', 'idle']);

function nameOf(state, memberId) {
	if (memberId === null || memberId === undefined) return null;
	return state.members?.[memberId]?.name ?? memberId;
}

function isBlocked(state, task) {
	if (!Array.isArray(task.blockedBy) || task.blockedBy.length === 0) return false;
	return task.blockedBy.some((id) => {
		const dependency = state.tasks?.[id];
		return dependency === undefined || dependency.status !== 'done' || dependency.tombstone === true;
	});
}

function threadReplies(state, taskId) {
	return state.threads?.[taskId]?.headSeq ?? 0;
}

/** One compact Task card shared by board, quadrants and bootstrap. */
export function taskCard(state, task) {
	return {
		id: task.id,
		number: task.number ?? null,
		title: task.title ?? '',
		status: task.status,
		owner: nameOf(state, task.ownerId ?? task.accountableOwnerId),
		assignee: nameOf(state, task.assigneeId),
		replies: threadReplies(state, task.id),
		following: (state.followers?.[task.id] ?? []).length > 0,
		blockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
		blocked: isBlocked(state, task),
		revision: task.revision,
		resultDefinition: task.resultDefinition ?? '',
		irreversible: task.irreversible === true,
		qaRequired: task.qaRequired === true,
		updatedAt: task.updatedAt ?? null,
	};
}

/** Agent members that may still be asked to review (not retired/failed). */
function eligibleAgents(state, task) {
	const claimed = new Set(Array.isArray(task.claimHistory) ? task.claimHistory : []);
	return Object.values(state.members ?? {}).filter((member) => {
		if (member.kind === 'human') return false;
		if (!ACTIVE_MEMBER_STATUSES.has(member.status)) return false;
		if (member.id === task.assigneeId) return false;
		return !claimed.has(member.id);
	});
}

function doneAt(task) {
	return task.acceptedAt ?? task.updatedAt ?? 0;
}

/** Four-column board, pending/blocked split by badge not by column. */
export function boardView(state, options = {}) {
	const doneLimit = Number.isSafeInteger(options.doneLimit) && options.doneLimit > 0 ? options.doneLimit : 50;
	const tasks = Object.values(state.tasks ?? {}).filter((task) => task.tombstone !== true);
	const buckets = { todo: [], in_progress: [], pending_acceptance: [], done: [] };
	for (const task of tasks) {
		if (task.status === 'pending') buckets.todo.push(task);
		else if (task.status === 'in_progress') buckets.in_progress.push(task);
		else if (task.status === 'pending_acceptance') buckets.pending_acceptance.push(task);
		else if (task.status === 'done') buckets.done.push(task);
	}
	buckets.done.sort((left, right) => doneAt(right) - doneAt(left));
	const doneTotal = buckets.done.length;
	const todo = buckets.todo
		.sort((left, right) => (left.number ?? 0) - (right.number ?? 0))
		.map((task) => taskCard(state, task));
	const inProgress = buckets.in_progress
		.sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0))
		.map((task) => taskCard(state, task));
	const pendingAcceptance = buckets.pending_acceptance
		.sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0))
		.map((task) => taskCard(state, task));
	const done = buckets.done.slice(0, doneLimit).map((task) => taskCard(state, task));
	return {
		rev: state.lastSeq ?? 0,
		columns: { todo, in_progress: inProgress, pending_acceptance: pendingAcceptance, done },
		counts: {
			todo: todo.length,
			in_progress: inProgress.length,
			pending_acceptance: pendingAcceptance.length,
			done: doneTotal,
		},
		blockedCount: [...buckets.todo, ...buckets.pending_acceptance].filter((task) => isBlocked(state, task)).length,
		doneHasMore: doneTotal > done.length,
		doneLimit,
	};
}

function quadrantItem(state, task, category) {
	return {
		id: task.id,
		kind: 'task',
		category,
		title: task.title ?? '',
		taskId: task.id,
		taskNumber: task.number ?? null,
		ownerName: nameOf(state, task.ownerId ?? task.accountableOwnerId),
		assigneeName: nameOf(state, task.assigneeId),
		waitingSince: task.updatedAt ?? null,
		doneAt: category === 'done' ? doneAt(task) : null,
		evidenceCount: Array.isArray(task.evidence) ? task.evidence.length : 0,
	};
}

/**
 * Four quadrants by attention, not by priority:
 * Q1 needs you, Q2 in motion, Q3 waiting/blocked, Q4 recently done.
 * One Task appears in exactly one quadrant (Q1 > Q3 > Q2 > Q4).
 */
export function quadrantsView(state, options = {}) {
	const now = Number.isFinite(options.now) ? options.now : Date.now();
	const q4Limit = Number.isSafeInteger(options.q4Limit) && options.q4Limit > 0 ? Math.min(options.q4Limit, 50) : 20;
	const q4Days = Number.isFinite(options.q4Days) && options.q4Days > 0 ? options.q4Days : 7;
	const humanId = options.humanMemberId ?? state.humanMemberId ?? 'mem_human';
	const cutoff = now - q4Days * 24 * 60 * 60 * 1000;

	const tasks = Object.values(state.tasks ?? {}).filter((task) => task.tombstone !== true);
	const used = new Set();
	const q1 = [];
	const q2 = [];
	const q3 = [];
	const q4 = [];

	for (const task of tasks) {
		if (task.status !== 'pending_acceptance') continue;
		const agents = eligibleAgents(state, task);
		const humanMustReview = agents.length === 0 || task.irreversible === true || task.assigneeId === humanId;
		if (humanMustReview) {
			q1.push(quadrantItem(state, task, task.irreversible ? 'irreversible' : 'review'));
			used.add(task.id);
		}
	}

	for (const item of Object.values(state.inbox ?? {})) {
		if (item.memberId !== humanId || item.requiresDecision !== true) continue;
		if (item.state === 'resolved' || item.state === 'dismissed' || item.state === 'superseded') continue;
		q1.push({
			id: item.id,
			kind: 'inbox',
			category: 'decision',
			title: item.type ?? 'decision_required',
			taskId: item.ref?.taskId ?? null,
			taskNumber: null,
			ownerName: null,
			assigneeName: null,
			waitingSince: item.createdAt ?? null,
			doneAt: null,
			evidenceCount: 0,
		});
	}

	for (const task of tasks) {
		if (used.has(task.id)) continue;
		if (task.status === 'pending' && task.ownerId === humanId && isBlocked(state, task)) {
			q1.push(quadrantItem(state, task, 'owner_blocked'));
			used.add(task.id);
		}
	}

	for (const task of tasks) {
		if (used.has(task.id)) continue;
		if (task.status === 'in_progress') {
			q2.push(quadrantItem(state, task, 'in_progress'));
			used.add(task.id);
		}
	}

	for (const task of tasks) {
		if (used.has(task.id)) continue;
		if (task.status === 'pending' && isBlocked(state, task)) {
			q3.push(quadrantItem(state, task, 'blocked'));
			used.add(task.id);
		}
	}

	for (const task of tasks) {
		if (used.has(task.id)) continue;
		const at = doneAt(task);
		if (task.status === 'done' && at >= cutoff) {
			q4.push(quadrantItem(state, task, 'done'));
			used.add(task.id);
		}
	}

	const byWaiting = (left, right) => (left.waitingSince ?? 0) - (right.waitingSince ?? 0);
	const q1Rank = { irreversible: 0, review: 1, decision: 2, owner_blocked: 3 };
	q1.sort((left, right) => (q1Rank[left.category] - q1Rank[right.category]) || byWaiting(left, right));
	q2.sort((left, right) => (right.waitingSince ?? 0) - (left.waitingSince ?? 0));
	q3.sort(byWaiting);
	q4.sort((left, right) => (right.doneAt ?? 0) - (left.doneAt ?? 0));
	const q4Total = q4.length;
	return {
		rev: state.lastSeq ?? 0,
		generatedAt: now,
		q1: { count: q1.length, items: q1.slice(0, 5) },
		q2: { count: q2.length, items: q2.slice(0, 5) },
		q3: { count: q3.length, items: q3.slice(0, 5) },
		q4: { count: q4Total, items: q4.slice(0, 5), total: q4Total, limit: q4Limit },
	};
}
