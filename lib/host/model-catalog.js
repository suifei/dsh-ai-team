/**
 * Read the model directory from the live DSH `llm` service. The workbench must
 * never ask the user to type provider/model ids: those ids already exist in the
 * Host and can change when accounts/adapters are configured.
 */

function safeDefault(agentDefaultModel) {
	try {
		const selection = agentDefaultModel?.currentSelection?.();
		if (selection === null || typeof selection !== 'object') return null;
		if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return null;
		return { provider: selection.provider, model: selection.model };
	} catch {
		return null;
	}
}

function modelRows(models) {
	const seen = new Set();
	const rows = [];
	for (const model of Array.isArray(models) ? models : []) {
		if (model === null || typeof model !== 'object' || typeof model.id !== 'string' || model.id === '') continue;
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		rows.push({
			id: model.id,
			name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
			...(typeof model.description === 'string' && model.description !== '' ? { description: model.description } : {}),
			...(Array.isArray(model.inputModalities) ? { inputModalities: model.inputModalities } : {}),
		});
	}
	return rows;
}

/**
 * @param {any} llm live DSH llm service
 * @param {any} agentDefaultModel live DSH default-model service
 */
export async function buildModelCatalog(llm, agentDefaultModel) {
	const defaultModel = safeDefault(agentDefaultModel);
	if (llm === undefined || llm === null || typeof llm.listProviders !== 'function') {
		return {
			ok: false,
			defaultModel,
			providers: [],
			error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'the DSH llm service is unavailable' },
		};
	}
	let providers;
	try {
		providers = llm.listProviders();
	} catch (error) {
		return {
			ok: false,
			defaultModel,
			providers: [],
			error: { code: 'E_MODEL_DIRECTORY', message: error?.message ?? String(error) },
		};
	}
	const rows = await Promise.all((Array.isArray(providers) ? providers : []).map(async (provider) => {
		const id = typeof provider?.id === 'string' ? provider.id : '';
		const name = typeof provider?.name === 'string' && provider.name !== '' ? provider.name : id;
		if (id === '') return null;
		try {
			const models = modelRows(await llm.listModels(id));
			return { id, name, models, modelCount: models.length };
		} catch (error) {
			return {
				id,
				name,
				models: [],
				modelCount: 0,
				error: error?.message ?? String(error),
			};
		}
	}));
	const available = rows.filter((row) => row !== null);
	return {
		ok: true,
		defaultModel,
		providers: available,
		providerCount: available.length,
		modelCount: available.reduce((total, row) => total + row.models.length, 0),
	};
}
