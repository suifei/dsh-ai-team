import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Monotonic-ish ULID-style id: 10 chars time + 12 chars randomness. */
export function newId(prefix = '') {
	let time = Date.now();
	let out = '';
	for (let i = 0; i < 10; i += 1) {
		out = CROCKFORD[time % 32] + out;
		time = Math.floor(time / 32);
	}
	const bytes = randomBytes(12);
	for (const byte of bytes) out += CROCKFORD[byte % 32];
	return prefix === '' ? out : `${prefix}_${out}`;
}

export const ids = {
	project: () => newId('prj'),
	member: () => newId('mem'),
	task: () => newId('tsk'),
	event: () => newId('evt'),
	stream: () => newId('str'),
	inbox: () => newId('inb'),
	review: () => newId('rev'),
};
