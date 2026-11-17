/**
 * 团队预设：新项目按哪份名单建成员（YAML 配置）。
 *
 * 内置 `teams/<名字>.yml` 随插件发布；用户把文件放进 `~/.dsh/ai-team/teams/<名字>.yml`
 * 即可新增团队，或用同名文件整份替换内置团队。插件设置 `teamPreset` 选用哪一份。
 * 用户文件写坏时不阻断建项目：记一行 `.fail` 诊断，退回内置同名（或内置默认）团队。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const BUNDLED_TEAMS_DIR = fileURLToPath(new URL('../../teams/', import.meta.url));
export const DEFAULT_TEAM = 'default';

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MEMBER_ID = /^mem_[a-z0-9_]{1,60}$/;
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * YAML 文本 → 规范化团队 `{ name, description, lead, members[] }`；不合法抛错（说明哪一处）。
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
		ids.add(id);
		members.push({ id, name, role, personality: text(raw.personality, 2000) });
	});
	const lead = doc.lead === undefined || doc.lead === null ? members[0].id : text(doc.lead, 64);
	if (!ids.has(lead)) throw new Error(`${label}: lead「${lead}」不在 members 里`);
	return {
		name: text(doc.name, 60) || label,
		description: text(doc.description, 400),
		lead,
		members,
	};
}

function readTeam(dir, name) {
	const file = join(dir, `${name}.yml`);
	if (!existsSync(file)) return null;
	return { file, team: parseTeamPreset(readFileSync(file, 'utf8'), file) };
}

/**
 * 取用一份团队：用户目录同名文件优先，其次内置；都没有或写坏则退回内置默认团队。
 * @param {{ name?: string, userDir?: string, bundledDir?: string, diag?: { append?: (row: object) => void } }} [options]
 * @returns {{ id: string, source: string, team: ReturnType<typeof parseTeamPreset> }}
 */
export function loadTeamPreset({ name = DEFAULT_TEAM, userDir, bundledDir = BUNDLED_TEAMS_DIR, diag } = {}) {
	const wanted = NAME.test(name) ? name : DEFAULT_TEAM;
	if (wanted !== name) diag?.append?.({ ev: 'team.preset.fail', name, reason: 'invalid preset name' });
	for (const [dir, origin] of [[userDir, 'user'], [bundledDir, 'bundled']]) {
		if (typeof dir !== 'string' || dir === '') continue;
		try {
			const hit = readTeam(dir, wanted);
			if (hit !== null) return { id: wanted, source: `${origin}:${hit.file}`, team: hit.team };
		} catch (error) {
			diag?.append?.({ ev: 'team.preset.fail', name: wanted, origin, message: error.message });
		}
	}
	if (wanted !== DEFAULT_TEAM) {
		diag?.append?.({ ev: 'team.preset.fail', name: wanted, reason: 'not found, using default' });
		return loadTeamPreset({ name: DEFAULT_TEAM, userDir, bundledDir, diag });
	}
	// 内置默认团队随包发布、有测试守着；读不到说明安装包坏了，直接抛。
	const hit = readTeam(bundledDir, DEFAULT_TEAM);
	if (hit === null) throw new Error(`bundled team preset missing: ${join(bundledDir, `${DEFAULT_TEAM}.yml`)}`);
	return { id: DEFAULT_TEAM, source: `bundled:${hit.file}`, team: hit.team };
}
