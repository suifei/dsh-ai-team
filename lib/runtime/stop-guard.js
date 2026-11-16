/**
 * 停止即停：项目停止后，团队会话（PMO + 成员）不得再唤醒或派生智能体。
 *
 * 实机（il2c，11-14 20:14）：Human 停止 → 插件中断全部成员（生效，成员回合以
 * aborted:user 结束）→ 宿主给父会话（PMO）递送「Background subagent … was stopped
 * before it finished」→ PMO 开新回合，用宿主内置的 `send_message` 发「续跑唤醒」→
 * 成员接着干了 25 分钟。插件自己的唤醒有 runState 闸，但 `send_message` 是宿主
 * 内置工具，完全绕过它。这里在 `tools.guard` 上补这道闸：停止期间团队会话调用
 * 唤醒 / 派生类工具一律拒绝，拒绝理由回给模型，让它结束本回合等 Human。
 */

/** 宿主内置的、会唤醒已有智能体或派生新智能体的工具（tool-subagent-control / tool-subagent / ralph）。 */
export const AGENT_WAKE_TOOLS = new Set(['send_message', 'subagent', 'subagent_fork', 'subagent_oar', 'ralph']);

/**
 * @param {object} execution 宿主 ToolExecution（name / agent.id）
 * @param {(sessionId: string) => ({ stopped: boolean, projectId: string, projectName?: string } | null)} projectOf
 * @returns {{ projectId: string, reason: string } | null} 需要拒绝时返回理由
 */
export function stoppedTeamDenial(execution, projectOf) {
	const name = String(execution?.name ?? '');
	if (!AGENT_WAKE_TOOLS.has(name)) return null;
	const sessionId = execution?.agent?.id;
	if (typeof sessionId !== 'string' || sessionId === '') return null;
	const project = projectOf(sessionId);
	if (project === null || project === undefined || project.stopped !== true) return null;
	const label = project.projectName ? `项目「${project.projectName}」` : '项目';
	return {
		projectId: project.projectId,
		reason: `已阻止：${label}已被 Human 停止，停止期间不得唤醒或派生成员（${name}）。成员被停是 Human 的决定，不是异常中断，不要续跑。结束本回合，等 Human 重新启动项目。`,
	};
}

/**
 * SkillOpt 一次性子代理（handoff 作答、判官、生成）只凭题面文字作答，不得调用任何工具。
 *
 * il2c night 8 实机：作答子代理继承 PMO 宿主的 danger-full-access，工作目录就是 il2c
 * 工作区，回放题里它真的去读仓库与账本「取证」——题目若是「修复 csvstat 门禁」它就会真改
 * 代码、写账本。宿主没有可编程的只读预设（默认只有 workspace-write+ask 与
 * danger-full-access），所以在工具层拒绝。
 *
 * @param {object} execution 宿主 ToolExecution（name / agent.id）
 * @param {(sessionId: string) => boolean} isOneShot
 * @returns {string | null} 需要拒绝时返回理由
 */
export function oneShotToolDenial(execution, isOneShot) {
	const sessionId = execution?.agent?.id;
	if (typeof sessionId !== 'string' || sessionId === '' || isOneShot(sessionId) !== true) return null;
	return `已阻止：这是 SkillOpt 的一次性作答，只凭题面文字回答，不得调用任何工具（${String(execution?.name ?? '')}）。不要读写文件、不要执行命令，直接输出题目要求的答案。`;
}

/**
 * @param {object} options
 * @param {object} options.tools `ctx.tools`
 * @param {(sessionId: string) => boolean} options.isOneShot
 * @param {{ append?: (row: object) => void }} [options.diag]
 * @returns {() => void} disposer
 */
export function registerOneShotToolGuard({ tools, isOneShot, diag }) {
	if (tools === undefined || tools === null || typeof tools.guard !== 'function') return () => {};
	return tools.guard((execution) => {
		try {
			const reason = oneShotToolDenial(execution, isOneShot);
			if (reason === null) return undefined;
			diag?.append?.({ ev: 'skillopt.oneshot.tool.blocked', sessionId: execution?.agent?.id ?? null, tool: String(execution?.name ?? '') });
			return reason;
		} catch {
			return undefined;
		}
	});
}

/**
 * @param {object} options
 * @param {object} options.tools `ctx.tools`
 * @param {(sessionId: string) => object | null} options.projectOf
 * @param {{ append?: (row: object) => void }} [options.diag]
 * @returns {() => void} disposer
 */
export function registerStopGuard({ tools, projectOf, diag }) {
	if (tools === undefined || tools === null || typeof tools.guard !== 'function') return () => {};
	return tools.guard((execution) => {
		try {
			const denial = stoppedTeamDenial(execution, projectOf);
			if (denial === null) return undefined;
			diag?.append?.({ ev: 'team.stopped.blocked', projectId: denial.projectId, sessionId: execution?.agent?.id ?? null, tool: String(execution?.name ?? '') });
			return denial.reason;
		} catch {
			// 守卫自身出错绝不能阻断工具调用。
			return undefined;
		}
	});
}
