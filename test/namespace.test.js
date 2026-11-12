import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirBytes, migrateLegacyNamespace, resolveProfileName } from '../lib/ledger/namespace.js';

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
