/**
 * Bounded, invocation-neutral view of the DSH skill catalog for a member
 * prompt. Full bodies stay with the `skill` tool; this only makes names,
 * descriptions and "when to use" discoverable so a member can load one on
 * demand instead of guessing.
 */

import { isSkillExcluded } from './skill-policy.js';

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
	// 只注入「模型可以自己调用」的技能：`disable-model-invocation: true` 的技能
	// 是给 Human 显式用的，列进成员 prompt 会把成员引向一个它无权调用的入口。
	// SkillSummary 把这两个开关放在 `invocation` 下；直接读顶层字段会让过滤永远
	// 通过（字段恒为 undefined），被禁的技能照样写进 prompt。
	const available = summaries.filter((skill) => {
		if (isSkillExcluded(skill?.name)) return false;
		const modelInvocable = skill?.invocation?.modelInvocable ?? skill?.modelInvocable;
		const disabled = skill?.invocation?.disableModelInvocation ?? skill?.disableModelInvocation;
		if (modelInvocable === false || disabled === true) return false;
		return true;
	});
	if (available.length === 0) return '';
	const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 12;
	const rows = available.slice(0, limit).map((skill) => {
		const name = clean(skill?.name, 80);
		const description = clean(skill?.description, 240);
		const when = clean(skill?.whenToUse, 180);
		return `- ${name}：${description}${when ? `（何时用：${when}）` : ''}`;
	});
	return `\n\n## 可用 DSH 技能\n${rows.join('\n')}\n需要时用 skill 工具按名字加载完整技能说明；不要凭描述臆造步骤。`;
}
