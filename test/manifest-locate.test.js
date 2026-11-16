// #26: DSH Desktop 宿主没有 loader.internal 时，dsh-client-modules 的 locatePkgJson 走 CJS 回退：
//   createRequire(baseUrl).resolve(`${name}/package.json`)，失败被 catch 吞掉 → 客户端行静默丢弃 → 侧边栏无入口。
// 这里用同一调用从仓库根（包自引用，等价于 profile 的 node_modules 解析）复现该回退分支。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

test('#26 the manifest resolves through the CJS fallback that Desktop uses', () => {
	const located = createRequire(pkgPath).resolve(`${pkg.name}/package.json`);
	assert.equal(located, pkgPath);
});

test('#26 the client entry the host reads from dsh.client still resolves', () => {
	assert.equal(pkg.dsh.client.platform, 'web');
	const client = createRequire(pkgPath).resolve(`${pkg.name}/client`);
	assert.equal(client, fileURLToPath(new URL('../client.js', import.meta.url)));
});
