import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { apply } from '../index.js';

// 宿主边界上的两处缺陷（2026-11-15 代码审视）：
//   1. HTTP 路由不过 Connection 信任栅栏——任何网页都能跨站以 Human 身份发命令；
//   2. boot 落定前被卸载——账本锁残留，同进程下一次组合永久 E_LOCKED。

/** connection：null = 不提供该服务；否则 { rejection } 为 requestRejection 的返回值。 */
function makeCtx({ connection = { rejection: undefined } } = {}) {
	const routes = [];
	let disposer = null;
	const ctx = {
		effect(fn) { disposer = fn(); },
		on() { return () => {}; },
		get(id) {
			if (id === 'connection') return connection === null ? undefined : { requestRejection: () => connection.rejection };
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') {
				return {
					catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }),
					resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
				};
			}
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access' };
			return undefined;
		},
	};
	return { ctx, routes, dispose: () => disposer?.() };
}

/** 直接驱动路由处理器（不起 socket）。 */
async function call(route, method, url, body) {
	let status = 0;
	let text = '';
	let done;
	const finished = new Promise((resolve) => { done = resolve; });
	const res = {
		statusCode: 200,
		writableEnded: false,
		setHeader() {},
		writeHead(code) { this.statusCode = code; return this; },
		write(chunk) { text += chunk; return true; },
		end(chunk) { if (chunk !== undefined) text += chunk; status = this.statusCode; this.writableEnded = true; done(); },
		on() { return this; },
	};
	const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
	const req = {
		method,
		url,
		headers: { host: '127.0.0.1', 'content-type': 'application/json' },
		on() { return this; },
		async *[Symbol.asyncIterator]() { yield* chunks; },
	};
	await route.handler(req, res);
	await finished;
	return { status, body: JSON.parse(text) };
}

async function withHome(fn) {
	const root = await mkdtemp(join(tmpdir(), 'ai-team-boundary-'));
	const previousHome = process.env.DSH_HOME;
	const previousProfile = process.env.DSH_PROFILE;
	process.env.DSH_HOME = root;
	process.env.DSH_PROFILE = 'test';
	try {
		await fn();
	} finally {
		if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
		if (previousProfile === undefined) delete process.env.DSH_PROFILE; else process.env.DSH_PROFILE = previousProfile;
		// 诊断日志是异步追加，卸载后可能仍有一行在途。
		await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
	}
}

test('every route passes the connection trust fence; a rejected request changes nothing', async () => {
	await withHome(async () => {
		const trusted = makeCtx();
		apply(trusted.ctx);
		const before = await call(trusted.routes[0], 'GET', '/ai-team/api/health');
		assert.equal(before.status, 200, JSON.stringify(before.body));
		const projectId = before.body.projectId;
		const events = before.body.ledger.events;
		await trusted.dispose();

		for (const rejection of [401, 403]) {
			const fenced = makeCtx({ connection: { rejection } });
			apply(fenced.ctx);
			const read = await call(fenced.routes[0], 'GET', '/ai-team/api/bootstrap');
			assert.equal(read.status, rejection, 'reads are fenced too (DNS rebinding reads the board)');
			const write = await call(fenced.routes[0], 'POST', `/ai-team/api/projects/${projectId}/commands`, {
				type: 'stream.post', payload: { projectId, body: 'cross-site' },
			});
			assert.equal(write.status, rejection);
			assert.equal(write.body.error.code, rejection === 401 ? 'E_UNAUTHENTICATED' : 'E_FORBIDDEN');
			await fenced.dispose();
		}

		const missing = makeCtx({ connection: null });
		apply(missing.ctx);
		const unfenced = await call(missing.routes[0], 'GET', '/ai-team/api/health');
		assert.equal(unfenced.status, 503, 'no fence, no service: never fail open');
		assert.equal(unfenced.body.error.code, 'E_TRUST_FENCE_UNAVAILABLE');
		await missing.dispose();

		const after = makeCtx();
		apply(after.ctx);
		const check = await call(after.routes[0], 'GET', '/ai-team/api/health');
		assert.equal(check.body.ledger.events, events, 'no rejected command reached the ledger');
		await after.dispose();
	});
});

test('a composition disposed before boot settles releases its ledgers and wires nothing', async () => {
	await withHome(async () => {
		// plugin_manager 关→开：前一组合的 boot 还在途就被卸载。
		const first = makeCtx();
		apply(first.ctx);
		await first.dispose();
		const second = makeCtx();
		apply(second.ctx);
		const result = await call(second.routes[0], 'GET', '/ai-team/api/health');
		assert.equal(result.status, 200, JSON.stringify(result.body));
		assert.equal(result.body.ok, true);
		await second.dispose();
	});
});

// GHSA-rw5w-8w2v-8rc5 根治：不靠逐条点名，而是从 index.js 源码里取出全部接口路径（=== 字面量与 .match 正则），
// 每个路径、每种方法在栅栏拒绝时都必须回 401/403，且栅栏先于任何处理被问到。以后新增接口、
// 新注册的路由只要绕过栅栏，这条就会失败。
function everyApiPath() {
	const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
	const literals = [...source.matchAll(/url\.pathname === '([^']+)'/g)].map((m) => m[1]);
	const patterns = [...source.matchAll(/url\.pathname\.match\(\/\^(.+?)\$\/\)/g)].map((m) => m[1].replace(/\(\[\^\/\]\+\)/g, 'x1').replaceAll('\\/', '/'));
	return { literals: [...new Set(literals)], patterns: [...new Set(patterns)] };
}

test('GHSA-rw5w-8w2v-8rc5: every registered route and every API path in index.js is fenced before any handling, for every method', async () => {
	const { literals, patterns } = everyApiPath();
	assert.ok(literals.length >= 20 && patterns.length >= 8, `found ${literals.length} literal and ${patterns.length} pattern paths`);
	assert.ok(patterns.every((path) => path.startsWith('/ai-team/') && !/[\\()[\]^$]/.test(path)), patterns.join(' '));
	const paths = ['/ai-team', '/ai-team/', '/ai-team/client.js', '/ai-team/no-such-route', ...literals, ...patterns];
	await withHome(async () => {
		for (const rejection of [401, 403]) {
			let asked = 0;
			const fenced = makeCtx({ connection: { get rejection() { asked += 1; return rejection; } } });
			apply(fenced.ctx);
			assert.ok(fenced.routes.length >= 1);
			for (const route of fenced.routes) {
				for (const path of paths) {
					for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
						const before = asked;
						const result = await call(route, method, `${path}?project=x1&name=x`, method === 'GET' ? undefined : { type: 'stream.post', payload: {} });
						assert.equal(result.status, rejection, `${method} ${path} must be rejected`);
						assert.equal(result.body.error.code, rejection === 401 ? 'E_UNAUTHENTICATED' : 'E_FORBIDDEN', `${method} ${path}`);
						assert.equal(asked - before, 1, `${method} ${path} asks the fence exactly once`);
					}
				}
			}
			await fenced.dispose();
		}
		// 栅栏服务缺席：同样全部拒绝（503），不放行。
		const missing = makeCtx({ connection: null });
		apply(missing.ctx);
		for (const route of missing.routes) {
			for (const path of paths) {
				const result = await call(route, 'POST', path, { type: 'stream.post', payload: {} });
				assert.equal(result.status, 503, `POST ${path} without a fence`);
				assert.equal(result.body.error.code, 'E_TRUST_FENCE_UNAVAILABLE');
			}
		}
		await missing.dispose();
	});
});
