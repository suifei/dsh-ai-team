import { isQaMember, isReviewerMember } from '../domain/member-profile.js';
import { DUTIES, procedureText } from '../domain/catalog.js';

/**
 * 岗位规程按**职责**装配：主理人/PMO 拿审查与导航规程，验收拿复跑规程，其余拿执行规程。
 * 规程正文属于团队（`teams/<团队>/skills/`，见 lib/domain/catalog.js），这里只决定职责。
 *
 * 实机（2026-11-13）：`ai-team-core` 被改写成第二人称的「你是本会话的审查与导航 PMO，
 * 只读，不写代码」，但它对**所有成员**注入——执行成员会收到「你不写代码」的指令。
 * 因此这里按成员身份分派，没有身份的（普通执行）拿执行规程。
 */

const LEAD_PATTERN = /主理人|项目负责人|PMO|lead|owner/i;

/** 内置默认团队的三份规程（含 front-matter）。 */
export const CORE_SKILL_TEXT = procedureText(null, 'lead');
export const EXECUTOR_SKILL_TEXT = procedureText(null, 'executor');
export const QA_SKILL_TEXT = procedureText(null, 'qa');

export const SKILL_KINDS = DUTIES;

/**
 * 判定一个成员该装配哪份岗位规程。
 *
 * 优先级：项目主理人（账本 ownerMemberId）→ 团队配置里写明的 duty → 角色名里的主理人/PMO
 * → 验收角色 → 执行。只认身份，不看任务。
 *
 * @param {{id?: string, role?: string, duty?: string|null}|null|undefined} member
 * @param {{ownerId?: string}|null|undefined} context 项目主理人 id
 * @returns {'lead'|'qa'|'executor'}
 */
export function skillKindForMember(member, context = {}) {
	const ownerId = typeof context?.ownerId === 'string' ? context.ownerId : '';
	if (ownerId !== '' && member?.id === ownerId) return 'lead';
	if (DUTIES.includes(member?.duty)) return member.duty;
	const role = typeof member?.role === 'string' ? member.role : '';
	if (LEAD_PATTERN.test(role)) return 'lead';
	if (isQaMember(member) || isReviewerMember(member)) return 'qa';
	return 'executor';
}

/** 按职责取规程正文（含 front-matter，调用方负责剥掉）；给了团队就用团队的规程。 */
export function coreSkillTextFor(kind, preset = null) {
	return procedureText(preset, kind);
}
