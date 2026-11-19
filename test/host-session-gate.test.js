import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHostSessionGate } from '../lib/runtime/host-session-gate.js';

const HOST = 'session-team-host-1';
// 宿主拼的完成通知原形（il2c 11-19 宿主日志 seq4568）：摘要句 + 「Its closing message:」 + 收工汇报正文。
const notice = (from, body = `${from} 的收工汇报`, stopReason = 'completed') => ({
	role: 'user',
	content: [
		{ type: 'text', text: 'Background subagent agent-316 finished and will do no further work unless you send it more.' },
		{ type: 'text', text: 'Its closing message:' },
		{ type: 'text', text: `\n\n${body}` },
	],
	source: { kind: 'subagent-settled', form: 'notice', summary: 'Background subagent agent-316 finished and will do no further work unless you send it more.', stopReason, senderSessionId: from },
});
const say = (text) => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });
const fromMember = (from, text) => ({ role: 'user', content: [{ type: 'text', text: 'Agent agent-6 sent a message: ' }, { type: 'text', text }], source: { kind: 'agent-message', form: 'relay', senderSessionId: from } });
const context = { role: 'user', content: [{ type: 'text', text: '<system-reminder>…' }], source: { kind: 'runtime-context' } };
const agentOf = (id, events = []) => ({ id, session: { header: { id }, snapshotEvents: () => events } });
const collect = async (stream) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
const MODEL = Symbol('model');

function gate({ humanFails = false, memberFails = false } = {}) {
	const rows = [];
	const hooks = [];
	const forwardedHuman = [];
	const members = [];
	const g = registerHostSessionGate({
		on: (name, listener) => { hooks.push(name); return () => hooks.splice(hooks.indexOf(name), 1); },
		isHostSession: (id) => (id === HOST ? { projectId: 'prj_1' } : null),
		forwardHuman: async (projectId, text, attachments) => {
			if (humanFails) throw new Error('ledger closed');
			forwardedHuman.push(attachments.length > 0 ? [projectId, text, attachments] : [projectId, text]);
		},
		forwardMember: async (projectId, from, text) => {
			if (memberFails) throw new Error('no member');
			members.push([projectId, from, text]);
		},
		memberOf: (projectId, from) => ({ 'mem-a': { name: '墨渊', avatarUrl: 'C:/Users/me/.dsh/ai-team/avatars/ab12.svg' }, 'mem-b': { name: '玄策' } })[from] ?? null,
		diag: { append: (row) => rows.push(row) },
	});
	const run = (payload) => g.preStep(payload, () => Promise.resolve({ kind: 'enter', messages: payload.messages }));
	return { g, rows, hooks, human: forwardedHuman, members, run };
}

test('a host turn woken by member-settled notices shows each full closing report without a model request (il2c 11-19)', async () => {
	// il2c 11-17：宿主被「子智能体已完成」叫醒后自当 PMO（所以宿主模型不能跑）；
	// il2c 11-19：拒掉后宿主会话只剩一排「已完成，用时1秒」，成员写好的收工汇报全丢了。
	const { g, rows, hooks, human, members, run } = gate();
	assert.deepEqual(hooks, ['agent/pre-step', 'llm/stream']);
	const long = `## 六路 PMO 升级/巡检处置汇报\n\n${'逐卡决定。'.repeat(2000)}\n| 卡 | 决定 |\n|---|---|\n| #119 | 玄策重启 |`;
	const decision = await run({ agent: agentOf(HOST), messages: [notice('mem-a', long), notice('mem-b'), context], turn: 7, step: 1 });
	assert.equal(decision.kind, 'enter');
	assert.equal(decision.messages.length, 3, '新通知与运行时上下文照常入步，通知落进宿主会话');
	assert.deepEqual([human, members], [[], []]);
	assert.deepEqual(rows.map((row) => [row.ev, row.notices, row.replays]), [['host.turn.report', 2, 0]]);
	let modelCalled = false;
	const chunks = await collect(g.llmStream({ sessionId: HOST, messages: [] }, () => { modelCalled = true; return MODEL; }));
	assert.equal(modelCalled, false, '本步不发模型请求');
	const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
	assert.equal(text, `![墨渊](<C:/Users/me/.dsh/ai-team/avatars/ab12.svg>) **墨渊** 收工汇报（完成）\n\n${long}\n\n---\n\n**玄策** 收工汇报（完成）\n\nmem-b 的收工汇报`, '收工汇报全文，不截取');
	assert.deepEqual(chunks.at(-2), { type: 'block-end', index: 0, block: { type: 'text', text } });
	assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } });
	// 短路只用一次：同会话下一次调用、别的会话、辅助调用（压缩摘要等带 purpose）都照常走模型。
	assert.equal(g.llmStream({ sessionId: HOST }, () => MODEL), MODEL);
	g.dispose();
	assert.deepEqual(hooks, []);
});

