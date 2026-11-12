/**
 * Management-flow tests (docs/11): a project can be created with NO workspace
 * (lightweight entry), member activation on it fails closed with
 * E_WORKSPACE_REQUIRED, and the global people pool aggregates members across
 * projects by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { apply, name as pluginName, inject } from '../index.js';

test('workspace-less projects, activation gate and the global people pool', async (t) => {
	const routes = [];
	const root = await mkdtemp(join(tmpdir(), 'ai-team-mgmt-'));
	const previousHome = process.env.DSH_HOME;
	const previousProfile = process.env.DSH_PROFILE;
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'mgmt';
	// 插件的运行时错误走 console.error：断言看不见它们，但它们是真实故障
	// （0.4.52 的 `reconciled is not defined` 就是这样溜过去的）。整段流程结束后
	// 必须一条都没有。
	const consoleErrors = [];
	const realConsoleError = console.error;
	const realConsoleWarn = console.warn;
	const capture = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
	console.error = capture;
	console.warn = capture;
	t.after(() => {
		console.error = realConsoleError;
		console.warn = realConsoleWarn;
	});
	let disposeEffect = null;
	const ctx = {
		effect(fn) {
			disposeEffect = fn();
		},
		on() {
			return () => {};
		},
		get(id) {
			if (id === 'webServer') {
				return { register(route) { routes.push(route); return () => {}; } };
			}
			if (id === 'permissionPresets') {
				return {
					catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }),
					resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
					set: () => {},
				};
			}
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
	let server = null;
	try {
		apply(ctx);
		assert.equal(pluginName, 'ai-team');
		assert.deepEqual(inject, ['webServer', 'permissionPresets', 'sandboxPolicy', 'tools', 'shell', 'agents', 'subagents', 'sessions'], 'inject declares every service the plugin touches (cordis proxies need it)');
		const route = routes[0];
		server = createServer((req, res) => route.handler(req, res));
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${server.address().port}`;
		const post = async (path, body) => {
			const response = await fetch(base + path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			return { status: response.status, body: await response.json().catch(() => null) };
		};

		// 显式请求不存在的项目必须 404：否则删掉项目后旧链接会静默显示另一个项目。
		const missing = await fetch(`${base}/ai-team/api/bootstrap?project=prj_does_not_exist`);
		assert.equal(missing.status, 404);
		const missingBody = await missing.json().catch(() => null);
		assert.equal(missingBody?.error?.code, 'NOT_FOUND');
		// 新建项目必须指定一个真实存在的目录（服务端强制）。
		const workspaceDir = await mkdtemp(join(tmpdir(), 'ai-team-mgmt-ws-'));

		// 首次安装：默认项目**不带**工作目录，界面进入「必须先设目录」状态；
		// 宿主只给一个建议值（配置 → 宿主 cwd → 主目录），不替用户落盘。
		const before = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.ok(before.project, 'bootstrap must return a project: ' + JSON.stringify(before).slice(0, 400));
		assert.equal(before.project.workspacePath ?? '', '', 'a fresh project must start without a workspace');
		assert.equal(before.setupRequired, true);
		assert.equal(typeof before.defaultWorkspace, 'string');
		const discussion = await post('/ai-team/api/projects/prj_main/commands', { type: 'stream.post', payload: { body: '还没目录也能聊' } });
		assert.equal(discussion.status, 200);
		const blocked = await post('/ai-team/api/projects/prj_main/commands', { type: 'member.activate', payload: { memberId: 'mem_lead' } });
		assert.equal(blocked.status, 409);
		assert.equal(blocked.body.error.code, 'E_WORKSPACE_REQUIRED');

		// 用户设定目录后，首次使用状态必须解除（否则界面会一直卡在引导页）。
		const setWorkspace = await post('/ai-team/api/projects/prj_main/commands', {
			type: 'project.workspace.update',
			payload: { workspacePath: workspaceDir },
		});
		assert.equal(setWorkspace.status, 200, JSON.stringify(setWorkspace.body));
		const afterSetup = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(afterSetup.project.workspacePath, workspaceDir);
		assert.equal(afterSetup.setupRequired, false, 'setup must clear once a workspace exists');

		// 新建项目必须指定工作目录（不能建出用不了的项目）。
		const noWorkspace = await post('/ai-team/api/projects/prj_main/commands', {
			type: 'project.create',
			payload: { name: '无目录项目', goal: '应当被拒' },
		});
		assert.equal(noWorkspace.status, 400, JSON.stringify(noWorkspace.body));
		const withWorkspace = await post('/ai-team/api/projects/prj_main/commands', {
			type: 'project.create',
			payload: { name: '有目录项目', goal: 'ok', workspacePath: workspaceDir },
		});
		assert.equal(withWorkspace.status, 200, JSON.stringify(withWorkspace.body));
		assert.equal(withWorkspace.body.project.workspacePath, workspaceDir);

		// 人员池：同名成员跨项目聚合成一行。
		const people = await (await fetch(`${base}/ai-team/api/people`)).json();
		assert.equal(people.ok, true);
		assert.ok(Array.isArray(people.people) && people.people.length > 0);
		const lead = people.people.find((person) => person.name === '墨渊');
		assert.ok(lead, 'default Lead appears in the pool');
		assert.deepEqual(lead.projects.map((row) => row.projectId).sort(), ['prj_main'].concat([withWorkspace.body.project.id]).sort());
		assert.ok(lead.projects.every((row) => row.activeTasks === 0));

		// 打开新项目后成员名册照常播种（各自项目各自会话的数据基础）。
		const activate = await post('/ai-team/api/projects/prj_main/commands', {
			type: 'project.activate',
			payload: { projectId: withWorkspace.body.project.id },
		});
		assert.equal(activate.status, 200);
		const bootLite = await (await fetch(`${base}/ai-team/api/bootstrap?project=${withWorkspace.body.project.id}`)).json();
		assert.equal(bootLite.project.name, '有目录项目');
		assert.equal(bootLite.agents.length > 0, true, 'default roster seeded for the new project');
		// 正常流程里不允许出现插件级的运行时错误。
		const runtimeErrors = consoleErrors.filter((line) => /\[ai-team\].*(failed|error)/i.test(line));
		assert.deepEqual(runtimeErrors, [], 'plugin must not log runtime errors during a healthy flow');
	} finally {
		server?.close();
		try { disposeEffect?.(); } catch { /* already disposed */ }
		process.env.DSH_HOME = previousHome;
		process.env.DSH_PROFILE = previousProfile;
		await rm(root, { recursive: true, force: true });
	}
});
