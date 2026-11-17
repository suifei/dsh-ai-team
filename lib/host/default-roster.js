/**
 * The initial 文渊阁 roster. These are real Members in the Project ledger, not
 * UI placeholders: the Human can rename/re-role/re-model them, and the Lead is
 * the default Project owner so a one-line Main-stream request can start work.
 *
 * Seeded only when a Project has no Agent member yet. Once a member exists the
 * user's roster is authoritative and boot never adds these people back.
 *
 * The roster itself is configuration: a team under `teams/` that picks talents from
 * `talents/`, or a user team selected by the `teamPreset` setting (lib/domain/catalog.js).
 */

import { loadCatalog, resolveTeam } from '../domain/catalog.js';

/** Names shipped by 0.3.9 and earlier; only these exact pins are migrated. */
const LEGACY_DEFAULT_NAMES = Object.freeze({
	mem_lead: '沈舟',
	mem_maker: '林岚',
	mem_check: '顾清',
});

/** 成员记住来源团队、人才（含版本）、职责与技能：激活时按它们取岗位规程与技能（lib/runtime/skill-loader.js）。 */
function teamFields(preset, member) {
	return {
		team: preset.id,
		talent: member.talent.id,
		talentVersion: member.talent.version,
		...(member.duty ? { duty: member.duty } : {}),
		...(member.skills?.length > 0 ? { skills: member.skills } : {}),
	};
}

function agentMembers(service) {
	return Object.values(service.state.members ?? {}).filter((member) => member.kind === 'agent');
}

async function upgradeLegacyDefaultNames(service, projectId, humanId, roster) {
	const renamed = [];
	for (const [memberId, legacyName] of Object.entries(LEGACY_DEFAULT_NAMES)) {
		const member = service.state.members?.[memberId];
		if (member === undefined || member.kind !== 'agent' || member.name !== legacyName) continue;
		const next = roster.find((entry) => entry.id === memberId);
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
 * Add the team's roster to an empty Project and make its lead the owner.
 * On an existing roster, exact legacy default names are upgraded and, for the bundled team, any
 * still-missing core-role member (UX/业务) is appended; custom names, custom
 * roles and the user's own roster are never touched or duplicated.
 * @returns {Promise<{seeded: boolean, members: string[], renamed: string[]}>}
 */
export async function seedDefaultRoster(service, projectId, { humanId = 'mem_human', preset = resolveTeam(loadCatalog()) } = {}) {
	const { team } = preset;
	const roster = team.members;
	if (agentMembers(service).length > 0) {
		const renamed = await upgradeLegacyDefaultNames(service, projectId, humanId, roster);
		// 补缺岗只是老项目补齐 UX/业务 的迁移，只按内置团队做；用户团队只用于新项目，不改已有项目。
		if (preset.source !== 'bundled') return { seeded: false, members: [], renamed };
		const added = [];
		const existingRoles = new Set(agentMembers(service).map((member) => member.role));
		const existingIds = new Set(Object.keys(service.state.members ?? {}));
		for (const member of roster) {
			if (existingIds.has(member.id)) continue;
			if (existingRoles.has(member.role)) continue;
			await service.dispatch({
				type: 'member.add',
				actor: { kind: 'human', memberId: humanId },
				projectId,
				payload: {
					id: member.id,
					name: member.name,
					role: member.role,
					personality: member.personality,
					...teamFields(preset, member),
					kind: 'agent',
					status: 'idle',
				},
			});
			existingIds.add(member.id);
			existingRoles.add(member.role);
			added.push(member.id);
		}
		return { seeded: false, members: added, renamed };
	}
	const added = [];
	for (const member of roster) {
		await service.dispatch({
			type: 'member.add',
			actor: { kind: 'human', memberId: humanId },
			projectId,
			payload: {
				id: member.id,
				name: member.name,
				role: member.role,
				personality: member.personality,
				...teamFields(preset, member),
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
			payload: { ownerMemberId: team.lead, reason: 'seed default roster' },
		});
	}
	return { seeded: true, members: added, renamed: [] };
}
