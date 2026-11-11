import test from 'node:test';
import assert from 'node:assert/strict';
import { repairArchivedHosts } from '../lib/runtime/host-repair.js';

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
