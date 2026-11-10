#!/usr/bin/env node
/**
 * 账本工具 CLI（R-15）：独立进程、只读、不依赖宿主。
 *   node bin/ledger-tools.mjs audit  <ledgerDir>   校验 hash 链（exit 0/1）
 *   node bin/ledger-tools.mjs stats  <ledgerDir>   段/事件/字节统计
 *   node bin/ledger-tools.mjs export <ledgerDir> <outDir>  自包含导出包
 */
import { auditLedger, statsLedger, exportLedger } from '../lib/ledger/tools.js';

const [cmd, dir, outDir] = process.argv.slice(2);
if (!dir) {
	console.error('usage: node bin/ledger-tools.mjs <audit|stats|export> <ledgerDir> [outDir]');
	process.exit(2);
}
if (cmd === 'audit') {
	const report = auditLedger(dir);
	console.log(`ledger: ${dir}`);
	console.log(`projectId: ${report.projectId ?? '?'}`);
	console.log(`events: ${report.eventCount}`);
	console.log(`head: ${report.head ? 'seq ' + report.head.seq + ' @ ' + report.head.at : '(empty)'}`);
	console.log(`hash chain: ${report.ok ? 'OK' : 'BROKEN'}`);
	if (!report.ok) console.log(`error: ${report.error.code} ${report.error.message}`);
	process.exit(report.ok ? 0 : 1);
}
if (cmd === 'stats') {
	const stats = statsLedger(dir);
	console.log(`segments: ${stats.segments} (${stats.segmentBytes} bytes)`);
	console.log(`events: ${stats.eventCount}`);
	console.log(`window: ${stats.firstAt ?? '—'} .. ${stats.lastAt ?? '—'}`);
	console.log(`types: ${stats.types.join(', ')}`);
	process.exit(0);
}
if (cmd === 'export') {
	if (!outDir) {
		console.error('export requires <outDir>');
		process.exit(2);
	}
	const result = exportLedger(dir, outDir);
	console.log(`exported to ${result.outDir}: ${result.files.join(', ')}`);
	process.exit(result.ok ? 0 : 1);
}
console.error(`unknown command: ${String(cmd)}`);
process.exit(2);
