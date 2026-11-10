/**
 * Concurrency regression for checkpoint wiring: interleaved append batches
 * must never persist a checkpoint whose state lags its lastSeq ("silent
 * projection loss" on crash-reopen). The watermark is the fold-applied
 * prefix (state.lastSeq), not writer.head.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLD_STATE_VERSION } from '../lib/ledger/fold.js';
import { openLedger } from '../lib/ledger/writer.js';

const DRAFT = (i) => ({
	type: 'stream/posted',
	actor: { kind: 'human', memberId: 'mem_human' },
	payload: { body: `m${i}` },
});

test('interleaved batches: checkpoint state never lags its own lastSeq after crash-reopen', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-ckpt-race-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, 'ledger');
	{
		const ledger = openLedger({
			dir, projectId: 'prj_race', fsync: false,
			checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 50 },
		});
		// 三批并发（各 20 条）：B 可在 A 的 facade 续体推进 state 之前提交
		// （写队列只串行化批次本身）；累计 60 条 ≥ saveEvery 50 → 批间触发
		// 周期保存，正是竞态窗口。旧实现按 writer.head 落盘 → lastSeq=60 而
		// state 可能停在 40。
		await Promise.all([
			ledger.appendMany(Array.from({ length: 20 }, (_, i) => DRAFT(i + 100))),
			ledger.appendMany(Array.from({ length: 20 }, (_, i) => DRAFT(i + 200))),
			ledger.appendMany(Array.from({ length: 20 }, (_, i) => DRAFT(i + 300))),
		]);
		// 模拟崩溃：不调用 close，直接丢弃实例重开（lock:false 模拟陈旧锁接管）。
	}
	const reopened = openLedger({
		dir, projectId: 'prj_race', fsync: false, lock: false,
		checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 5 },
	});
	try {
		const saved = JSON.parse(await readFile(join(dir, 'checkpoint.json'), 'utf8'));
		// 水位语义：检查点的 lastSeq 与其携带的 state 自洽。
		assert.equal(saved.lastSeq, saved.state.lastSeq, 'checkpoint watermark == state progress');
		// 齐平判定不会采信落后快照：尾部被真实重放。
		const head = reopened.headSeq;
		if (saved.lastSeq === head) {
			assert.equal(reopened.recovery.tailReplayed, 0);
		} else {
			assert.ok(reopened.recovery.tailReplayed > 0, 'stale checkpoint triggers a real tail replay');
		}
		// 关键不变量：重开后的投影必须包含账本全部事件（无静默丢失）。
		assert.equal(reopened.state.streamTotal, head, 'reopened projection covers every ledger event');
		assert.equal(reopened.state.stream.length, Math.min(500, head));
	} finally {
		reopened.close();
	}
});