test('notices replayed after a host restart are not shown again; a turn with only replays is rejected (il2c 11-19: 31 of 133)', async () => {
	const { g, rows, run } = gate();
	const earlier = notice('mem-a', '#124 已交单');
	const logged = [{ type: 'user/message', data: { role: 'user', content: earlier.content, source: earlier.source } }];
	const replayOnly = await run({ agent: agentOf(HOST, logged), messages: [notice('mem-a', '#124 已交单')], turn: 8, step: 1 });
	assert.equal(replayOnly.kind, 'reject');
	assert.deepEqual(rows.map((row) => [row.ev, row.notices, row.replays]), [['host.turn.blocked', 1, 1]]);
	const mixed = await run({ agent: agentOf(HOST, logged), messages: [notice('mem-a', '#124 已交单'), notice('mem-b', '新汇报'), notice('mem-b', '新汇报')], turn: 9, step: 1 });
	assert.equal(mixed.messages.length, 1, '同批同文只留一条');
	const text = (await collect(g.llmStream({ sessionId: HOST }, () => MODEL))).find((chunk) => chunk.type === 'text-delta').text;
	assert.equal(text, '**玄策** 收工汇报（完成）\n\n新汇报');
});

test('member lookup may be async (avatar library sync); if it throws the report still shows, headed by the subagent label', async () => {
	const rows = [];
	const g = registerHostSessionGate({
		isHostSession: () => ({ projectId: 'prj_1' }),
		forwardHuman: async () => {},
		forwardMember: async () => {},
		memberOf: async (projectId, from) => { if (from === 'bad') throw new Error('catalog broken'); return { name: '青岚', avatarUrl: 'C:/a/青岚.svg' }; },
		diag: { append: (row) => rows.push(row) },
	});
	await g.preStep({ agent: agentOf(HOST), messages: [notice('ok', '甲'), notice('bad', '乙')], turn: 1, step: 1 }, () => Promise.resolve({ kind: 'enter', messages: [notice('ok', '甲'), notice('bad', '乙')] }));
	const text = (await collect(g.llmStream({ sessionId: HOST }, () => MODEL))).find((chunk) => chunk.type === 'text-delta').text;
	assert.equal(text, '![青岚](<C:/a/青岚.svg>) **青岚** 收工汇报（完成）\n\n甲\n\n---\n\n**agent-316** 收工汇报（完成）\n\n乙');
	assert.ok(rows.some((row) => row.ev === 'host.report.member.fail'));
});

test('a notice with no closing message still says who settled and how; auxiliary calls are never short-circuited', async () => {
	const { g, run } = gate();
	const failed = { role: 'user', content: [{ type: 'text', text: 'Background subagent 16ad9d4d failed before it finished.' }, { type: 'text', text: 'It left no closing message.' }], source: { kind: 'subagent-settled', form: 'notice', summary: 'Background subagent 16ad9d4d failed before it finished.', stopReason: 'error', senderSessionId: 'unknown' } };
	assert.equal((await run({ agent: agentOf(HOST), messages: [failed], turn: 1, step: 1 })).kind, 'enter');
	assert.equal(g.llmStream({ sessionId: HOST, purpose: 'compaction' }, () => MODEL), MODEL);
	assert.equal(g.llmStream({ sessionId: 'member-1' }, () => MODEL), MODEL);
	const text = (await collect(g.llmStream({ sessionId: HOST }, () => MODEL))).find((chunk) => chunk.type === 'text-delta').text;
	assert.equal(text, '**16ad9d4d** 收工汇报（失败）\n\n（未留下收工汇报）');
});

test('what Human types in the host session goes to the project main conversation, and the host model stays quiet (il2c 11-17 16:33)', async () => {
	// il2c 11-17 16:33：Human 在「【il2c】文渊阁·PMO」里发「继续」，账本没有 Human 消息，
	// 自主预算的暂停不解除；宿主模型代办办不成，还让 Human「去点一下墨渊的席位」。
	const { rows, human, run } = gate();
	assert.equal((await run({ agent: agentOf(HOST), messages: [say('继续'), context], turn: 197, step: 1 })).kind, 'reject');
	// 夹着新通知时：Human 的话照样转走、不进宿主模型历史，只有通知入步呈现。
	const decision = await run({ agent: agentOf(HOST), messages: [say('继续'), context, notice('mem-a')], turn: 198, step: 1 });
	assert.equal(decision.kind, 'enter');
	assert.deepEqual(decision.messages.map((message) => message.source.kind), ['runtime-context', 'subagent-settled']);
	assert.deepEqual(human, [['prj_1', '继续'], ['prj_1', '继续']]);
	assert.deepEqual(rows.map((row) => [row.ev, row.human, row.notices]), [['host.turn.blocked', 1, 0], ['host.turn.report', 1, 1]]);
});

