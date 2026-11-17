import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// #65：文渊阁对话框的 @成员 与图片/文件。按 <composer-rich> 标记取出与界面同一份的纯函数单测。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('// <composer-rich>'), source.indexOf('// </composer-rich>'));
const fns = vm.runInNewContext(`${block}\n({ mentionQuery, mentionCandidates, applyMention, attachmentKind, fmtBytes })`);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('typing @ opens the member list for the word under the caret, and picking inserts "@name "', () => {
	assert.deepEqual(plain(fns.mentionQuery('请 @玄', 4)), { start: 2, query: '玄' });
	assert.deepEqual(plain(fns.mentionQuery('@', 1)), { start: 0, query: '' });
	assert.equal(fns.mentionQuery('@玄策 看下', 6), null, 'a space after the name closes the list');
	assert.equal(fns.mentionQuery('没有点名', 4), null);
	assert.equal(fns.mentionQuery('mail@example.com is long enough to close', 40), null);
	const agents = [
		{ id: 'a1', name: '玄策', status: 'idle' }, { id: 'a2', name: '青岚', status: 'running' },
		{ id: 'a3', name: '老玄', status: 'idle' }, { id: 'a4', name: '玄机', status: 'retired' },
	];
	assert.deepEqual(plain(fns.mentionCandidates(agents, '玄').map((agent) => agent.id)), ['a1', 'a3']);
	assert.deepEqual(plain(fns.mentionCandidates(agents, '').map((agent) => agent.id)), ['a1', 'a2', 'a3']);
	assert.deepEqual(plain(fns.applyMention('请 @玄 看图', 2, 4, '玄策')), { text: '请 @玄策  看图', caret: 6 });
});

test('the four Host image types upload as images, everything else as verbatim files', () => {
	assert.equal(fns.attachmentKind({ type: 'image/png' }), 'image');
	assert.equal(fns.attachmentKind({ type: 'image/webp' }), 'image');
	assert.equal(fns.attachmentKind({ type: 'image/bmp' }), 'file');
	assert.equal(fns.attachmentKind({ type: 'application/pdf' }), 'file');
	assert.deepEqual(plain([fns.fmtBytes(900), fns.fmtBytes(2048), fns.fmtBytes(5 * 1024 * 1024)]), ['900 B', '2.0 KB', '5.0 MB']);
});

test('client wiring: paste, drop and picker upload to the plugin endpoint; send carries ready blocks; messages render attachments', () => {
	assert.match(source, /onPaste: \(event\) => \{\s*const files = Array\.from\(event\.clipboardData\?\.files \?\? \[\]\);/);
	assert.match(source, /onDrop: \(event\) => \{ setDragging\(false\); if \(!discuss\) return; event\.preventDefault\(\); attach\(event\.dataTransfer\?\.files\); \}/);
	assert.match(source, /h\('input', \{ ref: fileRef, type: 'file', multiple: true, hidden: true,/);
	assert.match(source, /fetch\('\/ai-team\/api\/attachments\?' \+ query\.toString\(\), \{ method: 'POST', headers: \{ 'content-type': 'application\/octet-stream' \}, body: file \}\)/);
	assert.match(source, /await runCommand\('stream\.post', \{ body: text, \.\.\.\(blocks\.length > 0 \? \{ attachments: blocks \} : \{\}\) \}\);/);
	assert.match(source, /pendingFiles\.some\(\(item\) => item\.status === 'uploading'\)\) \{ say\(t\('attachUploading'\)\); return; \}/);
	assert.match(source, /h\(MessageAttachments, \{ item \}\)/);
	assert.match(source, /'\/ai-team\/api\/attachments\/content\?' \+ new URLSearchParams\(\{ project: item\.projectId \?\? '', seq: String\(item\.seq\), index: String\(index\) \}\)/);
	assert.match(source, /agents: \(data\?\.agents \?\? \[\]\)\.filter\(\(agent\) => agent\.status !== 'retired'\),\s*attachments: pendingFiles,\s*onAttach: attachFiles,\s*onRemoveAttachment: removeAttachment,/);
	for (const key of ['attachAdd', 'attachRemove', 'attachUploading', 'attachFailed', 'attachDrop', 'attachTaskMode', 'mentionList']) {
		assert.equal(source.match(new RegExp(`\\b${key}: '`, 'g'))?.length, 2, `${key} in zh and en`);
	}
});
