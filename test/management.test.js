/**
 * Management-flow tests (docs/11): a project can be created with NO workspace
 * (lightweight entry), member activation on it fails closed with
 * E_WORKSPACE_REQUIRED, and the global people pool aggregates members across
 * projects by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

		// 默认项目无目录：讨论允许（stream.post），但激活 fail-closed。
		const before = await (await fetch(`${base}/ai-team/api/bootstrap`)).json();
		assert.equal(before.project.workspacePath ?? '', '');
		const discussion = await post('/ai-team/api/projects/prj_main/commands', { type: 'stream.post', payload: { body: '还没目录也能聊' } });
		assert.equal(discussion.status, 200);
		const blocked = await post('/ai-team/api/projects/prj_main/commands', { type: 'member.activate', payload: { memberId: 'mem_lead' } });
		assert.equal(blocked.status, 409);
		assert.equal(blocked.body.error.code, 'E_WORKSPACE_REQUIRED');

		// 空目录项目可创建（轻入口）。
		const created = await post('/ai-team/api/projects/prj_main/commands', {
			type: 'project.create',
			payload: { name: '轻项目', goal: '稍后设目录' },
		});
		assert.equal(created.status, 200, JSON.stringify(created.body));
		assert.equal((created.body.project.workspacePath ?? ''), '');

		// 人员池：同名成员跨项目聚合成一行。
		const people = await (await fetch(`${base}/ai-team/api/people`)).json();
		assert.equal(people.ok, true);
		assert.ok(Array.isArray(people.people) && people.people.length > 0);
		const lead = people.people.find((person) => person.name === '墨渊');
		assert.ok(lead, 'default Lead appears in the pool');
		assert.deepEqual(lead.projects.map((row) => row.projectId).sort(), ['prj_main'].concat([created.body.project.id]).sort());
		assert.ok(lead.projects.every((row) => row.activeTasks === 0));

		// 打开轻项目后成员名册照常播种（各自项目各自会话的数据基础）。
		const activate = await post('/ai-team/api/projects/prj_main/commands', {
			type: 'project.activate',
			payload: { projectId: created.body.project.id },
		});
		assert.equal(activate.status, 200);
		const bootLite = await (await fetch(`${base}/ai-team/api/bootstrap?project=${created.body.project.id}`)).json();
		assert.equal(bootLite.project.name, '轻项目');
		assert.equal(bootLite.agents.length > 0, true, 'default roster seeded for the new project');
	} finally {
		server?.close();
		try { disposeEffect?.(); } catch { /* already disposed */ }
		process.env.DSH_HOME = previousHome;
		process.env.DSH_PROFILE = previousProfile;
		await rm(root, { recursive: true, force: true });
	}
});
