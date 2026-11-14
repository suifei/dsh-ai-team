import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { pmoHasNews } from '../lib/ledger/fold.js';

// r09: after both goals were done the PMO was pushed every 10 minutes anyway — each push
// pulled 5 members into a meeting and ended in another "状态不变" post (8 pushes / 40
// meeting wakes in 35 minutes), and wave_done + pmo_continue fired in the same second.
// The idle-board push is only due when there is news since the PMO last saw the board.

const human = { kind: 'human', memberId: 'h1' };
const agent = { kind: 'agent', memberId: 'lead' };

async function withService(run) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-pmo-quiet-'));
	const dir = join(root, 'ledger');
	let ledger = openLedger({ dir, projectId: 'prj_q', fsync: false });
	const reopen = () => {
		ledger.close();
		ledger = openLedger({ dir, projectId: 'prj_q', fsync: false });
		return new TeamService({ ledger });
	};
	try {
		const service = new TeamService({ ledger });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'lead', name: '墨渊', kind: 'agent' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'Q', ownerId: 'lead' } });
		await run(service, reopen);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
}

async function finishOneTask(service) {
	const created = await service.dispatch({ type: 'task.create', actor: agent, projectId: 'prj_q', payload: { title: '排序', resultDefinition: 'x', ownerId: 'lead' } });
	const claimed = await service.dispatch({ type: 'task.claim', actor: agent, projectId: 'prj_q', payload: { taskId: created.task.id, expectedRevision: created.task.revision } });
	const submitted = await service.dispatch({ type: 'task.submit', actor: agent, projectId: 'prj_q', payload: { taskId: created.task.id, expectedRevision: claimed.task.revision, summary: 'ok', evidence: ['node t.js'] } });
	await service.dispatch({ type: 'task.accept', actor: human, projectId: 'prj_q', payload: { taskId: created.task.id, expectedRevision: submitted.task.revision } });
}

test('a report on the finished wave consumes the news: no push right after wave_done', async () => {
	await withService(async (service) => {
		await finishOneTask(service);
		assert.equal(pmoHasNews(service.state), true, 'an acceptance is news');
		await service.recordWake('lead', { ok: true, reason: 'wave_done' }, 'prj_q');
		assert.equal(pmoHasNews(service.state), false);
	});
});

test('after a push the PMO stays quiet until a Human acts or a task ends', async () => {
	await withService(async (service) => {
		await finishOneTask(service);
		await service.recordWake('lead', { ok: true, reason: 'pmo_continue' }, 'prj_q');
		assert.equal(pmoHasNews(service.state), false);
		// Member chatter, notes and meeting wakes are not news.
		await service.recordWake('lead', { ok: true, reason: 'thread_reply' }, 'prj_q');
		assert.equal(pmoHasNews(service.state), false);
		// A failed push did not show the PMO anything.
		await service.dispatch({ type: 'stream.post', actor: human, payload: { body: '再加一种' } });
		assert.equal(pmoHasNews(service.state), true);
		await service.recordWake('lead', { ok: false, reason: 'pmo_continue', error: 'timeout' }, 'prj_q');
		assert.equal(pmoHasNews(service.state), true);
	});
});

test('answering the Human consumes the news, so chat alone never triggers a push', async () => {
	await withService(async (service) => {
		await service.dispatch({ type: 'stream.post', actor: human, payload: { body: '在吗' } });
		await service.recordWake('lead', { ok: true, reason: 'human_message' }, 'prj_q');
		assert.equal(pmoHasNews(service.state), false);
	});
});

test('the quiet mark is folded from the ledger and survives a restart', async () => {
	await withService(async (service, reopen) => {
		await finishOneTask(service);
		await service.recordWake('lead', { ok: true, reason: 'wave_done' }, 'prj_q');
		const restarted = reopen();
		assert.equal(pmoHasNews(restarted.state), false);
	});
});

test('a restart re-binding member sessions is bookkeeping, not a Human action', async () => {
	// r10 re-check: the plugin re-activates members on restart and records
	// member/session-bound with a Human actor; both quiet projects held a meeting
	// within a second of boot, and the PMO budget was reset on every restart.
	await withService(async (service) => {
		await finishOneTask(service);
		await service.recordWake('lead', { ok: true, reason: 'wave_done' }, 'prj_q');
		const used = service.state.pmoRoundsUsed;
		const freeWave = service.state.pmoFreeWave;
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'lead', sessionId: 's-lead-2' } });
		await service.failMember({ actor: human, projectId: 'prj_q' }, { memberId: 'lead', reason: 'E_RUNTIME: boom' });
		assert.equal(pmoHasNews(service.state), false);
		assert.equal(service.state.pmoRoundsUsed, used);
		assert.equal(service.state.pmoFreeWave, freeWave);
	});
});
