/**
 * 人员池只读聚合（11-管理视角与信息架构 §2）：遍历各 Project 账本的
 * members/tasks，按姓名把"同一个人在各项目的身份"聚成一行。
 * 不产生任何新数据——输入是既有账本投影，输出是纯视图。
 *
 * 同名即同一人：默认花名册同名同人；自建成员重名视为同一团队身份（文档化
 * 于 docs/11 §5）。
 */

const ACTIVE_TASK_STATUSES = new Set(['pending', 'in_progress', 'pending_acceptance']);

/** @returns {Array<{name:string,role:string,projects:Array,failures:number,activeTasks:number}>} */
export function aggregatePeople(registryEntries, runtimes) {
	const people = new Map();
	for (const runtime of runtimes) {
		const projectName = registryEntries.find((project) => project.id === runtime.id)?.name ?? runtime.id;
		const state = runtime.service?.state;
		if (state === undefined || state === null) continue;
		// 本项目的活跃任务计数：按 owner/assignee 两个责任位累计。
		const activeTasksByMember = new Map();
		for (const task of Object.values(state.tasks ?? {})) {
			if (task.tombstone === true || !ACTIVE_TASK_STATUSES.has(task.status)) continue;
			for (const memberId of [task.ownerId, task.assigneeId]) {
				if (typeof memberId !== 'string' || memberId === '') continue;
				activeTasksByMember.set(memberId, (activeTasksByMember.get(memberId) ?? 0) + 1);
			}
		}
		for (const member of Object.values(state.members ?? {})) {
			if (member.kind === 'human') continue;
			// 空串名不吃 ?? 兜底（fold 允许空名成员；空名各自按 id 独立成行）。
			const key = member.name || member.id;
			const entry = people.get(key) ?? {
				name: member.name || member.id,
				role: member.role ?? '',
				projects: [],
				failures: 0,
				activeTasks: 0,
			};
			if (entry.role === '' && member.role) entry.role = member.role;
			const tasks = activeTasksByMember.get(member.id) ?? 0;
			entry.projects.push({
				projectId: runtime.id,
				projectName,
				status: member.status ?? 'idle',
				sessionId: member.sessionId ?? null,
				talentPool: member.talentPool === true,
				attempts: member.attempts ?? 0,
				lastFailure: member.lastFailure ?? null,
				activeTasks: tasks,
			});
			if (member.lastFailure !== undefined && member.lastFailure !== null) entry.failures += 1;
			entry.activeTasks += tasks;
			people.set(key, entry);
		}
	}
	return [...people.values()].sort((left, right) => left.name.localeCompare(right.name));
}
// 语义备注：failures 计的是"当前仍带 lastFailure 的项目数"——member/recovered
// 不清 lastFailure（保留最近一次失败供展示），康复成员会继续计入；这是展示
// 口径而非存活判定（存活以 status 为准）。
