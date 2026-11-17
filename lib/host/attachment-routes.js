/**
 * 文渊阁对话框的图片/文件（#65）：上传进 DSH 附件存储、按主对话消息读回。
 *
 * 只用官方 `ctx.attachments`（AttachmentStore）——与 DSH 标准会话输入框同一份存储与校验：
 * - 上传 `POST /ai-team/api/attachments?kind=image|file&name=…&type=image/png`，请求体是原始字节；
 *   图片走 `saveImages`（格式/尺寸/字节上限由宿主校验并规范化），文件走 `saveFile`（原样保存）；
 *   返回的块就是 DSH 消息里的 ImageBlock / FileBlock，可直接放进 `stream.post` 的 attachments；
 * - 读回 `GET /ai-team/api/attachments/content?project=…&seq=…&index=…`：只按账本里那条消息记下的
 *   引用读，不接受客户端自报引用（读到的一定是这个项目主对话里真发过的附件）。
 */
import { normalizeAttachment } from '../domain/rich-message.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DEFAULT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

function failure(status, code, message) {
	return { status, body: { ok: false, error: { code, message } } };
}

async function readBytes(req, limit) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) return null;
		chunks.push(chunk);
	}
	return new Uint8Array(Buffer.concat(chunks));
}

/** 文件名只作显示：去掉路径部分与控制字符，封顶 200 字。 */
export function displayName(raw) {
	const name = String(raw ?? '').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f]/g, '').trim();
	return name.slice(0, 200);
}

/**
 * @param {{ store: any, req: AsyncIterable<Uint8Array>, url: URL }} options
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function uploadAttachment({ store, req, url }) {
	if (store === undefined || store === null) return failure(503, 'E_ATTACHMENTS_UNAVAILABLE', 'the Host has no attachment store');
	const kind = url.searchParams.get('kind');
	const name = displayName(url.searchParams.get('name'));
	if (kind === 'image') {
		const mediaType = url.searchParams.get('type');
		if (!IMAGE_TYPES.has(mediaType)) return failure(415, 'E_UNSUPPORTED_IMAGE_TYPE', `image type ${String(mediaType)} is not accepted`);
		const limit = Number(store.imageLimits?.maxImageBytes) || DEFAULT_IMAGE_BYTES;
		const data = await readBytes(req, limit);
		if (data === null) return failure(413, 'E_TOO_LARGE', `image is larger than ${limit} bytes`);
		if (data.byteLength === 0) return failure(400, 'E_EMPTY', 'image is empty');
		const [ref] = await store.saveImages([{ data, mediaType, ...(name !== '' ? { name } : {}) }]);
		return { status: 200, body: { ok: true, block: normalizeAttachment({ type: 'image', attachment: ref }) } };
	}
	if (kind === 'file') {
		const data = await readBytes(req, MAX_FILE_BYTES);
		if (data === null) return failure(413, 'E_TOO_LARGE', `file is larger than ${MAX_FILE_BYTES} bytes`);
		const ref = await store.saveFile({ data, name: name === '' ? 'file' : name });
		return { status: 200, body: { ok: true, block: normalizeAttachment({ type: 'file', attachment: { ...ref, name: ref.name ?? name } }) } };
	}
	return failure(400, 'E_INVALID_ARGUMENT', 'kind must be image or file');
}

/** 账本主对话里第 seq 条消息的第 index 个附件；没有返回 null。 */
export function attachmentAt(state, seq, index) {
	const entry = (state?.stream ?? []).find((candidate) => candidate.seq === seq);
	const block = Array.isArray(entry?.attachments) ? entry.attachments[index] : undefined;
	return block === undefined ? null : normalizeAttachment(block);
}

/**
 * @param {{ store: any, state: any, url: URL }} options
 * @returns {Promise<{ status: number, body?: object, bytes?: Uint8Array | AsyncIterable<Uint8Array>, contentType?: string, name?: string }>}
 */
export async function readAttachment({ store, state, url }) {
	if (store === undefined || store === null) return failure(503, 'E_ATTACHMENTS_UNAVAILABLE', 'the Host has no attachment store');
	const seq = Number(url.searchParams.get('seq'));
	const index = Number(url.searchParams.get('index'));
	if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(index) || index < 0) return failure(400, 'E_INVALID_ARGUMENT', 'seq and index are required');
	const block = attachmentAt(state, seq, index);
	if (block === null) return failure(404, 'E_NOT_FOUND', `no attachment ${index} on stream message ${seq}`);
	if (block.type === 'image') {
		const stored = await store.readImage(block.attachment);
		return { status: 200, bytes: stored.data, contentType: block.attachment.mediaType, name: block.attachment.name ?? '' };
	}
	return { status: 200, bytes: store.readFileStream(block.attachment), contentType: 'application/octet-stream', name: block.attachment.name };
}
