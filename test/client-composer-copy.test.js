import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// #65：输入框只显示一两行、拉不大；想要两个「玄策」只能手工重填。client.js 是浏览器单文件，
// 按 <textarea-fit> / <member-copy> 标记取出算法单测（与界面用的是同一份源码）。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const between = (tag) => source.slice(source.indexOf(`// <${tag}>`), source.indexOf(`// </${tag}>`));
const fit = vm.runInNewContext(`${between('textarea-fit')}\n({ fitTextarea, rememberTextareaDrag })`);
const copyMemberDraft = vm.runInNewContext(`${between('member-copy')}\ncopyMemberDraft`);
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 模拟 textarea：height=auto 时 offsetHeight 回到内容高度。 */
const area = (contentHeight) => ({ style: {}, dataset: {}, scrollHeight: contentHeight, offsetHeight: contentHeight });

test('the composer grows with what is typed and scrolls only past the cap (#65)', () => {
	const el = area(38);
	assert.equal(fit.fitTextarea(el, 400), 38);
	assert.deepEqual([el.style.height, el.style.overflowY], ['38px', 'hidden']);
	el.scrollHeight = 210; // 粘进十来行
	assert.equal(fit.fitTextarea(el, 400), 210);
	assert.equal(el.style.height, '210px');
	el.scrollHeight = 900;
	assert.equal(fit.fitTextarea(el, 400), 400);
	assert.deepEqual([el.style.height, el.style.overflowY], ['400px', 'auto']);
	assert.equal(fit.fitTextarea(null, 400), null);
});

test('a height the user drags out stays as the floor, also after the draft is sent and cleared (#65)', () => {
	const el = area(38);
	fit.fitTextarea(el, 400);
	el.offsetHeight = 39; // 普通点击：与自适应结果差 ≤2px，不算拖动
	assert.equal(fit.rememberTextareaDrag(el), null);
	el.offsetHeight = 260; // 拖动右下角
	assert.equal(fit.rememberTextareaDrag(el), 260);
	el.scrollHeight = 38; // 发送后清空
	assert.equal(fit.fitTextarea(el, 400), 260);
	el.scrollHeight = 320;
	assert.equal(fit.fitTextarea(el, 400), 320);
});

test('duplicating a member keeps role, personality, recipe, model, limit and skills under the next free name (#65)', () => {
	const xuance = {
		name: '玄策', role: '执行·编码', personality: '先读后改，小步提交', skills: ['csharp-emit', ' ', 'linq'],
		notes: ['昨晚踩过 gc'], sessionId: 'sess-x',
		config: { provider: 'qwen', model: 'Q-1M', reasoningEffort: 'high', preset: 'ptc', maxTokens: 32000 },
	};
	assert.deepEqual(plain(copyMemberDraft(xuance, ['玄策', '青岚'])), {
		name: '玄策2', role: '执行·编码', personality: '先读后改，小步提交', preset: 'ptc',
		provider: 'qwen', model: 'Q-1M', reasoningEffort: 'high', maxTokens: 32000,
		skills: ['csharp-emit', 'linq'], sourceName: '玄策', avatar: null,
	});
	assert.equal(copyMemberDraft(xuance, ['玄策', '玄策2']).name, '玄策3');
	assert.equal(copyMemberDraft({ ...xuance, name: '玄策2' }, ['玄策', '玄策2']).name, '玄策3');
	const bare = plain(copyMemberDraft({ name: '白砚' }, []));
	assert.deepEqual([bare.name, bare.preset, bare.maxTokens, bare.skills, bare.provider], ['白砚2', 'standard', null, [], '']);
});

test('client wiring: both reply boxes auto-fit, the profile dialog offers duplicate, and creation writes personality, config and skills', () => {
	assert.match(source, /\.at-box textarea \{[^}]*max-height: 60vh; resize: vertical;/);
	assert.match(source, /useFitTextarea\(boxRef, draft\);/);
	assert.match(source, /useFitTextarea\(replyRef, reply\);/);
	assert.equal(source.match(/onMouseUp: \(event\) => rememberTextareaDrag\(event\.currentTarget\)/g)?.length, 2);
	assert.match(source, /openCopyAgent\(source\); \}, disabled: pBusy \}, withIco\('copy', t\('memberCopy'\), 12\)\)/);
	const create = source.slice(source.indexOf('async function createAgent()'), source.indexOf("say(t('memberAdded'))"));
	assert.match(create, /personality: mCopy\.personality/);
	assert.match(create, /preset: mCopy\.preset/);
	assert.match(create, /maxTokens: mCopy\.maxTokens/);
	assert.match(create, /runCommand\('member\.skill', \{ memberId, name: skill \}\)/);
	assert.ok(create.indexOf("'member.skill'") < create.indexOf("'member.activate'"), 'skills land before activation');
	assert.match(source, /function openAddAgent\(\) \{[\s\S]*?setMCopy\(null\);/);
	for (const key of ['memberCopy', 'memberCopyFrom']) assert.equal(source.match(new RegExp(`\\b${key}: '`, 'g'))?.length, 2, `${key} in zh and en`);
});
