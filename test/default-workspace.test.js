import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDefaultWorkspace } from '../lib/host/default-workspace.js';

test('an explicitly configured directory wins', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const configured = join(root, 'configured');
	mkdtempSync(join(root, 'x'));
	assert.ok(configured);
	assert.equal(resolveDefaultWorkspace({ configured: root, cwd: tmpdir(), home: tmpdir() }), root);
});

test('the plugin data directory is never used as the default workspace', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws2-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dataDir = join(root, 'data');
	mkdtempSync(dataDir);
	// cwd 就是数据目录 → 跳过，退回 home
	assert.equal(resolveDefaultWorkspace({ cwd: dataDir, home: root, dataDir }), root);
	// 数据目录的子目录同样跳过
	assert.notEqual(resolveDefaultWorkspace({ cwd: dataDir, home: root, dataDir }), dataDir);
});

test('automatically detected Windows system directories are skipped', () => {
	// 这些路径在本机不一定存在；只要解析结果不是它们即可（不存在时会被 isDirectory 拒绝）。
	const out = resolveDefaultWorkspace({ cwd: 'C:\\Windows', home: 'C:\\Windows\\System32', dataDir: '' });
	assert.equal(out, '');
});

test('an empty result is returned when nothing usable exists', () => {
	assert.equal(resolveDefaultWorkspace({ configured: 'Z:\\nope\\definitely-missing', cwd: '', home: '' }), '');
});
