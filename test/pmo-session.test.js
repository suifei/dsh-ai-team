import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';

// Core model: one PMO session per project; members are its children. When a
// project gets a new PMO session (legacy shared host, or a host whose cwd was
// not the project workspace), members created under the old one are outside the
// new PMO's subagent tree — a send from it is rejected (UNAUTHORIZED). They are
// marked routeStale so the next wake recreates them under the new PMO, in the
// project workspace (the same path a model change takes).

const human = { kind: 'human', memberId: 'h1' };

async function withService(run) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-pmo-session-'));
	const dir = join(root, 'ledger');
	let ledger = openLedger({ dir, projectId: 'prj_s', fsync: false });
	const reopen = () => {
		ledger.close();
		ledger = openLedger({ dir, projectId: 'prj_s', fsync: false });
		return new TeamService({ ledger });
	};
	try {
		const service = new TeamService({ ledger });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'S', ownerId: 'a1' } });
		for (const id of ['a1', 'a2', 'a3']) {
			await service.dispatch({ type: 'member.add', actor: human, payload: { id, name: id, kind: 'agent' } });
		}
		await run(service, reopen);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
}

test('the first PMO session binds without touching members', async () => {
	await withService(async (service) => {
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-a1' } });
		await service.bindHostSession('pmo-1', 'prj_s');
		assert.equal(service.state.hostSessionId, 'pmo-1');
		assert.equal(service.state.members.a1.routeStale, false);
	});
});

test('a replaced PMO session marks members with sessions for recreation; idle members are untouched', async () => {
	await withService(async (service) => {
		await service.bindHostSession('pmo-old', 'prj_s');
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-a1' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a2', sessionId: 's-a2' } });
		await service.bindHostSession('pmo-new', 'prj_s');
		assert.equal(service.state.members.a1.routeStale, true);
		assert.equal(service.state.members.a2.routeStale, true);
		assert.notEqual(service.state.members.a3.routeStale, true, 'a member without a session is created under the new PMO anyway');
		// Recreated under the new PMO: binding the new session clears the mark.
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-a1-new' } });
		assert.equal(service.state.members.a1.routeStale, false);
		assert.equal(service.state.members.a2.routeStale, true);
	});
});

test('rebinding the same PMO session is a no-op for members', async () => {
	await withService(async (service) => {
		await service.bindHostSession('pmo-1', 'prj_s');
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-a1' } });
		await service.bindHostSession('pmo-1', 'prj_s');
		assert.equal(service.state.members.a1.routeStale, false);
	});
});

test('the mark is folded from the ledger and survives a restart', async () => {
	await withService(async (service, reopen) => {
		await service.bindHostSession('pmo-old', 'prj_s');
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-a1' } });
		await service.bindHostSession('pmo-new', 'prj_s');
		const restarted = reopen();
		assert.equal(restarted.state.hostSessionId, 'pmo-new');
		assert.equal(restarted.state.members.a1.routeStale, true);
	});
});
