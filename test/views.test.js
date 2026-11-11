import test from 'node:test';
import assert from 'node:assert/strict';
import { boardView, quadrantsView, taskCard } from '../lib/host/views.js';

const now = Date.UTC(2026, 10, 9, 8, 0, 0);
const old = now - 10 * 24 * 60 * 60 * 1000;

function task(id, overrides = {}) {
	return {
		id,
		number: Number(id.slice(1)),
		title: `Task ${id}`,
		status: 'pending',
		ownerId: 'a1',
		accountableOwnerId: 'a1',
		assigneeId: null,
		blockedBy: [],
		claimHistory: [],
		evidence: [],
		revision: 1,
		irreversible: false,
		updatedAt: now - 60_000,
		acceptedAt: null,
		tombstone: false,
		...overrides,
	};
}

const state = {
	lastSeq: 10,
	members: {
		h1: { id: 'h1', name: 'Human', kind: 'human', status: 'idle' },
		a1: { id: 'a1', name: '沈舟', kind: 'agent', status: 'running' },
		a2: { id: 'a2', name: '林岚', kind: 'agent', status: 'idle' },
	},
	tasks: {
		t1: task('t1', { status: 'in_progress', assigneeId: 'a1' }),
		t2: task('t2', { blockedBy: ['t1'], updatedAt: now - 120_000 }),
		t3: task('t3', {
			status: 'pending_acceptance',
			assigneeId: 'a1',
			claimHistory: ['a1', 'a2'],
			updatedAt: now - 30_000,
		}),
		t4: task('t4', {
			status: 'pending_acceptance',
			irreversible: true,
			updatedAt: now - 20_000,
		}),
		t5: task('t5', {
			status: 'pending_acceptance',
			assigneeId: 'a1',
			claimHistory: ['a1'],
			updatedAt: now - 10_000,
		}),
		t6: task('t6', { status: 'done', updatedAt: now - 60_000, acceptedAt: now - 60_000 }),
		t7: task('t7', { status: 'done', updatedAt: old, acceptedAt: old }),
		t8: task('t8', { status: 'pending' }),
		t9: task('t9', { ownerId: 'h1', blockedBy: ['t1'] }),
	},
	threads: { t1: { headSeq: 2 } },
	inbox: {
		in1: { id: 'in1', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: now - 40_000, ref: { taskId: 't3' } },
		in2: { id: 'in2', memberId: 'a1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: now - 40_000, ref: {} },
		in3: { id: 'in3', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: now - 30_000, ref: { category: 'thread_mention', title: '进度汇报' } },
	},
	followers: { t1: ['h1'] },
};

test('taskCard carries owner, assignee, reply count, blocked and following', () => {
	const card = taskCard(state, state.tasks.t1);
	assert.equal(card.owner, '沈舟');
	assert.equal(card.assignee, '沈舟');
	assert.equal(card.replies, 2);
	assert.equal(card.following, true);
	assert.equal(card.blocked, false);
});

test('boardView groups four columns, keeps blocked as badge, and caps done', () => {
	const board = boardView(state, { doneLimit: 1 });
	assert.deepEqual(board.columns.todo.map((item) => item.id), ['t2', 't8', 't9']);
	assert.deepEqual(board.columns.in_progress.map((item) => item.id), ['t1']);
	assert.deepEqual(board.columns.pending_acceptance.map((item) => item.id), ['t3', 't4', 't5']);
	assert.deepEqual(board.columns.done.map((item) => item.id), ['t6']);
	assert.deepEqual(board.counts, { todo: 3, in_progress: 1, pending_acceptance: 3, done: 2 });
	assert.equal(board.blockedCount, 2);
	assert.equal(board.doneHasMore, true);
	assert.equal(board.columns.todo[0].blocked, true);
});

test('quadrantsView puts each task in one quadrant and Q1 only where Human must act', () => {
	const view = quadrantsView(state, { now, humanMemberId: 'h1', q4Days: 7, q4Limit: 20 });
	assert.equal(view.q1.count, 4);
	assert.deepEqual(view.q1.items.map((item) => item.category), ['irreversible', 'review', 'decision', 'owner_blocked']);
	assert.equal(view.q1.items.some((item) => item.title === '进度汇报'), false);
	assert.equal(view.q2.count, 1);
	assert.deepEqual(view.q2.items.map((item) => item.taskId), ['t1']);
	assert.equal(view.q3.count, 1);
	assert.deepEqual(view.q3.items.map((item) => item.taskId), ['t2']);
	assert.equal(view.q4.count, 1);
	assert.deepEqual(view.q4.items.map((item) => item.taskId), ['t6']);
	assert.equal(view.q4.total, 1);
	const ids = [...view.q1.items, ...view.q2.items, ...view.q3.items, ...view.q4.items]
		.filter((item) => item.kind === 'task')
		.map((item) => item.taskId);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(ids.includes('t5'), false);
	assert.equal(ids.includes('t8'), false);
	assert.equal(ids.includes('t7'), false);
});

test('quadrantsView honours q4Limit while q4 totals stay exact', () => {
	const many = { ...state, tasks: {} };
	for (let index = 0; index < 8; index += 1) {
		const id = `t${index + 1}`;
		many.tasks[id] = task(id, { status: 'done', acceptedAt: now - index * 1000, updatedAt: now - index * 1000 });
	}
	const wide = quadrantsView(many, { now, humanMemberId: 'h1' });
	assert.equal(wide.q4.total, 8);
	assert.equal(wide.q4.count, 8);
	assert.equal(wide.q4.items.length, 8, 'default limit is 20, so every recent completion is returned');

	const narrow = quadrantsView(many, { now, humanMemberId: 'h1', q4Limit: 3 });
	assert.equal(narrow.q4.total, 8, 'totals ignore the display limit');
	assert.equal(narrow.q4.count, 8);
	assert.equal(narrow.q4.items.length, 3);
	assert.equal(narrow.q4.limit, 3);
});

test('taskCard exposes the submission and completion fields the panels read', () => {
	const submitted = task('t9', {
		status: 'pending_acceptance',
		summary: '迁移完成',
		evidence: [{ kind: 'text', value: 'npm test 172/172' }, 'commit 926f320'],
	});
	const card = taskCard(state, submitted);
	assert.equal(card.submission.summary, '迁移完成');
	assert.deepEqual(card.submission.evidence, [
		{ label: 'npm test 172/172', ref: '' },
		{ label: 'commit 926f320', ref: '' },
	]);
	assert.equal(card.evidenceCount, 2);

	const accepted = task('t10', {
		status: 'done',
		acceptedAt: now - 1000,
		acceptedBy: undefined,
		reviewerId: 'a1',
	});
	const done = taskCard(state, accepted);
	assert.equal(done.completedAt, now - 1000);
	assert.equal(done.acceptedBy, '沈舟', 'renders the reviewer NAME, which is what the panel prints');
	assert.equal(done.submission, null, 'a task without a submission reports null, not an empty shell');
});
