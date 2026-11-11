/**
 * 提案落盘的共用原语：内容指纹、live 文件备份、原子替换。
 *
 * 三者必须一起用：先按 sha 判断 live 是否仍是评审时的基线（并发冲突），再备份，
 * 最后用 tmp + rename 原子替换。缺任一步都会出现「评审期间的人工修改被静默覆盖」
 * 或「写到一半崩溃留下半截 SKILL.md」。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 12 位内容指纹：足够区分提案版本，又能塞进 results.tsv 的一列。 */
export function sha12(text) {
	return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 12);
}

/** 备份 live 文本到 `.skillopt-sleep/backups/`，返回备份路径。 */
export function backupLive({ projectDir, skillPath, text, now = Date.now() }) {
	const dir = join(projectDir, '.skillopt-sleep', 'backups');
	mkdirSync(dir, { recursive: true });
	const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
	const name = String(skillPath).split(/[\\/]/).pop() ?? 'SKILL.md';
	const target = join(dir, `${name}.${stamp}.bak`);
	writeFileSync(target, String(text ?? ''), 'utf8');
	return target;
}

/** 同目录 tmp + rename，避免半截写入。 */
export function applyLiveAtomically(path, text) {
	const tmp = `${path}.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}`;
	writeFileSync(tmp, String(text ?? ''), 'utf8');
	renameSync(tmp, path);
}
