import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('host mounts the workbench routes and serves mock state', async () => {
	const routes = [];
	const ctx = {
		effect(fn) {
			fn();
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
	apply(ctx);
	assert.equal(name, 'ai-team');
	assert.deepEqual(inject, ['webServer']);
	assert.equal(routes.length, 1);
	const route = routes[0];
	assert.equal(route.kind, 'prefix');
	assert.equal(route.path, '/ai-team');

	const health = await route.resource(new Request('http://local/ai-team/api/health'));
	assert.equal(health.status, 200);
	assert.equal((await health.json()).ok, true);

	const boot = await route.resource(new Request('http://local/ai-team/api/bootstrap'));
	assert.equal(boot.status, 200);
	const data = await boot.json();
	assert.equal(data.tasks.length, 5);
	assert.equal(data.projects.length, 3);
	assert.equal(data.agents.length, 4);

	const missing = await route.resource(new Request('http://local/ai-team/api/nope'));
	assert.equal(missing.status, 404);
});
