/**
 * 人才市场目录：人才 → 团队 → 项目成员。
 *
 *   talents/<人才>/talent.yml               一个能干特定事的智能体：职责、性格、技能、推荐模型
 *   talents/<人才>/skills/<技能>/SKILL.md   人才自带的技能
 *   teams/<团队>/team.yml                   从人才里挑人组队（只引用人才），选团队的岗位规程
 *   teams/<团队>/skills/<规程>/SKILL.md     团队的工作方式（主理人 / 验收 / 执行三份岗位规程）
 *
 * 同一格式有多处来源，按顺序覆盖（同名先到先得）：用户自建 `~/.dsh/ai-team/catalog/user/`
 * → 官方在线库 `~/.dsh/ai-team/catalog/official/<版本>/`（lib/domain/catalog-sync.js 同步）→ 插件内置。招进项目的成员是账本里的实例，记下来源人才与版本；
 * 人才文件之后再变，不会悄悄改动已招成员的性格与职责。
 * 文件写坏不阻断：记一行 `.fail` 诊断，跳过它（更低优先级的同名条目顶上）。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { parseAvatar } from './avatar.js';
import { compareVersions, officialRoot } from './catalog-sync.js';

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
		avatar: parseAvatar(doc.avatar, `${label}: avatar`),
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

/** 用户自建目录（可写），自定义人才与自建团队都落在这里。 */
export function userCatalogDir(dshHome) {
	if (typeof dshHome !== 'string' || dshHome === '') throw new Error('userCatalogDir: 需要 dshHome');
	return join(dshHome, 'ai-team', 'catalog', 'user');
}

/** 用户自建 → 官方在线库（同步过才有）→ 插件内置。 */
export function catalogRoots({ dshHome, bundledDir = BUNDLED_CATALOG_DIR } = {}) {
	const home = typeof dshHome === 'string' && dshHome !== '';
	const official = home ? officialRoot(dshHome) : null;
	return [
		...(home ? [{ source: 'user', dir: userCatalogDir(dshHome) }] : []),
		...(official !== null ? [{ source: 'official', dir: official.dir }] : []),
		{ source: 'bundled', dir: bundledDir },
	];
}

