/**
 * 端到端验证 0.4.54：**库模块**的失败（拿不到 diag 实例的那些）是否真的落进诊断日志。
 *
 * 之前只单测了共享汇本身（mock sink），没有验证「插件装好 sink 后，一次真实的库失败
 * 会被写成 `.fail` 行并落盘」。这里制造一次 `ProjectRegistry.load` 的损坏路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { apply } from '../index.js';

test('a corrupt projects.json lands in the diagnostic log as registry.corrupt.fail', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-diag-'));
	// 诊断 logger 的写入是串行排队、可能在用例结束后仍在落盘：删除临时目录要允许
	// 重试，否则会以 ENOTEMPTY 失败（这是夹具清理，不是产品行为）。
	t.after(async () => {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			try { await rm(root, { recursive: true, force: true }); return; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
		}
	});
	const previousHome = process.env.DSH_HOME;
	const previousProfile = process.env.DSH_PROFILE;
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'diagtest';
	t.after(() => {
		process.env.DSH_HOME = previousHome;
		process.env.DSH_PROFILE = previousProfile;
	});
	// 预置一个损坏的 projects.json：ProjectRegistry.load 会改名保留并 console.error。
	const dataDir = join(root, 'ai-team', 'diagtest');
	await mkdir(dataDir, { recursive: true });
	await writeFile(join(dataDir, 'projects.json'), '{ this is not json', 'utf8');

	const routes = [];
	let disposeEffect = null;
	const ctx = {
		effect(fn) { disposeEffect = fn(); },
		on() { return () => {}; },
		get(id) {
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') {
				return {
					catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }),
					resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
					set: () => {},
				};
			}
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
	const diagDir = join(root, 'diag');
	let server = null;
	try {
		// 静音库模块的 console 输出（我们要验证的是落盘，不是终端）。
		const realWarn = console.warn;
		const realError = console.error;
		console.warn = () => {};
		console.error = () => {};
		t.after(() => {
			console.warn = realWarn;
			console.error = realError;
		});
		apply(ctx, { diagLogDir: diagDir, diagLevel: 'full' });
		const route = routes[0];
		assert.ok(route, 'workbench route must be registered');
		server = createServer((req, res) => route.handler(req, res));
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		// 触发一次 bootstrap，确保 boot 已完成、诊断行已排队落盘。
		const { port } = server.address();
		const response = await fetch(`http://127.0.0.1:${port}/ai-team/api/health`);
		assert.equal(response.status, 200);

		let rows = [];
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const files = await readdir(diagDir).catch(() => []);
			const jsonl = files.filter((name) => name.endsWith('.jsonl'));
			if (jsonl.length > 0) {
				const text = await readFile(join(diagDir, jsonl[0]), 'utf8');
				rows = text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
				if (rows.some((row) => row.ev === 'registry.corrupt.fail')) break;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const corrupt = rows.find((row) => row.ev === 'registry.corrupt.fail');
		assert.ok(corrupt, `registry.corrupt.fail must be persisted; got ${JSON.stringify(rows.map((row) => row.ev))}`);
		assert.match(String(corrupt.kept ?? ''), /projects\.json/);
	} finally {
		server?.close();
		try { disposeEffect?.(); } catch { /* already disposed */ }
	}
});