test('a member writing to the host is relayed to the main conversation as that member (r38 E2E)', async () => {
	// r38：观澜用 send_message 向宿主汇报「请主理人按目标开单」，宿主模型被叫醒。
	const { rows, members, run } = gate();
	const decision = await run({ agent: agentOf(HOST), messages: [fromMember('sess-biz', '状态核实完毕，随时可领新 Task')], turn: 2, step: 1 });
	assert.equal(decision.kind, 'reject');
	assert.deepEqual(members, [['prj_1', 'sess-biz', '状态核实完毕，随时可领新 Task']]);
	assert.equal(rows[0].members, 1);
});

test('a failed Human forward lets the host model answer instead of losing what Human said; a failed member relay is logged', async () => {
	const failedHuman = gate({ humanFails: true });
	assert.equal((await failedHuman.run({ agent: agentOf(HOST), messages: [say('继续')], turn: 1, step: 1 })).kind, 'enter');
	assert.equal(failedHuman.rows[0].ev, 'host.human.forward.fail');
	const failedMember = gate({ memberFails: true });
	assert.equal((await failedMember.run({ agent: agentOf(HOST), messages: [fromMember('x', 'hi')], turn: 1, step: 1 })).kind, 'reject');
	assert.deepEqual(failedMember.rows.map((row) => row.ev), ['host.member.forward.fail', 'host.turn.blocked']);
});

test('images and files Human pastes into the DSH standard session reach the main conversation with the text (#65)', async () => {
	// #65：DSH 标准会话输入框能贴图/拖文件，0.4.119 只转文字，附件在转发时丢了。
	const { human, run } = gate();
	const image = { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 10, width: 4, height: 3 } };
	const file = { type: 'file', attachment: { attachmentId: 'f-1', bytes: 20, name: 'spec.pdf' } };
	const withText = { role: 'user', content: [{ type: 'text', text: '@玄策 看下这张图' }, image, file], source: { kind: 'user' } };
	const imageOnly = { role: 'user', content: [image], source: { kind: 'user' } };
	assert.equal((await run({ agent: agentOf(HOST), messages: [withText, imageOnly], turn: 3, step: 1 })).kind, 'reject');
	assert.deepEqual(human, [['prj_1', '@玄策 看下这张图', [image, file]], ['prj_1', '', [image]]]);
});

test('the gate leaves member sessions and later steps alone', async () => {
	const { rows, human, members, run } = gate();
	assert.equal((await run({ agent: agentOf('member-1'), messages: [say('你好'), notice('x'), fromMember('y', 'hi')], turn: 1, step: 1 })).kind, 'enter');
	assert.equal((await run({ agent: agentOf(HOST), messages: [say('补一句')], turn: 1, step: 2 })).kind, 'enter');
	assert.deepEqual([human, members, rows], [[], [], []]);
});

test('index.js registers the gate for project host sessions, forwards through stream.post as Human or as the sending member, and disposes it', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	const start = index.indexOf('registerHostSessionGate({');
	const wiring = index.slice(start, start + 4000);
	assert.match(wiring, /runtime\.service\.state\.hostSessionId === sessionId\) return \{ projectId: runtime\.id \}/);
	assert.match(wiring, /type: 'stream\.post', payload: \{ body, \.\.\.\(refs\.length > 0 \? \{ attachments: refs \} : \{\}\) \}, actor: \{ kind: 'human', memberId: HUMAN_ID \}/);
	assert.match(wiring, /entry\?\.sessionId === senderSessionId/);
	assert.match(wiring, /actor: \{ kind: 'agent', memberId: member\.id \}/);
	assert.match(wiring, /memberOf: async \(projectId, senderSessionId\) =>/);
	assert.match(wiring, /await avatarLib\.ready\(5000\);/, '头像库懒同步：先等一次，否则新装机第一份汇报没有头像（r41 第二轮）');
	assert.match(wiring, /avatarFile\(dshHome\(\), member\.name, member\.avatar \?\? talent\?\.avatar \?\? null\)/);
	assert.match(index, /hostSessionGate\.dispose\(\);/);
});
