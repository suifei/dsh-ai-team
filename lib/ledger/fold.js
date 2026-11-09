/**
 * 纯 fold：把账本事件折叠成最小投影状态。
 *
 * 约束（03 §5.1 / §6.4）：
 * - 纯函数：不读 I/O、不抛业务错误；未知事件返回原引用。
 * - 同一事件重放幂等：state.lastSeq 单调，seq <= lastSeq 的事件直接忽略。
 * - Task 变更叠加 revision CAS：payload.revision <= task.revision 的陈旧事件不改状态。
 * - Task 字段与 02 §8 对齐；claimHistory 只追加，且只有 claim 进入（INV-07）。
 *
 * 同时兼容两种 payload 形态：
 * 1. 扁平字段（03 §6.3 的命令层）：`{taskId, revision, ...}`。
 * 2. 快照字段（lib/host/service.js 与 lib/domain/*）：`{task}` / `{entry}` / `{item}`
 *    / `{project}` / `{member}`。快照形态优先，保证 host service 写入的事件可被
 *    本 fold 直接重放成 UI 可读状态。
 *
 * 状态形状（纯 JSON，可整体写进 checkpoint.state）：
 * {
 *   lastSeq, lastHash,
 *   projects: { [projectId]: Project },
 *   members:  { [memberId]: Member },
 *   tasks:    { [taskId]: Task },
 *   threads:  { [taskId]: Thread },
 *   inbox:    { [itemId]: InboxItem },
 *   stream:   StreamEntry[],
 *   followers:{ [taskId]: memberId[] },
 *   humanMemberId: string|null
 * }
 *
 * Task 同时保留 `accountableOwnerId`（03 用语）与 `ownerId`（域层消费别名），
 * 两者由本文件同步维护。
 */

import { GENESIS_HASH, isPlainObject } from './events.js';

/** 投影状态版本；改动折叠语义时必须递增（03 §6.4）。 */
export const FOLD_STATE_VERSION = 1;

export const TASK_STATUS = Object.freeze({
	PENDING: 'pending',
	IN_PROGRESS: 'in_progress',
	PENDING_ACCEPTANCE: 'pending_acceptance',
	DONE: 'done',
	CANCELLED: 'cancelled',
	/** 02 §8.8 #5 的 tombstone；域层 task.js 也把它作为终态值。 */
	DELETED: 'deleted',
});

export const MEMBER_STATUS = Object.freeze({
	PROVISIONING: 'provisioning',
	RUNNING: 'running',
	IDLE: 'idle',
	FAILED: 'failed',
	RETIRED: 'retired',
});

const TASK_STATUS_VALUES = new Set(Object.values(TASK_STATUS));
const MEMBER_STATUS_VALUES = new Set(Object.values(MEMBER_STATUS));
const STREAM_KIND_VALUES = new Set([
	'human_message',
	'task_card',
	'acceptance',
	'handoff',
	'blocked_recovery',
	'milestone',
]);

const DISPOSITION_TO_STATE = Object.freeze({
	read: 'read',
	done: 'done',
	resolved: 'resolved',
	dismissed: 'dismissed',
	superseded: 'superseded',
});

const TERMINAL_INBOX_STATES = new Set(['done', 'resolved', 'dismissed', 'superseded']);

function emptyState() {
	return {
		lastSeq: 0,
		lastHash: GENESIS_HASH,
		projects: {},
		members: {},
		tasks: {},
		threads: {},
		inbox: {},
		stream: [],
		followers: {},
		humanMemberId: null,
	};
}

/** 新的空投影状态（每次返回新对象，避免测试/调用方共享可变状态）。 */
export function initialState() {
	return emptyState();
}

function isEventLike(event) {
	return (
		isPlainObject(event) &&
		typeof event.type === 'string' &&
		Number.isSafeInteger(event.seq) &&
		event.seq > 0
	);
}

function advance(state, event, patch = {}) {
	return {
		...state,
		...patch,
		lastSeq: event.seq,
		lastHash: typeof event.hash === 'string' ? event.hash : state.lastHash,
	};
}

function textOr(value, fallback) {
	return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value) {
	return typeof value === 'string' ? value : null;
}

function intOr(value, fallback) {
	return Number.isSafeInteger(value) ? value : fallback;
}

function intOrNull(value) {
	return Number.isSafeInteger(value) ? value : null;
}

