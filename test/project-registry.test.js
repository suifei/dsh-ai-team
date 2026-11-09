import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '../lib/host/project-registry.js';

test('ProjectRegistry persists projects and the active project atomically', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-registry-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const registry = ProjectRegistry.load(root);
	assert.equal(registry.activeProjectId, 'prj_main');
	assert.equal(registry.list().length, 1);
	registry.add({ id: 'prj_ui', name: 'UI' });
	registry.setActive('prj_ui');
	const reopened = ProjectRegistry.load(root);
	assert.equal(reopened.activeProjectId, 'prj_ui');
	assert.deepEqual(reopened.list().map((project) => project.name), ['我的项目', 'UI']);
	const onDisk = JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8'));
	assert.equal(onDisk.activeProjectId, 'prj_ui');
	assert.throws(() => registry.setActive('missing'), /unknown project/);
});
