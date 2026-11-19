/**
 * 延后唤醒：宿主暂时投不进、但不是会话坏了的唤醒，暂存起来，等时机到了按原路补投，不记失败。
 *
 * 两类（判定见 wake-failure.js）：
 *
 * - `stale-tree`（热重载后「旧树未散」）：实机 il2c 2026-11-19 04:47，插件关再开后唤醒玄策连续
 *   `UNAUTHORIZED target belongs to another subagent tree`。成员重载前开的回合常驻在旧宿主 Agent
 *   那棵树下；宿主在**该成员**回合结束、空闲后把它收掉（dsh-subagent `watchLocalSettlement`），之后的
 *   投递在新根下冷恢复。所以等该成员 `turn/end` + settleDelayMs 再投（r43：旧回合结束 5 秒后补投成功）。
 *   旧回合结束后仍被拒、退避用尽才放弃并记 `.fail`。
 * - `capacity`（团队超过宿主并发上限）：宿主同时运行的子智能体有上限（`maxActiveSubagents`，默认 8），
 *   满了不排队而是直接拒绝（dsh-subagent activation.ts `ACTIVATION_LIMIT_REACHED`）。团队可以超过 8 人，
 *   多出来的排队：**任一**会话 `turn/end` 都可能腾出名额，按入队先后补投最早的一条；不设放弃上限
 *   （排多久都等），只按退避定时器兜底重试。
 *
 * 同一成员只留最新一条计划——唤醒内容在投递时按当时状态生成，旧计划没有额外信息。最终投到记
 * `wake.<类>.recovered`（errors 级可见）。
 */

export const DEFERRED_BACKOFF_MS = Object.freeze([30_000, 60_000, 120_000, 300_000, 600_000]);
export const DEFERRED_SETTLE_MS = 5_000;

/** 各类的诊断事件前缀；名字沿用 0.4.138 的 `wake.tree-stale.*`，已有的日志检索不失效。 */
const EVENT = Object.freeze({ 'stale-tree': 'wake.tree-stale', capacity: 'wake.capacity' });
export const DEFERRED_KINDS = Object.freeze(Object.keys(EVENT));

/**
 * @param {{
 *   redeliver: (entry: { kind: string, sessionId: string|null, projectId: string, memberId: string, plan: any }) => Promise<unknown>,
 *   diag?: { append?: (row: object) => void },
 *   backoffMs?: readonly number[],
 *   settleDelayMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 *   now?: () => number,
 * }} options
 */
