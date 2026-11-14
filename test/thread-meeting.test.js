import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { createTeamTool } from '../lib/host/member-tools.js';

// r09: in a meeting five members read the same thread head and answered at once.
// Only the first reply got through; the rest got E_STALE_REPLY, re-read, re-wrote
// and lost again (46 rejections in one round). Late replies are now posted and
// carry back what the author missed.

const human = { kind: 'human', memberId: 'h1' };

test('concurrent meeting replies all land; late ones get the entries they missed', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-meeting-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_m', fsync: false });
	const service = new TeamService({ ledger });
	try {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		for (const id of ['lead', 'a2', 'a3']) {
			await service.dispatch({ type: 'member.add', actor: human, payload: { id, name: id, kind: 'agent' } });
			await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: id, sessionId: `s-${id}` } });
		}
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'M', ownerId: 'lead' } });
		const tool = createTeamTool({ getState: () => service.state, dispatch: (command) => service.dispatch(command) });
		const as = (id) => ({ agent: { id: `s-${id}` } });
		const created = await tool.execute({ action: 'create', title: '复盘', resultDefinition: 'x', ownerId: 'lead' }, as('lead'));
		const taskId = created.task.id;

		const read = await tool.execute({ action: 'thread', taskId }, as('a2'));
		const replies = await Promise.all(['lead', 'a2', 'a3'].map((id) => tool.execute({ action: 'reply', taskId, baseSeq: read.headSeq, body: `${id} 的意见` }, as(id))));
		assert.deepEqual(replies.map((reply) => reply.ok), [true, true, true]);
		assert.equal(service.state.threads[taskId].headSeq, 3);
		assert.deepEqual(service.state.threads[taskId].entries.map((entry) => entry.authorId), ['lead', 'a2', 'a3']);
		assert.equal(replies[0].missed, undefined, 'the first reply missed nothing');
		assert.deepEqual(replies[2].missed.map((entry) => entry.authorId), ['lead', 'a2']);
		assert.match(replies[2].note, /2 replies landed after you read/);

		// Your own earlier post is not reported as missed.
		const own = await tool.execute({ action: 'reply', taskId, baseSeq: 2, body: '补一句' }, as('a3'));
		assert.deepEqual(own.missed, undefined);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
