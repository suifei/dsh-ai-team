/**
 * PMO 宿主会话不被「子智能体已完成」通知唤醒。
 *
 * 宿主会话只是成员会话的父会话：团队推进由插件 PMO tick 与项目负责人承担，
 * 宿主模型进不了看板（team 工具 E_NOT_MEMBER）。可每个成员回合收尾，宿主都会往父会话
 * 投一条 `source.kind === 'subagent-settled'` 的通知并开一个回合——il2c 11-17 实证：
 * 宿主模型被叫醒后自以为是 PMO，用 send_message 直接催成员（撞 NOT_RESUMABLE「subagent
 * "墨渊" is unavailable」）、自派子代理、写「波尾刀起爆了」这类看不懂的话，成了第二个 PMO。
 *
 * 成员激活已用 `delivery: 'caller'`（member-runtime），但成员冷恢复后的回合由宿主 manager
 * 按父会话投递，激活参数管不到（r37 E2E：激活回合 0 条，唤醒回合仍 1 条）。
 * 所以在官方接缝 `agent/pre-step` 上兜住：宿主会话的回合首步若领取到的全是这类通知，
 * 返回 `{kind:'reject'}`——循环以 `blocked` 结束该回合，不发模型请求，通知被领取即丢弃。
 * 只看回合首步（step 1），且只在**全部**是通知时拦：混有别的输入（Human 打开宿主会话说话、
 * 插件投递）照常放行，回合中途的步骤也不碰。
 *
 * @param {{
 *   on?: (name: string, listener: Function) => (() => void),
 *   isHostSession: (sessionId: string) => ({ projectId: string } | null),
 *   diag?: { append?: (row: object) => void },
 * }} options
 * @returns {{ preStep: (payload: any, next: () => Promise<any>) => Promise<any>, dispose: () => void }}
 */
export function registerHostNoticeGate({ on, isHostSession, diag }) {
	const preStep = (payload, next) => {
		const sessionId = payload?.agent?.session?.header?.id ?? payload?.agent?.session?.id ?? payload?.agent?.id;
		const messages = Array.isArray(payload?.messages) ? payload.messages : [];
		if (payload?.step !== 1 || messages.length === 0 || typeof sessionId !== 'string') return next();
		if (!messages.every((message) => message?.source?.kind === 'subagent-settled')) return next();
		const host = isHostSession(sessionId);
		if (host === null) return next();
		diag?.append?.({
			ev: 'host.notice.dropped',
			projectId: host.projectId,
			sessionId,
			turn: payload.turn ?? null,
			notices: messages.length,
			from: messages.map((message) => message.source.senderSessionId ?? null),
		});
		return Promise.resolve({ kind: 'reject' });
	};
	const off = typeof on === 'function' ? on('agent/pre-step', preStep) : null;
	return {
		preStep,
		dispose: () => {
			try { off?.(); } catch { /* already disposed */ }
		},
	};
}
