import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyView } from '../lib/host/weekly-view.js';
import { findReportPath } from '../lib/host/decision-report.js';

const now = 1_800_000_000_000;

test('weekly view counts only Human-answered decisions, not PMO auto answers', () => {
	const state = {
		humanMemberId: 'h1',
		members: { h1: { id: 'h1', kind: 'human' }, a1: { id: 'a1', kind: 'agent' } },
		tasks: {},
		threads: {},
		projects: { p1: { id: 'p1', name: 'P' } },
		inbox: {
			auto: {
				id: 'auto', memberId: 'h1', type: 'decision_required', requiresDecision: true,
				state: 'resolved', ackedAt: now - 1000, decision: { answers: [], auto: true, by: 'mem_pmo' },
			},
			human: {
				id: 'human', memberId: 'h1', type: 'decision_required', requiresDecision: true,
				state: 'resolved', ackedAt: now - 1000, decision: { answers: [{ id: 'q1', value: 'A' }] },
			},
		},
	};
	const view = weeklyView(state, { now, weeks: 1 });
	assert.equal(view.decisionsAnswered, 1, 'the PMO auto answer is not a Human touch');
});

test('findReportPath accepts forward slashes, quotes and spaces', () => {
	assert.equal(findReportPath('见 E:/works/il2c/docs/报告.md'), 'E:/works/il2c/docs/报告.md');
	assert.equal(findReportPath('见 "E:\\works\\my docs\\report 01.md" 第 6 节'), 'E:\\works\\my docs\\report 01.md');
	assert.equal(findReportPath('见 `E:/works/a b/c.md`'), 'E:/works/a b/c.md');
	assert.equal(findReportPath('没有路径'), null);
	// 取最后一个：模型常先给示例路径、再给真实路径
	assert.equal(findReportPath('示例 D:/tmp/a.md，实际 E:/works/real.md'), 'E:/works/real.md');
});
