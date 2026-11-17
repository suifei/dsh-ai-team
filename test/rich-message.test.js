import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { planWakes } from '../lib/host/waker.js';
import { describeAttachments, findMentions, messageContent, normalizeAttachments, plainMentionLinks } from '../lib/domain/rich-message.js';
import { attachmentAt, displayName, readAttachment, uploadAttachment } from '../lib/host/attachment-routes.js';

// #65：主对话的「需求内容」= 文字 + 图片/文件 + @成员；文渊阁对话框与 DSH 标准会话共用这一份实现。
const image = { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 10, width: 4, height: 3, name: '报错.png' } };
const file = { type: 'file', attachment: { attachmentId: 'f-1', bytes: 20, name: 'spec.pdf' } };
const human = { kind: 'human', memberId: 'h1' };

test('attachments keep only well-formed DSH image/file references, deduplicated and capped', () => {
	const bad = [
		{ type: 'image', attachment: { attachmentId: 'x', mediaType: 'image/bmp', bytes: 1, width: 1, height: 1 } },
		{ type: 'image', attachment: { attachmentId: '', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
		{ type: 'file', attachment: { attachmentId: 'f', bytes: -1, name: 'a' } },
		{ type: 'text', text: 'hi' },
		null,
	];
	assert.deepEqual(normalizeAttachments([image, file, image, ...bad]), [image, file]);
	const many = Array.from({ length: 14 }, (_, i) => ({ type: 'file', attachment: { attachmentId: `f${i}`, bytes: 1, name: `${i}.txt` } }));
	assert.equal(normalizeAttachments(many).length, 10);
	assert.equal(describeAttachments([image, file]), '附：1 张图片，1 个文件（spec.pdf）');
	assert.equal(messageContent('看图', []), '看图');
	assert.deepEqual(messageContent('看图', [image]), [{ type: 'text', text: '看图' }, image]);
});

test('@ mentions resolve against the roster, longest name first, active agents only', () => {
	const members = {
		h1: { id: 'h1', name: 'Human', kind: 'human' },
		a1: { id: 'a1', name: '玄策', kind: 'agent', status: 'idle' },
		a2: { id: 'a2', name: '玄策2', kind: 'agent', status: 'idle' },
		a3: { id: 'a3', name: '白砚', kind: 'agent', status: 'retired' },
		a4: { id: 'a4', name: '青岚', kind: 'agent', status: 'running' },
	};
	assert.deepEqual(findMentions('@玄策2 和 @玄策看下这张图，@青岚 也看，@玄策 再说一次', members), ['a2', 'a1', 'a4']);
	assert.deepEqual(findMentions('@白砚 @Human @无名', members), []);
	assert.deepEqual(findMentions('没有点名', members), []);
});

test('an @ inserted by the DSH standard session composer (a dsh-session link) names the member by session id (il2c 11-17 20:53)', () => {
	// 实机原文：「@[tony老师](dsh-session:…) 你看看你的任务」——账本没有 mentions，tony 老师没被直接叫醒。
	const live = '@[tony老师](dsh-session:IjFlMmJjOGU5LTAzNjMtNDQ3Yy1iZmEyLWJjYzVlOTYzMmI4ZCI) 你看看你的任务';
	const members = {
		tony: { id: 'tony', name: 'tony老师', kind: 'agent', status: 'idle', sessionId: '1e2bc8e9-0363-447c-bfa2-bcc5e9632b8d' },
		renamed: { id: 'renamed', name: '玄策', kind: 'agent', status: 'idle', sessionId: 'sess-x' },
		lead: { id: 'lead', name: '墨渊', kind: 'agent', status: 'idle', sessionId: 'sess-lead' },
	};
	assert.deepEqual(findMentions(live, members), ['tony']);
	assert.equal(plainMentionLinks(live), '@tony老师 你看看你的任务');
	// 会话 id 对不上（旧会话）时按链接里的名字；与普通 @ 混用按出现顺序。
	const stale = '@墨渊 先看，再叫 @[玄策](dsh-session:' + Buffer.from(JSON.stringify('old-session')).toString('base64url') + ')';
	assert.deepEqual(findMentions(stale, members), ['lead', 'renamed']);
	assert.equal(findMentions('@[陌生人](dsh-session:bm90LWpzb24) hi', members).length, 0);
});

test('stream.post shows a DSH session @ as "@name" and records the mention', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-link-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_link', fsync: false });
	try {
		const service = new TeamService({ ledger });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'tony', name: 'tony老师', kind: 'agent' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { name: 'L', ownerId: 'h1', workspacePath: root } });
		const ref = Buffer.from(JSON.stringify('no-such-session')).toString('base64url');
		const { entry } = await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_link', payload: { body: `@[tony老师](dsh-session:${ref}) 你看看你的任务` } });
		assert.deepEqual([entry.body, entry.mentions], ['@tony老师 你看看你的任务', ['tony']]);
	} finally {
		ledger.close?.();
		await rm(root, { recursive: true, force: true });
	}
});

