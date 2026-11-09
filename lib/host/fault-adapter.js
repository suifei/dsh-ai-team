/**
 * Test-only LLM adapter. It is registered only when DSH_AI_TEAM_TEST=1 and
 * lets the Host exercise the real agent loop's failure path with deterministic
 * billing/network failures instead of external providers.
 */

export const FAULT_PROVIDER = 'ai-team-fault';

export function installFaultAdapter(llm, getMode) {
	if (!llm || typeof llm.registerAdapter !== 'function') return () => {};
	const model = { provider: FAULT_PROVIDER, id: 'fault', name: 'Fault model' };
	const adapter = {
		providerInfo(provider) {
			return { id: provider, name: 'AI Team Fault' };
		},
		providerRetryPolicy() {
			return undefined;
		},
		imageRequestPricing() {
			return undefined;
		},
		imageRequestTarget() {
			return { width: 0, height: 0, maxBytes: 0 };
		},
		async listModels() {
			return [{ ...model }];
		},
		async resolveModel(provider, id) {
			return { provider, id, name: id };
		},
		async prepareCall(provider, id) {
			return {
				model: { provider, id, name: id },
				stream: () => streamFault(getMode()),
			};
		},
		stream() {
			return streamFault(getMode());
		},
	};
	const dispose = llm.registerAdapter([FAULT_PROVIDER], adapter);
	return typeof dispose === 'function' ? dispose : () => {};
}

async function* streamFault(mode) {
	const failure = mode === 'billing'
		? { message: 'Injected billing failure', code: 'BILLING', status: 402 }
		: { message: 'Injected network reset', code: 'ECONNRESET' };
	yield { type: 'finish', reason: { kind: 'error', failure } };
}
