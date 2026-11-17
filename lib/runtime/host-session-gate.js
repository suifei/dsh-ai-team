/**
 * PMO 宿主会话的模型不自己跑：进来的话转进文渊阁主对话，成员完成通知丢弃。
 *
 * 宿主会话（标题「【项目】文渊阁·PMO」）只是成员会话的父会话：团队推进由插件 PMO tick 与
 * 项目负责人承担，宿主模型进不了看板（team 工具 E_NOT_MEMBER）。可它会被三类输入叫醒：
 * - 成员回合收尾的「Background subagent … finished」通知（`source.kind === 'subagent-settled'`）。
 *   il2c 11-17：宿主模型被叫醒后自当 PMO，send_message 催成员撞 NOT_RESUMABLE、自派子代理，
 *   成了第二个 PMO（0.4.118）；
 * - Human 在桌面版里直接打开这个会话说话（`source.kind === 'user'`）。il2c 11-17 16:33：Human 在这里
 *   发「继续」，插件只认文渊阁主对话，账本没有 Human 消息，自主预算的暂停不解除、墨渊不被叫醒；
 *   宿主模型代办又办不成，还让 Human「去点一下墨渊的席位」；
 * - 成员用 send_message 发给宿主的话（`source.kind === 'agent-message'`，r38 E2E：成员把宿主当主理人汇报）。
 *
 * 在官方接缝 `agent/pre-step` 上处理宿主会话每个回合的首步，一律 `{kind:'reject'}`——回合以
 * `blocked` 收口，不发模型请求；被拒的批次随即丢弃，所以先把其中的话转走：
 * - Human 的文字以 Human 身份发到该项目主对话（`forwardHuman`，与在文渊阁里发言同一条路径：
 *   解除自主预算暂停、转给项目负责人）。转发失败时放行，让 Human 的话至少有人接（记 `.fail`）；
 * - 成员发来的话以该成员身份发到主对话（`forwardMember`），Human 与负责人都看得见；转发失败只记 `.fail`；
 * - 完成通知只记诊断。
 * 只看首步（step 1），回合中途不碰（首步已拒，宿主回合到不了中途）。
 *
 * @param {{
 *   on?: (name: string, listener: Function) => (() => void),
 *   isHostSession: (sessionId: string) => ({ projectId: string } | null),
 *   forwardHuman: (projectId: string, text: string, attachments: object[]) => Promise<unknown>,
 *   forwardMember: (projectId: string, senderSessionId: string, text: string) => Promise<unknown>,
 *   diag?: { append?: (row: object) => void },
 * }} options
 * @returns {{ preStep: (payload: any, next: () => Promise<any>) => Promise<any>, dispose: () => void }}
 */
export function registerHostSessionGate({ on, isHostSession, forwardHuman, forwardMember, diag }) {
	const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('')
		.replace(/^Agent \S+ sent a message:\s*/, '')
		.trim();
	const kindOf = (message) => message?.source?.kind ?? null;
	const attachmentsOf = (message) => (Array.isArray(message?.content) ? message.content : [])
		.filter((block) => block?.type === 'image' || block?.type === 'file');
	const preStep = async (payload, next) => {
		const sessionId = payload?.agent?.session?.header?.id ?? payload?.agent?.session?.id ?? payload?.agent?.id;
		if (payload?.step !== 1 || typeof sessionId !== 'string') return next();
		const host = isHostSession(sessionId);
		if (host === null) return next();
		const messages = Array.isArray(payload?.messages) ? payload.messages : [];
		const row = { projectId: host.projectId, sessionId, turn: payload.turn ?? null };
		// #65：Human 在 DSH 标准会话里贴的图片/文件（已落盘的附件引用）随文字一起转进主对话。
		const human = messages.filter((message) => kindOf(message) === 'user')
			.map((message) => ({ text: textOf(message), attachments: attachmentsOf(message) }))
			.filter((said) => said.text !== '' || said.attachments.length > 0);
		for (const { text, attachments } of human) {
			try {
				await forwardHuman(host.projectId, text, attachments);
			} catch (error) {
				diag?.append?.({ ev: 'host.human.forward.fail', ...row, message: error?.message ?? String(error) });
				return next();
			}
		}
		const fromMembers = messages.filter((message) => kindOf(message) === 'agent-message');
		let relayed = 0;
		for (const message of fromMembers) {
			const text = textOf(message);
			if (text === '') continue;
			try {
				await forwardMember(host.projectId, message.source.senderSessionId, text);
				relayed += 1;
			} catch (error) {
				diag?.append?.({ ev: 'host.member.forward.fail', ...row, from: message.source.senderSessionId ?? null, message: error?.message ?? String(error) });
			}
		}
		const notices = messages.filter((message) => kindOf(message) === 'subagent-settled');
		diag?.append?.({
			ev: 'host.turn.blocked',
			...row,
			human: human.length,
			members: relayed,
			notices: notices.length,
			kinds: [...new Set(messages.map(kindOf))],
		});
		return { kind: 'reject' };
	};
	const off = typeof on === 'function' ? on('agent/pre-step', preStep) : null;
	return {
		preStep,
		dispose: () => {
			try { off?.(); } catch { /* already disposed */ }
		},
	};
}
