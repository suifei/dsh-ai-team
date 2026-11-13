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
import { renderSkillVars } from './skill-loader.js';
import { reportFail } from '../diaglog.js';

/**
 * 从项目列表里挑出 cwd 所属的那个项目（用于把 `{{GOAL}}` 等变量渲染成真实值）。
 *
 * 技能加载器按文件原样返回内容，`get()` 不知道自己属于哪个项目；`list()` 知道 cwd，
 * 于是把它随候选一起带下去。这里只做「cwd → 项目」的匹配：先精确（忽略大小写与
 * 分隔符差异），再按前缀（成员在项目子目录里工作时也要命中），最后当只有一个项目时
 * 直接用它。
 *
 * @param {Array<{id?: string, name?: string, goal?: string, workspacePath?: string}>} projects
 * @param {string} cwd
 * @returns {{id: string, name: string, goal: string}|undefined}
 */
export function pickProjectForCwd(projects, cwd) {
	const list = (Array.isArray(projects) ? projects : []).filter((project) => project !== null && typeof project === 'object');
	if (list.length === 0) return undefined;
	const normalize = (value) => String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	const target = normalize(cwd);
	const shape = (project) => ({
		id: typeof project.id === 'string' ? project.id : '',
		name: typeof project.name === 'string' ? project.name : '',
		goal: typeof project.goal === 'string' ? project.goal.trim() : '',
	});
	if (target === '') return list.length === 1 ? shape(list[0]) : undefined;
	const withWorkspace = list.filter((project) => normalize(project.workspacePath) !== '');
	const exact = withWorkspace.find((project) => normalize(project.workspacePath) === target);
	if (exact !== undefined) return shape(exact);
	const prefix = withWorkspace
		.filter((project) => target.startsWith(normalize(project.workspacePath) + '/'))
		.sort((left, right) => normalize(right.workspacePath).length - normalize(left.workspacePath).length);
	if (prefix.length > 0) return shape(prefix[0]);
	return list.length === 1 ? shape(list[0]) : undefined;
}

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
	// CRLF 必须在这里断干净：`\r` 在 JS 里是行终止符，`.$` 无法越过它，
	// 带尾 `\r` 的最后一行（常见于 Windows 编辑器）会整行失配——
	// description 恰好位于末尾时，整个技能被当成「缺少 description」丢弃。
	const lines = text.slice(3, end).split(/\r\n|\r|\n/);
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
	// Must match the host registry's SKILL_NAME exactly (`^[a-z0-9]+(?:-[a-z0-9]+)*$`):
	// a name we accept but the registry rejects makes `skills.snapshot` throw
	// "skill provider returned invalid skill name", which aborts every agent step.
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;
	if (isSkillExcluded(name)) return null;
	const description = unquote(fields.description);
	// Official semantics: `description` is required; a skill without one is
	// dropped with a warning rather than synthesized into the catalog.
	if (description === '') {
		reportFail('skill.dropped.fail', { skill: name, file, reason: 'description-required' }, `[ai-team] skill "${name}" dropped: frontmatter description is required`);
		return null;
	}
	const modelInvocable = invocationFlag(fields, 'disable-model-invocation', true);
	const userInvocable = invocationFlag(fields, 'user-invocable', false);
	if (modelInvocable === null || userInvocable === null) {
		reportFail('skill.dropped.fail', { skill: name, file, reason: 'invocation-not-boolean' }, `[ai-team] skill "${name}" dropped: invocation flag is not a boolean`);
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

export function createFileSkillProvider({ dshHome, projectCwd, bundledDir, resolveVars } = {}) {
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
			const resolveCwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : projectCwd;
			for (const [root, source] of [...roots, ...extra]) {
				for (const candidate of scanRoot(root, source)) all.push({ ...candidate, resolveCwd });
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
			// 读取失败不能把 rejection 冒到 skill 工具：宿主在 agent/pre-step 里
			// await skills.snapshot，一次 EACCES/EBUSY 会打断该 agent 的整个回合。
			try {
				if (statSync(file).size > MAX_BODY_BYTES) return undefined;
				const raw = readFileSync(file, 'utf8');
				// 技能按文件原样提供，但 `{{GOAL}}` 这类占位符必须在返回前渲染：成员主动
				// 加载技能时不该看到字面量（与激活注入走同一套变量）。
				const vars = typeof resolveVars === 'function'
					? resolveVars({ cwd: candidate?.resolveCwd ?? projectCwd, candidate }) ?? {}
					: {};
				const content = renderSkillVars(raw, vars);
				return { ...candidate, content };
			} catch {
				return undefined;
			}
		},
	};
}

export function installFileSkillProvider(skills, options) {
	if (!skills || typeof skills.registerProvider !== 'function') return () => {};
	const provider = createFileSkillProvider(options);
	// SDK 契约（dsh-skill.md）：`registerProvider` 同步注册、**返回 disposer**，
	// 没有 invalidate 这一档。旧实现按「可能返回 { dispose, invalidate }」处理，
	// invalidate 分支永远不可达，属于死代码——这里只保留真实的两种返回形态。
	const control = skills.registerProvider(() => provider);
	const dispose = typeof control === 'function' ? control : control?.dispose;
	return () => {
		try { dispose?.(); } catch { /* already disposed */ }
	};
}
