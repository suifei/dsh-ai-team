import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { seedDefaultRoster } from '../lib/host/default-roster.js';
import { catalogRoots, forkTalent, listTalents, loadCatalog, parseTalent, parseTeam, procedureText, resolveTeam } from '../lib/domain/catalog.js';
import { findSkill, findSkillText, loadSkillContext } from '../lib/runtime/skill-loader.js';

// 人才市场（2026-11-18）：人才 talents/<人才>/ → 团队 teams/<团队>/（只引用人才）→ 项目成员（账本实例）。
// 之前默认名单是 JS 常量、三份岗位规程放在 skills/ 按岗位文字猜，名单与提示词离散，也不能自由组队。

const human = { kind: 'human', memberId: 'mem_human' };

async function put(root, rel, body) {
	const path = join(root, rel);
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, body);
}
const skillMd = (name, body) => `---\nname: ${name}\ndescription: test\n---\n${body}\n`;
async function withUser(run) {
	const home = await mkdtemp(join(tmpdir(), 'ai-team-catalog-'));
	try {
		const user = join(home, 'ai-team', 'catalog', 'user');
		await run({ home, user, catalog: (diag) => loadCatalog({ roots: catalogRoots({ dshHome: home }), diag }) });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

test('the bundled default team picks six talents from the market and keeps the shipped ids, names and duties', () => {
	const preset = resolveTeam(loadCatalog());
	assert.deepEqual([preset.id, preset.source, preset.team.lead], ['default', 'bundled', 'mem_lead']);
	assert.deepEqual(preset.team.members.map((m) => [m.id, m.name, m.role, m.duty, m.talent.id]), [
		['mem_lead', '墨渊', '主理人', 'lead', 'pmo-lead'],
		['mem_maker', '青岚', '执行', 'executor', 'executor'],
		['mem_check', '白砚', '验收', 'qa', 'qa-acceptor'],
		['mem_coder', '玄策', '编程', 'executor', 'engineer'],
		['mem_ux', '知微', 'UX 设计', 'executor', 'ux-designer'],
		['mem_biz', '观澜', '业务', 'executor', 'biz-analyst'],
	]);
	assert.ok(preset.team.members.every((m) => m.personality.length > 10 && /^\d+\.\d+\.\d+$/.test(m.talent.version)));
	assert.match(procedureText(preset, 'lead'), /交付调度/);
	assert.match(procedureText(preset, 'qa'), /验收成员/);
	assert.match(procedureText(preset, 'executor'), /执行成员/);
	// 人才市场里还有不在默认团队的角色可招。
	const market = listTalents(loadCatalog());
	assert.ok(market.length >= 10);
	assert.ok(market.some((t) => t.id === 'code-reviewer' && t.duty === 'qa'));
	assert.ok(market.every((t) => t.source === 'bundled' && t.name && t.role && t.category && t.description));
});

test('the bundled reverse-engineering team seeds seven RE talents, each with its own skill and the right duty', () => {
	const c = loadCatalog();
	const rev = resolveTeam(c, 'reverse');
	assert.deepEqual([rev.id, rev.source, rev.team.lead], ['reverse', 'bundled', 'mem_re_lead']);
	assert.deepEqual(rev.team.members.map((m) => [m.talent.id, m.duty, m.skills]), [
		['re-lead', 'lead', []],
		['binary-analyst', 'executor', ['static-analysis']],
		['dynamic-debugger', 'executor', ['dynamic-debugging']],
		['deobfuscator', 'executor', ['deobfuscation']],
		['mobile-re', 'executor', ['mobile-re']],
		['algo-reimplementer', 'executor', ['reimplementation']],
		['re-verifier', 'qa', ['behavior-diff']],
	]);
	// 没带自己的岗位规程 → 退回内置默认团队的三份。
	assert.match(procedureText(rev, 'lead'), /交付调度/);
	assert.match(procedureText(rev, 'executor'), /执行成员/);
	// RE 人才都在人才市场里，分类为「逆向」。
	const re = listTalents(c).filter((t) => t.category === '逆向');
	assert.equal(re.length, 7);
	assert.ok(re.every((t) => t.description && t.personality));
});

test('talent.yml and team.yml are validated with messages that name the field', () => {
	assert.throws(() => parseTalent('role: x', 'a.yml'), /name 不能为空/);
	assert.throws(() => parseTalent('name: A\nrole: B\nduty: boss'), /duty 只认 lead \/ qa \/ executor/);
	assert.throws(() => parseTalent('name: A\nrole: B\nversion: v2'), /version 必须形如 1\.2\.3/);
	assert.throws(() => parseTalent('name: A\nrole: B\nskills: [../x]'), /不是合法的技能名/);
	assert.throws(() => parseTalent('name: [', 'a.yml'), /YAML 解析失败/);
	assert.throws(() => parseTeam('members: []'), /members 至少要有一位成员/);
	assert.throws(() => parseTeam('members:\n  - { talent: Bad_Id }'), /talent 必须是人才 id/);
	assert.throws(() => parseTeam('members:\n  - { talent: dev }\n  - { talent: dev }'), /id 重复：mem_dev（同一人才招两位时给每位写 id）/);
	assert.throws(() => parseTeam('lead: mem_x\nmembers:\n  - { talent: dev }'), /lead「mem_x」不在 members 的 id 里/);
	assert.throws(() => parseTeam('procedures: { boss: x }\nmembers:\n  - { talent: dev }'), /procedures\.boss 不是职责/);
	const team = parseTeam('members:\n  - { talent: dev-ops }\n  - { talent: dev-ops, id: mem_ops2, name: 二号 }');
	assert.deepEqual([team.lead, team.members.map((m) => m.id), team.procedures.lead], ['mem_dev_ops', ['mem_dev_ops', 'mem_ops2'], 'ai-team-core']);
});

test('user talents and teams override bundled ones by id; broken files are skipped with a .fail row', async () => {
	await withUser(async ({ user, catalog }) => {
		await put(user, 'talents/engineer/talent.yml', 'name: 阿码\nrole: 全栈\nversion: 2.0.0\n');
		await put(user, 'talents/broken/talent.yml', 'name: [');
		await put(user, 'teams/duo/team.yml', 'members:\n  - { talent: engineer }\n  - { talent: nobody }\n');
		const rows = [];
		const diag = { append: (row) => rows.push(row) };
		const c = catalog(diag);
		assert.deepEqual([c.talents.get('engineer').name, c.talents.get('engineer').source, c.talents.get('executor').source], ['阿码', 'user', 'bundled']);
		assert.equal(c.talents.has('broken'), false);
		// 团队引用了不存在的人才 → 退回默认团队。
		assert.equal(resolveTeam(c, 'duo', { diag }).id, 'default');
		assert.equal(resolveTeam(c, '../etc', { diag }).id, 'default');
		assert.deepEqual(rows.map((row) => row.ev), ['catalog.load.fail', 'catalog.team.fail', 'catalog.team.fail']);
		assert.match(rows[0].message, /YAML 解析失败/);
	});
});

test("a member gets its team's procedure for its duty and finds skills in its talent folder first", async () => {
	await withUser(async ({ user, catalog }) => {
		await put(user, 'talents/research-assistant/talent.yml', 'name: 助研\nrole: 研究助理\nduty: executor\nskills: [paper-review]\n');
		await put(user, 'talents/research-assistant/skills/paper-review/SKILL.md', skillMd('paper-review', '审稿要点：方法、数据、可复现。'));
		await put(user, 'talents/pi/talent.yml', 'name: 导师\nrole: 导师\nduty: lead\n');
		await put(user, 'teams/lab/team.yml', 'procedures: { executor: lab-exec }\nmembers:\n  - { talent: pi }\n  - { talent: research-assistant }\n');
		await put(user, 'teams/lab/skills/lab-exec/SKILL.md', skillMd('lab-exec', '你是课题组的研究助理：先查文献再动手。'));
		const c = catalog();
		const preset = resolveTeam(c, 'lab');
		const ra = preset.team.members[1];
		assert.deepEqual([ra.id, ra.skills, ra.talent], ['mem_research_assistant', ['paper-review'], { id: 'research-assistant', version: '1.0.0', source: 'user' }]);
		const text = await loadSkillContext({ id: ra.id, role: ra.role, duty: ra.duty, skills: ra.skills }, [c.talents.get('research-assistant').dir], { vars: {}, ownerId: 'mem_pi', preset });
		assert.match(text, /课题组的研究助理/);
		assert.match(text, /### paper-review\n[\s\S]*审稿要点/);
		// 团队没带的规程退回内置；duty 写明的职责胜过岗位文字。
		assert.match(await loadSkillContext({ id: 'mem_pi', role: '导师', duty: 'lead' }, [], { vars: {}, preset }), /交付调度/);
		assert.match(await loadSkillContext({ id: 'mem_x', role: '质检', duty: 'qa' }, [], { vars: {}, preset }), /验收成员/);
	});
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

test('a new Project is seeded from the chosen team: members remember team, talent@version, duty and skills', async () => {
	await withProject(async (service, root) => {
		await put(root, 'ai-team/catalog/user/talents/dev/talent.yml', 'name: 阿码\nrole: 编程\nduty: executor\nversion: 1.2.0\nskills: [tdd]\npersonality: 先写测试\n');
		await put(root, 'ai-team/catalog/user/teams/duo/team.yml', 'lead: mem_pm\nmembers:\n  - { talent: dev }\n  - { talent: pmo-lead, id: mem_pm, name: 阿策 }\n');
		const preset = resolveTeam(loadCatalog({ roots: catalogRoots({ dshHome: root }) }), 'duo');
		assert.deepEqual(await seedDefaultRoster(service, 'prj_s', { preset }), { seeded: true, members: ['mem_dev', 'mem_pm'], renamed: [] });
		const dev = service.state.members.mem_dev;
		assert.deepEqual([dev.team, dev.talent, dev.talentVersion, dev.duty, dev.skills, dev.personality], ['duo', 'dev', '1.2.0', 'executor', ['tdd'], '先写测试']);
		const pm = service.state.members.mem_pm;
		assert.deepEqual([pm.name, pm.role, pm.talent, pm.duty], ['阿策', '主理人', 'pmo-lead', 'lead']);
		assert.equal(service.state.projects.prj_s.ownerMemberId, 'mem_pm');
		// 招聘信息也进成员视图（给界面标来源与版本）。
		const boot = service.bootstrap('prj_s');
		const view = [...(boot.agents ?? []), ...(boot.members ?? [])].find((m) => m.id === 'mem_dev');
		assert.deepEqual([view.talent, view.talentVersion, view.duty], ['dev', '1.2.0', 'executor']);
	});
});

test('an existing Project is left alone by a user team; only the bundled team back-fills missing roles', async () => {
	await withProject(async (service, root) => {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_lead', name: '墨渊', role: '主理人', kind: 'agent' } });
		assert.deepEqual([service.state.members.mem_lead.team, service.state.members.mem_lead.talent], [null, null]);
		await put(root, 'ai-team/catalog/user/teams/duo/team.yml', 'members:\n  - { talent: engineer }\n');
		const custom = resolveTeam(loadCatalog({ roots: catalogRoots({ dshHome: root }) }), 'duo');
		assert.deepEqual(await seedDefaultRoster(service, 'prj_s', { preset: custom }), { seeded: false, members: [], renamed: [] });
		const bundled = await seedDefaultRoster(service, 'prj_s');
		assert.deepEqual(bundled.members, ['mem_maker', 'mem_check', 'mem_coder', 'mem_ux', 'mem_biz']);
		assert.deepEqual([service.state.members.mem_check.duty, service.state.members.mem_check.talent], ['qa', 'qa-acceptor']);
	});
});

test('2d: back-fill only runs for the bundled default team on default-team projects; another bundled team never stuffs existing projects', async () => {
	// 0.4.124 起内置团队不止 default：设置换成 science 后重启，旧逻辑（只看 source === 'bundled'）
	// 会把启元、立验…塞进每个已有项目。
	await withProject(async (service) => {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_lead', name: '墨渊', role: '主理人', kind: 'agent' } });
		const science = resolveTeam(loadCatalog(), 'science');
		assert.equal(science.source, 'bundled');
		assert.deepEqual(await seedDefaultRoster(service, 'prj_s', { preset: science }), { seeded: false, members: [], renamed: [] });
		assert.equal(Object.values(service.state.members).filter((m) => m.kind === 'agent').length, 1, '科研团队的人没被塞进老项目');
	});
	// 用 science 建的项目，重启时按默认团队打开：不补默认团队的岗位。
	await withProject(async (service) => {
		assert.equal((await seedDefaultRoster(service, 'prj_s', { preset: resolveTeam(loadCatalog(), 'science') })).seeded, true);
		const before = Object.keys(service.state.members).length;
		assert.deepEqual((await seedDefaultRoster(service, 'prj_s')).members, [], '科研项目不被补进 UX/业务');
		assert.equal(Object.keys(service.state.members).length, before);
	});
});

test('hiring from the market through member.add records the talent and duty; a bad duty is refused', async () => {
	await withProject(async (service) => {
		const { member } = await service.dispatch({ type: 'member.add', actor: human, payload: { name: '评审官', role: '评审', kind: 'agent', talent: 'code-reviewer', talentVersion: '1.0.0', duty: 'qa' } });
		assert.deepEqual([service.state.members[member.id].talent, service.state.members[member.id].talentVersion, service.state.members[member.id].duty], ['code-reviewer', '1.0.0', 'qa']);
		await assert.rejects(service.dispatch({ type: 'member.add', actor: human, payload: { name: 'X', kind: 'agent', duty: 'boss' } }), /duty must be one of/);
	});
});

test('2b: uniqueTalentId never reuses a taken id; talentFromMember carries role, duty, personality, model and skills but not notes', async () => {
	const { uniqueTalentId, talentFromMember } = await import('../lib/domain/catalog.js');
	const catalog = { talents: new Map([['coach', {}], ['coach-2', {}], ['editor', {}]]) };
	assert.equal(uniqueTalentId(catalog, 'fresh'), 'fresh');
	assert.equal(uniqueTalentId(catalog, 'coach'), 'coach-3');
	assert.equal(uniqueTalentId(catalog, 'editor'), 'editor-2');
	assert.equal(uniqueTalentId(catalog, 'Bad Id'), '');
	const member = { name: '青岚', role: '执行', personality: '先交付再汇报', notes: ['私人经历'], skills: ['delivery-checklist', '../etc', 'ok.v2'], config: { provider: 'qwen', model: 'q-max', reasoningEffort: 'high' } };
	assert.deepEqual(talentFromMember(member, 'qa'), { name: '青岚', role: '执行', duty: 'qa', category: '', tags: [], personality: '先交付再汇报', model: { provider: 'qwen', model: 'q-max', reasoningEffort: 'high' }, skills: ['delivery-checklist', 'ok.v2'] });
	assert.equal(talentFromMember({ name: 'x' }, 'boss').duty, 'executor');
	assert.equal(talentFromMember({ name: 'x' }, 'lead').model, null);
});

test('2c: forkTalent copies a bundled talent with its skills into the user root under the same id; it shadows the bundled one and never overwrites an existing copy', async () => {
	await withUser(async ({ user, catalog }) => {
		const bundled = catalog().talents.get('executor');
		assert.equal(bundled.source, 'bundled');
		const first = forkTalent(user, bundled);
		assert.deepEqual(first, { forked: true, dir: join(user, 'talents', 'executor') });
		const copy = catalog().talents.get('executor');
		assert.deepEqual([copy.source, copy.version, copy.skills], ['user', bundled.version, bundled.skills]);
		assert.equal(listTalents(catalog()).find((x) => x.id === 'executor').forked, true);
		assert.equal(listTalents(catalog()).find((x) => x.id === 'editor').forked, false);
		// 改过的副本不会被第二次 fork 冲掉。
		await put(user, 'talents/executor/skills/delivery-checklist/SKILL.md', skillMd('delivery-checklist', '进化后的版本'));
		assert.equal(forkTalent(user, bundled).forked, false);
		assert.match(await findSkillText([copy.dir], 'delivery-checklist'), /进化后的版本/);
		// findSkill 报命中的根与路径：先命中者胜。
		const hit = await findSkill([copy.dir, bundled.dir], 'delivery-checklist');
		assert.deepEqual([hit.root, hit.path, hit.name], [copy.dir, join(copy.dir, 'skills', 'delivery-checklist', 'SKILL.md'), 'delivery-checklist']);
		assert.equal(await findSkill([copy.dir], '../etc'), null);
	});
});
