import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileSkillProvider, installFileSkillProvider } from '../lib/runtime/skill-provider.js';

test('file skill provider discovers user and project skills', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-skills-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	const cwd = join(root, 'project');
	mkdirSync(join(home, 'skills', 'alpha'), { recursive: true });
	mkdirSync(join(cwd, '.dsh', 'skills', 'beta'), { recursive: true });
	writeFileSync(join(home, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\nwhenToUse: use alpha\n---\n# alpha\n');
	writeFileSync(join(cwd, '.dsh', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Beta skill\n---\n# beta\n');
	const provider = createFileSkillProvider({ dshHome: home, projectCwd: cwd });
	const list = await provider.list({ cwd });
	assert.deepEqual(list.map((skill) => skill.name), ['alpha', 'beta']);
	const loaded = await provider.get(list[1]);
	assert.match(loaded.content, /# beta/);
	assert.equal(loaded.source, 'project-dsh');
});

test('file skill provider installs through the skills registry', () => {
	let registered = null;
	const dispose = installFileSkillProvider({ registerProvider(factory) {
		registered = factory({ signal: new AbortController().signal, invalidate() {} });
		return () => {};
	} }, {});
	assert.equal(registered.name, 'ai-team-files');
	assert.equal(typeof dispose, 'function');
});
