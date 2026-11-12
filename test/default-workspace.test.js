import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

test('the whole ~/.dsh tree is excluded (the desktop cwd is the profile dir)', (t) => {
	// 实机事故：桌面启动器的 cwd 是 `…\.dsh\profiles\desktop`，它不等于插件数据
	// 目录（`…\.dsh\ai-team\desktop`），于是被当成「建议工作目录」——把 profile
	// 目录当项目工作区是错的。excludeRoots 要覆盖整个 `~/.dsh`。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws3-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dshHome = join(root, 'dsh');
	const profile = join(dshHome, 'profiles', 'desktop');
	const dataDir = join(dshHome, 'ai-team', 'desktop');
	const outside = join(root, 'outside');
	for (const dir of [profile, dataDir, outside]) mkdirSync(dir, { recursive: true });

	assert.equal(
		resolveDefaultWorkspace({ cwd: profile, home: outside, dataDir, excludeRoots: [dshHome] }),
		outside,
		'the profile dir must be skipped, home still works',
	);
	assert.equal(
		resolveDefaultWorkspace({ cwd: dataDir, home: profile, dataDir, excludeRoots: [dshHome] }),
		'',
		'nothing usable inside ~/.dsh may be suggested',
	);
	// 显式配置也受限（结构上错误的位置），但拒绝后会继续尝试后面的候选。
	assert.equal(
		resolveDefaultWorkspace({ configured: profile, cwd: outside, home: outside, dataDir, excludeRoots: [dshHome] }),
		outside,
		'an explicit path inside ~/.dsh is refused and the next candidate wins',
	);
});
