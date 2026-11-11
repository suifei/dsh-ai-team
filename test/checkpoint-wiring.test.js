/**
 * Checkpoint wiring tests: boot floor, periodic+close saves, lazy events,
 * corruption fallback and the projection tail caps (stream/threads).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { FOLD_STATE_VERSION, STREAM_TAIL_LIMIT, THREAD_ENTRIES_LIMIT } from '../lib/ledger/fold.js';
import { openLedger } from '../lib/ledger/writer.js';

const STREAM_DRAFT = (i) => ({
	type: 'stream/posted',
	actor: { kind: 'human', memberId: 'mem_human' },
	payload: { body: `message ${i}` },
});

test('checkpoint: saveEvery writes floors, reopen replays nothing, lazy events read on demand', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-ckpt-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, 'ledger');
	{
		const ledger = openLedger({ dir, projectId: 'prj_ckpt', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 50 } });
		for (let i = 0; i < 60; i++) await ledger.append(STREAM_DRAFT(i));
		// saveEvery 钳底 50：追加到第 50 条时落一次地板（防抖下限）。
		assert.ok(existsSync(join(dir, 'checkpoint.json')));
		const saved = JSON.parse(await readFile(join(dir, 'checkpoint.json'), 'utf8'));
		assert.equal(saved.stateVersion, FOLD_STATE_VERSION);
		assert.equal(saved.lastSeq, 50);
		ledger.close();
	}
	{
		// 齐平重开：close 已落 seq 60 的地板 → 零尾放，惰性 events 仍读全史。
		const ledger = openLedger({ dir, projectId: 'prj_ckpt', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 50 } });
		assert.equal(ledger.recovery.source, 'primary');
		assert.equal(ledger.recovery.tailReplayed, 0);
		assert.equal(ledger.state.stream.length, 60);
		assert.equal(ledger.state.streamTotal, 60);
		assert.equal(ledger.events.length, 60, 'lazy events materialize the full history');
		// 追加后 events 继续追加、检查点在 close 落盘齐平。
		await ledger.append(STREAM_DRAFT(99));
		assert.equal(ledger.events.length, 61);
		ledger.close();
		const saved = JSON.parse(await readFile(join(dir, 'checkpoint.json'), 'utf8'));
		assert.equal(saved.lastSeq, 61);
	}
	{
		// 再开一次：地板已含 61 条 → 仍零尾放。
		const ledger = openLedger({ dir, projectId: 'prj_ckpt', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 50 } });
		assert.equal(ledger.recovery.source, 'primary');
		assert.equal(ledger.recovery.tailReplayed, 0);
		ledger.close();
	}
});

test('checkpoint: corrupt file falls back to full replay with identical state', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-ckpt-bad-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, 'ledger');
	{
		const ledger = openLedger({ dir, projectId: 'prj_bad', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 10 } });
		for (let i = 0; i < 5; i++) await ledger.append(STREAM_DRAFT(i));
		ledger.close();
	}
	await readFile(join(dir, 'checkpoint.json'), 'utf8');
	{
		const { writeFile } = await import('node:fs/promises');
		await writeFile(join(dir, 'checkpoint.json'), '{ not json', 'utf8');
	}
	const ledger = openLedger({ dir, projectId: 'prj_bad', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 10 } });
	try {
		// primary 已损坏 → 回退到 saveCheckpoint 备份过的上一份有效检查点。
		assert.equal(ledger.recovery.source, 'backup');
		assert.equal(ledger.state.streamTotal, 5);
		assert.equal(ledger.state.stream.length, 5);
		// 恢复后立即落一份干净地板。
		const saved = JSON.parse(await readFile(join(dir, 'checkpoint.json'), 'utf8'));
		assert.equal(saved.lastSeq, 5);
	} finally {
		ledger.close();
	}
});

test('fold caps: stream and thread entries stay bounded while headSeq/counts stay exact', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-cap-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, 'ledger');
	const ledger = openLedger({ dir, projectId: 'prj_cap', fsync: false });
	try {
		await ledger.append({
			type: 'project/member-added', actor: { kind: 'human', memberId: 'h1' },
			payload: { id: 'h1', name: 'Human', kind: 'human' },
		});
		await ledger.append({
			type: 'project/created', actor: { kind: 'human', memberId: 'h1' },
			payload: { id: 'prj_cap', name: 'Cap' },
		});
		const created = await ledger.append({
			type: 'task/created', actor: { kind: 'human', memberId: 'h1' }, projectId: 'prj_cap',
			payload: { id: 'tsk_cap1', title: '长讨论', resultDefinition: 'done', ownerId: 'h1' },
		});
		assert.equal(created.type, 'task/created');
		const taskId = Object.keys(ledger.state.tasks).at(-1);
		assert.equal(taskId, 'tsk_cap1');
		const total = STREAM_TAIL_LIMIT + 40;
		for (let i = 0; i < total; i++) {
			await ledger.append({ ...STREAM_DRAFT(i), projectId: 'prj_cap' });
			await ledger.append({
				type: 'thread/posted', actor: { kind: 'human', memberId: 'h1' }, projectId: 'prj_cap',
				payload: { taskId, entry: { seq: i + 1, authorId: 'h1', body: `reply ${i}`, at: Date.now() } },
			});
		}
		const state = ledger.state;
		assert.equal(state.streamTotal, total, 'total counter stays exact');
		assert.equal(state.stream.length, STREAM_TAIL_LIMIT, 'stream projection is capped');
		// stream 与 thread 事件交错追加：最新 stream 条目是倒数第二个账本事件。
		assert.equal(state.stream.at(-1).seq, state.lastSeq - 1, 'capped tail keeps the newest entries');
		const thread = state.threads[taskId];
		assert.equal(thread.headSeq, total, 'thread headSeq stays exact');
		assert.equal(thread.entries.length, THREAD_ENTRIES_LIMIT, 'thread entries are capped');
		assert.equal(thread.entries.at(-1).seq, total, 'capped thread keeps the newest entries');
	} finally {
		ledger.close();
	}
});

test('events stay unique when appends happen before the first events read', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-dup-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dir = join(root, 'ledger');
	{
		const ledger = openLedger({ dir, projectId: 'prj_dup', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 1000 } });
		for (let i = 0; i < 3; i++) await ledger.append(STREAM_DRAFT(i));
		ledger.close();
	}
	{
		// 重开时检查点与账本齐平 → events 惰性为 null。若先 append 后 readAll，
		// 刚写入的事件会被读出来再 push 一次（seq 会出现 1,2,3,3,4）。
		const ledger = openLedger({ dir, projectId: 'prj_dup', fsync: false, checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 1000 } });
		await ledger.append(STREAM_DRAFT(9));
		await ledger.append(STREAM_DRAFT(10));
		const seqs = ledger.events.map((event) => event.seq);
		assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
		assert.equal(new Set(ledger.events.map((event) => event.id)).size, 5);
		ledger.close();
	}
});
