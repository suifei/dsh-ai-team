/**
 * Filesystem skill provider for DSH profiles that do not mount the desktop
 * marketplace's user-skill scanner. It exposes `<dshHome>/skills` and project
 * `.dsh/skills` / `.agents/skills` to the normal `skills` service, so members can
 * load installed skills through their own `skill` tool.
 *
 * Discovery parity with @deepseek-ai/dsh-skill-filesystem (README L36-56):
 * directory bundles `<name>/SKILL.md` and flat `<name>.md` files, required
 * kebab-case `name` + `description`, loose-boolean `disable-model-invocation`
 * / `user-invocable` keys, and the official rank order (project-dsh 100,
 * project-agents 200, user-dsh 400, bundled 600; lower rank wins a name).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSkillExcluded } from './skill-policy.js';

const MAX_BODY_BYTES = 512 * 1024;

/** Official per-source ranks; a lower rank beats a higher one on name clash. */
const SOURCE_RANK = Object.freeze({
	'project-dsh': 100,
	'project-agents': 200,
	'user-dsh': 400,
	bundled: 600,
});

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

/**
 * Official loose boolean syntax (skill-filesystem README L38): YAML booleans
 * plus case-insensitive true/false, yes/no, on/off, 1/0. `null` marks a
 * rejected spelling, which drops the whole skill instead of silently allowing
 * an interface.
 */
function parseLooseBoolean(value) {
	if (typeof value === 'boolean') return value;
	const text = String(value ?? '').trim().toLowerCase();
	if (['true', 'yes', 'on', '1'].includes(text)) return true;
	if (['false', 'no', 'off', '0'].includes(text)) return false;
	return null;
}

/** Resolve one invocation flag; returns null when the skill must be dropped. */
function invocationFlag(fields, key, inverted) {
	const raw = fields[key];
	if (raw === undefined) return true;
	const parsed = parseLooseBoolean(raw);
	if (parsed === null) return null;
	return inverted ? !parsed : parsed;
}

function scanCandidate(file, fallbackName, source) {
	if (!existsSync(file)) return null;
	let text;
	try {
		if (statSync(file).size > MAX_BODY_BYTES) return null;
		text = readFileSync(file, 'utf8');
	} catch {
		return null;
	}
	const fields = parseFrontmatter(text);
	const name = unquote(fields.name) || fallbackName;
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
	if (isSkillExcluded(name)) return null;
	const description = unquote(fields.description);
	// Official semantics: `description` is required; a skill without one is
	// dropped with a warning rather than synthesized into the catalog.
	if (description === '') {
		console.warn(`[ai-team] skill "${name}" dropped: frontmatter description is required`);
		return null;
	}
	const modelInvocable = invocationFlag(fields, 'disable-model-invocation', true);
	const userInvocable = invocationFlag(fields, 'user-invocable', false);
	if (modelInvocable === null || userInvocable === null) {
		console.warn(`[ai-team] skill "${name}" dropped: "${modelInvocable === null ? 'disable-model-invocation' : 'user-invocable'}" is not a recognized boolean`);
		return null;
	}
	return {
		name,
		description,
		whenToUse: unquote(fields.whenToUse) || unquote(fields['when-to-use']) || undefined,
		invocation: { modelInvocable, userInvocable },
		source,
		provider: 'ai-team-files',
		path: file,
		locator: file,
		rank: SOURCE_RANK[source] ?? 500,
	};
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
		if (entry.name.startsWith('.')) continue;
		if (entry.isDirectory()) {
			const found = scanCandidate(join(root, entry.name, 'SKILL.md'), entry.name, source);
			if (found !== null) candidates.push(found);
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.md')) {
			const found = scanCandidate(join(root, entry.name), entry.name.replace(/\.md$/, ''), source);
			if (found !== null) candidates.push(found);
		}
	}
	return candidates;
}

export function createFileSkillProvider({ dshHome, projectCwd, bundledDir } = {}) {
	// Bundled last: the official rank order puts disk roots above the packaged
	// copy, so a user's own edit of a same-named skill wins (README L48-56).
	const roots = [];
	if (projectCwd) {
		roots.push([join(projectCwd, '.dsh', 'skills'), 'project-dsh']);
		roots.push([join(projectCwd, '.agents', 'skills'), 'project-agents']);
	}
	if (dshHome) roots.push([join(dshHome, 'skills'), 'user-dsh']);
	if (bundledDir) roots.push([join(bundledDir, 'skills'), 'bundled']);
	return {
		name: 'ai-team-files',
		async list(options = {}) {
			const extra = options.cwd && options.cwd !== projectCwd
				? [
					[join(options.cwd, '.dsh', 'skills'), 'project-dsh'],
					[join(options.cwd, '.agents', 'skills'), 'project-agents'],
				]
				: [];
			const all = [];
			for (const [root, source] of [...roots, ...extra]) {
				all.push(...scanRoot(root, source));
			}
			// Same-name clash: the lowest rank wins, mirroring the registry's
			// rank → provider-order → local-order adjudication.
			const byName = new Map();
			for (const candidate of all.sort((left, right) => left.rank - right.rank)) {
				if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
			}
			return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
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
