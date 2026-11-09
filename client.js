/**
 * dsh-agent-team — Client half (M1 spike).
 *
 * A three-pane project workbench rendered inside the DSH `main` slot:
 *   left  = projects + agents (global inbox / board entries)
 *   center= project header + 主对话 / 看板 tabs + composer
 *   right = task thread panel
 *
 * This is a visual/contract spike: it fetches `/agent-team/api/bootstrap`
 * from the Host half and falls back to embedded mock data so the panel can
 * still be inspected when the route is not ready. The real client will read
 * SSE projections and post commands; this file is intentionally dependency
 * free (React comes from the host module table).
 */
window.__ModuleLoader__.load({
	id: '@suifei/dsh-agent-team',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const NS = 'agentTeam';
		const PKG = '@suifei/dsh-agent-team';

		const zh = {
			panel: '班组',
			back: '对话',
			inbox: '收件箱',
			board: '任务看板',
			projects: '项目',
			agents: 'Agents',
			main: '主对话',
			boardTab: '看板',
			composer: '写一条消息…',
			discuss: '讨论',
			taskMode: '任务',
			send: '发送',
			thread: '讨论',
			unfollow: '取消关注',
			convert: '转为 Task',
			reply: '回复此 Thread…',
			owner: '负责人',
			unassigned: '未指派',
			blocked: '受阻',
			replies: '条回复',
			empty: '还没有 Task',
			loading: '加载中…',
			error: '工作台数据加载失败，已使用本地演示数据。',
			todo: '待处理',
			doing: '进行中',
			accept: '待验收',
			done: '已完成',
		};
		const en = {
			panel: 'Agent Team',
			back: 'Chat',
			inbox: 'Inbox',
			board: 'Board',
			projects: 'Projects',
			agents: 'Agents',
			main: 'Main stream',
			boardTab: 'Board',
			composer: 'Write a message…',
			discuss: 'Discuss',
			taskMode: 'Task',
			send: 'Send',
			thread: 'Thread',
			unfollow: 'Unfollow',
			convert: 'Convert to Task',
			reply: 'Reply to this thread…',
			owner: 'Owner',
			unassigned: 'Unassigned',
			blocked: 'Blocked',
			replies: 'replies',
			empty: 'No tasks yet',
			loading: 'Loading…',
			error: 'Failed to load the workbench; showing local demo data.',
			todo: 'Todo',
			doing: 'In progress',
			accept: 'In review',
			done: 'Done',
		};

		const MOCK = {
			projects: [
				{ id: 'prj_main', name: 'Main-Dev', owner: '沈舟', active: true },
				{ id: 'prj_bug', name: 'Bug-Check-Fix', owner: '沈舟', active: false },
				{ id: 'prj_ui', name: 'UI-UX-AX', owner: '顾言', active: false },
			],
			agents: [
				{ id: 'a1', name: '沈舟', role: '架构 · 项目 owner', status: 'running' },
				{ id: 'a2', name: '林岚', role: '研究 · 验收', status: 'idle' },
				{ id: 'a3', name: '陈默', role: '产品 · 验收', status: 'idle' },
				{ id: 'a4', name: '顾言', role: 'UI/UX', status: 'idle' },
			],
			stream: [
				{ id: 's1', seq: 1, kind: 'human_message', author: { kind: 'human', name: '你' }, body: '把这次回归里失败的三条都修了，谁该看谁看。' },
				{ id: 's2', seq: 2, kind: 'task_card', author: { kind: 'agent', name: '沈舟' }, body: '拆成 5 项，2 项互相依赖。我先复现，其余并行。', taskIds: ['t11', 't12', 't13', 't14', 't15'] },
			],
			tasks: [
				{ id: 't11', number: 11, title: '复现三条失败的用例，界定影响面与不修什么', status: 'in_progress', owner: '沈舟', assignee: '沈舟', replies: 2, following: true, blockedBy: [] },
				{ id: 't12', number: 12, title: '登录超时：先加锁再断言，见 upload.ts:88', status: 'pending', owner: '沈舟', assignee: null, replies: 0, following: true, blockedBy: [] },
				{ id: 't13', number: 13, title: '上传 413：前端表单与后端限制不一致', status: 'pending', owner: '沈舟', assignee: null, replies: 0, following: true, blockedBy: ['t12'] },
				{ id: 't14', number: 14, title: '回归门禁：复跑 build 与 browser 8/8', status: 'pending', owner: '林岚', assignee: null, replies: 0, following: false, blockedBy: [] },
				{ id: 't15', number: 15, title: '把修法写成可复核的验收证据', status: 'pending', owner: '陈默', assignee: null, replies: 0, following: false, blockedBy: [] },
			],
			thread: {
				taskId: 't11',
				entries: [
					{ seq: 1, author: '沈舟', body: '先复现，再判断是不是同一个根因。' },
					{ seq: 2, author: '林岚', body: '我这边跑到第二条就复现了，日志在 /tmp/regression-2.log。' },
					{ seq: 3, author: '沈舟', body: '收到，把第三条也跑一遍，我加锁修。' },
				],
			},
		};

		const STATUS = {
			pending: { label: 'todo', tone: 'idle' },
			in_progress: { label: 'doing', tone: 'business' },
			pending_acceptance: { label: 'accept', tone: 'warn' },
			done: { label: 'done', tone: 'success' },
			cancelled: { label: 'done', tone: 'idle' },
		};

		const CSS = `
			.at-root { height: 100%; min-height: 0; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-family: var(--dsw-font-family); container-type: inline-size; }
			.at-root *, .at-root *::before, .at-root *::after { box-sizing: border-box; }
			.at-top { height: 40px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-tertiary); font-size: 12px; }
			.at-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 236px minmax(0, 1fr) 372px; }
			.at-left { min-width: 0; border-right: 1px solid var(--dsw-alias-border-l1); padding: 8px 8px 12px; overflow: auto; }
			.at-center { min-width: 0; display: flex; flex-direction: column; min-height: 0; }
			.at-right { min-width: 0; border-left: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; min-height: 0; }
			.at-nav { display: flex; flex-direction: column; gap: 1px; }
			.at-navrow { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
			.at-navrow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-navrow.at-on { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
			.at-navrow .at-count { margin-left: auto; color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
			.at-h { display: flex; align-items: center; gap: 6px; padding: 10px 6px 4px; color: var(--dsw-alias-label-caption); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
			.at-tree { display: flex; flex-direction: column; gap: 1px; }
			.at-prow { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 6px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; cursor: pointer; }
			.at-prow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-prow.at-on { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
			.at-hash { color: var(--dsw-alias-label-caption); font-weight: 500; }
			.at-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); flex: 0 0 auto; }
			.at-dot.at-running { background: var(--dsw-alias-state-business-primary); }
			.at-agent { display: flex; gap: 7px; align-items: flex-start; padding: 6px; border-radius: 6px; }
			.at-agent:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-avatar { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; flex: 0 0 auto; color: #fff; font-size: 11px; font-weight: 600; background: var(--dsw-alias-state-business-primary); }
			.at-avatar:nth-child(3n) { background: var(--dsw-alias-state-done-primary); }
			.at-agentmeta { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
			.at-agentname { color: var(--dsw-alias-label-primary); font-size: 12.5px; }
			.at-agentrole { color: var(--dsw-alias-label-caption); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-chead { flex: 0 0 auto; padding: 14px 18px 0; }
			.at-title { display: flex; align-items: baseline; gap: 8px; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
			.at-goal { color: var(--dsw-alias-label-tertiary); font-size: 12px; margin-top: 2px; }
			.at-tabs { display: flex; gap: 4px; margin-top: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-tab { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12.5px; padding: 7px 10px 8px; cursor: pointer; border-bottom: 2px solid transparent; }
			.at-tab.at-on { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-label-primary); }
			.at-stream { flex: 1; min-height: 0; overflow: auto; padding: 14px 18px 8px; display: flex; flex-direction: column; gap: 14px; }
			.at-msg { display: flex; gap: 8px; align-items: flex-start; }
			.at-msg .at-avatar { width: 24px; height: 24px; border-radius: 8px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 11px; }
			.at-msg.at-human .at-avatar { background: var(--dsw-alias-state-business-primary); color: #fff; }
			.at-msgb { min-width: 0; flex: 1; }
			.at-msgh { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
			.at-msgh b { color: var(--dsw-alias-label-primary); font-weight: 550; }
			.at-msgt { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
			.at-cardgroup { margin-left: 32px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
			.at-grouphead { padding: 10px 12px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-card { padding: 10px 12px; display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--dsw-alias-border-l1); cursor: pointer; }
			.at-card:first-child { border-top: 0; }
			.at-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-card.at-sel { background: var(--dsw-alias-button-ghost-active-fill); }
			.at-crow { display: flex; align-items: center; gap: 7px; }
			.at-num { color: var(--dsw-alias-label-caption); font-size: 11px; font-variant-numeric: tabular-nums; }
			.at-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-3); }
			.at-pill.at-business { color: var(--dsw-alias-state-business-primary); }
			.at-pill.at-warn { color: var(--dsw-alias-state-warn-label); }
			.at-pill.at-success { color: var(--dsw-alias-state-success-primary); }
			.at-replies { margin-left: auto; color: var(--dsw-alias-label-caption); font-size: 10.5px; }
			.at-ct { color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 1.45; }
			.at-cm { display: flex; gap: 8px; align-items: center; color: var(--dsw-alias-label-caption); font-size: 11px; }
			.at-composer { flex: 0 0 auto; padding: 10px 18px 14px; }
			.at-box { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); padding: 8px 9px; }
			.at-box textarea { width: 100%; min-height: 38px; max-height: 120px; resize: none; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
			.at-barrow { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
			.at-mode { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; overflow: hidden; }
			.at-mode button { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11.5px; padding: 4px 8px; cursor: pointer; }
			.at-mode button.at-on { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
			.at-send { margin-left: auto; border: 0; border-radius: 7px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-bg-base); font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer; }
			.at-rhead { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-rh { min-width: 0; flex: 1; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-rbtn { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 6px; font: inherit; font-size: 11px; padding: 3px 7px; cursor: pointer; white-space: nowrap; }
			.at-rbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-rbody { flex: 1; min-height: 0; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
			.at-tmsg { display: flex; flex-direction: column; gap: 2px; }
			.at-tmh { display: flex; gap: 6px; align-items: baseline; color: var(--dsw-alias-label-caption); font-size: 10.5px; }
			.at-tmh b { color: var(--dsw-alias-label-secondary); font-weight: 550; }
			.at-tmt { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
			.at-rfoot { flex: 0 0 auto; padding: 8px 10px 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
			.at-empty { color: var(--dsw-alias-label-caption); font-size: 12px; padding: 18px; }
			.at-banner { margin: 8px 18px 0; padding: 6px 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-warn-label); font-size: 11px; }
			@container (max-width: 980px) { .at-grid { grid-template-columns: 210px minmax(0, 1fr); } .at-right { display: none; } }
			@container (max-width: 700px) { .at-grid { grid-template-columns: minmax(0, 1fr); } .at-left { display: none; } }
		`;

		const Ico = ({ name }) => {
			const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' };
			if (name === 'inbox') return h('svg', common, h('path', { d: 'M2.5 9.5h3l1 1.5h3l1-1.5h3' }), h('path', { d: 'M2.5 9.5V4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v5' }));
			if (name === 'board') return h('svg', common, h('rect', { x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }), h('path', { d: 'M6 3.5v9M10 3.5v9' }));
			if (name === 'chev') return h('svg', common, h('path', { d: 'M6 3.5 10.5 8 6 12.5' }));
			if (name === 'loop') return h('svg', { width: 18, height: 18, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true' }, h('rect', { x: 2.5, y: 5.5, width: 21, height: 21, rx: 6.5, stroke: 'currentColor', strokeWidth: 2.6 }), h('circle', { cx: 23.5, cy: 16, r: 4.8, fill: '#5686fe' }));
			return null;
		};

		const fmtTime = (at) => {
			try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
		};

		class Boundary extends React.Component {
			constructor(props) { super(props); this.state = { error: null }; }
			static getDerivedStateFromError(error) { return { error }; }
			render() {
				if (this.state.error === null) return this.props.children;
				return h('div', { style: { padding: 16, color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, String(this.state.error?.message ?? this.state.error));
			}
		}

		function Workbench({ t, ctx }) {
			const [data, setData] = React.useState(MOCK);
			const [projectId, setProjectId] = React.useState(MOCK.projects[0].id);
			const [tab, setTab] = React.useState('main');
			const [selected, setSelected] = React.useState('t11');
			const [threadOpen, setThreadOpen] = React.useState(true);
			const [mode, setMode] = React.useState('discuss');
			const [draft, setDraft] = React.useState('');
			const [note, setNote] = React.useState('');

			React.useEffect(() => {
				let alive = true;
				fetch('/agent-team/api/bootstrap', { headers: { accept: 'application/json' } })
					.then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
					.then((next) => { if (alive && next && Array.isArray(next.tasks)) setData(next); })
					.catch(() => { /* keep local demo data */ });
				return () => { alive = false; };
			}, []);

			const project = data.projects.find((p) => p.id === projectId) ?? data.projects[0];
			const tasks = data.tasks;
			const selectedTask = tasks.find((x) => x.id === selected) ?? tasks[0];

			function send() {
				if (!draft.trim()) return;
				setNote(mode === 'task' ? 'spike：任务模式会直接建卡（待接命令）' : 'spike：讨论会发给项目 owner（待接命令）');
				setDraft('');
			}
			function goConversation() {
				try { ctx?.layout?.selectPanel?.('conversation'); } catch { /* not available in this host */ }
			}

			return h('div', { className: 'at-root' },
				h('div', { className: 'at-top' }, h('button', { className: 'at-rbtn', type: 'button', onClick: goConversation }, '‹ ' + t('back')), h('span', null, t('panel')), h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-caption)' } }, project?.name ?? '')),
				h('div', { className: 'at-grid' },
					h('aside', { className: 'at-left' },
						h('div', { className: 'at-nav' },
							h('button', { className: 'at-navrow', type: 'button' }, h(Ico, { name: 'inbox' }), t('inbox'), h('span', { className: 'at-count' }, '3')),
							h('button', { className: 'at-navrow', type: 'button' }, h(Ico, { name: 'board' }), t('board')),
						),
						h('div', { className: 'at-h' }, t('projects')),
						h('div', { className: 'at-tree' }, data.projects.map((p) => h('div', { key: p.id, className: 'at-prow' + (p.id === projectId ? ' at-on' : ''), onClick: () => setProjectId(p.id), role: 'button', tabIndex: 0 }, h('span', { className: 'at-hash' }, '#'), p.name))),
						h('div', { className: 'at-h' }, t('agents')),
						h('div', null, data.agents.map((a) => h('div', { key: a.id, className: 'at-agent' },
							h('div', { className: 'at-avatar' }, a.name.slice(0, 1)),
							h('div', { className: 'at-agentmeta' }, h('div', { className: 'at-agentname' }, a.name), h('div', { className: 'at-agentrole' }, a.role)),
							h('div', { className: 'at-dot' + (a.status === 'running' ? ' at-running' : ''), title: a.status }),
						))),
					),
					h('main', { className: 'at-center' },
						h('div', { className: 'at-chead' },
							h('div', { className: 'at-title' }, '# ' + (project?.name ?? 'Project')),
							h('div', { className: 'at-goal' }, project?.goal ?? '—'),
							h('div', { className: 'at-tabs' },
								h('button', { className: 'at-tab' + (tab === 'main' ? ' at-on' : ''), type: 'button', onClick: () => setTab('main') }, t('main')),
								h('button', { className: 'at-tab' + (tab === 'board' ? ' at-on' : ''), type: 'button', onClick: () => setTab('board') }, t('boardTab')),
							),
						),
						note === '' ? null : h('div', { className: 'at-banner' }, note),
						tab === 'main' ? h('div', { className: 'at-stream' },
							data.stream.map((item) => item.kind === 'human_message'
								? h('div', { key: item.id, className: 'at-msg at-human' }, h('div', { className: 'at-avatar' }, '你'), h('div', { className: 'at-msgb' }, h('div', { className: 'at-msgh' }, h('b', null, '你'), h('span', null, fmtTime(item.at))), h('div', { className: 'at-msgt' }, item.body)))
								: h('div', { key: item.id, className: 'at-msg' }, h('div', { className: 'at-avatar' }, '沈'), h('div', { className: 'at-msgb' }, h('div', { className: 'at-msgh' }, h('b', null, item.author?.name ?? 'owner'), h('span', null, fmtTime(item.at))), h('div', { className: 'at-msgt' }, item.body),
									h('div', { className: 'at-cardgroup' },
										(item.taskIds ?? []).map((id, i) => {
											const card = tasks.find((x) => x.id === id);
											if (!card) return null;
											const st = STATUS[card.status] ?? STATUS.pending;
											return h('div', { key: card.id, className: 'at-card' + (selected === card.id ? ' at-sel' : ''), onClick: () => { setSelected(card.id); setThreadOpen(true); } },
												h('div', { className: 'at-crow' }, h('span', { className: 'at-num' }, 'Task #' + card.number), h('span', { className: 'at-pill at-' + st.tone }, t(st.label)), card.blockedBy?.length ? h('span', { className: 'at-pill at-warn' }, '⛔ ' + t('blocked')) : null, h('span', { className: 'at-replies' }, String(card.replies) + ' ' + t('replies'))),
												h('div', { className: 'at-ct' }, card.title),
												h('div', { className: 'at-cm' }, h('span', null, t('owner') + ' ' + card.owner), h('span', null, card.assignee ? '· ' + card.assignee : '· ' + t('unassigned')), card.following ? h('span', { style: { marginLeft: 'auto' } }, '★') : null),
											);
										}),
									)))
								),
) : h('div', { className: 'at-stream' },
							h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, alignItems: 'start' } },
								['pending', 'in_progress', 'pending_acceptance', 'done'].map((status) => h('div', { key: status, style: { minWidth: 0, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 8 } },
									h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption)', margin: '2px 2px 8px' } }, t(STATUS[status].label) + ' ' + String(tasks.filter((x) => x.status === status).length)),
									tasks.filter((x) => x.status === status).map((card) => h('div', { key: card.id, className: 'at-card', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, marginBottom: 6 }, onClick: () => { setSelected(card.id); setThreadOpen(true); setTab('main'); } },
										h('div', { className: 'at-crow' }, h('span', { className: 'at-num' }, 'Task #' + card.number), h('span', { className: 'at-pill at-' + (STATUS[card.status]?.tone ?? 'idle') }, t(STATUS[card.status]?.label ?? 'todo'))),
										h('div', { className: 'at-ct', style: { fontSize: 12 } }, card.title),
										h('div', { className: 'at-cm', style: { fontSize: 10.5 } }, t('owner') + ' ' + card.owner, ' · ', card.assignee ?? t('unassigned')),
									)),
								)),
							),
						),
						h('div', { className: 'at-composer' },
							h('div', { className: 'at-box' },
								h('textarea', { value: draft, placeholder: t('composer'), onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } }),
								h('div', { className: 'at-barrow' },
									h('div', { className: 'at-mode' },
										h('button', { className: mode === 'discuss' ? 'at-on' : '', type: 'button', onClick: () => setMode('discuss') }, t('discuss')),
										h('button', { className: mode === 'task' ? 'at-on' : '', type: 'button', onClick: () => setMode('task') }, t('taskMode')),
									),
									h('button', { className: 'at-send', type: 'button', onClick: send }, t('send')),
								),
							),
						),
					),
					threadOpen ? h('aside', { className: 'at-right' },
						h('div', { className: 'at-rhead' },
							h('div', { className: 'at-rh' }, t('thread') + ' · #' + (selectedTask?.number ?? '')),
							h('button', { className: 'at-rbtn', type: 'button' }, t('unfollow')),
							h('button', { className: 'at-rbtn', type: 'button' }, t('convert')),
						),
						h('div', { className: 'at-rbody' },
							(data.thread?.entries ?? []).map((m) => h('div', { key: m.seq, className: 'at-tmsg' },
								h('div', { className: 'at-tmh' }, h('b', null, m.author), h('span', null, m.body ? fmtTime(Date.now() - (4 - m.seq) * 60_000) : '')),
								h('div', { className: 'at-tmt' }, m.body),
							)),
						),
						h('div', { className: 'at-rfoot' }, h('div', { className: 'at-box' }, h('textarea', { placeholder: t('reply'), rows: 2 }))),
					) : null,
				),
			);
		}

		function PanelIcon() {
			return h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'inherit' } }, h(Ico, { name: 'loop' }));
		}

		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.dataset.plugin = PKG;
				tag.textContent = CSS;
				document.head.append(tag);
				return () => tag.remove();
			}, `${PKG}: styles`);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PKG}: locale`);
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
				name: 'sidebar.panellist', id: 'ai-team', order: 25, label: () => ctx.locale.bind(NS)('panel'),
			}, PanelIcon));
			ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'ai-team' }, () => h(Boundary, null, h(Workbench, { t, ctx }))));
			console.log(`${PKG}: client spike applied`);
		}

		return { inject: ['slots', 'locale'], apply };
	},
});
