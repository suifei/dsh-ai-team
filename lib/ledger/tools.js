/**
 * 账本工具面（R-15 / "plumbing 的 porcelain"）：把 writer 已有的读取与
 * 校验能力包装成不依赖宿主进程的人读操作——"一切有记录"的承诺必须可以
 * **独立兑现**才成立。
 *
 * 纪律：全部只读；**不做 gc/压缩/删除**（D1 裁定：append-only 即历史不可变）。
 *
 *   exportLedger(dir, outDir)   自包含导出包：段文件副本 + manifest.json +
 *                               verify-report.md（人读校验结论）
 *   auditLedger(dir)            独立校验 hash 链，返回结构化结论（人读报告
 *                               由 CLI 层渲染）
 *   statsLedger(dir)            段/事件/字节计数与首尾时间
 */

import fsDefault from 'node:fs';
import pathDefault from 'node:path';
import { verifyChain } from './events.js';

function listSegments(dir, fs = fsDefault) {
	return fs.readdirSync(dir)
		.filter((name) => /^ledger-\d+\.jsonl$/.test(name))
		.sort();
}

function readEvents(dir, fs = fsDefault) {
	const segments = listSegments(dir, fs);
	const events = [];
	for (const name of segments) {
		const text = fs.readFileSync(pathDefault.join(dir, name), 'utf8');
		for (const line of text.split('\n')) {
			if (line.trim() === '') continue;
			events.push(JSON.parse(line));
		}
	}
	return { segments, events };
}

function bytesOf(dir, segments, fs = fsDefault) {
	let total = 0;
	for (const name of segments) {
		total += fs.statSync(pathDefault.join(dir, name)).size;
	}
	return total;
}

/** 独立校验：读全部事件 → verifyChain（不加锁、不写盘、不 require 宿主）。 */
export function auditLedger(dir, options = {}) {
	const fs = options.fs ?? fsDefault;
	const { segments, events } = readEvents(dir, fs);
	const projectId = events[0]?.projectId ?? null;
	const chain = verifyChain(events, { projectId });
	return {
		ok: chain.ok,
		dir,
		projectId,
		segments,
		eventCount: events.length,
		head: events.length > 0 ? { seq: events.at(-1).seq, hash: events.at(-1).hash, at: events.at(-1).at } : null,
		error: chain.ok ? null : { code: chain.code, message: chain.message, details: chain.details ?? {}, index: chain.index ?? null },
	};
}

/** 段/事件/字节/首尾时间统计。 */
export function statsLedger(dir, options = {}) {
	const fs = options.fs ?? fsDefault;
	const { segments, events } = readEvents(dir, fs);
	const first = events[0] ?? null;
	const last = events.at(-1) ?? null;
	return {
		dir,
		segments: segments.length,
		segmentBytes: segments.length > 0 ? bytesOf(dir, segments, fs) : 0,
		eventCount: events.length,
		firstAt: first?.at ?? null,
		lastAt: last?.at ?? null,
		headSeq: last?.seq ?? 0,
		types: [...new Set(events.map((event) => event.type))].sort(),
	};
}

/**
 * 自包含导出：段文件副本（字节级复制，不重排不重写）+ manifest.json（head/
 * 事件计数/文件清单/导出时间）+ verify-report.md（人读校验结论）。导出包
 * 拷到任何机器都可以用 audit 独立复检。
 */
export function exportLedger(dir, outDir, options = {}) {
	const fs = options.fs ?? fsDefault;
	const path = options.path ?? pathDefault;
	const audit = auditLedger(dir, { fs });
	fs.mkdirSync(outDir, { recursive: true });
	const copied = [];
	for (const name of audit.segments) {
		fs.copyFileSync(path.join(dir, name), path.join(outDir, name));
		copied.push({ name, bytes: fs.statSync(path.join(outDir, name)).size });
	}
	const manifest = {
		exportedAt: new Date().toISOString(),
		sourceDir: dir,
		projectId: audit.projectId,
		head: audit.head,
		eventCount: audit.eventCount,
		files: copied,
		verify: { ok: audit.ok, error: audit.error },
	};
	fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
	const lines = [
		'# Ledger export verify report', '',
		'- source: `' + dir + '`',
		'- projectId: `' + String(audit.projectId) + '`',
		'- events: ' + String(audit.eventCount),
		'- head: seq ' + String(audit.head?.seq ?? 0),
		'- hash chain: ' + (audit.ok ? '**OK**' : '**BROKEN**'),
		audit.error ? '- error: ' + audit.error.code + ' ' + audit.error.message : '- error: none',
		'- exportedAt: ' + manifest.exportedAt,
	];
	fs.writeFileSync(path.join(outDir, 'verify-report.md'), lines.join('\n') + '\n', 'utf8');
	return { ok: audit.ok, outDir, files: copied.map((file) => file.name).concat(['manifest.json', 'verify-report.md']) };
}
