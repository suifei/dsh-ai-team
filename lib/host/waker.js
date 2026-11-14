/**
 * Event-driven wake planner. No timers: a command produces at most one plan,
 * and the Host delivers it with `subagents.sendMessage`/MemberRuntime.wake.
 *
 * The planner is pure; it returns targets and a short prompt. Delivery,
 * deduplication and permission checks stay in the Host.
 */

import { eligibleReviewers, isQaMember, unfinishedTasksFor } from '../domain/member-profile.js';
import { isReviewCandidate } from '../domain/policy.js';
import { isBoardIdle } from '../ledger/fold.js';

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
	if (reason === 'wave_done') {
		return `Team event: 本批任务已全部验收（最后一张：${title}），看板已空。你是 PMO：用 team action=say 在主对话向 Human 汇报结果——完成了什么、产物在哪（路径）、怎么验证（命令与结果），并用 taskIds 附上这批卡。只汇报，不要在本回合续开新任务；是否继续由 PMO 推进节奏与 Human 决定。`;
	}
	if (reason === 'pmo_continue') {
		return 'PMO 自动推进：当前没有 active Task。先对照 Human 最近一次的指令判断目标是否已经达成：已达成且没有明确的后续价值 → 用 team action=say 在主对话简短说明「已完成、暂无后续」，然后结束本回合，不开新卡。确有必要继续时，先开一次复盘会议（读取已完成 Task、Thread 与核心 skill；在 Thread/@ 相关成员形成意见），据此产出验收标准与下一批 Task，并用 action=say 告诉 Human 新一批做什么、为什么；resultDefinition 必须可验证，qaRequired 必须有 qaChecklist。不要重复已完成卡，不要扩大到 Human 没要求的范围。自主续开有批次上限，用尽后 PMO 会暂停等 Human。';
	}
	return `Team event: ${task?.title ?? taskId}。调用 team 工具查看 tasks/thread 后行动。`;
}

/**
 * @param {any} state ledger projection
 * @param {{ event?: {type:string,payload?:any,seq?:number}, task?: any, thread?: any, item?: any }} result
 * @param {{ agentId?: string }} actor
 * @returns {Array<{memberId:string, taskId:string|null, reason:string, prompt:string, key:string}>}
 */