test('stream.post stores attachments and mentions, accepts an image-only message, and the ledger replays them', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-rich-'));
	const dir = join(root, 'ledger');
	let ledger = openLedger({ dir, projectId: 'prj_rich', fsync: false });
	try {
		const service = new TeamService({ ledger });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: '玄策', kind: 'agent' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { name: 'R', ownerId: 'h1', workspacePath: root } });
		await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_rich', payload: { body: '@玄策 看下这张图', attachments: [image, { type: 'image', attachment: { attachmentId: 'evil' } }] } });
		await service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_rich', payload: { body: '  ', attachments: [file] } });
		await assert.rejects(service.dispatch({ type: 'stream.post', actor: human, projectId: 'prj_rich', payload: { body: '' } }), /body is required/);
		const tail = service.bootstrap('prj_rich').stream.slice(-2);
		assert.deepEqual(tail.map((entry) => [entry.body, entry.attachments, entry.mentions]), [
			['@玄策 看下这张图', [image], ['a1']],
			['附：1 个文件（spec.pdf）', [file], undefined],
		]);
		ledger.close?.();
		ledger = openLedger({ dir, projectId: 'prj_rich', fsync: false });
		const replayed = new TeamService({ ledger });
		await replayed.ready?.();
		const again = (replayed.state.stream ?? []).slice(-2);
		assert.deepEqual(again.map((entry) => [entry.attachments, entry.mentions]), [[[image], ['a1']], [[file], undefined]]);
	} finally {
		ledger.close?.();
		await rm(root, { recursive: true, force: true });
	}
});

test('Human @ wakes the owner and the named member, both with the images and files (#65)', () => {
	const state = {
		members: {
			h1: { id: 'h1', name: 'Human', kind: 'human', status: 'idle' },
			lead: { id: 'lead', name: '墨渊', kind: 'agent', status: 'idle', sessionId: 's0' },
			a1: { id: 'a1', name: '玄策', kind: 'agent', status: 'idle', sessionId: 's1' },
			a2: { id: 'a2', name: '白砚', kind: 'agent', status: 'retired', sessionId: 's2' },
		},
		tasks: {}, inbox: {},
		projects: { p1: { id: 'p1', ownerMemberId: 'lead' } },
	};
	const event = { type: 'stream/posted', seq: 12, payload: { kind: 'human_message', authorId: 'h1', body: '@玄策 @墨渊 @白砚 看下这张图', attachments: [image], mentions: ['a1', 'lead', 'a2'] } };
	const plans = planWakes(state, { event }, {});
	assert.deepEqual(plans.map((plan) => [plan.memberId, plan.reason]), [['lead', 'human_message'], ['a1', 'human_mention']]);
	assert.deepEqual(plans.map((plan) => plan.attachments), [[image], [image]]);
	assert.match(plans[0].prompt, /点名了 玄策、墨渊/);
	assert.match(plans[0].prompt, /1 张图片/);
	assert.match(plans[1].prompt, /点名你：“@玄策 @墨渊 @白砚 看下这张图”/);
	assert.match(plans[1].prompt, /墨渊）也收到了/);
	const plain = planWakes(state, { event: { type: 'stream/posted', seq: 13, payload: { kind: 'human_message', authorId: 'h1', body: '继续' } } }, {});
	assert.deepEqual(plain.map((plan) => [plan.memberId, plan.attachments]), [['lead', undefined]]);
});

