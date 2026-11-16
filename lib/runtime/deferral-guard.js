/**
 * 推迟到自然时间点的识别与纠偏（团队会话：PMO 宿主会话 + 成员）。
 *
 * 实机（il2c，11-16 10:39，PMO）：「评审官并已立约今夜 03:17 自然相裁决点……这条我也会在明早盯一眼结果」。
 * 那件事本可以当场手动跑一次（skillopt_run）并读退出码；而 03:17 的计划任务实际上每晚都以退出码 1 失败，
 * 「等今夜自然跑」既推迟了 16 个小时，又把一个坏掉的环判成了「无需人工修」。同一类话术在 il2c 团队会话
 * 里反复出现（「今夜」「明早」「夜拍」「03:17 自然相」「02:59 前」）。
 *
 * 规则只认「把行动挂在钟点上」：今夜/明早/某时某分 + 等待或行动的动词，或者「自然相/裁决点/夜拍」这类
 * 把钟点当触发条件的说法。相对时长（「每 2 分钟查一次、最多 20 分钟」）是持续盯，不在此列。
 */

// 只收本身就指向未来的日界词。「凌晨窗口离线」「夜间你不用盯了」「下一窗」这类叙述或黑话不算
// （r35 语料校准：il2c 198 条团队回复，宽规则 13 命中里 8 条是这类误报）。
const FUTURE_DAY = '今夜|今晚|今天晚上|明早|明晨|明天|明日|次日|后天';
const ACT = '(?:再|才|看|盯|复查|复核|裁决|裁定|处理|跑|执行|触发|开工|继续|推进|验收|检查|结果|自然(?:相|时点|时刻|触发))';
// 钟点只在带「等到/推迟到/届时」时才算推迟：「白砚在 23:03:05 被唤醒」「已于 02:44 派发」是叙述过去，
// 「02:59 前无票我即催办」是有截止的持续盯，都不该纠偏。
const WAIT_TO = '(?:等到|候到|待到|留到|推迟到|延到|延后到|改到|放到|挪到|到点|届时)';
const CLOCK = '[0-2]?\\d[:：][0-5]\\d';
const NOT_NEGATED = '(?:(?!不用|无需|不必|不要|别)[^。；;\\n])';

const PATTERNS = [
	// 等到今夜 / 候明早 / 届时明天
	new RegExp(`(?:等到?|候|待|留到|推迟到|延到|延后到|改到|放到|挪到|届时|到)\\s*(?:${FUTURE_DAY})`),
	// 今夜再跑 / 明早盯一眼 / 明天复查 / 今夜自然相（中间夹着「不用/无需」的不算）
	new RegExp(`(?:${FUTURE_DAY})${NOT_NEGATED}{0,16}?${ACT}`),
	// 等到 03:17 / 推迟到明早 09:00
	new RegExp(`${WAIT_TO}\\s*(?:${FUTURE_DAY})?\\s*${CLOCK}`),
	// 把钟点当触发条件：03:17 自然相 / 03:17 裁决点
	new RegExp(`${CLOCK}\\s*的?\\s*(?:自然(?:相|时点|时刻|触发)|裁决点)`),
	/\b(?:tonight|tomorrow(?: morning)?|overnight)\b|\bwait (?:until|till) \d{1,2}(?::\d{2})?\b/i,
];

/**
 * @param {string} text 一条助手回复
 * @returns {{ phrase: string } | null} 命中的原文片段（便于纠偏消息引用与诊断）
 */
export function detectDeferral(text) {
	if (typeof text !== 'string' || text === '') return null;
	for (const pattern of PATTERNS) {
		const match = pattern.exec(text);
		if (match !== null) {
			const start = Math.max(0, match.index - 12);
			const end = Math.min(text.length, match.index + match[0].length + 12);
			return { phrase: text.slice(start, end).replace(/\s+/g, ' ').trim() };
		}
	}
	return null;
}

/**
 * 团队推进纪律：注入每个团队会话（PMO 宿主会话 + 成员）的系统提示词。
 *
 * 宿主 PMO 会话此前没有任何插件规程——它直接面对 Human，却从未被告知「不等钟点、不提前收兵、
 * 先核实再宣称」。成员的规程散在三份 SKILL 里，也没有这几条。这里是这几条规则的唯一出处。
 */
export const TEAM_DISCIPLINE_TEXT = [
	'## 文渊阁团队推进纪律',
	'- 立即行动：能现在做的事现在做，不把行动挂在钟点上（今夜、明早、某时某分、下个窗口）。定时任务和夜间环只是兜底；需要它的结果，就现在手动跑一次，读退出码和日志。',
	'- 等待要有边界：等别人交付或外部进程时，现在就开始盯，说清隔多久查一次、最多盯多久；到时没结果就升级或换路，不空等。',
	'- 不提前收兵：还有能推进的事，或下一步的前置条件已经满足，就继续做。只有三种情况可以停：目标已达成、自主批次已用尽、需要 Human 拍板；停的时候写明是哪一种。',
	'- 先核实再宣称：说「正常」「已恢复」「会自动跑」之前，先读状态、退出码、日志时间戳，不凭推断。',
	'- 用平实中文写：不自创术语和缩写，Human 和其他成员要能直接看懂。',
].join('\n');

