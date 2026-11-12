/**
 * 成员 shell 风险守卫。
 *
 * 实机事故：成员把项目名 `localservice` 误读成「Windows 常驻服务」，在工作目录里写了
 * `tools/serve.ps1`，再用 `Start-Process -WindowStyle Hidden -ExecutionPolicy Bypass`
 * 拉起一个隐藏窗口的常驻进程——这正是杀软启发式最敏感的组合（隐藏 PowerShell + 自启
 * 脚本 + 本地监听），用户那台机器因此报毒。
 *
 * 插件本身给成员的是 full-access（产品前提），但「悄悄起隐藏常驻进程」不该是默认行为。
 * 这里在 `tools.guard` 上挂一道守卫：
 * - `warn`（默认）：记录一条可见的 `.fail` 诊断行，放行；
 * - `block`：直接拒绝该次工具调用，理由回给成员；
 * - `off`：完全不介入。
 *
 * 只对**团队成员会话**生效：Human 自己的会话、host 会话不受影响。
 */

/** 高风险命令特征：隐藏窗口常驻进程、绕过执行策略、计划任务/服务注册、管道执行下载内容。 */
const PATTERNS = [
	{ id: 'hidden-window', re: /-windowstyle\s+hidden|-w\s+hidden/i, reason: '以隐藏窗口启动进程（杀软高危特征）' },
	{ id: 'bypass-policy', re: /-executionpolicy\s+bypass/i, reason: '绕过 PowerShell 执行策略' },
	{ id: 'encoded-command', re: /-(encodedcommand|enc)\s+[A-Za-z0-9+/=]{40,}/i, reason: '以 Base64 编码执行命令' },
	{ id: 'persist-service', re: /\b(sc\s+create|new-service|schtasks\s+\/create|reg\s+add\s+[^\n]*\\run)\b/i, reason: '注册系统服务/计划任务/开机自启' },
	{ id: 'pipe-to-shell', re: /\b(curl|wget|invoke-webrequest|iwr)\b[^\n|]*\|\s*(sh|bash|powershell|pwsh)\b/i, reason: '把下载内容直接管道给 shell 执行' },
	{ id: 'script-host', re: /\b(wscript|cscript|mshta)\b/i, reason: '用脚本宿主执行（wscript/cscript/mshta）' },
];

/**
 * 检查一段 shell 命令是否命中高风险特征。
 * @returns {{ id: string, reason: string, excerpt: string } | null}
 */
export function inspectShellCommand(command) {
	if (typeof command !== 'string' || command.trim() === '') return null;
	const text = command.replace(/\s+/g, ' ');
	for (const pattern of PATTERNS) {
		if (!pattern.re.test(text)) continue;
		const at = text.search(pattern.re);
		const excerpt = text.slice(Math.max(0, at - 40), Math.min(text.length, at + 120));
		return { id: pattern.id, reason: pattern.reason, excerpt };
	}
	return null;
}

/** 从工具入参里取出可能承载命令的字符串。 */
export function commandOfToolCall(name, args) {
	if (typeof name !== 'string') return '';
	const fields = Array.isArray(args) ? [] : Object.entries(args ?? {});
	const keys = ['command', 'cmd', 'script', 'code', 'input', 'args'];
	for (const [key, value] of fields) {
		if (typeof value !== 'string' || value === '') continue;
		if (keys.includes(key)) return value;
	}
	// 有些 shell 工具把命令放在数组参数里。
	for (const [, value] of fields) {
		if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(' ');
	}
	return '';
}

const SHELL_TOOLS = new Set(['pwsh', 'shell', 'bash', 'terminal', 'run_code', 'powershell']);

/**
 * 注册守卫。只对成员会话生效，返回 disposer。
 *
 * @param {object} options
 * @param {object} options.tools `ctx.tools`
 * @param {() => Set<string>} options.memberSessions 当前团队成员会话 id 集合
 * @param {(row: object) => void} options.diag
 * @param {'off'|'warn'|'block'} options.mode
 */
export function registerShellGuard({ tools, memberSessions, diag, mode = 'warn' }) {
	if (mode === 'off') return () => {};
	if (tools === undefined || typeof tools.guard !== 'function') return () => {};
	return tools.guard((execution) => {
		try {
			const name = execution?.name;
			if (!SHELL_TOOLS.has(String(name))) return undefined;
			const sessionId = execution?.agent?.id;
			const members = memberSessions();
			if (typeof sessionId !== 'string' || !members.has(sessionId)) return undefined;
			const command = commandOfToolCall(name, execution?.arguments);
			const hit = inspectShellCommand(command);
			if (hit === null) return undefined;
			diag?.append?.({
				ev: 'member.shell-risk.fail',
				memberId: null,
				sessionId,
				tool: String(name),
				pattern: hit.id,
				action: mode,
				excerpt: hit.excerpt,
			});
			if (mode === 'block') {
				return `已阻止：${hit.reason}。若要启动常驻进程，请让 Human 明确授权后手动执行，或改用可见窗口。`;
			}
			return undefined;
		} catch {
			// 守卫自身出错绝不能阻断工具调用。
			return undefined;
		}
	});
}
