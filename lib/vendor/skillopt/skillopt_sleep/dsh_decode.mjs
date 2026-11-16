// SkillOpt-Sleep — decode one DeepSeek Harness session log to stdout.
//
// DSH stores every session as `<DSH_HOME>/sessions/<key>/<id>/session.v4.jsonl.zstd`:
// JSONL compressed as a series of zstd frames (one per flush). The Python
// standard library has no zstd decoder before 3.14, while every DSH install
// ships a Node runtime whose zlib has one — so the `dsh` transcript source runs
// this script and parses the JSONL it streams.
//
// Frames are decoded one at a time and written as soon as each completes:
//   * the reader can stop after the header line (first frame) of a session that
//     belongs to another project;
//   * a session still being written ends in a partial frame — everything before
//     it is emitted, the torn tail is dropped (a whole-stream decoder discards the
//     already-decoded output of the read chunk that holds the error).
// A frame-magic match inside compressed bytes is not a boundary: such a segment
// fails to decode alone and is carried into the next one.
//
// Usage: node dsh_decode.mjs <session.v4.jsonl.zstd>
// Exit codes: 0 ok · 2 Node without zstd · 3 torn/corrupt tail dropped · 4 unreadable file.
import { readFileSync, writeSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const [file] = process.argv.slice(2);
if (typeof zstdDecompressSync !== 'function') {
	process.stderr.write(`dsh_decode: Node ${process.version} has no zstd support (needs >= 22.15)\n`);
	process.exit(2);
}
let buffer;
try {
	buffer = readFileSync(file);
} catch (error) {
	process.stderr.write(`dsh_decode: ${error?.message ?? error}\n`);
	process.exit(4);
}

const starts = [];
for (let at = buffer.indexOf(MAGIC); at !== -1; at = buffer.indexOf(MAGIC, at + 4)) starts.push(at);
let carryFrom = null;
for (let i = 0; i < starts.length; i += 1) {
	const from = carryFrom ?? starts[i];
	const to = starts[i + 1] ?? buffer.length;
	let text;
	try {
		text = zstdDecompressSync(buffer.subarray(from, to));
	} catch {
		carryFrom = from;
		continue;
	}
	carryFrom = null;
	try {
		writeSync(1, text);
	} catch {
		// The reader closed the pipe: it has what it needs.
		process.exit(0);
	}
}
if (carryFrom !== null) {
	process.stderr.write('dsh_decode: torn or corrupt tail dropped\n');
	process.exitCode = 3;
}
