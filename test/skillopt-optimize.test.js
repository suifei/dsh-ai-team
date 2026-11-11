/**
 * Darwin Phase 2 自动 hill-climbing 测试（纯编排，全部依赖注入）：
 * - 诊断取最大加权短板；同 gap 取原始分更低者
 * - keep → 保留并继续；revert → 立即回滚并停止
 * - 体积 >150% / 空候选 / 未变化 → 跳过（不进入 judge）
 * - 连续 2 轮 margin 全 slight/tie → plateau 触顶
 * - judge 不可用 → 回滚（绝不保留未验证改动）
 * - results.tsv 行格式与表头
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_ROUNDS,
	isPlateau,
	resultRow,
	RESULTS_HEADER,
	runOptimizeLoop,
	validateCandidate,
	weakestDimension,
} from '../lib/skillopt/optimizer.js';

const rubricOf = (scores) => ({
	dimensions: scores.map(([id, score, weight]) => ({ id, score, weight, name: 'dim' + id })),
	total: 50,
});

test('weakestDimension: picks the largest weighted gap, ties broken by lower raw score', () => {
	const picked = weakestDimension(rubricOf([[1, 9, 7], [3, 2, 12], [5, 6, 18]]));
	// gaps: dim1 0.7, dim3 9.6, dim5 7.2 -> dim3
	assert.equal(picked.id, 3);
	const tie = weakestDimension(rubricOf([[1, 5, 10], [2, 5, 10], [3, 4, 10]]));
	assert.equal(tie.id, 3, 'equal gap prefers the lower raw score');
	assert.equal(weakestDimension({ dimensions: [] }), null);
});

test('isPlateau: two consecutive all-slight/tie rounds top out', () => {
	assert.equal(isPlateau([['slight', 'slight', 'tie']]), false, 'one round is not a plateau');
	assert.equal(isPlateau([['slight', 'slight'], ['tie', 'slight']]), true);
	assert.equal(isPlateau([['clear', 'slight'], ['slight', 'tie']]), false, 'a clear margin resets the plateau');
});

test('validateCandidate: empty/unchanged/oversized candidates are rejected before judging', () => {
	assert.equal(validateCandidate({ before: 'abc', after: 'abc' }).ok, false);
	assert.equal(validateCandidate({ before: 'abc', after: '  ' }).ok, false);
	assert.equal(validateCandidate({ before: 'a'.repeat(100), after: 'a'.repeat(151) }).ok, false, '150% cap');
	assert.equal(validateCandidate({ before: 'abc', after: 'abcd' }).ok, true);
});

test('resultRow: nine TSV columns, matching the darwin results format', () => {
	const row = resultRow({ timestamp: '2026-11-11T20:00:00', commit: 'abc123', skill: 'demo', oldScore: '70', newScore: '74', status: 'keep', dimension: 'dim3', note: '3-0 keep', evalMode: 'paired' });
	const cells = row.split('\t');
	assert.equal(cells.length, 9);
	assert.equal(RESULTS_HEADER.split('\t').length, 9);
	assert.equal(cells[8], 'paired');
});

/** 内存文件系统 + 可编程 judge/generator。 */
function harness({ initial, verdicts, candidates, throwsOnJudge = false, margins = [] }) {
	let text = initial;
	const results = [];
	const state = { text: () => text, results, rounds: 0 };
	const vcs = {
		kind: 'file',
		backup: async () => 'backup-1',
		// 真实语义：从备份恢复基线文本（备份内容 = 写入候选前的 before）。
		restore: async () => { state.restored = (state.restored ?? 0) + 1; text = initial; },
	};
	let judgeIndex = 0;
	return {
		state,
		input: {
			skillPath: '/proj/skills/demo/SKILL.md',
			skillName: 'demo',
			readText: async () => text,
			writeText: async (_path, next) => { text = next; },
			score: (value) => ({ dimensions: [{ id: 3, score: value.length > initial.length ? 6 : 3, weight: 12, name: 'failure' }], total: value.length > initial.length ? 80 : 60 }),
			generate: async () => {
				state.rounds += 1;
				return candidates[state.rounds - 1] ?? candidates[candidates.length - 1];
			},
			judge: async () => {
				if (throwsOnJudge) throw new Error('subagent provider missing');
				const verdict = verdicts[Math.min(judgeIndex, verdicts.length - 1)];
				const margin = margins[Math.min(judgeIndex, margins.length - 1)] ?? 'clear';
				judgeIndex += 1;
				return {
					verdict,
					better: verdict === 'keep' ? 3 : 1,
					worse: verdict === 'keep' ? 0 : 2,
					ties: 0,
					valid: 3,
					votes: [{ index: 1, vote: verdict === 'keep' ? 'better' : 'worse', margin, reason: '' }],
					errors: [],
				};
			},
			vcs,
			appendResult: async (line) => { results.push(line); },
			now: () => Date.parse('2026-11-11T20:00:00Z'),
		},
	};
}

