import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSkillContext } from '../lib/runtime/skill-loader.js';
import { CORE_SKILL_TEXT } from '../lib/runtime/core-skill.js';

test('built-in core skill is packaged with the team discipline', () => {
	assert.match(CORE_SKILL_TEXT, /同一能力在仓库内只允许一份实现/);
	assert.match(CORE_SKILL_TEXT, /懒惰的高级程序员思维/);
	assert.match(CORE_SKILL_TEXT, /http 代理/);
	assert.match(CORE_SKILL_TEXT, /日志埋点/);
	assert.match(CORE_SKILL_TEXT, /PMO 自主性/);
	assert.match(CORE_SKILL_TEXT, /禁止 Human 或外部 Agent/);
	// The packaged skill file is the single source; it must be in the npm files list.
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.files.includes('skills/**/*'));
});

test('member skill context always includes the core skill', async () => {
	const text = await loadSkillContext({ skills: [] }, undefined);
	assert.match(text, /同一能力在仓库内只允许一份实现/);
});
