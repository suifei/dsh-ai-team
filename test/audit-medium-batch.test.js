import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LedgerWriter, openLedger } from '../lib/ledger/writer.js';
import { recoverCheckpoint } from '../lib/ledger/checkpoint.js';
import { applyEvent, initialState } from '../lib/ledger/fold.js';
import { TeamService } from '../lib/host/service.js';
import { formatSkillCatalog } from '../lib/runtime/skill-catalog.js';
import { scoreSkillRubric } from '../lib/skillopt/rubric.js';
import { readJob, writeJob } from '../lib/skillopt/jobs.js';
import { aggregatePeople } from '../lib/host/people-view.js';
import { nextRequestAttempt } from '../lib/runtime/failure-policy.js';
import { loadSkillContext } from '../lib/runtime/skill-loader.js';

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

test('a takeover does not enter claimHistory (INV-07)', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_b', name: '乙', kind: 'agent', role: '执行' } });
	await service.dispatch({
		type: 'task.create', actor: human, projectId: 'prj_b',
		payload: { title: 'T', resultDefinition: 'done', ownerId: 'mem_human', assigneeId: 'mem_a' },
	});
	const taskId = Object.keys(service.state.tasks)[0];
	await service.dispatch({ type: 'task.claim', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b', payload: { taskId } });
	await service.dispatch({
		type: 'member.takeover', actor: human, projectId: 'prj_b',
		payload: { fromMemberId: 'mem_a', toMemberId: 'mem_b', reason: '换人' },
	});
	const task = service.state.tasks[taskId];
	assert.equal(task.assigneeId, 'mem_b');
	// 继任者若被写进 claimHistory，isReviewCandidate 会把 ta 永久排除在验收候选之外。
	assert.deepEqual(task.claimHistory, ['mem_a'], 'only claim enters claimHistory');
	assert.equal(task.takeoverHistory.length, 1);
	assert.equal(task.takeoverHistory[0].to, 'mem_b');
});

test('a retired member can be neither failed nor re-failed by a late LLM error', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	await service.dispatch({ type: 'member.retire', actor: human, projectId: 'prj_b', payload: { memberId: 'mem_a' } });
	assert.equal(service.state.members.mem_a.status, 'retired');
	await assert.rejects(
		() => service.dispatch({ type: 'member.fail', actor: human, projectId: 'prj_b', payload: { memberId: 'mem_a', reason: 'x' } }),
		/retired/,
	);
	// 迟到的 LLM 失败：忽略即可，不能把 retired 覆写成 failed（否则 member.bind 能复活）。
	await service.recordMemberFailure('mem_a', { category: 'auth', message: 'late' }, 'prj_b');
	assert.equal(service.state.members.mem_a.status, 'retired');
});

test('a done job is never overwritten by a later failure', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-jobs2-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeJob(dir, { id: 'job_d', state: 'judging', createdAt: 1 });
	writeJob(dir, { id: 'job_d', state: 'done', createdAt: 1, decision: { verdict: 'keep' } });
	// 并发收票时后到的判断可能想把 done 覆写成 failed：必须拒绝。
	writeJob(dir, { id: 'job_d', state: 'failed', createdAt: 1, error: 'late' });
	const job = readJob(dir, 'job_d');
	assert.equal(job.state, 'done');
	assert.equal(job.decision.verdict, 'keep');
});

test('request attempts are counted per request window, not per member lifetime', () => {
	const store = new Map();
	const t0 = 1_000_000;
	assert.equal(nextRequestAttempt(store, 's1', t0), 1);
	assert.equal(nextRequestAttempt(store, 's1', t0 + 1000), 2);
	assert.equal(nextRequestAttempt(store, 's1', t0 + 2000), 3);
	// 窗口过期 → 新请求，预算重置（否则成员历史失败会把预算提前耗尽）
	assert.equal(nextRequestAttempt(store, 's1', t0 + 11 * 60_000), 1);
	// 不同会话互不影响
	assert.equal(nextRequestAttempt(store, 's2', t0 + 3000), 1);
});

