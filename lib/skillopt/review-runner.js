/**
 * 评审执行：把 A/B 盲评投递给**专用评审成员**，从评审卡的 thread 回帖收票。
 *
 * 通道依据：`member.message`（Human→成员）会写账本并触发 waker 唤醒成员，
 * 这是插件既有且长期运行的通道（wake.delivered 数千次）。评审成员被要求在
 * 回复里用 team 工具把一行 JSON 发到评审卡；插件读 `state.threads[taskId]`
 * 的条目即可拿到 verdict，**不依赖一次性子代理的输出**。
 */
import { REVIEWER_NAME, REVIEWER_ROLE, buildReviewRequest, decideReviewVotes, reviewVoteCount } from './reviewer.js';

const REVIEW_TASK_PREFIX = 'skillopt-review';

/** 在项目里查/建专用评审成员。返回 member 投影。 */
export async function ensureReviewer({ service, projectRuntime, actor }) {
	const members = Object.values(service.state.members ?? {});
	const existing = members.find((member) => member.kind === 'agent' && (member.role === REVIEWER_ROLE || member.name === REVIEWER_NAME));
	if (existing !== undefined) return existing;
	const created = await service.addMember(
		{ actor, projectId: projectRuntime.id },
		{
			name: REVIEWER_NAME,
			kind: 'agent',
			role: REVIEWER_ROLE,
			personality: '你只做独立盲评：按 Darwin 9 维 rubric 比较两个版本，只输出一行 JSON 结论；不接任务、不改文件。',
			status: 'idle',
		},
	);
	return created?.member ?? service.state.members?.[created?.member?.id ?? ''];
}

/** 创建评审卡（task）并投递 N 条盲评请求给评审成员。 */
export async function startReview({ service, projectRuntime, job, actor, votes }) {
	const reviewer = await ensureReviewer({ service, projectRuntime, actor });
	if (reviewer === undefined || reviewer === null) throw new Error('reviewer member unavailable');
	const count = reviewVoteCount(votes ?? 3);
	const taskTitle = `${REVIEW_TASK_PREFIX} ${job.id}`;
	const created = await service.dispatch({
		type: 'task.create',
		payload: {
			title: taskTitle,
			description: `Darwin paired review for ${job.skillName ?? job.skillPath} (job ${job.id})`,
			ownerId: reviewer.id,
			// 评审卡的验收标准：一行 JSON verdict（better/margin/reason）。
			resultDefinition: '回复一行 JSON（better=A|B|tie、margin=clear|slight、reason=一句话理由），不修改任何文件。',
			kind: 'review',
		},
		actor,
		projectId: projectRuntime.id,
	});
	const reviewTaskId = created?.task?.id ?? created?.id ?? null;
	if (typeof reviewTaskId !== 'string') throw new Error('review card creation failed');
	const orders = [];
	for (let index = 0; index < count; index++) {
		const order = Math.random() < 0.5 ? 'ab' : 'ba';
		// 每一票带独立 orderId：投递顺序与回帖顺序无关，靠 id 才能把票对应回
		// 该票的 A/B 顺序；否则一次乱序/重复回帖就会整票移位甚至反转 keep/revert。
		const orderId = `v${index + 1}`;
		const body = buildReviewRequest({ before: job.before, after: job.candidate, order, jobId: job.id, taskId: reviewTaskId, baseSeq: 0, orderId });
		await service.dispatch({
			type: 'member.message',
			payload: { memberId: reviewer.id, body },
			actor,
			projectId: projectRuntime.id,
		});
		orders.push({ orderId, order, aIsAfter: order === 'ba' });
	}
	return { reviewTaskId, reviewerId: reviewer.id, orders };
}

/** 收票并判多数决。 */
export function collectReview({ service, job }) {
	const thread = service.state.threads?.[job.reviewTaskId];
	const entries = Array.isArray(thread?.entries) ? thread.entries : [];
	const reviewerId = job.reviewerId;
	const orders = Array.isArray(job.reviewOrders) ? job.reviewOrders : [];
	const byOrderId = new Map(orders.filter((order) => typeof order?.orderId === 'string').map((order) => [order.orderId, order]));
	const used = new Set();
	const votes = [];
	for (const entry of entries) {
		if (votes.length >= orders.length) break;
		if (entry?.authorId !== reviewerId) continue;
		const parsed = (() => {
			try {
				const match = String(entry.body ?? '').match(/\{[\s\S]*?"better"[\s\S]*?\}/);
				return match === null ? null : JSON.parse(match[0]);
			} catch {
				return null;
			}
		})();
		if (parsed === null || (parsed.better !== 'A' && parsed.better !== 'B' && parsed.better !== 'tie')) continue;
		let order = typeof parsed.orderId === 'string' ? byOrderId.get(parsed.orderId) : undefined;
		// 旧 job 的 orders 没有 orderId：保留按序对齐的兼容路径，但仍受票数上限约束。
		if (order === undefined && typeof parsed.orderId !== 'string' && byOrderId.size === 0) {
			order = orders[votes.length];
		}
		if (order === undefined) continue;
		const key = order.orderId ?? `#${votes.length}`;
		if (used.has(key)) continue; // 同一票重复回帖只计一次
		used.add(key);
		votes.push({
			better: parsed.better,
			margin: parsed.margin === 'clear' ? 'clear' : 'slight',
			reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
			aIsAfter: order?.aIsAfter === true,
		});
	}
	return { votes, decision: decideReviewVotes(votes), expected: orders.length };
}
