// 夜间自优化（vendored SkillOpt-Sleep）的采纳闸门回归。借自上游 microsoft/SkillOpt
// tests/test_sleep_engine.py::TestVerifierDiscipline（用户 2026-11-21 建议）：分别断言基线分、
// 候选分和 gate_action，不只看最后有没有采纳；「训练集涨分、留出集反而掉分」必须拒绝。
// 夹具用真实的 consolidate + 脚本化后端跑三个场景，输出实测数字，这里逐项断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vendor = fileURLToPath(new URL('../lib/vendor/skillopt', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/skillopt-gate-scenarios.py', import.meta.url));
const python = process.env.SKILLOPT_PYTHON ?? 'python';
const hasPython = spawnSync(python, ['--version'], { encoding: 'utf8' }).status === 0;

function scenarios() {
	const run = spawnSync(python, ['-I', fixture, vendor], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
	assert.equal(run.status, 0, run.stderr);
	return Object.fromEntries(run.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)).map((row) => [row.scenario, row]));
}

test('sleep gate: baseline, candidate and gate_action are asserted separately; train-up / holdout-down is refused', { skip: hasPython ? false : 'python is not available' }, () => {
	const rows = scenarios();

	// 奖励作弊：训练集 0→1，留出集 1→0。
	const hack = rows.reward_hacking;
	assert.deepEqual([hack.train_baseline, hack.train_candidate], [0, 1], '训练集确实涨分');
	assert.equal(hack.holdout_candidate_measured, 0, '候选在留出集上实测掉到 0');
	assert.deepEqual(hack.trial_scores[0], [1, 0, false], '闸门看到的是留出集：基线 1、候选 0、拒绝');
	assert.equal(hack.gate_action, 'reject');
	assert.equal(hack.accepted, false);
	assert.equal(hack.baseline_score, 1);
	assert.equal(hack.candidate_score, 1, '拒绝后回滚再测：顶层候选分等于基线，候选的真实分只在 gate_trials 里');
	assert.deepEqual(hack.applied, []);
	assert.ok(hack.rejected.includes('Always emit placeholder URLs'));

	// 部分退化：训练集 0→1，留出集 1.0→0.5（两道题坏一道）——最容易被「训练集涨了」掩盖。
	const partial = rows.fractional_degradation;
	assert.deepEqual([partial.train_baseline, partial.train_candidate], [0, 1]);
	assert.equal(partial.holdout_candidate_measured, 0.5);
	assert.deepEqual(partial.trial_scores[0], [1, 0.5, false]);
	assert.equal(partial.gate_action, 'reject');
	assert.equal(partial.accepted, false);
	assert.equal(partial.holdout_detail, 2, '两道留出题都计入基线');

	// 真提升：训练集与留出集都 0→1，必须采纳为新最佳。
	const good = rows.beneficial;
	assert.deepEqual(good.trial_scores[0], [0, 1, true]);
	assert.equal(good.gate_action, 'accept_new_best');
	assert.equal(good.accepted, true);
	assert.deepEqual([good.baseline_score, good.candidate_score], [0, 1]);
	assert.deepEqual([good.holdout_baseline, good.holdout_candidate], [0, 1]);
	assert.deepEqual(good.applied, ['Always think step-by-step']);
});
