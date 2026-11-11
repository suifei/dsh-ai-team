/**
 * 两阶段异步优化 job 测试：
 * - 状态机：generating → judging → done；空候选/超时 → failed
 * - 观测：subagent/end 事件、idle、冷会话都算结束
 * - adopt 门的同步判据：results.tsv 最后一条 paired keep
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isChildSettled, isJobExpired, planJobStep } from '../lib/skillopt/jobs.js';
import { hasPairedKeepRecord } from '../lib/skillopt/optimize-wiring.js';
import { createAdoptGate } from '../lib/skillopt/adopt-gate.js';

const job = (state, extra = {}) => ({
	id: 'job_x', state, createdAt: 1000, skillName: 'demo',
	generatorChildId: 'gen', judgeChildIds: ['j1', 'j2', 'j3'], outputStart: 0, ...extra,
});

test('jobs: a running generator keeps the job in generating; a settled one advances to judging', () => {
	const running = planJobStep(job('generating'), { children: { gen: { status: 'running', events: [] } }, now: 2000 });
	assert.equal(running.next, 'generating');
	assert.equal(running.actions[0].type, 'await');

	const settled = planJobStep(job('generating'), { children: { gen: { status: 'idle', events: [], text: 'NEW SKILL' } }, now: 2000 });
	assert.equal(settled.next, 'judging');
	assert.equal(settled.actions.map((action) => action.type).join(','), 'apply-candidate,start-judges');
	assert.equal(settled.actions[0].payload.text, 'NEW SKILL');
});

test('jobs: empty generator output fails; a timeout fails', () => {
	const empty = planJobStep(job('generating'), { children: { gen: { status: 'idle', events: [], text: '  ' } }, now: 2000 });
	assert.equal(empty.next, 'failed');
	assert.match(empty.actions[0].payload.reason, /empty/);

	const stale = planJobStep(job('generating', { createdAt: 0 }), { children: {}, now: 31 * 60 * 1000 });
	assert.equal(stale.next, 'failed');
	assert.equal(stale.reason, 'timeout');
});

test('jobs: judging waits for every judge, then finishes', () => {
	const partial = planJobStep(job('judging'), {
		children: {
			j1: { status: 'idle', events: [], text: '{"better":"A"}' },
			j2: { status: 'running', events: [] },
			j3: { status: 'idle', events: [], text: '{"better":"B"}' },
		},
		now: 2000,
	});
	assert.equal(partial.next, 'judging');

	const all = planJobStep(job('judging'), {
		children: {
			j1: { status: 'idle', events: [], text: '{"better":"A"}' },
			j2: { status: 'idle', events: [], text: '{"better":"B"}' },
			j3: { status: 'idle', events: [], text: '{"better":"tie"}' },
		},
		now: 2000,
	});
	assert.equal(all.next, 'done');
	assert.equal(all.actions[0].type, 'finish');
	assert.equal(all.actions[0].payload.votes.length, 3);
});

test('jobs: settled detection is tolerant of the activation shapes', () => {
	assert.equal(isChildSettled({ status: 'running', events: [{ type: 'subagent/end' }] }), true);
	assert.equal(isChildSettled({ status: 'idle', events: [] }), true);
	assert.equal(isChildSettled({ status: null, events: [] }), false, 'unknown state with no events must keep waiting (TTL handles losses)');
	assert.equal(isChildSettled({ status: null, events: [{ type: 'assistant/message' }] }), true, 'visible events mean the child has produced output');
	assert.equal(isChildSettled({ status: 'running', events: [] }), false);
	assert.equal(isJobExpired({ createdAt: 0 }, 1000, 5000), false);
	assert.equal(isJobExpired({ createdAt: 0 }, 6000, 5000), true);
});

test('adopt gate: paired-keep record is the synchronous verdict source', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-records-'));
	try {
		const pair = { before: 'OLD', after: 'NEW', skillPath: join(dir, 'skills', 'demo', 'SKILL.md') };
		const gate = createAdoptGate({ readPair: async () => pair, hasKeepRecord: async ({ projectDir }) => hasPairedKeepRecord(projectDir, pair.skillPath) });
		// no results.tsv yet -> refuse
		assert.match(await gate({ project: dir }), /no paired keep record/);
		// a keep row -> allow
		mkdirSync(join(dir, '.skillopt-sleep'), { recursive: true });
		const file = join(dir, '.skillopt-sleep', 'results.tsv');
		writeFileSync(file, ['timestamp\tcommit\tskill\told_score\tnew_score\tstatus\tdimension\tnote\teval_mode', '2026-11-11T20:00:00\t-\tdemo\t50.9\t55\tkeep\tdim3\t3-0 keep\tpaired'].join('\n') + '\n', 'utf8');
		assert.equal(await gate({ project: dir }), null);
		// a later revert row -> refuse again
		writeFileSync(file, ['timestamp\tcommit\tskill\told_score\tnew_score\tstatus\tdimension\tnote\teval_mode', '2026-11-11T20:00:00\t-\tdemo\t50.9\t55\tkeep\tdim3\t3-0 keep\tpaired', '2026-11-11T21:00:00\t-\tdemo\t55\t50\trevert\tdim5\t1-2 revert\tpaired'].join('\n') + '\n', 'utf8');
		assert.match(await gate({ project: dir }), /no paired keep record/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
