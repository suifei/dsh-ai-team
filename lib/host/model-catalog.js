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
		// 宿主默认选择自身也可能带推理等级；没有就不写这个键，客户端据此回退「跟随默认」。
		const effort = selection.reasoningEffort ?? selection.reasoning?.effort ?? null;
		return {
			provider: selection.provider,
			model: selection.model,
			...(typeof effort === 'string' && effort !== '' ? { reasoningEffort: effort } : {}),
		};
	} catch {
		return null;
	}
}

/**
 * 读取一个 provider/model 路由支持的推理等级（DSH `llm.resolveModelInfo().reasoning`）。
 *
 * 只在用户选定「提供商 + 模型」之后按需调用：`/api/models` 列目录时逐个解析会把
 * 目录接口拖成 N 次适配器往返。返回 `ok:false` 表示**查不到**（服务缺失/适配器报错），
 * 与 `ok:true, efforts: []`（模型确实没有推理等级）是两件事，界面提示也不同。
 */
export async function buildModelEfforts(llm, provider, model) {
	const route = { provider: typeof provider === 'string' ? provider.trim() : '', model: typeof model === 'string' ? model.trim() : '' };
	if (route.provider === '' || route.model === '') {
		return { ok: false, ...route, efforts: [], defaultEffort: null, error: { code: 'E_INVALID_ARGUMENT', message: 'provider and model are required' } };
	}
	if (llm === undefined || llm === null || typeof llm.resolveModelInfo !== 'function') {
		return { ok: false, ...route, efforts: [], defaultEffort: null, error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'the DSH llm service is unavailable' } };
	}
	let info;
	try {
		info = await llm.resolveModelInfo(route.provider, route.model);
	} catch (error) {
		return { ok: false, ...route, efforts: [], defaultEffort: null, error: { code: 'E_MODEL_EFFORTS', message: error?.message ?? String(error) } };
	}
	const reasoning = info?.reasoning;
	const seen = new Set();
	const efforts = [];
	for (const effort of Array.isArray(reasoning?.efforts) ? reasoning.efforts : []) {
		const id = typeof effort?.id === 'string' ? effort.id : '';
		if (id === '' || seen.has(id)) continue;
		seen.add(id);
		efforts.push({
			id,
			name: typeof effort?.name === 'string' && effort.name !== '' ? effort.name : id,
			...(typeof effort?.description === 'string' && effort.description !== '' ? { description: effort.description } : {}),
		});
	}
	const defaultEffort = typeof reasoning?.defaultEffort === 'string' && reasoning.defaultEffort !== '' ? reasoning.defaultEffort : null;
	return { ok: true, ...route, efforts, defaultEffort };
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