function scan(roots, kind, file, parser, diag) {
	const found = new Map();
	for (const { source, dir } of roots) {
		const base = join(dir, kind);
		if (!existsSync(base)) continue;
		for (const id of readdirSync(base)) {
			if (!SLUG.test(id)) continue;
			const path = join(base, id, file);
			if (!existsSync(path)) continue;
			const prior = found.get(id);
			if (prior !== undefined) {
				// 用户根里的同 id 条目遮盖了下层的（fork 出的可编辑副本）：记下被遮盖的来源，界面标「已改」。
				if (prior.source === 'user') prior.shadows ??= source;
				// 插件升级后内置人才版本更高，而本机的在线库还旧：用更新的内置版（在线库同版本或更新时仍用在线库）。
				if (!(prior.source === 'official' && source === 'bundled')) continue;
			}
			try {
				const entry = { id, source, dir: join(base, id), ...parser(readFileSync(path, 'utf8'), path) };
				if (prior !== undefined && !(compareVersions(entry.version, prior.version) > 0)) continue;
				found.set(id, entry);
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
		.map(({ id, source, version, name, role, duty: d, category, tags, description, personality, skills, model, avatar, shadows }) => ({ id, source, version, name, role, duty: d, category, tags, description, personality, skills, model, avatar: avatar ?? null, forked: source === 'user' && shadows !== undefined }))
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
				avatar: talent.avatar ?? null,
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

// —— 写层（第 2 步 2a：安装 skill + 新建自定义人才）——
// 只往用户根写，内置永不触碰；同名用户条目遮盖内置即「覆盖」。校验复用 parseTalent：
// 先 stringify 再 parse，验不过就抛、绝不落盘，保证盘上的文件一定能被 loadCatalog 读回。

/** 规范人才 id：小写字母、数字、连字符，≤64 位（与扫描用的 SLUG 同一把尺）。 */
export function talentIdFrom(value) {
	const id = text(value, 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
	return SLUG.test(id) ? id : '';
}

function talentDoc(input) {
	const doc = { version: text(String(input?.version ?? '1.0.0'), 32) || '1.0.0', name: text(input?.name, 40), role: text(input?.role, 40) };
	if (input?.duty) doc.duty = input.duty;
	if (text(input?.category, 20)) doc.category = text(input.category, 20);
	const tags = Array.isArray(input?.tags) ? input.tags.map((t) => text(String(t), 20)).filter(Boolean).slice(0, 12) : [];
	if (tags.length) doc.tags = tags;
	if (text(input?.description, 400)) doc.description = text(input.description, 400);
	if (text(input?.personality, 2000)) doc.personality = text(input.personality, 2000);
	const skills = skillList(input?.skills, 'skills');
	if (skills.length) doc.skills = skills;
	const m = input?.model;
	if (m && (text(m.provider, 80) || text(m.model, 160))) doc.model = { provider: text(m.provider, 80), model: text(m.model, 160), reasoningEffort: text(m.reasoningEffort, 20) };
	const avatar = parseAvatar(input?.avatar);
	if (avatar) doc.avatar = avatar;
	return doc;
}

/**
 * 写一个用户自定义人才：`<userRoot>/talents/<id>/talent.yml`。校验不过时抛错、不落盘。
 * @returns {{ id: string, source: 'user', dir: string } & ReturnType<typeof parseTalent>}
 */
export function writeTalent(userRoot, id, input) {
	if (typeof userRoot !== 'string' || userRoot === '') throw new Error('writeTalent: 需要 userRoot');
	if (typeof id !== 'string' || !SLUG.test(id)) throw new Error('人才 id 必须是小写字母、数字、连字符，≤64 位');
	const yaml = stringify(talentDoc(input), { lineWidth: 0 });
	const talent = parseTalent(yaml, `talent ${id}`); // 先验后写
	const dir = join(userRoot, 'talents', id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'talent.yml'), yaml, 'utf8');
	return { id, source: 'user', dir, ...talent };
}

/** 删一个用户自定义人才（连同自带技能）。只删用户根下的。 */
export function deleteTalent(userRoot, id) {
	if (typeof id !== 'string' || !SLUG.test(id)) throw new Error('人才 id 不合法');
	rmSync(join(userRoot, 'talents', id), { recursive: true, force: true });
}

/**
 * 把内置人才 fork 成用户根里的可编辑副本：同 id 整个文件夹（talent.yml + skills/）拷过去。
 * 同 id 遮盖内置版，已招的成员下次激活就读副本里的技能；删掉副本即恢复内置版。
 * 已有用户副本时不覆盖（返回 forked: false），免得把改过的副本冲掉。
 */
export function forkTalent(userRoot, talent) {
	if (typeof userRoot !== 'string' || userRoot === '') throw new Error('forkTalent: 需要 userRoot');
	if (!talent || !SLUG.test(talent.id ?? '')) throw new Error('人才 id 不合法');
	const dir = join(userRoot, 'talents', talent.id);
	if (existsSync(join(dir, 'talent.yml'))) return { forked: false, dir };
	if (talent.source === 'user') return { forked: false, dir: talent.dir };
	cpSync(talent.dir, dir, { recursive: true });
	return { forked: true, dir };
}

/** 把一份技能装进某人才自己的文件夹：`<talentDir>/skills/<name>/SKILL.md`。返回规范后的技能名。 */
export function installSkill(talentDir, name, markdown) {
	if (typeof talentDir !== 'string' || talentDir === '') throw new Error('installSkill: 需要 talentDir');
	const safe = skillName(name, '技能名');
	const dir = join(talentDir, 'skills', safe);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'SKILL.md'), typeof markdown === 'string' ? markdown : '', 'utf8');
	return safe;
}

/** 读某人才自带技能的正文（给预览与 fork）。 */
export function readSkillText(talentDir, name) {
	return readFileSync(join(talentDir, 'skills', skillName(name, '技能名'), 'SKILL.md'), 'utf8');
}

/**
 * 新建时取一个不撞车的 id：已被任何来源（用户或内置）占用就加序号 -2、-3…。
 * 新建绝不静默覆盖别人的人才，也不意外遮盖同名内置人才（要覆盖得显式 overwrite）。
 */
export function uniqueTalentId(catalog, base) {
	return uniqueIn(catalog.talents, base);
}

/** 新建团队同理：撞了已有团队（含内置）就加序号。 */
export function uniqueTeamId(catalog, base) {
	return uniqueIn(catalog.teams, base);
}

function uniqueIn(taken, base) {
	if (!SLUG.test(base)) return '';
	if (!taken.has(base)) return base;
	for (let n = 2; n < 1000; n += 1) {
		const id = `${base.slice(0, 60)}-${n}`;
		if (!taken.has(id)) return id;
	}
	return '';
}

/**
 * 团队列表（新建项目选团队、组队面板）：成员按人才补齐名字、岗位与职责；引用了不存在的人才标 broken
 * ——这种团队建项目时会退回默认团队，界面不让选。
 */
export function listTeams(catalog) {
	return [...catalog.teams.values()]
		.map((entry) => {
			const members = entry.members.map((m) => {
				const t = catalog.talents.get(m.talent);
				return { id: m.id, talent: m.talent, name: m.name || t?.name || m.talent, role: m.role || t?.role || '', duty: m.duty ?? t?.duty ?? null, description: t?.description ?? '', category: t?.category ?? '', skills: [...new Set([...(t?.skills ?? []), ...(m.skills ?? [])])], avatar: t?.avatar ?? null, missing: t === undefined };
			});
			return { id: entry.id, source: entry.source, name: entry.name || entry.id, description: entry.description, lead: entry.lead, members, broken: members.some((m) => m.missing) };
		})
		.sort((a, b) => (a.id === DEFAULT_TEAM ? -1 : b.id === DEFAULT_TEAM ? 1 : 0) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name, 'zh'));
}

/**
 * 组队：写一个用户团队 `<userRoot>/teams/<id>/team.yml`。
 * `members` 是 [{ talent, name? }]（同一人才可招多位，成员 id 自动生成且不重复），`lead` 是成员下标或成员 id（缺省第一位）。
 * 引用的人才必须在目录里；校验复用 parseTeam，验不过就抛、不落盘。
 */
export function writeTeam(userRoot, id, input, catalog) {
	if (typeof userRoot !== 'string' || userRoot === '') throw new Error('writeTeam: 需要 userRoot');
	if (typeof id !== 'string' || !SLUG.test(id)) throw new Error('团队 id 必须是小写字母、数字、连字符，≤64 位');
	const name = text(input?.name, 60);
	if (name === '') throw new Error('团队需要一个名字');
	const raw = Array.isArray(input?.members) ? input.members : [];
	if (raw.length === 0) throw new Error('团队至少要有一位成员');
	const used = new Set();
	const members = raw.map((m, i) => {
		const talent = text(m?.talent, 64);
		if (!SLUG.test(talent) || (catalog && !catalog.talents.has(talent))) throw new Error(`第 ${i + 1} 位成员引用的人才不存在：${String(m?.talent)}`);
		const base = `mem_${talent.replace(/-/g, '_')}`.slice(0, 60);
		let memberId = base;
		for (let n = 2; used.has(memberId); n += 1) memberId = `${base.slice(0, 56)}_${n}`;
		used.add(memberId);
		const label = text(m?.name, 40);
		return { talent, id: memberId, ...(label ? { name: label } : {}) };
	});
	const leadIndex = Number.isInteger(input?.lead) ? input.lead : members.findIndex((m) => m.id === input?.lead);
	const doc = { name, ...(text(input?.description, 400) ? { description: text(input.description, 400) } : {}), lead: (members[leadIndex] ?? members[0]).id, members };
	const yaml = stringify(doc, { lineWidth: 0 });
	const team = parseTeam(yaml, `team ${id}`); // 先验后写
	const dir = join(userRoot, 'teams', id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'team.yml'), yaml, 'utf8');
	return { id, source: 'user', dir, ...team };
}

