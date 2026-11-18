// 测试共用：npm 包同形的 tgz（在线人才库、头像库的假 registry 都用它）。
import { gzipSync } from 'node:zlib';

/** 测试用 tar 打包（ustar；长路径走 pax 头），与 npm pack 同形：文件都在 package/ 下。 */
export function tarOf(files) {
	const blocks = [];
	const header = (name, size, type) => {
		const block = Buffer.alloc(512);
		block.write(name.slice(0, 100), 0, 'utf8');
		block.write('0000644\0', 100); block.write('0000000\0', 108); block.write('0000000\0', 116);
		block.write(size.toString(8).padStart(11, '0') + '\0', 124);
		block.write('00000000000\0', 136);
		block.write('        ', 148);
		block.write(type, 156);
		block.write('ustar\0', 257); block.write('00', 263);
		let sum = 0; for (const byte of block) sum += byte;
		block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
		return block;
	};
	const pad = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)]);
	for (const [path, content] of Object.entries(files)) {
		const name = `package/${path}`;
		const body = Buffer.from(content);
		if (Buffer.byteLength(name) > 100) {
			const rec = ` path=${name}\n`;
			let len = rec.length + 2; while (String(len).length + rec.length !== len) len = String(len).length + rec.length;
			const pax = Buffer.from(`${len}${rec}`);
			blocks.push(header('PaxHeader', pax.length, 'x'), pad(pax));
		}
		blocks.push(header(name, body.length, '0'), pad(body));
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks));
}
