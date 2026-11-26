import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const start = source.indexOf('async function pickWorkspacePath()');
const end = source.indexOf('async function saveWorkspace()', start);
assert.ok(start >= 0 && end > start, 'project picker handlers must exist');

for (const [action, name] of [['pickNewWorkspace', 'new project'], ['pickProjectWorkspace', 'edit project']]) {
	function setup(service, error = 'previous-error', useContextGetter = true) {
		const draft = { path: 'D:/manual', error };
		const setPath = (value) => { draft.path = value; };
		const setError = (value) => { draft.error = typeof value === 'function' ? value(draft.error) : value; };
		const inactiveSetter = () => assert.fail('picker wrote to the other form');
		const isNew = action === 'pickNewWorkspace';
		const pick = runInNewContext(source.slice(start, end) + '\n' + action, {
			ctx: useContextGetter ? { get: () => service } : { uiWorkspace: service },
			t: (key) => key,
			setNWorkspace: isNew ? setPath : inactiveSetter,
			setWorkspaceDraft: isNew ? inactiveSetter : setPath,
			setNError: isNew ? setError : inactiveSetter,
			setWorkspaceError: isNew ? inactiveSetter : setError,
		});
		return { draft, pick };
	}

	test(name + ': native selection replaces draft and clears an earlier picker error', async () => {
		const { draft, pick } = setup({ pickDirectory: async () => 'D:/selected' }, 'workspacePickUnavailable', false);
		await pick();
		assert.deepEqual(draft, { path: 'D:/selected', error: '' });
	});

	test(name + ': cancel changes neither the typed path nor the existing error', async () => {
		const { draft, pick } = setup({ pickDirectory: async () => null });
		await pick();
		assert.deepEqual(draft, { path: 'D:/manual', error: 'previous-error' });
	});

	test(name + ': unavailable picker preserves manual path and distinguishes host mismatch', async () => {
		const failures = [
			undefined,
			{ pickDirectory: async () => { throw Object.assign(new Error('different wording'), { code: 'directory-picker/unavailable' }); } },
			{ pickDirectory: async () => { throw new Error('directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "browse"'); } },
		];
		for (const service of failures) {
			const { draft, pick } = setup(service);
			await pick();
			assert.deepEqual(draft, { path: 'D:/manual', error: 'workspacePickUnavailable' });
		}
	});

	test(name + ': an actual picker error keeps the generic fallback', async () => {
		const { draft, pick } = setup({ pickDirectory: async () => { throw new Error('directory picker failed: native chooser timed out'); } });
		await pick();
		assert.deepEqual(draft, { path: 'D:/manual', error: 'workspacePickFailed' });
	});
}
