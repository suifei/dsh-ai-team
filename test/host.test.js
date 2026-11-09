import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
	const icon = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
	assert.match(icon, /<svg\b/);
});

test('host mounts the workbench routes on a real default-project ledger', async () => {
	const routes = [];
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
		get(id) {
			assert.equal(id, 'webServer');
			return {
				register(route) {
					routes.push(route);
					return () => {};
				},
			};
		},
	};
	let server = null;
	try {
		apply(ctx);
		assert.equal(name, 'ai-team');
		assert.deepEqual(inject, ['webServer']);
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
		assert.equal(data.agents.length, 0);
		assert.equal(data.members.length, 1);

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

		const missing = await fetch(`${base}/ai-team/api/nope`);
		assert.equal(missing.status, 404);
	} finally {
		if (server !== null) await new Promise((resolve) => server.close(resolve));
		if (disposeEffect !== null) disposeEffect();
		if (previousHome === undefined) delete process.env.DSH_HOME;
		else process.env.DSH_HOME = previousHome;
		if (previousProfile === undefined) delete process.env.DSH_PROFILE;
		else process.env.DSH_PROFILE = previousProfile;
		await rm(root, { recursive: true, force: true });
	}
});
