import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('client source contains the situation (four-quadrant) view', async () => {
	const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
	assert.match(source, /tabSituation/);
	assert.match(source, /function Situation/);
	assert.match(source, /function QuadrantCard/);
	assert.match(source, /'situation'/);
	assert.match(source, /at-agentconfig/);
	assert.match(source, /agentDefaultModel/);
	assert.match(source, /runCommand/);
	assert.match(source, /stream\.post/);
	assert.match(source, /task\.create/);
	assert.match(source, /openAddAgent/);
	assert.match(source, /at-modalback/);
	assert.match(source, /addAgentTitle/);
});

test('client factory registers the sidebar icon and main workbench panel', async () => {
	const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
	let captured;
	const styleTags = [];
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load(definition) {
					captured = definition;
				},
			},
		},
		document: {
			createElement() {
				const node = { dataset: {}, textContent: '', remove() {} };
				styleTags.push(node);
				return node;
			},
			head: { append() {} },
		},
		console: { log() {}, error() {} },
		fetch: async () => {
			throw new Error('not used in this smoke test');
		},
	};
	vm.runInNewContext(source, sandbox, { filename: 'client.js' });

	assert.equal(captured.id, '@suifei/dsh-ai-team');
	assert.equal(typeof captured.factory, 'function');

	class Component {}
	const React = {
		createElement() {
			return { type: 'stub' };
		},
		Component,
		useState: (value) => [value, () => {}],
		useEffect: () => {},
	};
	const mod = captured.factory((specifier) => {
		assert.equal(specifier, 'react');
		return React;
	});
	assert.deepEqual([...mod.inject], ['slots', 'locale']);
	assert.equal(typeof mod.apply, 'function');

	const calls = [];
	const ctx = {
		effect(fn) {
			fn();
		},
		locale: {
			register(namespace) {
				calls.push(['locale', namespace]);
			},
			bind(namespace) {
				return (key) => namespace + '.' + key;
			},
		},
		slots: {
			inject(name, install) {
				calls.push(['inject', name]);
				install();
			},
			register(options) {
				calls.push(['register', options.name, options.key ?? options.id]);
				return () => {};
			},
		},
	};
	mod.apply(ctx);

	assert.ok(calls.some((call) => call[0] === 'locale' && call[1] === 'agentTeam'));
	assert.ok(calls.some((call) => call[0] === 'register' && call[1] === 'sidebar.panellist' && call[2] === 'ai-team'));
	assert.ok(calls.some((call) => call[0] === 'register' && call[1] === 'main' && call[2] === 'ai-team'));
	assert.equal(styleTags.length, 1);
});
