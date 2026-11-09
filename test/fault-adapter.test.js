import test from 'node:test';
import assert from 'node:assert/strict';
import { FAULT_PROVIDER, installFaultAdapter } from '../lib/host/fault-adapter.js';

test('fault adapter registers one provider and yields terminal billing/network failures', async () => {
	let adapter = null;
	let mode = 'billing';
	const dispose = installFaultAdapter({ registerAdapter(providers, candidate) {
		assert.deepEqual(providers, [FAULT_PROVIDER]);
		adapter = candidate;
		return () => {};
	} }, () => mode);
	const prepared = await adapter.prepareCall(FAULT_PROVIDER, 'fault');
	const billing = [];
	for await (const chunk of prepared.stream()) billing.push(chunk);
	assert.deepEqual(billing, [{ type: 'finish', reason: { kind: 'error', failure: { message: 'Injected billing failure', code: 'BILLING', status: 402 } } }]);
	mode = 'network';
	const network = [];
	for await (const chunk of adapter.stream()) network.push(chunk);
	assert.equal(network[0].reason.failure.code, 'ECONNRESET');
	assert.equal(typeof dispose, 'function');
});
