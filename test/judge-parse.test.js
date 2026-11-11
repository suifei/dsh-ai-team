import test from 'node:test';
import assert from 'node:assert/strict';
import { decideByMajority, parseJudgeOutput } from '../lib/skillopt/judge.js';

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
