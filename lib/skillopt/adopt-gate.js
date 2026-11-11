/**
 * adopt 前门（Darwin 的 validation gate）：把 `skillopt_adopt` 包一层——
 * 先跑 paired 独立 judge，多数决为 revert/inconclusive 时拒绝 adopt，
 * keep 时才放行原引擎调用。**不改 vendored 引擎**，只包 tools.register。
 *
 * gate 需要读取「改前 vs 改后」两版文本：改进后的候选来自 staged proposal
 * （由调用方注入 readProposal），改前版本来自 git（HEAD 的 SKILL.md）或调用方
 * 注入的 baseline 读取。任一缺失时门以「无法验证」拒绝——与 darwin 的
 * 「没有验证证据不得 adopt」一致。
 */

/**
 * @param {object} deps
 * @param {(projectDir: string) => Promise<{before: string|null, after: string|null, skillPath: string|null}>} deps.readPair
 * @param {(input: object) => Promise<{verdict:string, better:number, worse:number, ties:number, valid:number, votes:Array, errors:string[]}>} deps.judge
 * @param {(line: string, extra?: object) => void} [deps.diag]
 * @returns {(args: object, exec?: object) => Promise<string|null>} 返回拒绝原因；null = 放行
 */
export function createAdoptGate(deps) {
	const { readPair, judge, diag } = deps;
	return async (args) => {
		const projectDir = typeof args?.project === 'string' && args.project.trim() !== '' ? args.project : null;
		if (projectDir === null) return 'adopt gate: project directory is required';
		let pair;
		try {
			pair = await readPair(projectDir);
		} catch (error) {
			const message = `adopt gate: cannot read proposal/baseline (${error?.message ?? error})`;
			diag?.(message, { ev: 'skillopt.adoptgate.fail' });
			return message;
		}
		if (pair?.after === null || pair?.after === undefined || pair?.before === null || pair?.before === undefined) {
			const message = 'adopt gate: cannot verify — staged proposal or baseline SKILL.md is missing (unverified adopt is refused)';
			diag?.(message, { ev: 'skillopt.adoptgate.fail', project: projectDir });
			return message;
		}
		let result;
		try {
			result = await judge({ before: pair.before, after: pair.after, projectDir, skillPath: pair.skillPath ?? null });
		} catch (error) {
			const message = `adopt gate: judge unavailable (${error?.message ?? error}) — unverified adopt is refused`;
			diag?.(message, { ev: 'skillopt.adoptgate.fail', project: projectDir });
			return message;
		}
		diag?.('skillopt.adoptgate.decision', {
			ev: 'skillopt.adoptgate',
			project: projectDir,
			verdict: result.verdict,
			better: result.better,
			worse: result.worse,
			ties: result.ties,
			valid: result.valid,
		});
		if (result.verdict === 'keep') return null;
		const reasons = result.votes
			.filter((vote) => vote.vote === 'worse')
			.map((vote) => `judge ${vote.index}: ${vote.reason || 'worse'}`)
			.join(' | ');
		if (result.verdict === 'inconclusive') {
			return `adopt gate: inconclusive judge votes (${result.errors.join('; ') || 'no valid votes'}) — refusing unverified adopt`;
		}
		return `adopt gate: paired judge rejected the change (${result.better} better / ${result.worse} worse / ${result.ties} tie; ${result.valid} valid votes)${reasons ? ` — ${reasons}` : ''}`;
	};
}

/**
 * 包装 tools 服务，让 `skillopt_adopt` 的 execute 先过 adopt gate。
 * @param {object} tools ctx.get('tools')
 * @param {(args: object, exec?: object) => Promise<string|null>} gate
 * @returns {object} 供 applySkillOpt 使用的 tools 代理
 */
export function wrapToolsWithAdoptGate(tools, gate) {
	if (tools === null || tools === undefined || typeof tools.register !== 'function') return tools;
	return {
		...tools,
		register(definition, options) {
			if (definition?.name !== 'skillopt_adopt') return tools.register(definition, options);
			const originalExecute = definition.execute;
			const guarded = {
				...definition,
				async execute(args, exec) {
					const refused = await gate(args, exec);
					if (typeof refused === 'string' && refused !== '') return `[skillopt skillopt_adopt] ${refused}`;
					return originalExecute.call(definition, args, exec);
				},
			};
			return tools.register(guarded, options);
		},
	};
}
