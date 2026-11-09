/**
 * Event-driven wake planner. No timers: a command produces at most one plan,
 * and the Host delivers it with `subagents.sendMessage`/MemberRuntime.wake.
 *
 * The planner is pure; it returns targets and a short prompt. Delivery,
 * deduplication and permission checks stay in the Host.
 */

import { eligibleReviewers, memberIdentity } from '../domain/member-profile.js';

function text(value) {
	return typeof value === 'string' ? value : '';
}

function agentMember(state, memberId) {
	if (typeof memberId !== 'string') return null;
	const member = state.members?.[memberId];
	if (member === undefined || member.kind !== 'agent') return null;
	if (member.status === 'retired') return null;
	return member;
}

function taskTitle(state, taskId) {
	const task = state.tasks?.[taskId];
	if (task === undefined) return taskId;
	return `#${task.number ?? '?'} ${task.title ?? ''}`.trim();
}

function promptFor(reason, state, taskId) {
	const task = state.tasks?.[taskId];
	const title = taskTitle(state, taskId);
	if (reason === 'task_created') {
		return `Team event: ${title} 已创建，你是 accountable owner。调用 team 工具查看 tasks，认领/推进它；需要别人做时写清结果定义。完成后提交证据。`;
	}
	if (reason === 'task_assigned') {
		return `Team event: ${title} 已分派给你。调用 team 工具查看 tasks，认领后推进；完成后 submit 证据。`;
	}
	if (reason === 'task_submitted') {
		return `Team event: ${title} 已提交待验收。调用 team 工具查看 thread/tasks；若你不是执行者且从未认领，可在合格时验收；否则把问题写回 Thread。`;
	}
	if (reason === 'review_requested') {
		return `Team event: ${title} 已提交待验收，你是独立 reviewer。调用 team 工具读 thread 与证据；若你从未认领该卡，请验收或写明返工理由。QA 角色优先复跑门禁。`;
	}
	if (reason === 'reflection_requested') {
		return `Team event: ${title} 已被验收完成。做一次简短复盘：哪一步做得好、哪一步下次要改；如果你发现了持久的工作方式改进，可以调用 team 工具 evolve 更新自己的 personality（只能改个性，不改名字/角色）。不要重开已完成的卡。`;
	}
	if (reason === 'thread_reply') {
		return `Team event: ${title} 的 Thread 有新回复。先调用 team 工具读 thread（记录 headSeq），再决定是否回复或推进；不要对已变化的 Thread 直接回复。`;
	}
	if (reason === 'changes_requested') {
		return `Team event: ${title} 被返工。读 thread 的返工理由，修正后重新 submit；不要只回复“收到”。`;
	}
	if (reason === 'task_reopened') {
		return `Team event: ${title} 被重开。调用 team 工具查看当前状态与 thread，按 owner/Human 的理由继续。`;
	}
	if (reason === 'inbox') {
		return 'Team event: 你的收件箱有新条目。调用 team 工具查看 inbox，处理与你有关的事项。';
	}
	return `Team event: ${task?.title ?? taskId}。调用 team 工具查看 tasks/thread 后行动。`;
}

/**
 * @param {any} state ledger projection
 * @param {{ event?: {type:string,payload?:any,seq?:number}, task?: any, thread?: any, item?: any }} result
 * @param {{ agentId?: string }} actor
 * @returns {Array<{memberId:string, taskId:string|null, reason:string, prompt:string, key:string}>}
 */
