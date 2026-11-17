// 人才市场第 2 步 2a：新建自定义人才 + 装 skill 的 HTTP 路由（进程内起 server 真打接口）。
// 建人才落用户根、装技能（自写 / 从内置 fork）、只读守卫、中文名兜底 id、校验。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { apply } from '../index.js';

function makeCtx(routes) {
	return {
		effect(fn) { fn(); },
		on() { return () => {}; },
		get(id) {
			if (id === 'connection') return { requestRejection: () => undefined };
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') return { catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }), resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }), set: () => {} };
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
}

test('talent market 2a: create a custom talent, install a written skill and a forked one', async (t) => {
	const routes = [];
	const root = await mkdtemp(join(tmpdir(), 'ai-team-talent-'));
	const prevHome = process.env.DSH_HOME;
	const prevProfile = process.env.DSH_PROFILE;
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'talent';
	const consoleErrors = [];
	const realError = console.error; const realWarn = console.warn;
	console.error = (...a) => consoleErrors.push(a.map(String).join(' '));
	console.warn = (...a) => consoleErrors.push(a.map(String).join(' '));
	let server = null;
	t.after(async () => {
		console.error = realError; console.warn = realWarn;
		if (server) await new Promise((r) => server.close(r));
		if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
		if (prevProfile === undefined) delete process.env.DSH_PROFILE; else process.env.DSH_PROFILE = prevProfile;
		await rm(root, { recursive: true, force: true });
	});

	apply(makeCtx(routes));
	server = createServer((req, res) => routes[0].handler(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	const get = async (path) => { const r = await fetch(base + path, { headers: { accept: 'application/json' } }); return { status: r.status, body: await r.json().catch(() => null) }; };
	const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

	// 1. 新建一个自定义人才（显式 latin id），落用户根，出现在市场里、标 user。
	// tags 由客户端 talentFormToBody 拆成数组后再 POST，服务端契约是数组。
	const created = await post('/ai-team/api/talents', { id: 'my-coach', name: '小教练', role: '口语陪练', duty: 'executor', category: '教育', tags: ['英语', '口语'], personality: '用简单句陪练，多鼓励。' });
	assert.equal(created.status, 200, JSON.stringify(created.body));
	assert.equal(created.body.talent.id, 'my-coach');
	assert.equal(created.body.talent.source, 'user');
	assert.equal(created.body.talent.duty, 'executor');
	assert.deepEqual(created.body.talent.tags, ['英语', '口语']);
	assert.ok(existsSync(join(root, 'ai-team', 'catalog', 'user', 'talents', 'my-coach', 'talent.yml')), 'talent.yml 落到用户根');
	const market = await get('/ai-team/api/talents');
	const mine = market.body.talents.find((x) => x.id === 'my-coach');
	assert.ok(mine && mine.source === 'user', '新人才进入市场');

	// 2. 自写一份技能装上去：talent.skills 带上它，SKILL.md 落盘，内容可读回。
	const wrote = await post('/ai-team/api/talents/my-coach/skills', { name: 'speaking-drill', markdown: '---\nname: speaking-drill\n---\n开口陪练：先示范再纠音。' });
	assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
	assert.deepEqual(wrote.body.talent.skills, ['speaking-drill']);
	const skFile = join(root, 'ai-team', 'catalog', 'user', 'talents', 'my-coach', 'skills', 'speaking-drill', 'SKILL.md');
	assert.ok(existsSync(skFile), 'SKILL.md 落盘');
	assert.match(readFileSync(skFile, 'utf8'), /先示范再纠音/);

	// 3. 从内置人才 fork 一份技能（copywriter 的 copywriting）：内容与来源一致。
	const srcContent = await get('/ai-team/api/skills-install/content?talent=copywriter&name=copywriting');
	assert.equal(srcContent.status, 200);
	assert.ok(srcContent.body.markdown.length > 0);
	const forked = await post('/ai-team/api/talents/my-coach/skills', { name: 'copywriting', fromTalent: 'copywriter', fromSkill: 'copywriting' });
	assert.equal(forked.status, 200, JSON.stringify(forked.body));
	assert.deepEqual(forked.body.talent.skills, ['speaking-drill', 'copywriting']);
	const forkedFile = join(root, 'ai-team', 'catalog', 'user', 'talents', 'my-coach', 'skills', 'copywriting', 'SKILL.md');
	assert.equal(readFileSync(forkedFile, 'utf8'), srcContent.body.markdown, 'fork 内容与来源一致');

	// 4. 可安装技能清单里有内置的 copywriting，也有刚自写的 speaking-drill。
	const install = await get('/ai-team/api/skills-install');
	const names = install.body.skills.map((s) => s.name);
	assert.ok(names.includes('copywriting'), '列出内置技能');
	assert.ok(names.includes('speaking-drill'), '列出自定义人才的技能');

	// 5. 只读守卫：往内置人才装技能被拒（409 E_READONLY）。
	const readonly = await post('/ai-team/api/talents/copywriter/skills', { name: 'x', markdown: 'y' });
	assert.equal(readonly.status, 409);
	assert.equal(readonly.body.error.code, 'E_READONLY');

	// 6. 纯中文名也能建：派生 id 为空时生成兜底 id（非空、合法 slug）。
	const zh = await post('/ai-team/api/talents', { name: '纯中文名', role: '测试', duty: 'qa' });
	assert.equal(zh.status, 200, JSON.stringify(zh.body));
	assert.match(zh.body.talent.id, /^[a-z0-9][a-z0-9-]*$/, '兜底 id 是合法 slug');

	// 7. 校验：空名 400；非法职责被规范为 executor（parseTalent 的 duty 校验兜底在写层之外，这里只验空名）。
	const empty = await post('/ai-team/api/talents', { name: '', role: 'x' });
	assert.equal(empty.status, 400);
	assert.equal(empty.body.error.code, 'E_INVALID_ARGUMENT');

	// 8. 删除自定义人才；内置人才删不得（409）。
	const del = await post('/ai-team/api/talents/delete', { id: 'my-coach' });
	assert.equal(del.status, 200);
	assert.ok(!existsSync(join(root, 'ai-team', 'catalog', 'user', 'talents', 'my-coach')), '目录已删');
	const delBundled = await post('/ai-team/api/talents/delete', { id: 'copywriter' });
	assert.equal(delBundled.status, 409);

	// 9. 2b 存为人才：成员草稿（职责按身份判定、标出找不到正文的技能）→ 建人才 → 按成员读技能的路径拷技能。
	const pid = (await get('/ai-team/api/bootstrap')).body.project.id;
	const leadDraft = await get(`/ai-team/api/projects/${pid}/members/mem_lead/talent-draft`);
	assert.equal(leadDraft.status, 200);
	assert.equal(leadDraft.body.draft.duty, 'lead', '项目主理人按身份判定为 lead');
	const ghostAdded = await post(`/ai-team/api/projects/${pid}/commands`, { type: 'member.skill', payload: { memberId: 'mem_maker', name: 'ghost-skill' } });
	assert.equal(ghostAdded.status, 200, JSON.stringify(ghostAdded.body));
	const draft = (await get(`/ai-team/api/projects/${pid}/members/mem_maker/talent-draft`)).body.draft;
	assert.equal(draft.duty, 'executor');
	assert.deepEqual(draft.skills, [{ name: 'delivery-checklist', found: true }, { name: 'ghost-skill', found: false }]);
	const saved = await post('/ai-team/api/talents', { name: draft.name, role: draft.role, duty: draft.duty, personality: draft.personality });
	assert.equal(saved.status, 200, JSON.stringify(saved.body));
	const savedId = saved.body.talent.id;
	assert.equal(saved.body.talent.personality, draft.personality, '性格原样带走');
	const copied = await post(`/ai-team/api/talents/${savedId}/skills`, { name: 'delivery-checklist', fromProject: pid, fromMember: 'mem_maker' });
	assert.equal(copied.status, 200, JSON.stringify(copied.body));
	const original = await get('/ai-team/api/skills-install/content?talent=executor&name=delivery-checklist');
	assert.equal(readFileSync(join(root, 'ai-team', 'catalog', 'user', 'talents', savedId, 'skills', 'delivery-checklist', 'SKILL.md'), 'utf8'), original.body.markdown, '拷出来的就是成员读到的那份');
	const ghost = await post(`/ai-team/api/talents/${savedId}/skills`, { name: 'ghost-skill', fromProject: pid, fromMember: 'mem_maker' });
	assert.equal(ghost.status, 400, '找不到正文的技能不装');
	assert.equal((await get(`/ai-team/api/projects/${pid}/members/mem_nope/talent-draft`)).status, 404);

	// 10. 新建不静默覆盖：同 id 再建加序号；撞内置 id 也加序号；显式 overwrite 才改写。
	const dup1 = await post('/ai-team/api/talents', { id: 'dup', name: 'A', role: 'r' });
	const dup2 = await post('/ai-team/api/talents', { id: 'dup', name: 'B', role: 'r' });
	assert.deepEqual([dup1.body.talent.id, dup2.body.talent.id], ['dup', 'dup-2']);
	assert.equal((await post('/ai-team/api/talents', { name: 'editor', role: '编辑' })).body.talent.id, 'editor-2', '不遮盖内置 editor');
	const over = await post('/ai-team/api/talents', { id: 'dup', name: 'A2', role: 'r', overwrite: true });
	assert.deepEqual([over.body.talent.id, over.body.talent.name], ['dup', 'A2']);

	// 精简测试壳没接 tool registry，SkillOpt 注册会打一条环境提示——与本测试无关，过滤掉。
	const faults = consoleErrors.filter((line) => !line.includes('SkillOpt tools not registered'));
	assert.deepEqual(faults, [], '运行期无 console.error/warn：' + faults.join(' | '));
});
