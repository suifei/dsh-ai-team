/**
 * Repair Team Host sessions archived by earlier revisions.
 *
 * Members are subagent descendants of the Host Agent, and
 * `archived-session-gate` (dsh-api-session-controller) rejects every
 * `agent/pre-step` whose Session — or any Session above it in the subagent
 * lineage — is archived. The loop then ends the turn as `{kind:'blocked'}`
 * **without issuing a model request**, so an archived Host silently disables
 * the whole team (measured: 453 blocked turns, 0 completed, no `request/header`).
 *
 * Earlier revisions archived the Host on purpose to hide it from the session
 * list. This sweep lifts that damage by calling `unarchiveSession` for the
 * persisted host of each runtime and the `parentSession` of every member session.
 *
 * Two constraints learned the hard way:
 *   1. Use only the **documented** API. `archivedSessionIds` is not part of the
 *      workspaceRegistry contract; gating on it silently skipped the whole
 *      repair. `unarchiveSession` on a non-archived id resolves without writing,
 *      so calling it unconditionally is safe and needs no read-back.
 *   2. Diagnostics ending without `.fail` are dropped at the default `errors`
 *      diag level. Failure rows therefore carry `.fail`; success is proven by
 *      the durable archive list, not by a log line.
 */

/**
 * @param {{
 *   runtimes: Iterable<any>,
 *   sessions?: { get?: (id: string) => any },
 *   workspaceRegistry?: { unarchiveSession?: (id: string) => Promise<void> },
 *   diag?: { append?: (row: any) => any } | null,
 *   knownHostSessionIds?: Iterable<string>
 * }} options
 * @returns {Promise<string[]|null>} session ids the sweep asked to unarchive;
 *   `null` means the registry was not ready yet and the caller should retry.
 */
export async function repairArchivedHosts(options = {}) {
	const registry = options.workspaceRegistry;
	// `workspaceRegistry` 要等 sessionPersistence 与历史 bootstrap 完成才 active，
	// 插件激活瞬间常常还取不到。此时返回 null（而不是空数组）让调用方保持
	// 「未修复」状态，等下一个 tick 重试——而不是一次失败就永久放弃。
	if (registry === undefined || registry === null || typeof registry.unarchiveSession !== 'function') return null;

	const victims = new Set();
	for (const known of options.knownHostSessionIds ?? []) {
		if (typeof known === 'string' && known !== '') victims.add(known);
	}
	for (const runtime of options.runtimes ?? []) {
		const hostId = runtime?.service?.state?.hostSessionId;
		if (typeof hostId === 'string' && hostId !== '') victims.add(hostId);
		for (const member of Object.values(runtime?.service?.state?.members ?? {})) {
			const sessionId = member?.sessionId;
			if (typeof sessionId !== 'string' || sessionId === '') continue;
			try {
				const header = options.sessions?.get?.(sessionId)?.header;
				if (typeof header?.parentSession === 'string') victims.add(header.parentSession);
			} catch { /* member session is not live; skip */ }
		}
	}

	const repaired = [];
	for (const sessionId of victims) {
		try {
			await registry.unarchiveSession(sessionId);
			repaired.push(sessionId);
		} catch (error) {
			options.diag?.append?.({ ev: 'host.unarchive.fail', sessionId, message: error?.message ?? String(error) });
		}
	}
	return repaired;
}
