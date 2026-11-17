/**
 * 团队预设：一个团队 = 一个文件夹，成员名单与这个团队的提示词放在一起。
 *
 *   teams/<团队>/team.yml                 成员名单、职责（duty）、技能、岗位规程选择
 *   teams/<团队>/skills/<技能>/SKILL.md   岗位规程（主理人 / 验收 / 执行）与成员技能
 *
 * 内置团队随插件发布在 `teams/`；用户把文件夹放进 `~/.dsh/ai-team/teams/<团队>/` 即可新增团队，
 * 或用同名文件夹整份替换内置团队。插件设置 `teamPreset` 选新项目用哪一个；成员记住自己来自哪个团队。
 * 用户文件写坏时不阻断：记一行 `.fail` 诊断，退回内置同名（或内置默认）团队。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const BUNDLED_TEAMS_DIR = fileURLToPath(new URL('../../teams/', import.meta.url));
export const DEFAULT_TEAM = 'default';
/** 三种职责，各对应一份岗位规程。 */
export const DUTIES = Object.freeze(['lead', 'qa', 'executor']);
export const DEFAULT_PROCEDURES = Object.freeze({ lead: 'ai-team-core', qa: 'ai-team-qa', executor: 'ai-team-executor' });

const TEAM_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MEMBER_ID = /^mem_[a-z0-9_]{1,60}$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function skillName(value, at) {
	const name = text(value, 64);
	if (!SKILL_NAME.test(name) || name.includes('..')) throw new Error(`${at} 不是合法的技能名：${String(value)}`);
	return name;
}

/**
 * team.yml 文本 → 规范化团队 `{ name, description, lead, procedures, members[] }`；不合法抛错（说明哪一处）。
 * @param {string} source
 * @param {string} [label] 报错时指明是哪个文件
 */
export function parseTeamPreset(source, label = 'team') {
	let doc;
	try {
		doc = parse(source);
	} catch (error) {
		throw new Error(`${label}: YAML 解析失败：${error.message}`);
	}
	if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${label}: 顶层必须是对象`);
	if (!Array.isArray(doc.members) || doc.members.length === 0) throw new Error(`${label}: members 至少要有一位成员`);
	const procedures = { ...DEFAULT_PROCEDURES };
	if (doc.procedures !== undefined && doc.procedures !== null) {
		if (typeof doc.procedures !== 'object' || Array.isArray(doc.procedures)) throw new Error(`${label}: procedures 必须是对象`);
		for (const [duty, name] of Object.entries(doc.procedures)) {
			if (!DUTIES.includes(duty)) throw new Error(`${label}: procedures.${duty} 不是职责（只认 ${DUTIES.join(' / ')}）`);
			procedures[duty] = skillName(name, `${label}: procedures.${duty}`);
		}
	}
	const members = [];
	const ids = new Set();
	doc.members.forEach((raw, index) => {
		const at = `${label}: members[${index}]`;
		if (raw === null || typeof raw !== 'object') throw new Error(`${at} 必须是对象`);
		const id = text(raw.id, 64);
		if (!MEMBER_ID.test(id)) throw new Error(`${at}.id 必须形如 mem_xxx（小写字母、数字、下划线）`);
		if (ids.has(id)) throw new Error(`${at}.id 重复：${id}`);
		const name = text(raw.name, 40);
		const role = text(raw.role, 40);
		if (name === '') throw new Error(`${at}.name 不能为空`);
		if (role === '') throw new Error(`${at}.role 不能为空`);
		let duty = null;
		if (raw.duty !== undefined && raw.duty !== null) {
			if (!DUTIES.includes(raw.duty)) throw new Error(`${at}.duty 只认 ${DUTIES.join(' / ')}`);
			duty = raw.duty;
		}
		if (raw.skills !== undefined && raw.skills !== null && !Array.isArray(raw.skills)) throw new Error(`${at}.skills 必须是列表`);
		const skills = [...new Set((raw.skills ?? []).map((skill, i) => skillName(skill, `${at}.skills[${i}]`)))];
		ids.add(id);
		members.push({ id, name, role, duty, skills, personality: text(raw.personality, 2000) });
	});
	const lead = doc.lead === undefined || doc.lead === null ? members[0].id : text(doc.lead, 64);
	if (!ids.has(lead)) throw new Error(`${label}: lead「${lead}」不在 members 里`);
	return { name: text(doc.name, 60) || label, description: text(doc.description, 400), lead, procedures, members };
}

function readTeam(root, id) {
	const dir = join(root, id);
	const file = join(dir, 'team.yml');
	if (!existsSync(file)) return null;
	return { dir, team: parseTeamPreset(readFileSync(file, 'utf8'), file) };
}

/**
 * 取用一个团队：用户目录同名文件夹优先，其次内置；都没有或写坏则退回内置默认团队。
 * @param {{ name?: string|null, userDir?: string, bundledDir?: string, diag?: { append?: (row: object) => void } }} [options]
 * @returns {{ id: string, source: 'user'|'bundled', dir: string, team: ReturnType<typeof parseTeamPreset> }}
 */
export function loadTeamPreset({ name = DEFAULT_TEAM, userDir, bundledDir = BUNDLED_TEAMS_DIR, diag } = {}) {
	const asked = name ?? DEFAULT_TEAM;
	const wanted = TEAM_NAME.test(asked) ? asked : DEFAULT_TEAM;
	if (wanted !== asked) diag?.append?.({ ev: 'team.preset.fail', name: asked, reason: 'invalid team name' });
	for (const [root, source] of [[userDir, 'user'], [bundledDir, 'bundled']]) {
		if (typeof root !== 'string' || root === '') continue;
		try {
			const hit = readTeam(root, wanted);
			if (hit !== null) return { id: wanted, source, ...hit };
		} catch (error) {
			diag?.append?.({ ev: 'team.preset.fail', name: wanted, origin: source, message: error.message });
		}
	}
	if (wanted !== DEFAULT_TEAM) {
		diag?.append?.({ ev: 'team.preset.fail', name: wanted, reason: 'not found, using default' });
		return loadTeamPreset({ name: DEFAULT_TEAM, userDir, bundledDir, diag });
	}
	// 内置默认团队随包发布、有测试守着；读不到说明安装包坏了，直接抛。
	const hit = readTeam(bundledDir, DEFAULT_TEAM);
	if (hit === null) throw new Error(`bundled team missing: ${join(bundledDir, DEFAULT_TEAM, 'team.yml')}`);
	return { id: DEFAULT_TEAM, source: 'bundled', ...hit };
}

/**
 * 某职责的岗位规程正文（含 front-matter，调用方负责剥掉）：先找团队自己的 skills/，
 * 团队没带就退回内置默认团队的同职责规程。
 * @param {{ dir: string, team: { procedures: Record<string, string> } }|null|undefined} preset
 * @param {'lead'|'qa'|'executor'} duty
 */
export function procedureText(preset, duty, { bundledDir = BUNDLED_TEAMS_DIR } = {}) {
	const kind = DUTIES.includes(duty) ? duty : 'executor';
	const candidates = [];
	if (preset?.dir) candidates.push(join(preset.dir, 'skills', preset.team?.procedures?.[kind] ?? DEFAULT_PROCEDURES[kind], 'SKILL.md'));
	candidates.push(join(bundledDir, DEFAULT_TEAM, 'skills', DEFAULT_PROCEDURES[kind], 'SKILL.md'));
	for (const file of candidates) if (existsSync(file)) return readFileSync(file, 'utf8');
	throw new Error(`bundled procedure missing: ${candidates.at(-1)}`);
}
