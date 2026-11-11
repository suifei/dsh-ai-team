/**
 * 风险清单投影（R-07 / 视图组合纪律 V1）：三类需要 Human 注意的风险，
 * 全部从既有账本投影只读聚合，零新事件、零新数据结构——
 *   1. 受阻任务：pending 且依赖未完成（isTaskBlocked）；
 *   2. 失败成员：agent 带未清除的 lastFailure（或 status=failed）；
 *   3. 待决超时：Human 收件箱中 unread 的 decision_required，超过 staleHours。
 *
 * 输出行复用 quadrantItem 的形状约定（kind/taskId/taskNumber/title/...），
 * 前端零新交互模式即可渲染。
 */

import { isTaskBlocked } from '../ledger/fold.js';

const RISK_KINDS = Object.freeze({
	BLOCKED_TASK: 'blocked_task',
	FAILED_MEMBER: 'failed_member',
	STALE_DECISION: 'stale_decision',
});

export function riskView(state, { now = Date.now(), staleHours = 24 } = {}) {
	const humanId = state.humanMemberId
		?? Object.values(state.members ?? {}).find((member) => member.kind === 'human')?.id
		?? null;
	const cutoff = now - staleHours * 60 * 60 * 1000;

	const blocked = [];
	for (const task of Object.values(state.tasks ?? {})) {
		if (task.tombstone === true) continue;
		if (task.status !== 'pending') continue;
		if (!isTaskBlocked(state, task)) continue;
		blocked.push({
			kind: RISK_KINDS.BLOCKED_TASK,
			taskId: task.id,
			taskNumber: task.number ?? null,
			title: task.title ?? '',
			ownerId: task.ownerId ?? null,
			ownerName: state.members?.[task.ownerId]?.name ?? task.ownerId ?? null,
			blockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
			waitingSince: task.updatedAt ?? null,
		});
	}

	const failures = [];
	for (const member of Object.values(state.members ?? {})) {
		if (member.kind !== 'agent') continue;
		const failure = member.lastFailure;
		if (member.status !== 'failed' && (failure === undefined || failure === null)) continue;
		// Ledgers written before the fold cleared lastFailure on recovery:
		// a failure older than the last recovery is not an open risk.
		if (failure !== undefined && failure !== null
			&& Number.isFinite(member.lastRecoveredAt) && Number.isFinite(failure.at)
			&& member.lastRecoveredAt >= failure.at) continue;
		failures.push({
			kind: RISK_KINDS.FAILED_MEMBER,
			memberId: member.id,
			name: member.name ?? member.id,
			role: member.role ?? '',
			status: member.status ?? 'idle',
			category: failure?.category ?? null,
			attempt: failure?.attempt ?? (member.attempts ?? 0),
			message: failure?.message ?? member.failure ?? null,
		});
	}

	const staleDecisions = [];
	for (const item of Object.values(state.inbox ?? {})) {
		if (humanId !== null && item.memberId !== humanId) continue;
		if (item.type !== 'decision_required' || item.requiresDecision !== true) continue;
		if (item.state !== 'unread') continue;
		const createdAt = item.createdAt ?? null;
		const waitingHours = createdAt !== null && Number.isFinite(createdAt)
			? Math.max(0, Math.round((now - createdAt) / (60 * 60 * 1000)))
			: null;
		if (createdAt === null || now - createdAt < staleHours * 60 * 60 * 1000) continue;
		staleDecisions.push({
			kind: RISK_KINDS.STALE_DECISION,
			itemId: item.id,
			title: item.ref?.title ?? item.type ?? 'decision_required',
			taskId: item.ref?.taskId ?? null,
			waitingHours,
		});
	}
	staleDecisions.sort((left, right) => (right.waitingHours ?? 0) - (left.waitingHours ?? 0));

	return {
		rev: state.lastSeq ?? 0,
		generatedAt: now,
		blocked,
		failures,
		staleDecisions,
		counts: {
			blocked: blocked.length,
			failures: failures.length,
			staleDecisions: staleDecisions.length,
		},
	};
}

export { RISK_KINDS };
