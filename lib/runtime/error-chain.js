/**
 * 把 Error 的 cause 链摊平成一行可检索文本。
 *
 * 实机背景：`subagents.sendMessage` 失败时外层只给
 * `subagent "X" is unavailable`，真实原因（persistence 读不出会话、descriptor
 * 不可续、血缘校验失败）挂在 `cause` 上被丢掉，诊断日志因此无法定位。
 */

const MAX_DEPTH = 4;
const MAX_PART = 240;

/**
 * @param {unknown} error
 * @returns {string|null} `code: message ← code: message`；没有 cause 时返回 null
 */
export function describeCauseChain(error) {
	if (error === undefined || error === null) return null;
	const parts = [];
	const seen = new Set();
	let current = error.cause;
	let depth = 0;
	while (current !== undefined && current !== null && depth < MAX_DEPTH && !seen.has(current)) {
		seen.add(current);
		const code = typeof current.code === 'string' && current.code !== '' ? `${current.code}: ` : '';
		const message = typeof current.message === 'string' ? current.message : String(current);
		parts.push(`${code}${message}`.slice(0, MAX_PART));
		current = current.cause;
		depth += 1;
	}
	return parts.length === 0 ? null : parts.join(' ← ');
}
