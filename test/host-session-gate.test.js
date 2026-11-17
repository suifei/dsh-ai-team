import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHostSessionGate } from '../lib/runtime/host-session-gate.js';

const HOST = 'session-team-host-1';
const notice = (from) => ({ role: 'user', content: [{ type: 'text', text: 'Background subagent agent-1 finished' }], source: { kind: 'subagent-settled', form: 'notice', senderSessionId: from } });
const say = (text) => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } });
const fromMember = (from, text) => ({ role: 'user', content: [{ type: 'text', text: 'Agent agent-6 sent a message: ' }, { type: 'text', text }], source: { kind: 'agent-message', form: 'relay', senderSessionId: from } });
const context = { role: 'user', content: [{ type: 'text', text: '<system-reminder>…' }], source: { kind: 'runtime-context' } };
const agentOf = (id) => ({ id, session: { header: { id } } });

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
		diag: { append: (row) => rows.push(row) },
	});
	const run = (payload) => g.preStep(payload, () => Promise.resolve({ kind: 'enter', messages: payload.messages }));
	return { g, rows, hooks, human: forwardedHuman, members, run };
}

test('a host turn woken by member-settled notices is rejected without a model request (il2c 11-17)', async () => {
	// il2c 11-17：宿主被「子智能体已完成」叫醒后自当 PMO，send_message 催成员撞 NOT_RESUMABLE。
	const { g, rows, hooks, human, members, run } = gate();
	assert.deepEqual(hooks, ['agent/pre-step']);
	const decision = await run({ agent: agentOf(HOST), messages: [notice('mem-a'), notice('mem-b')], turn: 7, step: 1 });
	assert.equal(decision.kind, 'reject');
	assert.deepEqual([human, members], [[], []]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].ev, 'host.turn.blocked');
	assert.equal(rows[0].notices, 2);
	g.dispose();
	assert.deepEqual(hooks, []);
});

test('what Human types in the host session goes to the project main conversation, and the host model stays quiet (il2c 11-17 16:33)', async () => {
	// il2c 11-17 16:33：Human 在「【il2c】文渊阁·PMO」里发「继续」，账本没有 Human 消息，
	// 自主预算的暂停不解除；宿主模型代办办不成，还让 Human「去点一下墨渊的席位」。
	const { rows, human, run } = gate();
	const decision = await run({ agent: agentOf(HOST), messages: [say('继续'), context, notice('mem-a')], turn: 198, step: 1 });
	assert.equal(decision.kind, 'reject');
	assert.deepEqual(human, [['prj_1', '继续']]);
	assert.deepEqual(rows.map((row) => [row.ev, row.human, row.notices]), [['host.turn.blocked', 1, 1]]);
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
	const wiring = index.slice(start, start + 2000);
	assert.match(wiring, /runtime\.service\.state\.hostSessionId === sessionId\) return \{ projectId: runtime\.id \}/);
	assert.match(wiring, /type: 'stream\.post', payload: \{ body, \.\.\.\(refs\.length > 0 \? \{ attachments: refs \} : \{\}\) \}, actor: \{ kind: 'human', memberId: HUMAN_ID \}/);
	assert.match(wiring, /entry\?\.sessionId === senderSessionId/);
	assert.match(wiring, /actor: \{ kind: 'agent', memberId: member\.id \}/);
	assert.match(index, /hostSessionGate\.dispose\(\);/);
});
