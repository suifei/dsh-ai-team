import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';

// Issue #1 回归：一句「在吗」之后团队无上限地自拟下一批 Task，跑了 7 小时。
// 有界自主：一「轮」= 看板清空后成员开出的新一批 Task（PMO 定时推进与主理人回收结果后
// 自己续开同一口径）。Human 每次操作后的第一批是 Human 指令本身，不计轮；之后最多 cap 批。
// r06b 实测：只闸 pmo_continue 时，主理人在暂停后 4 秒自己续开了 C1/C2/C4。

const human = { kind: 'human', memberId: 'h1' };
const lead = { kind: 'agent', memberId: 'a1' };

async function withService({ cap = 1 } = {}, run) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-pmo-rounds-'));
	const dir = join(root, 'ledger');
	let ledger = openLedger({ dir, projectId: 'prj_r', fsync: false });
	const reopen = () => {
		ledger.close();
		ledger = openLedger({ dir, projectId: 'prj_r', fsync: false });
		return new TeamService({ ledger, pmoMaxRounds: cap });
	};
	try {
		const service = new TeamService({ ledger, pmoMaxRounds: cap });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: 'Lead', kind: 'agent' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'R', ownerId: 'a1' } });
		await run(service, reopen);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
}

let serial = 0;
/** 成员开一批（一张卡）再自己取消，使看板回到空闲。 */
async function leadWave(service) {
	serial += 1;
	const created = await service.dispatch({
		type: 'task.create', actor: lead, projectId: 'prj_r',
		payload: { title: `T${serial}`, resultDefinition: 'done', ownerId: 'a1' },
	});
	await service.dispatch({ type: 'task.cancel', actor: lead, projectId: 'prj_r', payload: { taskId: created.task.id, reason: 'wave done' } });
	return created;
}

const pauseNotes = (service) => service.state.stream.filter((entry) => entry.authorId === 'mem_pmo');

test('after one Human action the first wave is free, then exactly cap waves, then E_PMO_PAUSED', async () => {
	await withService({ cap: 2 }, async (service) => {
		await leadWave(service); // Human 指令那一批
		assert.equal(service.state.pmoRoundsUsed ?? 0, 0);
		await leadWave(service);
		await leadWave(service);
		assert.equal(service.state.pmoRoundsUsed, 2);
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		const notes = pauseNotes(service);
		assert.equal(notes.length, 1, 'the pause is announced exactly once');
		assert.equal(notes[0].kind, 'milestone', 'a PMO note must never look like a Human instruction');
		assert.match(notes[0].body, /暂停/);
	});
});

test('a busy board is one wave: more cards in the same wave never consume a round', async () => {
	await withService({ cap: 0 }, async (service) => {
		const first = await service.dispatch({ type: 'task.create', actor: lead, projectId: 'prj_r', payload: { title: 'A', resultDefinition: 'x', ownerId: 'a1' } });
		await service.dispatch({ type: 'task.create', actor: lead, projectId: 'prj_r', payload: { title: 'B', resultDefinition: 'x', ownerId: 'a1' } });
		await service.dispatch({ type: 'task.create', actor: lead, projectId: 'prj_r', payload: { title: 'C', resultDefinition: 'x', ownerId: 'a1' } });
		assert.equal(service.state.pmoRoundsUsed ?? 0, 0);
		assert.ok(first.task.id);
	});
});

test('the PMO timer and the lead share one budget: pmoGate refuses once waves are used up', async () => {
	await withService({ cap: 1 }, async (service) => {
		assert.equal((await service.pmoGate('prj_r')).admitted, true, 'free wave still unused');
		await leadWave(service);
		assert.equal((await service.pmoGate('prj_r')).admitted, true, 'one autonomous wave left');
		await leadWave(service);
		const gate = await service.pmoGate('prj_r');
		assert.equal(gate.admitted, false);
		assert.equal(gate.announcedNow, true);
		assert.equal((await service.pmoGate('prj_r')).announcedNow, false, 'silent after the first notice');
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		assert.equal(pauseNotes(service).length, 1);
	});
});

test('only a Human action renews the budget; agent stream posts do not', async () => {
	await withService({ cap: 0 }, async (service) => {
		await leadWave(service);
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		await service.dispatch({ type: 'stream.post', actor: lead, payload: { body: '我继续了' } });
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		await service.dispatch({ type: 'stream.post', actor: human, payload: { body: '用 js 写 3 种排序算法' } });
		await leadWave(service);
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		assert.equal(pauseNotes(service).length, 2, 'each renewed budget announces its own pause once');
	});
});

test('Human-created tasks are never refused', async () => {
	await withService({ cap: 0 }, async (service) => {
		await leadWave(service);
		await assert.rejects(() => leadWave(service), (error) => error.code === 'E_PMO_PAUSED');
		const created = await service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_r', payload: { title: 'H', resultDefinition: 'x', ownerId: 'a1' } });
		assert.equal(created.task.status, 'pending');
	});
});

test('the budget survives a host restart (folded from the ledger)', async () => {
	await withService({ cap: 1 }, async (service, reopen) => {
		await leadWave(service);
		await leadWave(service);
		const restarted = reopen();
		assert.equal(restarted.state.pmoRoundsUsed, 1);
		assert.equal(restarted.state.pmoFreeWave, false);
		await assert.rejects(() => leadWave(restarted), (error) => error.code === 'E_PMO_PAUSED');
	});
});
