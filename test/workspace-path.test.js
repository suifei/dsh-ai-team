import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkspacePath, hostPlatform, windowsToWsl, workspaceExample } from '../lib/host/workspace-path.js';

test('a Windows path is rejected on a POSIX host and translated for WSL', () => {
	// 实机事故：WSL 里填 `D:\works\localservice`，被当成「不存在」而不是「平台不匹配」。
	const wsl = checkWorkspacePath('D:\\works\\localservice', { platform: 'linux', wsl: true });
	assert.equal(wsl.ok, false);
	assert.equal(wsl.code, 'E_PLATFORM_PATH');
	assert.equal(wsl.suggestion, '/mnt/d/works/localservice');
	assert.match(wsl.message, /\/mnt\/d\/works\/localservice/);

	const posix = checkWorkspacePath('D:/works/localservice', { platform: 'linux', wsl: false });
	assert.equal(posix.ok, false);
	assert.equal(posix.suggestion, '/mnt/d/works/localservice');
	assert.match(posix.message, /Windows 路径/);
});

test('UNC paths cannot be used by a Linux host', () => {
	const result = checkWorkspacePath('\\\\wsl.localhost\\Ubuntu-26.04\\home\\suifei', { platform: 'linux', wsl: true });
	assert.equal(result.ok, false);
	assert.equal(result.code, 'E_PLATFORM_PATH');
	assert.match(result.message, /UNC/);
});

test('native paths pass on both families, and Windows rejects POSIX absolutes', () => {
	assert.deepEqual(checkWorkspacePath('/mnt/d/works/localservice', { platform: 'linux', wsl: true }), { ok: true });
	assert.deepEqual(checkWorkspacePath('/home/suifei/works', { platform: 'linux', wsl: false }), { ok: true });
	assert.deepEqual(checkWorkspacePath('D:/works/localservice', { platform: 'win32' }), { ok: true });
	// 反过来也拦：把 WSL 的 /mnt/… 粘到 Windows 上同样指错地方（Node 会解释成当前盘根）。
	const inverted = checkWorkspacePath('/mnt/d/works', { platform: 'win32' });
	assert.equal(inverted.ok, false);
	assert.match(inverted.message, /POSIX 路径/);

	// 空值单独报错，避免空串被当成合法路径。
	assert.equal(checkWorkspacePath('   ', { platform: 'linux', wsl: true }).code, 'E_EMPTY');
});

test('the dialog example follows the host platform', () => {
	assert.equal(workspaceExample('win32'), 'D:/works/my-project');
	assert.equal(workspaceExample('linux', { wsl: true }), '/mnt/d/works/my-project');
	assert.equal(workspaceExample('linux', { wsl: false }), '/home/user/works/my-project');
	assert.equal(hostPlatform('win32'), 'win32');
	assert.equal(hostPlatform('linux', true), 'wsl');
	assert.equal(hostPlatform('linux', false), 'posix');
	assert.equal(windowsToWsl('E:\\a\\b\\'), '/mnt/e/a/b');
	assert.equal(windowsToWsl('/already/posix'), null);
});
