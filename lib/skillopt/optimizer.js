/**
 * Darwin Phase 2 自动优化循环（hill-climbing）——插件侧编排。
 *
 * 一轮 = 诊断（rubric 最大加权短板）→ 生成改进（独立生成器，非 judge）→
 * 写入 → paired 独立 judge 多数决 → keep（保留）或 revert（回滚）→ 记录。
 *
 * 安全约束（对齐 darwin 与项目纪律）：
 * - 每轮只针对一个维度（避免多变量无法归因）；
 * - 体积上限 150%（超限直接拒绝，不进入 judge）；
 * - 棘轮用 paired 多数决（绝对分只做 triage）；
 * - 版本化：项目是干净 git 仓库时用 commit/revert，否则用 .bak 文件恢复；
 * - 连续 2 轮 judge margin 全为 slight/tie → 触顶 break（见好就收，HL-4）。
 *
 * 纯逻辑与 I/O 分离：所有外部动作（读/写/git/生成/judge/评分/时钟）都注入，
 * 因此循环可在测试里用一个内存文件系统完整验证。
 */

export const DEFAULT_ROUNDS = 3;
const MAX_GROWTH = 1.5;

/** 最大加权短板（weight × (10 - score) / 10；同分时取原始分更低者）。 */
export function weakestDimension(rubric) {
	const scored = (rubric?.dimensions ?? []).filter((dimension) => Number.isFinite(dimension?.score));
	if (scored.length === 0) return null;
	return scored.reduce((worst, dimension) => {
		const gap = dimension.weight * (10 - dimension.score) / 10;
		const worstGap = worst.weight * (10 - worst.score) / 10;
		if (gap > worstGap) return dimension;
		if (gap === worstGap && dimension.score < worst.score) return dimension;
		return worst;
	});
}

/** 触顶判据：连续 2 轮 judge 的 margin 全为 slight/tie。 */
export function isPlateau(recentMargins) {
	const lastTwo = recentMargins.slice(-2);
	return lastTwo.length === 2 && lastTwo.every((row) => row.every((margin) => margin === 'slight' || margin === 'tie'));
}

/** 一轮候选的静态校验：不得超体积上限、必须真的变了。 */
export function validateCandidate({ before, after }) {
	if (typeof after !== 'string' || after.trim() === '') return { ok: false, reason: 'generator returned an empty candidate' };
	if (after === before) return { ok: false, reason: 'generator returned an unchanged candidate' };
	if (after.length > before.length * MAX_GROWTH) {
		return { ok: false, reason: `candidate exceeds 150% of the original size (${before.length} -> ${after.length}); trim before judging` };
	}
	return { ok: true, reason: '' };
}

/** results.tsv 行（9 列，与 darwin 格式一致）。 */
export function resultRow({ timestamp, commit, skill, oldScore, newScore, status, dimension, note, evalMode }) {
	return [timestamp, commit, skill, oldScore, newScore, status, dimension, note, evalMode].join('\t');
}

export const RESULTS_HEADER = ['timestamp', 'commit', 'skill', 'old_score', 'new_score', 'status', 'dimension', 'note', 'eval_mode'].join('\t');

/**
 * 跑一个 skill 的优化循环。
 *
 * @param {object} input
 * @param {string} input.skillPath 目标 SKILL.md 绝对路径
 * @param {string} [input.skillName] 记录用名字（默认取文件名所在目录名）
 * @param {number} [input.rounds] MAX_ROUNDS（默认 3）
 * @param {(path:string)=>Promise<string>} input.readText
 * @param {(path:string, text:string)=>Promise<void>} input.writeText
 * @param {(text:string, options:{measured:boolean})=>object} input.score 同步 rubric 评分
 * @param {(input:{skillPath:string, before:string, dimension:object, round:number})=>Promise<string>} input.generate 生成候选全文
 * @param {(input:{before:string, after:string, skillPath:string})=>Promise<{verdict:string, better:number, worse:number, ties:number, valid:number, votes:Array, errors:string[]}>} input.judge
 * @param {object} input.vcs `{kind:'git', commit:(message)=>Promise<string>, revert:()=>Promise<void>}` 或 `{kind:'file', backup:(path:string,text:string)=>Promise<string>, restore:(path:string,backup:string)=>Promise<void>}`
 * @param {(line:string)=>Promise<void>} [input.appendResult] 追加 results.tsv（含表头由实现方保证）
 * @param {() => number} [input.now]
 * @returns {Promise<{status:'completed'|'plateau'|'reverted'|'error', rounds:Array, finalScore:number|null, error?:string}>}
 */
