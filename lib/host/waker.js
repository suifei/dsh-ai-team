/**
 * Event-driven wake planner. No timers: a command produces at most one plan,
 * and the Host delivers it with `subagents.sendMessage`/MemberRuntime.wake.
 *
 * The planner is pure; it returns targets and a short prompt. Delivery,
 * deduplication and permission checks stay in the Host.
 */

import { eligibleReviewers, isQaMember } from '../domain/member-profile.js';

function text(value) {
	return typeof value === 'string' ? value : '';
}

function agentMember(state, memberId) {
	if (typeof memberId !== 'string') return null;
	const member = state.members?.[memberId];
	if (member === undefined || member.kind !== 'agent') return null;
	// failed 成员不自动唤醒（其 LLM 正在失败，自动唤醒只会烧预算）：
	// 恢复走 member.retry（Human/Project owner 显式动作）或 Human 在成员
	// 资料里的「重试」；review 路径另经 eligibleReviewers 的同一排除。
	if (member.status === 'retired' || member.status === 'failed') return null;
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
	if (reason === 'member_message') {
		return 'Human 给你发了一条私信。先读消息，再用 team 工具按当前 tasks/thread 行动；不要把它当成新 Task。';
	}
	if (reason === 'startup_resume') {
		return `Team event: DSH 已重启，${title} 仍未完成。调用 team 工具查看 tasks/thread，从当前状态继续；不要重新创建同一张卡。`;
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
	if (reason === 'pmo_dispatch') {
		return `PMO 补派：${title} 仍处于待处理且你当前空闲（可能此前的唤醒未送达）。调用 team 工具认领（claim）它并立即推进；若它不再由你负责或无法推进，用 task.reassign 交还并说明原因；不要静默等待。`;
	}
	if (reason === 'pmo_review') {
		return `PMO 验收提醒：${title} 仍处于 pending_acceptance，QA checklist 还没有完成记录。请独立复跑并按 resultDefinition 验收或退回；不要静默等待，也不要把验收推回 Human。`;
	}
	if (reason === 'pmo_escalate') {
		return `PMO 升级：${title} 已超过 60 分钟仍在进行。请 owner 评估是否需要拆分 Task、补充人手、缩小首版范围或重定验收标准；不要只催进度，给出可执行决定。`;
	}
	if (reason === 'pmo_heartbeat') {
		return `PMO 心跳：${title} 已 10 分钟没有 Thread 更新。请在 Thread 发一条简短进度（已完成 / 正在做 / 下一步 / 卡点），不要求现在完成；让 Human 能看到你确实在工作。`;
	}
	if (reason === 'pmo_stall') {
		return `PMO 巡检：${title} 已长时间没有新进展。读 Thread 当前状态，继续推进或明确报告卡点；不要静默等待，也不要重复已完成的证据。`;
	}
	if (reason === 'pmo_meeting') {
		return 'PMO 会议进行中，你是正式参会成员。读取已完成 Task、Thread 与项目目标，从你的专业视角（UX/业务/执行/验收/编程）在 Thread 发表意见并 @owner；指出被忽略的用户体验、运营需求或风险，不重复他人结论，不自行开卡，不等待 Human。';
	}
	if (reason === 'pmo_continue') {
		return 'PMO 自动推进：当前没有 active Task。先开一次复盘/头脑风暴/深度研究会议（读取已完成 Task、Thread 与核心 skill；在 Thread/@ 相关成员形成意见），据此自己产出验收标准与下一批 Task；resultDefinition 必须可验证，qaRequired 必须有 qaChecklist。不要等待 Human、不要只汇报、不要重复已完成卡。Human 只观测，所有需要决策的问题交 PMO 自动决策。';
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

	if (event?.type === 'team/startup') {
		const unfinished = Object.values(state.tasks ?? {})
			.filter((entry) => entry.tombstone !== true && ['pending', 'in_progress', 'pending_acceptance'].includes(entry.status))
			.slice(0, 5);
		for (const entry of unfinished) {
			add(entry.ownerId, entry.id, 'startup_resume', `startup:${entry.id}`);
			add(entry.assigneeId, entry.id, 'startup_resume', `startup:${entry.id}`);
		}
	}
	if (event?.type === 'member/message') {
		add(
			event.payload?.memberId,
			null,
			'member_message',
			`member_message:${event.seq ?? event.payload?.memberId}`,
			`Human 给你发私信：“${String(event.payload?.body ?? '').slice(0, 1200)}”。先读上下文，再按当前 tasks/thread 行动。`,
		);
	}
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
		const roster = Object.values(state.members ?? {})
			.filter((member) => member.kind === 'agent' && member.status !== 'retired')
			.map((member) => `${member.name}=${member.id}（${member.role || '成员'}）`)
			.join('、');
		add(
			project?.ownerMemberId,
			null,
			'human_message',
			`human_message:${event.seq ?? event.payload?.seq}`,
			`你是 Project owner。Human 在 Main stream 说：“${body}”。本轮必须先用 team action=members 查看成员，再用 action=create 创建至少一个 Task；ownerId 必须使用成员 id，写明可验证的 resultDefinition。可用成员：${roster || '无'}。如果需求很大或外部链接只是参考，先创建“调研/澄清/拆解”Task，不要直接开始实现。先做复盘/头脑风暴/深度研究，再产出验收标准；不要等 Human、不要把决策推回 Human。需要记录决策时调用 team action=askHuman，PMO 会自动按最高价值建议处理；不要只写“见报告/§6/已提交 Human”。resultDefinition 只写验收标准，不要写“等待 Human 验收”；不要只读文件或只回一段话结束。`,
		);
	}
	if (event?.type === 'pmo/review') {
		const task = state.tasks?.[event.payload?.taskId];
		if (task !== undefined) {
			const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 600_000);
			for (const member of Object.values(state.members ?? {})) {
				if (member.kind === 'agent' && isQaMember(member) && member.status !== 'retired') {
					add(member.id, task.id, 'pmo_review', `pmo_review:${task.id}:${member.id}:${bucket}`);
				}
			}
		}
	}
	if (event?.type === 'pmo/escalate') {
		const task = state.tasks?.[event.payload?.taskId];
		if (task !== undefined) {
			const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 3_600_000);
			add(task.ownerId, task.id, 'pmo_escalate', `pmo_escalate:${task.id}:${bucket}`);
			// Handoffs and meeting decisions live in Thread text; the wake
			// matrix cannot see them. Escalation therefore also reaches the
			// Project owner, who may take the card or re-point it.
			const projectOwner = Object.values(state.projects ?? {})[0]?.ownerMemberId;
			if (projectOwner !== undefined && projectOwner !== task.ownerId) {
				add(projectOwner, task.id, 'pmo_escalate', `pmo_escalate_owner:${task.id}:${bucket}`);
			}
		}
	}
	if (event?.type === 'pmo/dispatch') {
		// Pending 快速补派（60s tick 的状态检查兜底）：任务仍 pending 且责任位
		// 空闲。key 带 bucket（每分钟最多一次），避免与创建时的 task_created
		// 去重键互相吞掉。
		const task = state.tasks?.[event.payload?.taskId];
		if (task !== undefined && task.status === 'pending') {
			const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 60_000);
			const responsibleId = task.assigneeId ?? task.ownerId;
			add(responsibleId, task.id, 'pmo_dispatch', `pmo_dispatch:${task.id}:${bucket}`);
		}
	}
	if (event?.type === 'pmo/heartbeat') {
		const task = state.tasks?.[event.payload?.taskId];
		if (task !== undefined) {
			const target = event.payload?.memberId ?? task.assigneeId ?? task.ownerId;
			const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 600_000);
			add(target, task.id, 'pmo_heartbeat', `pmo_heartbeat:${task.id}:${bucket}`);
		}
	}
	if (event?.type === 'pmo/stall') {
		const task = state.tasks?.[event.payload?.taskId];
		if (task !== undefined) {
			const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 1_800_000);
			for (const memberId of [task.ownerId, task.assigneeId]) {
				add(memberId, task.id, 'pmo_stall', `pmo_stall:${task.id}:${bucket}`);
			}
		}
	}
	if (event?.type === 'pmo/continue') {
		const project = Object.values(state.projects ?? {})[0];
		const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 600_000);
		const ownerId = project?.ownerMemberId;
		// PMO meetings include every agent member; the owner leads, everyone
		// else contributes from their own professional seat.
		for (const member of Object.values(state.members ?? {})) {
			if (member.kind !== 'agent' || member.status === 'retired') continue;
			if (member.id === ownerId) {
				add(member.id, null, 'pmo_continue', `pmo:${project?.id ?? 'project'}:${bucket}`);
			} else {
				add(member.id, null, 'pmo_meeting', `pmo_meeting:${project?.id ?? 'project'}:${member.id}:${bucket}`);
			}
		}
	}
	if (event?.type === 'inbox/item-created') {
		add(event.payload?.item?.memberId, event.payload?.item?.ref?.taskId ?? null, 'inbox', `inbox:${event.payload?.item?.id ?? event.seq}`);
	}
	return [...targets.values()];
}

/**
 * Compact Task delta for a live member. Identity, personality and the core
 * skill are activation-only; re-sending them on every wake duplicated the
 * prompt and crowded the persistent session.
 */
export function describeWake(wake, state) {
	const member = state.members?.[wake.memberId];
	const boundary = typeof wake.taskId === 'string' && wake.taskId !== ''
		? '【Task 边界】这是当前 Task 的增量指令；先读 Task/Thread 当前状态，不要把上一个 Task 的假设直接带入。\n'
		: '';
	return `${boundary}[${member?.name ?? wake.memberId}] ${wake.prompt}`;
}
