import { readFileSync } from 'node:fs';
import { isQaMember, isReviewerMember } from '../domain/member-profile.js';

/**
 * 内置技能按**身份**装配：主理人/PMO 拿审查与导航规程，验收拿复跑规程，其余拿执行规程。
 *
 * 实机（2026-11-13）：`ai-team-core` 被改写成第二人称的「你是本会话的审查与导航 PMO，
 * 只读，不写代码」，但它对**所有成员**注入——执行成员会收到「你不写代码」的指令。
 * 因此这里按成员身份分派，没有身份的（普通执行）拿执行规程。
 */

const LEAD_PATTERN = /主理人|项目负责人|PMO|lead|owner/i;

function load(file) {
	return readFileSync(new URL(`../../skills/${file}/SKILL.md`, import.meta.url), 'utf8');
}

/** 主理人/PMO：只读审查与导航。 */
export const CORE_SKILL_TEXT = load('ai-team-core');
/** 执行成员：按 resultDefinition 交付。 */
export const EXECUTOR_SKILL_TEXT = load('ai-team-executor');
/** 验收成员：独立复跑判定。 */
export const QA_SKILL_TEXT = load('ai-team-qa');

export const SKILL_KINDS = Object.freeze(['lead', 'qa', 'executor']);

/**
 * 判定一个成员该装配哪份内置技能。
 *
 * 优先级：项目主理人（账本 ownerMemberId）→ 角色名里的主理人/PMO → 验收角色 → 执行。
 * 只认身份，不看任务：同一个人换角色要立刻换规程。
 *
 * @param {{id?: string, role?: string}|null|undefined} member
 * @param {{ownerId?: string}|null|undefined} context 项目主理人 id
 * @returns {'lead'|'qa'|'executor'}
 */
export function skillKindForMember(member, context = {}) {
	const ownerId = typeof context?.ownerId === 'string' ? context.ownerId : '';
	if (ownerId !== '' && member?.id === ownerId) return 'lead';
	const role = typeof member?.role === 'string' ? member.role : '';
	if (LEAD_PATTERN.test(role)) return 'lead';
	if (isQaMember(member) || isReviewerMember(member)) return 'qa';
	return 'executor';
}

/** 按种类取技能正文（含 front-matter，调用方负责剥掉）。 */
export function coreSkillTextFor(kind) {
	if (kind === 'lead') return CORE_SKILL_TEXT;
	if (kind === 'qa') return QA_SKILL_TEXT;
	return EXECUTOR_SKILL_TEXT;
}
