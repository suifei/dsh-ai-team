/**
 * 头像参数（人才 talent.yml 的 `avatar`、成员资料的 `avatar`）。
 * 画图交给 avatar.onrpc.com（hash-avatar v1，客户端拼地址）；这里只管参数合法。
 * 人才市场、团队、成员共用这一份校验。
 */

export const AVATAR_GENDERS = Object.freeze(['male', 'female', 'neutral']);
export const AVATAR_AGES = Object.freeze(['baby', 'teen', 'youth', 'middle', 'old']);
export const AVATAR_RACES = Object.freeze(['asian', 'white', 'black', 'brown', 'auto']);

/** 默认：亚洲人、青年、性别不指定交给服务按名字算。 */
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
