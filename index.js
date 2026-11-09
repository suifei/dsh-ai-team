/**
 * dsh-agent-team — Host half (M1 spike).
 *
 * Serves the workbench bootstrap payload over the same-origin web carrier.
 * The real Team service (ledger + domain + member runtime) will replace the
 * mock payload in later tasks; this file exists first to validate that the
 * bundle installs, the Host route is reachable, and the Client workbench can
 * render against it.
 */
export const name = 'agent-team';

/** The workbench only makes sense where the Web carrier exists. */
export const inject = ['webServer'];

const MOCK = {
	projects: [
		{ id: 'prj_main', name: 'Main-Dev', goal: '把这次回归清干净', owner: '沈舟', active: true },
		{ id: 'prj_bug', name: 'Bug-Check-Fix', goal: '排查 issue 与后续修复', owner: '沈舟', active: false },
		{ id: 'prj_ui', name: 'UI-UX-AX', goal: '工作台体验与可访问性', owner: '顾言', active: false },
	],
	agents: [
		{ id: 'mem_shenzhou', name: '沈舟', role: '架构 · 项目 owner', status: 'running', color: 0 },
		{ id: 'mem_linlan', name: '林岚', role: '研究 · 验收', status: 'idle', color: 1 },
		{ id: 'mem_chenmo', name: '陈默', role: '产品 · 验收', status: 'idle', color: 2 },
		{ id: 'mem_guyan', name: '顾言', role: 'UI/UX', status: 'idle', color: 3 },
	],
	stream: [
		{
			id: 'str_1', seq: 1, kind: 'human_message', at: Date.now() - 12 * 60_000,
			author: { kind: 'human', name: '你' },
			body: '把这次回归里失败的三条都修了，谁该看谁看。',
		},
		{
			id: 'str_2', seq: 2, kind: 'task_card', at: Date.now() - 11 * 60_000,
			author: { kind: 'agent', name: '沈舟' },
			body: '拆成 5 项，2 项互相依赖。我先复现，其余并行。',
			taskIds: ['tsk_11', 'tsk_12', 'tsk_13', 'tsk_14', 'tsk_15'],
		},
	],
	tasks: [
		{ id: 'tsk_11', number: 11, title: '复现三条失败的用例，界定影响面与不修什么', status: 'in_progress', owner: '沈舟', assignee: '沈舟', replies: 2, following: true, blockedBy: [] },
		{ id: 'tsk_12', number: 12, title: '登录超时：先加锁再断言，见 upload.ts:88', status: 'pending', owner: '沈舟', assignee: null, replies: 0, following: true, blockedBy: [] },
		{ id: 'tsk_13', number: 13, title: '上传 413：前端表单与后端限制不一致', status: 'pending', owner: '沈舟', assignee: null, replies: 0, following: true, blockedBy: ['tsk_12'] },
		{ id: 'tsk_14', number: 14, title: '回归门禁：复跑 build 与 browser 8/8', status: 'pending', owner: '林岚', assignee: null, replies: 0, following: false, blockedBy: [] },
		{ id: 'tsk_15', number: 15, title: '把修法写成可复核的验收证据', status: 'pending', owner: '陈默', assignee: null, replies: 0, following: false, blockedBy: [] },
	],
	thread: {
		taskId: 'tsk_11',
		headSeq: 3,
		entries: [
			{ seq: 1, author: '沈舟', at: Date.now() - 10 * 60_000, body: '先复现，再判断是不是同一个根因。' },
			{ seq: 2, author: '林岚', at: Date.now() - 9 * 60_000, body: '我这边跑到第二条就复现了，日志在 /tmp/regression-2.log。' },
			{ seq: 3, author: '沈舟', at: Date.now() - 8 * 60_000, body: '收到，把第三条也跑一遍，我加锁修。' },
		],
	},
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
	status,
	headers: {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	},
});

/**
 * @param ctx - Host context; the workbench requires the web carrier.
 */
export function apply(ctx) {
	ctx.effect(() => {
		const webServer = ctx.get('webServer');
		if (webServer === undefined) return () => {};
		const dispose = webServer.register({
			kind: 'prefix',
			path: '/agent-team',
			resource: async (request) => {
				const url = new URL(request.url, 'http://local');
				if (request.method === 'GET' && url.pathname === '/agent-team/api/health') {
					return json({ ok: true, plugin: name, version: '0.1.0' });
				}
				if (request.method === 'GET' && url.pathname === '/agent-team/api/bootstrap') {
					return json(MOCK);
				}
				return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
			},
		});
		return () => dispose();
	}, 'agent-team: spike routes');
}
