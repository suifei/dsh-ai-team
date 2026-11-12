/**
 * 工作目录的**平台形态**校验。
 *
 * 实机事故：DSH web 在 WSL（Linux）里启动，用户在目录框里填了 `D:\works\localservice`
 * ——Windows 形态。POSIX 上这只是一串**带反斜杠的文件名**（相对路径），既不是那个盘，
 * 也不会给出有用的报错；成员会话随后在错误目录里干活。
 *
 * 这里只判断「路径形态与宿主平台是否匹配」，存在性仍由调用方的 statSync 负责。
 */

import { readFileSync } from 'node:fs';

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_BARE = /^[A-Za-z]:$/;
const UNC = /^\\\\[^\\]/;
const BACKSLASH = /\\/;

/** 把 `D:\works\a` 这类 Windows 路径转换成 WSL 的 `/mnt/d/works/a`。 */
export function windowsToWsl(raw) {
	const match = /^([A-Za-z]):[\\/]*(.*)$/.exec(String(raw ?? ''));
	if (match === null) return null;
	const drive = match[1].toLowerCase();
	const rest = match[2].replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
	return rest === '' ? `/mnt/${drive}` : `/mnt/${drive}/${rest}`;
}

/** 宿主是否运行在 WSL 里（`/proc/version` 含 microsoft）。读不到就按普通 Linux 处理。 */
export function isWsl() {
	if (process.platform !== 'linux') return false;
	try {
		return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
	} catch {
		return false;
	}
}

/** 'win32' | 'wsl' | 'posix' */
export function hostPlatform(platform = process.platform, wsl = undefined) {
	if (platform === 'win32') return 'win32';
	if (platform === 'linux' && (wsl ?? isWsl()) === true) return 'wsl';
	return 'posix';
}

/**
 * 校验路径形态是否与宿主平台兼容。
 * @returns {{ ok: true } | { ok: false, code: string, message: string, suggestion?: string }}
 */
export function checkWorkspacePath(raw, options = {}) {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (value === '') return { ok: false, code: 'E_EMPTY', message: '工作目录不能为空' };
	const platform = options.platform ?? process.platform;
	const host = hostPlatform(platform, options.wsl);
	if (host === 'win32') {
		// Windows 上 POSIX 绝对路径（`/mnt/d/x`）不是有效盘符路径；Node 会把它解释成
		// 当前盘根目录，容易落进意料之外的位置。直接给出明确提示。
		if (value.startsWith('/') && !WINDOWS_DRIVE.test(value)) {
			return {
				ok: false,
				code: 'E_PLATFORM_PATH',
				message: `工作目录「${value}」是 POSIX 路径，而当前宿主是 Windows；请改用盘符路径，例如 D:/works/my-project`,
			};
		}
		return { ok: true };
	}
	// POSIX（含 WSL）：Windows 形态一律拒绝，并给出可用的替代写法。
	if (UNC.test(value)) {
		return {
			ok: false,
			code: 'E_PLATFORM_PATH',
			message: `工作目录「${value}」是 Windows UNC 路径（\\\\wsl.localhost\\…），Linux 宿主无法使用；请改用挂载点路径，例如 /home/<user>/works`,
		};
	}
	if (WINDOWS_DRIVE.test(value) || WINDOWS_DRIVE_BARE.test(value) || (BACKSLASH.test(value) && !value.startsWith('/'))) {
		const suggestion = windowsToWsl(value);
		const hint = host === 'wsl' && suggestion !== null
			? `请改用 WSL 内的挂载路径：${suggestion}`
			: '请改用 POSIX 路径，例如 /home/<user>/works/my-project';
		return {
			ok: false,
			code: 'E_PLATFORM_PATH',
			message: `工作目录「${value}」是 Windows 路径，而当前宿主是 Linux；${hint}`,
			...(suggestion === null ? {} : { suggestion }),
		};
	}
	return { ok: true };
}

/** 目录输入框的示例路径（与宿主平台一致）。 */
export function workspaceExample(platform = process.platform, options = {}) {
	const host = hostPlatform(platform, options.wsl);
	if (host === 'win32') return 'D:/works/my-project';
	if (host === 'wsl') return '/mnt/d/works/my-project';
	return '/home/user/works/my-project';
}
