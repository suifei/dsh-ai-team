import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDecisionAnswers } from '../lib/host/pmo.js';

test('an explicit recommendation wins over keyword scoring', () => {
	// B 的描述含「完整/推荐」等高分关键词；建议是 A。按旧实现关键词打分会让 B 胜出，
	// 于是 PMO 自动决策与问题里写的建议相反。
	const answers = chooseDecisionAnswers([{
		id: 'q1',
		text: '复刻到什么程度？',
		options: ['A. 最小可用骨架', 'B. 完整复刻（推荐）'],
		recommendation: '建议 A：先做最小可用，验证后再扩',
	}]);
	assert.equal(answers[0].value, 'A. 最小可用骨架');
});

test('recommendation that names the option by full text still matches', () => {
	const answers = chooseDecisionAnswers([{
		id: 'q1',
		options: ['自用为主', '对外教学'],
		recommendation: '对外教学',
	}]);
	assert.equal(answers[0].value, '对外教学');
});

test('falls back to scoring when the recommendation matches no option', () => {
	const answers = chooseDecisionAnswers([{
		id: 'q1',
		options: ['最小骨架', '完整核心方案'],
		recommendation: '你定',
	}]);
	assert.equal(answers[0].value, '完整核心方案');
});


test('explicit short recommendation matches a parenthetically annotated option', () => {
	const options = ['A（推荐）：立即重启并补采', 'B：完整处理', 'C：继续等待，不推荐'];
	assert.equal(chooseDecisionAnswers([{ options, recommendation: '建议 A' }])[0].value, options[0]);
	const reordered = ['C：完整处理', 'A（最低限度）：仅试跑', 'B：继续等待，不推荐'];
	assert.equal(chooseDecisionAnswers([{ options: reordered, recommendation: '建议 A' }])[0].value, reordered[1]);
});

test('negative recommendation never beats a non-negated fallback', () => {
	const positive = 'A（推荐）：立即重启并补采';
	assert.equal(chooseDecisionAnswers([{ options: [positive, 'B：仅预览', 'C：继续等待 —— 不推荐，无超时机制不会自愈'] }])[0].value, positive);
	for (const negated of ['B：完整方案，不推荐', 'B：完整方案，不建议', 'B：完整方案, NOT recommended']) {
		assert.equal(chooseDecisionAnswers([{ options: [negated, 'A：预览'] }])[0].value, 'A：预览');
	}
});

test('labels do not influence fallback rankings and ordinary delivery priority remains', () => {
	for (const [low, high] of [['C', 'A'], ['A', 'C'], ['B', 'A']]) {
		const preferred = high + '：完整交付';
		assert.equal(chooseDecisionAnswers([{ options: [low + '：最小骨架', preferred] }])[0].value, preferred);
	}
	const first = 'A：先导出清单';
	assert.equal(chooseDecisionAnswers([{ options: [first, 'C：查看清单'] }])[0].value, first);
});

test('a negated structured hint does not explicitly select the disfavored letter', () => {
	const options = ['A：完整交付', 'B：暂缓'];
	assert.equal(chooseDecisionAnswers([{ options, recommendation: '不推荐 B' }])[0].value, options[0]);
});
