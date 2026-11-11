import test from 'node:test';
import assert from 'node:assert/strict';
import { findReportPath, parseDecisionQuestions } from '../lib/host/decision-report.js';

test('parses the Human decision table from a markdown report', () => {
	const markdown = [
		'# report',
		'## 6. 需 Human 决策的问题清单',
		'| # | 问题 | 选项与建议 | 阻塞点 |',
		'|---|---|---|---|',
		'| 1 | **复刻程度**：A/B/C？ | 建议 B | 决定体量 |',
		'| 2 | 目标用户？ | 自用 / 教学 | T6 |',
		'---',
		'## 7. 自查',
	].join('\n');
	const questions = parseDecisionQuestions(markdown);
	assert.equal(questions.length, 2);
	assert.equal(questions[0].text, '复刻程度：A/B/C？');
	assert.equal(questions[0].recommendation, '建议 B');
	assert.equal(questions[0].blocking, '决定体量');
	assert.equal(questions[1].text, '目标用户？');
});

test('finds the last Windows markdown path in a thread message', () => {
	const path = findReportPath('报告：E:\\work\\report.md，旧稿 E:\\work\\old.md');
	assert.equal(path, 'E:\\work\\old.md');
	assert.equal(findReportPath('no path'), null);
});

test('accepts a Chinese section number (六) for the decision table', () => {
	const markdown = [
		'# report',
		'## 六、需要你决定的事',
		'| # | 问题 | 建议 | 阻塞点 |',
		'|---|---|---|---|',
		'| 1 | 走 A 还是 B？ | A | 无 |',
	].join('\n');
	const questions = parseDecisionQuestions(markdown);
	assert.equal(questions.length, 1);
	assert.match(questions[0].text, /走 A 还是 B/);
});
