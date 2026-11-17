/**
 * 主对话「需求内容」：文字 + 图片/文件附件 + @成员（#65）。
 *
 * 文渊阁对话框与 DSH 标准会话（宿主会话转发）共用这一份：
 * - 附件只收 DSH 附件存储已落盘的持久引用（ImageBlock / FileBlock 的 `attachment`），
 *   形状与官方 `ImageAttachmentRef` / `FileAttachmentRef` 一致，原样交给成员会话；
 * - @成员按项目花名册识别，长名优先（「玄策2」不被「玄策」截走）；
 * - 交给成员的内容 = 一段文字 + 附件块，顺序与 Human 提交时一致。
 */

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const MAX_ATTACHMENTS = 10;

const isId = (value) => typeof value === 'string' && value.trim() !== '' && value.length <= 256;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/** 一个附件块 → 规范化块；形状不对返回 null（不猜、不补）。 */
export function normalizeAttachment(block) {
	const ref = block?.attachment;
	if (block?.type === 'image') {
		if (!isId(ref?.attachmentId) || !IMAGE_TYPES.has(ref?.mediaType) || !isCount(ref?.bytes) || !isCount(ref?.width) || !isCount(ref?.height)) return null;
		return {
			type: 'image',
			attachment: {
				attachmentId: ref.attachmentId,
				mediaType: ref.mediaType,
				bytes: ref.bytes,
				width: ref.width,
				height: ref.height,
				...(typeof ref.name === 'string' && ref.name !== '' ? { name: ref.name.slice(0, 200) } : {}),
				...(isCount(ref.originalDimensions?.width) && isCount(ref.originalDimensions?.height)
					? { originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height } }
					: {}),
			},
		};
	}
	if (block?.type === 'file') {
		if (!isId(ref?.attachmentId) || !isCount(ref?.bytes) || typeof ref?.name !== 'string') return null;
		return { type: 'file', attachment: { attachmentId: ref.attachmentId, bytes: ref.bytes, name: ref.name.slice(0, 200) } };
	}
	return null;
}

/** 附件列表 → 规范化列表（去掉坏块与重复，封顶 MAX_ATTACHMENTS）。 */
export function normalizeAttachments(list) {
	const out = [];
	const seen = new Set();
	for (const block of Array.isArray(list) ? list : []) {
		const normalized = normalizeAttachment(block);
		if (normalized === null) continue;
		const key = `${normalized.type}:${normalized.attachment.attachmentId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(normalized);
		if (out.length >= MAX_ATTACHMENTS) break;
	}
	return out;
}

/**
 * 正文里 @ 到的成员 id（按出现顺序去重）。只认在岗的 agent 成员；长名优先匹配，
 * 名字后面紧跟什么都行（中文里「@玄策看下」很常见）。
 */
export function findMentions(body, members) {
	if (typeof body !== 'string' || !body.includes('@')) return [];
	const roster = (Array.isArray(members) ? members : Object.values(members ?? {}))
		.filter((member) => member?.kind === 'agent' && member.status !== 'retired' && typeof member.name === 'string' && member.name.trim() !== '')
		.map((member) => ({ id: member.id, name: member.name.trim(), sessionId: member.sessionId ?? null }))
		.sort((a, b) => b.name.length - a.name.length);
	const hits = [];
	// DSH 标准会话输入框的 @ 插入的是会话链接 `@[名字](dsh-session:<base64url 的 JSON 会话 id>)`
	// （il2c 11-17 20:53 实机：「@[tony老师](dsh-session:…)」没叫醒 tony 老师）。先按会话 id 对上成员，对不上再按名字。
	for (const match of body.matchAll(DSH_SESSION_MENTION)) {
		const sessionId = decodeSessionRef(match[2]);
		const byName = roster.find((member) => member.name === match[1].trim());
		const bySession = sessionId === null ? undefined : roster.find((member) => member.sessionId === sessionId);
		const hit = bySession ?? byName;
		if (hit !== undefined) hits.push([match.index, hit.id]);
	}
	for (let at = body.indexOf('@'); at !== -1; at = body.indexOf('@', at + 1)) {
		const rest = body.slice(at + 1);
		const hit = roster.find((member) => rest.startsWith(member.name));
		if (hit !== undefined) hits.push([at, hit.id]);
	}
	const ids = [];
	for (const [, id] of hits.sort((a, b) => a[0] - b[0])) if (!ids.includes(id)) ids.push(id);
	return ids;
}

const DSH_SESSION_MENTION = /@\[([^\]\n]{1,64})\]\(dsh-session:([A-Za-z0-9_-]{4,400})\)/g;

/** `dsh-session:` 后面的引用 = base64url 编码的 JSON 字符串（会话 id）；解不开返回 null。 */
function decodeSessionRef(ref) {
	try {
		const value = JSON.parse(Buffer.from(ref, 'base64url').toString('utf8'));
		return typeof value === 'string' && value !== '' ? value : null;
	} catch {
		return null;
	}
}

/** 主对话里把 DSH 会话链接显示成「@名字」（链接只对 DSH 自己的界面有意义，在文渊阁里是一串乱码）。 */
export function plainMentionLinks(body) {
	return typeof body === 'string' ? body.replace(DSH_SESSION_MENTION, (_, name) => '@' + name.trim()) : body;
}

/** 附件的一行文字说明（主对话摘要、提示词里给模型看清有几张图几个文件）。 */
export function describeAttachments(attachments) {
	const list = Array.isArray(attachments) ? attachments : [];
	const images = list.filter((block) => block.type === 'image').length;
	const files = list.filter((block) => block.type === 'file').map((block) => block.attachment.name);
	const parts = [];
	if (images > 0) parts.push(`${images} 张图片`);
	if (files.length > 0) parts.push(`${files.length} 个文件（${files.join('、')}）`);
	return parts.length === 0 ? '' : `附：${parts.join('，')}`;
}

/** 交给成员会话的内容：没有附件时保持纯文字（与原唤醒路径一致），有附件时 = 文字块 + 附件块。 */
export function messageContent(text, attachments) {
	const list = normalizeAttachments(attachments);
	return list.length === 0 ? text : [{ type: 'text', text }, ...list];
}
/**
 * Human 在主对话 @ 了这个成员、而成员还没在主对话回过话时，返回那条点名消息；否则 null。
 * 主对话平时只有负责人发言；被点名的成员可以直接回这一次（il2c 11-17 21:44：tony 老师被 @ 后 say 被拒，只能请墨渊代发）。
 * 每次点名只换一次发言：成员在点名之后发过一条，这次点名就算答过了。
 */
export function unansweredMention(stream, memberId, projectId) {
	const entries = (Array.isArray(stream) ? stream : []).filter((entry) => projectId === undefined || projectId === null || entry.projectId === undefined || entry.projectId === projectId);
	let mention = null;
	for (const entry of entries) {
		if (entry.kind === 'human_message' && Array.isArray(entry.mentions) && entry.mentions.includes(memberId)) mention = entry;
		else if (mention !== null && entry.authorId === memberId && entry.seq > mention.seq) mention = null;
	}
	return mention;
}
