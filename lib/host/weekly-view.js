/**
 * 项目周报投影（R-11 / 视图组合纪律）：同一份账本投影的窗口聚合，产出
 * 正向/负向两种解读共用的数据结构——正向 = 完成了什么、一次通过多少；
 * 负向 = 哪些返工了、Human 介入了几次、多少任务仍受阻。纯计数投影，
 * 无新事件、无新数据结构。
 *
 * 口径（全部来自既有投影字段）：
 *   - completed：status=done 且 updatedAt 在窗口内（done 的 updatedAt 即验收时间）；
 *   - reworked：reviewRound ≥ 2（经历过 task/changes-requested）且窗口内有动静；
 *   - humanTouches：Thread 中 authorId === humanId 的条目数（窗口内 at）+
 *     已答复决策数（requiresDecision 且 state==='done'，ackedAt 窗口内）；
 *   - humanTasks：ownerId === humanId 的活跃任务数（"交给人"的负担面）。
 */

export function weeklyView(state, { now = Date.now(), weeks = 1 } = {}) {
	const windowStart = now - weeks * 7 * 24 * 60 * 60 * 1000;
	const humanId = state.humanMemberId
		?? Object.values(state.members ?? {}).find((member) => member.kind === 'human')?.id
		?? null;

	const completed = [];
	const reworked = [];
	let createdCount = 0;
	for (const task of Object.values(state.tasks ?? {})) {
		if (task.tombstone === true) continue;
		const touchedAt = Math.max(task.updatedAt ?? 0, task.createdAt ?? 0);
		if (task.createdAt >= windowStart) createdCount += 1;
		if (task.status === 'done' && (task.updatedAt ?? 0) >= windowStart) {
			completed.push({
				taskId: task.id,
				number: task.number ?? null,
				title: task.title ?? '',
				ownerName: state.members?.[task.ownerId]?.name ?? task.ownerId ?? null,
				reviewRound: task.reviewRound ?? 1,
				updatedAt: task.updatedAt ?? null,
			});
		}
		if ((task.reviewRound ?? 0) >= 2 && touchedAt >= windowStart) {
			reworked.push({
				taskId: task.id,
				number: task.number ?? null,
				title: task.title ?? '',
				reviewRound: task.reviewRound,
			});
		}
	}

	let humanThreadMessages = 0;
	for (const thread of Object.values(state.threads ?? {})) {
		for (const entry of thread.entries ?? []) {
			if ((entry.at ?? 0) >= windowStart && entry.authorId === humanId) humanThreadMessages += 1;
		}
	}
	let decisionsAnswered = 0;
	for (const item of Object.values(state.inbox ?? {})) {
		if (item.type !== 'decision_required' || item.requiresDecision !== true) continue;
		if (item.state !== 'done' && item.state !== 'resolved') continue;
		if ((item.ackedAt ?? 0) >= windowStart) decisionsAnswered += 1;
	}
	const humanTasks = humanId === null ? 0
		: Object.values(state.tasks ?? {}).filter((task) =>
			task.tombstone !== true && ['pending', 'in_progress', 'pending_acceptance'].includes(task.status)
			&& (task.ownerId === humanId || task.assigneeId === humanId)).length;

	const completedTitles = completed.map((row) => '#' + (row.number ?? row.taskId) + ' ' + row.title);
	return {
		windowStart,
		generatedAt: now,
		weeks,
		completedCount: completed.length,
		createdCount,
		reworkedCount: reworked.length,
		humanThreadMessages,
		decisionsAnswered,
		humanTasks,
		completed,
		reworked,
		// 正向解读的数据面：完成的清单与「零 Human 发言」的直通任务。
		positive: { completedTitles, humanThreadMessages, decisionsAnswered },
		// 负向解读的数据面：返工清单（reviewRound>=2）与仍然阻塞/待人的任务。
		negative: { reworkedTitles: reworked.map((row) => '#' + (row.number ?? row.taskId) + ' ' + row.title), humanTasks },
	};
}
