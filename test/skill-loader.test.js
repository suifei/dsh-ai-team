import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkillContext } from '../lib/runtime/skill-loader.js';

test('loadSkillContext reads bounded profile skills and rejects traversal names', async (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-skill-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, 'skills', 'nuwa-skill'), { recursive: true });
	writeFileSync(join(dir, 'skills', 'nuwa-skill', 'SKILL.md'), 'Use the nuwa workflow.\n' + 'x'.repeat(3000));
	writeFileSync(join(dir, 'skills', 'notes.md'), 'A short skill.');
	const context = await loadSkillContext({ skills: ['nuwa-skill', 'notes', '..', '../escape'] }, dir);
	assert.match(context, /nuwa workflow/);
	assert.match(context, /A short skill/);
	assert.doesNotMatch(context, /escape/);
	assert.ok(context.length < 6000);
	// 没有身份的成员按「执行」装配（身份规则见 core-skill.js）。
	assert.match(await loadSkillContext({ skills: [] }, dir), /AI Team 的执行成员/);
	assert.match(await loadSkillContext({ skills: ['missing'] }, dir), /AI Team 的执行成员/);
});
