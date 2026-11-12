/**
 * Profile 命名空间解析与一次性的旧命名空间迁移。
 *
 * 背景：桌面启动器不导出 `DSH_PROFILE`，而是把 profile 目录作为**位置参数**传给
 * 宿主（`… <dsh-root> C:\Users\…\.dsh\profiles\desktop …`）。旧解析只认
 * `--profile <name>`，于是 desktop profile 的账本全部落进 `ai-team/default/`，
 * 两个 profile 共用一个命名空间。
 *
 * 但只修解析会把已经落在 `default/` 的数据留在原地（界面上团队凭空消失），
 * 因此配一条**数据驱动、一次性、可回退**的迁移规则：只有当旧命名空间的数据
 * 明显多于目标命名空间时才搬迁，并把目标原有内容改名保留，不删除任何东西。
 */

import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 从启动参数/env 解析 profile 名。 */
export function resolveProfileName(argv = process.argv, env = process.env) {
	const list = Array.isArray(argv) ? argv.map(String) : [];
	const flagAt = list.indexOf('--profile');
	if (flagAt >= 0 && typeof list[flagAt + 1] === 'string' && list[flagAt + 1] !== '') return list[flagAt + 1];
	const inline = list.find((arg) => arg.startsWith('--profile='));
	if (inline !== undefined) {
		const value = inline.slice('--profile='.length);
		if (value !== '') return value;
	}
	// 位置参数形态：…/profiles/<name>（Windows 反斜杠与 POSIX 斜杠都要认）。
	for (const arg of list) {
		const match = /[\\/]profiles[\\/]([^\\/]+)[\\/]?$/.exec(arg);
		if (match !== null) return match[1];
	}
	return env?.DSH_PROFILE || 'default';
}

/** 目录下所有文件的总字节数；目录不存在按 0 计。 */
export function dirBytes(dir) {
	if (!existsSync(dir)) return 0;
	let total = 0;
	const walk = (current) => {
		let entries = [];
		try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			try { total += statSync(full).size; } catch { /* vanished */ }
		}
	};
	walk(dir);
	return total;
}

/**
 * 旧命名空间有明显更多数据时搬迁到目标命名空间。
 * @returns {'migrated'|'kept'|'none'} migrated=已搬迁，kept=目标更新/一样大，none=没有旧数据
 */
export function migrateLegacyNamespace({ fromDir, toDir, diag = null, now = Date.now }) {
	if (fromDir === toDir) return 'none';
	if (!existsSync(join(fromDir, 'projects.json'))) return 'none';
	const legacyBytes = dirBytes(fromDir);
	const targetBytes = dirBytes(toDir);
	if (legacyBytes <= targetBytes) return 'kept';
	try {
		if (existsSync(toDir)) {
			// 目标原有内容改名保留（不删除），便于回退与人工核对。
			renameSync(toDir, `${toDir}.superseded-${now()}`);
		}
		renameSync(fromDir, toDir);
		diag?.append?.({ ev: 'ledger.namespace.migrated', from: fromDir, to: toDir, legacyBytes, targetBytes });
		return 'migrated';
	} catch (error) {
		diag?.append?.({ ev: 'ledger.namespace.migrate.fail', from: fromDir, to: toDir, message: error?.message ?? String(error) });
		return 'kept';
	}
}
