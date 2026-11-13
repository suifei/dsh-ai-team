/**
 * 唤醒失败的归类。
 *
 * 实机根因（2026-11-12 确诊）：成员回合结束后会话仍被一个活跃写句柄占用，
 * `sessionQuery.observeSession` 拒绝发放读租约，冷恢复必然失败：
 *
 *   subagent "X" is unavailable
 *     cause: session "X" is already owned by an active write handle
 *
 * 插件无法释放这个租约（属 Harness 侧的句柄泄漏），只能重建会话。这类失败是
 * **可预期的**，不应按未知故障刷告警；其它原因仍然算真实失败。
 */

const BUSY_HANDLE = /active write handle/i;

/**
 * @param {string|null|undefined} causeChain `describeCauseChain()` 的输出
 * @returns {'wake.session-busy'|'wake.fail'} busy 表示「写租约被占用，必然需要重建」
 */
export function classifyWakeFailure(causeChain) {
	return typeof causeChain === 'string' && BUSY_HANDLE.test(causeChain) ? 'wake.session-busy' : 'wake.fail';
}

/**
 * 回合是否因「工具参数在传输中截断」而失败。
 *
 * 实机（2026-11-13）：成员在第 4 步发起的 `team` 调用只到
 * `{"action": "tasks", "qaChecklist": ` 就断了，宿主解析不出 JSON，整轮以
 * `MALFORMED_RESPONSE` 结束——工具没执行、成员也没被唤醒，任务停在半路。
 * 这类失败是**传输/采样**造成的，与任务本身无关：重发一次通常就好，所以值得
 * 自动续跑一次（预算见调用方），而不是让成员静默停摆。
 *
 * @param {{kind?: string, error?: {code?: string, message?: string}}|null|undefined} reason `turn/end` 的 reason
 * @returns {boolean}
 */
export function isMalformedTurnError(reason) {
	if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') return false;
	const error = reason.error;
	if (error === null || typeof error !== 'object') return false;
	if (String(error.code ?? '').toUpperCase() === 'MALFORMED_RESPONSE') return true;
	return /unexpected end of json input/i.test(String(error.message ?? ''));
}
