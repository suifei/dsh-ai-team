/**
 * 热重载后「旧树未散」的唤醒：暂存，等宿主把成员旧回合收掉后再投。
 *
 * 实机（il2c 2026-11-19 04:47）：插件在桌面版里关闭再开启后，唤醒玄策连续
 * `UNAUTHORIZED target belongs to another subagent tree`（判定见 wake-failure.js `isStaleTreeError`）。
 * 成员重载前开的回合常驻在旧宿主 Agent 那棵树下，以新根投递一律被拒；官方 `subagents.prompt` 按旧根投递，
 * 旧根已不在线，同样被拒（r43 第二轮）。宿主在成员回合结束、空闲且收件箱为空时把它收掉（dsh-subagent
 * manager.ts `watchLocalSettlement`），之后的投递在新根下冷恢复（il2c：玄策旧回合 05:00:06 结束，
 * 14 秒后开出新回合，此后零失败）。
 *
 * 所以：该成员会话 `turn/end` 后等 settleDelayMs（给宿主收尾）再补投（r43 第三轮：旧回合结束 5 秒后
 * 补投成功，成员回「三号收到」）；另有退避定时器兜底（收尾比预期慢，或没观察到 turn/end）。
 * 同一会话只留最新一条计划——唤醒内容在投递时按当时状态生成，旧计划没有额外信息。
 * 旧回合结束后仍被拒、退避用尽才记 `.fail`；其间不往账本记失败；最终投到记
 * `wake.tree-stale.recovered`（errors 级可见）。
 */

export const STALE_TREE_BACKOFF_MS = Object.freeze([30_000, 60_000, 120_000, 300_000, 600_000]);
export const STALE_TREE_SETTLE_MS = 5_000;

/**
 * @param {{
 *   redeliver: (entry: { sessionId: string, projectId: string, memberId: string, plan: any }) => Promise<unknown>,
 *   diag?: { append?: (row: object) => void },
 *   backoffMs?: readonly number[],
 *   settleDelayMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 * }} options
 */
export function createStaleTreeWakes({
	redeliver, diag, backoffMs = STALE_TREE_BACKOFF_MS, settleDelayMs = STALE_TREE_SETTLE_MS,
	setTimer = setTimeout, clearTimer = clearTimeout,
}) {
	/** sessionId → { sessionId, projectId, memberId, plan, timer } */
	const pending = new Map();
	/**
	 * sessionId → { tries, attempts, ended }。会话出现在这里即「曾因旧树被暂存」，投到时据此记 recovered。
	 * tries：被拒总次数，只决定下一次间隔（封顶最后一档）；attempts：旧回合结束**之后**仍被拒的次数，
	 * 用尽才放弃——回合没结束前被拒是预期之中（r43：2 分钟的旧回合里被拒 3 次），不该把长回合的成员耗到放弃。
	 */
	const state = new Map();
	let disposed = false;
	const arm = (entry, ms, trigger) => {
		clearTimer(entry.timer);
		entry.timer = setTimer(() => fire(entry.sessionId, trigger), ms);
		entry.timer?.unref?.();
	};

	const fire = (sessionId, trigger) => {
		const entry = pending.get(sessionId);
		if (entry === undefined || disposed) return;
		pending.delete(sessionId);
		clearTimer(entry.timer);
		diag?.append?.({ ev: 'wake.tree-stale.redeliver', projectId: entry.projectId, memberId: entry.memberId, sessionId, trigger, tries: state.get(sessionId)?.tries ?? 0, reason: entry.plan?.reason ?? null });
		Promise.resolve()
			.then(() => redeliver({ sessionId, projectId: entry.projectId, memberId: entry.memberId, plan: entry.plan }))
			.catch((error) => diag?.append?.({ ev: 'wake.tree-stale.redeliver.fail', projectId: entry.projectId, memberId: entry.memberId, sessionId, message: error?.message ?? String(error) }));
	};

	return {
		/**
		 * 暂存一条被「旧树未散」拒绝的唤醒。retry=true 表示这是补投又被拒，计一次退避。
		 * @returns {boolean} false：退避已用尽（或已卸载），调用方按普通失败处理
		 */
		defer({ sessionId, projectId, memberId, plan, retry = false }) {
			if (disposed) return false;
			const s = state.get(sessionId) ?? { tries: 0, attempts: 0, ended: false };
			state.set(sessionId, s);
			if (retry) {
				s.tries += 1;
				if (s.ended) s.attempts += 1;
			}
			const previous = pending.get(sessionId);
			if (s.attempts >= backoffMs.length) {
				if (previous !== undefined) clearTimer(previous.timer);
				pending.delete(sessionId);
				state.delete(sessionId);
				diag?.append?.({ ev: 'wake.tree-stale.giveup.fail', projectId, memberId, sessionId, attempts: s.attempts, tries: s.tries, reason: plan?.reason ?? null });
				return false;
			}
			if (previous !== undefined) {
				// 回合未结束时又来新计划：换成最新的，定时器照旧。
				Object.assign(previous, { plan, projectId, memberId });
				return true;
			}
			const delayMs = backoffMs[Math.min(s.tries, backoffMs.length - 1)];
			const entry = { sessionId, projectId, memberId, plan, timer: undefined };
			pending.set(sessionId, entry);
			arm(entry, delayMs, 'timer');
			diag?.append?.({ ev: 'wake.tree-stale', projectId, memberId, sessionId, tries: s.tries, attempts: s.attempts, delayMs, reason: plan?.reason ?? null });
			return true;
		},
		/** 投递成功：曾被暂存过的会话记一行 recovered，并清掉计数。 */
		delivered(sessionId, context = {}) {
			if (typeof sessionId !== 'string' || !state.has(sessionId)) return;
			const s = state.get(sessionId);
			diag?.append?.({ ev: 'wake.tree-stale.recovered', sessionId, tries: s.tries, attempts: s.attempts, ...context });
			state.delete(sessionId);
		},
		/** `session/event` 观察者：暂存会话的回合一结束，等宿主收尾后补投；此后再被拒才计入放弃次数。 */
		observe(session, event) {
			const sessionId = session?.id;
			if (event?.type !== 'turn/end' || typeof sessionId !== 'string') return;
			const s = state.get(sessionId);
			if (s !== undefined) s.ended = true;
			const entry = pending.get(sessionId);
			if (entry !== undefined) arm(entry, settleDelayMs, 'turn-end');
		},
		/** 测试与诊断：当前暂存的会话。 */
		pendingSessions: () => [...pending.keys()],
		dispose() {
			disposed = true;
			for (const entry of pending.values()) clearTimer(entry.timer);
			pending.clear();
			state.clear();
		},
	};
}
