/**
 * PMO 宿主会话的模型不自己跑：进来的话转进文渊阁主对话，成员收工汇报原文呈现在宿主会话里。
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
 * 在官方接缝 `agent/pre-step` 上处理宿主会话每个回合的首步：
 * - Human 的文字以 Human 身份发到该项目主对话（`forwardHuman`，与在文渊阁里发言同一条路径：
 *   解除自主预算暂停、转给项目负责人）。转发失败时放行，让 Human 的话至少有人接（记 `.fail`）；
 * - 成员发来的话以该成员身份发到主对话（`forwardMember`），Human 与负责人都看得见；转发失败只记 `.fail`；
 * - 完成通知：il2c 11-19 宿主会话里只剩一排「已完成，用时1秒」——通知被拒后连同成员写好的收工汇报
 *   一起丢了。现在新通知放行进步骤（通知本身落进会话），同时在 `llm/stream` 上短路这一步的模型调用：
 *   回复就是收工汇报原文（全文，不截取），不发模型请求。宿主重启后重放的同文通知（il2c：133 条里 31 条）
 *   对照会话里已落的通知去重，不再呈现；
 * - 只剩 Human/成员转发或重放通知时一律 `{kind:'reject'}`，回合以 `blocked` 收口。
 * 只看首步（step 1），回合中途不碰（呈现回合没有工具调用，到不了第二步）。
 *
 * @param {{
 *   on?: (name: string, listener: Function) => (() => void),
 *   isHostSession: (sessionId: string) => ({ projectId: string } | null),
 *   forwardHuman: (projectId: string, text: string, attachments: object[]) => Promise<unknown>,
 *   forwardMember: (projectId: string, senderSessionId: string, text: string) => Promise<unknown>,
 *   memberOf?: (projectId: string, senderSessionId: string) => ({ name: string, avatarUrl?: string | null } | null | Promise<{ name: string, avatarUrl?: string | null } | null>),
 *   diag?: { append?: (row: object) => void },
 * }} options
 * @returns {{
 *   preStep: (payload: any, next: () => Promise<any>) => Promise<any>,
 *   llmStream: (options: any, next: () => AsyncIterable<any>) => AsyncIterable<any>,
 *   dispose: () => void,
 * }}
 */
export function registerHostSessionGate({ on, isHostSession, forwardHuman, forwardMember, memberOf, diag }) {
	const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('')
		.replace(/^Agent \S+ sent a message:\s*/, '')
		.trim();
	const kindOf = (message) => message?.source?.kind ?? null;
	const attachmentsOf = (message) => (Array.isArray(message?.content) ? message.content : [])
		.filter((block) => block?.type === 'image' || block?.type === 'file');
	// 宿主会话 id → 本步要呈现的收工汇报；pre-step 放行时写入，llm/stream 短路时取走。
	const reports = new Map();
	const preStep = async (payload, next) => {
		const session = payload?.agent?.session;
		const sessionId = session?.header?.id ?? session?.id ?? payload?.agent?.id;
		if (payload?.step !== 1 || typeof sessionId !== 'string') return next();
		const host = isHostSession(sessionId);
		if (host === null) return next();
		reports.delete(sessionId);
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
		const seen = settledTextsIn(session);
		const fresh = [];
		for (const message of notices) {
			const key = rawText(message);
			if (seen.has(key)) continue;
			seen.add(key);
			fresh.push(message);
		}
		const kinds = [...new Set(messages.map(kindOf))];
		if (fresh.length === 0) {
			diag?.append?.({ ev: 'host.turn.blocked', ...row, human: human.length, members: relayed, notices: notices.length, replays: notices.length, kinds });
			return { kind: 'reject' };
		}
		const decision = await next();
		if (decision?.kind !== 'enter') return decision;
		// Human 与成员的话已转走、重放通知已丢，不再进宿主模型历史；其余（新通知、运行时上下文）照常入步。
		const admitted = (Array.isArray(decision.messages) ? decision.messages : []).filter((message) => {
			const kind = kindOf(message);
			if (kind === 'user' || kind === 'agent-message') return false;
			if (kind === 'subagent-settled') return fresh.includes(message);
			return true;
		});
		const parts = [];
		for (const message of fresh) {
			let member = null;
			try {
				member = (await memberOf?.(host.projectId, message.source?.senderSessionId)) ?? null;
			} catch (error) {
				diag?.append?.({ ev: 'host.report.member.fail', ...row, message: error?.message ?? String(error) });
			}
			parts.push(settledReport(message, member));
		}
		reports.set(sessionId, parts.join('\n\n---\n\n'));
		diag?.append?.({ ev: 'host.turn.report', ...row, human: human.length, members: relayed, notices: notices.length, replays: notices.length - fresh.length, kinds });
		return { ...decision, messages: admitted };
	};
	const llmStream = (options, next) => {
		const sessionId = options?.sessionId;
		// 辅助调用（压缩摘要、标题等带 purpose）照常走模型；只短路宿主会话本步的对话请求。
		if (typeof sessionId !== 'string' || options?.purpose !== undefined || !reports.has(sessionId)) return next();
		const text = reports.get(sessionId);
		reports.delete(sessionId);
		return reportStream(text);
	};
	const offs = typeof on === 'function' ? [on('agent/pre-step', preStep), on('llm/stream', llmStream)] : [];
	return {
		preStep,
		llmStream,
		dispose: () => {
			for (const off of offs) {
				try { off?.(); } catch { /* already disposed */ }
			}
			reports.clear();
		},
	};
}

