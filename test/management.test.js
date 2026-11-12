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

test('workspace-less projects, activation gate and the global people pool', async () => {
	const routes = [];
	const root = await mkdtemp(join(tmpdir(), 'ai-team-mgmt-'));
	const previousHome = process.env.DSH_HOME;
	const previousProfile = process.env.DSH_PROFILE;
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'mgmt';
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
	} finally {
		server?.close();
		try { disposeEffect?.(); } catch { /* already disposed */ }
		process.env.DSH_HOME = previousHome;
		process.env.DSH_PROFILE = previousProfile;
		await rm(root, { recursive: true, force: true });
	}
});
