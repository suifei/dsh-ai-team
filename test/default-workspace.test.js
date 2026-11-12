import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { resolveDefaultWorkspace, WORKSPACE_SUBDIR } from '../lib/host/default-workspace.js';

test('an explicitly configured directory wins', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(resolveDefaultWorkspace({ configured: root, cwd: tmpdir(), home: tmpdir() }), root);
});

test('the plugin data directory is never used as the default workspace', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws2-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dataDir = join(root, 'data');
	mkdirSync(dataDir);
	// cwd 就是数据目录 → 跳过，兜底到 home/works
	assert.equal(resolveDefaultWorkspace({ cwd: dataDir, home: root, dataDir }), join(root, WORKSPACE_SUBDIR));
});

test('automatically detected Windows system directories are skipped', () => {
	const out = resolveDefaultWorkspace({ cwd: 'C:\\Windows', home: 'C:\\Windows\\System32', dataDir: '' });
	// 系统目录不能当工作目录；兜底值仍是 home 下的子目录（这里 home 本身也是系统路径，
	// 但子目录并不命中 SYSTEM_DIR——它只否决「显式/探测到的 cwd」）。
	assert.equal(out, join('C:\\Windows\\System32', WORKSPACE_SUBDIR));
});

test('an empty result is returned when nothing usable exists', () => {
	assert.equal(resolveDefaultWorkspace({ configured: 'Z:\\nope\\definitely-missing', cwd: '', home: '' }), '');
});

test('the whole ~/.dsh tree is excluded (the desktop cwd is the profile dir)', (t) => {
	// 实机事故：桌面启动器的 cwd 是 `…\.dsh\profiles\desktop`，它不等于插件数据
	// 目录（`…\.dsh\ai-team\desktop`），于是被当成「建议工作目录」。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws3-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dshHomeDir = join(root, 'dsh');
	const profile = join(dshHomeDir, 'profiles', 'desktop');
	const dataDir = join(dshHomeDir, 'ai-team', 'desktop');
	const home = join(root, 'home');
	for (const dir of [profile, dataDir, home]) mkdirSync(dir, { recursive: true });

	assert.equal(
		resolveDefaultWorkspace({ cwd: profile, home, dataDir, excludeRoots: [dshHomeDir] }),
		join(home, WORKSPACE_SUBDIR),
		'the profile dir is skipped; the suggestion is home/works',
	);
	// 连建议值都落在被排除的树里（home 就是 ~/.dsh）时不再兜底。
	assert.equal(
		resolveDefaultWorkspace({ cwd: profile, home: dshHomeDir, dataDir, excludeRoots: [dshHomeDir] }),
		'',
		'nothing inside ~/.dsh may be suggested, not even home/works',
	);
});

test('the suggestion is always a subdirectory of home, never the home root', (t) => {	// 用户裁定：不能把主目录根本身当工作目录，必须是 `~/works`。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws4-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, 'SuiFei');
	mkdirSync(home);
	const out = resolveDefaultWorkspace({ cwd: '', home, dataDir: join(root, 'data') });
	assert.equal(out, join(home, WORKSPACE_SUBDIR));
	assert.notEqual(out, home);
	// 跨平台：分隔符跟随平台，不手写反斜杠。
	assert.equal(out, home + sep + WORKSPACE_SUBDIR);
});

test('a relocated DSH_HOME still cannot make the real profile dir a suggestion', (t) => {
	// 夹具/隔离实例会把 DSH_HOME 指到临时目录，此时 dshHome() 不再覆盖真实
	// `~/.dsh`。调用方因此同时排除两者——否则桌面 profile 目录又会被当成建议值。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws5-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	const realDsh = join(home, '.dsh');
	const relocated = join(root, 'dsh-isolated');
	const profile = join(realDsh, 'profiles', 'desktop');
	for (const dir of [profile, relocated]) mkdirSync(dir, { recursive: true });

	assert.equal(
		resolveDefaultWorkspace({ cwd: profile, home, dataDir: join(relocated, 'ai-team'), excludeRoots: [relocated, realDsh] }),
		join(home, WORKSPACE_SUBDIR),
	);
	// 只排除被搬迁的那个根时，真实 profile 目录仍会被选中——正是这条测试要防的。
	assert.equal(
		resolveDefaultWorkspace({ cwd: profile, home, dataDir: join(relocated, 'ai-team'), excludeRoots: [relocated] }),
		profile,
	);
});

test('a UNC cwd from the launcher is not suggested as the workspace', (t) => {
	// 实机：桌面端从 WSL 目录里启动，cwd 是 `\\wsl.localhost\Ubuntu-26.04\home\suifei`，
	// 被当成「建议工作目录」；它既不是项目目录，成员工具在 UNC 上读写也不稳。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ws-unc-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	mkdirSync(home, { recursive: true });
	const unc = '\\\\wsl.localhost\\Ubuntu-26.04\\home\\suifei';
	// exists 注入用来模拟「UNC 目录确实可访问」（沙箱里无法真的建 UNC）。
	assert.equal(
		resolveDefaultWorkspace({ cwd: unc, home, dataDir: join(root, 'd'), exists: () => true }),
		join(home, WORKSPACE_SUBDIR),
		'an existing UNC cwd is skipped in favour of ~/works',
	);
	// 显式配置不受 UNC 规则限制：用户自己指定就照用。
	assert.equal(
		resolveDefaultWorkspace({ configured: unc, cwd: home, home, dataDir: join(root, 'd'), exists: () => true }),
		unc,
	);
	// 普通 cwd 仍然优先于 ~/works。
	assert.equal(resolveDefaultWorkspace({ cwd: home, home, dataDir: join(root, 'd'), exists: () => true }), home);
});
