import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCatalog, buildModelEfforts } from '../lib/host/model-catalog.js';

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

test('model efforts come from the live llm service, deduped, and missing levels stay distinguishable', async () => {
	const llm = {
		resolveModelInfo: async (provider, model) => {
			if (model === 'plain') return { provider, id: model };
			if (model === 'broken') throw new Error('adapter exploded');
			return {
				provider,
				id: model,
				reasoning: {
					defaultEffort: 'high',
					efforts: [
						{ id: 'off', name: 'Off' },
						{ id: 'high', name: 'High', description: 'balanced' },
						{ id: 'high', name: 'duplicate' },
					],
				},
			};
		},
	};
	const deep = await buildModelEfforts(llm, 'p1', 'deep');
	assert.equal(deep.ok, true);
	assert.equal(deep.defaultEffort, 'high');
	assert.deepEqual(deep.efforts.map((effort) => effort.id), ['off', 'high']);
	assert.equal(deep.efforts[1].description, 'balanced');

	// 「该模型没有推理等级」与「查不到」必须能区分：前者 ok:true + 空列表，后者 ok:false。
	const plain = await buildModelEfforts(llm, 'p1', 'plain');
	assert.equal(plain.ok, true);
	assert.deepEqual(plain.efforts, []);
	assert.equal(plain.defaultEffort, null);

	const broken = await buildModelEfforts(llm, 'p1', 'broken');
	assert.equal(broken.ok, false);
	assert.equal(broken.error.code, 'E_MODEL_EFFORTS');
	assert.match(broken.error.message, /adapter exploded/);
});

test('model efforts reject an incomplete route and degrade without the llm service', async () => {
	assert.equal((await buildModelEfforts({ resolveModelInfo: async () => ({}) }, '', 'm1')).error.code, 'E_INVALID_ARGUMENT');
	assert.equal((await buildModelEfforts(undefined, 'p1', 'm1')).error.code, 'E_RUNTIME_UNAVAILABLE');
});
