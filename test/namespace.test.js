import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirBytes, migrateLegacyNamespace, resolveProfile, resolveProfileName } from '../lib/ledger/namespace.js';

test('profile name is read from every shape the launchers use', () => {
	assert.equal(resolveProfileName(['node', 'dsh', '--profile', 'ai-team'], {}), 'ai-team');
	assert.equal(resolveProfileName(['node', 'dsh', '--profile=web'], {}), 'web');
	// 桌面启动器：profile 目录按位置参数传入
	assert.equal(resolveProfileName(['node', 'app.asar/dsh', 'C:/Users/x/.dsh/profiles/desktop', 'runtime'], {}), 'desktop');
	assert.equal(resolveProfileName(['node', 'app.asar\\dsh', 'C:\\Users\\x\\.dsh\\profiles\\desktop'], {}), 'desktop');
	assert.equal(resolveProfileName(['node'], { DSH_PROFILE: 'ai-team' }), 'ai-team');
	assert.equal(resolveProfileName(['node'], {}), 'default');
});

function makeDir(root, name, files) {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [file, body] of Object.entries(files)) {
		const full = join(dir, file);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, body, 'utf8');
	}
	return dir;
}

test('a legacy namespace with more data is migrated and the old target is preserved', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ns-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const legacy = makeDir(root, 'default', { 'projects.json': '{"projects":[]}', 'projects/p1/ledger-000001.jsonl': 'x'.repeat(500) });
	const target = makeDir(root, 'desktop', { 'projects.json': '{"projects":[]}' });
	const rows = [];
	const diag = { append: (row) => rows.push(row) };
	assert.ok(dirBytes(legacy) > dirBytes(target));
	assert.equal(migrateLegacyNamespace({ fromDir: legacy, toDir: target, diag }), 'migrated');
	assert.equal(existsSync(legacy), false, 'legacy dir moved away');
	assert.ok(readFileSync(join(target, 'projects/p1/ledger-000001.jsonl'), 'utf8').length === 500);
	// 目标原有内容改名保留，不删除
	const preserved = readdirPreserved(root);
	assert.equal(preserved.length, 1);
	assert.equal(rows[0].ev, 'ledger.namespace.migrated');
});

test('a target that already holds more data is kept as-is', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ns2-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const legacy = makeDir(root, 'default', { 'projects.json': '{}' });
	const target = makeDir(root, 'desktop', { 'projects.json': '{}', 'projects/p9/ledger-000001.jsonl': 'y'.repeat(900) });
	assert.equal(migrateLegacyNamespace({ fromDir: legacy, toDir: target }), 'kept');
	assert.equal(existsSync(join(target, 'projects/p9/ledger-000001.jsonl')), true);
});

test('nothing happens when there is no legacy namespace at all', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ns3-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(migrateLegacyNamespace({ fromDir: join(root, 'default'), toDir: join(root, 'desktop') }), 'none');
});

function readdirPreserved(root) {
	return readdirSync(root).filter((name) => name.startsWith('desktop.superseded-'));
}

test('only a positional profile path may trigger the legacy migration', () => {
	assert.deepEqual(resolveProfile(['node', 'x', '--profile', 'ai-team'], {}), { name: 'ai-team', source: 'flag' });
	assert.deepEqual(resolveProfile(['node', 'C:/x/.dsh/profiles/desktop'], {}), { name: 'desktop', source: 'argv-path' });
	assert.deepEqual(resolveProfile(['node'], { DSH_PROFILE: 'web' }), { name: 'web', source: 'env' });
	assert.deepEqual(resolveProfile(['node'], {}), { name: 'default', source: 'default' });
});

test('a failed migration restores the target instead of leaving it renamed away', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ns5-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const legacy = makeDir(root, 'default', { 'projects.json': '{"projects":[]}', 'projects/p1/l': 'z'.repeat(400) });
	const target = makeDir(root, 'desktop', { 'projects.json': '{"projects":[]}', 'keep.txt': 'keep' });
	// 让第二步 rename（源 → 目标）失败
	const outcome = migrateLegacyNamespace({
		fromDir: legacy,
		toDir: target,
		rename: (from, to) => {
			if (String(from) === String(legacy)) { const error = new Error('EBUSY'); error.code = 'EBUSY'; throw error; }
			return renameSync(from, to);
		},
	});
	assert.equal(outcome, 'kept');
	// 目标必须还原（否则下一次 boot 会拿空目录重建 registry）
	assert.equal(existsSync(join(target, 'keep.txt')), true);
	assert.equal(existsSync(legacy), true);
});

test('a launcher that only passes dsh-root still resolves the single installed profile', async (t) => {
	// 实机事故：某些启动器只传 dsh-root，argv 里没有 profiles/<name>，于是账本写进
	// `ai-team/default/`（那台机器的诊断目录就是 ai-team/default）。
	const root = mkdtempSync(join(tmpdir(), 'aiteam-ns-single-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'profiles', 'desktop'), { recursive: true });
	const env = { DSH_HOME: root };
	assert.deepEqual(resolveProfile(['dsh', root], env), { name: 'desktop', source: 'profiles-single' });

	// 有多个 profile 时绝不猜：宁可回退 default，也不把别人的团队挂错。
	mkdirSync(join(root, 'profiles', 'web'), { recursive: true });
	assert.deepEqual(resolveProfile(['dsh', root], env), { name: 'default', source: 'default' });

	// 显式 argv / env 仍然优先于该兜底。
	assert.deepEqual(resolveProfile(['dsh', join(root, 'profiles', 'web')], env), { name: 'web', source: 'argv-path' });
	assert.deepEqual(resolveProfile(['dsh', root], { ...env, DSH_PROFILE: 'ai-team' }), { name: 'ai-team', source: 'env' });

	// 没有 profiles 目录（全新环境）时保持 default。
	const empty = mkdtempSync(join(tmpdir(), 'aiteam-ns-empty-'));
	t.after(() => rmSync(empty, { recursive: true, force: true }));
	assert.deepEqual(resolveProfile(['dsh'], { DSH_HOME: empty }), { name: 'default', source: 'default' });
});
