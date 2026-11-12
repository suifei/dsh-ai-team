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
