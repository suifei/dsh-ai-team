/**
 * Darwin Skill 9 维 rubric（对齐 alchaincyf/darwin-skill v2.1 的权威定义）：
 *
 *   结构维度（59）：1 Frontmatter 7 / 2 工作流清晰度 12 / 3 失败模式编码 12 /
 *                    4 检查点设计 6 / 5 可执行具体性 18 / 6 资源整合度 4
 *   效果维度（35）：7 整体架构 12 / 8 实测表现 23
 *   Meta-skill（6）：9 反例与黑名单 6
 *
 * 评分规则：维度 1-7、9 打 1-10 分 × 权重；维度 8（实测表现）由调用方注入
 * （跑测试 prompt）或按干跑打分。总分 = Σ(维度分 × 权重) / 10，满分 100。
 *
 * ⚠️ 绝对总分只用于 triage（先改哪支最弱），**绝不用于 keep/revert**——
 * LLM judge 换尺 ±8 噪音会淹没保守编辑的真实增益。keep/revert 一律走
 * judge.js 的 paired 同-judge 多数决。
 */

export const NINE_DIMENSIONS = Object.freeze([
	{ id: 1, name: 'Frontmatter质量', weight: 7, group: 'structure' },
	{ id: 2, name: '工作流清晰度', weight: 12, group: 'structure' },
	{ id: 3, name: '失败模式编码', weight: 12, group: 'structure' },
	{ id: 4, name: '检查点设计', weight: 6, group: 'structure' },
	{ id: 5, name: '可执行具体性', weight: 18, group: 'structure' },
	{ id: 6, name: '资源整合度', weight: 4, group: 'structure' },
	{ id: 7, name: '整体架构', weight: 12, group: 'effect' },
	{ id: 8, name: '实测表现', weight: 23, group: 'effect' },
	{ id: 9, name: '反例与黑名单', weight: 6, group: 'meta' },
]);

/** 软化措辞（dim5 扣分项）：出现 ≥3 处扣 ≥3 分。 */
const SOFT_WORDS = ['建议', '可以考虑', '根据情况', '灵活把握', '视情况而定', '酌情', '尽量'];
/** AI 腔/废话词（dim7 扣分项）：出现一处扣 1 分。 */
const FILLER_WORDS = ['说白了', '换句话说', '首先其次', '综上所述', '总而言之'];
/** 失败模式句式（dim3）：显式「如果 X → Y」分支，含缺失/为空/超时等触发条件。 */
const FAILURE_PATTERNS = [
	/如果[^\n]{0,60}(失败|缺失|为空|不存在|不一致|超时|报错)/,
	/兜底/,
	/fallback/i,
	/异常处理/,
	/恢复/,
];
/** 检查点显性标记（dim4）：仅靠『如果…建议…』措辞不算。 */
const CHECKPOINT_PATTERNS = [/🔴/, /🛑/, /CHECKPOINT/, /STOP/];
/** 反例/黑名单章节（dim9）。 */
const COUNTEREXAMPLE_PATTERNS = [/反例/, /黑名单/, /不要做/, /禁止/, /反模式/];

const clampScore = (value) => Math.max(1, Math.min(10, value));
// 只数**完整匹配**：`String.match` 在带捕获组时会把分组也塞进返回数组，长度
// 因此虚高（`/(a)(b)/g` 命中一次返回 3 个元素），dim3 分数被系统性抬高。
const countMatches = (text, patterns) => patterns.reduce((total, pattern) => {
	const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
	const global = new RegExp(pattern.source, flags);
	let hits = 0;
	for (const _ of String(text).matchAll(global)) hits += 1;
	return total + hits;
}, 0);

/**
 * 静态评分（dims 1-7、9）。dim8 由调用方注入（measured dim8 干跑/实测分）。
 *
 * @param {string} text SKILL.md 全文
 * @param {{dim8?: number, measured?: boolean, resourcePaths?: string[]}} [options]
 * @returns {{dimensions: Array<{id:number,name:string,weight:number,score:number,evidence:string}>, total:number, evaluated:boolean, triageOnly:boolean}}
 */
