import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { formatSkillCatalog } from '../lib/runtime/skill-catalog.js';
import { scoreSkillRubric } from '../lib/skillopt/rubric.js';
import { readJob, writeJob } from '../lib/skillopt/jobs.js';

const human = { kind: 'human', memberId: 'mem_human' };

async function makeService(t, workspacePath = '') {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-batch-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_b', fsync: false });
	const service = new TeamService({ ledger });
	t.after(() => ledger.close?.());
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_human', name: 'Human', kind: 'human' } });
	await service.dispatch({ type: 'project.create', actor: human, payload: { name: 'B', ownerId: 'mem_human', workspacePath } });
	return { service, root };
}

test('changing the project owner moves both ownerId and ownerMemberId', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_lead', name: '主理', kind: 'agent', role: '主理人' } });
	await service.dispatch({ type: 'project.owner.update', actor: human, projectId: 'prj_b', payload: { ownerMemberId: 'mem_lead' } });
	const project = service.state.projects.prj_b;
	assert.equal(project.ownerMemberId, 'mem_lead');
	// ownerId 若停在原主，isLead 的 OR 判定会让前 owner 继续保留 lead 权限。
	assert.equal(project.ownerId, 'mem_lead');
});

test('skill catalog drops skills whose invocation.modelInvocable is false', async () => {
	const skills = {
		async list() {
			return [
				{ name: 'usable', description: 'ok', invocation: { modelInvocable: true, userInvocable: true } },
				{ name: 'human-only', description: 'hidden', invocation: { modelInvocable: false, userInvocable: true } },
			];
		},
	};
	const text = await formatSkillCatalog(skills, { cwd: 'E:/x' });
	assert.match(text, /usable/);
	assert.doesNotMatch(text, /human-only/);
});

test('a Human acceptance cannot skip the QA checklist', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	await service.dispatch({
		type: 'task.create', actor: human, projectId: 'prj_b',
		payload: { title: '带清单', resultDefinition: 'done', ownerId: 'mem_human', assigneeId: 'mem_a', qaRequired: true, qaChecklist: ['跑通', '有日志'] },
	});
	const taskId = Object.keys(service.state.tasks)[0];
	await service.dispatch({ type: 'task.claim', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b', payload: { taskId } });
	await service.dispatch({ type: 'task.submit', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b', payload: { taskId, summary: 'done', evidence: ['x'] } });
	// Human 是 UI 上唯一的验收人：零勾选必须被拒，而不是直接把卡验收掉。
	await assert.rejects(
		() => service.dispatch({ type: 'task.accept', actor: human, projectId: 'prj_b', payload: { taskId, checks: [] } }),
		/QA checklist item not verified|every QA checklist/,
	);
});

test('rubric counting is not inflated by capture groups', () => {
	const text = ['修复', '验证', '回归'].map((line) => `- ${line}：(a)(b)`).join('\n');
	const baseline = scoreSkillRubric(text, { dim8: 5 });
	// 若把捕获组当命中，同一个句式会被计成 3 次，dim3 分数随之虚高。
	assert.equal(baseline.dimensions.find((item) => item.id === 3).score <= 10, true);
});

test('writeJob lands atomically and leaves no temp file behind', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-jobs-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeJob(dir, { id: 'job_1', state: 'judging', createdAt: 1 });
	const files = readdirSync(join(dir, '.skillopt-sleep', 'jobs')).sort();
	assert.deepEqual(files, ['job_1.json'], 'no .tmp file may survive');
	assert.equal(readJob(dir, 'job_1').state, 'judging');
	// 内容必须是完整 JSON（半截文件会让下一轮 tick 判定成 conflict failed）。
	assert.deepEqual(JSON.parse(readFileSync(join(dir, '.skillopt-sleep', 'jobs', 'job_1.json'), 'utf8')).id, 'job_1');
});

test('concurrent claims by one member cannot both land', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	for (const title of ['A', 'B']) {
		await service.dispatch({
			type: 'task.create', actor: human, projectId: 'prj_b',
			payload: { title, resultDefinition: 'done', ownerId: 'mem_human', assigneeId: 'mem_a' },
		});
	}
	const ids = Object.keys(service.state.tasks);
	// 并发认领两张卡：INV-05 只允许同一成员同时持有一张 in_progress 卡。
	const results = await Promise.allSettled(ids.map((taskId) => service.dispatch({
		type: 'task.claim', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b', payload: { taskId },
	})));
	const fulfilled = results.filter((row) => row.status === 'fulfilled').length;
	const inProgress = Object.values(service.state.tasks).filter((task) => task.status === 'in_progress').length;
	assert.equal(fulfilled, 1, 'exactly one claim may succeed');
	assert.equal(inProgress, 1, 'and exactly one task may be in_progress');
});