function fakeStore() {
	const saved = [];
	return {
		saved,
		imageLimits: { maxImageBytes: 8 },
		async saveImages(inputs) { saved.push(...inputs); return inputs.map((input, i) => ({ attachmentId: `img-${i}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 2, height: 2, ...(input.name ? { name: input.name } : {}) })); },
		async saveFile(input) { saved.push(input); return { attachmentId: 'file-1', bytes: input.data.byteLength, name: input.name }; },
		async readImage(ref) { return { ref, data: new Uint8Array([1, 2, 3]) }; },
		async *readFileStream() { yield new Uint8Array([7]); yield new Uint8Array([8]); },
	};
}
const body = (bytes) => (async function* () { yield Buffer.from(bytes); })();
const at = (query) => new URL(`http://x/ai-team/api/attachments?${query}`);

test('uploads go into the DSH attachment store and come back as message blocks; reads follow the ledger only', async () => {
	const store = fakeStore();
	const up = await uploadAttachment({ store, req: body([1, 2, 3]), url: at('kind=image&type=image/png&name=' + encodeURIComponent('C:\\tmp\\截图.png')) });
	assert.deepEqual(up, { status: 200, body: { ok: true, block: { type: 'image', attachment: { attachmentId: 'img-0', mediaType: 'image/png', bytes: 3, width: 2, height: 2, name: '截图.png' } } } });
	const doc = await uploadAttachment({ store, req: body([9, 9]), url: at('kind=file&name=spec.pdf') });
	assert.deepEqual(doc.body.block, { type: 'file', attachment: { attachmentId: 'file-1', bytes: 2, name: 'spec.pdf' } });
	assert.equal((await uploadAttachment({ store, req: body([1]), url: at('kind=image&type=image/bmp') })).status, 415);
	assert.equal((await uploadAttachment({ store, req: body(new Array(9).fill(0)), url: at('kind=image&type=image/png') })).status, 413);
	assert.equal((await uploadAttachment({ store: undefined, req: body([1]), url: at('kind=file') })).status, 503);
	assert.equal(displayName('../../etc/passwd\u0007'), 'passwd');

	const state = { stream: [{ seq: 5, attachments: [up.body.block, doc.body.block] }] };
	assert.deepEqual(attachmentAt(state, 5, 1), doc.body.block);
	assert.equal(attachmentAt(state, 5, 2), null);
	const shown = await readAttachment({ store, state, url: new URL('http://x/c?seq=5&index=0') });
	assert.deepEqual([shown.status, shown.contentType, [...shown.bytes]], [200, 'image/png', [1, 2, 3]]);
	const download = await readAttachment({ store, state, url: new URL('http://x/c?seq=5&index=1') });
	const chunks = [];
	for await (const chunk of download.bytes) chunks.push(...chunk);
	assert.deepEqual([download.contentType, download.name, chunks], ['application/octet-stream', 'spec.pdf', [7, 8]]);
	assert.equal((await readAttachment({ store, state, url: new URL('http://x/c?seq=6&index=0') })).status, 404);
});

test('index.js wires uploads, reads, wake content and activation through the one rich-message implementation', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	assert.match(index, /url\.pathname === '\/ai-team\/api\/attachments'\) \{\s*try \{\s*const result = await uploadAttachment\(\{ store: serviceOf\(ctx, 'attachments'\), req, url \}\)/);
	assert.match(index, /url\.pathname === '\/ai-team\/api\/attachments\/content'/);
	assert.match(index, /const wakeContent = async \(plan, member, options = \{\}\) => messageContent\(await wakePrompt\(plan, member, options\), plan\.attachments\);/);
	assert.match(index, /prompt: await wakeContent\(plan, member, \{ includeThread:/);
	assert.match(index, /\.\.\.\(Array\.isArray\(plan\.attachments\) \? \{ attachments: plan\.attachments \} : \{\}\)/);
	assert.match(index, /prompt: messageContent\(`\$\{memberIdentity\(activationMember\)\}/);
	assert.match(index, /\}\)\}`, body\.payload\?\.attachments\),/);
});
