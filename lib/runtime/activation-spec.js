/**
 * Build a `subagents.startActivation` spec every supported host accepts.
 *
 * The spec shape changed between DSH releases:
 *   - rc.1 (desktop) reads the task from a nested `spec.request`
 *     (`spec.request.parent`, `.cwd`, `.prompt`, `.agentOptions`, ...);
 *   - rc.2 / rc.3 flattened it: `SubagentActivationSpec extends
 *     SubagentStartRequest`, so they read `spec.parent`, `spec.cwd`, ...
 *     and a nested-only spec fails with "subagent creation requires the exact
 *     live parent agent" (every activation failed on rc.2+).
 *
 * Each host reads only its own fields and ignores the other's, so the spec
 * carries both: the request fields at the top level and the same object under
 * `request`. Top-level `provider` / `label` / `signal` / `delivery` win over
 * anything the request carries.
 *
 * @param {{ provider: string, label: string, signal: AbortSignal, delivery: 'parent'|'caller', request: object }} input
 */
export function activationSpec({ provider, label, signal, delivery, request }) {
	return { ...request, provider, label, signal, delivery, request };
}