test('member skills are found across several skill roots', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-skillroots-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const projectDsh = join(root, 'project', '.dsh');
	const userDsh = join(root, 'userdsh');
	const dataDir = join(root, 'data');
	mkdirSync(join(projectDsh, 'skills', 'proj-skill'), { recursive: true });
	writeFileSync(join(projectDsh, 'skills', 'proj-skill', 'SKILL.md'), '---\nname: proj-skill\ndescription: 项目技能。\n---\n正文', 'utf8');
	mkdirSync(join(userDsh, 'skills'), { recursive: true });
	writeFileSync(join(userDsh, 'skills', 'user-skill.md'), '用户技能正文', 'utf8');
	const text = await loadSkillContext({ skills: ['proj-skill', 'user-skill'] }, [projectDsh, userDsh, dataDir]);
	assert.match(text, /proj-skill/);
	assert.match(text, /用户技能正文/);
});

test('a member failure still escalates when that member has its own pending decision', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	// 甲自己提了一个决策（ref.memberId 是“申请人”）
	await service.dispatch({
		type: 'decision.request', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b',
		payload: { title: '甲的问题', questions: [{ text: '选哪个？', options: ['A', 'B'] }] },
	});
	const result = await service.recordMemberFailure('mem_a', { category: 'auth', message: 'bad key' }, 'prj_b');
	// 同名字段曾让这条升级被自己的决策项吞掉
	assert.notEqual(result?.inboxItem ?? null, null, 'fatal failure must still produce an escalation item');
	assert.equal(result.inboxItem.ref.kind, 'member_failure');
});

test('a malformed alias value cannot crash the people view', () => {
	const registry = [{ id: 'p1', name: 'P1' }];
	const runtimes = [{ id: 'p1', service: { state: { projects: { p1: {} }, members: { a: { id: 'm1', name: '甲', kind: 'agent', status: 'idle' } }, tasks: {} } } }];
	assert.equal(aggregatePeople(registry, runtimes, { aliases: { 甲: 5 } }).length, 1);
	assert.equal(aggregatePeople(registry, runtimes, { aliases: { 甲: true } }).length, 1);
});

test('an explicit unknown ownerId is rejected, and prototype keys do not count as Tasks', async (t) => {
	const { service } = await makeService(t);
	await assert.rejects(
		() => service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_b', payload: { title: 'T', resultDefinition: 'd', ownerId: 'ghost' } }),
		/not a Team member/,
	);
	await assert.rejects(
		() => service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_b', payload: { title: 'T2', resultDefinition: 'd', blockedBy: ['constructor'] } }),
		/blockedBy/,
	);
});

test('a deleted Task cannot be used as a dependency', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_b', payload: { title: 'A', resultDefinition: 'd' } });
	const first = Object.keys(service.state.tasks)[0];
	await service.dispatch({ type: 'task.delete', actor: human, projectId: 'prj_b', payload: { taskId: first } });
	// 删除是 tombstone，依赖判定只认 done → 指向它会永久 blocked。
	await assert.rejects(
		() => service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_b', payload: { title: 'B', resultDefinition: 'd', blockedBy: [first] } }),
		/can never complete/,
	);
});

test('project.repair is Human-only and rebuilds the projection', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	await assert.rejects(
		() => service.dispatch({ type: 'project.repair', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b', payload: {} }),
		/only Human/,
	);
	const result = await service.dispatch({ type: 'project.repair', actor: human, projectId: 'prj_b', payload: {} });
	assert.equal(typeof result.stateLastSeq, 'number');
	assert.equal(result.stateLastSeq, service.state.lastSeq ?? result.stateLastSeq);
});

test('stepJob does not require vcs.backup and freezes a failed job', async (t) => {
	const { stepJob } = await import('../lib/skillopt/job-runner.js');
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-runner-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const skillPath = join(dir, 'SKILL.md');
	writeFileSync(skillPath, 'before text', 'utf8');
	const job = {
		id: 'job_r1', state: 'generating', skillPath, skillName: 'demo',
		createdAt: Date.now(), outputStart: 0, generatorChildId: 'gen',
	};
	// git 适配器没有 backup：无脑调用会 TypeError，job 卡到 TTL。
	const deps = {
		now: () => Date.now(),
		readText: (file) => (file === skillPath ? 'before text' : ''),
		writeText: () => {},
		vcs: { kind: 'git' },
		diag: () => {},
		votes: 1,
		ensureParent: null,
		startChild: async () => ({ childId: 'judge_1' }),
	};
	// stepJob 通过 ctx.get(服务名) 观察子代理：这里给一个只会返回生成器会话的假 ctx。
	const child = { status: 'idle', snapshotEvents: () => [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'after text' }] } } }] };
	const ctx = { get: (name) => (name === 'sessions' ? { get: (id) => (id === 'gen' ? child : undefined) } : undefined) };
	const result = await stepJob({ ctx, job, projectDir: dir, deps });
	assert.equal(result.job.backup ?? null, null, 'a vcs without backup() must not throw');
	assert.equal(result.job.before, 'before text');
	assert.ok(['judging', 'failed'].includes(result.job.state), 'unexpected state: ' + result.job.state);
});

