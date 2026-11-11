/**
 * Human↔成员对话门（项目级开关）测试：
 * - open（默认）：member.message 正常投递并唤醒成员
 * - closed：member.message 被正常人话拒绝（不产生事件、不唤醒）
 * - project.chatGate 切换留痕（账本事件 + fold 投影）且 Human-only
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeamService } from '../lib/host/service.js';
import { openLedger } from '../lib/ledger/writer.js';
import { planWakes } from '../lib/host/waker.js';

const PROJECT_ID = 'prj_gate';
const BASE_AT = 1_700_000_000_000;

function tempLedger(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-gate-'));
	t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
	return { dir };
}

test('chat gate: open by default, closed rejects DMs with a plain-language error, toggle leaves a ledger trail', async (t) => {
	const { dir } = tempLedger(t);
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const service = new TeamService({ ledger, now: () => BASE_AT });
	const human = { kind: 'human', memberId: 'h1' };

	await service.dispatch({ type: 'project.create', actor: human, payload: { id: PROJECT_ID, name: 'P', goal: 'g', ownerId: 'h1' } });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: '青岚', role: '执行' } });

	// 默认 open：私信正常投递并产生 member_message 唤醒。
	const sent = await service.dispatch({ type: 'member.message', actor: human, projectId: PROJECT_ID, payload: { memberId: 'a1', body: '优先处理高风险项' } });
	assert.equal(sent.event.type, 'member/message');
	const wakes = planWakes(ledger.state, { event: sent.event }, { agentId: 'h1' });
	assert.ok(wakes.some((w) => w.memberId === 'a1' && w.reason === 'member_message'), 'DM must wake the member next round');

	// 关门：Human-only 切换 + member.message 被正常人话拒绝。
	await service.dispatch({ type: 'project.chatGate', actor: human, projectId: PROJECT_ID, payload: { gate: 'closed' } });
	assert.equal(ledger.state.projects[PROJECT_ID].chatGate, 'closed');
	await assert.rejects(
		() => service.dispatch({ type: 'member.message', actor: human, projectId: PROJECT_ID, payload: { memberId: 'a1', body: '还在吗' } }),
		(error) => {
			assert.match(String(error.message), /Human 对话通道已由项目设置关闭/);
			return true;
		},
		'closed gate must reject DMs with a plain-language message',
	);
	const eventsAfterClose = ledger.state.lastSeq;

	// agent 也不能动门；非法值被拒。
	await assert.rejects(() => service.dispatch({ type: 'project.chatGate', actor: { kind: 'agent', memberId: 'a1' }, projectId: PROJECT_ID, payload: { gate: 'open' } }));
	await assert.rejects(() => service.dispatch({ type: 'project.chatGate', actor: human, projectId: PROJECT_ID, payload: { gate: 'whatever' } }));

	// 重新开门：私信恢复。
	await service.dispatch({ type: 'project.chatGate', actor: human, projectId: PROJECT_ID, payload: { gate: 'open' } });
	assert.equal(ledger.state.projects[PROJECT_ID].chatGate, 'open');
	const sentAgain = await service.dispatch({ type: 'member.message', actor: human, projectId: PROJECT_ID, payload: { memberId: 'a1', body: '继续' } });
	assert.ok(sentAgain.event.seq > eventsAfterClose);
});

test('bootstrap exposes chatGate per project (default open)', async (t) => {
	const { dir } = tempLedger(t);
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const service = new TeamService({ ledger, now: () => BASE_AT });
	const human = { kind: 'human', memberId: 'h1' };
	await service.dispatch({ type: 'project.create', actor: human, payload: { id: PROJECT_ID, name: 'P', goal: 'g', ownerId: 'h1' } });
	assert.equal(service.bootstrap(PROJECT_ID).project.chatGate, 'open', 'gate defaults to open');
	await service.dispatch({ type: 'project.chatGate', actor: human, projectId: PROJECT_ID, payload: { gate: 'closed' } });
	assert.equal(service.bootstrap(PROJECT_ID).project.chatGate, 'closed', 'bootstrap reflects the closed gate');
});
