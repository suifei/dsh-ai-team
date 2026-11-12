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