test('loop: keep rounds are applied and the last score is reported', async () => {
	const h = harness({ initial: 'A'.repeat(100), candidates: ['A'.repeat(110), 'A'.repeat(120)], verdicts: ['keep'] });
	const result = await runOptimizeLoop({ ...h.input, rounds: 2 });
	assert.equal(result.status, 'completed');
	assert.equal(result.rounds.length, 2);
	assert.equal(result.rounds.every((round) => round.kept), true);
	assert.equal(h.state.text().length, 120, 'kept candidates stay written');
	assert.equal(h.state.results.length, 2);
	assert.match(h.state.results[0].split('\t')[5], /keep/);
	assert.equal(h.state.results[0].split('\t')[8], 'paired');
});

test('loop: a revert stops the loop and restores the baseline', async () => {
	const h = harness({ initial: 'A'.repeat(100), candidates: ['A'.repeat(110), 'A'.repeat(120)], verdicts: ['revert'] });
	const result = await runOptimizeLoop({ ...h.input, rounds: 3 });
	assert.equal(result.status, 'reverted');
	assert.equal(result.rounds.length, 1);
	assert.equal(h.state.restored, 1, 'baseline restored once');
	assert.equal(h.state.text().length, 100, 'candidate not kept');
	assert.match(h.state.results[0].split('\t')[5], /revert/);
});

test('loop: oversized candidate is skipped without judging', async () => {
	const h = harness({ initial: 'A'.repeat(100), candidates: ['A'.repeat(200)], verdicts: ['keep'] });
	const result = await runOptimizeLoop({ ...h.input, rounds: 1 });
	assert.equal(result.status, 'completed');
	assert.equal(result.rounds.length, 0, 'no judged round');
	assert.match(h.state.results[0].split('\t')[5], /skipped/);
});

test('loop: judge unavailability rolls back and reports an error', async () => {
	const h = harness({ initial: 'A'.repeat(100), candidates: ['A'.repeat(110)], verdicts: ['keep'], throwsOnJudge: true });
	const result = await runOptimizeLoop({ ...h.input, rounds: 1 });
	assert.equal(result.status, 'error');
	assert.match(result.error, /judge unavailable/);
	assert.equal(h.state.text().length, 100, 'unverified change is not kept');
});

test('loop: two consecutive slight/tie margins top out (plateau)', async () => {
	const h = harness({
		initial: 'A'.repeat(100),
		candidates: ['A'.repeat(110), 'A'.repeat(115), 'A'.repeat(120)],
		verdicts: ['keep', 'keep', 'keep'],
		margins: ['slight', 'tie'],
	});
	const result = await runOptimizeLoop({ ...h.input, rounds: 3 });
	assert.equal(result.status, 'plateau');
	assert.equal(result.rounds.length, 2, 'stops after the second ambiguous round');
	assert.equal(DEFAULT_ROUNDS, 3);
});