export function planWakes(state, result, actor = {}) {
	const event = result?.event ?? null;
	const task = result?.task ?? null;
	const targets = new Map();
	const add = (memberId, taskId, reason, key, promptOverride) => {
		const member = agentMember(state, memberId);
		if (member === null) return;
		// A thread author must not be woken by their own reply, and the reviewer
		// candidate is already filtered by eligibility. Other Agent-authored
		// events (notably a Lead creating a task owned by itself) still need a
		// wake so the same member can claim it.
		if (actor.agentId !== undefined && memberId === actor.agentId && (reason === 'thread_reply' || reason === 'review_requested')) return;
		if (targets.has(memberId + ':' + reason)) return;
		targets.set(memberId + ':' + reason, {
			memberId,
			taskId: taskId ?? null,
			reason,
			prompt: (promptOverride ?? promptFor(reason, state, taskId)) + (taskId ? ` Task id: ${taskId}.` : ''),
			key,
		});
	};

	if (event?.type === 'task/created' || (event === null && task !== null && task.status === 'pending')) {
		const created = task ?? event?.payload?.task;
		if (created !== null && created !== undefined) {
			add(created.ownerId, created.id, 'task_created', `task_created:${created.id}`);
			add(created.assigneeId, created.id, 'task_assigned', `task_assigned:${created.id}`);
		}
	}
	if (event?.type === 'task/assigned') {
		add(event.payload?.assigneeId, event.payload?.taskId, 'task_assigned', `task_assigned:${event.seq ?? event.payload?.taskId}`);
	}
	if (event?.type === 'task/submitted') {
		const current = state.tasks?.[event.payload?.taskId];
		const reviewer = eligibleReviewers(state, current)[0];
		if (reviewer !== undefined) {
			add(reviewer.id, event.payload?.taskId, 'review_requested', `review_requested:${event.seq ?? event.payload?.taskId}`);
		}
	}
	if (event?.type === 'task/accepted' || event?.type === 'review/accepted') {
		const current = state.tasks?.[event.payload?.taskId];
		if (current !== undefined && current !== null) {
			// One reflection per Task, independent of whether the HTTP result or
			// the ledger event scheduled it (they carry different seq context).
			add(current.assigneeId, current.id, 'reflection_requested', `reflection:${current.id}`);
		}
	}
	if (event?.type === 'task/changes-requested') {
		const current = state.tasks?.[event.payload?.taskId];
		add(current?.assigneeId, event.payload?.taskId, 'changes_requested', `changes:${event.seq ?? event.payload?.taskId}`);
	}
	if (event?.type === 'task/reopened') {
		add(event.payload?.taskId === undefined ? null : state.tasks?.[event.payload.taskId]?.ownerId, event.payload?.taskId, 'task_reopened', `reopened:${event.seq ?? event.payload?.taskId}`);
	}
	if (event?.type === 'thread/posted') {
		const taskId = event.payload?.taskId;
		const current = state.tasks?.[taskId];
		const author = event.payload?.entry?.authorId;
		for (const memberId of [current?.ownerId, current?.assigneeId]) {
			if (memberId !== undefined && memberId !== author) {
				add(memberId, taskId, 'thread_reply', `thread:${taskId}:${event.seq ?? event.payload?.entry?.seq}`);
			}
		}
	}
	if (event?.type === 'stream/posted' && event.payload?.kind === 'human_message') {
		const project = Object.values(state.projects ?? {})[0];
		const body = typeof event.payload?.body === 'string' ? event.payload.body : '';
		add(
			project?.ownerMemberId,
			null,
			'human_message',
			`human_message:${event.seq ?? event.payload?.seq}`,
			`你是 Project owner。Human 在 Main stream 说：“${body}”。调用 team 工具查看 tasks；需要开工就用 create 创建 Task，写明可验证的 resultDefinition，并把 owner 指给合适的成员。resultDefinition 只写验收标准，不要写“等待 Human 验收”；验收可由任何未认领该卡的 Agent 执行。不要只回一段话代替卡。`,
		);
	}
	if (event?.type === 'inbox/item-created') {
		add(event.payload?.item?.memberId, event.payload?.item?.ref?.taskId ?? null, 'inbox', `inbox:${event.payload?.item?.id ?? event.seq}`);
	}
	return [...targets.values()];
}

/** Compact prompt for a member; keeps identity + exact action in one screen. */
export function describeWake(wake, state) {
	const member = state.members?.[wake.memberId];
	return `${memberIdentity(member)}\n[${member?.name ?? wake.memberId}] ${wake.prompt}`;
}
