import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repairArchivedHosts, repairOnce } from '../lib/runtime/host-repair.js';

/** A runtime whose member sessions hang from a host Session. */
function runtimeWith(hostSessionId, memberSessionIds) {
	return {
		service: {
			state: {
				hostSessionId,
				members: Object.fromEntries(memberSessionIds.map((id, index) => [`mem_${index}`, { id: `mem_${index}`, sessionId: id }])),
			},
		},
	};
}

test('unarchives the host that a member lineage hangs from', async () => {
	const unarchived = [];
	const diag = [];
	const repaired = await repairArchivedHosts({
		runtimes: [runtimeWith(undefined, ['m1'])],
		sessions: { get: () => ({ header: { id: 'm1', origin: 'subagent', parentSession: 'host-1' } }) },
		workspaceRegistry: { unarchiveSession: async (id) => { unarchived.push(id); } },
		diag: { append: (row) => diag.push(row) },
	});
	// 成员会话本身也在 victims 里：它可能被单独归档。
	assert.deepEqual(repaired, ['m1', 'host-1']);
	assert.deepEqual(unarchived, ['m1', 'host-1']);
});

test('asks for the persisted host too and never touches unrelated sessions', async () => {
	const unarchived = [];
	const repaired = await repairArchivedHosts({
		runtimes: [runtimeWith('host-2', [])],
		sessions: { get: () => ({ header: { parentSession: 'host-5' } }) },
		workspaceRegistry: { unarchiveSession: async (id) => { unarchived.push(id); } },
	});
	// 只对「本插件知道是父会话」的 id 动手；unarchiveSession 对未归档 id 是 no-op，
	// 因此不需要先读 archivedSessionIds（那属于未文档化 API）。
	assert.deepEqual(repaired.sort(), ['host-2']);
	assert.deepEqual(unarchived, ['host-2']);
});

test('defers instead of giving up when the registry is not active yet', async () => {
	// workspaceRegistry 要等 sessionPersistence 与历史 bootstrap 才 active；
	// 返回 null 让调用方保持「未修复」并在下一个 tick 重试。
	assert.equal(await repairArchivedHosts({
		runtimes: [runtimeWith('host-3', [])],
		workspaceRegistry: {},
	}), null);
});

test('a failing unarchive is reported and the sweep keeps going', async () => {
	const diag = [];
	const repaired = await repairArchivedHosts({
		runtimes: [runtimeWith('host-4', ['m4'])],
		sessions: { get: () => ({ header: { parentSession: 'host-5' } }) },
		workspaceRegistry: {
			unarchiveSession: async (id) => { if (id === 'host-4') throw new Error('registry busy'); },
		},
		diag: { append: (row) => diag.push(row) },
	});
	assert.deepEqual(repaired, ['m4', 'host-5']);
	assert.equal(diag.some((row) => row.ev === 'host.unarchive.fail' && row.sessionId === 'host-4'), true);
});

test('the success row survives the shipped errors level', async () => {
	// 发布默认 level=errors 只保留白名单事件。若 `host.repair.ok` 不在白名单，
	// 「归档修复到底跑没跑」永远无法从日志判定（实机只有 boot 那一行 deferred.fail）。
	const { isErrorEvent } = await import('../lib/diaglog.js');
	assert.equal(isErrorEvent('host.repair.ok'), true);
	assert.equal(isErrorEvent('host.unarchive.fail'), true);
});


test('concurrent repair calls share one run; a run that did not finish the repair is retried next time (il2c hot reload: 3 × host.repair.ok)', async () => {
	let runs = 0;
	let done = false;
	let release;
	const gate = repairOnce(async () => { runs += 1; await new Promise((resolve) => { release = resolve; }); }, () => done);
	const calls = [gate(), gate(), gate()];
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runs, 1, '并发三路只跑一次');
	release();
	await Promise.all(calls);
	// 第一次没修成（registry 未就绪，done 仍为 false）：下一次调用重跑。
	const retry = gate();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runs, 2);
	done = true;
	release();
	await retry;
	await gate();
	assert.equal(runs, 2, '修好后不再跑');
});

test('index.js routes every repair call through repairOnce', () => {
	const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	assert.match(index, /const repairArchivedHosts = repairOnce\(async \(\) => \{/);
	assert.match(index, /\}, \(\) => hostRepaired\);/);
});
