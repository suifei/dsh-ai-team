import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isSkillExcluded } from './skill-policy.js';

const MAX_SKILL_CHARS = 1800;

/** Read bounded SKILL.md files for member-declared skills from the profile skill library. */
export async function loadSkillContext(member, dataDir) {
	const skills = Array.isArray(member?.skills) ? member.skills : [];
	if (skills.length === 0 || typeof dataDir !== 'string') return '';
	const chunks = [];
	for (const raw of skills.slice(0, 4)) {
		const name = basename(String(raw)).replace(/[^a-zA-Z0-9._-]/g, '');
		if (name === '' || name === '.' || name === '..' || name.startsWith('.')) continue;
		if (isSkillExcluded(name)) continue;
		const candidates = [join(dataDir, 'skills', name, 'SKILL.md'), join(dataDir, 'skills', `${name}.md`)];
		for (const candidate of candidates) {
			try {
				const text = await readFile(candidate, 'utf8');
				chunks.push(`### ${name}\n${text.slice(0, MAX_SKILL_CHARS)}`);
				break;
			} catch (error) {
				if (error?.code !== 'ENOENT') break;
			}
		}
	}
	return chunks.length === 0 ? '' : `\n\n[技能资料]\n${chunks.join('\n\n')}`;
}
