import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { seedDefaultRoster } from '../lib/host/default-roster.js';
import { loadTeamPreset, parseTeamPreset } from '../lib/domain/team-preset.js';

// The preset team used to be a JS constant (DEFAULT_MEMBER_ROSTER); it is now teams/default.yml,
// and a user team under ~/.dsh/ai-team/teams/ can replace it for new Projects.

const human = { kind: 'human', memberId: 'mem_human' };

test('the bundled default team is the shipped roster: six members led by 墨渊', () => {
	const { id, source, team } = loadTeamPreset();
	assert.equal(id, 'default');
	assert.match(source, /^bundled:/);
	assert.equal(team.lead, 'mem_lead');
	assert.deepEqual(team.members.map((m) => [m.id, m.name, m.role]), [
		['mem_lead', '墨渊', '主理人'],
		['mem_maker', '青岚', '执行'],
		['mem_check', '白砚', '验收'],
		['mem_coder', '玄策', '编程'],
		['mem_ux', '知微', 'UX 设计'],
		['mem_biz', '观澜', '业务'],
	]);
	assert.ok(team.members.every((m) => m.personality.length > 10));
});

test('a team file is validated with a message that names the field', () => {
	assert.throws(() => parseTeamPreset('members: []', 'x.yml'), /members 至少要有一位成员/);
	assert.throws(() => parseTeamPreset('members:\n  - { id: lead, name: A, role: B }', 'x.yml'), /members\[0\]\.id 必须形如 mem_xxx/);
	assert.throws(() => parseTeamPreset('members:\n  - { id: mem_a, name: A, role: B }\n  - { id: mem_a, name: C, role: D }'), /id 重复/);
	assert.throws(() => parseTeamPreset('lead: mem_x\nmembers:\n  - { id: mem_a, name: A, role: B }'), /lead「mem_x」不在 members 里/);
	assert.throws(() => parseTeamPreset('members: [', 'x.yml'), /YAML 解析失败/);
	const team = parseTeamPreset('members:\n  - { id: mem_a, name: 甲, role: 主理人 }\n  - { id: mem_b, name: 乙, role: 编程 }', 'small');
	assert.deepEqual([team.name, team.lead, team.members.length, team.members[1].personality], ['small', 'mem_a', 2, '']);
});

test('a user team overrides by name; a broken or missing one falls back to the bundled team with a .fail row', async () => {
	const userDir = await mkdtemp(join(tmpdir(), 'ai-team-teams-'));
	try {
		await writeFile(join(userDir, 'duo.yml'), 'name: 双人组\nlead: mem_pm\nmembers:\n  - { id: mem_dev, name: 阿码, role: 编程 }\n  - { id: mem_pm, name: 阿策, role: 主理人 }\n');
		await writeFile(join(userDir, 'broken.yml'), 'members: [');
		const rows = [];
		const diag = { append: (row) => rows.push(row) };
		const duo = loadTeamPreset({ name: 'duo', userDir, diag });
		assert.deepEqual([duo.id, duo.source.startsWith('user:'), duo.team.name, duo.team.lead], ['duo', true, '双人组', 'mem_pm']);
		assert.equal(loadTeamPreset({ name: 'broken', userDir, diag }).id, 'default');
		assert.equal(loadTeamPreset({ name: 'nobody', userDir, diag }).id, 'default');
		assert.equal(loadTeamPreset({ name: '../etc', userDir, diag }).id, 'default');
		// 写坏：解析失败一行 + 内置也没有这份一行；找不到、名字非法各一行。
		assert.deepEqual(rows.map((row) => row.ev), ['team.preset.fail', 'team.preset.fail', 'team.preset.fail', 'team.preset.fail']);
		assert.match(rows[0].message, /YAML 解析失败/);
		// 与内置同名的用户文件整份替换内置团队。
		await writeFile(join(userDir, 'default.yml'), 'members:\n  - { id: mem_solo, name: 独行, role: 主理人 }\n');
		assert.deepEqual(loadTeamPreset({ userDir }).team.members.map((m) => m.name), ['独行']);
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

test('a new Project is seeded from the chosen team and its lead becomes the owner', async () => {
	await withProject(async (service, root) => {
		await mkdir(join(root, 'teams'));
		await writeFile(join(root, 'teams', 'duo.yml'), 'lead: mem_pm\nmembers:\n  - { id: mem_dev, name: 阿码, role: 编程, personality: 先写测试 }\n  - { id: mem_pm, name: 阿策, role: 主理人 }\n');
		const result = await seedDefaultRoster(service, 'prj_s', { preset: loadTeamPreset({ name: 'duo', userDir: join(root, 'teams') }) });
		assert.deepEqual(result, { seeded: true, members: ['mem_dev', 'mem_pm'], renamed: [] });
		assert.equal(service.state.members.mem_dev.personality, '先写测试');
		assert.equal(service.state.projects.prj_s.ownerMemberId, 'mem_pm');
	});
});

test('an existing Project is left alone by a user team; only the bundled team back-fills missing roles', async () => {
	await withProject(async (service, root) => {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_lead', name: '墨渊', role: '主理人', kind: 'agent' } });
		await mkdir(join(root, 'teams'));
		await writeFile(join(root, 'teams', 'duo.yml'), 'members:\n  - { id: mem_dev, name: 阿码, role: 编程 }\n');
		const custom = await seedDefaultRoster(service, 'prj_s', { preset: loadTeamPreset({ name: 'duo', userDir: join(root, 'teams') }) });
		assert.deepEqual(custom, { seeded: false, members: [], renamed: [] });
		const bundled = await seedDefaultRoster(service, 'prj_s');
		assert.deepEqual(bundled.members, ['mem_maker', 'mem_check', 'mem_coder', 'mem_ux', 'mem_biz']);
	});
});
