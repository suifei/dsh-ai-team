#!/usr/bin/env node
// 打包官方在线人才库 @suifei/dsh-ai-team-catalog：从仓库的 talents/ + teams/ 生成一个可直接 `npm publish` 的目录。
//   node bin/build-catalog.mjs <输出目录> --version 1.0.0
// 只拷白名单内的文件（lib/domain/catalog-sync.js 的 isCatalogPath），并写 index.json（路径 / 字节数 / sha256）。
// 打包前按插件的解析器把每个人才与团队读一遍：写坏的条目直接报错，不发出去。
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, CATALOG_PACKAGE } from '../lib/domain/catalog-sync.js';
import { loadCatalog, resolveTeam } from '../lib/domain/catalog.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'));
const vi = args.indexOf('--version');
const version = vi >= 0 ? args[vi + 1] : undefined;
if (!out || !version) {
	console.error('用法：node bin/build-catalog.mjs <输出目录> --version x.y.z');
	process.exit(2);
}

const diag = [];
const catalog = loadCatalog({ roots: [{ source: 'bundled', dir: repo }], diag: { append: (row) => diag.push(row) } });
for (const id of catalog.teams.keys()) resolveTeam(catalog, id, { diag: { append: (row) => diag.push(row) } });
if (diag.length > 0) {
	console.error('目录里有写坏的条目，不打包：\n' + diag.map((row) => JSON.stringify(row)).join('\n'));
	process.exit(1);
}

const { index, skipped } = buildIndex(repo, { version });
const dir = resolve(out);
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
for (const file of index.files) {
	const target = join(dir, ...file.path.split('/'));
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(join(repo, ...file.path.split('/')), target);
}
writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
const plugin = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
writeFileSync(join(dir, 'package.json'), JSON.stringify({
	name: CATALOG_PACKAGE,
	version,
	description: '文渊阁（@suifei/dsh-ai-team）官方在线人才库：人才 talents/ 与团队 teams/，插件按 index.json 逐文件校验同步',
	license: plugin.license,
	author: plugin.author,
	homepage: plugin.homepage,
	repository: plugin.repository,
	keywords: ['deepseek-harness', 'dsh', 'ai-team', 'talents', 'catalog'],
	files: ['index.json', 'talents/**/*', 'teams/**/*', 'README.md', 'LICENSE'],
	publishConfig: { access: 'public' },
}, null, 2) + '\n');
writeFileSync(join(dir, 'README.md'), `# ${CATALOG_PACKAGE}\n\n文渊阁（[@suifei/dsh-ai-team](https://www.npmjs.com/package/@suifei/dsh-ai-team)）官方在线人才库：${catalog.talents.size} 位人才、${catalog.teams.size} 个团队。\n\n不需要手动安装：在文渊阁「添加成员 → 人才市场」点「同步在线库」，插件按 \`index.json\` 逐文件下载、核对 sha256，落到 \`~/.dsh/ai-team/catalog/official/<版本>/\`。\n`);
copyFileSync(join(repo, 'LICENSE'), join(dir, 'LICENSE'));
console.log(JSON.stringify({ out: dir, version, files: index.files.length, talents: catalog.talents.size, teams: catalog.teams.size, skipped }, null, 2));
