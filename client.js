/**
 * dsh-ai-team — Client half (M1 spike, 04/D refined).
 *
 * A three-pane project workbench rendered inside the DSH `main` slot:
 *   left  = page nav + Project tree + Agents
 *   center= project header + 主对话 / 看板 / 态势 tabs + composer
 *   right = Task Thread panel (discussion, acceptance, done receipt)
 *
 * UI references: docs/04 §4–§7/§10, docs/appendix/D §2–§3, docs/07 §4–§6.
 * This is a read-only visual/contract spike: it reads
 * `/ai-team/api/bootstrap`, falls back to embedded demo data, and every
 * write action only produces local feedback. The registration contract
 * (`sidebar.panellist` id `ai-team`, `main` key `ai-team`) is unchanged.
 *
 * Colors come from `--dsw-alias-*` only; radii/font steps from host tokens.
 */
window.__ModuleLoader__.load({
	id: '@suifei/dsh-ai-team',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const NS = 'agentTeam';
		const PKG = '@suifei/dsh-ai-team';

		const zh = {
			panel: '班组',
			back: '对话',
			inbox: '收件箱',
			board: '任务看板',
			projects: '项目',
			agents: 'Agents',
			main: '主对话',
			boardTab: '看板',
			tabSituation: '态势',
			tabsAria: '项目视图',
			composer: '写一条消息…',
			taskPlaceholder: '一句话任务，可稍后补完判据',
			discuss: '讨论',
			taskMode: '任务',
			send: '发送',
			createTask: '创建 Task',
			enterHint: 'Ctrl/⌘ + Enter 发送',
			thread: '讨论',
			closeThread: '关闭讨论',
			follow: '关注',
			unfollow: '取消关注',
			convert: '转为 Task',
			reply: '回复此 Thread…',
			replyHint: '将基于 #{seq} 发送',
			replyHintNew: '将新建此 Task 的 Thread',
			owner: '负责人',
			executor: '执行',
			unassigned: '未指派',
			blocked: '受阻',
			dependsOn: '依赖',
			replyCount: '{n} 条回复',
			stPending: '待处理',
			stInProgress: '进行中',
			stPendingAcceptance: '待验收',
			stDone: '已完成',
			stCancelled: '已取消',
			agentRunning: '运行中',
			agentIdle: '空闲',
			agentDefaultModel: '默认模型',
			agentFailure: 'LLM 失败：{category} · 第 {n} 次',
			agentFailureShort: '失败',
			agentProvisioning: '正在准备记忆',
			agentFailed: '失败',
			agentRetired: '已退役',
			groupCreated: '新建 {n} 个任务',
			groupBlocked: '{n} 项有依赖',
			groupMore: '展开其余 {n} 项',
			groupLess: '收起其余 {n} 项',
			fromDiscussion: '由讨论升格',
			loading: '加载中…',
			fallbackTitle: '演示数据',
			fallbackBody: 'bootstrap 接口（/ai-team）不可达，已使用内置样例；发送、关注、验收只做本地反馈，不写账本。',
			spike: 'M1 spike',
			spikeTitle: '只读界面演示：发送、关注、验收只产生本地反馈，不写账本。',
			navAria: '页面导航',
			menu: '目录',
			menuAria: '打开项目与成员目录',
			projectsAria: '项目',
			agentsAria: '成员',
			streamAria: '主对话',
			boardAria: '任务看板',
			situationAria: '项目态势',
			threadAria: '任务讨论',
			composerAria: '写一条消息',
			modeAria: '发送模式',
			columnAria: '「{title}」，{n} 项',
			emptyStreamTitle: '说一句话开工',
			emptyStreamBody: '例如：把这次回归里失败的三条都修了。',
			emptyStreamExample: '把这次回归里失败的三条都修了',
			fillExample: '填入示例',
			emptyBoardTitle: '还没有任务',
			emptyBoardBody: '在讨论里说一句，或把一条消息转为 Task。',
			emptyBoardAction: '回到主对话',
			inboxTitle: '收件箱',
			inboxGoal: '跨项目聚合，M1 之后接入',
			inboxEmptyTitle: '收件箱页还没接入',
			inboxEmptyBody: 'M1 spike 只做工作台骨架；决策条目当前在「态势 · 需要你」里展示，未读计数在左栏。',
			inboxEmptyAction: '看任务看板',
			projectEmptyTitle: '还没有项目',
			projectEmptyBody: '创建项目属于 S-01；M1 之后接入。',
			emptyColumn: '暂无',
			expandDone: '展开全部',
			collapseDone: '收起',
			threadEmptyTitle: '还没有消息',
			threadEmptyBody: '先写下完成判据，再开始执行。',
			acceptance: '验收',
			candidate: '候选验收',
			acceptEligible: '你从未认领过该任务，且不是执行者，所以可以由你验收。',
			acceptSteward: '验收请求投给：你（未设 steward，Human 兜底）。',
			irreversibleNote: '此接受后不可撤回（合并 / 发布 / 对外交付）。',
			irreversibleCheck: '我已确认影响，接受后不可撤回',
			acceptCta: '接受并标记完成',
			acceptIrreversibleCta: '接受且不可撤回',
			requestChanges: '要求修改',
			resultSummary: '结果摘要',
			evidence: '证据',
			noEvidence: '还没有证据',
			noSummary: '执行者未提交结果摘要',
			diff: '差异',
			noDiff: '未提供差异',
			taskActions: '任务动作',
			mockOnly: '仅演示，不写账本',
			actCancel: '取消任务',
			actReopen: '重开',
			actReassign: '改派…',
			actHandoff: '交接…',
			actDelete: '删除',
			actionMock: 'spike：{action} 需要二次确认并写账本，命令接入后启用。',
			convertTitle: '转为 Task',
			titleLabel: '标题',
			convertNamePlaceholder: '一句话说清要做什么',
			convertDod: '完成判据',
			convertDodPlaceholder: '怎样算完成：可复核的结果或证据',
			convertContext: '上下文：引用 #{n} 的 {m} 条消息',
			convertCancel: '取消',
			convertSubmit: '创建 Task',
			convertMock: 'spike：将从 #{n} 创建 Task，并带上下文引用（命令未接入）。',
			conflictTitle: '你的回复基于较早的 Thread，已退回',
			conflictNew: 'Thread 已到 #{head}（新增 {n} 条）',
			conflictContinue: '基于最新继续写',
			conflictContext: '查看我当时的上下文',
			conflictContinueMock: 'spike：已把发送基线更新到 #{head}（不写账本）。',
			conflictContextMock: 'spike：将展示你在 #{base} 时的上下文（命令未接入）。',
			replyMock: 'spike：回复将基于 #{seq} 发送并写入账本（命令未接入）。',
			replyMockNew: 'spike：将新建 Thread 并写入回复（命令未接入）。',
			followMock: 'spike：已关注 #{n}（仅本地演示，不写账本）。',
			unfollowMock: 'spike：不关注 #{n}。完成、受阻或需要你决定时仍会出现（仅本地演示）。',
			acceptMock: 'spike：接受 #{n} 将写验收记录并标记完成（命令未接入）。',
			changesMock: 'spike：退回需要至少 10 字原因并写账本（命令未接入）。',
			projectSwitchMock: 'spike：项目切换只更新视图标题；按项目读取账本在 M1 接入。',
			archivedMock: 'spike：归档项目只读；取消归档在 M3 接入。',
			agentMock: 'spike：成员详情（打开会话 / 发消息 / 记忆与技能）在 M3 接入。',
			agentOpen: '查看 {name} 的详情',
			moreActions: '更多操作',
			newProject: '新建项目',
			addAgent: '添加成员',
			newProjectMock: 'spike：新建项目属于 S-01 流程，M1 之后接入。',
			addAgentMock: 'spike：添加成员在 M1 之后接入。',
			addAgentTitle: '添加成员',
			memberName: '名字',
			memberRole: '职责',
			memberPrompt: '初始指令（可选）',
			memberPromptHint: '例如：任务 #1 已待验收，读 tasks 后独立验收。',
			memberProvider: 'Provider',
			memberModel: '模型',
			memberOwner: '设为 Project owner',
			memberCreate: '创建并激活',
			memberAdding: '正在创建…',
			memberAdded: '成员已创建并激活。',
			cancel: '取消',
			memberProfileTitle: '成员资料',
			memberProfileTitleName: '成员资料 · {name}',
			memberProfileMeta: '{status} · 资料 v{version} · 蒸馏 v{distill}',
			memberPersonality: '个性 / 工作方式',
			save: '保存',
			saving: '保存中…',
			redistill: '重新蒸馏',
			leaveTeam: '离开团队',
			leaveConfirm: '离开团队后成员会进入人才库，遗留任务会列出来等待接手。确定？',
			leftTeam: '已进入人才库；遗留任务 {n} 张，等待接手。',
			leftTeamHanded: '已进入人才库；{n} 张遗留任务已交给继承人。',
			successor: '遗留工作交给',
			noSuccessor: '暂不指定（留在看板等待接手）',
			recruited: '已从人才库重新招募。',
			talentPoolCount: '人才库 {n}',
			talentPool: '人才库',
			recruit: '重新招募',
			profileSaved: '成员资料已保存，下一次唤醒生效。',
			profileDistilled: '已重新蒸馏并记录新版本。',
			conversationMock: 'spike：宿主没有可用的 layout.selectPanel(conversation)。',
			discussSent: '已发送给 Project owner。',
			taskSent: '已创建 Task。',
			sendFailed: '发送失败：{message}',
			inboxUnread: '收件箱，{n} 条未读',
			dismiss: '关闭提示',
			retry: '重试',
			crashTitle: '工作台渲染失败',
			noProject: '未选择项目',
			archivedCount: '已归档 {n}',
			q1Title: '需要你',
			q2Title: '团队在做',
			q3Title: '等待受阻',
			q4Title: '最近完成',
			q1Def: '现在哪件事非你不可？',
			q2Def: '团队现在在推进什么？',
			q3Def: '卡在哪、在等谁？',
			q4Def: '最近成了什么？',
			q1Empty: '没有需要你的事',
			q2Empty: '团队当前空闲',
			q3Empty: '没有卡住的事',
			q4Empty: '还没有完成',
			viewAll: '查看全部',
			quadrantMeta: 'Host 投影 · 事件流已连接（{time}）',
			q4Total: '最近 {n} 条 / 共 {m} 条',
			catReview: '待验收',
			catIrreversible: '不可撤回',
			catDecision: '决策',
			catOwnerBlocked: '负责人处理',
			catInProgress: '进行中',
			catHandoff: '等交接',
			catBlocked: '受阻',
			catStalled: '停滞',
			catDone: '已完成',
			waitOn: '等 {ref}',
			waitDependency: '依赖未完成',
			decisionMock: 'spike：决策项需要在收件箱页处理（M1 之后接入），当前只在态势里展示。',
			quadrantMissing: 'spike：该条目对应的 Task 不在当前 bootstrap 数据里。',
			filterLabel: '筛选：{name}',
			filterClear: '清除筛选',
			filterInboxExtra: '另有 {n} 条收件箱决策项',
			filteredEmptyTitle: '这个筛选下没有任务',
			filteredEmptyBody: '清除筛选后可看到全部任务。',
			itemCount: '{n} 项',
			doneTitle: '完成信息',
			doneAt: '完成于 {time}',
			acceptedBy: '验收人 {name}',
			evidenceCount: '证据 {n} 条',
			doneNoInfo: '完成信息未记录',
		};
		const en = {
			panel: 'Agent Team',
			back: 'Chat',
			inbox: 'Inbox',
			board: 'All tasks',
			projects: 'Projects',
			agents: 'Agents',
			main: 'Main',
			boardTab: 'Board',
			tabSituation: 'Situation',
			tabsAria: 'Project views',
			composer: 'Write a message…',
			taskPlaceholder: 'A one-line task; add the definition of done later',
			discuss: 'Discuss',
			taskMode: 'Task',
			send: 'Send',
			createTask: 'Create task',
			enterHint: 'Ctrl/⌘ + Enter to send',
			thread: 'Discussion',
			closeThread: 'Close discussion',
			follow: 'Follow',
			unfollow: 'Unfollow',
			convert: 'Turn into task',
			reply: 'Reply to this thread…',
			replyHint: 'Will send on #{seq}',
			replyHintNew: 'Will start a new thread',
			owner: 'Owner',
			executor: 'Runs',
			unassigned: 'Unassigned',
			blocked: 'Blocked',
			dependsOn: 'depends on',
			replyCount: '{n} replies',
			stPending: 'To do',
			stInProgress: 'In progress',
			stPendingAcceptance: 'To accept',
			stDone: 'Done',
			stCancelled: 'Cancelled',
			agentRunning: 'Running',
			agentIdle: 'Idle',
			agentDefaultModel: 'Default model',
			agentFailure: 'LLM failure: {category} · attempt {n}',
			agentFailureShort: 'failed',
			agentProvisioning: 'Preparing memory',
			agentFailed: 'Failed',
			agentRetired: 'Retired',
			groupCreated: '{n} tasks created',
			groupBlocked: '{n} with dependencies',
			groupMore: 'Show {n} more',
			groupLess: 'Collapse {n}',
			fromDiscussion: 'Promoted from discussion',
			loading: 'Loading…',
			fallbackTitle: 'Demo data',
			fallbackBody: 'The bootstrap endpoint (/ai-team) is unreachable, so the embedded sample is shown. Sending, following and acceptance only give local feedback; nothing is written to the ledger.',
			spike: 'M1 spike',
			spikeTitle: 'Read-only UI demo: sending, following and acceptance only give local feedback; nothing is written to the ledger.',
			navAria: 'Page navigation',
			menu: 'Menu',
			menuAria: 'Open the project and member menu',
			projectsAria: 'Projects',
			agentsAria: 'Agents',
			streamAria: 'Main stream',
			boardAria: 'Task board',
			situationAria: 'Project situation',
			threadAria: 'Task discussion',
			composerAria: 'Write a message',
			modeAria: 'Send mode',
			columnAria: '“{title}”, {n} items',
			emptyStreamTitle: 'Say what needs doing',
			emptyStreamBody: 'For example: fix the three failing regressions.',
			emptyStreamExample: 'Fix the three failing regressions from this run',
			fillExample: 'Use this example',
			emptyBoardTitle: 'No tasks yet',
			emptyBoardBody: 'Say it in the discussion, or turn a message into a task.',
			emptyBoardAction: 'Back to main',
			inboxTitle: 'Inbox',
			inboxGoal: 'Cross-project aggregation lands after M1',
			inboxEmptyTitle: 'Inbox page not wired yet',
			inboxEmptyBody: 'The M1 spike only covers the workbench shell; decision items currently appear in “Situation · Needs you” and unread counts stay in the left rail.',
			inboxEmptyAction: 'Open the board',
			projectEmptyTitle: 'No projects yet',
			projectEmptyBody: 'Project creation belongs to S-01; it lands after M1.',
			emptyColumn: 'None',
			expandDone: 'Show all',
			collapseDone: 'Collapse',
			threadEmptyTitle: 'No messages yet',
			threadEmptyBody: 'Write the definition of done before starting.',
			acceptance: 'Acceptance',
			candidate: 'Candidate',
			acceptEligible: 'You never claimed this task and are not its executor, so acceptance is yours.',
			acceptSteward: 'Acceptance request went to: you (no steward set; Human fallback).',
			irreversibleNote: 'This acceptance cannot be undone (merge, release, external delivery).',
			irreversibleCheck: 'I understand; this cannot be undone',
			acceptCta: 'Accept and mark done',
			acceptIrreversibleCta: 'Accept, no undo',
			requestChanges: 'Request changes',
			resultSummary: 'Result',
			evidence: 'Evidence',
			noEvidence: 'No evidence yet',
			noSummary: 'The executor submitted no result summary',
			diff: 'Diff',
			noDiff: 'No diff provided',
			taskActions: 'Task actions',
			mockOnly: 'Demo only; nothing is written',
			actCancel: 'Cancel task',
			actReopen: 'Reopen',
			actReassign: 'Reassign…',
			actHandoff: 'Hand off…',
			actDelete: 'Delete',
			actionMock: 'spike: {action} needs confirmation and a ledger write; enabled when commands land.',
			convertTitle: 'Turn into task',
			titleLabel: 'Title',
			convertNamePlaceholder: 'One line about what needs doing',
			convertDod: 'Definition of done',
			convertDodPlaceholder: 'What counts as done: a verifiable result or evidence',
			convertContext: 'Context: {m} messages from #{n}',
			convertCancel: 'Cancel',
			convertSubmit: 'Create task',
			convertMock: 'spike: will create a task from #{n} with context refs (commands not wired).',
			conflictTitle: 'Your reply was based on an older thread and was returned',
			conflictNew: 'Thread is at #{head} ({n} new)',
			conflictContinue: 'Continue from latest',
			conflictContext: 'See what I had',
			conflictContinueMock: 'spike: send base moved to #{head} (nothing written).',
			conflictContextMock: 'spike: will show your context at #{base} (commands not wired).',
			replyMock: 'spike: reply will be sent on #{seq} and written to the ledger (commands not wired).',
			replyMockNew: 'spike: will start a thread and write the reply (commands not wired).',
			followMock: 'spike: following #{n} (local demo only; nothing written).',
			unfollowMock: 'spike: not following #{n}. You will still hear about completion, blockage, or decisions (local demo only).',
			acceptMock: 'spike: accepting #{n} will write an acceptance record and mark it done (commands not wired).',
			changesMock: 'spike: requesting changes needs at least 10 characters and a ledger write (commands not wired).',
			projectSwitchMock: 'spike: switching projects only updates the header; per-project ledger reads land with M1.',
			archivedMock: 'spike: archived projects are read-only; unarchive lands with M3.',
			agentMock: 'spike: member detail (open session / message / memory & skills) lands with M3.',
			agentOpen: 'Open details for {name}',
			moreActions: 'More actions',
			newProject: 'New project',
			addAgent: 'Add member',
			newProjectMock: 'spike: project creation belongs to S-01 and lands after M1.',
			addAgentMock: 'spike: adding members lands after M1.',
			addAgentTitle: 'Add member',
			memberName: 'Name',
			memberRole: 'Role',
			memberPrompt: 'Initial instruction (optional)',
			memberPromptHint: 'e.g. Task #1 is awaiting acceptance; read tasks and review it independently.',
			memberProvider: 'Provider',
			memberModel: 'Model',
			memberOwner: 'Make Project owner',
			memberCreate: 'Create and activate',
			memberAdding: 'Creating…',
			memberAdded: 'Member created and activated.',
			cancel: 'Cancel',
			memberProfileTitle: 'Member profile',
			memberProfileTitleName: 'Member profile · {name}',
			memberProfileMeta: '{status} · profile v{version} · distill v{distill}',
			memberPersonality: 'Personality / working style',
			save: 'Save',
			saving: 'Saving…',
			redistill: 'Re-distill',
			leaveTeam: 'Leave team',
			leaveConfirm: 'Leaving moves the member to the talent pool; unfinished tasks will be listed for takeover. Continue?',
			leftTeam: 'Moved to the talent pool; {n} unfinished task(s) await takeover.',
			leftTeamHanded: 'Moved to the talent pool; {n} unfinished task(s) handed to the successor.',
			successor: 'Hand leftover work to',
			noSuccessor: 'No successor now (leave it on the board)',
			recruited: 'Recruited from the talent pool.',
			talentPoolCount: 'Talent pool {n}',
			talentPool: 'Talent pool',
			recruit: 'Recruit',
			profileSaved: 'Profile saved; effective on the next wake.',
			profileDistilled: 'Re-distilled and recorded as a new version.',
			conversationMock: 'spike: this host has no working layout.selectPanel(conversation).',
			discussSent: 'Sent to the Project owner.',
			taskSent: 'Task created.',
			sendFailed: 'Send failed: {message}',
			inboxUnread: 'Inbox, {n} unread',
			dismiss: 'Dismiss',
			retry: 'Retry',
			crashTitle: 'Workbench failed to render',
			noProject: 'No project selected',
			archivedCount: 'Archived {n}',
			q1Title: 'Needs you',
			q2Title: 'Team is doing',
			q3Title: 'Waiting / blocked',
			q4Title: 'Recently done',
			q1Def: 'What can only you do right now?',
			q2Def: 'What is the team moving forward?',
			q3Def: 'Where is it stuck, and on whom?',
			q4Def: 'What got done recently?',
			q1Empty: 'Nothing needs you',
			q2Empty: 'The team is idle',
			q3Empty: 'Nothing is stuck',
			q4Empty: 'Nothing completed yet',
			viewAll: 'View all',
			quadrantMeta: 'Host projection · event stream connected ({time})',
			q4Total: 'Recent {n} / {m} total',
			catReview: 'To accept',
			catIrreversible: 'Irreversible',
			catDecision: 'Decision',
			catOwnerBlocked: 'Owner action',
			catInProgress: 'In progress',
			catHandoff: 'Handoff pending',
			catBlocked: 'Blocked',
			catStalled: 'Stalled',
			catDone: 'Done',
			waitOn: 'waiting on {ref}',
			waitDependency: 'dependency unfinished',
			decisionMock: 'spike: decisions are handled on the inbox page (after M1); for now they only show in Situation.',
			quadrantMissing: 'spike: the Task behind this item is not in the current bootstrap data.',
			filterLabel: 'Filter: {name}',
			filterClear: 'Clear filter',
			filterInboxExtra: '{n} inbox decision item(s) not on the board',
			filteredEmptyTitle: 'No tasks under this filter',
			filteredEmptyBody: 'Clear the filter to see all tasks.',
			itemCount: '{n} items',
			doneTitle: 'Completion',
			doneAt: 'Done at {time}',
			acceptedBy: 'Accepted by {name}',
			evidenceCount: '{n} evidence items',
			doneNoInfo: 'No completion details recorded',
		};

		const MOCK = (() => {
			const now = Date.now();
			const ago = (min) => now - min * 60_000;
			const thread11 = {
				taskId: 'tsk_11',
				headSeq: 6,
				baseSeq: 4,
				entries: [
					{ seq: 1, author: '沈舟', at: ago(18), body: '先复现，再判断是不是同一个根因。' },
					{ seq: 2, author: '林岚', at: ago(16), body: '我这边跑到第二条就复现了，日志在 /tmp/regression-2.log。' },
					{ seq: 3, author: '沈舟', at: ago(14), body: '收到，把第三条也跑一遍，我加锁修。' },
					{ seq: 4, author: '林岚', at: ago(11), body: 'upload.ts:88 的锁范围扩大后，第三条不再失败。' },
					{ seq: 5, author: '沈舟', at: ago(7), body: '我认领 #11，先把修复提上来。' },
					{ seq: 6, author: '沈舟', at: ago(5), body: '已提交待验收：3 条用例全绿，回归 214 条通过。' },
				],
				changes: [
					{ who: '沈舟', what: '认领修复', seq: 5 },
					{ who: '沈舟', what: '提交待验收', seq: 6 },
				],
			};
			return {
				projects: [
					{ id: 'prj_main', name: 'Main-Dev', goal: '把这次回归清干净', owner: '沈舟', active: true },
					{ id: 'prj_bug', name: 'Bug-Check-Fix', goal: '排查 issue 与后续修复', owner: '沈舟' },
					{ id: 'prj_ui', name: 'UI-UX-AX', goal: '工作台体验与可访问性', owner: '顾言' },
					{ id: 'prj_old', name: 'Old-Spike', goal: '已结束的第一阶段验证', owner: '顾言', archived: true },
				],
				agents: [
					{ id: 'mem_shenzhou', name: '沈舟', role: '架构 · 管验收标准', status: 'running' },
					{ id: 'mem_linlan', name: '林岚', role: '研究 · 复跑门禁', status: 'idle' },
					{ id: 'mem_chenmo', name: '陈默', role: '产品 · 验收', status: 'idle' },
					{ id: 'mem_guyan', name: '顾言', role: 'UI/UX · 工作台体验', status: 'idle' },
					{ id: 'mem_xiaoman', name: '小满', role: '开发 · 正在准备记忆', status: 'provisioning' },
					{ id: 'mem_laozhou', name: '老周', role: '已退役（历史保留）', status: 'retired' },
				],
				inbox: [
					{ id: 'inbox_d1', kind: 'inbox', category: 'decision', title: '决策：首页文案选 A 还是 B', waitingSince: ago(25), read: false },
					{ id: 'inbox_m1', kind: 'inbox', category: 'mention', title: '林岚在 #16 提到了你', waitingSince: ago(12), read: false },
				],
				stream: [
					{ id: 'str_1', seq: 1, kind: 'human_message', at: ago(15), author: { kind: 'human', name: '你' }, body: '把这次回归里失败的三条都修了，谁该看谁看。' },
					{
						id: 'str_2', seq: 2, kind: 'task_card', at: ago(14), author: { kind: 'agent', name: '沈舟' },
						body: '拆成 5 项，2 项互相依赖。我先复现，其余并行。',
						taskIds: ['tsk_11', 'tsk_12', 'tsk_13', 'tsk_14', 'tsk_15'],
					},
					{
						id: 'str_3', seq: 3, kind: 'task_card', at: ago(6), author: { kind: 'agent', name: '林岚' },
						body: '两条已提交待验收，一条已完成；验收前先看证据。',
						taskIds: ['tsk_16', 'tsk_17', 'tsk_18'],
					},
				],
				tasks: [
					{ id: 'tsk_11', number: 11, title: '复现三条失败的用例，界定影响面与不修什么', status: 'in_progress', owner: '沈舟', assignee: '沈舟', replies: 2, following: true, blockedBy: [], originRefs: ['str_1'], updatedAt: ago(8), summary: '先复现，再判断是不是同一个根因；不修与本次无关的 2 条 flaky。' },
					{ id: 'tsk_12', number: 12, title: '登录超时：先加锁再断言，见 upload.ts:88', status: 'pending', owner: '沈舟', assignee: null, replies: 0, following: true, blockedBy: [], originRefs: ['str_2'], updatedAt: ago(11) },
					{ id: 'tsk_13', number: 13, title: '上传 413：前端表单与后端限制不一致', status: 'pending', owner: '沈舟', assignee: null, replies: 0, following: true, blockedBy: ['tsk_12'], originRefs: ['str_2'], updatedAt: ago(30) },
					{ id: 'tsk_14', number: 14, title: '回归门禁：复跑 build 与 browser 8/8', status: 'in_progress', owner: '林岚', assignee: '林岚', replies: 1, following: false, blockedBy: [], originRefs: ['str_2'], updatedAt: ago(20) },
					{ id: 'tsk_15', number: 15, title: '把修法写成可复核的验收证据', status: 'in_progress', owner: '陈默', assignee: '陈默', replies: 0, following: false, blockedBy: [], originRefs: ['str_2'], updatedAt: ago(30) },
					{
						id: 'tsk_16', number: 16, title: '上传 413：前后端限制对齐后复验', status: 'pending_acceptance', owner: '沈舟', assignee: '沈舟', replies: 3, following: true, blockedBy: [], originRefs: ['str_3'], updatedAt: ago(5),
						submission: { summary: '三条用例已修，回归全绿。', evidence: [{ label: 'test/report.xml', ref: 'a1f3' }, { label: 'pnpm test', ref: '214 passed' }], diffStat: '3 files · +48 −12' },
					},
					{
						id: 'tsk_17', number: 17, title: '发布前确认：测试环境 v0.2', status: 'pending_acceptance', owner: '顾言', assignee: '顾言', replies: 2, following: false, blockedBy: [], originRefs: ['str_3'], updatedAt: ago(3), irreversible: true,
						submission: { summary: '已发布 v0.2 到测试环境，对外可见。', evidence: [{ label: 'release-note.md', ref: 'draft' }], diffStat: '2 files · +6 −2' },
					},
					{ id: 'tsk_18', number: 18, title: '看板已完成列展开控件的可见性判断修正', status: 'done', owner: '林岚', assignee: '林岚', replies: 1, following: false, blockedBy: [], originRefs: ['str_3'], updatedAt: ago(5), completedAt: ago(5), acceptedBy: '沈舟', evidenceCount: 2 },
					{ id: 'tsk_19', number: 19, title: '工作台窄容器三档截图与横向滚动检查', status: 'in_progress', owner: '顾言', assignee: '顾言', replies: 0, following: false, blockedBy: [], updatedAt: ago(40) },
					{ id: 'tsk_20', number: 20, title: '把回归脚本的失败日志整理成证据', status: 'pending', owner: '沈舟', assignee: '沈舟', handoffTo: '简', replies: 0, following: false, blockedBy: [], updatedAt: ago(10) },
					{ id: 'tsk_21', number: 21, title: '修复上传 413 的前端限制', status: 'done', owner: '沈舟', assignee: '沈舟', replies: 0, following: false, blockedBy: [], updatedAt: ago(60), completedAt: ago(60), acceptedBy: '你', evidenceCount: 1 },
					{ id: 'tsk_22', number: 22, title: '回归门禁复跑 8/8', status: 'done', owner: '陈默', assignee: '陈默', replies: 0, following: false, blockedBy: [], updatedAt: ago(120), completedAt: ago(120), acceptedBy: '你', evidenceCount: 3 },
					{ id: 'tsk_23', number: 23, title: 'Thread 引用与复制动作补齐', status: 'done', owner: '林岚', assignee: '林岚', replies: 0, following: false, blockedBy: [], updatedAt: ago(1440), completedAt: ago(1440), acceptedBy: '沈舟', evidenceCount: 0 },
					{ id: 'tsk_24', number: 24, title: '工作台三栏骨架首次安装验证', status: 'done', owner: '沈舟', assignee: '沈舟', replies: 0, following: false, blockedBy: [], updatedAt: ago(2880), completedAt: ago(2880), acceptedBy: '你', evidenceCount: 1 },
				],
				threads: {
					tsk_11: thread11,
					tsk_16: {
						taskId: 'tsk_16', headSeq: 3,
						entries: [
							{ seq: 1, author: '林岚', at: ago(12), body: '三条用例已修，回归全绿。' },
							{ seq: 2, author: '沈舟', at: ago(8), body: '已提交待验收，证据见 test/report.xml。' },
							{ seq: 3, author: '林岚', at: ago(6), body: '复跑 build 与 browser 8/8 通过。' },
						],
					},
					tsk_17: {
						taskId: 'tsk_17', headSeq: 2,
						entries: [
							{ seq: 1, author: '顾言', at: ago(10), body: '测试环境已发布 v0.2，对外可见。' },
							{ seq: 2, author: '顾言', at: ago(4), body: '发布动作不可撤回，请确认影响。' },
						],
					},
					tsk_18: {
						taskId: 'tsk_18', headSeq: 1,
						entries: [{ seq: 1, author: '沈舟', at: ago(6), body: '看板已完成列展开逻辑修好了。' }],
					},
				},
			};
		})();

		const STATUS = {
			pending: { label: 'stPending', tone: 'idle' },
			in_progress: { label: 'stInProgress', tone: 'business' },
			pending_acceptance: { label: 'stPendingAcceptance', tone: 'warn' },
			done: { label: 'stDone', tone: 'success' },
			cancelled: { label: 'stCancelled', tone: 'muted' },
		};
		const AGENT_STATUS = {
			running: 'agentRunning',
			idle: 'agentIdle',
			provisioning: 'agentProvisioning',
			failed: 'agentFailed',
			retired: 'agentRetired',
		};
		const QUADRANTS = [
			{ key: 'q1', name: 'q1Title', def: 'q1Def', empty: 'q1Empty', tone: 'warn', icon: 'alert' },
			{ key: 'q2', name: 'q2Title', def: 'q2Def', empty: 'q2Empty', tone: 'business', icon: 'dot' },
			{ key: 'q3', name: 'q3Title', def: 'q3Def', empty: 'q3Empty', tone: 'warn', icon: 'block' },
			{ key: 'q4', name: 'q4Title', def: 'q4Def', empty: 'q4Empty', tone: 'success', icon: 'check' },
		];
		const CATEGORY_LABEL = {
			review: 'catReview',
			irreversible: 'catIrreversible',
			decision: 'catDecision',
			owner_blocked: 'catOwnerBlocked',
			in_progress: 'catInProgress',
			handoff: 'catHandoff',
			blocked: 'catBlocked',
			stalled: 'catStalled',
			done: 'catDone',
		};
		const Q1_ORDER = { irreversible: 0, review: 1, decision: 2, owner_blocked: 3 };
		const TABS = ['main', 'board', 'situation'];

		const cx = (...parts) => parts.filter(Boolean).join(' ');
		const tf = (t, key, vars) => String(t(key)).replace(/\{(\w+)\}/g, (match, name) => (
			vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
		));
		const taskNo = (task) => (task && task.number !== undefined && task.number !== null ? task.number : task?.id ?? '');
		const fmtTime = (at) => {
			if (!at) return '';
			const d = new Date(at);
			if (Number.isNaN(d.getTime())) return '';
			try { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
		};
		const fmtDateTime = (at) => {
			if (!at) return '';
			const d = new Date(at);
			if (Number.isNaN(d.getTime())) return '';
			try { return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
		};
		const iso = (at) => {
			if (!at) return undefined;
			const d = new Date(at);
			return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
		};
		const firstSentence = (text) => {
			const value = String(text ?? '').trim();
			const hit = value.match(/^[^。！？!?\n]+/);
			return (hit ? hit[0] : value).trim();
		};
		const statusMeta = (status) => STATUS[status] ?? STATUS.pending;
		const agentFor = (data, name) => (data?.agents ?? []).find((agent) => agent.name === name) ?? null;
		const threadFor = (data, taskId) => {
			if (!data || !taskId) return null;
			if (data.threads && data.threads[taskId]) return data.threads[taskId];
			if (data.thread && data.thread.taskId === taskId) return data.thread;
			return null;
		};
		const blockedRefs = (task, tasks) => (task?.blockedBy ?? []).map((id) => {
			const dep = (tasks ?? []).find((item) => item.id === id);
			return '#' + taskNo(dep ?? { id });
		});
		const normalizePayload = (payload) => {
			if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
			return {
				...payload,
				projects: Array.isArray(payload.projects) ? payload.projects : [],
				agents: Array.isArray(payload.agents) ? payload.agents : [],
				stream: Array.isArray(payload.stream) ? payload.stream : [],
				tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
				inbox: Array.isArray(payload.inbox) ? payload.inbox : [],
			};
		};

		/** Derive the read-only quadrants projection from the bootstrap DTO (spike fallback). */
		function deriveQuadrants(data) {
			const direct = data?.quadrants;
			if (direct && direct.q1 && direct.q2 && direct.q3 && direct.q4) return direct;
			const tasks = data?.tasks ?? [];
			const inbox = data?.inbox ?? [];
			const q1 = [];
			const q2 = [];
			const q3 = [];
			const q4 = [];
			const used = new Set();
			const take = (bucket, item) => {
				if (!item || used.has(item.id)) return;
				used.add(item.id);
				bucket.push(item);
			};
			const itemOf = (task, category) => ({
				id: task.id,
				kind: 'task',
				category,
				title: task.title,
				taskId: task.id,
				taskNumber: task.number,
				ownerName: task.owner,
				assigneeName: task.assignee,
				waitingSince: task.updatedAt,
				doneAt: task.completedAt,
				evidenceCount: task.evidenceCount ?? task.submission?.evidence?.length ?? 0,
				blockedBy: task.blockedBy,
				handoffTo: task.handoffTo,
				acceptedBy: task.acceptedBy,
			});
			tasks.forEach((task) => {
				if (task.status === 'pending_acceptance') take(q1, itemOf(task, task.irreversible ? 'irreversible' : 'review'));
			});
			tasks.forEach((task) => {
				if (task.owner === '你' && task.status === 'pending' && (task.blockedBy?.length || task.handoffTo)) {
					take(q1, itemOf(task, 'owner_blocked'));
				}
			});
			inbox.forEach((item) => {
				if (item.category === 'decision' && !used.has(item.id)) {
					used.add(item.id);
					q1.push({
						id: item.id,
						kind: 'inbox',
						category: 'decision',
						title: item.title,
						taskId: item.taskId,
						taskNumber: item.taskNumber,
						waitingSince: item.waitingSince,
					});
				}
			});
			tasks.forEach((task) => {
				if (task.status === 'in_progress') take(q2, itemOf(task, 'in_progress'));
			});
			tasks.forEach((task) => {
				if (task.status !== 'pending' || used.has(task.id)) return;
				if (task.handoffTo) take(q3, itemOf(task, 'handoff'));
				else if (task.blockedBy?.length) take(q3, itemOf(task, 'blocked'));
			});
			tasks.forEach((task) => {
				if (task.status === 'done') take(q4, itemOf(task, 'done'));
			});
			q1.sort((a, b) => (Q1_ORDER[a.category] ?? 9) - (Q1_ORDER[b.category] ?? 9) || (a.waitingSince ?? 0) - (b.waitingSince ?? 0));
			q2.sort((a, b) => (b.waitingSince ?? 0) - (a.waitingSince ?? 0));
			q3.sort((a, b) => (a.waitingSince ?? 0) - (b.waitingSince ?? 0));
			q4.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
			return {
				rev: data?.rev ?? 0,
				generatedAt: data?.generatedAt ?? Date.now(),
				q1: { count: q1.length, items: q1.slice(0, 5) },
				q2: { count: q2.length, items: q2.slice(0, 5) },
				q3: { count: q3.length, items: q3.slice(0, 5) },
				q4: { count: Math.min(q4.length, 20), items: q4.slice(0, 5), total: q4.length },
			};
		}

		/** Only the four board columns; `blocked` stays a badge, never a column. */
		function matchesFilter(task, filter) {
			if (filter === 'q1') return task.status === 'pending_acceptance' || (task.owner === '你' && task.status === 'pending' && (task.blockedBy?.length || task.handoffTo));
			if (filter === 'q2') return task.status === 'in_progress';
			if (filter === 'q3') return task.status === 'pending' && (task.blockedBy?.length || task.handoffTo);
			if (filter === 'q4') return task.status === 'done';
			return true;
		}

		const CSS = `
			.at-root { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-family: var(--dsw-font-family); font-size: 13px; line-height: 21px; container-type: inline-size; container-name: at-wb; }
			.at-root *, .at-root *::before, .at-root *::after { box-sizing: border-box; }
			.at-root :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
			.at-top { height: 40px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
			.at-brand { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; white-space: nowrap; }
			.at-spike { display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 16px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
			.at-topproject { margin-left: auto; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-mobile { display: none; position: relative; min-width: 0; }
			.at-mobilesummary { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; list-style: none; }
			.at-mobilesummary::-webkit-details-marker { display: none; }
			.at-mobilepop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; width: min(320px, calc(100vw - 32px)); width: min(320px, calc(100cqw - 16px)); max-height: 70vh; overflow-y: auto; overflow-x: hidden; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-panel, 0 8px 24px var(--dsw-alias-bg-mask-2)); }
			.at-grid { flex: 1; min-height: 0; min-width: 0; position: relative; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
			.at-grid.at-withthread { grid-template-columns: 248px minmax(0, 1fr) 384px; }
			.at-left { min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 8px 8px 12px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
			.at-center { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); container-type: inline-size; container-name: at-center; }
			.at-right { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
			.at-nav { display: flex; flex-direction: column; gap: 1px; }
			.at-navrow { width: 100%; min-height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; text-align: left; cursor: pointer; }
			.at-navrow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-navrow.at-on { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
			.at-count { margin-left: auto; color: var(--dsw-alias-label-caption); font-size: 11px; font-variant-numeric: tabular-nums; }
			.at-h { display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 12px 6px 4px; color: var(--dsw-alias-label-caption); font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; }
			.at-h > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-mini { margin-left: auto; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
			.at-mini:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-tree { display: flex; flex-direction: column; gap: 1px; }
			.at-prow { min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; cursor: pointer; }
			.at-prow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-prow.at-on { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary); }
			.at-hash { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
			.at-prowtitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-archived { margin-top: 4px; }
			.at-archived > summary { min-height: 28px; display: flex; align-items: center; padding: 0 8px; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-caption); font-size: 11px; cursor: pointer; list-style: none; }
			.at-archived > summary::-webkit-details-marker { display: none; }
			.at-archived > summary:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
			.at-agent { min-height: 44px; display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: var(--dsw-radius-sm); }
			.at-agent:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); }
			.at-dot-running { background: var(--dsw-alias-state-business-primary); }
			.at-dot-provisioning { background: transparent; border: 1.5px solid var(--dsw-alias-state-idle-primary); }
			.at-dot-failed { background: var(--dsw-alias-state-error-primary); }
			.at-dot-retired { background: var(--dsw-alias-label-caption); opacity: .5; }
			.at-agentmeta { min-width: 0; flex: 1; display: flex; flex-direction: column; }
			.at-agentname { align-self: flex-start; max-width: 100%; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-agentname:hover { text-decoration: underline; }
			.at-agentrole { min-width: 0; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-qabadge { display: inline-flex; align-items: center; margin-left: 5px; padding: 0 5px; border: 1px solid var(--dsw-alias-state-business-primary); border-radius: 999px; color: var(--dsw-alias-state-business-primary); font-size: 9px; line-height: 15px; vertical-align: 1px; }
			.at-talented { opacity: 0.82; }
			.at-btn-small { min-height: 24px; padding: 0 8px; font-size: 11px; }
			.at-agentconfig { min-width: 0; display: flex; gap: 4px; align-items: center; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-agentfail { flex: none; color: var(--dsw-alias-state-warn-primary); }
			.at-agentmore { flex: 0 0 auto; width: 28px; height: 28px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; cursor: pointer; }
			.at-agentmore:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
			.at-chead { flex: 0 0 auto; padding: 14px 18px 0; }
			.at-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 600; line-height: 22px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-goal { min-width: 0; margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-tabs { display: flex; gap: 4px; margin-top: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-tab { min-height: 36px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
			.at-tab:hover { color: var(--dsw-alias-label-primary); }
			.at-tab.at-on { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-state-business-primary); }
			.at-tabcount { color: var(--dsw-alias-label-caption); font-size: 11px; font-weight: 400; font-variant-numeric: tabular-nums; }
			.at-notewrap { flex: 0 0 auto; width: 100%; max-width: 760px; margin: 0 auto; padding: 8px 18px 0; }
			.at-note { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-left: 2px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
			.at-notetext { min-width: 0; flex: 1; overflow-wrap: anywhere; }
			.at-noteclose { flex: 0 0 auto; width: 24px; height: 24px; display: grid; place-items: center; margin: -4px -4px -4px 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
			.at-noteclose:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-banner { flex: 0 0 auto; margin: 8px 18px 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
			.at-banner b { color: var(--dsw-alias-state-warn-label); font-weight: 500; }
			.at-stream { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 16px 18px 8px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
			.at-streaminner { width: 100%; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
			.at-msg { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
			.at-avatar { flex: 0 0 auto; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 500; }
			.at-avatar-human { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); }
			.at-msgb { min-width: 0; flex: 1; }
			.at-msgh { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
			.at-msgh b { color: var(--dsw-alias-label-primary); font-weight: 500; }
			.at-role { color: var(--dsw-alias-label-caption); font-size: 11px; }
			.at-msgh time { color: var(--dsw-alias-label-caption); font-size: 11px; font-variant-numeric: tabular-nums; }
			.at-msgt { max-width: 66ch; margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; }
			.at-msg-human .at-msgt { color: var(--dsw-alias-label-primary); }
			.at-group { min-width: 0; margin-top: 8px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
			.at-grouphead { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-groupicon { display: inline-flex; color: var(--dsw-alias-label-tertiary); }
			.at-grouptitle { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
			.at-groupsummary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-card { min-width: 0; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
			.at-card-rich { min-height: 96px; padding: 11px 13px; }
			.at-card-board { width: 100%; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); }
			.at-card-compact { min-height: 40px; padding: 6px 10px; }
			.at-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-card.at-sel { background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l4); }
			.at-card:focus-visible { outline-offset: -2px; }
			.at-group .at-card + .at-card { border-top: 1px solid var(--dsw-alias-border-l1); }
			.at-cardtop { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
			.at-origin { display: inline-flex; color: var(--dsw-alias-label-caption); }
			.at-num { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; line-height: 18px; white-space: nowrap; font-variant-numeric: tabular-nums; }
			.at-pill { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }
			.at-pill-md { height: 24px; font-size: 12px; }
			.at-pill.at-tone-business { background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-state-business-primary); }
			.at-pill.at-tone-warn { padding-left: 4px; border-left: 2px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
			.at-pill.at-tone-success { background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); }
			.at-pill.at-tone-muted { border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-caption); }
			.at-blocked { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }
			.at-dep { color: var(--dsw-alias-state-warn-label); font-weight: 400; }
			.at-replies { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
			.at-ct { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 21px; overflow-wrap: anywhere; }
			.at-card-board .at-ct { font-size: 13px; }
			.at-cs { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
			.at-cm { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-owner, .at-exec { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-sep { color: var(--dsw-alias-label-caption); }
			.at-miniavatar { width: 16px; height: 16px; display: inline-grid; place-items: center; margin-right: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 10px; vertical-align: -3px; }
			.at-follow { flex: 0 0 auto; min-height: 24px; display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 0 6px; border: 1px solid transparent; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
			.at-follow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-follow.at-follow-on { color: var(--dsw-alias-state-business-primary); }
			.at-follow.at-follow-compact { padding: 0; width: 24px; justify-content: center; }
			.at-groupmore { width: 100%; display: flex; flex-direction: column; gap: 2px; padding: 6px 12px; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 16px; text-align: left; cursor: pointer; }
			.at-groupmore:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-morelabel { color: var(--dsw-alias-label-secondary); }
			.at-morelist { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-caption); }
			.at-composer { flex: 0 0 auto; padding: 8px 18px 14px; }
			.at-composerinner { width: 100%; max-width: 760px; margin: 0 auto; }
			.at-box { min-width: 0; padding: 8px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
			.at-box:focus-within { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
			.at-box.at-taskmode { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, var(--dsw-alias-border-l2)); }
			.at-box textarea { display: block; width: 100%; min-height: 38px; max-height: 160px; resize: none; padding: 2px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 21px; }
			.at-barrow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
			.at-mode { display: inline-flex; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
			.at-mode button { min-height: 24px; padding: 0 8px; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
			.at-mode button[aria-pressed="true"] { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
			.at-hint { min-width: 0; color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-send { margin-left: auto; min-height: 28px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap; }
			.at-send:hover { background: var(--dsw-alias-button-primary-hover); }
			.at-send:disabled { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-caption); cursor: not-allowed; }
			.at-boardwrap { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 12px 18px 16px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
			.at-boardbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-filterchip { color: var(--dsw-alias-label-primary); font-weight: 500; }
			.at-filternote { color: var(--dsw-alias-label-caption); }
			.at-filterclear { margin-left: auto; }
			.at-board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: start; min-width: 0; }
			.at-col { min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); }
			.at-colhead { min-height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 2px; }
			.at-coltitle { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 18px; white-space: nowrap; }
			.at-colcount { color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; }
			.at-col-pending_acceptance .at-colhead { padding-bottom: 8px; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 20%, transparent); }
			.at-coltoggle { margin-left: auto; min-height: 24px; padding: 0 4px; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
			.at-coltoggle:hover { color: var(--dsw-alias-label-primary); }
			.at-colempty { padding: 4px; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }
			.at-situation { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 12px 18px 16px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
			.at-situationinner { min-width: 0; }
			.at-qmeta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 16px; }
			.at-qmeta > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-quadrants { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: stretch; min-width: 0; }
			.at-quad { --at-qaccent: var(--dsw-alias-state-business-primary); min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-left: 2px solid var(--at-qaccent); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
			.at-quad-q1 { --at-qaccent: var(--dsw-alias-state-warn-primary); }
			.at-quad-q2 { --at-qaccent: var(--dsw-alias-state-business-primary); }
			.at-quad-q3 { --at-qaccent: var(--dsw-alias-state-warn-primary); }
			.at-quad-q4 { --at-qaccent: var(--dsw-alias-state-success-primary); }
			.at-quadhead { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
			.at-qname { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 18px; white-space: nowrap; }
			.at-qcount { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
			.at-qdef { color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }
			.at-qtotal { color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 16px; }
			.at-qlist { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
			.at-qitem { width: 100%; min-width: 0; display: flex; align-items: flex-start; gap: 6px; margin: 0 -4px; padding: 5px 4px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: left; cursor: pointer; }
			.at-qitem:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-qitem:focus-visible { outline-offset: -2px; }
			.at-qitemicon { flex: 0 0 auto; display: inline-flex; margin-top: 2px; color: var(--at-qaccent); }
			.at-qitembody { min-width: 0; flex: 1; display: flex; flex-direction: column; }
			.at-qtitle { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-qitemmeta { min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-qempty { padding: 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
			.at-qfoot { margin-top: auto; padding-top: 4px; }
			.at-qmore { min-height: 24px; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-link); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
			.at-qmore:hover { text-decoration: underline; }
			.at-qmore:disabled { color: var(--dsw-alias-label-caption); cursor: default; text-decoration: none; }
			.at-empty { display: flex; flex-direction: column; gap: 6px; justify-content: center; max-width: 520px; margin: 0 auto; padding: 24px; text-align: center; }
			.at-empty-compact { align-items: flex-start; margin: 0; padding: 12px; text-align: left; }
			.at-emptyicon { display: inline-flex; align-self: center; color: var(--dsw-alias-label-caption); }
			.at-empty-compact .at-emptyicon { align-self: flex-start; }
			.at-emptytitle { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
			.at-emptybody { max-width: 46ch; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
			.at-empty .at-btn { align-self: center; margin-top: 8px; }
			.at-empty-compact .at-btn { align-self: flex-start; }
			.at-btn { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap; }
			.at-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-btn-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); }
			.at-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
			.at-btn:disabled { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-caption); cursor: not-allowed; }
			.at-btn-quiet { min-height: 28px; padding: 0 8px; border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; }
			.at-btn-quiet:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-rhead { flex: 0 0 auto; min-height: 44px; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-rh { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
			.at-rhmeta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-rhtitle { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-rhead .at-follow { margin-left: 0; }
			.at-rbtn { min-height: 28px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; line-height: 16px; white-space: nowrap; cursor: pointer; }
			.at-rbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-iconbtn { width: 28px; padding: 0; }
			.at-rnote { flex: 0 0 auto; display: flex; align-items: flex-start; gap: 8px; margin: 8px 10px 0; padding: 6px 8px; border-left: 2px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
			.at-rbody { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 14px 12px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
			.at-tmsgs { display: flex; flex-direction: column; }
			.at-tmsg { padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-tmsg:last-child { border-bottom: 0; }
			.at-tmh { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }
			.at-tmh b { color: var(--dsw-alias-label-secondary); font-weight: 500; }
			.at-tseq { color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
			.at-tmt { max-width: 66ch; margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; }
			.at-rfoot { flex: 0 0 auto; padding: 8px 10px 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
			.at-rbox textarea { min-height: 48px; }
			.at-conflict { margin: 8px 0; padding: 10px 12px; border-left: 2px solid var(--dsw-alias-state-warn-primary); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); }
			.at-conflicttitle { color: var(--dsw-alias-state-warn-label); font-size: 12px; font-weight: 500; line-height: 18px; }
			.at-conflictnew { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
			.at-conflictlist { margin: 4px 0 0; padding: 0; list-style: none; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 18px; }
			.at-conflictactions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
			.at-accept { margin: 12px 0 0; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 12px; }
			.at-accepthead { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
			.at-accepttitle { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
			.at-candidate { display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); font-size: 10px; line-height: 16px; white-space: nowrap; }
			.at-kv { display: flex; flex-wrap: wrap; gap: 4px 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
			.at-kvlabel { flex: 0 0 64px; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 18px; }
			.at-kvbody { min-width: 0; flex: 1 1 180px; }
			.at-evidence { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
			.at-evidence li { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; font-size: 12px; line-height: 18px; }
			.at-evidence code, .at-context code { padding: 1px 4px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-markdown-code-block); color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-family); font-size: 11px; }
			.at-elig, .at-steward { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
			.at-steward { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-irrev { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); font-size: 11px; line-height: 16px; }
			.at-irrev p { margin: 0; }
			.at-check { display: flex; align-items: flex-start; gap: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; cursor: pointer; }
			.at-check input { flex: 0 0 auto; width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--dsw-alias-state-warn-primary); }
			.at-acceptactions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
			.at-actions { margin: 12px 0; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
			.at-actionhead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
			.at-actiontitle { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; line-height: 18px; }
			.at-mocktag { color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 16px; }
			.at-actionrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
			.at-done { margin: 12px 0 0; padding: 12px; border-left: 2px solid var(--dsw-alias-state-success-primary); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 4px; }
			.at-donehead { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-state-success-primary); font-size: 12px; font-weight: 500; line-height: 18px; }
			.at-donemeta { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-donetext { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
			.at-convert { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
			.at-converthead { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
			.at-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-field input, .at-field textarea, .at-field select { width: 100%; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; }
			.at-field textarea { min-height: 64px; resize: vertical; }
			.at-fieldrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
			.at-modalback { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent); }
			.at-modal { width: min(420px, 100%); max-height: 86vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
			.at-modaltitle { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
			.at-modalmeta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-check { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
			.at-check input { accent-color: var(--dsw-alias-state-business-primary); }
			.at-modalerror { color: var(--dsw-alias-state-error-primary); font-size: 11.5px; line-height: 16px; }
			.at-modalactions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
			.at-fieldrow .at-staticfield { min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-context { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-convertfoot { display: flex; justify-content: flex-end; gap: 8px; }
			.at-skel { background: var(--dsw-alias-bg-skeleton); border-radius: var(--dsw-radius-sm); }
			.at-skel-line { height: 12px; margin-bottom: 8px; }
			.at-skel-title { height: 20px; width: 40%; margin: 4px 0 10px; }
			.at-skel-msg { height: 56px; margin-bottom: 12px; }
			.at-skel-card { height: 88px; margin-top: 12px; }
			.at-skel-agent { height: 40px; margin-bottom: 6px; }
			.at-skel-col { height: 120px; }
			.at-crash { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; color: var(--dsw-alias-state-error-primary); text-align: center; }
			.at-crashtitle { font-size: 14px; font-weight: 500; line-height: 22px; }
			.at-crashbody { max-width: 60ch; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
			@container at-center (max-width: 759px) {
				.at-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			}
			@container at-center (max-width: 519px) {
				.at-board { grid-template-columns: minmax(0, 1fr); }
			}
			@container at-wb (max-width: 1119px) {
				.at-grid, .at-grid.at-withthread { grid-template-columns: 200px minmax(0, 1fr); }
				.at-right { position: absolute; top: 0; right: 0; bottom: 0; z-index: 10; width: min(420px, 100%); border-left: 1px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-panel, 0 8px 24px var(--dsw-alias-bg-mask-2)); }
				.at-boardwrap { padding: 12px; }
				.at-board { gap: 8px; }
			}
			@container at-wb (max-width: 959px) {
				.at-grid, .at-grid.at-withthread { grid-template-columns: 200px minmax(0, 1fr); }
				.at-right { top: 0; right: 0; bottom: 0; width: 100%; max-width: none; border-left: 0; }
				.at-board { grid-template-columns: minmax(0, 1fr); }
				.at-quadrants { grid-template-columns: minmax(0, 1fr); }
				.at-chead { padding: 10px 12px 0; }
				.at-stream { padding: 12px 12px 8px; }
				.at-notewrap { padding: 8px 12px 0; }
				.at-banner { margin: 8px 12px 0; }
				.at-composer { padding: 8px 12px 12px; }
				.at-situation { padding: 12px 12px 16px; }
			}
			@container at-wb (max-width: 719px) {
				.at-grid, .at-grid.at-withthread { grid-template-columns: minmax(0, 1fr); }
				.at-left { display: none; }
				.at-mobile { display: block; }
				.at-top { padding: 0 8px; gap: 6px; }
				.at-topproject { display: none; }
				.at-agentmore, .at-agentname { min-height: 28px; }
				.at-quadrants { grid-template-columns: minmax(0, 1fr); }
			}
			@container at-wb (max-width: 420px) {
				.at-rh { flex-basis: 100%; }
				.at-rhead { flex-wrap: wrap; }
				.at-hint { display: none; }
				.at-send { margin-left: auto; }
			}
			@media (prefers-reduced-motion: reduce) {
				.at-root *, .at-root *::before, .at-root *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
			}
		`;

		function Ico({ name, size = 14 }) {
			const common = {
				width: size,
				height: size,
				viewBox: '0 0 16 16',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.5,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				'aria-hidden': 'true',
				focusable: 'false',
			};
			if (name === 'back') return h('svg', common, h('path', { d: 'M10 3 5 8l5 5' }));
			if (name === 'inbox') return h('svg', common, h('path', { d: 'M2.5 9.5h3l1 1.5h3l1-1.5h3' }), h('path', { d: 'M2.5 9.5V4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v5' }));
			if (name === 'board') return h('svg', common, h('rect', { x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }), h('path', { d: 'M6 3.5v9M10 3.5v9' }));
			if (name === 'plus') return h('svg', common, h('path', { d: 'M8 3v10M3 8h10' }));
			if (name === 'menu') return h('svg', common, h('path', { d: 'M3 4.5h10M3 8h10M3 11.5h10' }));
			if (name === 'bell') return h('svg', common, h('path', { d: 'M4.5 7a3.5 3.5 0 0 1 7 0v3l1 1.5h-9L4.5 10V7Z' }), h('path', { d: 'M6.5 13a1.5 1.5 0 0 0 3 0' }));
			if (name === 'bellOff') return h('svg', common, h('path', { d: 'M4.5 7a3.5 3.5 0 0 1 5.5-3' }), h('path', { d: 'M6.5 13a1.5 1.5 0 0 0 3 0' }), h('path', { d: 'M4.5 10l-1 1.5h9L11.5 10V8.5' }), h('path', { d: 'M3 3l10 10' }));
			if (name === 'convert') return h('svg', common, h('path', { d: 'M4 12 12 4M6.5 4H12v5.5' }));
			if (name === 'close') return h('svg', common, h('path', { d: 'M4 4l8 8M12 4l-8 8' }));
			if (name === 'reply') return h('svg', common, h('path', { d: 'M6 4 2.5 7.5 6 11' }), h('path', { d: 'M2.5 7.5h6a4 4 0 0 1 4 4v.5' }));
			if (name === 'block') return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5.5 }), h('path', { d: 'M4.5 11.5l7-7' }));
			if (name === 'check') return h('svg', common, h('path', { d: 'M3 8.5l3 3 7-7' }));
			if (name === 'alert') return h('svg', common, h('path', { d: 'M8 2.5 14 13H2L8 2.5Z' }), h('path', { d: 'M8 6.5v3M8 11.5v.5' }));
			if (name === 'dot') return h('svg', common, h('circle', { cx: 8, cy: 8, r: 3.5, fill: 'currentColor', stroke: 'none' }));
			if (name === 'layers') return h('svg', common, h('path', { d: 'M8 2.5 14 6 8 9.5 2 6Z' }), h('path', { d: 'M2 9.5 8 13l6-3.5' }));
			if (name === 'chevron') return h('svg', common, h('path', { d: 'M6 3.5 10.5 8 6 12.5' }));
			if (name === 'loop') return h('svg', { width: 18, height: 18, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true', focusable: 'false' }, h('rect', { x: 2.5, y: 5.5, width: 21, height: 21, rx: 6.5, stroke: 'currentColor', strokeWidth: 2.6 }), h('circle', { cx: 23.5, cy: 16, r: 4.8, fill: 'var(--dsw-alias-state-business-primary)' }));
			return null;
		}

		function StatusGlyph({ status }) {
			const common = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' };
			if (status === 'done') return h('svg', common, h('path', { d: 'M2.5 6.2l2.3 2.3 4.7-4.7' }));
			if (status === 'cancelled') return h('svg', common, h('circle', { cx: 6, cy: 6, r: 4.2 }), h('path', { d: 'M3 9 9 3' }));
			if (status === 'pending') return h('svg', common, h('circle', { cx: 6, cy: 6, r: 4.2 }));
			if (status === 'pending_acceptance') return h('svg', common, h('circle', { cx: 6, cy: 6, r: 4.2, fill: 'currentColor', stroke: 'none' }));
			return h('svg', common, h('circle', { cx: 6, cy: 6, r: 4.2, fill: 'currentColor', stroke: 'none' }));
		}

		function StatusPill({ t, status, size }) {
			const meta = statusMeta(status);
			const label = t(meta.label);
			return h('span', { className: cx('at-pill', 'at-tone-' + meta.tone, size === 'md' && 'at-pill-md'), 'aria-label': label, title: label },
				h(StatusGlyph, { status }),
				h('span', null, label));
		}

		function Avatar({ name, human }) {
			return h('span', { className: cx('at-avatar', human && 'at-avatar-human'), 'aria-hidden': 'true' }, String(name ?? '?').slice(0, 1));
		}

		function FollowToggle({ t, taskNo: no, following, onToggle, compact }) {
			const label = following ? t('unfollow') : t('follow');
			return h('button', {
				className: cx('at-follow', following && 'at-follow-on', compact && 'at-follow-compact'),
				type: 'button',
				'aria-pressed': Boolean(following),
				'aria-label': label + ' #' + no,
				title: label,
				onClick: (event) => { event.stopPropagation(); onToggle(); },
				onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); },
			}, h(Ico, { name: following ? 'bell' : 'bellOff', size: 12 }), compact ? null : h('span', null, label));
		}

		function TaskCard({ t, card, tasks, variant, selected, following, onOpen, onToggleFollow }) {
			const meta = statusMeta(card.status);
			const no = taskNo(card);
			const refs = blockedRefs(card, tasks);
			const fromDiscussion = Array.isArray(card.originRefs) && card.originRefs.length > 0;
			const ownerText = t('owner') + ' ' + (card.owner ?? t('unassigned'));
			const execText = card.assignee ? t('executor') + ' ' + card.assignee : t('unassigned');
			const replyLabel = tf(t, 'replyCount', { n: card.replies ?? 0 });
			const time = fmtTime(card.updatedAt);
			const aria = [
				'Task #' + no,
				card.title,
				t(meta.label),
				refs.length ? t('blocked') + ' ' + t('dependsOn') + ' ' + refs.join('、') : '',
				ownerText,
				execText,
				replyLabel,
			].filter(Boolean).join('，');
			const open = (event) => onOpen(card, event);
			const onKeyDown = (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					open(event);
					return;
				}
				if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey) {
					event.preventDefault();
					onToggleFollow(card);
				}
			};
			return h('div', {
				className: cx('at-card', 'at-card-' + variant, selected && 'at-sel'),
				role: 'button',
				tabIndex: 0,
				'aria-label': aria,
				onClick: open,
				onKeyDown,
			},
			h('div', { className: 'at-cardtop' },
				fromDiscussion ? h('span', { className: 'at-origin', title: t('fromDiscussion'), 'aria-hidden': 'true' }, h(Ico, { name: 'reply', size: 12 })) : null,
				h('span', { className: 'at-num' }, 'Task #' + no),
				h(StatusPill, { t, status: card.status }),
				refs.length ? h('span', { className: 'at-blocked' }, h(Ico, { name: 'block', size: 12 }), t('blocked'), h('span', { className: 'at-dep' }, '· ' + t('dependsOn') + ' ' + refs.join('、'))) : null,
				h('span', { className: 'at-replies' }, replyLabel + (time ? ' · ' + time : '')),
			),
			h('div', { className: 'at-ct', title: card.title }, card.title),
			variant === 'rich' && card.summary ? h('div', { className: 'at-cs' }, card.summary) : null,
			h('div', { className: 'at-cm' },
				h('span', { className: 'at-owner' }, ownerText),
				h('span', { className: 'at-sep', 'aria-hidden': 'true' }, '·'),
				h('span', { className: 'at-exec' }, card.assignee ? h('span', { className: 'at-miniavatar', 'aria-hidden': 'true' }, String(card.assignee).slice(0, 1)) : null, execText),
				h(FollowToggle, { t, taskNo: no, following, onToggle: () => onToggleFollow(card), compact: variant === 'compact' }),
			));
		}

		function TaskGroup({ t, cards, tasks, selected, follows, onOpen, onToggleFollow }) {
			const [open, setOpen] = React.useState(false);
			if (!cards.length) return null;
			const first = cards[0];
			const rest = cards.slice(1);
			const counts = {};
			cards.forEach((card) => { counts[card.status] = (counts[card.status] ?? 0) + 1; });
			const parts = ['in_progress', 'pending_acceptance', 'pending', 'done']
				.filter((status) => counts[status])
				.map((status) => t(statusMeta(status).label) + ' ' + counts[status]);
			const blockedCount = cards.filter((card) => (card.blockedBy ?? []).length > 0).length;
			const groupLabel = tf(t, 'groupCreated', { n: cards.length });
			const renderCard = (card) => h(TaskCard, {
				key: card.id,
				t,
				card,
				tasks,
				variant: 'rich',
				selected: selected === card.id,
				following: follows(card),
				onOpen,
				onToggleFollow,
			});
			return h('div', { className: 'at-group', role: 'group', 'aria-label': groupLabel },
				h('div', { className: 'at-grouphead' },
					h('span', { className: 'at-groupicon', 'aria-hidden': 'true' }, h(Ico, { name: 'layers' })),
					h('span', { className: 'at-grouptitle' }, groupLabel),
					h('span', { className: 'at-groupsummary' }, parts.join(' · ') + (blockedCount ? ' · ' + tf(t, 'groupBlocked', { n: blockedCount }) : '')),
				),
				renderCard(first),
				!open && rest.length ? h('button', { className: 'at-groupmore', type: 'button', 'aria-expanded': false, onClick: () => setOpen(true) },
					h('span', { className: 'at-morelabel' }, tf(t, 'groupMore', { n: rest.length })),
					h('span', { className: 'at-morelist' }, rest.slice(0, 3).map((card) => '#' + taskNo(card) + ' ' + firstSentence(card.title)).join(' · '))) : null,
				open ? rest.map(renderCard) : null,
				open && rest.length ? h('button', { className: 'at-groupmore', type: 'button', 'aria-expanded': true, onClick: () => setOpen(false) },
					h('span', { className: 'at-morelabel' }, tf(t, 'groupLess', { n: rest.length }))) : null,
			);
		}

		function StreamMessage({ t, item, data, tasks, selected, follows, onOpen, onToggleFollow }) {
			const author = item.author ?? {};
			const human = author.kind === 'human' || author.name === '你';
			const agent = agentFor(data, author.name);
			const cards = (item.taskIds ?? []).map((id) => tasks.find((task) => task.id === id)).filter(Boolean);
			return h('article', { className: cx('at-msg', human && 'at-msg-human') },
				h(Avatar, { name: author.name ?? (human ? '你' : '?'), human }),
				h('div', { className: 'at-msgb' },
					h('div', { className: 'at-msgh' },
						h('b', null, author.name ?? '—'),
						agent ? h('span', { className: 'at-role' }, agent.role) : null,
						h('time', { dateTime: iso(item.at) }, fmtTime(item.at)),
					),
					h('div', { className: 'at-msgt' }, item.body),
					cards.length ? h(TaskGroup, { t, cards, tasks, selected, follows, onOpen, onToggleFollow }) : null,
				));
		}

		function EmptyState({ t, icon, title, body, action, compact }) {
			return h('div', { className: cx('at-empty', compact && 'at-empty-compact'), role: 'status' },
				icon ? h('span', { className: 'at-emptyicon', 'aria-hidden': 'true' }, h(Ico, { name: icon, size: 28 })) : null,
				h('div', { className: 'at-emptytitle' }, title),
				body ? h('div', { className: 'at-emptybody' }, body) : null,
				action ? h('button', { className: 'at-btn', type: 'button', onClick: action.onClick }, action.label) : null);
		}

		function BoardColumn({ t, status, items, tasks, selected, follows, doneOpen, onToggleDone, onOpen, onToggleFollow }) {
			const meta = statusMeta(status);
			const isDone = status === 'done';
			const shown = isDone && !doneOpen ? [] : items;
			return h('section', { className: cx('at-col', 'at-col-' + status), role: 'group', 'aria-label': tf(t, 'columnAria', { title: t(meta.label), n: items.length }) },
				h('div', { className: 'at-colhead' },
					h('span', { className: 'at-coltitle' }, t(meta.label)),
					h('span', { className: 'at-colcount' }, items.length),
					isDone && items.length ? h('button', { className: 'at-coltoggle', type: 'button', 'aria-expanded': doneOpen, onClick: onToggleDone }, doneOpen ? t('collapseDone') : t('expandDone')) : null,
				),
				!items.length ? h('div', { className: 'at-colempty' }, t('emptyColumn')) : null,
				shown.map((card) => h(TaskCard, {
					key: card.id,
					t,
					card,
					tasks,
					variant: 'board',
					selected: selected === card.id,
					following: follows(card),
					onOpen,
					onToggleFollow,
				})));
		}

		function Board({ t, tasks, selected, follows, doneOpen, onToggleDone, onOpen, onToggleFollow, filter, onClearFilter, q1Extra, onBackMain }) {
			const filtered = filter === 'all' ? tasks : tasks.filter((task) => matchesFilter(task, filter));
			const filterName = filter === 'all' ? '' : t(filter === 'q1' ? 'q1Title' : filter === 'q2' ? 'q2Title' : filter === 'q3' ? 'q3Title' : 'q4Title');
			const bar = filter === 'all' ? null : h('div', { className: 'at-boardbar', role: 'status' },
				h('span', { className: 'at-filterchip' }, tf(t, 'filterLabel', { name: filterName }) + ' · ' + tf(t, 'itemCount', { n: filtered.length })),
				q1Extra > 0 ? h('span', { className: 'at-filternote' }, tf(t, 'filterInboxExtra', { n: q1Extra })) : null,
				h('button', { className: 'at-btn at-btn-quiet at-filterclear', type: 'button', onClick: onClearFilter }, t('filterClear')));
			if (!filtered.length) {
				return h('div', { className: 'at-boardwrap', role: 'tabpanel', id: 'at-panel-board', 'aria-labelledby': 'at-tab-board' },
					bar,
					filter === 'all'
						? h(EmptyState, {
							t,
							icon: 'board',
							title: t('emptyBoardTitle'),
							body: t('emptyBoardBody'),
							action: { label: t('emptyBoardAction'), onClick: onBackMain },
						})
						: h(EmptyState, {
							t,
							icon: 'board',
							title: t('filteredEmptyTitle'),
							body: t('filteredEmptyBody'),
							action: { label: t('filterClear'), onClick: onClearFilter },
						}));
			}
			return h('div', { className: 'at-boardwrap', role: 'tabpanel', id: 'at-panel-board', 'aria-labelledby': 'at-tab-board' },
				bar,
				h('div', { className: 'at-board' }, ['pending', 'in_progress', 'pending_acceptance', 'done'].map((status) => h(BoardColumn, {
					key: status,
					t,
					status,
					items: filtered.filter((task) => task.status === status),
					tasks,
					selected,
					follows,
					doneOpen: doneOpen,
					onToggleDone,
					onOpen,
					onToggleFollow,
				}))));
		}

		function ProjectRow({ t, project, active, onSelect }) {
			const onKeyDown = (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onSelect(project);
					return;
				}
				if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
				event.preventDefault();
				const nodes = Array.from(event.currentTarget.parentElement.querySelectorAll('[role="treeitem"]'));
				const index = nodes.indexOf(event.currentTarget);
				const next = nodes[index + (event.key === 'ArrowDown' ? 1 : -1)];
				if (next) next.focus();
			};
			return h('div', {
				className: cx('at-prow', active && 'at-on'),
				role: 'treeitem',
				'aria-level': 1,
				'aria-selected': Boolean(active),
				tabIndex: 0,
				title: project.name,
				onClick: () => onSelect(project),
				onKeyDown,
			},
			h('span', { className: 'at-hash', 'aria-hidden': 'true' }, '#'),
			h('span', { className: 'at-prowtitle' }, project.name));
		}

		function AgentRow({ t, agent, onAgent }) {
			const statusText = t(AGENT_STATUS[agent.status] ?? 'agentIdle');
			const config = agent.config ?? null;
			const model = config?.model ? config.model : t('agentDefaultModel');
			const context = Number.isFinite(config?.contextWindow) ? ' · ctx ' + Math.round(config.contextWindow / 1000) + 'k' : '';
			const version = Number.isFinite(agent.configVersion) && agent.configVersion > 0 ? ' · v' + agent.configVersion : '';
			const failure = agent.lastFailure ?? null;
			return h('div', { className: 'at-agent', role: 'listitem' },
				h('span', { className: 'at-dot at-dot-' + (agent.status ?? 'idle'), 'aria-hidden': 'true' }),
				h('div', { className: 'at-agentmeta' },
					h('button', { className: 'at-agentname', type: 'button', onClick: () => onAgent(agent), title: agent.name }, agent.name),
					h('div', { className: 'at-agentrole', title: agent.role ?? '' },
						agent.role ?? '',
						agent.qa ? h('span', { className: 'at-qabadge' }, 'QA') : null),
					h('div', {
						className: 'at-agentconfig',
						title: [model + context + version, failure ? tf(t, 'agentFailure', { category: failure.category, n: failure.attempt }) : ''].filter(Boolean).join(' · '),
					},
						h('span', null, model + context + version),
						failure ? h('span', { className: 'at-agentfail' }, t('agentFailureShort')) : null,
					),
				),
				h('span', { className: 'at-sr' }, statusText),
				h('button', {
					className: 'at-agentmore',
					type: 'button',
					'aria-label': tf(t, 'agentOpen', { name: agent.name }),
					title: t('moreActions'),
					onClick: () => onAgent(agent),
				}, '⋯'));
		}

		function LeftPanel({ t, data, projectId, scope, tab, inboxUnread, onBack, onInbox, onBoard, onProject, onNewProject, onAgent, onAddAgent, onRecruit }) {
			const projects = data.projects.filter((project) => !project.archived);
			const activeAgents = data.agents.filter((agent) => agent.status !== 'retired');
			const talentAgents = data.agents.filter((agent) => agent.status === 'retired');
			const archived = data.projects.filter((project) => project.archived);
			const boardActive = scope === 'project' && tab === 'board';
			return h('div', null,
				h('nav', { className: 'at-nav', 'aria-label': t('navAria') },
					h('button', { className: 'at-navrow', type: 'button', onClick: onBack }, h(Ico, { name: 'back' }), h('span', null, t('back'))),
					h('button', {
						className: cx('at-navrow', scope === 'inbox' && 'at-on'),
						type: 'button',
						'aria-current': scope === 'inbox' ? 'page' : undefined,
						'aria-label': inboxUnread ? tf(t, 'inboxUnread', { n: inboxUnread }) : t('inbox'),
						onClick: onInbox,
					}, h(Ico, { name: 'inbox' }), h('span', null, t('inbox')), inboxUnread > 0 ? h('span', { className: 'at-count' }, inboxUnread > 99 ? '99+' : inboxUnread) : null),
					h('button', {
						className: cx('at-navrow', boardActive && 'at-on'),
						type: 'button',
						'aria-current': boardActive ? 'page' : undefined,
						onClick: onBoard,
					}, h(Ico, { name: 'board' }), h('span', null, t('board'))),
				),
				h('div', { className: 'at-h' },
					h('span', null, t('projects')),
					h('button', { className: 'at-mini', type: 'button', 'aria-label': t('newProject'), title: t('newProject'), onClick: onNewProject }, h(Ico, { name: 'plus', size: 12 })),
				),
				projects.length
					? h('div', { className: 'at-tree', role: 'tree', 'aria-label': t('projectsAria') }, projects.map((project) => h(ProjectRow, {
						key: project.id,
						t,
						project,
						active: scope === 'project' && project.id === projectId,
						onSelect: onProject,
					})))
					: h('div', { className: 'at-colempty' }, t('projectEmptyTitle')),
				archived.length ? h('details', { className: 'at-archived' },
					h('summary', null, tf(t, 'archivedCount', { n: archived.length })),
					h('div', { className: 'at-tree', role: 'group', 'aria-label': t('projectsAria') }, archived.map((project) => h(ProjectRow, {
						key: project.id,
						t,
						project,
						active: false,
						onSelect: onProject,
					})))) : null,
				h('div', { className: 'at-h' },
					h('span', null, t('agents')),
					h('button', { className: 'at-mini', type: 'button', 'aria-label': t('addAgent'), title: t('addAgent'), onClick: onAddAgent }, h(Ico, { name: 'plus', size: 12 })),
				),
				activeAgents.length
					? h('div', { role: 'list', 'aria-label': t('agentsAria') }, activeAgents.map((agent) => h(AgentRow, { key: agent.id, t, agent, onAgent })))
					: h('div', { className: 'at-colempty' }, t('emptyColumn')),
				talentAgents.length ? h('details', { className: 'at-archived' },
					h('summary', null, tf(t, 'talentPoolCount', { n: talentAgents.length })),
					h('div', { role: 'list', 'aria-label': t('talentPool') }, talentAgents.map((agent) => h('div', { key: agent.id, className: 'at-agent at-talented' },
						h('div', { className: 'at-agentmeta' },
							h('span', { className: 'at-agentname' }, agent.name),
							h('div', { className: 'at-agentrole' }, agent.role ?? '', agent.qa ? h('span', { className: 'at-qabadge' }, 'QA') : null)),
						h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onRecruit(agent) }, t('recruit')))))) : null);
		}

		function ConvertForm({ t, project, task, thread, title, dod, onTitle, onDod, onCancel, onSubmit }) {
			const valid = Boolean(title.trim() && dod.trim());
			const onKeyDown = (event) => {
				if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
					event.preventDefault();
					if (valid) onSubmit();
				}
			};
			return h('form', {
				className: 'at-convert',
				role: 'dialog',
				'aria-labelledby': 'at-convert-title',
				onSubmit: (event) => { event.preventDefault(); if (valid) onSubmit(); },
				onKeyDown,
			},
			h('div', { className: 'at-converthead', id: 'at-convert-title' }, t('convertTitle')),
			h('label', { className: 'at-field' },
				h('span', null, t('titleLabel')),
				h('input', { value: title, maxLength: 80, autoFocus: true, placeholder: t('convertNamePlaceholder'), onChange: (event) => onTitle(event.target.value) })),
			h('div', { className: 'at-fieldrow' },
				h('div', { className: 'at-field' }, h('span', null, t('owner')), h('div', { className: 'at-staticfield', title: project?.owner ?? t('unassigned') }, project?.owner ?? t('unassigned'))),
				h('div', { className: 'at-field' }, h('span', null, t('executor')), h('div', { className: 'at-staticfield' }, t('unassigned')))),
			h('label', { className: 'at-field' },
				h('span', null, t('convertDod')),
				h('textarea', { value: dod, rows: 3, placeholder: t('convertDodPlaceholder'), onChange: (event) => onDod(event.target.value) })),
			h('div', { className: 'at-context' }, tf(t, 'convertContext', { n: taskNo(task), m: thread?.entries?.length ?? 0 })),
			h('div', { className: 'at-convertfoot' },
				h('button', { className: 'at-btn', type: 'button', onClick: onCancel }, t('convertCancel')),
				h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: !valid }, t('convertSubmit'))));
		}

		function AcceptancePanel({ t, task, checked, onChecked, onAccept, onChanges }) {
			const submission = task.submission ?? null;
			const evidence = Array.isArray(submission?.evidence) ? submission.evidence : [];
			return h('section', { className: 'at-accept', 'aria-labelledby': 'at-accept-title' },
				h('div', { className: 'at-accepthead' },
					h('span', { className: 'at-accepttitle', id: 'at-accept-title' }, t('acceptance')),
					h('span', { className: 'at-candidate' }, t('candidate')),
					h(StatusPill, { t, status: 'pending_acceptance' })),
				h('div', { className: 'at-kv' },
					h('span', { className: 'at-kvlabel' }, t('resultSummary')),
					h('div', { className: 'at-kvbody' }, submission?.summary ?? t('noSummary'))),
				h('div', { className: 'at-kv' },
					h('span', { className: 'at-kvlabel' }, t('evidence')),
					h('div', { className: 'at-kvbody' }, evidence.length
						? h('ul', { className: 'at-evidence' }, evidence.map((entry, index) => {
							const item = typeof entry === 'string' ? { label: entry, ref: '' } : entry;
							return h('li', { key: index }, h(Ico, { name: 'check', size: 12 }), h('span', null, item.label), item.ref ? h('code', null, item.ref) : null);
						}))
						: t('noEvidence'))),
				h('div', { className: 'at-kv' },
					h('span', { className: 'at-kvlabel' }, t('diff')),
					h('div', { className: 'at-kvbody' }, submission?.diffStat ?? t('noDiff'))),
				h('p', { className: 'at-elig' }, t('acceptEligible')),
				h('p', { className: 'at-steward' }, t('acceptSteward')),
				task.irreversible ? h('div', { className: 'at-irrev' },
					h('p', null, t('irreversibleNote')),
					h('label', { className: 'at-check' },
						h('input', { type: 'checkbox', checked, onChange: (event) => onChecked(event.target.checked) }),
						h('span', null, t('irreversibleCheck')))) : null,
				h('div', { className: 'at-acceptactions' },
					h('button', { className: 'at-btn', type: 'button', onClick: onChanges }, t('requestChanges')),
					h('button', {
						className: 'at-btn at-btn-primary',
						type: 'button',
						disabled: Boolean(task.irreversible && !checked),
						onClick: onAccept,
					}, task.irreversible ? t('acceptIrreversibleCta') : t('acceptCta'))));
		}

		function ConflictBanner({ t, thread, baseSeq, headSeq, onContinue, onContext }) {
			const changes = Array.isArray(thread?.changes) ? thread.changes.slice(0, 5) : [];
			return h('div', { className: 'at-conflict', role: 'alert' },
				h('div', { className: 'at-conflicttitle' }, t('conflictTitle')),
				h('div', { className: 'at-conflictnew' }, tf(t, 'conflictNew', { head: headSeq, n: headSeq - baseSeq })),
				changes.length ? h('ul', { className: 'at-conflictlist' }, changes.map((change) => h('li', { key: (change.seq ?? '') + ':' + (change.what ?? '') }, (change.who ?? '—') + ' #' + (change.seq ?? '') + ' ' + (change.what ?? '')))) : null,
				h('div', { className: 'at-conflictactions' },
					h('button', { className: 'at-btn at-btn-quiet', type: 'button', onClick: onContinue }, t('conflictContinue')),
					h('button', { className: 'at-btn at-btn-quiet', type: 'button', onClick: onContext }, t('conflictContext'))));
		}

		function DoneSummary({ t, task }) {
			const time = fmtDateTime(task.completedAt ?? task.updatedAt);
			const evidence = task.evidenceCount ?? task.submission?.evidence?.length;
			return h('section', { className: 'at-done' },
				h('div', { className: 'at-donehead' }, h(Ico, { name: 'check', size: 14 }), h('span', null, t('doneTitle'))),
				h('div', { className: 'at-donemeta' },
					time ? h('span', null, tf(t, 'doneAt', { time })) : null,
					task.acceptedBy ? h('span', null, tf(t, 'acceptedBy', { name: task.acceptedBy })) : null,
					evidence !== undefined ? h('span', null, tf(t, 'evidenceCount', { n: evidence })) : null),
				!time && !task.acceptedBy && evidence === undefined ? h('div', { className: 'at-donemeta' }, t('doneNoInfo')) : null,
				task.submission?.summary ? h('p', { className: 'at-donetext' }, task.submission.summary) : null);
		}

		function ThreadPanel({ t, task, thread, project, following, onToggleFollow, onClose, converting, convert, reply, onReplyChange, onReplySend, replyBase, onContinue, onContext, note, onDismissNote, acceptChecked, onAcceptChecked, onAccept, onChanges, actions, panelRef, replyRef }) {
			const headSeq = thread?.headSeq ?? thread?.entries?.length ?? 0;
			const stale = replyBase !== null && replyBase !== undefined && headSeq > replyBase;
			const entries = Array.isArray(thread?.entries) ? thread.entries : [];
			return h('aside', { className: 'at-right', role: 'complementary', 'aria-label': t('threadAria'), tabIndex: -1, ref: panelRef },
				h('div', { className: 'at-rhead' },
					h('div', { className: 'at-rh' },
						h('div', { className: 'at-rhmeta', title: t('thread') + ' · #' + taskNo(task) }, t('thread') + ' · #' + taskNo(task)),
						h('div', { className: 'at-rhtitle', title: task.title }, task.title)),
					h(FollowToggle, { t, taskNo: taskNo(task), following, onToggle: onToggleFollow }),
					h('button', { className: 'at-rbtn', type: 'button', 'aria-expanded': Boolean(converting), onClick: convert.onOpen }, t('convert')),
					h('button', { className: 'at-rbtn at-iconbtn', type: 'button', 'aria-label': t('closeThread'), title: t('closeThread'), onClick: onClose }, h(Ico, { name: 'close', size: 14 }))),
				note ? h('div', { className: 'at-rnote', role: 'status' },
					h('span', { className: 'at-notetext' }, note),
					h('button', { className: 'at-noteclose', type: 'button', 'aria-label': t('dismiss'), title: t('dismiss'), onClick: onDismissNote }, h(Ico, { name: 'close', size: 12 }))) : null,
				converting
					? h(ConvertForm, { t, project, task, thread, title: convert.title, dod: convert.dod, onTitle: convert.onTitle, onDod: convert.onDod, onCancel: convert.onCancel, onSubmit: convert.onSubmit })
					: h('div', { className: 'at-rbody' },
						stale ? h(ConflictBanner, { t, thread, baseSeq: replyBase, headSeq, onContinue, onContext }) : null,
						task.status === 'done' ? h(DoneSummary, { t, task }) : null,
						entries.length
							? h('div', { className: 'at-tmsgs' }, entries.map((message, index) => h('div', { key: message.seq ?? index, className: 'at-tmsg' },
								h('div', { className: 'at-tmh' },
									h('b', null, message.author ?? '—'),
									h('span', { className: 'at-tseq' }, '#' + (message.seq ?? index + 1)),
									h('time', { dateTime: iso(message.at) }, fmtTime(message.at))),
								h('div', { className: 'at-tmt' }, message.body))))
							: h(EmptyState, { t, compact: true, title: t('threadEmptyTitle'), body: t('threadEmptyBody') }),
						task.status === 'pending_acceptance' ? h(AcceptancePanel, {
							t,
							task,
							checked: acceptChecked,
							onChecked: onAcceptChecked,
							onAccept,
							onChanges,
						}) : null,
						actions.length ? h('section', { className: 'at-actions', 'aria-label': t('taskActions') },
							h('div', { className: 'at-actionhead' },
								h('span', { className: 'at-actiontitle' }, t('taskActions')),
								h('span', { className: 'at-mocktag' }, t('mockOnly'))),
							h('div', { className: 'at-actionrow' }, actions.map((action) => h('button', {
								key: action.label,
								className: 'at-btn at-btn-quiet',
								type: 'button',
								onClick: action.onClick,
							}, action.label)))) : null),
				!converting ? h('div', { className: 'at-rfoot' },
					h('div', { className: 'at-box at-rbox' },
						h('textarea', {
							value: reply,
							rows: 2,
							ref: replyRef,
							placeholder: t('reply'),
							'aria-label': t('reply'),
							onChange: (event) => onReplyChange(event.target.value),
							onKeyDown: (event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
									event.preventDefault();
									onReplySend();
								}
							},
						}),
						h('div', { className: 'at-barrow' },
							h('span', { className: 'at-hint' }, headSeq ? tf(t, 'replyHint', { seq: replyBase ?? headSeq }) : t('replyHintNew')),
							h('button', { className: 'at-send', type: 'button', disabled: !reply.trim(), onClick: onReplySend }, t('send'))))) : null);
		}

		function Composer({ t, mode, draft, disabled, onMode, onDraft, onSend }) {
			const send = () => { if (draft.trim() && !disabled) onSend(); };
			return h('div', { className: 'at-composer' },
				h('div', { className: 'at-composerinner' },
					h('div', { className: cx('at-box', 'at-composerbox', mode === 'task' && 'at-taskmode') },
						h('textarea', {
							value: draft,
							rows: 2,
							disabled,
							placeholder: mode === 'task' ? t('taskPlaceholder') : t('composer'),
							'aria-label': t('composerAria'),
							onChange: (event) => onDraft(event.target.value),
							onKeyDown: (event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
									event.preventDefault();
									send();
								}
							},
						}),
						h('div', { className: 'at-barrow' },
							h('div', { className: 'at-mode', role: 'group', 'aria-label': t('modeAria') },
								h('button', { type: 'button', 'aria-pressed': mode === 'discuss', onClick: () => onMode('discuss') }, t('discuss')),
								h('button', { type: 'button', 'aria-pressed': mode === 'task', onClick: () => onMode('task') }, t('taskMode'))),
							h('span', { className: 'at-hint' }, t('enterHint')),
							h('button', { className: 'at-send', type: 'button', disabled: disabled || !draft.trim(), onClick: send }, mode === 'task' ? t('createTask') : t('send'))))));
		}

		function QuadrantCard({ t, meta, quadrant, tasks, items, count, onItem, onViewAll }) {
			const shown = items.slice(0, 5);
			const title = t(quadrant.name);
			return h('section', { className: cx('at-quad', 'at-quad-' + quadrant.key), role: 'group', 'aria-label': title + '，' + tf(t, 'itemCount', { n: count }) },
				h('div', { className: 'at-quadhead' },
					h('span', { className: 'at-qname' }, title),
					h('span', { className: 'at-qcount' }, count)),
				h('div', { className: 'at-qdef' }, t(quadrant.def)),
				quadrant.key === 'q4' && meta && meta.total > meta.count ? h('div', { className: 'at-qtotal' }, tf(t, 'q4Total', { n: meta.count, m: meta.total })) : null,
				shown.length
					? h('div', { className: 'at-qlist' }, shown.map((item) => {
						const blocked = (item.blockedBy ?? []).map((id) => {
							const dep = tasks.find((task) => task.id === id);
							return '#' + taskNo(dep ?? { id });
						});
						const category = t(CATEGORY_LABEL[item.category] ?? 'catBlocked');
						const parts = [category];
						if (quadrant.key === 'q3') {
							if (blocked.length) parts.push(tf(t, 'waitOn', { ref: blocked.join('、') }));
							else if (item.handoffTo) parts.push(tf(t, 'waitOn', { ref: '@' + item.handoffTo }));
							else parts.push(t('waitDependency'));
						} else if (quadrant.key === 'q4') {
							if (item.doneAt) parts.push(fmtTime(item.doneAt));
							if (item.acceptedBy) parts.push(tf(t, 'acceptedBy', { name: item.acceptedBy }));
						} else if (item.assigneeName) {
							parts.push(item.assigneeName);
						} else if (item.ownerName) {
							parts.push(item.ownerName);
						}
						const itemTitle = (item.taskNumber !== undefined ? '#' + item.taskNumber + ' ' : '') + item.title;
						const onKeyDown = (event) => {
							if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
							event.preventDefault();
							const nodes = Array.from(event.currentTarget.parentElement.querySelectorAll('[data-qitem]'));
							const index = nodes.indexOf(event.currentTarget);
							const next = nodes[index + (event.key === 'ArrowDown' ? 1 : -1)];
							if (next) next.focus();
						};
						return h('button', {
							key: item.id,
							className: 'at-qitem',
							type: 'button',
							'data-qitem': 'true',
							title: itemTitle,
							onClick: (event) => onItem(item, event),
							onKeyDown,
						},
						h('span', { className: 'at-qitemicon', 'aria-hidden': 'true' }, h(Ico, { name: quadrant.icon, size: 12 })),
						h('span', { className: 'at-qitembody' },
							h('span', { className: 'at-qtitle' }, itemTitle),
							h('span', { className: 'at-qitemmeta' }, parts.join(' · '))));
					}))
					: h('div', { className: 'at-qempty' }, t(quadrant.empty)),
				h('div', { className: 'at-qfoot' },
					h('button', { className: 'at-qmore', type: 'button', disabled: count === 0, onClick: () => onViewAll(quadrant.key) }, t('viewAll'))));
		}

		function Situation({ t, quadrants, tasks, onItem, onViewAll }) {
			return h('div', { className: 'at-situation', role: 'tabpanel', id: 'at-panel-situation', 'aria-labelledby': 'at-tab-situation' },
				h('div', { className: 'at-situationinner' },
					h('div', { className: 'at-qmeta' },
						h('span', null, tf(t, 'quadrantMeta', { time: fmtTime(quadrants.generatedAt) })),
						quadrants.rev ? h('span', null, 'rev ' + quadrants.rev) : null),
					h('div', { className: 'at-quadrants' }, QUADRANTS.map((quadrant) => {
						const block = quadrants[quadrant.key] ?? { count: 0, items: [] };
						return h(QuadrantCard, {
							key: quadrant.key,
							t,
							meta: block,
							quadrant,
							tasks,
							items: Array.isArray(block.items) ? block.items : [],
							count: block.count ?? (block.items?.length ?? 0),
							onItem,
							onViewAll,
						});
					}))));
		}

		function Skeleton({ t }) {
			return h('div', { className: 'at-root', 'aria-busy': 'true' },
				h('div', { className: 'at-top' },
					h('span', { className: 'at-brand' }, t('panel')),
					h('span', { className: 'at-spike' }, t('spike')),
					h('span', { className: 'at-sr', role: 'status' }, t('loading'))),
				h('div', { className: 'at-grid' },
					h('aside', { className: 'at-left' }, [0, 1, 2, 3, 4, 5].map((index) => h('div', { key: index, className: 'at-skel at-skel-line' }))),
					h('main', { className: 'at-center' },
						h('div', { className: 'at-chead' }, h('div', { className: 'at-skel at-skel-title' })),
						h('div', { className: 'at-stream' },
							h('div', { className: 'at-streaminner' },
								h('div', { className: 'at-skel at-skel-msg' }),
								h('div', { className: 'at-skel at-skel-msg' }),
								h('div', { className: 'at-skel at-skel-card' }))))));
		}

		class Boundary extends React.Component {
			constructor(props) { super(props); this.state = { error: null }; }
			static getDerivedStateFromError(error) { return { error }; }
			render() {
				if (this.state.error === null) return this.props.children;
				const t = typeof this.props.t === 'function' ? this.props.t : (key) => key;
				return h('div', { className: 'at-crash', role: 'alert' },
					h('div', { className: 'at-crashtitle' }, t('crashTitle')),
					h('pre', { className: 'at-crashbody' }, String(this.state.error?.message ?? this.state.error)),
					h('button', { className: 'at-btn at-btn-primary', type: 'button', onClick: () => this.setState({ error: null }) }, t('retry')));
			}
		}

		function Workbench({ t, ctx }) {
			const [phase, setPhase] = React.useState('loading');
			const [data, setData] = React.useState(null);
			const [projectId, setProjectId] = React.useState('');
			const [scope, setScope] = React.useState('project');
			const [tab, setTab] = React.useState('main');
			const [selected, setSelected] = React.useState('');
			const [threadOpen, setThreadOpen] = React.useState(false);
			const [mode, setMode] = React.useState('discuss');
			const [draft, setDraft] = React.useState('');
			const [note, setNote] = React.useState('');
			const [rightNote, setRightNote] = React.useState('');
			const [reply, setReply] = React.useState('');
			const [follows, setFollows] = React.useState({});
			const [doneOpen, setDoneOpen] = React.useState(false);
			const [boardFilter, setBoardFilter] = React.useState('all');
			const [converting, setConverting] = React.useState(false);
			const [cTitle, setCTitle] = React.useState('');
			const [cDod, setCDod] = React.useState('');
			const [acceptChecked, setAcceptChecked] = React.useState(false);
			const [addOpen, setAddOpen] = React.useState(false);
			const [mName, setMName] = React.useState('');
			const [mRole, setMRole] = React.useState('');
			const [mPrompt, setMPrompt] = React.useState('');
			const [mProvider, setMProvider] = React.useState('');
			const [mModel, setMModel] = React.useState('');
			const [mOwner, setMOwner] = React.useState(false);
			const [mBusy, setMBusy] = React.useState(false);
			const [mError, setMError] = React.useState('');
			const [profileAgent, setProfileAgent] = React.useState(null);
			const [pName, setPName] = React.useState('');
			const [pRole, setPRole] = React.useState('');
			const [pPersonality, setPPersonality] = React.useState('');
			const [pSuccessor, setPSuccessor] = React.useState('');
			const [pBusy, setPBusy] = React.useState(false);
			const [pError, setPError] = React.useState('');
			const [replyBase, setReplyBase] = React.useState(null);
			const rightRef = React.useRef(null);
			const replyRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const mobileRef = React.useRef(null);

			React.useEffect(() => {
				let alive = true;
				const controller = typeof AbortController === 'function' ? new AbortController() : null;
				// The package is @suifei/dsh-ai-team; the Host prefix is /ai-team.
				const paths = ['/ai-team/api/bootstrap'];
				async function load() {
					let lastError = null;
					for (const path of paths) {
						try {
							const response = await fetch(path, {
								headers: { accept: 'application/json' },
								signal: controller ? controller.signal : undefined,
							});
							if (!response.ok) {
								lastError = new Error('HTTP ' + response.status + ' for ' + path);
								continue;
							}
							const next = normalizePayload(await response.json());
							if (!next) {
								lastError = new Error('invalid bootstrap payload from ' + path);
								continue;
							}
							if (!alive) return;
							setData(next);
							setPhase('ready');
							return;
						} catch (error) {
							lastError = error;
							if (!alive || (controller && controller.signal.aborted)) return;
						}
					}
					if (!alive) return;
					console.error(PKG + ': bootstrap unavailable, using embedded demo data', lastError);
					setData(MOCK);
					setPhase('fallback');
				}
				load();
				// Event-driven refresh only; the Host sends one frame per command and
				// no heartbeat/timer. EventSource reconnects on its own.
				const source = typeof EventSource === 'function'
					? new EventSource('/ai-team/api/projects/prj_main/events')
					: null;
				if (source) source.addEventListener('change', () => { if (alive) load(); });
				return () => {
					alive = false;
					if (controller) controller.abort();
					if (source) source.close();
				};
			}, []);

			React.useEffect(() => {
				if (!data) return;
				if (!data.projects.some((project) => project.id === projectId)) {
					const active = data.projects.find((project) => project.active);
					setProjectId(active?.id ?? data.projects[0]?.id ?? '');
				}
				if (selected && !data.tasks.some((task) => task.id === selected)) {
					setSelected(data.tasks[0]?.id ?? '');
				}
				if (!selected && data.tasks[0]) setSelected(data.tasks[0].id);
			}, [data, projectId, selected]);

			React.useEffect(() => {
				const thread = threadFor(data, selected);
				setReplyBase(thread?.baseSeq ?? null);
				setAcceptChecked(false);
				setConverting(false);
				setCTitle('');
				setCDod('');
				setRightNote('');
			}, [selected, data]);

			React.useEffect(() => {
				if (!threadOpen) return;
				const node = replyRef.current ?? rightRef.current;
				if (node && typeof node.focus === 'function') node.focus({ preventScroll: true });
			}, [threadOpen, selected]);

			function closeThread() {
				setThreadOpen(false);
				setConverting(false);
				setRightNote('');
				const node = triggerRef.current;
				const focus = () => { try { if (node && node.isConnected) node.focus({ preventScroll: true }); } catch { /* ignore */ } };
				if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus); else focus();
			}

			React.useEffect(() => {
				if (!threadOpen) return undefined;
				const onKey = (event) => {
					if (event.key !== 'Escape') return;
					event.preventDefault();
					event.stopPropagation();
					if (converting) { setConverting(false); return; }
					closeThread();
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [threadOpen, converting]);

			if (phase === 'loading' || !data) return h(Skeleton, { t });

			const project = data.projects.find((item) => item.id === projectId) ?? data.projects[0] ?? null;
			const tasks = data.tasks;
			const selectedTask = tasks.find((task) => task.id === selected) ?? tasks[0] ?? null;
			const thread = threadFor(data, selectedTask?.id);
			const quadrants = deriveQuadrants(data);
			const inboxUnread = Number.isFinite(data.inboxUnread)
				? data.inboxUnread
				: (data.inbox ?? []).filter((item) => !item.read).length;
			const q1Extra = (quadrants.q1.items ?? []).filter((item) => item.kind === 'inbox').length;
			const threadHead = thread?.headSeq ?? thread?.entries?.length ?? 0;
			const followingOf = (card) => (Object.prototype.hasOwnProperty.call(follows, card.id) ? follows[card.id] : Boolean(card.following));

			function say(text) { setNote(text); }
			function sayRight(text) { setRightNote(text); }
			function toggleFollow(card) {
				if (!card) return;
				const next = !followingOf(card);
				setFollows((prev) => ({ ...prev, [card.id]: next }));
				const text = next ? tf(t, 'followMock', { n: taskNo(card) }) : tf(t, 'unfollowMock', { n: taskNo(card) });
				if (threadOpen && selectedTask && selectedTask.id === card.id) sayRight(text); else say(text);
			}
			function openTask(card, event) {
				if (!card) return;
				if (event && event.currentTarget) triggerRef.current = event.currentTarget;
				setSelected(card.id);
				setThreadOpen(true);
				setRightNote('');
			}
			function openTaskById(taskId, event) {
				const card = tasks.find((item) => item.id === taskId);
				if (!card) { say(t('quadrantMissing')); return; }
				triggerRef.current = event?.currentTarget ?? null;
				setSelected(card.id);
				setThreadOpen(true);
				setRightNote('');
			}
			function openQuadrantItem(item, event) {
				if (item?.taskId) openTaskById(item.taskId, event);
				else if (item?.kind === 'inbox') say(t('decisionMock'));
				else say(t('quadrantMissing'));
			}
			function viewQuadrant(key) {
				setBoardFilter(key);
				setTab('board');
				setNote('');
				if (key === 'q4') setDoneOpen(true);
			}
			function goConversation() {
				try {
					if (ctx?.layout && typeof ctx.layout.selectPanel === 'function') {
						ctx.layout.selectPanel('conversation');
						return;
					}
				} catch { /* host without layout */ }
				say(t('conversationMock'));
			}
			function closeMobile() {
				const node = mobileRef.current;
				if (node) node.open = false;
			}
			function switchInbox() {
				closeMobile();
				setScope('inbox');
				setThreadOpen(false);
				setNote('');
			}
			function switchBoard() {
				closeMobile();
				setScope('project');
				setTab('board');
				setBoardFilter('all');
				setNote('');
			}
			function switchProject(next) {
				closeMobile();
				if (next.id === projectId && scope === 'project') return;
				setProjectId(next.id);
				setScope('project');
				setTab('main');
				setBoardFilter('all');
				setThreadOpen(false);
				setReply('');
				say(next.archived ? t('archivedMock') : t('projectSwitchMock'));
			}
			function selectTab(next) {
				setTab(next);
				setNote('');
			}
			function tabKeyDown(event) {
				const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
				if (!keys.includes(event.key)) return;
				event.preventDefault();
				const index = TABS.indexOf(tab);
				let next = null;
				if (event.key === 'Home') next = TABS[0];
				if (event.key === 'End') next = TABS[TABS.length - 1];
				if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
				if (event.key === 'ArrowLeft') next = TABS[(index + TABS.length - 1) % TABS.length];
				if (!next) return;
				setTab(next);
				const buttons = event.currentTarget.querySelectorAll('[role="tab"]');
				buttons.forEach((button) => { if (button.dataset.tab === next) button.focus(); });
			}
			async function reloadData() {
				const response = await fetch('/ai-team/api/bootstrap', { headers: { accept: 'application/json' } });
				if (!response.ok) throw new Error('HTTP ' + response.status);
				const next = normalizePayload(await response.json());
				if (next) setData(next);
			}
			async function runCommand(type, payload) {
				const target = projectId || 'prj_main';
				const response = await fetch('/ai-team/api/projects/' + encodeURIComponent(target) + '/commands', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ type, payload }),
				});
				const body = await response.json().catch(() => null);
				if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
				return body;
			}
			function openAddAgent() {
				const defaults = data?.runtime?.defaultModel ?? {};
				setMName('');
				setMRole('');
				setMPrompt('');
				setMProvider(defaults.provider ?? '');
				setMModel(defaults.model ?? '');
				setMOwner((data?.agents ?? []).length === 0);
				setMError('');
				setAddOpen(true);
			}
			async function createAgent() {
				if (!mName.trim() || mBusy) return;
				setMBusy(true);
				setMError('');
				try {
					const added = await runCommand('member.add', {
						name: mName.trim(),
						role: mRole.trim(),
						kind: 'agent',
						status: 'provisioning',
					});
					const memberId = added.member.id;
					if (mProvider.trim() || mModel.trim()) {
						await runCommand('member.config.update', {
							memberId,
							patch: {
								...(mProvider.trim() ? { provider: mProvider.trim() } : {}),
								...(mModel.trim() ? { model: mModel.trim() } : {}),
							},
							reason: 'workbench add member',
						});
					}
					await runCommand('member.activate', {
						memberId,
						prompt: mPrompt.trim() || (mOwner
							? '你是 Project owner。等待 Human 的 Main stream 消息；收到后用 team 工具 create 开卡并推进。不要修改无关文件。'
							: '你已加入 AI Team。等待 Team event；先读 tasks/inbox，再行动。不要修改无关文件。'),
					});
					if (mOwner) {
						await runCommand('project.owner.update', { ownerMemberId: memberId, reason: 'workbench add member' });
					}
					setAddOpen(false);
					say(t('memberAdded'));
					await reloadData();
				} catch (error) {
					setMError(error?.message ?? String(error));
				} finally {
					setMBusy(false);
				}
			}
			function openProfile(agent) {
				setProfileAgent(agent);
				setPName(agent.name ?? '');
				setPRole(agent.role ?? '');
				setPPersonality(agent.personality ?? '');
				const successor = (data?.agents ?? []).find((candidate) => candidate.id !== agent.id && candidate.status !== 'retired');
				setPSuccessor(successor?.id ?? '');
				setPError('');
			}
			async function saveProfile() {
				if (!profileAgent || pBusy) return;
				setPBusy(true);
				setPError('');
				try {
					await runCommand('member.profile.update', {
						memberId: profileAgent.id,
						name: pName.trim(),
						role: pRole.trim(),
						personality: pPersonality,
						reason: 'workbench profile',
					});
					setProfileAgent(null);
					say(t('profileSaved'));
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				} finally {
					setPBusy(false);
				}
			}
			async function distillProfile() {
				if (!profileAgent || pBusy) return;
				setPBusy(true);
				setPError('');
				try {
					await runCommand('member.distill', {
						memberId: profileAgent.id,
						personality: pPersonality,
						reason: 'workbench re-distill',
					});
					say(t('profileDistilled'));
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				} finally {
					setPBusy(false);
				}
			}
			async function leaveProfile() {
				if (!profileAgent || pBusy) return;
				if (typeof window.confirm === 'function' && !window.confirm(t('leaveConfirm'))) return;
				setPBusy(true);
				setPError('');
				try {
					const result = await runCommand('member.leave', { memberId: profileAgent.id, reason: 'workbench leave' });
					const unfinished = result.unfinishedTasks ?? [];
					let handed = 0;
					if (pSuccessor && unfinished.length > 0) {
						const taken = await runCommand('member.takeover', {
							fromMemberId: profileAgent.id,
							toMemberId: pSuccessor,
							reason: 'workbench successor',
						});
						handed = taken.tasks?.length ?? 0;
					}
					setProfileAgent(null);
					say(handed > 0 ? tf(t, 'leftTeamHanded', { n: handed }) : tf(t, 'leftTeam', { n: unfinished.length }));
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				} finally {
					setPBusy(false);
				}
			}
			async function recruit(agent) {
				try {
					await runCommand('member.rejoin', { memberId: agent.id, reason: 'workbench recruit' });
					await runCommand('member.activate', {
						memberId: agent.id,
						prompt: '你从人才库回到团队。先读 tasks/inbox；若有遗留工作，由 Human/新 owner 决定是否接手。不要修改无关文件。',
					});
					say(t('recruited'));
					await reloadData();
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function send() {
				const text = draft.trim();
				if (!text) return;
				try {
					if (mode === 'task') {
						await runCommand('task.create', { title: text, resultDefinition: text });
					} else {
						await runCommand('stream.post', { body: text });
					}
					setDraft('');
					say(mode === 'task' ? t('taskSent') : t('discussSent'));
					await reloadData();
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			function sendReply() {
				const text = reply.trim();
				if (!text) return;
				sayRight(threadHead ? tf(t, 'replyMock', { seq: replyBase ?? threadHead }) : t('replyMockNew'));
				setReply('');
			}
			function openConvert() {
				if (converting) { setConverting(false); return; }
				if (!selectedTask) return;
				if (!cTitle.trim()) {
					const source = thread?.entries?.[0]?.body ?? selectedTask.title;
					setCTitle(firstSentence(source).slice(0, 40));
				}
				setConverting(true);
			}
			function submitConvert() {
				if (!selectedTask || !cTitle.trim() || !cDod.trim()) return;
				sayRight(tf(t, 'convertMock', { n: taskNo(selectedTask) }));
				setConverting(false);
				setCTitle('');
				setCDod('');
			}
			function acceptTask() {
				if (!selectedTask) return;
				sayRight(tf(t, 'acceptMock', { n: taskNo(selectedTask) }));
			}
			function requestChanges() {
				sayRight(t('changesMock'));
			}
			function mockAction(action) {
				sayRight(tf(t, 'actionMock', { action }));
			}
			function continueFromLatest() {
				const latest = threadHead;
				setReplyBase(latest);
				sayRight(tf(t, 'conflictContinueMock', { head: latest }));
			}
			function contextAtBase() {
				sayRight(tf(t, 'conflictContextMock', { base: replyBase ?? 0 }));
			}

			const actions = [];
			if (selectedTask) {
				const status = selectedTask.status;
				if (status !== 'done' && status !== 'cancelled') actions.push({ label: t('actCancel'), onClick: () => mockAction(t('actCancel')) });
				if (status === 'done' || status === 'pending_acceptance') actions.push({ label: t('actReopen'), onClick: () => mockAction(t('actReopen')) });
				if (status !== 'done' && status !== 'cancelled') actions.push({ label: t('actReassign'), onClick: () => mockAction(t('actReassign')) });
				if (selectedTask.assignee && status !== 'done' && status !== 'cancelled') actions.push({ label: t('actHandoff'), onClick: () => mockAction(t('actHandoff')) });
				if (status === 'pending' && !selectedTask.assignee && !selectedTask.replies) actions.push({ label: t('actDelete'), onClick: () => mockAction(t('actDelete')) });
			}

			const inInbox = scope === 'inbox';
			const headerTitle = inInbox ? t('inboxTitle') : project ? '# ' + project.name : t('noProject');
			const headerGoal = inInbox ? t('inboxGoal') : (project?.goal ?? '');
			const unread = inboxUnread > 99 ? '99+' : inboxUnread;

			const leftProps = {
				t,
				data,
				projectId,
				scope,
				tab,
				inboxUnread,
				onBack: () => { closeMobile(); goConversation(); },
				onInbox: switchInbox,
				onBoard: switchBoard,
				onProject: switchProject,
				onNewProject: () => { closeMobile(); say(t('newProjectMock')); },
				onAgent: (agent) => { closeMobile(); openProfile(agent); },
				onAddAgent: () => { closeMobile(); openAddAgent(); },
				onRecruit: (agent) => { closeMobile(); recruit(agent); },
			};

			const body = inInbox
				? h('div', { className: 'at-situation' },
					h(EmptyState, {
						t,
						icon: 'inbox',
						title: t('inboxEmptyTitle'),
						body: t('inboxEmptyBody'),
						action: { label: t('inboxEmptyAction'), onClick: switchBoard },
					}))
				: tab === 'board'
					? h(Board, {
						t,
						tasks,
						selected,
						follows: followingOf,
						doneOpen,
						onToggleDone: () => setDoneOpen((value) => !value),
						onOpen: openTask,
						onToggleFollow: toggleFollow,
						filter: boardFilter,
						onClearFilter: () => setBoardFilter('all'),
						q1Extra,
						onBackMain: () => setTab('main'),
					})
					: tab === 'situation'
						? h(Situation, { t, quadrants, tasks, onItem: openQuadrantItem, onViewAll: viewQuadrant })
						: h('div', { className: 'at-stream', role: 'tabpanel', id: 'at-panel-main', 'aria-labelledby': 'at-tab-main' },
							h('div', { className: 'at-streaminner', role: 'log', 'aria-live': 'polite', 'aria-label': t('streamAria') },
								data.stream.length
									? data.stream.map((item) => h(StreamMessage, {
										key: item.id,
										t,
										item,
										data,
										tasks,
										selected,
										follows: followingOf,
										onOpen: openTask,
										onToggleFollow: toggleFollow,
									}))
									: h(EmptyState, {
										t,
										title: t('emptyStreamTitle'),
										body: t('emptyStreamBody'),
										action: { label: t('fillExample'), onClick: () => setDraft(t('emptyStreamExample')) },
									})));

			return h('div', { className: 'at-root', role: 'region', 'aria-label': t('panel') },
				h('div', { className: 'at-top' },
					h('span', { className: 'at-brand' }, t('panel')),
					h('span', { className: 'at-spike', title: t('spikeTitle') }, t('spike')),
					h('details', { className: 'at-mobile', ref: mobileRef },
						h('summary', { className: 'at-mobilesummary', 'aria-label': t('menuAria') }, h(Ico, { name: 'menu', size: 14 }), h('span', null, t('menu'))),
						h('div', { className: 'at-mobilepop' }, h(LeftPanel, leftProps))),
					h('span', { className: 'at-topproject', title: headerTitle }, inInbox ? t('inboxTitle') + (unread ? ' · ' + unread : '') : (project?.name ?? ''))),
				h('div', { className: cx('at-grid', threadOpen && selectedTask && 'at-withthread') },
					h('aside', { className: 'at-left', role: 'region', 'aria-label': t('projectsAria') }, h(LeftPanel, leftProps)),
					h('main', { className: 'at-center' },
						h('header', { className: 'at-chead' },
							h('div', { className: 'at-title', title: headerTitle }, headerTitle),
							headerGoal ? h('div', { className: 'at-goal', title: headerGoal }, headerGoal) : null,
							inInbox ? null : h('div', { className: 'at-tabs', role: 'tablist', 'aria-label': t('tabsAria'), onKeyDown: tabKeyDown },
								h('button', {
									className: cx('at-tab', tab === 'main' && 'at-on'),
									type: 'button',
									role: 'tab',
									id: 'at-tab-main',
									'data-tab': 'main',
									'aria-selected': tab === 'main',
									'aria-controls': 'at-panel-main',
									tabIndex: tab === 'main' ? 0 : -1,
									onClick: () => selectTab('main'),
								}, t('main')),
								h('button', {
									className: cx('at-tab', tab === 'board' && 'at-on'),
									type: 'button',
									role: 'tab',
									id: 'at-tab-board',
									'data-tab': 'board',
									'aria-selected': tab === 'board',
									'aria-controls': 'at-panel-board',
									tabIndex: tab === 'board' ? 0 : -1,
									onClick: () => selectTab('board'),
								}, t('boardTab'), h('span', { className: 'at-tabcount' }, tasks.length)),
								h('button', {
									className: cx('at-tab', tab === 'situation' && 'at-on'),
									type: 'button',
									role: 'tab',
									id: 'at-tab-situation',
									'data-tab': 'situation',
									'aria-selected': tab === 'situation',
									'aria-controls': 'at-panel-situation',
									tabIndex: tab === 'situation' ? 0 : -1,
									onClick: () => selectTab('situation'),
								}, t('tabSituation')))),
						phase === 'fallback' ? h('div', { className: 'at-banner', role: 'note' }, h('b', null, t('fallbackTitle') + ' · '), h('span', null, t('fallbackBody'))) : null,
						note ? h('div', { className: 'at-notewrap' },
							h('div', { className: 'at-note', role: 'status' },
								h('span', { className: 'at-notetext' }, note),
								h('button', { className: 'at-noteclose', type: 'button', 'aria-label': t('dismiss'), title: t('dismiss'), onClick: () => setNote('') }, h(Ico, { name: 'close', size: 12 })))) : null,
						body,
						!inInbox && tab === 'main' ? h(Composer, {
							t,
							mode,
							draft,
							disabled: !project,
							onMode: setMode,
							onDraft: setDraft,
							onSend: send,
						}) : null),
					threadOpen && selectedTask ? h(ThreadPanel, {
						t,
						task: selectedTask,
						thread,
						project,
						following: followingOf(selectedTask),
						onToggleFollow: () => toggleFollow(selectedTask),
						onClose: closeThread,
						converting,
						convert: {
							onOpen: openConvert,
							title: cTitle,
							dod: cDod,
							onTitle: setCTitle,
							onDod: setCDod,
							onCancel: () => setConverting(false),
							onSubmit: submitConvert,
						},
						reply,
						onReplyChange: setReply,
						onReplySend: sendReply,
						replyBase,
						onContinue: continueFromLatest,
						onContext: contextAtBase,
						note: rightNote,
						onDismissNote: () => setRightNote(''),
						acceptChecked,
						onAcceptChecked: setAcceptChecked,
						onAccept: acceptTask,
						onChanges: requestChanges,
						actions,
						panelRef: rightRef,
						replyRef,
					}) : null,
					addOpen ? h('div', { className: 'at-modalback' },
						h('form', {
							className: 'at-modal',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('addAgentTitle'),
							onSubmit: (event) => { event.preventDefault(); createAgent(); },
						},
							h('h2', { className: 'at-modaltitle' }, t('addAgentTitle')),
							h('label', { className: 'at-field' }, h('span', null, t('memberName')),
								h('input', { value: mName, onChange: (event) => setMName(event.target.value), autoFocus: true })),
							h('label', { className: 'at-field' }, h('span', null, t('memberRole')),
								h('input', { value: mRole, onChange: (event) => setMRole(event.target.value) })),
							h('label', { className: 'at-field' }, h('span', null, t('memberPrompt')),
								h('textarea', {
									value: mPrompt,
									onChange: (event) => setMPrompt(event.target.value),
									placeholder: t('memberPromptHint'),
								})),
							h('div', { className: 'at-fieldrow' },
								h('label', { className: 'at-field' }, h('span', null, t('memberProvider')),
									h('input', { value: mProvider, onChange: (event) => setMProvider(event.target.value), placeholder: 'deepseek-account' })),
								h('label', { className: 'at-field' }, h('span', null, t('memberModel')),
									h('input', { value: mModel, onChange: (event) => setMModel(event.target.value), placeholder: 'deepseek-flash' }))),
							h('label', { className: 'at-check' },
								h('input', { type: 'checkbox', checked: mOwner, onChange: (event) => setMOwner(event.target.checked) }),
								h('span', null, t('memberOwner'))),
							mError ? h('div', { className: 'at-modalerror', role: 'alert' }, mError) : null,
							h('div', { className: 'at-modalactions' },
								h('button', { className: 'at-btn', type: 'button', onClick: () => setAddOpen(false), disabled: mBusy }, t('cancel')),
								h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: mBusy || !mName.trim() }, mBusy ? t('memberAdding') : t('memberCreate'))))) : null,
					profileAgent ? h('div', { className: 'at-modalback' },
						h('form', {
							className: 'at-modal',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('memberProfileTitle'),
							onSubmit: (event) => { event.preventDefault(); saveProfile(); },
						},
							h('h2', { className: 'at-modaltitle' }, tf(t, 'memberProfileTitleName', { name: profileAgent.name })),
							h('div', { className: 'at-modalmeta' },
							tf(t, 'memberProfileMeta', {
								status: t(AGENT_STATUS[profileAgent.status] ?? 'agentIdle'),
								version: profileAgent.profileVersion ?? 1,
								distill: profileAgent.distillVersion ?? 0,
							})),
							h('label', { className: 'at-field' }, h('span', null, t('memberName')),
								h('input', { value: pName, onChange: (event) => setPName(event.target.value), autoFocus: true })),
							h('label', { className: 'at-field' }, h('span', null, t('memberRole')),
								h('input', { value: pRole, onChange: (event) => setPRole(event.target.value) })),
							h('label', { className: 'at-field' }, h('span', null, t('memberPersonality')),
								h('textarea', { value: pPersonality, onChange: (event) => setPPersonality(event.target.value) })),
							h('label', { className: 'at-field' }, h('span', null, t('successor')),
								h('select', {
									value: pSuccessor,
									onChange: (event) => setPSuccessor(event.target.value),
								},
									h('option', { value: '' }, t('noSuccessor')),
									(data?.agents ?? []).filter((candidate) => candidate.id !== profileAgent.id && candidate.status !== 'retired')
										.map((candidate) => h('option', { key: candidate.id, value: candidate.id }, candidate.name + (candidate.qa ? ' · QA' : ''))))),
							pError ? h('div', { className: 'at-modalerror', role: 'alert' }, pError) : null,
							h('div', { className: 'at-modalactions' },
								h('button', { className: 'at-btn', type: 'button', onClick: () => setProfileAgent(null), disabled: pBusy }, t('cancel')),
								h('button', { className: 'at-btn', type: 'button', onClick: leaveProfile, disabled: pBusy }, t('leaveTeam')),
								h('button', { className: 'at-btn', type: 'button', onClick: distillProfile, disabled: pBusy }, t('redistill')),
								h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: pBusy || !pName.trim() }, pBusy ? t('saving') : t('save'))))) : null));
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
			ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'ai-team' }, () => h(Boundary, { t }, h(Workbench, { t, ctx }))));
			console.log(`${PKG}: client workbench spike applied`);
		}

		return { inject: ['slots', 'locale'], apply };
	},
});
