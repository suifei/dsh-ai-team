import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReview } from '../lib/skillopt/review-runner.js';

function stateWith(entries) {
	return { state: { threads: { card1: { taskId: 'card1', headSeq: entries.length, entries } } } };
}

const reply = (authorId, body) => ({ authorId, seq: 0, baseSeq: 0, body: JSON.stringify(body), at: 0 });

test('votes are attributed to their own A/B order regardless of reply order', () => {
	const service = stateWith([
		// v2 was delivered as 'ba' (A = after) → better=A means the candidate won.
		reply('rev', { orderId: 'v2', better: 'A', margin: 'clear' }),
		// v1 was delivered as 'ab' (A = before) → better=B means the candidate won.
		reply('rev', { orderId: 'v1', better: 'B', margin: 'slight' }),
	]);
	const job = {
		reviewTaskId: 'card1',
		reviewerId: 'rev',
		reviewOrders: [
			{ orderId: 'v1', order: 'ab', aIsAfter: false },
			{ orderId: 'v2', order: 'ba', aIsAfter: true },
		],
	};
	const collected = collectReview({ service, job });
	assert.equal(collected.votes.length, 2);
	assert.deepEqual(collected.votes.map((vote) => vote.aIsAfter), [true, false]);
	assert.equal(collected.decision.verdict, 'keep');
});

test('duplicate and unattributable replies never inflate or shift the ballot', () => {
	const service = stateWith([
		reply('rev', { orderId: 'v1', better: 'A', margin: 'clear' }),
		reply('rev', { orderId: 'v1', better: 'A', margin: 'clear' }), // duplicate vote
		reply('rev', { orderId: 'v9', better: 'A', margin: 'clear' }), // unknown order
		reply('someone-else', { orderId: 'v2', better: 'A', margin: 'clear' }),
	]);
	const job = {
		reviewTaskId: 'card1',
		reviewerId: 'rev',
		reviewOrders: [
			{ orderId: 'v1', order: 'ab', aIsAfter: false },
			{ orderId: 'v2', order: 'ba', aIsAfter: true },
		],
	};
	const collected = collectReview({ service, job });
	assert.equal(collected.votes.length, 1, 'only one attributable, non-duplicate vote');
	assert.equal(collected.expected, 2, 'the caller still waits for the missing ballot');
});

test('votes never exceed the number of review requests', () => {
	const orders = ['v1', 'v2', 'v3'].map((orderId) => ({ orderId, order: 'ab', aIsAfter: false }));
	const service = stateWith(['v1', 'v2', 'v3', 'v4', 'v5'].map((orderId) => reply('rev', { orderId, better: 'A' })));
	const collected = collectReview({ service, job: { reviewTaskId: 'card1', reviewerId: 'rev', reviewOrders: orders } });
	assert.equal(collected.votes.length, 3);
	assert.equal(collected.expected, 3);
});
