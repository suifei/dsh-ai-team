/**
 * SkillOpt 工具的调用者授权。
 *
 * 这批工具由插件在**全局**工具表注册（`tools.register` 无 scope），因此进程内任何
 * agent 都能看到并调用：`skillopt_adopt` 会写 live `SKILL.md`，`skillopt_schedule`
 * 会装系统 cron。一次性 worker 子代理（judge/generator 等）不该拥有这种权力，否则
 * 一个被喂进恶意工单的子代理就能静默改技能。
 *
 * 允许的两类调用者：
 *   1. Team 成员（`runtimeForAgent(id) !== null`）——它们在团队运行时有明确职责；
 *   2. Human 面对根会话（`session.header.origin !== 'subagent'`）。
 * 其余（delegated subagent）一律拒绝，并把拒绝写成工具结果而不是异常。
 */

/** 会改动 live 文件 / 系统状态 / 消耗评审预算的工具。 */
export const GUARDED_SKILLOPT_TOOLS = Object.freeze(new Set([
	'skillopt_run',
	'skillopt_adopt',
	'skillopt_schedule',
	'skillopt_unschedule',
	'skillopt_optimize',
	'skillopt_jobs',
	'skillopt_judge',
]));

/**
 * @param {object} tools ctx.get('tools')
 * @param {(exec: object|undefined) => boolean} isAllowed
 * @returns {object} 供 applySkillOpt 使用的 tools 代理
 */
export function wrapToolsWithSkilloptAccess(tools, isAllowed) {
	if (tools === null || tools === undefined || typeof tools.register !== 'function') return tools;
	return {
		...tools,
		register(definition, options) {
			if (!GUARDED_SKILLOPT_TOOLS.has(definition?.name)) return tools.register(definition, options);
			const originalExecute = definition.execute;
			const guarded = {
				...definition,
				async execute(args, exec) {
					let allowed = false;
					try {
						allowed = isAllowed(exec) === true;
					} catch {
						allowed = false;
					}
					if (!allowed) {
						return `[skillopt ${String(definition.name).replace(/^skillopt_/, '')}] refusing: this tool mutates live files or the host schedule and is limited to Team members and Human-facing sessions`;
					}
					return originalExecute.call(definition, args, exec);
				},
			};
			return tools.register(guarded, options);
		},
	};
}
