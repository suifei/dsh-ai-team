/**
 * 独立 judge 执行器：用 DSH 的 subagent 起**一次性评审子代理**（与 darwin
 * 的「spawn 独立子 agent」同义），子代理上下文干净、不参与优化，天然杜绝
 * 「自己改自己评」的乐观偏差。
 *
 * 每个 judge 只做一次 A/B 盲评（顺序随机化），输出一行 JSON；本模块负责
 * 汇总成 paired 多数决 verdict。
 */
import { buildPairPrompt, decideByMajority, normalizeVoteCount, parseJudgeOutput, voteFromParsed } from './judge.js';
import { awaitActivationText } from './subagent-text.js';
import { activationSpec } from '../runtime/activation-spec.js';

const JUDGE_TIMEOUT_MS = 120_000;

/**
 * 起 N 个独立 judge 子代理做 paired 比较。
 *
 * @param {object} input
 * @param {string} input.before 改前全文
 * @param {string} input.after 改后全文
 * @param {object} input.subagents ctx.get('subagents')
 * @param {object} input.parent 父 Agent（插件 parentInfo.agent）
 * @param {string} input.provider subagent provider 名
 * @param {string} input.cwd judge 子代理工作目录
 * @param {number} [input.votes] 奇数票数（默认 3，平局可升 5）
 * @param {() => number} [input.random] 注入随机源（测试用；默认 Math.random）
 * @returns {Promise<{verdict:'keep'|'revert'|'inconclusive', better:number, worse:number, ties:number, valid:number, votes:Array, errors:string[]}>}
 */
export async function judgePair(input) {
	const {
		before, after, subagents, parent, provider, cwd,
		votes: requestedVotes, random = Math.random,
	} = input;
	if (typeof before !== 'string' || typeof after !== 'string') {
		throw new TypeError('judgePair needs before/after text');
	}
	if (typeof subagents?.startActivation !== 'function' || parent === undefined) {
		throw new Error('judge unavailable: subagent service or parent agent missing');
	}
	const votes = normalizeVoteCount(requestedVotes);
	const rows = [];
	const errors = [];
	for (let index = 0; index < votes; index++) {
		const order = random() < 0.5 ? 'ab' : 'ba';
		const { prompt, mapping } = buildPairPrompt({ before, after, order });
		let activation = null;
		try {
			activation = await subagents.startActivation(activationSpec({
				provider,
				label: `skillopt-judge-${index + 1}`,
				request: { cwd, prompt: [{ type: 'text', text: prompt }], parent },
				delivery: 'parent',
				signal: new AbortController().signal,
			}));
			const text = await awaitActivationText(activation, { timeoutMs: JUDGE_TIMEOUT_MS });
			const parsed = parseJudgeOutput(text);
			const vote = voteFromParsed(parsed === null ? null : { ...parsed, aIsAfter: mapping.aIsAfter });
			if (vote === null) errors.push(`judge ${index + 1}: unparseable output`);
			rows.push({ index: index + 1, order, vote, reason: parsed?.reason ?? '', margin: parsed?.margin ?? null });
		} catch (error) {
			errors.push(`judge ${index + 1}: ${error?.message ?? String(error)}`);
			rows.push({ index: index + 1, order, vote: null, reason: '', margin: null });
		} finally {
			try { await activation?.dispose?.(); } catch { /* already gone */ }
		}
	}
	const decision = decideByMajority(rows.map((row) => row.vote));
	return { ...decision, votes: rows, errors };
}
