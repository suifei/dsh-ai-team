import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCatalog } from '../lib/host/model-catalog.js';

const defaultModel = { currentSelection: () => ({ provider: 'p1', model: 'm1' }) };

test('model catalog reads providers and models from the DSH llm service', async () => {
	const catalog = await buildModelCatalog({
		listProviders: () => [
			{ id: 'p1', name: 'Provider One' },
			{ id: 'bad', name: 'Broken Provider' },
		],
		listModels: async (provider) => {
			if (provider === 'bad') throw new Error('catalog unavailable');
			return [{ id: 'm1', name: 'Model One' }, { id: 'm1', name: 'Duplicate' }, { id: 'm2' }];
		},
	}, defaultModel);
	assert.equal(catalog.ok, true);
	assert.deepEqual(catalog.defaultModel, { provider: 'p1', model: 'm1' });
	assert.equal(catalog.providerCount, 2);
	assert.deepEqual(catalog.providers[0].models.map((model) => model.id), ['m1', 'm2']);
	assert.equal(catalog.providers[0].models[0].name, 'Model One');
	assert.match(catalog.providers[1].error, /catalog unavailable/);
	assert.equal(catalog.providers[1].modelCount, 0);
});

test('model catalog degrades cleanly without the llm service', async () => {
	const catalog = await buildModelCatalog(undefined, defaultModel);
	assert.equal(catalog.ok, false);
	assert.deepEqual(catalog.providers, []);
	assert.equal(catalog.error.code, 'E_RUNTIME_UNAVAILABLE');
	assert.deepEqual(catalog.defaultModel, { provider: 'p1', model: 'm1' });
});
