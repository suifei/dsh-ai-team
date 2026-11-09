/**
 * Last-line defense for the Team policy: every tool call from a managed member
 * must run with danger-full-access. Activation and wake check once; this guard
 * closes the "permission changed mid-turn" window by repairing before dispatch.
 */

export const TEAM_PERMISSION = 'danger-full-access';

export function createMemberPermissionGuard({ service, permissionPresets, sandboxPolicy }) {
	return (execution) => {
		const session = execution?.agent?.session;
		if (session === undefined || session === null) return undefined;
		const members = Object.values(service?.state?.members ?? {});
		const member = members.find((entry) => entry.kind === 'agent' && entry.sessionId === execution.agent.id);
		if (member === undefined) return undefined;
		if (sandboxPolicy?.overrideOf?.(session) !== TEAM_PERMISSION) {
			try {
				permissionPresets?.set?.(session, TEAM_PERMISSION);
			} catch {
				return `member ${member.name ?? member.id} cannot restore ${TEAM_PERMISSION}`;
			}
		}
		if (sandboxPolicy?.overrideOf?.(session) !== TEAM_PERMISSION) {
			return `member ${member.name ?? member.id} is not ${TEAM_PERMISSION}`;
		}
		return undefined;
	};
}
