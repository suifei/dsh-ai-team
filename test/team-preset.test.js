import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { seedDefaultRoster } from '../lib/host/default-roster.js';
import { loadTeamPreset, parseTeamPreset, procedureText } from '../lib/domain/team-preset.js';
import { loadSkillContext } from '../lib/runtime/skill-loader.js';

// 团队 = 文件夹：teams/<团队>/team.yml（成员、职责、技能、规程选择）+ teams/<团队>/skills/（这个团队的提示词）。
// 之前名单是 JS 常量、三份岗位规程放在 skills/ 按岗位文字猜，两处是离散的。

const human = { kind: 'human', memberId: 'mem_human' };

async function writeTeam(root, id, yml, skills = {}) {
	await mkdir(join(root, id), { recursive: true });
	await writeFile(join(root, id, 'team.yml'), yml);
	for (const [name, body] of Object.entries(skills)) {
		await mkdir(join(root, id, 'skills', name), { recursive: true });
		await writeFile(join(root, id, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n${body}\n`);
	}
}

test('the bundled default team is the shipped roster with explicit duties and its own procedures', () => {
	const preset = loadTeamPreset();
	assert.deepEqual([preset.id, preset.source, preset.team.lead], ['default', 'bundled', 'mem_lead']);
	assert.deepEqual(preset.team.members.map((m) => [m.id, m.name, m.role, m.duty]), [
		['mem_lead', '墨渊', '主理人', 'lead'],
		['mem_maker', '青岚', '执行', 'executor'],
		['mem_check', '白砚', '验收', 'qa'],
		['mem_coder', '玄策', '编程', 'executor'],
		['mem_ux', '知微', 'UX 设计', 'executor'],
		['mem_biz', '观澜', '业务', 'executor'],
	]);
	assert.match(procedureText(preset, 'lead'), /审查与导航/);
	assert.match(procedureText(preset, 'qa'), /验收成员/);
	assert.match(procedureText(preset, 'executor'), /执行成员/);
});

test('team.yml is validated with a message that names the field', () => {
	const one = 'members:\n  - { id: mem_a, name: A, role: B }';
	assert.throws(() => parseTeamPreset('members: []', 'x.yml'), /members 至少要有一位成员/);
	assert.throws(() => parseTeamPreset('members:\n  - { id: lead, name: A, role: B }', 'x.yml'), /members\[0\]\.id 必须形如 mem_xxx/);
	assert.throws(() => parseTeamPreset(`${one}\n  - { id: mem_a, name: C, role: D }`), /id 重复/);
	assert.throws(() => parseTeamPreset(`lead: mem_x\n${one}`), /lead「mem_x」不在 members 里/);
	assert.throws(() => parseTeamPreset('members:\n  - { id: mem_a, name: A, role: B, duty: boss }'), /duty 只认 lead \/ qa \/ executor/);
	assert.throws(() => parseTeamPreset('members:\n  - { id: mem_a, name: A, role: B, skills: [../x] }'), /不是合法的技能名/);
	assert.throws(() => parseTeamPreset(`procedures: { boss: x }\n${one}`), /procedures\.boss 不是职责/);
	assert.throws(() => parseTeamPreset('members: [', 'x.yml'), /YAML 解析失败/);
	const team = parseTeamPreset(`procedures: { executor: my-exec }\n${one}`, 'small');
	assert.deepEqual([team.name, team.lead, team.members[0].duty, team.members[0].skills, team.procedures.executor, team.procedures.lead], ['small', 'mem_a', null, [], 'my-exec', 'ai-team-core']);
});

test('a user team folder overrides by name; a broken or missing one falls back to the bundled team with a .fail row', async () => {
	const userDir = await mkdtemp(join(tmpdir(), 'ai-team-teams-'));
	try {
		await writeTeam(userDir, 'duo', 'name: 双人组\nlead: mem_pm\nmembers:\n  - { id: mem_dev, name: 阿码, role: 编程 }\n  - { id: mem_pm, name: 阿策, role: 主理人 }\n');
		await writeTeam(userDir, 'broken', 'members: [');
		const rows = [];
		const diag = { append: (row) => rows.push(row) };
		const duo = loadTeamPreset({ name: 'duo', userDir, diag });
		assert.deepEqual([duo.id, duo.source, duo.dir, duo.team.name, duo.team.lead], ['duo', 'user', join(userDir, 'duo'), '双人组', 'mem_pm']);
		assert.equal(loadTeamPreset({ name: 'broken', userDir, diag }).id, 'default');
		assert.equal(loadTeamPreset({ name: 'nobody', userDir, diag }).id, 'default');
		assert.equal(loadTeamPreset({ name: '../etc', userDir, diag }).id, 'default');
		// 写坏：解析失败一行 + 内置也没有这个团队一行；找不到、名字非法各一行。
		assert.deepEqual(rows.map((row) => row.ev), ['team.preset.fail', 'team.preset.fail', 'team.preset.fail', 'team.preset.fail']);
		assert.match(rows[0].message, /YAML 解析失败/);
		await writeTeam(userDir, 'default', 'members:\n  - { id: mem_solo, name: 独行, role: 主理人 }\n');
		assert.deepEqual(loadTeamPreset({ userDir }).team.members.map((m) => m.name), ['独行']);
	} finally {
		await rm(userDir, { recursive: true, force: true });
	}
});

test("a member gets its team's procedure for its duty and finds its skills in the team folder first", async () => {
	const userDir = await mkdtemp(join(tmpdir(), 'ai-team-teams-'));
	try {
		await writeTeam(userDir, 'research', 'procedures: { executor: lab-exec }\nmembers:\n  - { id: mem_pi, name: 导师, role: 导师, duty: lead }\n  - { id: mem_ra, name: 助研, role: 研究助理, skills: [paper-review] }\n', {
			'lab-exec': '你是课题组的研究助理：先查文献再动手。',
			'paper-review': '审稿要点：方法、数据、可复现。',
		});
		const preset = loadTeamPreset({ name: 'research', userDir });
		const ra = await loadSkillContext({ id: 'mem_ra', role: '研究助理', skills: ['paper-review'] }, [], { vars: {}, ownerId: 'mem_pi', preset });
		assert.match(ra, /课题组的研究助理/);
		assert.match(ra, /### paper-review\n[\s\S]*审稿要点/);
		// 团队没带的规程退回内置；duty 写明的职责胜过岗位文字（「导师」本身推断不出主理人）。
		const pi = await loadSkillContext({ id: 'mem_pi', role: '导师', duty: 'lead' }, [], { vars: {}, ownerId: 'someone-else', preset });
		assert.match(pi, /审查与导航/);
		const checker = await loadSkillContext({ id: 'mem_x', role: '质检', duty: 'qa' }, [], { vars: {}, preset });
		assert.match(checker, /验收成员/);
	} finally {
		await rm(userDir, { recursive: true, force: true });
	}
});

async function withProject(run) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-seed-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_s', fsync: false });
	try {
		const service = new TeamService({ ledger });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_human', name: '你', kind: 'human' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { id: 'prj_s', name: 'S', ownerId: 'mem_human', workspacePath: root } });
		await run(service, root);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
}

test('a new Project is seeded from the chosen team: members remember team, duty and skills, and the lead owns it', async () => {
	await withProject(async (service, root) => {
		await writeTeam(join(root, 'teams'), 'duo', 'lead: mem_pm\nmembers:\n  - { id: mem_dev, name: 阿码, role: 编程, duty: executor, skills: [tdd], personality: 先写测试 }\n  - { id: mem_pm, name: 阿策, role: 统筹 }\n');
		const result = await seedDefaultRoster(service, 'prj_s', { preset: loadTeamPreset({ name: 'duo', userDir: join(root, 'teams') }) });
		assert.deepEqual(result, { seeded: true, members: ['mem_dev', 'mem_pm'], renamed: [] });
		const dev = service.state.members.mem_dev;
		assert.deepEqual([dev.team, dev.duty, dev.skills, dev.personality], ['duo', 'executor', ['tdd'], '先写测试']);
		assert.deepEqual([service.state.members.mem_pm.team, service.state.members.mem_pm.duty], ['duo', null]);
		assert.equal(service.state.projects.prj_s.ownerMemberId, 'mem_pm');
	});
});

test('an existing Project is left alone by a user team; only the bundled team back-fills missing roles', async () => {
	await withProject(async (service, root) => {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_lead', name: '墨渊', role: '主理人', kind: 'agent' } });
		assert.deepEqual([service.state.members.mem_lead.team, service.state.members.mem_lead.duty], [null, null]);
		await writeTeam(join(root, 'teams'), 'duo', 'members:\n  - { id: mem_dev, name: 阿码, role: 编程 }\n');
		const custom = await seedDefaultRoster(service, 'prj_s', { preset: loadTeamPreset({ name: 'duo', userDir: join(root, 'teams') }) });
		assert.deepEqual(custom, { seeded: false, members: [], renamed: [] });
		const bundled = await seedDefaultRoster(service, 'prj_s');
		assert.deepEqual(bundled.members, ['mem_maker', 'mem_check', 'mem_coder', 'mem_ux', 'mem_biz']);
		assert.equal(service.state.members.mem_check.duty, 'qa');
	});
});