/** 删一个用户团队（只删用户根下的）。 */
export function deleteTeam(userRoot, id) {
	if (typeof id !== 'string' || !SLUG.test(id)) throw new Error('团队 id 不合法');
	rmSync(join(userRoot, 'teams', id), { recursive: true, force: true });
}

/**
 * 项目成员 → 人才草稿（「存为人才」）：带上它此刻的岗位、职责、性格（含复盘长出来的）、模型与技能名；
 * 不带笔记、会话与任务——那是这位成员自己的经历。duty 由调用方按身份判定后传入。
 */
export function talentFromMember(member, duty) {
	const config = member?.config ?? {};
	const provider = text(config.provider, 80);
	const model = text(config.model, 160);
	return {
		name: text(member?.name, 40),
		role: text(member?.role, 40),
		duty: DUTIES.includes(duty) ? duty : 'executor',
		category: '',
		tags: [],
		personality: text(member?.personality, 2000),
		model: provider || model ? { provider, model, reasoningEffort: text(config.reasoningEffort, 20) } : null,
		avatar: member?.avatar ?? null,
		skills: (Array.isArray(member?.skills) ? member.skills : []).map((s) => text(String(s), 64)).filter((s) => SKILL_NAME.test(s)),
	};
}

/** 列出可安装的技能：当前目录里每个人才自带的技能（名字 + 来源人才），给「从已有装」挑。 */
export function listInstallableSkills(catalog) {
	const out = [];
	for (const t of catalog.talents.values()) for (const name of t.skills) out.push({ name, talent: t.id, talentName: t.name, source: t.source });
	return out.sort((a, b) => a.name.localeCompare(b.name) || a.talent.localeCompare(b.talent));
}
