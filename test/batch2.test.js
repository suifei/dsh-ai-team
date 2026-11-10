/**
 * Batch-2 tests: weekly dual-reading projection, member load counters,
 * person alias aggregation and the ledger porcelain (audit/stats/export).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { aggregatePeople } from '../lib/host/people-view.js';
import { weeklyView } from '../lib/host/weekly-view.js';
import { auditLedger, statsLedger, exportLedger } from '../lib/ledger/tools.js';
import { openLedger } from '../lib/ledger/writer.js';

const DAY = 24 * 60 * 60 * 1000;

function fakeRuntime(id, projectName, { members = [], tasks = [], threads = {}, inbox = [], humanMemberId = 'h1' } = {}) {
	return {
		id,
		service: {
			humanId: () => humanMemberId,
			state: {
				lastSeq: 9,
				humanMemberId,
				members: Object.fromEntries(members.map((member) => [member.id, member])),
				tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
				threads,
				inbox: Object.fromEntries(inbox.map((item) => [item.id, item])),
			},
		},
	};
}

test('weekly view: window counters and dual reading data faces', () => {
	const now = Date.now();
	const state = {
		lastSeq: 40,
		humanMemberId: 'h1',
		members: { h1: { id: 'h1', name: '你', kind: 'human' } },
		tasks: {
			done: { id: 't1', number: 1, title: '完成', ownerId: 'h1', status: 'done', reviewRound: 1, updatedAt: now - DAY, createdAt: now - 6 * DAY, tombstone: false },
			rework: { id: 't2', number: 2, title: '返工两次', ownerId: 'h1', status: 'in_progress', reviewRound: 2, updatedAt: now - 2 * DAY, createdAt: now - 6 * DAY, tombstone: false },
			old: { id: 't3', number: 3, title: '窗口外完成', ownerId: 'h1', status: 'done', reviewRound: 1, updatedAt: now - 20 * DAY, createdAt: now - 30 * DAY, tombstone: false },
		},
		threads: {
			t1: { taskId: 't1', headSeq: 2, entries: [
				{ seq: 1, authorId: 'a1', body: '认领了', at: now - 5 * DAY },
				{ seq: 2, authorId: 'h1', body: '验收意见', at: now - DAY },
			] },
		},
		inbox: {
			d1: { id: 'd1', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'done', ackedAt: now - DAY },
		},
	};
	const view = weeklyView({ ...state }, { now, weeks: 1 });
	assert.equal(view.completedCount, 1, 'only in-window completions');
	assert.equal(view.createdCount, 2, 'tasks created within the window');
	assert.equal(view.reworkedCount, 1);
	assert.equal(view.humanThreadMessages, 1);
	assert.equal(view.decisionsAnswered, 1);
	assert.equal(view.positive.completedTitles[0], '#1 完成');
	assert.equal(view.negative.reworkedTitles[0], '#2 返工两次');
	assert.equal(view.negative.humanTasks, 1, 't2 is the only active task owned by Human');
});

test('people view: alias buckets merge different names into one person row with load counters', () => {
	const registry = [{ id: 'p1', name: '项目A' }];
	const runtime = fakeRuntime('p1', '项目A', {
		members: [
			{ id: 'a1', name: '青岚', kind: 'agent', role: '执行', status: 'running' },
			{ id: 'a2', name: 'Qing Lan', kind: 'agent', role: '执行', status: 'running' },
		],
		tasks: [
			{ id: 't1', status: 'in_progress', ownerId: 'a1', assigneeId: 'a1', blockedBy: [], blocked: false, tombstone: false },
			{ id: 't2', status: 'pending_acceptance', ownerId: 'a1', assigneeId: null, blockedBy: [], tombstone: false },
			{ id: 't3', status: 'pending', ownerId: 'a2', assigneeId: null, blockedBy: ['t_missing'], blocked: true, tombstone: false },
		],
	});
	const merged = aggregatePeople(registry, [runtime], { aliases: { 'Qing Lan': 'person_qinglan', '青岚': 'person_qinglan' } });
	assert.equal(merged.length, 1, 'alias binding merges two names into one person row');
	assert.equal(merged[0].activeTasks, 4, 'a1 (3) + a2 (1) after merge');
	assert.equal(merged[0].projects.length, 1, 'same project, two member ids merged by person');
	assert.equal(merged[0].projects[0].inProgress, 2, 't1 counts twice: owner + assignee positions');
	assert.equal(merged[0].projects[0].pendingAcceptance, 1);
	assert.equal(merged[0].projects[0].pending, 1);
	assert.equal(merged[0].projects[0].blocked, 1);
	// 未绑定 → 回落同名聚合（两行）。
	const unmerged = aggregatePeople(registry, [runtime]);
	assert.equal(unmerged.length, 2);
});

test('ledger porcelain: audit/stats/export on a real ledger', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-porcelain-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, 'ledger');
	{
		const ledger = openLedger({ dir, projectId: 'prj_tools', fsync: false });
		for (let i = 0; i < 6; i++) {
			await ledger.append({ type: 'stream/posted', actor: { kind: 'human', memberId: 'h1' }, payload: { body: 'm' + i } });
		}
		ledger.close();
	}
	const audit = auditLedger(dir);
	assert.equal(audit.ok, true);
	assert.equal(audit.eventCount, 6);
	const stats = statsLedger(dir);
	assert.equal(stats.eventCount, 6);
	assert.equal(stats.headSeq, 6);
	const outDir = join(root, 'export');
	const exported = exportLedger(dir, outDir);
	assert.equal(exported.ok, true);
	assert.deepEqual(exported.files.sort(), ['ledger-000001.jsonl', 'manifest.json', 'verify-report.md'].sort());
	const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
	assert.equal(manifest.eventCount, 6);
	assert.equal(manifest.verify.ok, true);
	const report = await readFile(join(outDir, 'verify-report.md'), 'utf8');
	assert.match(report, /hash chain: \*\*OK\*\*/);
});

test('ledger CLI audit exits non-zero on a broken chain', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-cli-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, 'ledger');
	{
		const ledger = openLedger({ dir, projectId: 'prj_cli', fsync: false });
		await ledger.append({ type: 'stream/posted', actor: { kind: 'human', memberId: 'h1' }, payload: { body: 'one' } });
		ledger.close();
	}
	const ledgerFile = join(dir, 'ledger-000001.jsonl');
	const original = await readFile(ledgerFile, 'utf8');
	// 篡改正文（不改 hash）→ audit 必须失败。
	await writeFile(ledgerFile, original.replace('"body":"one"', '"body":"tampered"'), 'utf8');
	let code = 0;
	try {
		execFileSync(process.execPath, ['bin/ledger-tools.mjs', 'audit', dir], { stdio: 'pipe' });
	} catch (error) {
		code = error.status ?? 1;
	}
	assert.notEqual(code, 0, 'tampered ledger must fail the audit exit code');
});
