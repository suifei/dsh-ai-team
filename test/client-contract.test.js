import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * client.js 在浏览器里跑，仓库没有 jsdom 之类的依赖，因此这里做的是**结构契约**
 * 测试：锁住容易被顺手改坏的接线，而不是行为验证。真正的行为验证靠页面实测。
 */
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const indexOfAll = (needle) => {
	const hits = [];
	let from = 0;
	for (;;) {
		const at = source.indexOf(needle, from);
		if (at < 0) break;
		hits.push(at);
		from = at + needle.length;
	}
	return hits;
};

const sliceBetween = (start, end) => {
	const from = source.indexOf(start);
	const to = source.indexOf(end, from + start.length);
	assert.ok(from > 0 && to > from, `expected to find ${start} … ${end}`);
	return source.slice(from, to);
};

test('both message senders guard against a second in-flight submit', () => {
	assert.equal(indexOfAll('const sendingRef = React.useRef(false);').length, 1);
	const send = sliceBetween('async function send() {', 'async function sendOnce(');
	const reply = sliceBetween('async function sendReply() {', 'function openConvert()');
	for (const [name, body] of [['send', send], ['sendReply', reply]]) {
		assert.match(body, /sendingRef\.current = true;/, `${name} must acquire the guard`);
		assert.match(body, /sendingRef\.current = false;/, `${name} must release the guard`);
		assert.match(body, /finally/, `${name} must release even when the command throws`);
	}
	// 包裹关系：真正的命令调用必须落在被守卫的体内。
	assert.match(sliceBetween('async function sendOnce(', 'async function sendReply()'), /runCommand\('stream\.post'/);
	assert.match(reply, /runCommand\('thread\.post'/);
});

test('the event stream rebuilds itself when the browser gives up', () => {
	assert.match(source, /readyState === 2/, 'a CLOSED EventSource is never retried by the browser');
	assert.match(source, /clearTimeout\(retryTimer\)/, 'the retry timer must be cleared on unmount');
	assert.match(source, /retryDelay = Math\.min\(retryDelay \* 2/, 'reconnect backs off');
});

test('the stream-down notice is cleared once frames flow again', () => {
	const clearAt = source.indexOf("pushToast(t('streamUp'))");
	assert.ok(clearAt > 0, 'recovery must clear the notice');
	assert.ok(source.indexOf("say('')", clearAt - 400) > 0 || source.indexOf("say('')") > 0);
	assert.match(source, /streamUp: '实时更新已恢复。'/);
	assert.match(source, /streamUp: 'Live updates are back\.'/);
});