export function scoreSkillRubric(text, options = {}) {
	const source = typeof text === 'string' ? text : '';
	// NaN/Infinity 会穿透 clampScore（Math.min/max 对 NaN 返回 NaN）→ 总分变 NaN。
	const dim8 = Number.isFinite(options.dim8) ? clampScore(options.dim8) : 5;
	const evidence = [];
	const scores = new Map();

	// dim1 Frontmatter：name/description/触发词/长度/空话尾巴
	{
		const hasName = /^---\s*[\s\S]*?name:/m.test(source);
		const hasDescription = /^---\s*[\s\S]*?description:/m.test(source);
		const description = source.match(/description:\s*([^\n]+)/)?.[1] ?? '';
		const hasTriggers = /触发|trigger|当用户|使用场景/i.test(description);
		const vagueTail = /(灵活应用|根据情况判断|视情况)/.test(description.slice(-80));
		let score = 4;
		if (hasName) score += 2;
		if (hasDescription) score += 1;
		if (hasTriggers) score += 2;
		if (description.length > 0 && description.length <= 1024) score += 1;
		if (vagueTail) score -= 2;
		scores.set(1, clampScore(score));
		evidence.push(`dim1 frontmatter: name=${hasName} desc=${hasDescription} triggers=${hasTriggers} vagueTail=${vagueTail}`);
	}

	// dim2 工作流：编号/标题步骤数
	{
		const steps = (source.match(/^\s{0,4}(\d+[.)、]|#{2,4}\s*(Step|步骤|Phase|阶段)\s*\d)/gim) ?? []).length;
		const score = steps === 0 ? 3 : steps <= 2 ? 5 : steps <= 5 ? 7 : 9;
		scores.set(2, clampScore(score));
		evidence.push(`dim2 workflow steps=${steps}`);
	}

	// dim3 失败模式编码：显式失败分支；只写正向流程扣分
	{
		const hits = countMatches(source, FAILURE_PATTERNS);
		const score = hits === 0 ? 2 : hits <= 2 ? 6 : hits <= 5 ? 8 : 9;
		scores.set(3, clampScore(score));
		evidence.push(`dim3 failure patterns=${hits}`);
	}

	// dim4 检查点：显性标记（🔴/STOP/CHECKPOINT）
	{
		const hits = countMatches(source, CHECKPOINT_PATTERNS);
		const score = hits === 0 ? 2 : hits >= 3 ? 9 : 7;
		scores.set(4, clampScore(score));
		evidence.push(`dim4 explicit checkpoints=${hits}`);
	}

	// dim5 可执行具体性：软化措辞扣分 + 具体参数/示例加分
	{
		const soft = SOFT_WORDS.reduce((total, word) => total + (source.split(word).length - 1), 0);
		const concrete = (source.match(/```|`[^`\n]+`|--[a-z-]+|\d+(\.\d+)?(ms|s|px|%|KB|MB)/g) ?? []).length;
		let score = 6 + Math.min(3, Math.floor(concrete / 8));
		if (soft >= 3) score -= Math.min(5, soft);
		scores.set(5, clampScore(score));
		evidence.push(`dim5 softWords=${soft} concreteHints=${concrete}`);
	}

	// dim6 资源整合度：references/scripts/assets 引用是否真的可达
	{
		const refs = (source.match(/(references|scripts|assets)\/[^\s)`"']+/g) ?? []).length;
		// 没给 resourcePaths 时**不能**把「引用数」当成「可达数」：那会让任何
		// 含 references/ 的文本恒得 9 分（自证可达）。没有可达清单时按「未验证」
		// 走中性分，并在证据里标注。
		const hasKnown = Array.isArray(options.resourcePaths);
		const known = hasKnown ? options.resourcePaths.length : 0;
		const score = refs === 0
			? (hasKnown ? 6 : 5)
			: hasKnown
				? (known >= refs ? 9 : 6)
				: 6;
		scores.set(6, clampScore(score));
		evidence.push(`dim6 resource refs=${refs} reachable=${hasKnown ? known : 'unverified'}`);
	}

	// dim7 整体架构：层级 + 冗余扣分
	{
		const headings = (source.match(/^#{1,4}\s+/gm) ?? []).length;
		const filler = FILLER_WORDS.reduce((total, word) => total + (source.split(word).length - 1), 0);
		let score = headings >= 5 ? 8 : headings >= 2 ? 6 : 4;
		score -= Math.min(4, filler);
		scores.set(7, clampScore(score));
		evidence.push(`dim7 headings=${headings} filler=${filler}`);
	}

	// dim8 实测表现：调用方注入（measured=true 时才是实测）
	scores.set(8, dim8);

	// dim9 反例与黑名单
	{
		const hits = countMatches(source, COUNTEREXAMPLE_PATTERNS);
		const score = hits === 0 ? 2 : hits >= 2 ? 9 : 7;
		scores.set(9, clampScore(score));
		evidence.push(`dim9 counterexamples=${hits}`);
	}

	const dimensions = NINE_DIMENSIONS.map((dimension) => ({
		...dimension,
		score: scores.get(dimension.id),
		evidence: evidence.find((line) => line.startsWith(`dim${dimension.id} `)) ?? '',
	}));
	const total = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / 10 * 10) / 10;
	return {
		dimensions,
		total,
		// dim8 未经实测（干跑）时标注，避免把 triage 分当真实效果。
		evaluated: options.measured === true,
		triageOnly: true,
	};
}

/** 输出可读的 triage 摘要（工具返回值用纯文本时）。 */
export function formatRubric(result) {
	const rows = result.dimensions.map((dimension) => `  dim${dimension.id} ${dimension.name.padEnd(12)} ${String(dimension.score).padStart(2)}/10 ×${String(dimension.weight).padStart(2)}  ${dimension.evidence}`);
	// weakest 必须与 weakestDimension 同口径：dim8 是实测表现，不能靠静态改写
	// 提升，混进来会把优化目标指向一个改不动的维度。
	const editable = result.dimensions.filter((dimension) => dimension.id !== 8);
	const weakest = (editable.length > 0 ? editable : result.dimensions)
		.reduce((worst, dimension) => (dimension.weight * (10 - dimension.score) > worst.weight * (10 - worst.score) ? dimension : worst));
	return [
		`[skillopt rubric] total=${result.total}/100${result.evaluated ? '' : ' (dim8 dry-run: NOT a measured effect score)'}`,
		'  ⚠️ absolute totals are TRIAGE-ONLY; keep/revert must use paired judge majority',
		...rows,
		`  weakest dim: ${weakest.name}`,
	].join('\n');
}
