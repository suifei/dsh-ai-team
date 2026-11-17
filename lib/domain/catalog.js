/**
 * 人才市场目录：人才 → 团队 → 项目成员。
 *
 *   talents/<人才>/talent.yml               一个能干特定事的智能体：职责、性格、技能、推荐模型
 *   talents/<人才>/skills/<技能>/SKILL.md   人才自带的技能
 *   teams/<团队>/team.yml                   从人才里挑人组队（只引用人才），选团队的岗位规程
 *   teams/<团队>/skills/<规程>/SKILL.md     团队的工作方式（主理人 / 验收 / 执行三份岗位规程）
 *
 * 同一格式有多处来源，按顺序覆盖（同名先到先得）：用户自建 `~/.dsh/ai-team/catalog/user/`
 * → （第 3 步）官方在线库 → 插件内置。招进项目的成员是账本里的实例，记下来源人才与版本；
 * 人才文件之后再变，不会悄悄改动已招成员的性格与职责。
 * 文件写坏不阻断：记一行 `.fail` 诊断，跳过它（更低优先级的同名条目顶上）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** 插件内置目录（包根，下有 talents/ 与 teams/）。 */
export const BUNDLED_CATALOG_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_TEAM = 'default';
/** 三种职责，各对应一份岗位规程。 */
export const DUTIES = Object.freeze(['lead', 'qa', 'executor']);
export const DEFAULT_PROCEDURES = Object.freeze({ lead: 'ai-team-core', qa: 'ai-team-qa', executor: 'ai-team-executor' });

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEMBER_ID = /^mem_[a-z0-9_]{1,60}$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function readYaml(source, label) {
	let doc;
	try {
		doc = parse(source);
	} catch (error) {
		throw new Error(`${label}: YAML 解析失败：${error.message}`);
	}
	if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${label}: 顶层必须是对象`);
	return doc;
}

function skillName(value, at) {
	const name = text(value, 64);
	if (!SKILL_NAME.test(name) || name.includes('..')) throw new Error(`${at} 不是合法的技能名：${String(value)}`);
	return name;
}

function skillList(value, at) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`${at} 必须是列表`);
	return [...new Set(value.map((skill, i) => skillName(skill, `${at}[${i}]`)))];
}

function duty(value, at) {
	if (value === undefined || value === null) return null;
	if (!DUTIES.includes(value)) throw new Error(`${at} 只认 ${DUTIES.join(' / ')}`);
	return value;
}

/**
 * talent.yml → 规范化人才；不合法抛错（说明哪一处）。
 * @param {string} source
 * @param {string} [label]
 */
export function parseTalent(source, label = 'talent') {
	const doc = readYaml(source, label);
	const name = text(doc.name, 40);
	const role = text(doc.role, 40);
	if (name === '') throw new Error(`${label}: name 不能为空`);
	if (role === '') throw new Error(`${label}: role 不能为空`);
	const version = doc.version === undefined ? '1.0.0' : text(String(doc.version), 32);
	if (!VERSION.test(version)) throw new Error(`${label}: version 必须形如 1.2.3`);
	if (doc.tags !== undefined && !Array.isArray(doc.tags)) throw new Error(`${label}: tags 必须是列表`);
	let model = null;
	if (doc.model !== undefined && doc.model !== null) {
		if (typeof doc.model !== 'object' || Array.isArray(doc.model)) throw new Error(`${label}: model 必须是对象（provider / model / reasoningEffort）`);
		model = {
			provider: text(doc.model.provider, 80),
			model: text(doc.model.model, 160),
			reasoningEffort: text(doc.model.reasoningEffort, 20),
		};
	}
	return {
		version,
		name,
		role,
		duty: duty(doc.duty, `${label}: duty`),
		category: text(doc.category, 20),
		tags: (doc.tags ?? []).map((tag) => text(String(tag), 20)).filter(Boolean).slice(0, 12),
		description: text(doc.description, 400),
		personality: text(doc.personality, 2000),
		skills: skillList(doc.skills, `${label}: skills`),
		model,
	};
}

/**
 * team.yml → 规范化团队（成员仍是对人才的引用，见 resolveTeam）；不合法抛错。
 * @param {string} source
 * @param {string} [label]
 */
export function parseTeam(source, label = 'team') {
	const doc = readYaml(source, label);
	if (!Array.isArray(doc.members) || doc.members.length === 0) throw new Error(`${label}: members 至少要有一位成员`);
	const procedures = { ...DEFAULT_PROCEDURES };
	if (doc.procedures !== undefined && doc.procedures !== null) {
		if (typeof doc.procedures !== 'object' || Array.isArray(doc.procedures)) throw new Error(`${label}: procedures 必须是对象`);
		for (const [kind, name] of Object.entries(doc.procedures)) {
			if (!DUTIES.includes(kind)) throw new Error(`${label}: procedures.${kind} 不是职责（只认 ${DUTIES.join(' / ')}）`);
			procedures[kind] = skillName(name, `${label}: procedures.${kind}`);
		}
	}
	const ids = new Set();
	const members = doc.members.map((raw, index) => {
		const at = `${label}: members[${index}]`;
		if (raw === null || typeof raw !== 'object') throw new Error(`${at} 必须是对象`);
		const talent = text(raw.talent, 64);
		if (!SLUG.test(talent)) throw new Error(`${at}.talent 必须是人才 id（小写字母、数字、连字符）`);
		const id = raw.id === undefined ? `mem_${talent.replace(/-/g, '_')}` : text(raw.id, 64);
		if (!MEMBER_ID.test(id)) throw new Error(`${at}.id 必须形如 mem_xxx（小写字母、数字、下划线）`);
		if (ids.has(id)) throw new Error(`${at}.id 重复：${id}（同一人才招两位时给每位写 id）`);
		ids.add(id);
		return {
			id,
			talent,
			name: text(raw.name, 40),
			role: text(raw.role, 40),
			duty: duty(raw.duty, `${at}.duty`),
			personality: text(raw.personality, 2000),
			skills: skillList(raw.skills, `${at}.skills`),
		};
	});
	const lead = doc.lead === undefined || doc.lead === null ? members[0].id : text(doc.lead, 64);
	if (!ids.has(lead)) throw new Error(`${label}: lead「${lead}」不在 members 的 id 里`);
	return { name: text(doc.name, 60), description: text(doc.description, 400), lead, procedures, members };
}

/** 用户自建目录 + 插件内置目录（第 3 步在两者之间插入官方在线库）。 */
export function catalogRoots({ dshHome, bundledDir = BUNDLED_CATALOG_DIR } = {}) {
	return [
		...(typeof dshHome === 'string' && dshHome !== '' ? [{ source: 'user', dir: join(dshHome, 'ai-team', 'catalog', 'user') }] : []),
		{ source: 'bundled', dir: bundledDir },
	];
}

function scan(roots, kind, file, parser, diag) {
	const found = new Map();
	for (const { source, dir } of roots) {
		const base = join(dir, kind);
		if (!existsSync(base)) continue;
		for (const id of readdirSync(base)) {
			if (!SLUG.test(id) || found.has(id)) continue;
			const path = join(base, id, file);
			if (!existsSync(path)) continue;
			try {
				found.set(id, { id, source, dir: join(base, id), ...parser(readFileSync(path, 'utf8'), path) });
			} catch (error) {
				diag?.append?.({ ev: 'catalog.load.fail', kind, id, source, message: error.message });
			}
		}
	}
	return found;
}

/**
 * 读出全部人才与团队（每次现读：改了文件不用重启）。
 * @param {{ roots?: Array<{source: string, dir: string}>, diag?: { append?: (row: object) => void } }} [options]
 */
export function loadCatalog({ roots = catalogRoots(), diag } = {}) {
	return {
		talents: scan(roots, 'talents', 'talent.yml', parseTalent, diag),
		teams: scan(roots, 'teams', 'team.yml', parseTeam, diag),
	};
}

/** 人才市场列表（给「添加成员」弹窗）：按分类、名字排序。 */
export function listTalents(catalog) {
	return [...catalog.talents.values()]
		.map(({ id, source, version, name, role, duty: d, category, tags, description, personality, skills, model }) => ({ id, source, version, name, role, duty: d, category, tags, description, personality, skills, model }))
		.sort((a, b) => a.category.localeCompare(b.category, 'zh') || a.name.localeCompare(b.name, 'zh'));
}

/**
 * 团队 → 可直接建成员的名单：每位成员按引用的人才补齐名字、岗位、职责、性格与技能
 * （团队里写了的覆盖人才的）。团队缺失、写坏或引用了不存在的人才时退回默认团队并记 `.fail`。
 * @returns {{ id: string, source: string, dir: string, team: { name: string, description: string, lead: string, procedures: Record<string, string>, members: object[] } }}
 */
export function resolveTeam(catalog, name = DEFAULT_TEAM, { diag } = {}) {
	const wanted = typeof name === 'string' && SLUG.test(name) ? name : DEFAULT_TEAM;
	if (wanted !== name) diag?.append?.({ ev: 'catalog.team.fail', name, reason: 'invalid team name' });
	const entry = catalog.teams.get(wanted);
	try {
		if (entry === undefined) throw new Error(`team ${wanted} not found`);
		const members = entry.members.map((member) => {
			const talent = catalog.talents.get(member.talent);
			if (talent === undefined) throw new Error(`team ${wanted}: talent ${member.talent} not found`);
			return {
				id: member.id,
				name: member.name || talent.name,
				role: member.role || talent.role,
				duty: member.duty ?? talent.duty,
				personality: member.personality || talent.personality,
				skills: [...new Set([...talent.skills, ...member.skills])],
				talent: { id: talent.id, version: talent.version, source: talent.source },
				model: talent.model,
			};
		});
		return { id: wanted, source: entry.source, dir: entry.dir, team: { name: entry.name || wanted, description: entry.description, lead: entry.lead, procedures: entry.procedures, members } };
	} catch (error) {
		if (wanted === DEFAULT_TEAM) throw error; // 内置默认团队有测试守着；坏了说明安装包坏了。
		diag?.append?.({ ev: 'catalog.team.fail', name: wanted, message: error.message });
		return resolveTeam(catalog, DEFAULT_TEAM, { diag });
	}
}

/**
 * 某职责的岗位规程正文（含 front-matter，调用方负责剥掉）：先找团队自己的 skills/，
 * 团队没带就退回内置默认团队的同职责规程。
 */
export function procedureText(preset, kind, { bundledDir = BUNDLED_CATALOG_DIR } = {}) {
	const d = DUTIES.includes(kind) ? kind : 'executor';
	const candidates = [];
	if (preset?.dir) candidates.push(join(preset.dir, 'skills', preset.team?.procedures?.[d] ?? DEFAULT_PROCEDURES[d], 'SKILL.md'));
	candidates.push(join(bundledDir, 'teams', DEFAULT_TEAM, 'skills', DEFAULT_PROCEDURES[d], 'SKILL.md'));
	for (const file of candidates) if (existsSync(file)) return readFileSync(file, 'utf8');
	throw new Error(`bundled procedure missing: ${candidates.at(-1)}`);
}
