import test from 'node:test';
import assert from 'node:assert/strict';
import { decideByMajority, judgeRecord, parseJudgeOutput } from '../lib/skillopt/judge.js';
import { decideReviewVotes } from '../lib/skillopt/reviewer.js';

// 用户 2026-11-21：排查评分时把「评分解析失败」和「有效评分但没提升」分开记。
test('judge records separate unparseable votes (inconclusive) from a valid no-improvement verdict (revert)', () => {
	const noGain = decideByMajority(['worse', 'worse', 'better']);
	assert.equal(noGain.unparsed, 0);
	assert.deepEqual(judgeRecord(noGain), { status: 'revert', note: '1-2 revert' }, '三票都有效、评审说没提升：真结论');
	const broken = decideByMajority([null, null, 'worse']);
	assert.equal(broken.unparsed, 2);
	assert.deepEqual(judgeRecord(broken), { status: 'inconclusive', note: '0-1 inconclusive · unparsed 2/3' }, '两票解析不出：评审坏了，不是改动的结论');
	const allBroken = decideByMajority([null, null, null]);
	assert.deepEqual(judgeRecord(allBroken), { status: 'inconclusive', note: '0-0 inconclusive · unparsed 3/3' });
	const keptDespiteOne = decideByMajority(['better', 'better', null]);
	assert.deepEqual(judgeRecord(keptDespiteOne), { status: 'keep', note: '2-0 keep · unparsed 1/3' }, '采纳也记下有一票无效');
	// 评审卡：解析不出的回帖在 parseReviewReplies 里被跳过，按应投数量补成无效票。
	const review = decideReviewVotes([{ better: 'A', aIsAfter: true }], 3);
	assert.equal(review.verdict, 'inconclusive');
	assert.equal(review.unparsed, 2);
	assert.equal(judgeRecord(review).note, '1-0 inconclusive · unparsed 2/3');
});

test('a single surviving vote out of three cannot decide keep', () => {
	const result = decideByMajority(['better', null, null]);
	assert.equal(result.verdict, 'inconclusive', 'one valid vote is not a majority of three');
	assert.equal(result.required, 2);
});

test('two valid votes out of three decide normally', () => {
	assert.equal(decideByMajority(['better', 'better', null]).verdict, 'keep');
	assert.equal(decideByMajority(['worse', 'worse', null]).verdict, 'revert');
	// 两票里 1 better / 1 worse 仍是 better >= worse
	assert.equal(decideByMajority(['better', 'worse', null]).verdict, 'keep');
});

test('five ballots need three valid votes', () => {
	assert.equal(decideByMajority(['better', 'better', null, null, null]).verdict, 'inconclusive');
	assert.equal(decideByMajority(['better', 'better', 'tie', null, null]).verdict, 'keep');
	assert.equal(decideByMajority(['better', 'better', 'tie', null, null]).required, 3);
});

test('parseJudgeOutput skips a template object echoed before the real verdict', () => {
	const output = [
		'示例格式：{"better":"A","margin":"clear","reason":"一句话理由"}',
		'我的结论：',
		'```json',
		'{"better":"B","margin":"slight","reason":"B 的检查点更具体"}',
		'```',
	].join('\n');
	const parsed = parseJudgeOutput(output);
	assert.equal(parsed.better, 'B');
	assert.equal(parsed.margin, 'slight');
	assert.match(parsed.reason, /检查点/);
});

test('parseJudgeOutput tolerates braces inside strings and noise before the object', () => {
	const parsed = parseJudgeOutput('前言 { 不是 JSON } 结论 {"better":"tie","reason":"用了 {} 说明"} 尾巴');
	assert.equal(parsed.better, 'tie');
	assert.equal(parsed.reason, '用了 {} 说明');
	assert.equal(parseJudgeOutput('没有结论'), null);
});
