import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_DIR, readPendingCalls, stepHandoff } from '../lib/skillopt/handoff-answerer.js';

// 与引擎 handoff_backend 写出的 pending.json 同形（il2c 实机：format / answers_dir / pending[]）。
function workspaceWith(ids, { runScript = true } = {}) {
	const ws = mkdtempSync(join(tmpdir(), 'handoff-'));
	const dir = join(ws, HANDOFF_DIR);
	mkdirSync(join(dir, 'answers'), { recursive: true });
	writePending(ws, ids);
	if (runScript) {
		mkdirSync(join(ws, '.skillopt-sleep'), { recursive: true });
		writeFileSync(join(ws, '.skillopt-sleep', 'run.ps1'), '# scheduled');
	}
	return ws;
}

function writePending(ws, ids) {
	const dir = join(ws, HANDOFF_DIR);
	writeFileSync(join(dir, 'pending.json'), JSON.stringify({
		format: 1,
		answers_dir: join(dir, 'answers'),
		pending: ids.map((id) => ({ id, answer_file: join(dir, 'answers', `${id}.md`), max_tokens: 800, prompt: `PROMPT ${id}` })),
	}));
}

function fakeHost({ reply = (prompt) => `answer to ${prompt.split('\n').at(-1)}` } = {}) {
	const children = new Map();
	const host = {
		clock: 1_000,
		started: [],
		reruns: [],
		rows: [],
		settleAll() {
			for (const child of children.values()) child.done = true;
		},
		deps: {
			now: () => host.clock,
			diag: (row) => host.rows.push(row),
			startChild: async (label, request) => {
				const childId = `c${children.size + 1}`;
				children.set(childId, { label, request, done: false });
				host.started.push({ childId, label, request });
				return { childId, outputStart: 0 };
			},
			observe: (childId) => {
				const child = children.get(childId);
				if (!child?.done) return { status: 'running', events: [] };
				return { status: 'idle', events: [{ type: 'assistant/message' }], text: reply(child.request.prompt) };
			},
			rerun: async (runScript) => {
				host.reruns.push(runScript);
				return { exitCode: 3 };
			},
		},
	};
	return host;
}

test('pending calls are read with their answer files', () => {
	const ws = workspaceWith(['a1', 'b2']);
	try {
		const calls = readPendingCalls(ws);
		assert.deepEqual(calls.map((call) => call.id), ['a1', 'b2']);
		assert.equal(calls[0].answerFile, join(ws, HANDOFF_DIR, 'answers', 'a1.md'));
		assert.equal(readPendingCalls(mkdtempSync(join(tmpdir(), 'handoff-none-'))), null);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test('each pending call is answered by its own one-shot child, then the scheduled run resumes once', async () => {
	const ws = workspaceWith(['a1', 'b2', 'c3', 'd4']);
	const host = fakeHost();
	try {
		let step = await stepHandoff({ workspace: ws, deps: { ...host.deps, concurrency: 3 } });
		assert.equal(step.status, 'answering');
		assert.equal(host.started.length, 3, 'concurrency cap');
		assert.ok(host.started.every((row) => row.label.startsWith('skillopt-reviewer-handoff-')));
		assert.ok(host.started.every((row) => row.request.cwd === ws));
		assert.equal(host.started[0].request.prompt, 'PROMPT a1', 'the engine prompt is passed verbatim, with no preamble');

		host.settleAll();
		step = await stepHandoff({ workspace: ws, deps: { ...host.deps, concurrency: 3 } });
		assert.equal(step.answered, 3);
		assert.equal(host.started.length, 4, 'the fourth call starts once a slot frees');
		assert.equal(readFileSync(join(ws, HANDOFF_DIR, 'answers', 'a1.md'), 'utf8'), 'answer to PROMPT a1\n');
		assert.deepEqual(host.reruns, []);

		host.settleAll();
		step = await stepHandoff({ workspace: ws, deps: { ...host.deps, concurrency: 3 } });
		assert.equal(step.status, 'rerun');
		assert.deepEqual(host.reruns, [join(ws, '.skillopt-sleep', 'run.ps1')]);

		// 引擎没换批（同样的题）：不得反复重跑，只记一次停滞。
		step = await stepHandoff({ workspace: ws, deps: host.deps });
		step = await stepHandoff({ workspace: ws, deps: host.deps });
		assert.equal(step.status, 'stalled');
		assert.equal(host.reruns.length, 1);
		assert.equal(host.rows.filter((row) => row.ev === 'skillopt.handoff.stalled').length, 1);

		// 引擎续跑后换了一批题：重新作答，再重跑一次。
		writePending(ws, ['e5']);
		await stepHandoff({ workspace: ws, deps: host.deps });
		host.settleAll();
		await stepHandoff({ workspace: ws, deps: host.deps });
		step = await stepHandoff({ workspace: ws, deps: host.deps });
		assert.equal(host.reruns.length, 2);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test('an empty or overdue answer is retried, then the batch is reported blocked instead of rerunning', async () => {
	const ws = workspaceWith(['a1']);
	const host = fakeHost({ reply: () => '   ' });
	try {
		await stepHandoff({ workspace: ws, deps: host.deps });
		host.settleAll();
		await stepHandoff({ workspace: ws, deps: host.deps }); // 空答：第 1 次失败，立即重问
		assert.equal(host.started.length, 2);
		host.clock += 16 * 60 * 1000; // 第二个子代理超时
		const step = await stepHandoff({ workspace: ws, deps: host.deps });
		assert.equal(step.status, 'blocked');
		assert.equal(existsSync(join(ws, HANDOFF_DIR, 'answers', 'a1.md')), false);
		assert.deepEqual(host.reruns, []);
		assert.deepEqual(host.rows.map((row) => row.ev).filter((ev) => ev !== 'skillopt.handoff.ask'), ['skillopt.handoff.empty', 'skillopt.handoff.timeout', 'skillopt.handoff.blocked']);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test('answers already on disk are kept; without a scheduled run script nothing is rerun', async () => {
	const ws = workspaceWith(['a1'], { runScript: false });
	const host = fakeHost();
	try {
		writeFileSync(join(ws, HANDOFF_DIR, 'answers', 'a1.md'), 'hand-written');
		const step = await stepHandoff({ workspace: ws, deps: host.deps });
		assert.equal(step.status, 'stalled');
		assert.equal(host.started.length, 0);
		assert.equal(readFileSync(join(ws, HANDOFF_DIR, 'answers', 'a1.md'), 'utf8'), 'hand-written');
		assert.deepEqual(host.reruns, []);
		assert.ok(host.rows.some((row) => row.ev === 'skillopt.handoff.rerun.skip'));
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});
