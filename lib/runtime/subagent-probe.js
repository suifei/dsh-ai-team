/**
 * SubagentRuntime 的 provider 注册探测。
 *
 * 实机事故（issue #1 借楼报）：桌面 DSH 0.2.2-rc.2 的 SubagentRuntime 移除了
 * `list()`（rc.1 还有，返回 providers.keys()），插件用
 * `typeof subagents.list === 'function' ? subagents.list() : []` 判空，把
 * **能力缺失当成了状态为空**——成员激活恒 503、唤醒静默 return，日志里什么都不留。
 *
 * 泛化规则：探测型代码不得把「问不到」当成「没有」。问不到时放行，让真正的调用
 * （startActivation）产生带原因的失败，再记录它。
 */

/**
 * @returns {'no-service'|'unknown'|'empty'|'ready'}
 *   no-service — subagents 服务本身不存在（调用方自会走既有的 E_RUNTIME_UNAVAILABLE）；
 *   unknown    — 宿主没有 list() 这个自省方法（rc.2+），无法判断，视为放行；
 *   empty      — 确认还没有 provider 注册；
 *   ready      — 至少一个 provider。
 */
export function probeProviderRegistration(subagents) {
	if (subagents === undefined || subagents === null) return 'no-service';
	if (typeof subagents.list !== 'function') return 'unknown';
	let providers;
	try {
		providers = subagents.list();
	} catch {
		return 'unknown';
	}
	return Array.isArray(providers) && providers.length > 0 ? 'ready' : 'empty';
}

/** 探测结果是否应挡住激活/唤醒（只有确认 empty 才挡）。 */
export function blocksActivation(state) {
	return state === 'empty';
}
