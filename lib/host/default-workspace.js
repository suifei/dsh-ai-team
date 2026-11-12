/**
 * 初装默认项目 / 新建项目对话框的「默认工作目录」解析。
 *
 * 规则（用户裁定）：
 * 1. 只有**没有指定**项目工作目录时才用默认目录；
 * 2. 项目一旦切换过工作目录，就按项目自己的目录执行（本模块只负责默认值）；
 * 3. 默认值不能是插件自己的数据目录，否则成员会退化成「在账本目录里干活」；
 * 4. 系统目录（Windows / Program Files）不当作团队工作目录——桌面启动器的
 *    cwd 可能就是程序目录。
 */

import { statSync } from 'node:fs';
import { sep } from 'node:path';

const SYSTEM_DIR = /^[a-z]:[\\/](windows|program files|program files \(x86\))([\\/]|$)/i;

const isDirectory = (value) => {
	try { return statSync(value).isDirectory() === true; } catch { return false; }
};

/**
 * @param {{ configured?: string, cwd?: string, home?: string, dataDir?: string }} input
 * @returns {string} 绝对目录，找不到任何可用目录时返回空串
 */
export function resolveDefaultWorkspace({ configured = '', cwd = '', home = '', dataDir = '', excludeRoots = [] } = {}) {
	const explicit = typeof configured === 'string' ? configured.trim() : '';
	const under = (value, root) => {
		if (typeof root !== 'string' || root === '') return false;
		const resolvedRoot = root.replace(/[\\/]+$/, '');
		return value === resolvedRoot || value.startsWith(`${resolvedRoot}${sep}`) || value.startsWith(`${resolvedRoot}/`);
	};
	const excluded = (value) => {
		// 插件数据目录永远不能当工作目录。
		if (under(value, dataDir)) return true;
		// `~/.dsh` 整棵树都不能当工作目录：桌面启动器的 cwd 就是 profile 目录
		// （`…\.dsh\profiles\desktop`），把它当项目工作区是错的。
		for (const root of excludeRoots) if (under(value, root)) return true;
		return false;
	};
	for (const raw of [explicit, cwd, home]) {
		if (typeof raw !== 'string' || raw === '') continue;
		if (!isDirectory(raw)) continue;
		if (excluded(raw)) continue;
		// 显式配置的目录由用户负责；自动探测到的系统目录一律跳过。
		if (raw !== explicit && SYSTEM_DIR.test(raw)) continue;
		return raw;
	}
	return '';
}
