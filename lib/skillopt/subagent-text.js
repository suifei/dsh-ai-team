/**
 * 一次性子代理的「等完成 + 取最终文本」——单一份实现，judge 与生成器共用。
 *
 * 取证依据（@deepseek-ai/dsh-subagent/lib/types/assistant-output.js）：
 * 子代理的最终输出**不是** `activation.result`，而是
 * `activation.handle.agent.session.snapshotEvents(activation.outputStart)` 中
 * **最后一个非空 `assistant/message`** 的 `data.message.content`；
 * 若无消息，回退到 `assistant/attempt|message` 的 `data.stream` 累积文本。
 */

const END_EVENTS = new Set(['subagent/end', 'session/end']);

/** 从会话事件里提取最终 assistant 文本。 */
export function extractAssistantText(events) {
	let message = null;
	const streamPieces = [];
	for (const event of Array.isArray(events) ? events : []) {
		if (event?.type === 'assistant/message') {
			const content = event?.data?.message?.content;
			if (Array.isArray(content) && content.length > 0) message = content;
		}
		if (event?.type === 'assistant/message' || event?.type === 'assistant/attempt') {
			const pieces = event?.data?.stream;
			if (Array.isArray(pieces)) {
				for (const piece of pieces) {
					const text = typeof piece === 'string' ? piece : piece?.text;
					if (typeof text === 'string' && text !== '') streamPieces.push(text);
				}
			}
		}
	}
	if (message === null) return streamPieces.join('');
	return message
		.map((block) => (typeof block === 'string' ? block : block?.text ?? ''))
		.filter((text) => text !== '')
		.join('\n');
}

/**
 * 等子代理结束并返回最终文本。
 *
 * 两条真实路径（按可用性选择）：
 * 1. `activation.result` 是执行结果 Promise（实测返回对象含 childId/result/
 *    dispose/messageId）——解析其 output/content/lastAssistantMessage；
 * 2. 若只有 `activation.handle.agent.session`，则轮询 snapshotEvents
 *    （见 extractAssistantText 的事件规则）。
 *
 * @param {object} activation startActivation 返回
 * @param {{timeoutMs?: number, pollMs?: number}} [options]
 * @returns {Promise<string>}
 */
export async function awaitActivationText(activation, options = {}) {
	const timeoutMs = options.timeoutMs ?? 120_000;
	const pollMs = options.pollMs ?? 400;
	const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));

	// 路径 1：result Promise（实测的主路径）。
	const pending = activation?.result;
	if (pending !== undefined && pending !== null && typeof pending.then === 'function') {
		const settled = await Promise.race([Promise.resolve(pending).catch(() => null), timeout]);
		const text = textOfResult(settled);
		if (text !== '') return text;
		// 空结果时继续走事件路径（某些 backend 只在会话事件里留输出）。
	}

	// 路径 2：会话事件轮询。
	const agent = activation?.handle?.agent;
	const readEvents = () => {
		try {
			return agent?.session?.snapshotEvents?.(activation?.outputStart) ?? [];
		} catch {
			return [];
		}
	};
	const deadline = Date.now() + timeoutMs;
	const finished = (events) => events.some((event) => END_EVENTS.has(event?.type));
	while (Date.now() < deadline) {
		const events = readEvents();
		if (finished(events) || (agent?.status === 'idle' && events.length > 0)) return extractAssistantText(events);
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return extractAssistantText(readEvents());
}

/** 把 activation.result 的值归一成文本（兼容 string / output 数组 / content）。 */
export function textOfResult(settled) {
	if (settled === null || settled === undefined) return '';
	if (typeof settled === 'string') return settled;
	const candidates = [settled.output, settled.content, settled.lastAssistantMessage, settled.text];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate !== '') return candidate;
		if (Array.isArray(candidate)) {
			const text = candidate
				.map((part) => (typeof part === 'string' ? part : part?.text ?? part?.content ?? ''))
				.filter((piece) => piece !== '')
				.join('\n');
			if (text !== '') return text;
		}
	}
	return '';
}
