import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from '../index.js';

test('bundle metadata is coherent', async () => {
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	assert.equal(pkg.name, '@suifei/dsh-ai-team');
	assert.equal(pkg.type, 'module');
	assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
	assert.equal(pkg.dsh.client.platform, 'web');
	assert.equal(pkg.scripts.test, 'node --test');
	const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
	assert.match(patch, /id:\s*ai-team/);
	assert.match(patch, /@suifei\/dsh-ai-team/);
	assert.match(patch, /mode:\s*danger-full-access/);
	assert.match(patch, /defaultPreset:\s*danger-full-access/);
	const icon = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
	assert.match(icon, /<svg\b/);
});

test('host refuses a profile without danger-full-access', async () => {
	const routes = [];
	const ctx = {
		effect(fn) { fn(); },
		get(id) {
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') {
				return {
					catalog: () => ({ defaultPreset: 'workspace-write', options: [], defaultOptions: [] }),
					resolve: () => ({ sandbox: 'workspace-write', approval: 'ask' }),
				};
			}
			if (id === 'sandboxPolicy') return { defaultMode: 'workspace-write' };
			return undefined;
		},
	};
	apply(ctx);
	assert.equal(routes.length, 1);
	const server = createServer((req, res) => routes[0].handler(req, res));
	try {
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${server.address().port}`;
		const health = await fetch(`${base}/ai-team/api/health`);
		assert.equal(health.status, 503);
		const body = await health.json();
		assert.equal(body.error.code, 'BOOT_FAILED');
	} finally {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	}
});

test('host mounts the workbench routes on a real default-project ledger', async () => {
	const routes = [];
	const memberSessions = new Map();
	// 激活计数：跨 ctx.get('subagents') 调用共享（每次激活 = 新 childId）。
	let activationCounter = 0;
	const workspaceAttachments = [];
	const requestErrorListeners = [];
	const sessionEventListeners = [];
	const wakeCalls = [];
	const memberAgents = new Map();
	const disposedHandles = [];
	let toolRegistration = null;
	const root = await mkdtemp(join(tmpdir(), 'ai-team-host-'));
	const previousHome = process.env.DSH_HOME;
	const previousProfile = process.env.DSH_PROFILE;
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'test';
	let disposeEffect = null;
	const ctx = {
		effect(fn) {
			disposeEffect = fn();
		},
		on(event, listener) {
			if (event === 'agent/request-error') requestErrorListeners.push(listener);
			if (event === 'session/event') sessionEventListeners.push(listener);
			return () => {};
		},
		get(id) {
			if (id === 'webServer') {
				return {
					register(route) {
						routes.push(route);
						return () => {};
					},
				};
			}
			if (id === 'permissionPresets') {
				return {
					catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }),
					resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
					set: (session, name) => { session.sandbox = name; },
				};
			}
			if (id === 'sandboxPolicy') {
				return { defaultMode: 'danger-full-access', overrideOf: (session) => session?.sandbox };
			}
			if (id === 'agents') {
				return {
					roots: () => [],
					get: (sessionId) => memberAgents.get(sessionId),
					create: async (options) => {
						const session = { id: options.sessionId, sandbox: 'workspace-write' };
						memberSessions.set(options.sessionId, session);
						const agent = {
							id: options.sessionId,
							session,
							followup: (message) => {
								const text = message?.content?.[0]?.text ?? '';
								if (text.includes('Team event')) wakeCalls.push({ targetId: options.sessionId, content: message.content });
							},
						};
						memberAgents.set(options.sessionId, agent);
						return { agent, dispose: async () => { disposedHandles.push(options.sessionId); } };
					},
					resume: async ({ resumeSessionId }) => ({
						agent: memberAgents.get(resumeSessionId),
						dispose: async () => { disposedHandles.push(resumeSessionId); },
					}),
				};
			}
			if (id === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p1', model: 'm1' }) };
			if (id === 'llm') {
				return {
					listProviders: () => [{ id: 'p1', name: 'Provider One' }, { id: 'p2', name: 'Provider Two' }],
					listModels: async (provider) => provider === 'p1'
						? [{ id: 'm1', name: 'Model One' }]
						: [{ id: 'm2', name: 'Model Two' }],
				};
			}
			if (id === 'workspaceRegistry') {
				return {
					resolveByPath: async () => ({ attachSession: async (sessionId) => { workspaceAttachments.push(sessionId); } }),
					archiveSession: async () => {},
				};
			}
			if (id === 'subagents') {
				return {
					list: () => ['local'],
					startActivation: async (spec) => {
						// 每次激活分配新 childId：reseat 断言依赖「重建 = 新会话」。
						// counter 必须跨 ctx.get 调用共享（放在外层激活计数）。
						activationCounter += 1;
						const childId = 'session-member-' + activationCounter;
						memberSessions.set(childId, { id: childId, sandbox: 'workspace-write' });
						return {
							childId,
							messageId: 'msg-member-' + activationCounter,
							result: Promise.resolve({ output: [], stopReason: 'completed' }),
							// reseat 断言依赖「旧 activation 被 dispose」：记录到共享数组。
							dispose: async () => { disposedHandles.push(childId); },
						};
					},
					sendMessage: async (parent, targetId, content) => {
						wakeCalls.push({ parent, targetId, content });
						return 'msg-wake-1';
					},
				};
			}
			if (id === 'sessions') return { get: (sessionId) => memberSessions.get(sessionId), flush: async () => true };
			if (id === 'tools') {
				return {
					register(definition, options) {
						toolRegistration = { definition, options };
						return () => {};
					},
				};
			}
			return undefined;
		},
	};
	let server = null;
	try {
		apply(ctx);
		assert.equal(name, 'ai-team');
		assert.deepEqual(inject, ['webServer', 'permissionPresets', 'sandboxPolicy', 'tools', 'shell', 'agents', 'subagents', 'sessions'], 'inject declares every service the plugin touches (cordis proxies need it)');
		assert.equal(routes.length, 1);
		const route = routes[0];
		assert.equal(route.kind, 'prefix');
		assert.equal(route.path, '/ai-team');
		assert.equal(typeof route.handler, 'function');

		server = createServer((req, res) => route.handler(req, res));
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${server.address().port}`;

		const ledgerFile = join(root, 'ai-team', 'test', 'projects', 'prj_main', 'ledger-000001.jsonl');
		assert.equal((await stat(ledgerFile)).isFile(), true);

		const health = await fetch(`${base}/ai-team/api/health`);
		assert.equal(health.status, 200);
		const healthBody = await health.json();
		assert.equal(healthBody.ok, true);
		assert.equal(healthBody.plugin, 'ai-team');
		assert.equal(healthBody.projectId, 'prj_main');

		const boot = await fetch(`${base}/ai-team/api/bootstrap`);
		assert.equal(boot.status, 200);
		const data = await boot.json();
		assert.equal(data.project.name, '我的项目');
		assert.equal(data.projects.length, 1);
		assert.equal(data.tasks.length, 0);
		assert.equal(data.agents.length, 6);
		assert.equal(data.members.length, 7);
		assert.deepEqual(data.agents.map((agent) => agent.name), ['墨渊', '青岚', '白砚', '玄策', '知微', '观澜']);
		assert.equal(data.agents.find((agent) => agent.name === '墨渊').role, '主理人');
		assert.equal(data.agents.find((agent) => agent.name === '白砚').qa, true);
		assert.equal(data.project?.owner, 'mem_lead');
		assert.equal(data.project?.pmoAuto, true);
		assert.equal(data.projects[0].pmoAuto, true);

		// P5b：目录必须真实存在——测试用真实临时目录（假路径会被校验拒绝）。
		const realWorkspace = await mkdtemp(join(tmpdir(), 'ai-team-ws-'));
		const workspace = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'project.workspace.update',
				payload: { workspacePath: realWorkspace },
			}),
		});
		assert.equal(workspace.status, 200);
		assert.equal((await workspace.json()).project.workspacePath, realWorkspace);
		const afterWorkspace = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(afterWorkspace.project.workspacePath, realWorkspace);

		// P5b 回归：不存在的目录必须被拒绝（成员会话 cwd 无效会让回合全失败）。
		const badWorkspace = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'project.workspace.update',
				payload: { workspacePath: 'E:/definitely-not-existing-dir-xyz' },
			}),
		});
		assert.equal(badWorkspace.status, 409, 'a non-existent workspace must be rejected');

		// P4 回归：最后一个 active 项目不可归档（host 层用全局 registry 判定）。
		const lastArchive = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'project.archive', payload: { archived: true } }),
		});
		assert.equal(lastArchive.status, 409, 'the last active project cannot be archived');

		const stream = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'stream.post', payload: { body: '先做第一件事' } }),
		});
		assert.equal(stream.status, 200);
		await new Promise((resolve) => setTimeout(resolve, 40));
		const afterStream = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(afterStream.stream.at(-1).body, '先做第一件事');
		assert.equal(afterStream.agents.find((agent) => agent.id === 'mem_lead').sessionId !== null, true);

		const models = await fetch(`${base}/ai-team/api/models`);
		assert.equal(models.status, 200);
		const modelBody = await models.json();
		assert.equal(modelBody.ok, true);
		assert.deepEqual(modelBody.defaultModel, { provider: 'p1', model: 'm1' });
		assert.deepEqual(modelBody.providers.map((provider) => provider.id), ['p1', 'p2']);
		assert.deepEqual(modelBody.providers[0].models.map((model) => model.id), ['m1']);

		const create = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'task.create',
				payload: { title: '第一条真实任务', resultDefinition: '验收通过', ownerId: 'mem_human' },
			}),
		});
		assert.equal(create.status, 200);
		const created = await create.json();
		assert.equal(created.task.title, '第一条真实任务');
		assert.equal(created.task.status, 'pending');

		const after = await fetch(`${base}/ai-team/api/bootstrap`);
		const afterBody = await after.json();
		assert.equal(afterBody.tasks.length, 1);
		assert.equal(afterBody.tasks[0].title, '第一条真实任务');
		assert.equal(afterBody.runtime.defaultModel.provider, 'p1');
		assert.deepEqual(afterBody.runtime.providers, ['local']);

		const addMember = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'member.add',
				payload: { id: 'a1', name: '临时成员', kind: 'agent', status: 'provisioning' },
			}),
		});
		assert.equal(addMember.status, 200);
		const activate = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'member.activate', payload: { memberId: 'a1' } }),
		});
		assert.equal(activate.status, 200, await activate.clone().text());
		const activated = await activate.json();
		assert.equal(activated.member.status, 'running');
		const memberSessionId = activated.member.sessionId;
		assert.equal(typeof memberSessionId, 'string');
		assert.equal(workspaceAttachments.includes(memberSessionId), true);
		assert.equal(memberSessions.get(memberSessionId).sandbox, 'danger-full-access');
		assert.ok(toolRegistration !== null);
		// team 的可见性不再按「请求者是不是已知成员」判定：成员的首个 model step 发生在
		// bindMemberSession 写入 sessionId 之前，按请求者判定会把 team 从首回合滤掉。
		// 现在只要 AI Team runtime 已 boot，工具即对 agent 可见；非成员调用由工具本身
		// 以 E_NOT_MEMBER 拒绝（见下方 toolTasksOld 断言）。
		assert.equal(toolRegistration.options.when({ agent: { id: memberSessionId } }), true);
		assert.equal(toolRegistration.options.when({ agent: { id: 'other' } }), true);

		// 会话重建（reseat）：force 重建同一成员 → 旧句柄被 dispose、绑定切换到新会话。
		const reseat = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'member.activate', payload: { memberId: 'a1', force: true } }),
		});
		assert.equal(reseat.status, 200, await reseat.clone().text());
		const reseated = await reseat.json();
		assert.equal(reseated.member.status, 'running');
		assert.notEqual(reseated.member.sessionId, memberSessionId, 'reseat binds a NEW session');
		assert.ok(disposedHandles.includes(memberSessionId), 'old activation handle disposed before rebuild');

		// reseat 后成员绑定的是新会话：工具可见性随新会话走。
		const toolTasks = await toolRegistration.definition.execute({ action: 'tasks' }, { agent: { id: reseated.member.sessionId } });
		assert.equal(toolTasks.ok, true);
		const toolTasksOld = await toolRegistration.definition.execute({ action: 'tasks' }, { agent: { id: memberSessionId } });
		assert.equal(toolTasksOld.ok, false, 'old session is no longer a team member');
		// reseat 之后的下游断言一律使用新会话 id。
		const reseatedSessionId = reseated.member.sessionId;

		const agentTask = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'task.create',
				payload: { title: 'Agent 的任务', resultDefinition: 'agent 完成', ownerId: 'a1' },
			}),
		});
		assert.equal(agentTask.status, 200);
		const agentTaskBody = await agentTask.json();
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(wakeCalls.length, 1);
		assert.equal(wakeCalls[0].targetId, reseatedSessionId);
		assert.match(wakeCalls[0].content[0].text, new RegExp(agentTaskBody.task.id));

		assert.equal(requestErrorListeners.length, 1);
		let nextCalls = 0;
		// Corrected semantics (review M5.1): a rate limit with no fallback route
		// ends the turn instead of hammering the same throttled route with
		// immediate retries. The failure is still recorded for the wake planner.
		const retry = await requestErrorListeners[0](
			{ agent: { id: reseatedSessionId }, provider: 'p1', failure: { status: 429, code: 'RATE_LIMIT', message: 'rate limit' } },
			async () => { nextCalls += 1; return undefined; },
		);
		assert.equal(retry, undefined);
		assert.equal(nextCalls, 1);
		const afterRate = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(afterRate.agents.find((agent) => agent.name === '临时成员').lastFailure.category, 'rate_limit');
		assert.equal(afterRate.agents.find((agent) => agent.name === '临时成员').attempts, 1);

		assert.equal(sessionEventListeners.length, 1);
		await sessionEventListeners[0](
			{ id: reseatedSessionId },
			{ type: 'turn/end', data: { reason: { kind: 'completed' } } },
		);
		const afterRecovery = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(afterRecovery.agents.find((agent) => agent.name === '临时成员').attempts, 0);
		assert.equal(afterRecovery.agents.find((agent) => agent.name === '临时成员').status, 'running');
		assert.ok(afterRecovery.agents.find((agent) => agent.name === '临时成员').lastRecoveredAt !== undefined);

		const terminal = await requestErrorListeners[0](
			{ agent: { id: reseatedSessionId }, provider: 'p1', failure: { status: 401, code: 'INVALID_API_KEY', message: 'bad key' } },
			async () => { nextCalls += 1; return undefined; },
		);
		assert.equal(terminal, undefined);
		// nextCalls now counts the rate-limit turn above plus this auth failure.
		assert.equal(nextCalls, 2);
		const afterAuth = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(afterAuth.agents.find((agent) => agent.name === '临时成员').status, 'failed');
		assert.equal(afterAuth.agents.find((agent) => agent.name === '临时成员').lastFailure.category, 'auth');

		const board = await fetch(`${base}/ai-team/api/projects/prj_main/board`);
		assert.equal(board.status, 200);
		const boardBody = await board.json();
		assert.equal(boardBody.counts.todo, 2);
		assert.equal(boardBody.counts.in_progress, 0);
		assert.equal(boardBody.columns.todo[0].title, '第一条真实任务');

		const quadrants = await fetch(`${base}/ai-team/api/projects/prj_main/quadrants`);
		assert.equal(quadrants.status, 200);
		const quadrantBody = await quadrants.json();
		assert.equal(quadrantBody.q1.count, 1);
		assert.equal(quadrantBody.q2.count, 0);
		assert.equal(quadrantBody.q3.count, 0);
		assert.equal(quadrantBody.q4.count, 0);

		const controller = new AbortController();
		const events = await fetch(`${base}/ai-team/api/projects/prj_main/events`, { signal: controller.signal });
		assert.equal(events.status, 200);
		assert.match(events.headers.get('content-type') ?? '', /text\/event-stream/);
		const reader = events.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		const nextFrame = async () => {
			while (!buffer.includes('\n\n')) {
				const chunk = await reader.read();
				if (chunk.done) throw new Error('SSE stream closed');
				buffer += decoder.decode(chunk.value, { stream: true });
			}
			const end = buffer.indexOf('\n\n');
			const frame = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			const data = frame.split('\n').find((line) => line.startsWith('data: '));
			return JSON.parse(data.slice(6));
		};
		const initial = await nextFrame();
		assert.equal(initial.type, 'ready');
		assert.equal(initial.board.counts.todo, 2);

		const createSecond = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'task.create',
				payload: { title: 'SSE 第二条', resultDefinition: '收到 change', ownerId: 'mem_human' },
			}),
		});
		assert.equal(createSecond.status, 200);
		const changed = await nextFrame();
		assert.equal(changed.type, 'change');
		assert.equal(changed.board.counts.todo, 3);
		assert.equal(changed.quadrants.rev, changed.rev);
		controller.abort();

		// project.create 现在要求工作目录真实存在（与 project.workspace.update 一致）。
		const secondWorkspace = join(root, 'p2-workspace');
		await mkdir(secondWorkspace, { recursive: true });
		const projectCreate = await fetch(`${base}/ai-team/api/projects/prj_main/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'project.create', payload: { name: '并发 P2', goal: '并发运行', workspacePath: secondWorkspace } }),
		});
		assert.equal(projectCreate.status, 200);
		const secondProject = (await projectCreate.json()).project.id;
		const healthWithTwo = await (await fetch(`${base}/ai-team/api/health`)).json();
		assert.equal(healthWithTwo.projects.length, 2);
		assert.equal(healthWithTwo.projects.filter((project) => project.active).length, 1);

		const secondTask = await fetch(`${base}/ai-team/api/projects/${secondProject}/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'task.create', payload: { title: 'P2 任务', resultDefinition: 'done', ownerId: 'mem_human' } }),
		});
		assert.equal(secondTask.status, 200);
		const p1Board = await (await fetch(`${base}/ai-team/api/projects/prj_main/board`)).json();
		const p2Board = await (await fetch(`${base}/ai-team/api/projects/${secondProject}/board`)).json();
		assert.equal(p1Board.counts.todo, 3);
		assert.equal(p2Board.counts.todo, 1);

		const activateP1 = await fetch(`${base}/ai-team/api/projects/${secondProject}/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'project.activate', payload: { projectId: 'prj_main' } }),
		});
		assert.equal(activateP1.status, 200);
		const healthAfterSwitch = await (await fetch(`${base}/ai-team/api/health`)).json();
		assert.equal(healthAfterSwitch.activeProjectId, 'prj_main');
		assert.equal(healthAfterSwitch.projects.length, 2);

		const missing = await fetch(`${base}/ai-team/api/nope`);
		assert.equal(missing.status, 404);
	} finally {
		if (server !== null) {
			server.closeAllConnections?.();
			await new Promise((resolve) => server.close(resolve));
		}
		if (disposeEffect !== null) disposeEffect();
		if (previousHome === undefined) delete process.env.DSH_HOME;
		else process.env.DSH_HOME = previousHome;
		if (previousProfile === undefined) delete process.env.DSH_PROFILE;
		else process.env.DSH_PROFILE = previousProfile;
		await rm(root, { recursive: true, force: true });
	}
});
