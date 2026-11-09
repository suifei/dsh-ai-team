import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { chooseDecisionAnswers } from '../lib/host/pmo.js';

const human = { kind: 'human', memberId: 'h1' };
const agent = { kind: 'agent', memberId: 'a1' };

test('PMO picks the recommendation and avoids the minimum-effort option', () => {
	const answers = chooseDecisionAnswers([
		{ id: 'q1', options: ['A 最小', 'B 核心（推荐）', 'C 完整'], recommendation: '建议 B' },
		{ id: 'q2', options: ['暂缓', '全量交付'] },
	]);
	assert.equal(answers[0].value, 'B 核心（推荐）');
	assert.equal(answers[1].value, '全量交付');
});

test('PMO auto-answers a structured decision and records mem_pmo in the Thread', async () => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-pmo-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_pmo', fsync: false });
	const service = new TeamService({ ledger });
	try {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: 'Lead', kind: 'agent' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's1' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { name: 'PMO', ownerId: 'a1' } });
		assert.equal(service.state.projects.prj_pmo.pmoAuto, true);
		const created = await service.dispatch({
			type: 'task.create', actor: human, projectId: 'prj_pmo',
			payload: { title: 'T', resultDefinition: 'done', ownerId: 'a1' },
		});
		const request = await service.dispatch({
			type: 'decision.request', actor: agent, projectId: 'prj_pmo',
			payload: {
				title: '需要拍板', taskId: created.task.id,
				questions: [{ id: 'q1', text: '范围？', options: ['A 最小', 'B 核心（推荐）'], recommendation: '建议 B' }],
			},
		});
		const results = await service.autoAnswerDecisions();
		assert.equal(results.length, 1);
		assert.equal(results[0].entry.authorId, 'mem_pmo');
		assert.equal(service.state.inbox[request.item.id].state, 'resolved');
		assert.match(results[0].entry.body, /PMO 自动决策/);
		const off = await service.dispatch({ type: 'project.pmo.update', actor: human, projectId: 'prj_pmo', payload: { pmoAuto: false } });
		assert.equal(off.project.pmoAuto, false);
		assert.equal(service.state.projects.prj_pmo.pmoAuto, false);
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
