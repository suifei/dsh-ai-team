/**
 * Filesystem skill provider for DSH profiles that do not mount the desktop
 * marketplace's user-skill scanner. It exposes `<dshHome>/skills` and project
 * `.dsh/skills` / `.agents/skills` to the normal `skills` service, so members can
 * load installed skills through their own `skill` tool.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BODY_BYTES = 512 * 1024;

function parseFrontmatter(text) {
	if (!text.startsWith('---')) return {};
	const end = text.indexOf('\n---', 3);
	if (end < 0) return {};
	const lines = text.slice(3, end).split(/\r?\n/);
	const fields = {};
	let key = null;
	for (const line of lines) {
		const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (match) {
			key = match[1];
			fields[key] = match[2].trim();
			continue;
		}
		if (key !== null && /^\s+/.test(line)) {
			fields[key] = `${fields[key] ? fields[key] + ' ' : ''}${line.trim()}`;
		}
	}
	return fields;
}

function unquote(value) {
	const text = String(value ?? '').trim();
	return text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
		? text.slice(1, -1)
		: text;
}

function scanRoot(root, source) {
	const candidates = [];
	if (!existsSync(root)) return candidates;
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return candidates;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		const file = join(root, entry.name, 'SKILL.md');
		if (!existsSync(file)) continue;
		let text;
		try {
			if (statSync(file).size > MAX_BODY_BYTES) continue;
			text = readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		const fields = parseFrontmatter(text);
		const name = unquote(fields.name) || entry.name;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
		candidates.push({
			name,
			description: unquote(fields.description) || `Skill ${name}`,
			whenToUse: unquote(fields.whenToUse) || unquote(fields['when-to-use']) || undefined,
			invocation: { modelInvocable: true, userInvocable: true },
			source,
			provider: 'ai-team-files',
			path: file,
			locator: file,
			rank: 0,
		});
	}
	return candidates;
}

export function createFileSkillProvider({ dshHome, projectCwd } = {}) {
	const roots = [];
	if (dshHome) roots.push([join(dshHome, 'skills'), 'user-dsh']);
	if (projectCwd) {
		roots.push([join(projectCwd, '.dsh', 'skills'), 'project-dsh']);
		roots.push([join(projectCwd, '.agents', 'skills'), 'project-agents']);
	}
	return {
		name: 'ai-team-files',
		async list(options = {}) {
			const extra = options.cwd && options.cwd !== projectCwd
				? [
					[join(options.cwd, '.dsh', 'skills'), 'project-dsh'],
					[join(options.cwd, '.agents', 'skills'), 'project-agents'],
				]
				: [];
			const seen = new Set();
			const all = [];
			for (const [root, source] of [...roots, ...extra]) {
				for (const candidate of scanRoot(root, source)) {
					if (seen.has(candidate.name)) continue;
					seen.add(candidate.name);
					all.push(candidate);
				}
			}
			return all.sort((left, right) => left.name.localeCompare(right.name));
		},
		async get(candidate) {
			const file = candidate?.locator;
			if (typeof file !== 'string' || !existsSync(file)) return undefined;
			if (statSync(file).size > MAX_BODY_BYTES) return undefined;
			return { ...candidate, content: readFileSync(file, 'utf8') };
		},
	};
}

export function installFileSkillProvider(skills, options) {
	if (!skills || typeof skills.registerProvider !== 'function') return () => {};
	const provider = createFileSkillProvider(options);
	return skills.registerProvider(() => provider);
}

