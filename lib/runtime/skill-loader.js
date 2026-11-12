import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isSkillExcluded } from './skill-policy.js';
import { CORE_SKILL_TEXT } from './core-skill.js';

const MAX_SKILL_CHARS = 1800;

/** Read bounded SKILL.md files for member-declared skills from the profile skill library. */
export async function loadSkillContext(member, dataDir) {
	const skills = Array.isArray(member?.skills) ? member.skills : [];
	const chunks = [CORE_SKILL_TEXT.replace(/^---[\s\S]*?\n---\s*/, '').trim()];
	// 可以传一个根，也可以传多个根（工作区 `.dsh/skills`、用户 `~/.dsh/skills`、插件数据目录）。
	// 只认一个根时，成员声明的技能会静默缺席——调用方传的是项目账本目录，它下面
	// 永远没有 `skills/`。
	const roots = (Array.isArray(dataDir) ? dataDir : [dataDir])
		.filter((root) => typeof root === 'string' && root !== '');
	for (const raw of skills.slice(0, 4)) {
		const name = basename(String(raw)).replace(/[^a-zA-Z0-9._-]/g, '');
		if (name === '' || name === '.' || name === '..' || name.startsWith('.')) continue;
		if (isSkillExcluded(name)) continue;
		for (const root of roots) {
			let loaded = false;
			for (const candidate of [join(root, 'skills', name, 'SKILL.md'), join(root, 'skills', `${name}.md`)]) {
				try {
					const text = await readFile(candidate, 'utf8');
					chunks.push(`### ${name}\n${text.slice(0, MAX_SKILL_CHARS)}`);
					loaded = true;
					break;
				} catch (error) {
					if (error?.code !== 'ENOENT') break;
				}
			}
			if (loaded) break;
		}
	}
	return chunks.length === 0 ? '' : `\n\n[技能资料]\n${chunks.join('\n\n')}`;
}