test('PMO auto-answer skips a decision item that has no structured questions', async (t) => {
	const { service } = await makeService(t);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	// 致命失败生成的升级项没有 questions：自动作答会把它 resolved，Human 再也看不到。
	await service.recordMemberFailure('mem_a', { category: 'auth', message: 'bad key' }, 'prj_b');
	const items = Object.values(service.state.inbox ?? {}).filter((item) => item.type === 'decision_required');
	assert.equal(items.length, 1);
	assert.equal(Array.isArray(items[0].ref?.questions), false);
	const answered = await service.autoAnswerDecisions('prj_b');
	assert.deepEqual(answered, []);
	assert.equal(service.state.inbox[items[0].id].state, 'unread', 'the escalation must stay for Human');
});

test('recoverCheckpoint can write the checkpoint it just replayed', async (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-ckpt-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const writer = new LedgerWriter({ dir, projectId: 'prj_c', fsync: false, lock: false });
	t.after(() => writer.close());
	writer.open();
	await writer.append({ type: 'project/created', payload: { name: 'P' }, actor: { kind: 'human', memberId: 'h' }, projectId: 'prj_c' });
	await writer.append({ type: 'member/added', payload: { id: 'm1', name: 'A', kind: 'agent' }, actor: { kind: 'human', memberId: 'h' }, projectId: 'prj_c' });
	// save:true 分支此前会因 state.lastSeq 与水位不一致抛 E_CHECKPOINT_STATE_MISMATCH。
	const out = recoverCheckpoint({ dir, writer, stateVersion: 3, initialState: initialState(), apply: applyEvent, save: true });
	assert.equal(out.state.lastSeq, out.lastSeq);
	assert.equal(out.saved !== null, true);
});

test('a junction inside the workspace cannot smuggle an outside report file', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-link-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const outside = join(root, 'outside');
	const workspace = join(root, 'ws');
	mkdirSync(outside, { recursive: true });
	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(outside, 'report.md'), ['## 6. 决策', '| # | 问题 | 建议 | 阻塞点 |', '|---|---|---|---|', '| 1 | 选 A 还是 B？ | A | 无 |'].join('\n'), 'utf8');
	try { symlinkSync(outside, join(workspace, 'link'), 'junction'); } catch { t.skip('junction not permitted'); return; }

	const { service } = await makeService(t, workspace);
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'mem_a', name: '甲', kind: 'agent', role: '执行' } });
	await service.dispatch({ type: 'task.create', actor: human, projectId: 'prj_b', payload: { title: 'T', resultDefinition: 'd' } });
	const taskId = Object.keys(service.state.tasks)[0];
	await service.dispatch({
		type: 'thread.post', actor: { kind: 'agent', memberId: 'mem_a' }, projectId: 'prj_b',
		payload: { taskId, baseSeq: 0, body: `报告在 ${join(workspace, 'link', 'report.md')}，请 Human 决定。` },
	});
	// 词法上「在工作区内」，realpath 却在外面：必须拒绝，否则任意路径都能读。
	const created = await service.backfillHumanMentions(workspace);
	assert.equal(created, 0);
});