export function planWakes(state, result, actor = {}, options = {}) {
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
		// 去重键必须带上接收者与 Project：`wakeKeys` 是 Host 级全局表，同一 event
		// seq 在多个 Project 里会重复，两个接收者共用键会让第二个计划被静默丢弃。
		const scopedKey = `${key}:${memberId}:${options.projectId ?? ''}`;
		targets.set(memberId + ':' + reason, {
			memberId,
			taskId: taskId ?? null,
			reason,
			prompt: (promptOverride ?? promptFor(reason, state, taskId)) + (taskId ? ` Task id: ${taskId}.` : ''),
			key: scopedKey,
		});
	};

	// 路由变更（成员 provider/model 改过）必须立即唤醒并重建会话：
	//   * 已存活会话的 provider 在创建时固定，追加 model/selection 只改模型名，
	//     实机会表现成「模型换成 Qwen、provider 仍是 deepseek-official → 缺 key」；
	//   * 失败成员被 agentMember() 排除在自动唤醒之外（避免烧预算），但 Human 改
	//     模型就是明确的修复动作，必须放行，否则改完仍然卡死。
	if (event?.type === 'member/config-updated' && event.payload?.routeChanged === true) {
		const memberId = event.payload.memberId;
		const member = typeof memberId === 'string' ? state.members?.[memberId] : undefined;
		// 只唤醒手上有未完成任务的成员：fold 已把 routeStale 记进账本，空闲成员下次被
		// 真正唤醒时自然在新路由下重建。否则改一次全员模型就空转激活 N 个会话（r08：6 次）。
		if (member !== undefined && member.kind === 'agent' && member.status !== 'retired' && unfinishedTasksFor(state, memberId).length > 0) {
			targets.set(`${memberId}:route_changed`, {
				memberId,
				taskId: null,
				reason: 'route_changed',
				prompt: '模型/提供方已切换。按新配置继续：先读 tasks 与 thread 的当前状态，不要重复已完成的工作。',
				key: `route_changed:${event.seq ?? memberId}:${memberId}:${options.projectId ?? ''}`,
			});
		}
	}
	if (event?.type === 'team/startup') {		const unfinished = Object.values(state.tasks ?? {})
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
		// 账本事件路径没有嵌套 task：payload 只有 taskId，必须回投影里取。
		const created = task ?? (event?.payload?.taskId === undefined ? null : state.tasks?.[event.payload.taskId]) ?? null;
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
			// 回收结果（核心模型：PMO 排会、回收结果、派活）：这一批全部验收、看板空了，
			// 叫 PMO 在主对话向 Human 汇报。此前没人汇报，Human 只能去看板里翻。
			const ownerId = Object.values(state.projects ?? {})[0]?.ownerMemberId;
			if (ownerId !== undefined && isBoardIdle(state)) {
				add(ownerId, current.id, 'wave_done', `wave_done:${current.id}`);
			}
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
			`你是本项目的 PMO（Project owner）。Human 在主对话说：“${body.slice(0, 2000)}”。Human 只看主对话，你是唯一在主对话回应 Human 的成员。先判断这句话是什么：\n- 打招呼、提问、确认、闲聊 → 直接用 team action=say 在主对话回答，不建卡。\n- 要团队完成的工作 → 先用 team action=members 看成员，再用 action=create 建卡（ownerId/assigneeId 用成员 id，resultDefinition 写可验证的验收标准，需要独立复跑时 qaRequired=true 并给 qaChecklist），然后用 action=say 在主对话告诉 Human 你的安排并用 taskIds 附上这些卡。需求很大或含糊时先建一张「澄清/拆解」卡，不要直接开始实现。\n只做 Human 要的范围，不要自行扩大。需要 Human 拍板的问题用 action=askHuman。可用成员：${roster || '无'}。`,
		);
	}
	if (event?.type === 'pmo/review') {
		const task = state.tasks?.[event.payload?.taskId];
		if (task !== undefined) {
			const bucket = event.payload?.bucket ?? Math.floor(Date.now() / 600_000);
			// 只叫 QA 成员，并且用同一套资格判定：之前把**所有** QA 成员都叫来，
			// 包括刚交活的 assignee 和 claim 过这张卡的人，等于让人验收自己的活。
			for (const member of Object.values(state.members ?? {})) {
				if (!isQaMember(member)) continue;
				if (!isReviewCandidate(member, task)) continue;
				add(member.id, task.id, 'pmo_review', `pmo_review:${task.id}:${member.id}:${bucket}`);
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
		// else contributes from their own professional seat. No wakeable owner,
		// no meeting: r13 convened five members around a failed PMO (AUTH) —
		// a headless meeting that nobody chairs or closes.
		const members = agentMember(state, ownerId) === null ? [] : Object.values(state.members ?? {});
		for (const member of members) {
			if (member.kind !== 'agent' || member.status === 'retired') continue;
			if (member.id === ownerId) {
				add(member.id, null, 'pmo_continue', `pmo:${project?.id ?? 'project'}:${bucket}`);
			} else {
				add(member.id, null, 'pmo_meeting', `pmo_meeting:${project?.id ?? 'project'}:${member.id}:${bucket}`);
			}
		}
	}
	if (event?.type === 'inbox/item-created') {
		// 账本写的是**扁平**载荷（{ itemId, memberId, ref, ... }），不是嵌套的
		// payload.item —— 之前按嵌套读，这条唤醒分支永远不触发。
		const item = event.payload ?? {};
		add(item.memberId, item.ref?.taskId ?? null, 'inbox', `inbox:${item.itemId ?? item.id ?? event.seq}`);
	}
	return [...targets.values()];
}

/** Thread 尾巴：只带最近几条，正文按字符截断，避免把提示词撑大。 */
const CONTEXT_ENTRY_LIMIT = 3;
const CONTEXT_BODY_LIMIT = 120;
const CONTEXT_TITLE_LIMIT = 80;

const shortText = (value, limit) => {
	const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/**
 * 冷路径（会话不可恢复/重建）的最小可续跑上下文：当前 Task 一句话 + Thread 最近几条。
 *
 * 为什么不另存一份：这些都已在 Project 账本投影里（`state.tasks` / `state.threads` /
 * `state.members`），再建一份存储就是第二个真相源。这里只负责**投喂**——成员重建后
 * 不必从零开始回忆「刚才在做什么、谁说了什么」。
 *
 * @param {object} state 账本投影
 * @param {string} taskId 当前 Task
 * @param {{ includeThread?: boolean, entryLimit?: number, bodyLimit?: number }} options
 * @returns {string} 以换行开头；没有可用内容时返回空串
 */
export function describeTaskContext(state, taskId, options = {}) {
	if (typeof taskId !== 'string' || taskId === '') return '';
	const entryLimit = Number.isSafeInteger(options.entryLimit) && options.entryLimit > 0 ? options.entryLimit : CONTEXT_ENTRY_LIMIT;
	const bodyLimit = Number.isSafeInteger(options.bodyLimit) && options.bodyLimit > 0 ? options.bodyLimit : CONTEXT_BODY_LIMIT;
	const lines = [];
	const task = state?.tasks?.[taskId];
	if (task !== undefined && task !== null) {
		const title = shortText(task.title, CONTEXT_TITLE_LIMIT) || '（无标题）';
		lines.push(`【当前 Task】#${task.number ?? '?'} ${title} [${task.status ?? '?'}]`);
	}
	if (options.includeThread === true) {
		const entries = Array.isArray(state?.threads?.[taskId]?.entries)
			? state.threads[taskId].entries.slice(-entryLimit)
			: [];
		const rendered = [];
		for (const entry of entries) {
			const body = shortText(entry?.body, bodyLimit);
			if (body === '') continue;
			const author = state?.members?.[entry?.authorId]?.name ?? entry?.authorId ?? '?';
			rendered.push(`- ${author}：${body}`);
		}
		if (rendered.length > 0) lines.push('【最近对话】', ...rendered);
	}
	return lines.length === 0 ? '' : `\n${lines.join('\n')}`;
}

/**
 * Compact Task delta for a live member. Identity, personality and the core
 * skill are activation-only; re-sending them on every wake duplicated the
 * prompt and crowded the persistent session.
 *
 * `options.includeThread` 打开时才附 Thread 尾巴：**只有冷路径**（会话不可恢复、
 * 或重建后）才需要它，否则每次唤醒都白烧 token。
 */
export function describeWake(wake, state, options = {}) {
	const member = state.members?.[wake.memberId];
	const boundary = typeof wake.taskId === 'string' && wake.taskId !== ''
		? '【Task 边界】这是当前 Task 的增量指令；先读 Task/Thread 当前状态，不要把上一个 Task 的假设直接带入。\n'
		: '';
	const context = describeTaskContext(state, wake.taskId, options);
	return `${boundary}[${member?.name ?? wake.memberId}] ${wake.prompt}${context}`;
}
