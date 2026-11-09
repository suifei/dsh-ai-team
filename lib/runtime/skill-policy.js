/**
 * Skills that must not be exposed by the AI Team plugin.
 *
 * These may still exist in the user's global DSH skill directory; the Team
 * provider and prompt catalog filter them so they never enter a member's Team
 * context or the workbench skill list.
 */
export const EXCLUDED_SKILL_NAMES = Object.freeze(new Set(['huashu-nuwa']));

export function isSkillExcluded(name) {
	return typeof name === 'string' && EXCLUDED_SKILL_NAMES.has(name);
}
