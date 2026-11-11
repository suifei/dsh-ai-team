import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeProjectDir, quoteArgv } from '../lib/skillopt/gate-wiring.js';

test('a real absolute directory passes project validation', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-safe-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	assert.equal(assertSafeProjectDir(dir), dir.trim());
});

test('shell metacharacters in the project path are rejected before reaching a shell', () => {
	// 这些会被 `quoteArgv` 的双引号包裹，但 `$(...)`/反引号在双引号内仍被 shell 展开
	for (const evil of ['E:/tmp/$(touch pwned)', 'E:/tmp/`id`', 'E:/tmp/a;rm -rf b', 'E:/tmp/a|b', 'E:/tmp/a&b', 'E:/tmp/a%PATH%']) {
		assert.throws(() => assertSafeProjectDir(evil), /metacharacters/, evil);
	}
});

test('relative, empty and nonexistent project paths are rejected', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'aiteam-safe2-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	assert.throws(() => assertSafeProjectDir(''), /required/);
	assert.throws(() => assertSafeProjectDir('relative/dir'), /absolute/);
	assert.throws(() => assertSafeProjectDir(join(dir, 'missing')), /does not exist/);
});

test('quoteArgv still quotes values with spaces', () => {
	assert.equal(quoteArgv(['status', '--project', 'E:/my dir']), 'status --project "E:/my dir"');
});
