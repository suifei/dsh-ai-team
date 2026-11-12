import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('setWorkspace updates the index once and is idempotent', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-reg-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const registry = ProjectRegistry.load(root, { defaultWorkspacePath: '' });
	assert.equal(registry.list()[0].workspacePath ?? '', '');
	assert.equal(registry.setWorkspace('prj_main', root), true);
	assert.equal(registry.list()[0].workspacePath, root);
	// 同值不重复写盘
	assert.equal(registry.setWorkspace('prj_main', root), false);
	// 未知 id 不抛
	assert.equal(registry.setWorkspace('nope', root), false);
});

test('a deleted default project stays deleted as long as other projects exist', (t) => {
	// 实机事故：用户删掉 prj_main 后它被静默复活（load 只要发现缺少默认项目就 unshift）。
	// 默认项目只应在「一个项目都没有」时播种。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-reg-remove-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const file = join(root, 'projects.json');
	writeFileSync(file, JSON.stringify({
		projects: [{ id: 'prj_keep', name: '保留项目' }],
		activeProjectId: 'prj_keep',
	}), 'utf8');

	const loaded = ProjectRegistry.load(root);
	assert.deepEqual(loaded.list().map((project) => project.id), ['prj_keep']);
	assert.equal(loaded.activeProjectId, 'prj_keep');

	// 一个项目都没有时才补默认项目（初装入口），并把它设为 active。
	writeFileSync(file, JSON.stringify({ projects: [], activeProjectId: null }), 'utf8');
	const empty = ProjectRegistry.load(root);
	assert.deepEqual(empty.list().map((project) => project.id), ['prj_main']);
	assert.equal(empty.activeProjectId, 'prj_main');
});