export function createDeferredWakes({
	redeliver, diag, backoffMs = DEFERRED_BACKOFF_MS, settleDelayMs = DEFERRED_SETTLE_MS,
	setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(),
}) {
	/** `${projectId}:${memberId}` → { key, kind, sessionId, projectId, memberId, plan, queuedAt, timer, armedBy } */
	const pending = new Map();
	/**
	 * key → { kind, tries, attempts, ended, queuedAt }。queuedAt 是首次入队时间：补投又被拒时仍按它排队，不掉到队尾。
	 * 出现在这里即「曾被暂存」，投到时据此记 recovered。
	 * tries：被拒总次数，只决定下一次间隔（封顶最后一档）；attempts（仅 stale-tree）：该成员旧回合结束**之后**
	 * 仍被拒的次数，用尽才放弃——回合没结束前被拒是预期之中（r43：2 分钟的旧回合里被拒 3 次）。
	 */
	const state = new Map();
	let disposed = false;
	const keyOf = (projectId, memberId) => `${projectId}:${memberId}`;
	const ev = (kind, suffix = '') => `${EVENT[kind]}${suffix}`;
	const arm = (entry, ms, trigger) => {
		clearTimer(entry.timer);
		entry.armedBy = trigger;
		entry.timer = setTimer(() => fire(entry.key, trigger), ms);
		entry.timer?.unref?.();
	};

	const fire = (key, trigger) => {
		const entry = pending.get(key);
		if (entry === undefined || disposed) return;
		pending.delete(key);
		clearTimer(entry.timer);
		const { kind, sessionId, projectId, memberId, plan } = entry;
		diag?.append?.({ ev: ev(kind, '.redeliver'), projectId, memberId, sessionId, trigger, tries: state.get(key)?.tries ?? 0, waitedMs: now() - entry.queuedAt, reason: plan?.reason ?? null });
		Promise.resolve()
			.then(() => redeliver({ kind, sessionId, projectId, memberId, plan }))
			.catch((error) => diag?.append?.({ ev: ev(kind, '.redeliver.fail'), projectId, memberId, sessionId, message: error?.message ?? String(error) }));
	};

	return {
		/**
		 * 暂存一条被宿主暂时拒绝的唤醒。retry=true 表示这是补投又被拒。
		 * @param {{ kind: 'stale-tree'|'capacity', sessionId?: string|null, projectId: string, memberId: string, plan: any, retry?: boolean }} input
		 * @returns {boolean} false：放弃（仅 stale-tree 退避用尽）、未知类或已卸载，调用方按普通失败处理
		 */
		defer({ kind, sessionId = null, projectId, memberId, plan, retry = false }) {
			if (disposed || !(kind in EVENT)) return false;
			const key = keyOf(projectId, memberId);
			const s = state.get(key) ?? { kind, tries: 0, attempts: 0, ended: false, queuedAt: now() };
			if (s.kind !== kind) Object.assign(s, { kind, tries: 0, attempts: 0, ended: false, queuedAt: now() });
			state.set(key, s);
			if (retry) {
				s.tries += 1;
				if (kind === 'stale-tree' && s.ended) s.attempts += 1;
			}
			const previous = pending.get(key);
			if (kind === 'stale-tree' && s.attempts >= backoffMs.length) {
				if (previous !== undefined) clearTimer(previous.timer);
				pending.delete(key);
				state.delete(key);
				diag?.append?.({ ev: ev(kind, '.giveup.fail'), projectId, memberId, sessionId, attempts: s.attempts, tries: s.tries, reason: plan?.reason ?? null });
				return false;
			}
			if (previous !== undefined && previous.kind === kind) {
				// 还没投出去又来新计划：换成最新的；排队位置与定时器照旧。
				Object.assign(previous, { plan, sessionId: sessionId ?? previous.sessionId });
				return true;
			}
			if (previous !== undefined) clearTimer(previous.timer);
			const delayMs = backoffMs[Math.min(s.tries, backoffMs.length - 1)];
			const entry = { key, kind, sessionId, projectId, memberId, plan, queuedAt: s.queuedAt, timer: undefined, armedBy: null };
			pending.set(key, entry);
			arm(entry, delayMs, 'timer');
			diag?.append?.({ ev: ev(kind), projectId, memberId, sessionId, tries: s.tries, attempts: s.attempts, delayMs, queued: [...pending.values()].filter((item) => item.kind === kind).length, reason: plan?.reason ?? null });
			return true;
		},
		/** 投递成功：曾被暂存过的成员记一行 recovered，并清掉计数。 */
		delivered(projectId, memberId, context = {}) {
			const key = keyOf(projectId, memberId);
			const s = state.get(key);
			if (s === undefined) return;
			diag?.append?.({ ev: ev(s.kind, '.recovered'), projectId, memberId, tries: s.tries, attempts: s.attempts, ...context });
			state.delete(key);
		},
		/**
		 * `session/event` 观察者，只看 `turn/end`：
		 * - stale-tree：该成员自己的回合结束 → 等宿主收尾后补投；此后再被拒才计入放弃次数。
		 * - capacity：任一回合结束都可能腾出一个名额 → 补投排队最久、还没被叫的那一条。
		 */
		observe(session, event) {
			const sessionId = session?.id;
			if (event?.type !== 'turn/end' || typeof sessionId !== 'string') return;
			for (const entry of pending.values()) {
				if (entry.kind !== 'stale-tree' || entry.sessionId !== sessionId) continue;
				const s = state.get(entry.key);
				if (s !== undefined) s.ended = true;
				arm(entry, settleDelayMs, 'turn-end');
			}
			let oldest;
			for (const entry of pending.values()) {
				if (entry.kind !== 'capacity' || entry.armedBy === 'turn-end') continue;
				if (oldest === undefined || entry.queuedAt < oldest.queuedAt) oldest = entry;
			}
			if (oldest !== undefined) arm(oldest, settleDelayMs, 'turn-end');
		},
		/** 测试与诊断：当前暂存的成员，按入队先后。 */
		pending: () => [...pending.values()].sort((a, b) => a.queuedAt - b.queuedAt).map(({ kind, projectId, memberId }) => ({ kind, projectId, memberId })),
		dispose() {
			disposed = true;
			for (const entry of pending.values()) clearTimer(entry.timer);
			pending.clear();
			state.clear();
		},
	};
}
