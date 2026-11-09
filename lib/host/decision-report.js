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
	const matches = text.match(/[A-Za-z]:\\[^\r\n"'<>|]+?\.md\b/g);
	return matches === null || matches.length === 0 ? null : matches[matches.length - 1];
}

export function parseDecisionQuestions(markdown) {
	const lines = String(markdown ?? '').split(/\r?\n/);
	const start = lines.findIndex((line) => /^##\s*6[.、\s]/.test(line) || /^##\s*6\s*$/.test(line));
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
