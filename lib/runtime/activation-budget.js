/**
 * 自动重建预算：把「失败 → 自愈重建 → 再失败」的死循环挡在插件这一侧。
 *
 * 实机报告（issue #1）：一句「在吗」跑了 7 小时、派了两百多个子代理。触发链是
 * 「唤醒失败（会话不可恢复/认证失败）→ 自动重建 → 新会话再失败 → 下一次唤醒再重建」；
 * 只要唤醒源源不断（thread 回复、PMO 心跳），这个循环就没有上限。
 *
 * 这里给自动重建加一个滑动窗口额度：同一成员在 windowMs 内最多重建 limit 次，
 * 超出后**不再自动重建**，改为写一条可见诊断并让成员保持 failed（等 Human 处理）。
 * 正常团队工作远达不到这个阈值，只有循环才会撞上。
 */

const DEFAULT_LIMIT = 6;
const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

/**
 * @param {{ limit?: number, windowMs?: number }} options
 */
export function createActivationBudget(options = {}) {
	const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
	const windowMs = Number.isSafeInteger(options.windowMs) && options.windowMs > 0 ? options.windowMs : DEFAULT_WINDOW_MS;
	/** @type {Map<string, number[]>} memberId -> 最近一次重建的时间戳 */
	const taken = new Map();
	return {
		/** 记录一次重建并返回是否允许（先判后记，拒绝时不消耗额度）。 */
		take(memberId, now = Date.now()) {
			if (typeof memberId !== 'string' || memberId === '') return { allowed: true, count: 0 };
			const recent = (taken.get(memberId) ?? []).filter((at) => now - at < windowMs);
			if (recent.length >= limit) {
				taken.set(memberId, recent);
				return { allowed: false, count: recent.length, limit, windowMs };
			}
			recent.push(now);
			taken.set(memberId, recent);
			return { allowed: true, count: recent.length, limit, windowMs };
		},
		/** 只读查询，不消耗额度。 */
		peek(memberId, now = Date.now()) {
			const recent = (taken.get(memberId) ?? []).filter((at) => now - at < windowMs);
			return recent.length;
		},
		reset(memberId) {
			taken.delete(memberId);
		},
	};
}
