/**
 * skillopt_adopt mock-attribution guard: first-hand evidence comes from the
 * engine's staging layout (<project>/.skillopt-sleep/staging/<ts>/ with
 * diagnostics.json written per run by cycle.py). The guard must fail closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptGuardVerdict } from '../lib/vendor/skillopt/src/index.js';

const STAGE_TS = '20261110-120000';

async function makeStaging(t, diagnostics) {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-adopt-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const dir = join(root, '.skillopt-sleep', 'staging', STAGE_TS);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'manifest.json'), '{}', 'utf8');
	if (diagnostics !== undefined) {
		await writeFile(join(dir, 'diagnostics.json'), JSON.stringify(diagnostics), 'utf8');
	}
	return root;
}

test('adopt guard refuses mock-validated proposals (fail closed)', async (t) => {
	const project = await makeStaging(t, { night: 1, backend: 'mock', accepted: true });
	const verdict = adoptGuardVerdict(project);
	assert.equal(typeof verdict, 'string');
	assert.match(verdict, /MOCK backend/);
	assert.match(verdict, /skillopt_run/);
});

test('adopt guard admits proposals validated by a real backend', async (t) => {
	const project = await makeStaging(t, { night: 1, backend: 'claude', accepted: true });
	assert.equal(adoptGuardVerdict(project), null);
});

test('adopt guard refuses unattributable proposals (missing diagnostics)', async (t) => {
	const project = await makeStaging(t, undefined);
	const verdict = adoptGuardVerdict(project);
	assert.equal(typeof verdict, 'string');
	assert.match(verdict, /cannot attribute/);
});

test('adopt guard refuses unattributable proposals (backend field missing)', async (t) => {
	const project = await makeStaging(t, { night: 1, accepted: true });
	const verdict = adoptGuardVerdict(project);
	assert.equal(typeof verdict, 'string');
	assert.match(verdict, /does not name the validating backend/);
});

test('adopt guard refuses when no staged proposal exists at all', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'aiteam-adopt-empty-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const verdict = adoptGuardVerdict(root);
	assert.equal(typeof verdict, 'string');
	assert.match(verdict, /no staged proposal/);
});
