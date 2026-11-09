/**
 * Bounded, invocation-neutral view of the DSH skill catalog for a member
 * prompt. Full bodies stay with the `skill` tool; this only makes names,
 * descriptions and "when to use" discoverable so a member can load one on
 * demand instead of guessing.
 */

function clean(value, limit) {
	const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export async function formatSkillCatalog(skills, options = {}) {
	if (!skills || typeof skills.list !== 'function') return '';
	const summaries = await skills.list({
		...(options.cwd ? { cwd: options.cwd } : {}),
	}).catch(() => []);
	if (!Array.isArray(summaries) || summaries.length === 0) return '';
	const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 12;
	const rows = summaries.slice(0, limit).map((skill) => {
		const name = clean(skill?.name, 80);
		const description = clean(skill?.description, 240);
		const when = clean(skill?.whenToUse, 180);
		return `- ${name}：${description}${when ? `（何时用：${when}）` : ''}`;
	});
	return `\n\n## 可用 DSH 技能\n${rows.join('\n')}\n需要时用 skill 工具按名字加载完整技能说明；不要凭描述臆造步骤。`;
}