/**
 * 把纪律段注册进宿主提示词组装，并在团队会话的回合即将结束时纠偏「推迟到钟点」。
 *
 * 用官方两个接缝，不另造通道：
 * - `systemPrompt.section`：文本函数按本次组装的 agent 判定，只对团队会话返回正文；
 * - `agent/turn-stopping`：回合要收尾时若最后一条回复把行动挂在钟点上，`agent.steer` 递一条纠偏，
 *   同一回合继续（同一回合最多一次，第二次收尾放行——模型若写明了真实的时钟依赖，就不再纠缠）。
 *
 * @param {{
 *   systemPrompt?: any,
 *   on?: (name: string, listener: Function) => (() => void),
 *   teamProjectOf: (sessionId: string) => ({ projectId: string, stopped: boolean } | null),
 *   diag?: { append?: (row: object) => void },
 *   newId: () => string,
 * }} options
 * @returns {{ observe: (session: any, event: any) => void, stopping: (payload: any) => Promise<void>, dispose: () => void }}
 */
export function registerTeamDiscipline({ systemPrompt, on, teamProjectOf, diag, newId }) {
	const disposers = [];
	// 团队会话 = 自己在账本里（PMO 宿主 / 已绑定成员），或父会话在账本里。后者覆盖两种情况：
	// 成员激活时的第一个回合（提示词组装早于账本记下 sessionId，r36 实测成员首窗缺纪律段），
	// 以及 PMO / 成员派生的临时子智能体（il2c：PMO 派生的 moyuan-tail267 承担了整个波尾）。
	const projectFor = (sessionId, parentId) => {
		if (typeof sessionId !== 'string') return null;
		return teamProjectOf(sessionId) ?? (typeof parentId === 'string' && parentId !== '' ? teamProjectOf(parentId) : null);
	};
	const parentOf = (holder) => holder?.session?.header?.parentSession ?? holder?.header?.parentSession;
	if (typeof systemPrompt?.section === 'function') {
		let order = 600;
		try { order = systemPrompt.getSectionOrder?.('TEAM_POLICY') ?? order; } catch { /* 旧宿主没有这个命名位置 */ }
		disposers.push(systemPrompt.section({
			name: 'ai-team:team-discipline',
			order,
			interpolate: false,
			text: (context) => (projectFor(context?.agent?.id, parentOf(context?.agent)) !== null ? TEAM_DISCIPLINE_TEXT : ''),
		}));
	} else {
		diag?.append?.({ ev: 'team.discipline.section.unavailable.fail' });
	}
	/** 每个团队会话本回合最后一条助手回复。 */
	const lastText = new Map();
	/** 本回合已纠偏过的会话（sessionId → turn）。 */
	const steered = new Map();
	/** @param {{ id?: string, header?: { parentSession?: string } }} session 宿主 session/event 的会话 */
	const observe = (session, event) => {
		const sessionId = session?.id;
		if (typeof sessionId !== 'string') return;
		if (event?.type === 'turn/start') {
			lastText.delete(sessionId);
			return;
		}
		if (event?.type !== 'assistant/message' || projectFor(sessionId, parentOf(session)) === null) return;
		const content = event?.data?.message?.content;
		const text = (Array.isArray(content) ? content : [])
			.map((block) => (block?.type === 'text' ? block.text : ''))
			.filter(Boolean)
			.join('\n');
		if (text !== '') lastText.set(sessionId, text);
	};
	const stopping = async (payload) => {
		const agent = payload?.agent;
		const sessionId = agent?.id;
		if (typeof sessionId !== 'string' || typeof agent?.steer !== 'function') return;
		const project = projectFor(sessionId, parentOf(agent));
		if (project === null || project.stopped === true) return;
		if (steered.get(sessionId) === payload?.turn) return;
		const hit = detectDeferral(lastText.get(sessionId));
		if (hit === null) return;
		steered.set(sessionId, payload?.turn);
		try {
			agent.steer({
				id: newId(),
				role: 'user',
				content: [{ type: 'text', text: deferralCorrection(hit.phrase) }],
				source: { kind: 'ai-team' },
			});
			diag?.append?.({ ev: 'team.deferral.steered', projectId: project.projectId, sessionId, turn: payload?.turn ?? null, phrase: hit.phrase });
		} catch (error) {
			diag?.append?.({ ev: 'team.deferral.steer.fail', projectId: project.projectId, sessionId, message: error?.message ?? String(error) });
		}
	};
	if (typeof on === 'function') disposers.push(on('agent/turn-stopping', stopping));
	return {
		observe,
		stopping,
		dispose: () => {
			for (const dispose of disposers.splice(0)) {
				try { dispose?.(); } catch { /* already disposed */ }
			}
			lastText.clear();
			steered.clear();
		},
	};
}

/** 纠偏消息：同一回合最多一次，给出明确的「例外」出口，防止与真实钟点任务死磕。 */
export function deferralCorrection(phrase) {
	return [
		`【文渊阁·推进纪律】你刚才把行动推迟到了一个自然时间点：「${phrase}」。`,
		'团队工作不等钟点：',
		'1. 能现在做的，现在就做。定时任务、夜间环只是兜底；要用它的结果，就现在手动跑一次，并读退出码和日志。',
		'2. 在等别人交付或外部进程，就现在开始盯：说清隔多久查一次、最多盯多久，到时没结果就升级或换路。',
		'3. 只有事情本身依赖真实时钟（对方约定的时间、定时发布）才可以等，并用一句话写明依赖的是什么。',
		'现在继续：要么立即执行，要么给出持续盯的安排，要么写明真实的时钟依赖。',
	].join('\n');
}
