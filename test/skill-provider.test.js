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
	mkdirSync(join(home, 'skills', 'huashu-nuwa'), { recursive: true });
	mkdirSync(join(cwd, '.dsh', 'skills', 'beta'), { recursive: true });
	writeFileSync(join(home, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\nwhenToUse: use alpha\n---\n# alpha\n');
	writeFileSync(join(home, 'skills', 'huashu-nuwa', 'SKILL.md'), '---\nname: huashu-nuwa\ndescription: excluded\n---\n');
	writeFileSync(join(cwd, '.dsh', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Beta skill\n---\n# beta\n');
	const provider = createFileSkillProvider({ dshHome: home, projectCwd: cwd });
	const list = await provider.list({ cwd });
	assert.deepEqual(list.map((skill) => skill.name), ['alpha', 'beta']);
	const loaded = await provider.get(list[1]);
	assert.match(loaded.content, /# beta/);
	assert.equal(loaded.source, 'project-dsh');
});

test('file skill provider rejects names the host registry would refuse', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-skills-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	const cwd = join(root, 'project');
	// The host registry validates with `^[a-z0-9]+(?:-[a-z0-9]+)*$`; a trailing or
	// doubled hyphen passes a looser provider check but makes skills.snapshot throw.
	for (const [dir, name] of [['trailing-', 'trailing-'], ['double--dash', 'double--dash'], ['ok-one', 'ok-one']]) {
		mkdirSync(join(home, 'skills', dir), { recursive: true });
		writeFileSync(join(home, 'skills', dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n# ${name}\n`);
	}
	const provider = createFileSkillProvider({ dshHome: home, projectCwd: cwd });
	const list = await provider.list({ cwd });
	assert.deepEqual(list.map((skill) => skill.name), ['ok-one']);
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

test('file skill provider parses CRLF frontmatter (description on the last line)', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-crlf-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	const cwd = join(root, 'project');
	mkdirSync(join(home, 'skills', 'crlf-skill'), { recursive: true });
	// Windows 编辑器默认 CRLF：`\r` 是 JS 行终止符，`^...$` 无法越过它，
	// 于是末尾那一行（常见是 description）整行失配、技能被当成「缺少描述」丢弃。
	const crlf = ['---', 'name: crlf-skill', 'description: CRLF skill description.', '---', '# body', ''].join('\r\n');
	writeFileSync(join(home, 'skills', 'crlf-skill', 'SKILL.md'), crlf, 'utf8');
	const provider = createFileSkillProvider({ dshHome: home, projectCwd: cwd });
	const list = await provider.list({ cwd });
	assert.deepEqual(list.map((skill) => skill.name), ['crlf-skill']);
	assert.equal(list[0].description, 'CRLF skill description.');
});
