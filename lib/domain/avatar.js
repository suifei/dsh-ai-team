/**
 * 头像参数（人才 talent.yml 的 `avatar`、成员资料的 `avatar`）与本机画图。
 * 画图用 @suifei/hash-avatar（契约 v1，与 avatar.onrpc.com 同一张图），插件自己出 SVG，不连外网。
 * 人才市场、团队、成员共用这一份校验与渲染。
 */
import { createRequire } from 'node:module';

const HashAvatar = createRequire(import.meta.url)('@suifei/hash-avatar');

export const AVATAR_GENDERS = Object.freeze(['male', 'female', 'neutral']);
export const AVATAR_AGES = Object.freeze(['baby', 'teen', 'youth', 'middle', 'old']);
export const AVATAR_RACES = Object.freeze(['asian', 'white', 'black', 'brown', 'auto']);

/** 默认：亚洲人、青年、性别不指定。 */
export const DEFAULT_AVATAR = Object.freeze({ gender: 'neutral', age: 'youth', race: 'asian' });

/**
 * 校验头像参数。缺省（undefined / null）返回 null；字段可只给一部分，缺的按 DEFAULT_AVATAR 补。
 * 写错的值抛错并说明哪一项，不静默改成别的。
 * @param {unknown} value
 * @param {string} [label]
 * @returns {{ gender: string, age: string, race: string } | null}
 */
export function parseAvatar(value, label = 'avatar') {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象（gender / age / race）`);
	const pick = (key, allowed) => {
		const raw = value[key];
		if (raw === undefined || raw === null || raw === '') return DEFAULT_AVATAR[key];
		if (typeof raw !== 'string' || !allowed.includes(raw)) throw new Error(`${label}.${key} 只认 ${allowed.join(' / ')}`);
		return raw;
	};
	return { gender: pick('gender', AVATAR_GENDERS), age: pick('age', AVATAR_AGES), race: pick('race', AVATAR_RACES) };
}

/**
 * 画一张头像 SVG。参数宽松：写错或缺省的按 DEFAULT_AVATAR；尺寸夹到 16..1024；
 * 小于 128px（客户端按 2 倍像素取图，即显示不到 64px）时去掉外圈指纹：太密看不清（见 hash-avatar README）。
 * @param {string} name
 * @param {{ gender?: string, age?: string, race?: string, size?: number|string }} [options]
 */
export function renderAvatarSvg(name, options = {}) {
	const pick = (key, allowed) => (allowed.includes(options[key]) ? options[key] : DEFAULT_AVATAR[key]);
	const size = Math.max(16, Math.min(1024, Math.round(Number(options.size) || 64)));
	const input = String(name ?? '').trim().slice(0, 200) || '?';
	return HashAvatar.svg(input, { gender: pick('gender', AVATAR_GENDERS), age: pick('age', AVATAR_AGES), race: pick('race', AVATAR_RACES), size, fingerprint: size >= 128 });
}