export async function runOptimizeLoop(input) {
	const {
		skillPath, skillName, rounds = DEFAULT_ROUNDS, readText, writeText, score, generate, judge, vcs,
		appendResult, now = () => Date.now(),
	} = input;
	const name = skillName ?? skillPath.split(/[\\/]/).slice(-2, -1)[0] ?? skillPath;
	const history = [];
	const staleness = [];
	const stamp = () => new Date(now()).toISOString().slice(0, 19);
	try {
		for (let round = 1; round <= rounds; round++) {
			const before = await readText(skillPath);
			const baseline = score(before, { measured: false });
			const dimension = weakestDimension(baseline);
			if (dimension === null) {
				await appendResult?.(resultRow({ timestamp: stamp(), commit: '-', skill: name, oldScore: String(baseline?.total ?? '-'), newScore: '-', status: 'error', dimension: '-', note: 'rubric produced no scorable dimensions', evalMode: 'structural' }));
				return { status: 'error', rounds: history, finalScore: baseline?.total ?? null, error: 'no scorable dimensions' };
			}
			let candidate;
			try {
				candidate = await generate({ skillPath, before, dimension, round });
			} catch (error) {
				return { status: 'error', rounds: history, finalScore: baseline?.total ?? null, error: `generator failed: ${error?.message ?? error}` };
			}
			const validation = validateCandidate({ before, after: candidate });
			if (!validation.ok) {
				await appendResult?.(resultRow({ timestamp: stamp(), commit: '-', skill: name, oldScore: String(baseline.total), newScore: '-', status: 'skipped', dimension: dimension.name, note: validation.reason, evalMode: 'structural' }));
				continue;
			}
			// 版本化：先记录基线，再写入候选。
			let version = null;
			if (vcs?.kind === 'git') {
				try { version = await vcs.commit(`optimize ${name}: address dim${dimension.id} ${dimension.name}`); }
				catch { version = null; }
			} else if (vcs?.kind === 'file') {
				version = await vcs.backup(skillPath, before);
			}
			await writeText(skillPath, candidate);
			let verdict;
			try {
				verdict = await judge({ before, after: candidate, skillPath });
			} catch (error) {
				// judge 不可用：回滚，绝不保留未验证改动。
				await restore(vcs, skillPath, before, version);
				return { status: 'error', rounds: history, finalScore: baseline.total, error: `judge unavailable: ${error?.message ?? error}` };
			}
			const margins = (verdict.votes ?? []).map((vote) => vote.margin ?? 'slight');
			staleness.push(margins);
			const kept = verdict.verdict === 'keep';
			if (!kept) {
				await restore(vcs, skillPath, before, version);
			} else if (vcs?.kind === 'git' && version !== null && typeof vcs.commitKept === 'function') {
				await vcs.commitKept(version);
			}
			const afterScore = kept ? score(candidate, { measured: false }) : baseline;
			history.push({
				round,
				dimension: `dim${dimension.id} ${dimension.name}`,
				verdict: verdict.verdict,
				better: verdict.better,
				worse: verdict.worse,
				ties: verdict.ties,
				margins,
				oldScore: baseline.total,
				newScore: afterScore?.total ?? null,
				kept,
			});
			await appendResult?.(resultRow({
				timestamp: stamp(),
				commit: version ?? '-',
				skill: name,
				oldScore: String(baseline.total),
				newScore: String(afterScore?.total ?? '-'),
				status: kept ? 'keep' : 'revert',
				dimension: `dim${dimension.id}`,
				note: `${verdict.better}-${verdict.worse} ${verdict.verdict}${verdict.errors?.length ? ` (${verdict.errors.join('; ')})` : ''}`,
				evalMode: 'paired',
			}));
			if (!kept) {
				return { status: 'reverted', rounds: history, finalScore: baseline.total };
			}
			if (isPlateau(staleness)) {
				return { status: 'plateau', rounds: history, finalScore: (await readText(skillPath)).length > 0 ? (score(await readText(skillPath), { measured: false })?.total ?? null) : null };
			}
		}
		const finalText = await readText(skillPath);
		return { status: 'completed', rounds: history, finalScore: score(finalText, { measured: false })?.total ?? null };
	} catch (error) {
		return { status: 'error', rounds: history, finalScore: null, error: error?.message ?? String(error) };
	}
}

async function restore(vcs, skillPath, before, version) {
	if (vcs?.kind === 'git') {
		try { await vcs.revert(); } catch { /* fall through to file restore */ }
		// 兜底：git revert 失败时用内存里的基线覆盖，保证不留下未验证改动。
	}
	if (vcs?.kind === 'file' && version !== null && typeof vcs.restore === 'function') {
		try { await vcs.restore(skillPath, version); return; } catch { /* fall through */ }
	}
	if (vcs?.kind === 'git') {
		try { await vcs.writeBaseline?.(skillPath, before); } catch { /* last resort */ }
	}
}
