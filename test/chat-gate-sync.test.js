/**
 * chatGate 自动收敛规划测试（纯函数）：
 * - 空闲成员进入 reseat、忙碌成员进 busy（绝不打断回合）、冷会话进 cold
 * - retired 跳过；每轮 limit 上限（默认 2）
 * - 空/异常输入安全
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planChatGateReseats } from '../lib/host/chat-gate-sync.js';

const members = [
	{ id: 'a1', sessionId: 's1', status: 'idle' },
	{ id: 'a2', sessionId: 's2', status: 'running' },
	{ id: 'a3', sessionId: null, status: 'idle' },
	{ id: 'a4', sessionId: 's4', status: 'retired' },
	{ id: 'a5', sessionId: 's5', status: 'idle' },
];

const liveStatus = (sessionId) => ({ s1: 'idle', s2: 'running', s4: null, s5: 'idle' }[sessionId] ?? null);

test('plan: idle members reseat (bounded by limit), busy skipped, cold and retired excluded', () => {
	const plan = planChatGateReseats(members, liveStatus, { limit: 2 });
	assert.deepEqual(plan.reseat, ['a1', 'a5'], 'two idle members, capped by limit');
	assert.deepEqual(plan.busy, ['a2'], 'running member is never reseated');
	assert.deepEqual(plan.cold, ['a3'], 'never-activated member needs no reseat');
	assert.equal(plan.reseat.includes('a4'), false, 'retired member is skipped');
});

test('plan: limit 1 and empty inputs behave', () => {
	const plan = planChatGateReseats(members, liveStatus, { limit: 1 });
	assert.deepEqual(plan.reseat, ['a1'], 'limit respected');
	assert.deepEqual(planChatGateReseats([], () => null).reseat, []);
	assert.deepEqual(planChatGateReseats([null, undefined], () => null).reseat, []);
});

test('plan: live status null (cold session) still allows reseat of a member that has a sessionId', () => {
	// 会话已释放但账本仍记着 id：宿主 get 返回 null → 视为可重建（安全重建）。
	const plan = planChatGateReseats([{ id: 'a9', sessionId: 's9', status: 'idle' }], () => null, { limit: 2 });
	assert.deepEqual(plan.reseat, ['a9']);
});
