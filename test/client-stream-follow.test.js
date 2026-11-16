import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// #33：打开主对话总停在最早的消息，要手动拖到底。client.js 是浏览器单文件，
// 这里按 <stream-follow> 标记取出跟随算法单测（与界面用的是同一份源码）。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('// <stream-follow>'), source.indexOf('// </stream-follow>'));
const inVm = vm.runInNewContext(`${block}\ncreateStreamFollower`);
// vm 里造的对象原型属于另一个 realm，deepEqual 前转成本域对象。
const plain = (value) => JSON.parse(JSON.stringify(value));
const createStreamFollower = (...args) => {
	const follower = inVm(...args);
	return {
		reset: () => follower.reset(),
		onScroll: (el) => follower.onScroll(el),
		onContent: (el, count) => plain(follower.onContent(el, count)),
		onResize: (el) => follower.onResize(el),
		jump: (el) => follower.jump(el),
		get pinned() { return follower.pinned; },
	};
};

const box = (scrollHeight, clientHeight = 400, scrollTop = 0) => ({ scrollHeight, clientHeight, scrollTop });

test('opening the main stream lands on the latest message, also when content arrives late', () => {
	const follow = createStreamFollower();
	const el = box(400);
	assert.deepEqual(follow.onContent(el, 0), { scrollTo: 0, unseen: 0 });
	el.scrollHeight = 5000; // bootstrap 返回后整段历史一次渲染
	assert.deepEqual(follow.onContent(el, 40), { scrollTo: 4600, unseen: 0 });
	el.scrollTop = 4600;
	el.scrollHeight = 5300; // 卡片/字体晚到导致变高
	assert.equal(follow.onResize(el), 4900);
});

test('a reader at the bottom follows new messages; one who scrolled up keeps the position and sees an unseen count', () => {
	const follow = createStreamFollower();
	const el = box(5000);
	follow.onContent(el, 40);
	el.scrollTop = 4570; // 距底 30px：仍算跟随
	assert.equal(follow.onScroll(el), 0);
	el.scrollHeight = 5200;
	assert.equal(follow.onContent(el, 41).scrollTo, 4800);

	el.scrollTop = 1200; // 上翻读历史
	follow.onScroll(el);
	assert.equal(follow.pinned, false);
	el.scrollHeight = 5500;
	assert.deepEqual(follow.onContent(el, 43), { scrollTo: null, unseen: 2 });
	assert.equal(follow.onResize(el), null, 'a layout change never moves a reader who scrolled up');
	assert.deepEqual(follow.onContent(el, 43), { scrollTo: null, unseen: 2 }, 'a refresh without new messages adds nothing');

	assert.equal(follow.jump(el), 5100);
	assert.equal(follow.pinned, true);
	assert.deepEqual(follow.onContent(el, 43), { scrollTo: 5100, unseen: 0 });
});

test('scrolling back to the bottom clears the unseen count; switching project or tab starts at the latest again', () => {
	const follow = createStreamFollower();
	const el = box(5000);
	follow.onContent(el, 10);
	el.scrollTop = 100;
	follow.onScroll(el);
	follow.onContent(el, 12);
	el.scrollTop = 4600;
	assert.equal(follow.onScroll(el), 0);

	el.scrollTop = 100;
	follow.onScroll(el);
	follow.reset();
	el.scrollHeight = 3000;
	assert.deepEqual(follow.onContent(el, 7), { scrollTo: 2600, unseen: 0 }, 'the first content of a new project is not counted as unseen');
});

test('the main stream panel is wired to the follower and the jump button stays out of the document flow', () => {
	assert.match(source, /className: 'at-stream', role: 'tabpanel', id: 'at-panel-main'[^)]*ref: streamRef, onScroll: onStreamScroll/);
	assert.match(source, /\.at-streamjumpanchor \{ position: relative; height: 0; \}/);
	assert.match(source, /\.at-streamjump \{ position: absolute;/);
	assert.match(source, /streamUnseen: '\{count\} 条新消息'/);
});
