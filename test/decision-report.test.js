import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('falls back to the last mention when no candidate exists', () => {
	// 都不存在时按「最终答复」约定取最后一次提到的路径。
	assert.equal(findReportPath('报告：E:\\work\\report.md，旧稿 E:\\work\\old.md'), 'E:\\work\\old.md');
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

test('prefers a path that exists over a trailing template example', (t) => {
	// 真实产物存在、文末模板不存在：靠存在性判别，而不是「取第一个/取最后一个」。
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-report-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const real = join(dir, '决策报告.md');
	writeFileSync(real, '# report\n', 'utf8');
	const thread = [
		`产物已写到 \`${real}\`，请查收。`,
		'',
		'## 附录：写法示例',
		'- 报告路径：`E:/works/demo/template.md`',
	].join('\n');
	assert.equal(findReportPath(thread), real);
});

test('falls back to the last mention when no candidate exists', () => {
	assert.equal(findReportPath('示例 D:/tmp/a.md，实际 E:/works/real.md'), 'E:/works/real.md');
});
