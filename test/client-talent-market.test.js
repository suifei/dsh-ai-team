import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { listTalents, loadCatalog } from '../lib/domain/catalog.js';

// 人才市场（2026-11-18）：「添加成员」弹窗第一页挑人才预填表单。client.js 是浏览器单文件，
// 按 <member-copy> 标记取出纯函数单测（与界面用的是同一份源码），数据用真实的内置人才。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const between = (tag) => source.slice(source.indexOf(`// <${tag}>`), source.indexOf(`// </${tag}>`));
const market = vm.runInNewContext(`${between('member-copy')}\n({ hireTalentDraft, filterTalents, blankTalentForm, talentFormToBody, talentCreatorInit, teamDraftToBody, teamMembersLine })`);
const plain = (value) => JSON.parse(JSON.stringify(value));
const talents = listTalents(loadCatalog());

test('hiring a talent prefills the add-member draft with role, duty, personality, skills and the talent@version', () => {
	const reviewer = talents.find((talent) => talent.id === 'code-reviewer');
	const draft = plain(market.hireTalentDraft(reviewer, ['墨渊', '玄策']));
	assert.deepEqual([draft.name, draft.role, draft.duty, draft.talent, draft.preset, draft.maxTokens], ['评审官', '评审', 'qa', { id: 'code-reviewer', version: '1.1.0' }, 'standard', null]);
	assert.equal(draft.personality, reviewer.personality);
	// 名字已被占用时加序号；推荐模型随草稿带入。
	const again = plain(market.hireTalentDraft({ ...reviewer, skills: ['diff-scan', ''], model: { provider: 'qwen', model: 'q-max', reasoningEffort: 'high' } }, ['评审官', '评审官2']));
	assert.deepEqual([again.name, again.sourceName, again.skills, again.provider, again.model, again.reasoningEffort], ['评审官3', '评审官', ['diff-scan'], 'qwen', 'q-max', 'high']);
});

test('the market filters by category and by a keyword over name, role, tags, description and skills', () => {
	const ids = (list) => plain(list).map((talent) => talent.id).sort();
	assert.equal(market.filterTalents(talents, '', '').length, talents.length);
	const quality = ids(market.filterTalents(talents, '', '质量'));
	assert.ok(['code-reviewer', 'qa-acceptor', 'security-auditor'].every((id) => quality.includes(id)));
	assert.ok(quality.every((id) => talents.find((t) => t.id === id).category === '质量'));
	assert.deepEqual(ids(market.filterTalents(talents, '架构', '')), ['architect']);
	assert.deepEqual(ids(market.filterTalents(talents, 'ui', '')), ['ux-designer']);
	assert.deepEqual(ids(market.filterTalents([{ id: 'x', name: 'X', skills: ['Paper-Review'] }], 'paper', '')), ['x']);
	assert.deepEqual(plain(market.filterTalents(null, 'a', '')), []);
});

test('新建人才表单 → POST 体：标签按逗号/顿号/空白拆开，职责只认三种，字段 trim', () => {
	assert.deepEqual(plain(market.blankTalentForm()), { name: '', role: '', duty: 'executor', category: '', tags: '', personality: '', avatar: { gender: 'male', age: 'youth', race: 'asian' } });
	const body = plain(market.talentFormToBody({ name: '  小教练 ', role: ' 口语陪练 ', duty: 'qa', category: '教育', tags: '英语, 口语、听力  写作', personality: ' 多鼓励 ' }));
	assert.deepEqual(body, { name: '小教练', role: '口语陪练', duty: 'qa', category: '教育', tags: ['英语', '口语', '听力', '写作'], personality: '多鼓励' });
	// 非法职责兜底 executor；空表单安全。
	assert.equal(plain(market.talentFormToBody({ name: 'x', duty: 'boss' })).duty, 'executor');
	assert.deepEqual(plain(market.talentFormToBody({})), { name: '', role: '', duty: 'executor', category: '', tags: [], personality: '' });
});

test('存为人才：服务端草稿 → 新建人才页初值；找得到的技能按「从成员拷」暂存，找不到的单列', () => {
	const init = plain(market.talentCreatorInit({ projectId: 'prj_a', memberId: 'mem_x', draft: { name: '青岚', role: '执行', duty: 'executor', tags: ['a', 'b'], personality: 'p', model: { provider: 'qwen', model: 'q', reasoningEffort: '' }, skills: [{ name: 'delivery-checklist', found: true }, { name: 'ghost', found: false }] } }));
	assert.deepEqual(init.form, { name: '青岚', role: '执行', duty: 'executor', category: '', tags: 'a, b', personality: 'p', avatar: { gender: 'male', age: 'youth', race: 'asian' } });
	assert.deepEqual(init.pending, [{ name: 'delivery-checklist', kind: 'member', fromProject: 'prj_a', fromMember: 'mem_x' }]);
	assert.deepEqual(init.missing, ['ghost']);
	assert.equal(init.model.provider, 'qwen');
	assert.equal(init.sourceName, '青岚');
	const bare = plain(market.talentCreatorInit({ projectId: 'p', memberId: 'm', draft: { name: 'x', duty: 'boss' } }));
	assert.deepEqual([bare.form.duty, bare.pending, bare.missing, bare.model], ['executor', [], [], null]);
});

test('组队草稿 → POST 体：只带人才 id 与改过的名字，负责人越界退回第一位；成员摘要给负责人打星', () => {
	const body = plain(market.teamDraftToBody({ name: ' 口语组 ', description: ' 陪练 ', members: [{ talent: 'executor', name: '' }, { talent: 'executor', name: ' 青岚二号 ' }, { talent: '' }, { talent: 'qa-acceptor' }], lead: 2 }));
	assert.deepEqual(body, { name: '口语组', description: '陪练', members: [{ talent: 'executor' }, { talent: 'executor', name: '青岚二号' }, { talent: 'qa-acceptor' }], lead: 2 });
	assert.equal(plain(market.teamDraftToBody({ name: 'x', members: [{ talent: 'a' }], lead: 5 })).lead, 0);
	assert.deepEqual(plain(market.teamDraftToBody(null)), { name: '', description: '', members: [], lead: 0 });
	assert.equal(market.teamMembersLine({ lead: 'mem_b', members: [{ id: 'mem_a', name: '青岚', role: '执行' }, { id: 'mem_b', name: '白砚', role: '验收' }] }), '青岚·执行、★白砚·验收');
	assert.equal(market.teamMembersLine(null), '');
});
