/**
 * Darwin Skill 2.1 的 keep/revert 判据：**paired 同-judge 比较 + 奇数 N 多数决**。
 *
 * 为什么不比绝对分数：LLM judge 的绝对分住在「文字 × 该 judge 当下的标准尺」
 * 里，不是文字属性——同一份未改文字换 judge 可摆 ±8，保守编辑的真实增益
 * (+3~8) 会被换尺噪音淹没（darwin 实测 false-revert 来源）。paired 让同一个
 * judge 在一次调用内读两版，用同一把不准的尺量两版，比较时误差相减抵销
 * （within-judge cancellation）。
 *
 * 本模块只含协议与纯函数：A/B 随机化、prompt 构造、多数决、tie/margin 聚合。
 * 真正的 judge 是**独立子代理**（不在优化器上下文里自评自改）——由调用方注入。
 */

/** 三次调用（奇数 N）的开销上限：N 必须是奇数，3 为默认，接近平局升 5。 */
export const DEFAULT_JUDGE_VOTES = 3;

const VERDICTS = new Set(['better', 'worse', 'tie']);

/**
 * 盲评 prompt：不告诉 judge 哪版是"新版本"，只看两版与 rubric 准则。
 * @param {{before: string, after: string, order: 'ab'|'ba'}} input
 * @returns {{prompt: string, mapping: {aIsAfter: boolean}}}
 */
export function buildPairPrompt({ before, after, order }) {
	const aIsAfter = order === 'ba';
	const versionA = aIsAfter ? after : before;
	const versionB = aIsAfter ? before : after;
	const prompt = [
		'你是独立的技能质量评审（judge）。只做比较，不要改写任何文件。',
		'',
		'## 评估准则（Darwin 9 维 rubric）',
		'结构：1 Frontmatter质量 7 · 2 工作流清晰度 12 · 3 失败模式编码 12 · 4 检查点设计 6 · 5 可执行具体性 18 · 6 资源整合度 4',
		'效果：7 整体架构 12 · 8 实测表现 23',
		'Meta：9 反例与黑名单 6',
		'注意：明确写出失败分支（如果 X 失败 → Y）、显性检查点（🔴/STOP/CHECKPOINT）、具体参数与示例、反例清单者更优；',
		'软化措辞（建议/可以考虑/根据情况/灵活把握/视情况而定）与空话（说白了/换句话说/首先其次/综上所述）是减分项。',
		'',
		'## 版本 A',
		versionA,
		'',
		'## 版本 B',
		versionB,
		'',
		'只输出一行 JSON：{"better":"A"|"B"|"tie","margin":"clear"|"slight","reason":"一句话理由"}',
	].join('\n');
	return { prompt, mapping: { aIsAfter } };
}

/**
 * 解析 judge 输出：容忍代码围栏与前后噪声，只认 better/margin/reason。
 * @param {string} output
 * @returns {{better: 'A'|'B'|'tie', margin: 'clear'|'slight', reason: string} | null}
 */
export function parseJudgeOutput(output) {
	const text = typeof output === 'string' ? output : '';
	// 逐个尝试文本里的 JSON 对象：模板回显/前置示例会让第一个 `{...}` 不是结论，
	// 只解析第一处会在合规输出上直接判 null（等于丢掉这一票）。
	const readObjectAt = (start) => {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let index = start; index < text.length; index += 1) {
			const char = text[index];
			if (inString) {
				if (escaped) escaped = false;
				else if (char === '\\') escaped = true;
				else if (char === '"') inString = false;
				continue;
			}
			if (char === '"') { inString = true; continue; }
			if (char === '{') depth += 1;
			else if (char === '}') {
				depth -= 1;
				if (depth === 0) return text.slice(start, index + 1);
			}
		}
		return null;
	};
	let found = null;
	for (let at = text.indexOf('{'), attempts = 0; at !== -1 && attempts < 20; at = text.indexOf('{', at + 1), attempts += 1) {
		const candidate = readObjectAt(at);
		if (candidate === null) continue;
		let row;
		try { row = JSON.parse(candidate); } catch { continue; }
		if (row?.better !== 'A' && row?.better !== 'B' && row?.better !== 'tie') continue;
		// 取**最后**一个合法结论：模型常先回显模板或示例，真正的判决写在末尾。
		found = {
			better: row.better,
			margin: row.margin === 'clear' ? 'clear' : 'slight',
			reason: typeof row.reason === 'string' ? row.reason.slice(0, 300) : '',
			// 评审通道的回帖带 orderId（这一票对应哪一个 A/B 顺序）；judge 通道没有
			// 这个字段，忽略即可。保留它才能让两条通道共用同一个解析器。
			...(typeof row.orderId === 'string' && row.orderId !== '' ? { orderId: row.orderId } : {}),
		};
	}
	return found;
}

/**
 * 把一次 judge 的输出转成「改后是否不差」的投票（keep 的依据）。
 * @param {{better:string, margin:string, aIsAfter:boolean}|null} parsed
 * @returns {'better'|'worse'|'tie'|null}
 */
export function voteFromParsed(parsed) {
	if (parsed === null || parsed === undefined) return null;
	if (parsed.better === 'tie') return 'tie';
	const afterIsA = parsed.aIsAfter === true;
	const afterWon = (parsed.better === 'A' && afterIsA) || (parsed.better === 'B' && !afterIsA);
	return afterWon ? 'better' : 'worse';
}

/**
 * 多数决：keep 当且仅当 better ≥ worse（含 tie）——与 darwin Phase 2 Step 5 一致。
 * 无效投票（null）不计数；全部无效时判 'inconclusive'（不得据此 adopt）。
 *
 * 有效票**必须过半**：3 票里只剩 1 票 better、另 2 票超时/不可解析时，1-0
 * 也是「better ≥ worse」，会把一次几乎没验成的改动判成 keep。
 * @param {Array<'better'|'worse'|'tie'|null>} votes
 * @param {{minValid?: number}} [options]
 * @returns {{verdict: 'keep'|'revert'|'inconclusive', better:number, worse:number, ties:number, valid:number, required:number}}
 */
export function decideByMajority(votes, options = {}) {
	const valid = votes.filter((vote) => vote === 'better' || vote === 'worse' || vote === 'tie');
	const better = valid.filter((vote) => vote === 'better').length;
	const worse = valid.filter((vote) => vote === 'worse').length;
	const ties = valid.filter((vote) => vote === 'tie').length;
	// 默认要求 ceil(n/2)：3 票至少 2 票有效、5 票至少 3 票有效。
	const required = Number.isSafeInteger(options.minValid)
		? Math.max(1, options.minValid)
		: Math.max(1, Math.ceil(Array.isArray(votes) ? votes.length / 2 : 1));
	if (valid.length === 0) return { verdict: 'inconclusive', better, worse, ties, valid: 0, required };
	if (valid.length < required) return { verdict: 'inconclusive', better, worse, ties, valid: valid.length, required };
	return { verdict: better >= worse ? 'keep' : 'revert', better, worse, ties, valid: valid.length, required };
}

/** 校验投票数：奇数且 ≥3（close call 可升 5）。 */
export function normalizeVoteCount(count) {
	const value = Number.isSafeInteger(count) ? count : DEFAULT_JUDGE_VOTES;
	if (value < 3) return 3;
	return value % 2 === 1 ? value : value + 1;
}

export { VERDICTS };
