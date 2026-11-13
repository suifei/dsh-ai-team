import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileSkillProvider, installFileSkillProvider, pickProjectForCwd } from '../lib/runtime/skill-provider.js';

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

test('the skill tool path renders {{GOAL}} too, resolving the project from cwd', async (t) => {
	// list() 知道自己属于哪个 cwd，get() 只知道候选——cwd 随候选带下去，再反查项目目标，
	// 这样成员主动用 skill 工具加载时也不会看到字面量占位符。
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-skill-provider-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const bundle = join(dir, 'skills', 'demo');
	mkdirSync(bundle, { recursive: true });
	writeFileSync(join(bundle, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n锚点：{{GOAL}}\n', 'utf8');

	const provider = createFileSkillProvider({
		bundledDir: dir,
		resolveVars: ({ cwd }) => ({ GOAL: cwd === 'E:/works/local' ? '把邻里小活做成 4 周实验' : '（未关联）' }),
	});
	const candidates = await provider.list({ cwd: 'E:/works/local' });
	const demo = candidates.find((entry) => entry.name === 'demo');
	assert.ok(demo, 'bundled skill 应被发现');
	const loaded = await provider.get(demo);
	assert.match(loaded.content, /把邻里小活做成 4 周实验/);
	assert.doesNotMatch(loaded.content, /\{\{GOAL\}\}/);

	// 没有 cwd 时回落到 projectCwd；两者都没有就交给 resolveVars 自己判断。
	const plain = createFileSkillProvider({ bundledDir: dir });
	const plainCandidates = await plain.list();
	const plainDemo = plainCandidates.find((entry) => entry.name === 'demo');
	assert.match((await plain.get(plainDemo)).content, /\{\{GOAL\}\}/, '没有变量时保留占位符');
});

test('cwd resolves to the owning project, preferring the longest prefix', () => {
	const projects = [
		{ id: 'p1', name: '一', goal: '目标一', workspacePath: 'E:/works/app' },
		{ id: 'p2', name: '二', goal: '目标二', workspacePath: 'E:/works/app/inner' },
	];
	assert.equal(pickProjectForCwd(projects, 'E:\\works\\app').goal, '目标一');
	assert.equal(pickProjectForCwd(projects, 'E:/works/app/inner/src').goal, '目标二', '子目录命中更具体的项目');
	// 大小写与分隔符差异不算不同路径
	assert.equal(pickProjectForCwd(projects, 'e:/WORKS/APP').id, 'p1');
	// 只有一个项目时，即便 cwd 对不上也用它（单项目部署最常见）
	assert.equal(pickProjectForCwd([projects[0]], 'D:/elsewhere').id, 'p1');
	assert.equal(pickProjectForCwd([], 'E:/works/app'), undefined);
	assert.equal(pickProjectForCwd(projects, 'D:/elsewhere'), undefined);
});
