/**
 * Last-line defense for the Team policy: every tool call from a managed member
 * must run with danger-full-access. Activation and wake check once; this guard
 * closes the "permission changed mid-turn" window by repairing before dispatch.
 */

export const TEAM_PERMISSION = 'danger-full-access';

/**
 * 目标权限的**预设名**不该被硬编码：部署方可能把 danger-full-access 这一档
 * 起成别的名字（例如 `full`）。名字不存在时 `set()` 会抛错，guard 进而拒绝
 * 成员的每一次工具调用——整个团队被一个改名卡死。这里按「约定的名字 → 表里
 * 第一个 sandbox 为 danger-full-access 的预设」解析，找不到才退回约定名。
 */
export function resolveTeamPreset(permissionPresets) {
	const sandboxOf = (name) => {
		try { return permissionPresets?.resolve?.(name)?.sandbox ?? null; } catch { return null; }
	};
	if (sandboxOf(TEAM_PERMISSION) === TEAM_PERMISSION) return TEAM_PERMISSION;
	// 真实契约里没有 `list()`（用 cordis_inspect 核对过 service 签名）：
	// 目录是 `catalog()` → `{ options: PresetOption[], defaultOptions, defaultPreset }`，
	// 每个 option 的 key 在 `value` 上。按 `list()` 读会永远拿不到候选，
	// 于是「预设名可配置」这条修复静默失效。
	let options = [];
	try {
		options = permissionPresets?.catalog?.()?.options ?? [];
	} catch {
		options = [];
	}
	if (!Array.isArray(options) || options.length === 0) {
		try { options = permissionPresets?.list?.() ?? []; } catch { options = []; }
	}
	for (const entry of Array.isArray(options) ? options : []) {
		const name = typeof entry === 'string' ? entry : (entry?.value ?? entry?.name ?? entry?.id);
		if (typeof name !== 'string' || name === '') continue;
		if (sandboxOf(name) === TEAM_PERMISSION) return name;
	}
	return TEAM_PERMISSION;
}

export function createMemberPermissionGuard({ service, permissionPresets, sandboxPolicy }) {
	return (execution) => {
		const session = execution?.agent?.session;
		if (session === undefined || session === null) return undefined;
		const members = Object.values(service?.state?.members ?? {});
		const member = members.find((entry) => entry.kind === 'agent' && entry.sessionId === execution.agent.id);
		if (member === undefined) return undefined;
		const presetName = resolveTeamPreset(permissionPresets);
		if (sandboxPolicy?.overrideOf?.(session) !== TEAM_PERMISSION) {
			try {
				permissionPresets?.set?.(session, presetName);
			} catch {
				return `member ${member.name ?? member.id} cannot restore ${presetName}`;
			}
		}
		if (sandboxPolicy?.overrideOf?.(session) !== TEAM_PERMISSION) {
			return `member ${member.name ?? member.id} is not ${TEAM_PERMISSION}`;
		}
		return undefined;
	};
}