/** 通知原文（宿主拼的三段：摘要句、「Its closing message:」、收工汇报正文），作去重键。 */
function rawText(message) {
	return (Array.isArray(message?.content) ? message.content : [])
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('\n');
}

/** 会话里已落盘的完成通知原文集合（宿主重启后的重放与之同文）。 */
function settledTextsIn(session) {
	const seen = new Set();
	let events = [];
	try {
		events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
	} catch {
		events = [];
	}
	for (const event of events) {
		if (event?.type !== 'user/message' || event.data?.source?.kind !== 'subagent-settled') continue;
		seen.add(rawText(event.data));
	}
	return seen;
}

const STOP_LABELS = { completed: '完成', error: '失败', aborted: '中止', stopped: '被停止' };

/**
 * 一条完成通知 → 呈现文本（markdown）：抬头（成员头像 + 成员名 + 结局）+ 收工汇报全文。
 * 宿主通知形如 [「Background subagent X finished …」, 「Its closing message:」, 正文…]；
 * 没留汇报时为 [「… failed before it finished.」, 「It left no closing message.」]。
 * @param {any} message
 * @param {{ name: string, avatarUrl?: string } | null} member 查不到成员时 null，抬头退回子代理标签、不带头像
 * @returns {string}
 */
export function settledReport(message, member) {
	const blocks = (Array.isArray(message?.content) ? message.content : [])
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text);
	const marker = blocks.findIndex((text) => text.trim() === 'Its closing message:');
	const body = marker >= 0 ? blocks.slice(marker + 1).join('').trim() : '';
	const summary = message?.source?.summary ?? blocks[0] ?? '';
	const label = /Background subagent (\S+)/.exec(summary)?.[1] ?? null;
	const reason = message?.source?.stopReason;
	const outcome = STOP_LABELS[reason] ?? (typeof reason === 'string' ? reason : '结束');
	const who = member?.name ?? label ?? '成员';
	// 头像是磁盘上的 SVG 绝对路径（DSH 经自己的 /api/file 取图）；尖括号包住，路径里有空格也能解析。
	const face = typeof member?.avatarUrl === 'string' && member.avatarUrl !== '' ? `![${who}](<${member.avatarUrl}>) ` : '';
	return `${face}**${who}** 收工汇报（${outcome}）\n\n${body === '' ? '（未留下收工汇报）' : body}`;
}

/** 把呈现文本作为一次完整的 assistant 文本回复吐给循环（官方 `llm/stream` 短路）。 */
async function* reportStream(text) {
	yield { type: 'block-start', index: 0, blockType: 'text' };
	yield { type: 'text-delta', index: 0, text };
	yield { type: 'block-end', index: 0, block: { type: 'text', text } };
	yield { type: 'finish', reason: { kind: 'stop' } };
}
