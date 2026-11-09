/**
 * The initial 文渊阁 roster. These are real Members in the Project ledger, not
 * UI placeholders: the Human can rename/re-role/re-model them, and the Lead is
 * the default Project owner so a one-line Main-stream request can start work.
 *
 * Seeded only when a Project has no Agent member yet. Once a member exists the
 * user's roster is authoritative and boot never adds these people back.
 */

export const DEFAULT_MEMBER_ROSTER = Object.freeze([
	{
		id: 'mem_lead',
		name: '墨渊',
		role: '主理人',
		personality: '先定义可验收的结果，再把方向拆成 Task；不替执行者写实现，只在关键时刻做决定。',
	},
	{
		id: 'mem_maker',
		name: '青岚',
		role: '执行',
		personality: '认领 Task 后直接推进，先交付可运行结果和证据再汇报；遇到阻塞先找 owner。',
	},
	{
		id: 'mem_check',
		name: '白砚',
		role: '验收',
		personality: '独立验收，只按结果定义和证据判断；不确定就退回，不与执行者共用 claim。',
	},
]);

/** Names shipped by 0.3.9 and earlier; only these exact pins are migrated. */
const LEGACY_DEFAULT_NAMES = Object.freeze({
	mem_lead: '沈舟',
	mem_maker: '林岚',
	mem_check: '顾清',
});

export const DEFAULT_LEAD_ID = 'mem_lead';

function agentMembers(service) {
	return Object.values(service.state.members ?? {}).filter((member) => member.kind === 'agent');
}

async function upgradeLegacyDefaultNames(service, projectId, humanId) {
	const renamed = [];
	for (const [memberId, legacyName] of Object.entries(LEGACY_DEFAULT_NAMES)) {
		const member = service.state.members?.[memberId];
		if (member === undefined || member.kind !== 'agent' || member.name !== legacyName) continue;
		const next = DEFAULT_MEMBER_ROSTER.find((entry) => entry.id === memberId);
		if (next === undefined) continue;
		await service.dispatch({
			type: 'member.profile.update',
			actor: { kind: 'human', memberId: humanId },
			projectId,
			payload: { memberId, name: next.name, reason: 'rename legacy default roster' },
		});
		renamed.push(memberId);
	}
	return renamed;
}

/**
 * Add the default roster to an empty Project and make the Lead its owner.
 * On an existing roster, only exact legacy default names are upgraded; custom
 * names and custom roles are never touched.
 * @returns {Promise<{seeded: boolean, members: string[], renamed: string[]}>}
 */
export async function seedDefaultRoster(service, projectId, { humanId = 'mem_human' } = {}) {
	if (agentMembers(service).length > 0) {
		const renamed = await upgradeLegacyDefaultNames(service, projectId, humanId);
		return { seeded: false, members: [], renamed };
	}
	const added = [];
	for (const member of DEFAULT_MEMBER_ROSTER) {
		await service.dispatch({
			type: 'member.add',
			actor: { kind: 'human', memberId: humanId },
			projectId,
			payload: {
				id: member.id,
				name: member.name,
				role: member.role,
				personality: member.personality,
				kind: 'agent',
				status: 'idle',
			},
		});
		added.push(member.id);
	}
	const project = service.state.projects?.[projectId];
	const owner = project?.ownerMemberId ?? project?.ownerId;
	if (owner === humanId || owner === undefined || owner === null) {
		await service.dispatch({
			type: 'project.owner.update',
			actor: { kind: 'human', memberId: humanId },
			projectId,
			payload: { ownerMemberId: DEFAULT_LEAD_ID, reason: 'seed default roster' },
		});
	}
	return { seeded: true, members: added, renamed: [] };
}
