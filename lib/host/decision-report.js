import { existsSync } from 'node:fs';

/**
 * Read the Human-decision table from a linked Markdown report.
 *
 * This is deliberately narrow: only a report containing a section titled
 * `6.` / `六` with a table gets converted. The Inbox still points back to the
 * source Thread; the table is exposed so Human does not have to open the report
 * just to discover the questions.
 */

function stripMarkdown(value) {
	return String(value ?? '')
		.replace(/\*\*/g, '')
		.replace(/`/g, '')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.trim();
}

export function findReportPath(text) {
	if (typeof text !== 'string') return null;
	// 三种写法都要认：反斜杠绝对路径、正斜杠绝对路径、以及带空格（含引号/代码
	// 围栏）的路径。只匹配 `[A-Za-z]:\\...` 会让「E:/works/a b/report.md」这类
	// 完全合法、且是本机常见输出的路径永远进不了 Inbox。
	const patterns = [
		/"[A-Za-z]:[\\/][^"<>|\r\n]+?\.md"/g,
		/'[A-Za-z]:[\\/][^'<>|\r\n]+?\.md'/g,
		/`[A-Za-z]:[\\/][^`<>|\r\n]+?\.md`/g,
		/[A-Za-z]:[\\/][^\s"'<>|`]+?\.md\b/g,
	];
	// 命中多个时先看**哪个真的存在**：模型常先给示例路径、再给真实产物路径，文末
	// 也可能附一段模板示例——单靠「取第一个/取最后一个」都会错一边。存在的路径
	// 优先；都不存在时退回「最后一次提到」，那是模型的最终答复约定。
	const hits = [];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			hits.push({ index: match.index ?? 0, path: match[0].replace(/^["'`]|["'`]$/g, '') });
		}
	}
	if (hits.length === 0) return null;
	hits.sort((a, b) => a.index - b.index);
	const existing = hits.filter((hit) => {
		try { return existsSync(hit.path); } catch { return false; }
	});
	return (existing.length > 0 ? existing[existing.length - 1] : hits[hits.length - 1]).path;
}

export function parseDecisionQuestions(markdown) {
	const lines = String(markdown ?? '').split(/\r?\n/);
	const start = lines.findIndex((line) => /^##\s*(6|六)[.、\s]/.test(line) || /^##\s*(6|六)\s*$/.test(line));
	if (start < 0) return [];
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^##\s/.test(lines[index]) || /^---\s*$/.test(lines[index])) { end = index; break; }
	}
	const questions = [];
	for (const line of lines.slice(start + 1, end)) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
		if (cells.length < 2) continue;
		if (!/^\d+$/.test(stripMarkdown(cells[0]))) continue;
		const text = stripMarkdown(cells[1]);
		if (text === '') continue;
		questions.push({
			id: `q${questions.length + 1}`,
			text,
			...(cells[2] ? { recommendation: stripMarkdown(cells[2]) } : {}),
			...(cells[3] ? { blocking: stripMarkdown(cells[3]) } : {}),
		});
	}
	return questions;
}
