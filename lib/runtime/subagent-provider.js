/**
 * 解析「用哪个 subagent provider 启动成员会话」。
 *
 * 实机事故（issue #1 借楼，DSH 0.2.2-rc.2）：`SubagentRuntime` 没有 `list()`，而插件
 * 用 `(subagents.list?.() ?? [])[0]` 取名字，拿到 `undefined`，`MemberRuntime.activate`
 * 直接判 `E_RUNTIME_UNAVAILABLE: no subagent provider or parent Agent is available`。
 * 0.4.79 只修了「判空→503」那一处探测，这五处取值仍在，于是激活全挂。
 *
 * 规则：先信配置，再信 `list()`（rc.1 及更早），最后用 `getProvider()` 验证候选名
 * （rc.2 起只剩这个方法），默认候选是 dsh-base 里注册的 `spawn`。
 */

export const DEFAULT_SUBAGENT_PROVIDER = 'spawn';

/**
 * @param {any} subagents `ctx.subagents`
 * @param {string} [preferred] 配置里的首选 provider 名
 * @returns {string|undefined}
 */
export function resolveSubagentProviderName(subagents, preferred) {
	if (subagents === undefined || subagents === null) return undefined;
	const candidates = [];
	if (typeof preferred === 'string' && preferred.trim() !== '') candidates.push(preferred.trim());

	let enumerable = null;
	if (typeof subagents.list === 'function') {
		try {
			const names = subagents.list();
			if (Array.isArray(names) && names.length > 0) {
				enumerable = names.filter((name) => typeof name === 'string' && name !== '');
				candidates.push(...enumerable);
			}
		} catch {
			// list() 存在但抛错：当作枚举不到，继续用候选名验证。
		}
	}

	// `spawn` 是 dsh-base 的默认在进程内 provider；枚举不到时它是唯一可靠的猜测。
	candidates.push(DEFAULT_SUBAGENT_PROVIDER);

	const unique = [...new Set(candidates)];
	// 没有 getProvider 说明宿主连验证手段都没给：退回「首选或 spawn」，让
	// startActivation 去报真实错误，而不是在这里武断失败。
	if (typeof subagents.getProvider !== 'function') return unique[0];
	for (const name of unique) {
		try {
			if (subagents.getProvider(name) !== undefined) return name;
		} catch {
			// 单个候选查询失败不影响其它候选。
		}
	}
	return undefined;
}

/**
 * 成员是否因「运行时/提供方不可用」失败——这类失败与任务无关，运行时恢复后应当自动重试。
 * @param {{status?: string, lastFailure?: {message?: string|null, category?: string}|null}} member
 */
export function isRuntimeUnavailableFailure(member) {
	if (member === null || typeof member !== 'object' || member.status !== 'failed') return false;
	const failure = member.lastFailure;
	if (failure === null || typeof failure !== 'object') return false;
	const text = `${failure.category ?? ''} ${failure.message ?? ''}`;
	return /E_RUNTIME_UNAVAILABLE|no subagent provider|no subagent provider or parent Agent/i.test(text);
}
