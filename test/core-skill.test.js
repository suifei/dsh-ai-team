import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSkillContext, renderSkillVars } from '../lib/runtime/skill-loader.js';
import { CORE_SKILL_TEXT } from '../lib/runtime/core-skill.js';

test('built-in core skill is packaged with the team discipline', () => {
	// 2026-11-13 用户改版：本 skill 从「团队工程纪律」改为「审查与导航 PMO」角色提示词。
	// 断言跟着契约走：保留角色、目标锚点、输出协议与只读边界，防止文件被清空或回退成别的形态。
	assert.match(CORE_SKILL_TEXT, /审查与导航/);
	assert.match(CORE_SKILL_TEXT, /目标锚点/);
	assert.match(CORE_SKILL_TEXT, /\{\{GOAL\}\}/);
	assert.match(CORE_SKILL_TEXT, /STATUS: CONTINUE \| DONE \| NEED_HUMAN/);
	assert.match(CORE_SKILL_TEXT, /只读，不写代码/);
	assert.match(CORE_SKILL_TEXT, /NEED_HUMAN/);
	// The packaged skill file is the single source; it must be in the npm files list.
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.files.includes('skills/**/*'));
});

test('member skill context always includes the core skill', async () => {
	const text = await loadSkillContext({ skills: [] }, undefined);
	assert.match(text, /审查与导航/);
});

test('the {{GOAL}} placeholder is rendered with the project goal, never shipped literally', async () => {
	// 实机：用户把核心 skill 改成 PMO 提示词后，{{GOAL}} 会原样进入成员上下文。
	const rendered = await loadSkillContext({ skills: [] }, undefined, { GOAL: '把邻里小活做成可验证的 4 周实验' });
	assert.match(rendered, /把邻里小活做成可验证的 4 周实验/);
	assert.doesNotMatch(rendered, /\{\{GOAL\}\}/);
	// 空目标也要替换（否则那一行等于噪音）：调用方负责给兜底文案，这里验证不残留占位符。
	const fallback = await loadSkillContext({ skills: [] }, undefined, { GOAL: '（本项目尚未填写目标）' });
	assert.doesNotMatch(fallback, /\{\{GOAL\}\}/);
	// 未知键保持原样：宁可露出占位符，也不要静默变成空行。
	assert.equal(renderSkillVars('锚点：{{OTHER}}', { GOAL: 'x' }), '锚点：{{OTHER}}');
	assert.equal(renderSkillVars('{{goal}}', { GOAL: '小写键也认' }), '小写键也认');
	assert.equal(renderSkillVars('   ', { GOAL: 'x' }), '   ');
});
