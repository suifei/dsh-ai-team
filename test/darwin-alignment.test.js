/**
 * Darwin 对齐测试：9 维 rubric（triage）+ paired 独立 judge 协议 + adopt 门。
 *
 * 对照 alchaincyf/darwin-skill v2.1：
 * - 绝对分只做 triage，keep/revert 由 paired 同-judge 多数决决定；
 * - 无有效投票 / 无法验证 → 拒绝 adopt（unverified adopt is refused）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NINE_DIMENSIONS, scoreSkillRubric, formatRubric } from '../lib/skillopt/rubric.js';
import { buildPairPrompt, decideByMajority, normalizeVoteCount, parseJudgeOutput, voteFromParsed } from '../lib/skillopt/judge.js';
import { judgePair } from '../lib/skillopt/judge-runner.js';
import { createAdoptGate, wrapToolsWithAdoptGate } from '../lib/skillopt/adopt-gate.js';
import { awaitActivationText, extractAssistantText } from '../lib/skillopt/subagent-text.js';

// ── rubric ──────────────────────────────────────────────────────────────
const GOOD_SKILL = [
	'---',
	'name: good-skill',
	'description: 生成发布说明。触发词：发版说明、release notes。适用场景：版本发布前。',
	'---',
	'# Good Skill',
	'',
	'## 步骤',
	'1. 读取变更日志，输出 `CHANGELOG.md` 片段（--conventional 模式）。',
	'2. 校验版本号与 tag 一致，否则报错。',
	'3. 生成 `docs/release.md`，10s 内完成。',
	'',
	'## 失败处理',
	'如果 git tag 缺失 → 提示创建 tag 并中止。',
	'如果 CHANGELOG 为空 → fallback 到 git log 摘要。',
	'异常处理：网络失败重试 2 次。',
	'',
	'🔴 CHECKPOINT：发布前必须人工确认。',
	'🛑 STOP：版本号不一致时停止。',
	'',
	'## 反例（不要做）',
	'- 不要直接改 main 分支。',
	'- 禁止跳过 tag 校验。',
	'',
	'## 结构',
	'### 输入',
	'### 输出',
	'### 限制',
].join('\n');

const WEAK_SKILL = [
	'# weak',
	'可以试试看，建议根据情况灵活把握，视情况而定，酌情处理。',
	'说白了就是随便写写，换句话说差不多就行。',
].join('\n');

test('rubric: strong skill scores high on structure dims; absolute total is triage-only', () => {
	const result = scoreSkillRubric(GOOD_SKILL, { dim8: 7, measured: true });
	assert.equal(result.dimensions.length, 9, 'nine dimensions');
	assert.equal(result.triageOnly, true);
	assert.equal(result.evaluated, true);
	const byId = new Map(result.dimensions.map((dimension) => [dimension.id, dimension]));
	assert.ok(byId.get(1).score >= 8, 'frontmatter with triggers scores high');
	assert.ok(byId.get(3).score >= 8, 'explicit failure branches score high');
	assert.ok(byId.get(4).score >= 8, 'explicit checkpoints score high');
	assert.ok(byId.get(9).score >= 8, 'counterexample section scores high');
	assert.ok(result.total > 70, `total should be high, got ${result.total}`);
});

test('rubric: weak skill is penalized on specificity/failure/checkpoint dims', () => {
	const result = scoreSkillRubric(WEAK_SKILL);
	const byId = new Map(result.dimensions.map((dimension) => [dimension.id, dimension]));
	assert.ok(byId.get(3).score <= 3, 'no failure branches');
	assert.ok(byId.get(4).score <= 3, 'no explicit checkpoints');
	assert.ok(byId.get(5).score <= 4, 'soft wording penalty');
	assert.ok(byId.get(9).score <= 3, 'no counterexample section');
	assert.ok(result.total < 45, `total should be low, got ${result.total}`);
	assert.equal(result.evaluated, false, 'dim8 dry-run by default');
	const text = formatRubric(result);
	assert.match(text, /TRIAGE-ONLY/, 'output must warn that absolute scores are triage-only');
});

test('rubric: dimensions carry the darwin weights (100 total)', () => {
	const sum = NINE_DIMENSIONS.reduce((total, dimension) => total + dimension.weight, 0);
	assert.equal(sum, 100);
});

// ── judge protocol ──────────────────────────────────────────────────────
test('judge: prompts hide which version is newer (A/B randomized) and parsing is tolerant', () => {
	const ab = buildPairPrompt({ before: 'OLD', after: 'NEW', order: 'ab' });
	assert.equal(ab.mapping.aIsAfter, false);
	assert.match(ab.prompt, /版本 A[\s\S]*OLD[\s\S]*版本 B[\s\S]*NEW/);
	const ba = buildPairPrompt({ before: 'OLD', after: 'NEW', order: 'ba' });
	assert.equal(ba.mapping.aIsAfter, true);
	assert.match(ba.prompt, /版本 A[\s\S]*NEW[\s\S]*版本 B[\s\S]*OLD/);

	const parsed = parseJudgeOutput('```json\n{"better":"A","margin":"clear","reason":"more specific"}\n```');
	assert.deepEqual(parsed, { better: 'A', margin: 'clear', reason: 'more specific' });
	assert.equal(parseJudgeOutput('no json here'), null);
	assert.equal(parseJudgeOutput('{"better":"C"}'), null);
});

test('judge: votes map A/B back to after-version and majority decides keep/revert', () => {
	assert.equal(voteFromParsed({ better: 'A', margin: 'clear', aIsAfter: true }), 'better');
	assert.equal(voteFromParsed({ better: 'A', margin: 'clear', aIsAfter: false }), 'worse');
	assert.equal(voteFromParsed({ better: 'tie', margin: 'slight', aIsAfter: false }), 'tie');
	assert.equal(voteFromParsed(null), null);

	assert.equal(decideByMajority(['better', 'better', 'worse']).verdict, 'keep');
	assert.equal(decideByMajority(['worse', 'worse', 'better']).verdict, 'revert');
	assert.equal(decideByMajority(['tie', 'tie', 'better']).verdict, 'keep', 'tie counts on the keep side (darwin Step 5)');
	assert.equal(decideByMajority([null, null, null]).verdict, 'inconclusive', 'no valid votes cannot adopt');
	assert.equal(normalizeVoteCount(2), 3, 'even N rounds up to odd');
	assert.equal(normalizeVoteCount(5), 5);
});

test('judge-runner: spawns N independent subagents and aggregates majority', async () => {
	const activations = [];
	const judgeText = '{"better":"A","margin":"clear","reason":"clearer workflow"}';
	const subagents = {
		startActivation: async (spec) => {
			activations.push(spec);
			// 真实路径：输出来自 handle.agent.session.snapshotEvents 的最后一个
			// 非空 assistant/message（不是 activation.result）。
			return {
				childId: 'judge-' + activations.length,
				handle: {
					agent: {
						status: 'idle',
						session: {
							snapshotEvents: () => [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: judgeText }] } } }],
						},
					},
				},
				dispose: async () => {},
			};
		},
	};
	// deterministic random: first two calls 'ba' (after=A → A better means better),
	// third 'ab' (after=B → A better means worse) -> 2 better / 1 worse -> keep
	let calls = 0;
	const random = () => (calls++ < 2 ? 0.9 : 0.1);
	const result = await judgePair({ before: 'OLD', after: 'NEW', subagents, parent: { id: 'p' }, provider: 'local', cwd: 'E:/works/probe', votes: 3, random });
	assert.equal(activations.length, 3, 'three independent judge activations');
	assert.equal(activations[0].label, 'skillopt-judge-1');
	assert.equal(activations[0].delivery, 'parent');
	assert.equal(result.verdict, 'keep');
	assert.equal(result.better, 2);
	assert.equal(result.worse, 1);
});

test('judge-runner: unparseable judge output becomes an invalid vote, not a pass', async () => {
	const subagents = {
		startActivation: async () => ({
			childId: 'j',
			handle: {
				agent: {
					status: 'idle',
					session: {
						snapshotEvents: () => [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'I think both are fine.' }] } } }],
					},
				},
			},
			dispose: async () => {},
		}),
	};
	const result = await judgePair({ before: 'a', after: 'b', subagents, parent: { id: 'p' }, provider: 'local', cwd: '.', votes: 3, random: () => 0.5 });
	assert.equal(result.verdict, 'inconclusive');
	assert.equal(result.valid, 0);
	assert.equal(result.errors.length, 3);
});

test('subagent-text: last non-empty assistant message wins; empty-content messages do not replace earlier output', () => {
	const events = [
		{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'first answer' }] } } },
		{ type: 'tool/call', data: {} },
		{ type: 'assistant/message', data: { message: { content: [] } } },
		{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'final answer' }] } } },
	];
	assert.equal(extractAssistantText(events), 'final answer');
	assert.equal(extractAssistantText([]), '', 'no messages -> empty');
	// stream fallback when no non-empty message exists.
	const streamed = [{ type: 'assistant/attempt', data: { stream: [{ text: 'par' }, { text: 'tial' }] } }];
	assert.equal(extractAssistantText(streamed), 'partial');
});

test('subagent-text: waiter returns on end event and on idle-with-events', async () => {
	const makeActivation = (events, status) => ({
		outputStart: 0,
		handle: { agent: { status, session: { snapshotEvents: () => events } } },
	});
	const ended = makeActivation([{ type: 'subagent/end', data: {} }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }], 'running');
	assert.equal(await awaitActivationText(ended, { pollMs: 1 }), 'done');
	const idle = makeActivation([{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'idle answer' }] } } }], 'idle');
	assert.equal(await awaitActivationText(idle, { pollMs: 1 }), 'idle answer');
});

// ── adopt gate ──────────────────────────────────────────────────────────
const gateDeps = (pair, verdict) => ({
	readPair: async () => pair,
	judge: async () => verdict,
});

test('adopt gate: keep verdict passes; revert and inconclusive refuse with reasons', async () => {
	const keep = createAdoptGate(gateDeps({ before: 'OLD', after: 'NEW', skillPath: 'SKILL.md' }, { verdict: 'keep', better: 3, worse: 0, ties: 0, valid: 3, votes: [] }));
	assert.equal(await keep({ project: '/p' }), null, 'keep passes');
	const revert = createAdoptGate(gateDeps({ before: 'OLD', after: 'NEW', skillPath: 'SKILL.md' }, {
		verdict: 'revert', better: 1, worse: 2, ties: 0, valid: 3,
		votes: [{ index: 2, vote: 'worse', reason: 'lost failure branches' }],
	}));
	const refused = await revert({ project: '/p' });
	assert.match(refused, /paired judge rejected/);
	assert.match(refused, /lost failure branches/);
	const inconclusive = createAdoptGate(gateDeps({ before: 'OLD', after: 'NEW', skillPath: 'SKILL.md' }, { verdict: 'inconclusive', better: 0, worse: 0, ties: 0, valid: 0, votes: [], errors: ['judge 1: timeout'] }));
	assert.match(await inconclusive({ project: '/p' }), /inconclusive/);
});

test('adopt gate: unverifiable state refuses (missing pair, judge failure, no project)', async () => {
	const missing = createAdoptGate(gateDeps({ before: null, after: null, skillPath: null }, { verdict: 'keep', better: 3, worse: 0, ties: 0, valid: 3, votes: [] }));
	assert.match(await missing({ project: '/p' }), /cannot verify/);
	const broken = createAdoptGate({
		readPair: async () => { throw new Error('engine status timed out'); },
		judge: async () => ({ verdict: 'keep', better: 3, worse: 0, ties: 0, valid: 3, votes: [] }),
	});
	assert.match(await broken({ project: '/p' }), /cannot read proposal/);
	const judgeDown = createAdoptGate({
		readPair: async () => ({ before: 'a', after: 'b', skillPath: 'SKILL.md' }),
		judge: async () => { throw new Error('subagent provider missing'); },
	});
	assert.match(await judgeDown({ project: '/p' }), /judge unavailable/);
	assert.match(await createAdoptGate(gateDeps({ before: 'a', after: 'b' }, { verdict: 'keep', better: 3, worse: 0, ties: 0, valid: 3, votes: [] }))({}), /project directory is required/);
});

test('adopt gate: wrapToolsWithAdoptGate intercepts only skillopt_adopt', async () => {
	const registered = [];
	const tools = { register: (definition, options) => { registered.push({ definition, options }); return () => {}; } };
	let originalCalls = 0;
	const original = { name: 'skillopt_adopt', execute: async () => { originalCalls++; return 'adopted'; } };
	const other = { name: 'skillopt_status', execute: async () => 'status' };
	const wrapped = wrapToolsWithAdoptGate(tools, async () => 'refused by judge');
	wrapped.register(original, {});
	wrapped.register(other, {});
	assert.equal(registered.length, 2);
	const blocked = await registered[0].definition.execute({ project: '/p' });
	assert.match(blocked, /refused by judge/);
	assert.equal(originalCalls, 0, 'engine never called when the gate refuses');
	const statusResult = await registered[1].definition.execute({});
	assert.equal(statusResult, 'status', 'other tools are untouched');
	// allow path: gate returns null -> original execute runs once.
	const allowedTools = [];
	const allowed = wrapToolsWithAdoptGate({ register: (definition) => { allowedTools.push(definition); return () => {}; } }, async () => null);
	allowed.register({ ...original }, {});
	assert.equal(await allowedTools[0].execute({ project: '/p' }), 'adopted');
	assert.equal(originalCalls, 1, 'engine called exactly once when the gate allows');
});
