/**
 * 人员池只读聚合（11-管理视角与信息架构 §2）：遍历各 Project 账本的
 * members/tasks，按姓名把"同一个人在各项目的身份"聚成一行。
 * 不产生任何新数据——输入是既有账本投影，输出是纯视图。
 *
 * 同名即同一人：默认花名册同名同人；自建成员重名视为同一团队身份（文档化
 * 于 docs/11 §5）。可选 `aliases`（name → personId 视图层绑定，R-17）在
 * 同名聚合之上生效。
 */

import { isTaskBlocked } from '../ledger/fold.js';

const ACTIVE_TASK_STATUSES = new Set(['pending', 'in_progress', 'pending_acceptance']);

/**
 * @param {Array<{id:string,name:string}>} registryEntries
 * @param {Array<{id:string,service:{state:any}}>} runtimes
 * @param {{ aliases?: Record<string,string> }} [options]
 * @returns {Array<{name:string,role:string,projects:Array,failures:number,activeTasks:number}>}
 */
export function aggregatePeople(registryEntries, runtimes, options = {}) {
	const aliases = options.aliases ?? null;
	const people = new Map();
	const bucketOf = (name) => {
		// 别名的目标可以是 `person:<id>`（真正的 personId）、`name:<名字>`，或
		// 历史数据里的裸名字。裸名字必须归一到 `name:<名字>`——否则「X → 白砚」
		// 会让 X 落到 `person:白砚`，而白砚本人是 `name:白砚`，两行永远合不到一起。
		const alias = aliases !== null && Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : null;
		if (alias === null) return `name:${name}`;
		if (alias.startsWith('person:') || alias.startsWith('name:')) return alias;
		return `name:${alias}`;
	};
	// 合并出来的那一行必须叫**目标**的名字：它由遍历顺序里第一个成员创建，若直接用
	// 该成员的原始名字，「百里 → 白砚」会合成一行却显示成「百里」。
	const displayNameOf = (name) => {
		const alias = aliases !== null && Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : null;
		return typeof alias === 'string' && alias.startsWith('name:') ? alias.slice('name:'.length) : name;
	};
	for (const runtime of runtimes) {
		const projectName = registryEntries.find((project) => project.id === runtime.id)?.name ?? runtime.id;
		const state = runtime.service?.state;
		if (state === undefined || state === null) continue;
		// 本项目的活跃任务计数：按 owner/assignee 两个责任位累计，并按状态
		// 分解（R-10 成员负载：进行中/待验收/受阻）。
		const loadByMember = new Map();
		for (const task of Object.values(state.tasks ?? {})) {
			if (task.tombstone === true || !ACTIVE_TASK_STATUSES.has(task.status)) continue;
			const bucketKey = task.status === 'in_progress' ? 'inProgress'
				: task.status === 'pending_acceptance' ? 'pendingAcceptance'
				: 'pending';
			for (const memberId of [task.ownerId, task.assigneeId]) {
				if (typeof memberId !== 'string' || memberId === '') continue;
				const load = loadByMember.get(memberId) ?? { activeTasks: 0, inProgress: 0, pendingAcceptance: 0, pending: 0, blocked: 0 };
				load.activeTasks += 1;
				if (bucketKey === 'inProgress') load.inProgress += 1;
				else if (bucketKey === 'pendingAcceptance') load.pendingAcceptance += 1;
				else load.pending += 1;
				if (isTaskBlocked(state, task) === true) load.blocked += 1;
				loadByMember.set(memberId, load);
			}
		}
		for (const member of Object.values(state.members ?? {})) {
			if (member.kind === 'human') continue;
			// 空串名不吃 ?? 兜底（fold 允许空名成员；空名各自按 id 独立成行）。
			const memberName = member.name || member.id;
			const bucket = bucketOf(memberName);
			const entry = people.get(bucket) ?? {
				name: displayNameOf(memberName),
				role: member.role ?? '',
				projects: [],
				failures: 0,
				activeTasks: 0,
			};
			if (entry.role === '' && member.role) entry.role = member.role;
			const load = loadByMember.get(member.id) ?? { activeTasks: 0, inProgress: 0, pendingAcceptance: 0, pending: 0, blocked: 0 };
			// 同人同项目出现多个 memberId（如离职后重入职的新会话 id）：合并为
			// 一行负载，memberIds 保留全部身份 id（兼容字段 memberId 取首个）。
			const existingProjectRow = entry.projects.find((row) => row.projectId === runtime.id);
			if (existingProjectRow !== undefined) {
				for (const key of ['activeTasks', 'inProgress', 'pendingAcceptance', 'pending', 'blocked']) {
					existingProjectRow[key] = (existingProjectRow[key] ?? 0) + load[key];
				}
				existingProjectRow.status = member.status ?? existingProjectRow.status;
				existingProjectRow.sessionId = member.sessionId ?? existingProjectRow.sessionId;
				existingProjectRow.memberIds = [...new Set([...(existingProjectRow.memberIds ?? [existingProjectRow.memberId].filter(Boolean)), member.id])];
				entry.failures += member.lastFailure !== undefined && member.lastFailure !== null ? 1 : 0;
				entry.activeTasks += load.activeTasks;
				people.set(bucket, entry);
				continue;
			}
			entry.projects.push({
				projectId: runtime.id,
				projectName,
				status: member.status ?? 'idle',
				sessionId: member.sessionId ?? null,
				memberIds: [member.id],
				talentPool: member.talentPool === true,
				attempts: member.attempts ?? 0,
				lastFailure: member.lastFailure ?? null,
				activeTasks: load.activeTasks,
				inProgress: load.inProgress,
				pendingAcceptance: load.pendingAcceptance,
				pending: load.pending,
				blocked: load.blocked,
			});
			if (member.lastFailure !== undefined && member.lastFailure !== null) entry.failures += 1;
			entry.activeTasks += load.activeTasks;
			people.set(bucket, entry);
		}
	}
	return [...people.values()].sort((left, right) => left.name.localeCompare(right.name));
}
// 语义备注：failures 计的是"当前仍带 lastFailure 的项目数"——member/recovered
// 不清 lastFailure（保留最近一次失败供展示），康复成员会继续计入；这是展示
// 口径而非存活判定（存活以 status 为准）。
