/**
 * 评审通道：darwin 的「独立 judge」在插件里改为**专用评审成员**——
 * 一个 role='评审' 的 agent 成员，不接任务，只做 A/B 盲评，用 team 工具把
 * 结构化 verdict 回帖到一张评审卡（thread），插件从账本读回帖。
 *
 * 为什么不用一次性子代理：工具 execute 内读不到 startActivation 的输出
 * （result 不 settle、agents/sessions 均不可见）。成员通道是插件既有且
 * 已验证的（wake.delivered 数千次）。
 */
import { decideByMajority, normalizeVoteCount, parseJudgeOutput } from './judge.js';

export const REVIEWER_ROLE = '评审';
export const REVIEWER_NAME = '评审官';

/** 评审 prompt（盲评两版，输出一行 JSON）。 */
export function buildReviewRequest({ before, after, order, jobId, taskId, baseSeq = 0, orderId = 'v1' }) {
	const aIsAfter = order === 'ba';
	const versionA = aIsAfter ? after : before;
	const versionB = aIsAfter ? before : after;
	const card = typeof taskId === 'string' && taskId !== '' ? taskId : '<taskId>';
	const verdict = `{"orderId":"${orderId}","better":"A","margin":"clear","reason":"一句话理由"}`;
	return [
		`【技能盲评 ${jobId}】你是独立评审。只做比较，不要修改任何文件。`,
		'',
		'准则（Darwin 9 维）：结构——Frontmatter质量/工作流清晰度/失败模式编码/检查点设计/可执行具体性/资源整合度；效果——整体架构/实测表现；Meta——反例与黑名单。',
		'加分：显式失败分支（如果 X 失败 → Y）、显性检查点（🔴/STOP/CHECKPOINT）、具体参数与示例、反例清单。',
		'减分：软化措辞（建议/可以考虑/根据情况/灵活把握/视情况而定）、空话（说白了/换句话说/首先其次/综上所述）。',
		'',
		'## 版本 A',
		versionA,
		'',
		'## 版本 B',
		versionB,
		'',
		'## 如何提交结论（必须用 team 工具，两步）',
		'1) 读取评审卡当前 headSeq：调用 team 工具',
		`   {"action":"thread","taskId":"${card}"}`,
		'2) 用拿到的 headSeq 回帖（body 里只放一行 JSON，**必须原样带上 orderId**）：',
		`   {"action":"reply","taskId":"${card}","baseSeq":${baseSeq},"body":"${verdict.replace(/"/g, '\\"')}"}`,
		`注意：action 必须是 "reply"（不是 thread.post），参数名是 taskId / baseSeq / body；body 里的 orderId 必须是 "${orderId}"，插件靠它把这一票对应到 A/B 顺序，缺了就无法计票。初始 baseSeq 通常为 ${baseSeq}，若第 1 步返回的 headSeq 不同，用返回的 headSeq。`,
		'除这次 team 回帖外不要做其它动作。',
	].join('\n');
}

/**
 * 从评审卡的 thread 条目里提取评审成员的票。
 * @param {Array<{authorId:string, body:string}>} entries
 * @param {string} reviewerId
 * @returns {Array<{vote:'better'|'worse'|'tie'|null, margin:string, reason:string, aIsAfter:boolean}>}
 */
export function parseReviewReplies(entries, reviewerId) {
	const votes = [];
	for (const entry of Array.isArray(entries) ? entries : []) {
		if (entry?.authorId !== reviewerId) continue;
		const parsed = parseJudgeOutput(entry.body ?? '');
		if (parsed === null) continue;
		// 每一票的 A/B 顺序由投递时决定；这里无法从回帖里恢复，调用方按投递顺序对齐。
		votes.push({ ...parsed });
	}
	return votes;
}

/**
 * 多数决（把票按投递时的顺序映射回 after 版本）。
 * @param {Array<{better:string, margin:string, aIsAfter:boolean}>} votes
 * @returns {{verdict:'keep'|'revert'|'inconclusive', better:number, worse:number, ties:number, valid:number}}
 */
export function decideReviewVotes(votes) {
	const mapped = votes.map((vote) => {
		if (vote.better === 'tie') return 'tie';
		const afterWon = (vote.better === 'A' && vote.aIsAfter === true) || (vote.better === 'B' && vote.aIsAfter === false);
		return afterWon ? 'better' : 'worse';
	});
	return decideByMajority(mapped);
}

/** 评审所需的投递数量（奇数，默认 3）。 */
export function reviewVoteCount(value) {
	return normalizeVoteCount(value);
}
