import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSkillContext, renderSkillVars } from '../lib/runtime/skill-loader.js';
import { CORE_SKILL_TEXT, EXECUTOR_SKILL_TEXT, QA_SKILL_TEXT, skillKindForMember } from '../lib/runtime/core-skill.js';

test('the three built-in skills keep their own contract', () => {
	// 主理人/PMO：只读审查与导航
	assert.match(CORE_SKILL_TEXT, /审查与导航/);
	assert.match(CORE_SKILL_TEXT, /\{\{GOAL\}\}/);
	assert.match(CORE_SKILL_TEXT, /STATUS: CONTINUE \| DONE \| NEED_HUMAN/);
	// 执行：按 resultDefinition 交付、要证据、不越界
	assert.match(EXECUTOR_SKILL_TEXT, /执行成员/);
	assert.match(EXECUTOR_SKILL_TEXT, /resultDefinition/);
	assert.match(EXECUTOR_SKILL_TEXT, /不越界|只做被要求的事/);
	assert.doesNotMatch(EXECUTOR_SKILL_TEXT, /只读，不写代码/, '执行成员绝不能被要求「不写代码」');
	// 验收：独立复跑、不采信自述
	assert.match(QA_SKILL_TEXT, /验收成员/);
	assert.match(QA_SKILL_TEXT, /独立复跑|自己执行验证/);
	assert.match(QA_SKILL_TEXT, /退回/);
	// 三份都随包分发
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.files.includes('skills/**/*'));
});

test('each member gets the skill that matches its identity', () => {
	// 账本里的项目主理人 → 审查规程
	assert.equal(skillKindForMember({ id: 'a1', role: '业务' }, { ownerId: 'a1' }), 'lead');
	// 角色名里的主理人/PMO 也算
	assert.equal(skillKindForMember({ id: 'a2', role: '主理人' }), 'lead');
	assert.equal(skillKindForMember({ id: 'a3', role: 'PMO' }), 'lead');
	// 验收角色（沿用 isQaMember 的口径）
	assert.equal(skillKindForMember({ id: 'a4', role: 'QA' }), 'qa');
	assert.equal(skillKindForMember({ id: 'a5', role: '验收' }), 'qa');
	// 其余都是执行
	assert.equal(skillKindForMember({ id: 'a6', role: '执行' }), 'executor');
	assert.equal(skillKindForMember({ id: 'a7' }), 'executor');
	assert.equal(skillKindForMember(null), 'executor');
});

test('member skill context assembles by identity and renders variables', async () => {
	const lead = await loadSkillContext({ id: 'a1', role: '业务' }, undefined, {
		vars: { GOAL: '把邻里小活做成 4 周实验' },
		ownerId: 'a1',
	});
	assert.match(lead, /审查与导航/);
	assert.match(lead, /把邻里小活做成 4 周实验/);
	assert.doesNotMatch(lead, /\{\{GOAL\}\}/, '占位符必须被渲染');

	// 执行成员拿执行规程，且不含「不写代码」这种会误伤的限制
	const executor = await loadSkillContext({ id: 'a2', role: '执行' }, undefined, { ownerId: 'a1' });
	assert.match(executor, /执行成员/);
	assert.doesNotMatch(executor, /审查与导航/);
	assert.doesNotMatch(executor, /只读，不写代码/);

	// 验收成员拿复跑规程
	const qa = await loadSkillContext({ id: 'a3', role: 'QA' }, undefined, { ownerId: 'a1' });
	assert.match(qa, /验收成员/);
	assert.doesNotMatch(qa, /审查与导航/);
});

test('legacy third-argument form (a bare variable table) still works', async () => {
	// 0.4.85 的调用方式：第三个参数直接是变量表。
	const text = await loadSkillContext({ id: 'a1', role: '主理人' }, undefined, { GOAL: '旧调用方式' });
	assert.match(text, /旧调用方式/);
});

test('the {{GOAL}} placeholder is rendered with the project goal, never shipped literally', async () => {
	const rendered = await loadSkillContext({ id: 'a1', role: '主理人' }, undefined, { GOAL: '把邻里小活做成可验证的 4 周实验' });
	assert.match(rendered, /把邻里小活做成可验证的 4 周实验/);
	assert.doesNotMatch(rendered, /\{\{GOAL\}\}/);
	const fallback = await loadSkillContext({ id: 'a1', role: '主理人' }, undefined, { GOAL: '（本项目尚未填写目标）' });
	assert.doesNotMatch(fallback, /\{\{GOAL\}\}/);
	// 未知键保持原样：宁可露出占位符，也不要静默变成空行。
	assert.equal(renderSkillVars('锚点：{{OTHER}}', { GOAL: 'x' }), '锚点：{{OTHER}}');
	assert.equal(renderSkillVars('{{goal}}', { GOAL: '小写键也认' }), '小写键也认');
	assert.equal(renderSkillVars('   ', { GOAL: 'x' }), '   ');
});
