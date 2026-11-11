/**
 * chatGate 自动收敛规划（纯函数，便于测试）：
 * 项目「Human 对话」开关变更后，成员会话的 header（是否带 parentSession）
 * 在创建时固定，必须重建会话才能让新门状态生效。本函数决定本轮应该重建
 * 哪些成员：
 *   - 只挑**空闲**成员（live agent 状态不是 running / 或会话已冷）——绝不打断
 *     进行中的回合；
 *   - 每轮最多 `limit` 个，渐进收敛，避免 6 个成员同时激活造成回合风暴；
 *   - 忙碌成员不出现在 reseat 列表里，调用方保持「未收敛」状态，下轮再试。
 *
 * @param {Array<{id:string, sessionId:string|null, status?:string}>} members
 * @param {(sessionId:string) => string|null} liveAgentStatus 宿主 agent 状态查询（null=冷会话/已释放）
 * @param {{limit?:number}} [options]
 * @returns {{reseat: Array, busy: Array, cold: Array}}
 */
export function planChatGateReseats(members, liveAgentStatus, options = {}) {
	const limit = Math.max(1, Number.isSafeInteger(options.limit) ? options.limit : 2);
	const reseat = [];
	const busy = [];
	const cold = [];
	for (const member of members) {
		if (member === null || member === undefined) continue;
		if (member.status === 'retired') continue;
		const sessionId = typeof member.sessionId === 'string' && member.sessionId !== '' ? member.sessionId : null;
		if (sessionId === null) {
			// 从未激活：下次激活自然读当前门状态，无需重建。
			cold.push(member.id);
			continue;
		}
		const live = liveAgentStatus(sessionId);
		if (live === 'running') {
			busy.push(member.id);
			continue;
		}
		reseat.push(member.id);
	}
	return { reseat: reseat.slice(0, limit), busy, cold };
}