function stringArray(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function actorMemberId(event) {
	const memberId = event?.actor?.memberId;
	return typeof memberId === 'string' ? memberId : null;
}

function actorIsHuman(event) {
	return event?.actor?.kind === 'human';
}

function nextRevision(task, payload) {
	if (Number.isSafeInteger(payload.revision) && payload.revision > 0) return payload.revision;
	return task.revision + 1;
}

function makeProject(payload, event) {
	const source = isPlainObject(payload.project) ? payload.project : payload;
	const owner = textOr(source.ownerId, textOr(source.ownerMemberId, null));
	return {
		id: textOr(source.id, event.projectId),
		name: textOr(source.name, ''),
		goal: textOr(source.goal, ''),
		ownerId: owner,
		ownerMemberId: owner,
		ownerName: stringOrNull(source.ownerName),
		workspacePath: stringOrNull(source.workspacePath),
		status: textOr(source.status, 'active'),
		createdAt: intOr(source.createdAt, event.at),
		archivedAt: null,
	};
}

function makeMember(payload, event, existing) {
	const source = isPlainObject(payload.member) ? payload.member : payload;
	const kind = source.kind === 'human' || source.kind === 'agent' ? source.kind : existing?.kind ?? 'agent';
	const status = MEMBER_STATUS_VALUES.has(source.status)
		? source.status
		: existing?.status ?? MEMBER_STATUS.PROVISIONING;
	return {
		id: textOr(source.id, textOr(source.memberId, existing?.id ?? null)),
		name: textOr(source.name, existing?.name ?? textOr(source.memberId, '')),
		kind,
		role: textOr(source.role, existing?.role ?? ''),
		status,
		preset: stringOrNull(source.preset),
		model: stringOrNull(source.model),
		workspace: stringOrNull(source.workspace),
		projectId: stringOrNull(source.projectId) ?? stringOrNull(payload.projectId),
		sessionId: stringOrNull(source.sessionId),
		memoryRef: stringOrNull(source.memoryRef),
		notesRef: stringOrNull(source.notesRef),
		createdAt: intOr(source.createdAt, existing?.createdAt ?? event.at),
		retiredAt: intOrNull(source.retiredAt) ?? existing?.retiredAt ?? null,
	};
}

function makeTask(payload, event) {
	const source = isPlainObject(payload.task) ? payload.task : payload;
	const owner = textOr(
		source.accountableOwnerId,
		textOr(source.ownerId, textOr(source.createdBy, actorMemberId(event))),
	);
	const status = TASK_STATUS_VALUES.has(source.status) ? source.status : TASK_STATUS.PENDING;
	return {
		id: textOr(source.id, textOr(source.taskId, null)),
		number: intOr(source.number, null),
		title: textOr(source.title, ''),
		description: textOr(source.description, ''),
		status,
		revision: intOr(source.revision, 1),
		// 03 的字段名与域层消费别名，二者始终同步。
		accountableOwnerId: owner === '' ? null : owner,
		ownerId: owner === '' ? null : owner,
		assigneeId: stringOrNull(source.assigneeId),
		reviewerId: stringOrNull(source.reviewerId),
		blockedBy: stringArray(source.blockedBy),
		writeScopes: stringArray(source.writeScopes),
		claimHistory: stringArray(source.claimHistory),
		reviewRound: intOr(source.reviewRound, 0),
		resultDefinition: textOr(source.resultDefinition, textOr(source.doneCriteria, '')),
		evidence: Array.isArray(source.evidence) ? [...source.evidence] : [],
		summary: typeof source.summary === 'string' ? source.summary : null,
		humanExecuted: source.humanExecuted === true,
		irreversible: source.irreversible === true,
		sourceMessageId: stringOrNull(source.sourceMessageId),
		resultRef: stringOrNull(source.resultRef),
		originRefs: stringArray(source.originRefs),
		createdBy: textOr(source.createdBy, actorMemberId(event)),
		createdAt: intOr(source.createdAt, event.at),
		updatedAt: intOr(source.updatedAt, event.at),
		claimedAt: intOrNull(source.claimedAt),
		releasedAt: intOrNull(source.releasedAt),
		assignedAt: intOrNull(source.assignedAt),
		submittedAt: intOrNull(source.submittedAt),
		acceptedAt: intOrNull(source.acceptedAt),
		cancelledAt: intOrNull(source.cancelledAt),
		deletedAt: intOrNull(source.deletedAt),
		reopenedAt: intOrNull(source.reopenedAt),
		reopenedFrom: stringOrNull(source.reopenedFrom),
		releaseReason: null,
		cancelReason: null,
		deleteReason: null,
		reopenReason: null,
		tombstone: source.tombstone === true || status === TASK_STATUS.DELETED,
		lastReview: null,
	};
}

function reviewRecord(task, payload, event, verdict, round) {
	return {
		round,
		verdict,
		note: stringOrNull(payload.note),
		reviewerId: textOr(payload.reviewerId, actorMemberId(event)),
		selfExecuted: payload.selfExecuted === true,
		at: event.at,
	};
}

function applyTaskEvent(state, event, payload) {
	const taskId = textOr(payload.taskId, textOr(payload.id, null));
	if (taskId === null) return advance(state, event);
	const task = state.tasks[taskId];
	if (!task) return advance(state, event);
	if (task.tombstone) return advance(state, event);

	const revision = nextRevision(task, payload);
	// CAS：陈旧 revision（含两个并发 claim 的后者）不得覆盖当前投影。
	if (revision <= task.revision) return advance(state, event);

	const patch = (nextTask) =>
		advance(state, event, { tasks: { ...state.tasks, [taskId]: nextTask } });

	switch (event.type) {
		case 'task/claimed': {
			const assigneeId = stringOrNull(payload.assigneeId);
			if (assigneeId === null || task.status !== TASK_STATUS.PENDING) return advance(state, event);
			// 预分派（assignee 已存在）只允许被同一人 claim；分派给他人后 claim 被拒。
			if (task.assigneeId !== null && task.assigneeId !== assigneeId) return advance(state, event);

			const history = [...task.claimHistory];
			const incoming = stringArray(payload.claimHistory);
			for (const memberId of incoming.length > 0 ? incoming : [assigneeId]) {
				if (!history.includes(memberId)) history.push(memberId);
			}
			if (!history.includes(assigneeId)) history.push(assigneeId);

			return patch({
				...task,
				status: TASK_STATUS.IN_PROGRESS,
				assigneeId,
				revision,
				claimedAt: event.at,
				updatedAt: event.at,
				// 只有 claim 进入 claimHistory；只增不清，同一成员重复认领只记录一次。
				claimHistory: history,
			});
		}

		case 'task/released': {
			if (task.status !== TASK_STATUS.IN_PROGRESS) return advance(state, event);
			if (typeof payload.assigneeId === 'string' && payload.assigneeId !== task.assigneeId) {
				return advance(state, event);
			}
			return patch({
				...task,
				status: TASK_STATUS.PENDING,
				assigneeId: null,
				revision,
				releasedAt: event.at,
				releaseReason: stringOrNull(payload.reason),
				updatedAt: event.at,
			});
		}

		case 'task/assigned': {
			const assigneeId = stringOrNull(payload.assigneeId);
			if (assigneeId === null) return advance(state, event);
			if (task.status !== TASK_STATUS.PENDING && task.status !== TASK_STATUS.IN_PROGRESS) {
				return advance(state, event);
			}
			// 预分派不改变状态（lib/domain/task.js:assignTask），claim 后才进入 in_progress。
			return patch({
				...task,
				assigneeId,
				revision,
				assignedAt: event.at,
				updatedAt: event.at,
				// 分派不等于认领（INV-07），claimHistory / humanExecuted 均不变。
			});
		}

		case 'task/submitted': {
			if (task.status !== TASK_STATUS.IN_PROGRESS) return advance(state, event);
			return patch({
				...task,
				status: TASK_STATUS.PENDING_ACCEPTANCE,
				revision,
				summary: stringOrNull(payload.summary) ?? task.summary,
				evidence: Array.isArray(payload.evidence) ? [...payload.evidence] : task.evidence,
				resultRef: stringOrNull(payload.resultRef) ?? task.resultRef,
				reviewerId: null,
				// reviewRound 在验收结论（accept / changes）时递增，提交不递增。
				humanExecuted: task.humanExecuted || actorIsHuman(event),
				submittedAt: event.at,
				updatedAt: event.at,
				lastReview: null,
			});
		}

		case 'task/changes-requested':
		case 'review/changes-requested': {
			if (task.status !== TASK_STATUS.PENDING_ACCEPTANCE) return advance(state, event);
			const reviewerId = textOr(payload.reviewerId, actorMemberId(event));
			const round = intOr(payload.round, task.reviewRound + 1);
			return patch({
				...task,
				status: TASK_STATUS.IN_PROGRESS,
				revision,
				reviewerId,
				reviewRound: round,
				lastReview: reviewRecord(task, payload, event, 'changes_requested', round),
				updatedAt: event.at,
			});
		}

		case 'task/accepted':
		case 'review/accepted':
		case 'review/human_self_accept': {
			if (task.status !== TASK_STATUS.PENDING_ACCEPTANCE) return advance(state, event);
			const reviewerId = textOr(payload.reviewerId, actorMemberId(event));
			const round = intOr(payload.round, task.reviewRound + 1);
			const selfExecuted =
				payload.selfExecuted === true || event.type === 'review/human_self_accept';
			return patch({
				...task,
				status: TASK_STATUS.DONE,
				revision,
				reviewerId,
				reviewRound: round,
				acceptedAt: event.at,
				updatedAt: event.at,
				humanExecuted: task.humanExecuted || selfExecuted,
				lastReview: reviewRecord(task, payload, event, 'accepted', round),
			});
		}

		case 'task/cancelled': {
			if (
				task.status !== TASK_STATUS.PENDING &&
				task.status !== TASK_STATUS.IN_PROGRESS &&
				task.status !== TASK_STATUS.PENDING_ACCEPTANCE
			) {
				return advance(state, event);
			}
			return patch({
				...task,
				status: TASK_STATUS.CANCELLED,
				revision,
				cancelledAt: event.at,
				cancelReason: stringOrNull(payload.reason),
				updatedAt: event.at,
			});
		}

		case 'task/reopened': {
			if (task.status !== TASK_STATUS.DONE && task.status !== TASK_STATUS.PENDING_ACCEPTANCE) {
				return advance(state, event);
			}
			let target;
			if (payload.status === TASK_STATUS.PENDING || payload.status === TASK_STATUS.IN_PROGRESS) {
				// 命令层已判断 assignee 有效性时以 payload 为准（lib/domain/task.js）。
				target = payload.status;
			} else {
				const assignee = task.assigneeId === null ? null : state.members[task.assigneeId];
				const assigneeValid =
					task.assigneeId !== null &&
					assignee !== undefined &&
					assignee !== null &&
					assignee.status !== MEMBER_STATUS.RETIRED;
				target = assigneeValid ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.PENDING;
			}
			return patch({
				...task,
				status: target,
				assigneeId: target === TASK_STATUS.PENDING ? null : task.assigneeId,
				revision,
				reopenedAt: event.at,
				reopenedFrom: task.status,
				reopenReason: stringOrNull(payload.reason),
				updatedAt: event.at,
			});
		}

		case 'task/reassigned': {
			const to = textOr(payload.to, textOr(payload.accountableOwnerId, null));
			if (to === null) return advance(state, event);
			if (
				task.status !== TASK_STATUS.PENDING &&
				task.status !== TASK_STATUS.IN_PROGRESS &&
				task.status !== TASK_STATUS.PENDING_ACCEPTANCE
			) {
				return advance(state, event);
			}
			return patch({
				...task,
				accountableOwnerId: to,
				ownerId: to,
				revision,
				updatedAt: event.at,
			});
		}

		case 'task/deleted': {
			// 02 §8.8 #5：deleted 是删除事件 + tombstone，不是第六种存储状态；status 保持五值。
			// delete 只允许“从未被认领的 pending”；预分派（assignee 非空）仍可删除。
			if (task.status !== TASK_STATUS.PENDING || task.claimHistory.length > 0) {
				return advance(state, event);
			}
			return patch({
				...task,
				status: task.status,
				tombstone: true,
				revision,
				deletedAt: event.at,
				deleteReason: stringOrNull(payload.reason),
				updatedAt: event.at,
			});
		}

		default:
			return state;
	}
}

function applyThreadPosted(state, event, payload) {
	const taskId = stringOrNull(payload.taskId);
	if (taskId === null) return advance(state, event);

	const source = isPlainObject(payload.entry) ? payload.entry : payload;
	const previous =
		state.threads[taskId] ??
		{ taskId, headSeq: 0, lastAuthorId: null, lastAt: null, entries: [] };

	const entrySeq = Number.isSafeInteger(source.seq) && source.seq > 0
		? source.seq
		: previous.headSeq + 1;
	if (previous.entries.some((entry) => entry.seq === entrySeq)) return advance(state, event);

	const entry = {
		seq: entrySeq,
		baseSeq: intOr(source.baseSeq, previous.headSeq),
		authorId: textOr(source.authorId, actorMemberId(event)),
		body: textOr(source.body, ''),
		refs: stringArray(source.refs),
		kind: textOr(source.kind, 'discussion'),
		at: intOr(source.at, event.at),
		eventId: event.id,
	};

	const entries = [...previous.entries, entry].sort((left, right) => left.seq - right.seq);
	const headEntry = entries[entries.length - 1];
	const headSeq = Math.max(previous.headSeq, entrySeq, headEntry.seq);
	const thread = {
		taskId,
		headSeq,
		lastAuthorId: headEntry.authorId,
		lastAt: headEntry.at,
		entries,
	};
	return advance(state, event, { threads: { ...state.threads, [taskId]: thread } });
}

function applyInboxCreated(state, event, payload) {
	const source = isPlainObject(payload.item) ? payload.item : payload;
	const itemId = textOr(source.id, textOr(source.itemId, null));
	if (itemId === null || state.inbox[itemId] !== undefined) return advance(state, event);

	const item = {
		id: itemId,
		memberId: stringOrNull(source.memberId),
		type: stringOrNull(source.type),
		ref: source.ref ?? null,
		requiresDecision: source.requiresDecision === true,
		state: textOr(source.state, 'unread'),
		createdAt: intOr(source.createdAt, event.at),
		ackedAt: intOrNull(source.ackedAt),
		disposition: stringOrNull(source.disposition),
		decision: source.decision ?? null,
	};
	return advance(state, event, { inbox: { ...state.inbox, [itemId]: item } });
}

function applyInboxAcked(state, event, payload) {
	const itemId = stringOrNull(payload.itemId);
	if (itemId === null) return advance(state, event);
	const item = state.inbox[itemId];
	if (!item) return advance(state, event);
	// 每个 InboxItem 至多一个终态（A-INV-09）。
	if (TERMINAL_INBOX_STATES.has(item.state)) return advance(state, event);
	if (
		typeof payload.memberId === 'string' &&
		typeof item.memberId === 'string' &&
		payload.memberId !== item.memberId
	) {
		return advance(state, event);
	}

	const disposition = textOr(payload.disposition, 'read');
	const nextState = textOr(payload.state, DISPOSITION_TO_STATE[disposition] ?? null);
	if (nextState === null) return advance(state, event);

	const next = {
		...item,
		state: nextState,
		disposition,
		decision: payload.decision ?? item.decision,
		ackedAt: intOr(payload.at, event.at),
	};
	return advance(state, event, { inbox: { ...state.inbox, [itemId]: next } });
}

function applyStreamPosted(state, event, payload) {
	if (state.stream.some((entry) => entry.seq === event.seq)) return advance(state, event);
	const entry = {
		seq: event.seq,
		id: event.id,
		projectId: event.projectId,
		kind: STREAM_KIND_VALUES.has(payload.kind) ? payload.kind : 'human_message',
		authorId: textOr(payload.authorId, actorMemberId(event)),
		authorKind: stringOrNull(event.actor?.kind),
		body: stringOrNull(payload.body),
		refs: stringArray(payload.refs),
		taskIds: stringArray(payload.taskIds),
		parentEventId: stringOrNull(payload.parentEventId),
		at: event.at,
	};
	const stream = [...state.stream, entry].sort((left, right) => left.seq - right.seq);
	return advance(state, event, { stream });
}

function applyFollow(state, event, payload, following) {
	const taskId = stringOrNull(payload.taskId);
	const memberId = stringOrNull(payload.memberId);
	if (taskId === null || memberId === null) return advance(state, event);
	const current = Array.isArray(state.followers[taskId]) ? state.followers[taskId] : [];
	const next = following
		? current.includes(memberId)
			? current
			: [...current, memberId]
		: current.filter((id) => id !== memberId);
	return advance(state, event, { followers: { ...state.followers, [taskId]: next } });
}

/**
 * 应用一个事件。未知事件、已应用事件、非法结构一律返回原 state 引用。
 */
export function applyEvent(state, event) {
	if (!isPlainObject(state)) throw new TypeError('applyEvent: state must be a plain object');
	if (!isEventLike(event)) return state;
	if (event.seq <= (Number.isSafeInteger(state.lastSeq) ? state.lastSeq : 0)) return state;

	const payload = isPlainObject(event.payload) ? event.payload : {};

	switch (event.type) {
		case 'project/created': {
			const project = makeProject(payload, event);
			if (typeof project.id !== 'string' || project.id.length === 0) return advance(state, event);
			return advance(state, event, { projects: { ...state.projects, [project.id]: project } });
		}

		case 'project/member-added': {
			const source = isPlainObject(payload.member) ? payload.member : payload;
			const existingId = textOr(source.id, textOr(payload.memberId, null));
			const member = makeMember(
				payload,
				event,
				existingId === null ? undefined : state.members[existingId],
			);
			if (typeof member.id !== 'string' || member.id.length === 0) return advance(state, event);
			const humanMemberId =
				member.kind === 'human' && state.humanMemberId === null ? member.id : state.humanMemberId;
			return advance(state, event, {
				members: { ...state.members, [member.id]: member },
				humanMemberId,
			});
		}

		case 'project/member-retired': {
			const source = isPlainObject(payload.member) ? payload.member : payload;
			const memberId = textOr(source.id, textOr(source.memberId, null));
			if (memberId === null) return advance(state, event);
			const existing = state.members[memberId];
			const base = existing ? { ...existing } : makeMember({ ...payload, memberId }, event, undefined);
			base.id = memberId;
			base.status = MEMBER_STATUS.RETIRED;
			base.retiredAt = event.at;
			return advance(state, event, { members: { ...state.members, [memberId]: base } });
		}

		case 'task/created': {
			const task = makeTask(payload, event);
			if (task.id === null) return advance(state, event);
			if (state.tasks[task.id] !== undefined) return advance(state, event);
			return advance(state, event, { tasks: { ...state.tasks, [task.id]: task } });
		}

		case 'thread/posted':
			return applyThreadPosted(state, event, payload);

		case 'inbox/item-created':
			return applyInboxCreated(state, event, payload);

		case 'inbox/acked':
			return applyInboxAcked(state, event, payload);

		case 'stream/posted':
			return applyStreamPosted(state, event, payload);

		case 'ledger/repaired':
			return advance(state, event, { lastRepair: payload.repairs ?? null });

		case 'task/followed':
			return applyFollow(state, event, payload, true);

		case 'task/unfollowed':
			return applyFollow(state, event, payload, false);

		case 'task/claimed':
		case 'task/released':
		case 'task/assigned':
		case 'task/submitted':
		case 'task/changes-requested':
		case 'review/changes-requested':
		case 'task/accepted':
		case 'review/accepted':
		case 'review/human_self_accept':
		case 'task/cancelled':
		case 'task/reopened':
		case 'task/reassigned':
		case 'task/deleted':
			return applyTaskEvent(state, event, payload);

		default:
			// 未知事件：明确返回原引用（调用方可用于判定“无需重建”）。
			return state;
	}
}

/**
 * 按顺序折叠事件数组；同一数组折叠两次结果 deepEqual（第二次原引用返回）。
 */
export function fold(events, state = initialState()) {
	if (!Array.isArray(events)) throw new TypeError('fold: events must be an array');
	let next = state;
	for (const event of events) next = applyEvent(next, event);
	return next;
}

/** 从空状态重放整段账本；等价于 fold(events, initialState())。 */
export function replay(events) {
	return fold(events, initialState());
}

/** 该成员是否在 claimHistory 中（验收资格的历史谓词）。 */
export function hasClaimed(task, memberId) {
	return Boolean(task) && Array.isArray(task.claimHistory) && task.claimHistory.includes(memberId);
}

/** 派生状态：blockedBy 中存在未 done 的 Task（含依赖不存在）。 */
export function isTaskBlocked(state, taskOrId) {
	const task = typeof taskOrId === 'string' ? state.tasks[taskOrId] : taskOrId;
	if (!task || task.tombstone) return false;
	return task.blockedBy.some((dependencyId) => state.tasks[dependencyId]?.status !== TASK_STATUS.DONE);
}

/**
 * 验收资格纯函数（02 INV-04 / Q-05）：
 * - Agent 必须未退役、不是当前 assignee、且从未 claim 过（历史谓词）。
 * - Human 是唯一例外，可验收自己执行的 Task；二次确认由命令层负责。
 */
export function isEligibleReviewer(state, taskId, memberId) {
	const task = state.tasks[taskId];
	const member = state.members[memberId];
	if (!task || task.tombstone || !member) return false;
	if (member.kind === 'human') return true;
	if (member.status === MEMBER_STATUS.RETIRED) return false;
	if (task.assigneeId === memberId) return false;
	return !hasClaimed(task, memberId);
}

/** 状态里的 Task 是否处于已知状态值（供测试/诊断使用）。 */
export function isValidTaskStatus(status) {
	return TASK_STATUS_VALUES.has(status);
}
