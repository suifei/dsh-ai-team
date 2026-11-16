// SkillOpt-Sleep 的 `dsh` 会话来源：让夜间环能从 DeepSeek Harness 的会话（含文渊阁成员）里学习。
// 实机（il2c，11-16）：引擎只认 claude/codex/... 等来源，DSH 会话一条也读不到；agent 写进 config 的
// transcript_source 'dsh_team' 让引擎每晚报 Unknown transcript source。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

const vendor = fileURLToPath(new URL('../lib/vendor/skillopt', import.meta.url));
const python = process.env.SKILLOPT_PYTHON ?? 'python';
const hasPython = spawnSync(python, ['--version'], { encoding: 'utf8' }).status === 0;
const skip = hasPython ? false : 'python is not available';

const T0 = Date.parse('2026-11-16T02:00:00Z');
const header = (id, cwd, extra = {}) => ({ type: 'session', version: 4, id, createdAt: T0, cwd, ...extra });
const ev = (type, seq, data) => ({ type, seq, time: T0 + seq * 60_000, data });
const user = (seq, text, kind = 'user') => ev('user/message', seq, { id: `u${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind } });
const assistant = (seq, blocks) => ev('assistant/message', seq, { turn: 1, step: seq, message: { role: 'assistant', content: blocks }, stream: [] });

/** session.v4.jsonl.zstd as DSH writes it: one zstd frame per flush, optionally with a torn tail. */
function writeSession(home, key, records, { torn = false, mtime } = {}) {
	const dir = join(home, 'sessions', key, records[0].id);
	mkdirSync(dir, { recursive: true });
	const lines = records.map((r) => `${JSON.stringify(r)}\n`);
	const half = Math.ceil(lines.length / 2);
	const frames = [zstdCompressSync(Buffer.from(lines.slice(0, half).join(''))), zstdCompressSync(Buffer.from(lines.slice(half).join('')))];
	if (torn) {
		const partial = zstdCompressSync(Buffer.from(`${JSON.stringify(ev('assistant/message', 99, {}))}\n`));
		frames.push(partial.subarray(0, Math.floor(partial.length / 2)));
	}
	const file = join(dir, 'session.v4.jsonl.zstd');
	writeFileSync(file, Buffer.concat(frames));
	if (mtime !== undefined) utimesSync(file, mtime / 1000, mtime / 1000);
	return file;
}

function harvest(home, project, since = '') {
	const run = spawnSync(python, ['-X', 'utf8', '-c', [
		'import json, sys',
		`sys.path.insert(0, ${JSON.stringify(vendor)})`,
		'from skillopt_sleep.harvest_dsh import harvest_dsh',
		`ds = harvest_dsh(${JSON.stringify(join(home, 'sessions'))}, node=${JSON.stringify(process.execPath)}, scope="invoked", invoked_project=${JSON.stringify(project)}, since_iso=${JSON.stringify(since)} or None)`,
		'print(json.dumps([d.to_dict() for d in ds], ensure_ascii=False))',
	].join('\n')], { encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr);
	return JSON.parse(run.stdout);
}

test('dsh source digests the sessions opened in the project, member sessions included', { skip }, () => {
	const home = mkdtempSync(join(tmpdir(), 'skillopt-dsh-'));
	const workspace = join(home, 'ws', 'il2c');
	try {
		writeSession(home, '--ws-il2c--', [
			header('member-1', workspace.replaceAll('\\', '/'), { parentSession: 'session-team-host-x', origin: 'subagent' }),
			ev('turn/start', 1, { turn: 1 }),
			// 文渊阁的任务唤醒以 agent-message relay 投递（il2c 实测：成员会话 37 条 relay、1 条 user）。
			user(2, 'Agent lead sent a message: 【Task 边界】[青岚] Team event: #3 修复 csvstat 门禁，结果定义：verify.ps1 -Only csvstat 通过', 'agent-message'),
			user(3, '<system-reminder>skills available</system-reminder>', 'skill-catalog'),
			user(4, 'Time sampled while preparing turn 1, step 1: 2026-11-16T10:00:00+08:00', 'time-context'),
			assistant(5, [{ type: 'reasoning', text: '私有推理，不得进入摘要' }, { type: 'text', text: '已修复，今夜 03:17 再复核一次。' }]),
			ev('tool/call', 6, { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"secret args"}' }),
			user(7, '【文渊阁·推进纪律】你刚才把行动推迟到了一个自然时间点：「今夜 03:17 再复核」。', 'ai-team'),
			ev('tool/call', 8, { turn: 1, step: 2, callId: 'c2', name: 'team', arguments: '{}' }),
			user(9, 'Background subagent x finished and will do no further work unless you send it more.', 'subagent-settled'),
			user(10, '不对，还是失败，重新跑一遍'),
			assistant(11, [{ type: 'text', text: '重跑后通过。' }]),
		], { torn: true });
		writeSession(home, '--elsewhere--', [
			header('other-1', join(home, 'ws', 'other').replaceAll('\\', '/')),
			user(1, '别的项目的请求'),
			assistant(2, [{ type: 'text', text: 'ok' }]),
		]);

		const digests = harvest(home, workspace);
		assert.deepEqual(digests.map((d) => d.session_id), ['member-1'], 'only the project’s sessions');
		const [d] = digests;
		assert.equal(d.n_user_turns, 3, 'task relay, plugin correction and the human prompt; host bookkeeping is not intent');
		assert.match(d.user_prompts[0], /^【Task 边界】.*修复 csvstat 门禁/, 'relay prefix removed');
		assert.ok(d.feedback_signals.includes('neg:ai-team-correction'), 'a plugin correction marks the previous reply as wrong');
		assert.deepEqual(d.tools_used, ['pwsh', 'team']);
		assert.equal(d.n_assistant_turns, 2, 'the torn tail frame of a live session is ignored');
		assert.ok(d.assistant_finals.every((t) => !t.includes('私有推理')), 'reasoning stays private');
		assert.ok(!JSON.stringify(d).includes('secret args'), 'tool arguments are never copied');
		assert.match(d.started_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/, 'local timestamps in the engine’s since_iso format');
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test('dsh source skips logs not written since the last harvest without decoding them', { skip }, () => {
	const home = mkdtempSync(join(tmpdir(), 'skillopt-dsh-'));
	const workspace = join(home, 'ws', 'p');
	try {
		const old = Date.parse('2026-11-01T00:00:00');
		writeSession(home, '--p--', [header('old-1', workspace), user(1, '旧请求'), assistant(2, [{ type: 'text', text: 'ok' }])], { mtime: old });
		writeSession(home, '--p--', [header('new-1', workspace), user(1, '新请求'), assistant(2, [{ type: 'text', text: 'ok' }])]);
		const ids = harvest(home, workspace, '2026-11-10T00:00:00').map((d) => d.session_id);
		assert.deepEqual(ids, ['new-1']);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test('dsh source mines the request, not the member identity block that prefixes AI-team activations', { skip }, async () => {
	const { memberIdentity } = await import('../lib/domain/member-profile.js');
	const home = mkdtempSync(join(tmpdir(), 'skillopt-dsh-'));
	const workspace = join(home, 'ws', 'p');
	try {
		const identity = memberIdentity({ name: '墨渊', role: '主理人', personality: '先定义可验收的结果，再拆 Task。', skills: ['ai-team-core'], notes: ['test'] });
		writeSession(home, '--p--', [
			header('lead-1', workspace),
			user(1, `${identity}\n\n[墨渊] Team event: 本批任务已全部验收，向 Human 汇报结果。`),
			assistant(2, [{ type: 'text', text: '已汇报。' }]),
			user(3, `${memberIdentity({ name: '墨渊', role: '主理人' })}\n\n下一批：补齐 csvstat 的边界用例。`),
			assistant(4, [{ type: 'text', text: '已开卡。' }]),
		]);
		const [d] = harvest(home, workspace);
		assert.deepEqual(d.user_prompts, ['[墨渊] Team event: 本批任务已全部验收，向 Human 汇报结果。', '下一批：补齐 csvstat 的边界用例。']);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test('dsh is a supported transcript source; the CLI accepts it', { skip }, () => {
	const run = spawnSync(python, ['-X', 'utf8', '-c', [
		'import sys',
		`sys.path.insert(0, ${JSON.stringify(vendor)})`,
		'from skillopt_sleep.harvest_sources import normalize_transcript_source',
		'print(normalize_transcript_source(" DSH "))',
	].join('\n')], { encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stdout.trim(), 'dsh');
});

test('schtasks output is decoded in the console code page, so UTF-8 mode still lists tasks', { skip: process.platform !== 'win32' ? 'Windows only' : skip }, () => {
	const run = spawnSync(python, ['-X', 'utf8', '-c', [
		'import sys',
		`sys.path.insert(0, ${JSON.stringify(vendor)})`,
		'from skillopt_sleep import scheduler',
		'print(scheduler._console_encoding())',
		'proc = scheduler._run_schtasks(["/query", "/fo", "csv"])',
		'print(proc.returncode, proc.stdout is not None and len(proc.stdout) > 0)',
		'print(type(scheduler._list_win_tasks()).__name__)',
	].join('\n')], { encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr);
	assert.doesNotMatch(run.stderr, /UnicodeDecodeError/, 'the reader thread must not fail on non-UTF-8 console output');
	const [encoding, query, listed] = run.stdout.trim().split(/\r?\n/);
	assert.match(encoding, /^cp\d+$/);
	assert.equal(query, '0 True', 'schtasks /query output reaches Python');
	assert.equal(listed, 'list');
});
