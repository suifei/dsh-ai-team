/**
 * dsh-ai-team — Client half (M2.5 workbench).
 *
 * A three-pane project workbench rendered inside the DSH `main` slot:
 *   left  = page nav + Project tree + Agents
 *   center= project header + 主对话 / 看板 / 态势 tabs + composer
 *   right = Task Thread panel (discussion, acceptance, done receipt)
 *
 * UI references: docs/04 §4–§7/§10, docs/appendix/D §2–§3, docs/07 §4–§6.
 * The client reads `/ai-team/api/bootstrap` and the SSE change stream; every
 * write goes through `POST /ai-team/api/projects/:id/commands`. Without the
 * endpoint it shows an honest error state with retry — no embedded demo data.
 * The registration contract (`sidebar.panellist` id `ai-team`, `main` key
 * `ai-team`) is unchanged.
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
			panel: '文渊阁',
			back: '项目总览',
			inbox: '收件箱',
			board: '任务看板',
			projects: '项目',
			main: '主对话',
			boardTab: '看板',
			tabSituation: '态势',
			tabsAria: '项目视图',
			composer: '写一条消息… @ 点名成员，可粘贴或拖入图片与文件',
			attachAdd: '添加图片或文件',
			attachRemove: '移除 {name}',
			attachUploading: '附件还在上传，稍等再发送。',
			attachFailed: '「{name}」上传失败：{message}',
			attachDrop: '松开即可添加图片或文件',
			attachTaskMode: '附件随讨论发送；建卡模式下不带附件。',
			mentionList: '点名成员',
			taskPlaceholder: '任务标题：要做什么',
			taskDefinitionPlaceholder: '验收标准（必填）：怎样算完成、拿什么证据',
			taskDefinitionAria: 'Task 验收标准',
			qaChecklistPlaceholder: 'QA 清单，每行一条（开启 QA 时必填）',
			qaChecklistAria: 'QA 验收清单',
			taskDefinitionRequired: '请先写验收标准，再创建 Task。',
			discuss: '讨论',
			taskMode: '任务',
			send: '发送',
			createTask: '创建 Task',
			enterHint: 'Ctrl/⌘ + Enter 发送',
			thread: '任务记录',
			closeThread: '关闭任务记录',
			threadChat: 'Agent 会话',
			taskDetail: '任务详情',
			resultDefinition: '结果定义',
			qaProgress: 'QA {done}/{total}',
			updated: '更新',
			follow: '关注',
			unfollow: '取消关注',
			convert: '转为 Task',
			you: '你',
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
			streamDown: '实时更新已中断，界面可能滞后；正在自动重连…',
			streamUp: '实时更新已恢复。',
			loadFailedTitle: '工作台不可达',
			loadFailedBody: 'bootstrap 接口（/ai-team）无法访问；请确认插件已启用后重试。',
			spike: 'AI Team',
			spikeTitle: '文渊阁 AI Team 工作台：修书、校勘、纂辑；方向、验收与账本。',
			navAria: '页面导航',
			menu: '目录',
			menuAria: '打开项目与成员目录',
			projectsAria: '项目',
			agentsAria: '成员',
			streamAria: '主对话',
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
			inboxGoal: '需要你的决策与失败，都在这里',
			inboxEmptyTitle: '没有需要你处理的事',
			inboxEmptyBody: '成员失败、需要决策或有人提到你时，会出现在这里。',
			inboxDecisionTitle: '需要你决策',
			inboxItemTitle: '收件箱消息',
			inboxCompletedTitle: 'Task 已完成：{title}',
			inboxOpenTask: '打开 Task',
			inboxAck: '知道了',
			inboxAcked: '已标记处理。',
			decisionChoose: '请选择…',
			decisionAnswer: '填写你的决定',
			decisionRecommend: '推荐',
			decisionAdopt: '采纳',
			decisionAdoptAll: '全部采纳建议',
			decisionAdoptHint: '建议可直接采纳，再按需修改',
			decisionReopen: '重新决策',
			decisionReopenSuffix: '复核',
			decisionReopened: '已重开一份可编辑的决策项。',
			decisionSubmit: '提交决策',
			decisionSubmitted: '决策已提交给团队。',
			inboxEmptyAction: '看任务看板',			projectEmptyTitle: '还没有项目',
						emptyColumn: '暂无',
			expandDone: '展开全部',
			collapseDone: '收起',
			threadEmptyTitle: '还没有消息',
			threadEmptyBody: '还没有任务记录；可在下方回复，或打开 Agent 会话查看完整上下文。',
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
			actCancel: '取消任务',
			actReopen: '重开',
			actReassign: '改派…',
			cancelPrompt: '取消理由（可留空）',
			cancelDone: '已取消 #{n}。',
			reopenPrompt: '重开理由（可留空）',
			reopenDone: '已重开 #{n}。',
			deleteConfirm: '删除只允许从未认领的 pending Task，且只留 tombstone。确定？',
			deleteDone: '已删除 #{n}（tombstone）。',
			reassignPrompt: '把 accountable owner 改派给（输入名字）：',
			reassignDone: '已把 #{n} 改派给 {name}。',
			reassignNoTarget: '没有可改派的活跃成员。',
						actDelete: '删除',
			convertTitle: '转为 Task',
			titleLabel: '标题',
			convertNamePlaceholder: '一句话说清要做什么',
			convertDod: '完成判据',
			convertDodPlaceholder: '怎样算完成：可复核的结果或证据',
			convertContext: '上下文：引用 #{n} 的 {m} 条消息',
			convertCancel: '取消',
			convertSubmit: '创建 Task',
			convertDone: '已创建 #{n}，来自本 Thread。',
			convertNoSource: '本 Thread 没有可锚定的账本消息，无法转为 Task。',
			conflictTitle: '你的回复基于较早的 Thread，已退回',
			conflictNew: 'Thread 已到 #{head}（新增 {n} 条）',
			conflictContinue: '基于最新继续写',
			conflictContinued: '已把发送基线更新到 #{head}。',
			replySent: '已写入 Thread #{seq}。',
			replyFailed: '回复失败：{message}',
			acceptNote: '工作台验收：已核对 Thread 与证据。',
			acceptDone: '已验收 #{n}。',
			acceptFailed: '验收失败：{message}',
			changesNeedNote: '先把返工理由写在回复框，再点退回。',
			changesDone: '已退回 #{n}，要求返工。',
			changesFailed: '退回失败：{message}',
			followedTask: '已关注 #{n}，写入账本。',
			unfollowedTask: '已取消关注 #{n}；完成、受阻或需要你决定时仍会出现在看板。',
			archivedNote: '归档项目只读；取消归档暂未开放。',
			agentOpen: '与 {name} 对话',
			moreActions: '更多操作',
			agentChat: '直接对话',
			agentChatOpening: '正在打开对话…',
			agentChatUnavailable: '宿主没有可用的 Session 打开能力。',
			memberTasks: '他的任务',
			memberNoTasks: '还没有属于他的 Task',
			memberNoTasksBody: '在项目里创建或指派 Task 后，会出现在这里。',
			taskOwner: '负责人',
			taskAssignee: '执行',
			teamPulseTitle: '团队动态',
						teamPulseWorking: '成员已接单',
			teamPulseStarting: '成员已唤醒，正在拆解任务…',
			teamPulseAgents: '运行中：{names}',
			newProject: '新建项目',
			addAgent: '添加成员',
			newProjectTitle: '新建项目',
			projectName: '项目名',
			projectGoal: '目标',
			workspace: '工作目录',
			workspaceUnset: '这个项目还没有工作目录',
			workspaceHint: '先选择代码目录再开工；每个 Project 使用独立目录。',
			workspaceChoose: '选择目录',
			workspaceChange: '更换目录',
			pmoOn: 'PMO 自动 · 开',
			pmoOff: 'PMO 自动 · 关',
			pmoHint: 'PMO 自动处理 Human 决策并续派下一批 Task；默认开启',
			routingHint: '成员由 DSH 作为子智能体管理：在 DSH「管理的子智能体」面板中进入该成员会话可直接对话（保留上下文）；此处私信写入同一会话，成员下一轮回复。',
			runOn: '项目运行 · 开',
			runOff: '项目运行 · 停止中',
			runStateHint: '停止：当前子任务完成后停止派发（不再派发新任务/心跳/升级）；启动：空项目开始或停止的项目继续开工',
			runStarted: '项目已启动：PMO 将在下一个巡检周期开工。',
			runStopped: '项目已停止：正在执行的子任务自然完成后不再派发。',
			handoffBtn: '生成交接文档',
			handoffHint: '按时序生成项目交接文档（Human 指令 + 任务全量），写入工作目录 docs/ 下',
			handoffDone: '交接文档已生成：{path}',
			cancelAllPending: '取消全部待处理（{n}）',
			cancelAllHint: '批量取消当前全部待处理任务（逐卡取消并汇总结果）',
			cancelAllDone: '批量取消完成：成功 {done} 个，失败 {failed} 个。',
			working: '处理中…',
			archiveProject: '归档项目',
			archiveHint: '归档当前项目（从工作台移除；账本保留，DSH 会话不受影响）',
			archiveConfirmTitle: '归档项目',
			archiveConfirmBody: '将「{name}」从工作台归档移除？账本保留、成员 DSH 会话不受影响。',
			pmoEnabled: 'PMO 自动已开启。',
			pmoDisabled: 'PMO 自动已关闭，决策回到收件箱。',
			notifyTaskCreated: '新 Task 已创建',
			notifyTaskClaimed: '成员已认领 Task',
			notifyTaskSubmitted: 'Task 已提交待验收',
			notifyTaskAccepted: 'Task 已验收完成',
			notifyTaskChanges: 'Task 被退回修改',
			notifyThread: 'Thread 有新消息',
			notifyInbox: '新的待办已进入收件箱',
			notifyWake: 'Agent 已唤醒',
			notifyStream: '主对话有新消息',
			streamUnseen: '{count} 条新消息',
			notifyClose: '关闭通知',
			workspaceRequired: '请先设置项目工作目录。',
			workspaceSaved: '项目工作目录已保存。',
			workspaceDialogTitle: '设置项目工作目录',
			workspaceDialogHint: 'Project 的成员会在这个目录里执行 Task；多个 Project 用不同目录隔离。',
			workspacePathPlaceholder: '例如 D:/work/my-project',
			workspacePickUnavailable: '当前宿主不支持目录选择，请手动输入路径。',
			workspacePickFailed: '目录选择失败，请手动输入路径。',
			workspaceSave: '保存目录',
			projectCreate: '创建项目',
			projectCreated: '已创建项目 {name}。',
			projectSwitched: '已切换项目。',
			addAgentTitle: '添加成员',
			memberName: '名字',
			memberRole: '职责',
			memberPrompt: '初始指令（可选）',
			memberPromptHint: '例如：任务 #1 已待验收，读 tasks 后独立验收。',
			memberPreset: '运行配方',
			presetStandard: '标准模式',
			presetPtc: 'PTC 模式',
			presetMinimal: '极简模式',
			presetCordis: '创造模式',
			memberProvider: '模型提供商',
			memberModel: '模型',
	memberReasoning: '推理等级',
	memberReasoningDefault: '跟随模型默认',
	memberReasoningNone: '该模型没有声明推理档位；在 DSH 提供商设置里为它配置 reasoningEfforts 后，这里才会出现可选档位',
	memberReasoningError: '推理等级读取失败：{message}',
	memberReasoningAsk: '为 {model} 选择推理等级',
			memberProviderDefault: '跟随系统默认',
			memberModelDefault: '跟随系统默认',
			memberNoProviders: 'DSH 暂未提供可用模型',
			memberModelsLoading: '正在读取 DSH 模型目录…',
			memberModelsError: '无法读取 DSH 模型目录，仍可使用系统默认模型。',
			memberNoModels: '该提供商暂无模型',
			memberOwner: '设为 Project owner',
			memberCreate: '创建并激活',
			memberCopy: '复制成员',
			memberCopyFrom: '复制自「{name}」：沿用角色、人格、运行配方、模型、输出上限与技能；笔记、会话与任务不带。',
			talentMarket: '人才市场',
			talentCustom: '自定义',
			talentSearch: '搜索名字、岗位、技能…',
			talentAll: '全部',
			talentHire: '招聘',
			talentCreate: '新建人才',
			tcHint: '填好职责与性格，按需装几份技能，存成可复用的人才。',
			tcName: '名号', tcRole: '岗位', tcDuty: '职责', tcCategory: '分类', tcTags: '标签', tcTagsHint: '逗号分隔', tcPersonality: '性格', tcPersonalityHint: '它怎么做事、什么风格',
			tcSkills: '技能', tcEmpty: '还没装技能（可选）', tcAddExisting: '从已有装', tcWriteOwn: '自写一份', tcImport: '导入 .md', tcPick: '选一个已有技能…', tcAdd: '加入', tcRemove: '移除',
			tcSkillName: '技能名（英文/数字/-）', tcSkillBody: '技能正文（SKILL.md）', tcSkillDup: '已经装了同名技能', tcSave: '存为我的人才', tcSaving: '保存中…',
			memberSaveAsTalent: '存为人才', tcFromMember: '从成员「{name}」存出：沿用它此刻的岗位、职责、性格与技能，可先修改再保存。', tcModelKept: '沿用模型：{model}', tcMissing: '这些技能找不到正文，没有带上：{skills}', tcDraftFailed: '读取成员草稿失败：{error}',
			projectTeam: '团队', teamCompose: '组一个新团队', teamComposeTitle: '组队', teamComposeHint: '从人才里挑人组队：同一人才可以招多位，给其中一位定为负责人（新项目的主理人）。', teamName: '团队名', teamDesc: '说明', teamMembers: '成员', teamPick: '从人才里挑人', teamAdd: '加入', teamLead: '负责人', teamEmptyPick: '还没挑人', teamSave: '保存团队', teamBack: '返回', teamDelete: '删除这个团队', teamDeleteConfirm: '删除自建团队「{name}」？团队文件会被删除，已用它建的项目和其中成员不受影响。', teamLoadFailed: '团队列表读取失败：{error}',
			talentEmpty: '没有符合条件的人才。',
			talentLoading: '正在读取人才市场…',
			talentLoadFailed: '人才市场读取失败：{error}',
			talentSkills: '技能：{skills}',
			talentUser: '自建',
			avatarTitle: '头像', avatarGender: '性别', avatarAge: '年龄', avatarRace: '人种', avatarHint: '头像按名字在本机生成（hash-avatar）；改名会换一张脸，参数不变。',
			avatar_male: '男', avatar_female: '女', avatar_neutral: '中性', avatar_baby: '婴儿', avatar_teen: '少年', avatar_youth: '青年', avatar_middle: '中年', avatar_old: '老年', avatar_asian: '黄种人', avatar_white: '白人', avatar_black: '黑人', avatar_brown: '棕色人种', avatar_auto: '不指定',
			profileTabBasic: '资料', profileTabModel: '模型', profileTabSkills: '技能', profileTabCollab: '协作', profileNotes: '备忘', profileNotesEmpty: '还没有备忘。', profileSkillsEmpty: '还没装技能；在下面填技能名加一个，或到人才市场招已带技能的人才。',
			teamPickDetail: '人才简介', teamPickDetailEmpty: '在左边点一位人才，这里看简介；点「加入」放进右边的团队。', teamLeadMark: '负责人', projectTeamMembers: '团队成员 · {n} 位',
			peopleModelBatch: '批量配置模型', peopleModelTitle: '配置模型', peopleModelHint: '选中的成员在其所在的全部项目里改用这个模型；之后仍可在成员资料里单独改。', peopleModelPick: '应用到 {n} 位', peopleModelAll: '全选', peopleModelNone: '全不选', peopleModelApply: '应用', peopleModelNeed: '先选模型', peopleModelDone: '已为 {people} 位成员配置 {model}（成功 {done} 处，失败 {failed} 处）。',
			talentOfficial: '在线', catalogNone: '在线人才库：未同步（当前用插件内置）', catalogAt: '在线人才库：v{version} · {time} 同步', catalogSync: '同步在线库', catalogSyncing: '同步中…', catalogSyncHint: '从官方在线人才库（npmmirror / jsDelivr）取最新的人才与团队；逐文件校验，失败不影响现有的。你自建或改过的人才不受影响。', catalogUpdated: '已同步到 v{version}（{files} 个文件）。', catalogLatest: '已是最新 v{version}。', catalogFailed: '同步失败：{error}', catalogClear: '退回内置', catalogClearConfirm: '删掉本机的在线人才库，退回插件内置版本？你自建或改过的人才不受影响。',
			talentFork: '复制为可编辑', talentForkHint: '把这位内置人才复制成你自己的副本（同名遮盖内置），之后可装技能、进化技能；已招的成员下次激活就用副本。', talentForked: '已改', talentRestore: '恢复内置', talentRestoreConfirm: '删掉「{name}」的可编辑副本，恢复内置版？副本里装的、进化过的技能都会丢弃。', skillEvolve: '进化', skillEvolveHint: '让这位成员用 SkillOpt 优化这份技能：诊断最弱一维、改写、评审官盲评，好就保留，不好回退。', skillEvolveSent: '已私信 {name} 进化技能「{skill}」。', skillEvolveForked: '内置人才「{talent}」已复制为可编辑副本，并已私信 {name} 进化技能「{skill}」。', skillEvolveFailed: '技能进化没发出去：{error}',
			talentHint: '挑一位人才预填表单，改名、换模型后再招进项目；自建人才放在 ~/.dsh/ai-team/catalog/user/talents/。',
			memberHireFrom: '招自人才市场「{name}」v{version}：带入岗位、职责、人格与技能，可先修改再创建。',
			dutyLead: '主理人',
			dutyQa: '验收',
			dutyExecutor: '执行',
			memberAdding: '正在创建…',
			memberAdded: '成员已创建并激活。',
			cancel: '取消',
			dialogConfirm: '确定',
			reseatSession: '重置会话',
			reseatConfirm: '将关闭该成员的旧会话，并在当前项目工作目录里重建一个新会话（旧会话的 cwd 是创建时钉死的，无法原地修改）。确定？',
			reseatDone: '会话已在当前项目工作目录重建。',
			decisionNotePlaceholder: '补充说明（可选，随决策写入 Thread）',
			decisionFollowUp: '看项目进展',
			followUpMissing: '主对话里还没有决策之后的新消息。',
			riskTitle: '风险清单',
			riskBlocked: '受阻',
			riskStaleHours: '待决 {n} 小时',
			riskCounts: '受阻 {blocked} · 失败 {failures} · 待决超时 {stale}',
			followUpMissing: '主对话里还没有决策之后的新消息。',
			permissionBadge: '完全权限',
			permissionNote: '该成员以完全权限、只在本项目的工作目录里运行。请只在可信目录创建项目。',
			obTitle: '开工三步',
			obStep1: '① 给项目一个工作目录',
			obStep1Done: '① 工作目录已就绪',
			obStep2: '② 认识你的成员（右侧 AGENTS 列表，可改名可增减）',
			obStep3: '③ 说出第一句话',
			obExample: '把这次回归里失败的三条都修了',
			obFill: '填入示例',
			teamQuiet: '团队安静：没有需要处理的事，健康。',
			teamBusy: '团队推进中：{n} 个任务在做。',
			teamNeedsYou: '有 {n} 件事等你处理或放行。',
			failureAuth: 'API key 无效或没有权限',
			failureBilling: '账户余额或配额不足',
			failureRateLimit: '请求太频繁，被限流',
			failureNetwork: '网络连接失败',
			failureServer: '模型服务端出错',
			failureModelUnavailable: '指定模型不存在或不可用',
			failureContextOverflow: '上下文超出模型窗口',
			failurePolicy: '内容被安全策略拒绝',
			failureUnknown: '未知失败',
			failureSession: '会话不可续接，已停止自动重建（请手动重建）',
			shortcutTitle: '键盘快捷键',
			shortcutInbox: '收件箱',
			shortcutBoard: '任务看板',
			shortcutPeople: '人员池',
			shortcutHome: '对话',
			shortcutComposer: '聚焦输入框',
			shortcutClose: '关闭线程 / 浮层',
			close: '关闭',
			memberProfileTitle: '成员资料',
			memberProfileTitleName: '成员资料 · {name}',
			memberProfileMeta: '{status} · 资料 v{version} · 蒸馏 v{distill}',
			memberPersonality: '个性 / 工作方式',
			memberSkills: '技能',
			memberNotes: '最近备忘',
			memberMaxTokens: 'Max tokens',
			qaRequired: '需要 QA 验收',
			qaChecklist: 'QA 检查清单',
			notePlaceholder: '加一条备忘…',
			skillPlaceholder: '加一个技能，如 nuwa-skill',
			messagePlaceholder: '给这位成员发私信…',
			sendMessage: '发私信',
			messageSent: '私信已发送并唤醒成员。',
			addNote: '加备忘',
			addSkill: '加技能',
			retry: '重试',
			retried: '已重试并重新激活。',
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
			discussSent: '已发送给 Project owner。',
			taskSent: '已创建 Task。',
			sendFailed: '发送失败：{message}',
			duplicateTask: '相同 Task 已存在（#{number}），已为你打开它。',
			qaNeedsChecklist: 'QA Task 至少需要一条验收清单。',
			pendingHuman: '待你处理',
			inboxUnread: '收件箱，{n} 条未读',
			dismiss: '关闭提示',
			crashTitle: '工作台渲染失败',
			noProject: '未选择项目',
			navHome: '对话',
			agentsScope: '本项目成员',
			people: '人员',
			peopleTitle: '人员池',
			peopleEmpty: '还没有成员；先在项目里添加。',
			peopleGoal: '按人汇总各项目里的成员：看负载、配置模型、跳到所在项目。',
			peopleProjects: '{n} 个项目',
			refresh: '刷新',
			peopleActiveTasks: '{n} 个活跃任务',
			peopleFailure: '最近失败 ×{n}',
			peopleOpenProject: '打开项目',
			peopleLoadFailed: '人员池加载失败：{message}',
			irreversibleBadge: '不可撤回',
			pendingTitle: '等你验收（跨项目）',
			eventHistoryTitle: '任务事件历史',
			eventHistoryEmpty: '该任务暂无关联事件。',
			aliasTitle: '同人绑定',
			aliasSourcePlaceholder: '另一个名字',
			aliasTargetPlaceholder: '并到这个人',
			aliasBind: '绑定',
			aliasHint: '绑定后两个名字在人员池合并为同一行。',
			aliasRequired: '请先填写要合并的名字。',
			aliasSaved: '已把「{name}」并到「{person}」。',
			teamBusyN: '在做 ×{n}',
			pendingAcceptanceN: '待验收 ×{n}',
			archivedCount: '已归档 {n}',
			personModelBtn: '配置模型',
			modelCatalogEmpty: '模型目录为空：请先在 DSH 设置里配置可用的 LLM 端点。',
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
			quadrantMissing: '该条目对应的 Task 不在当前数据里。',
			filterLabel: '筛选：{name}',
			filterClear: '清除筛选',
			filterInboxExtra: '另有 {n} 条收件箱决策项',
			filterInboxTitle: '需要你处理 {n} 条',
			filterInboxBody: '这些是收件箱决策，不是 Task；去收件箱逐条处理。',
			filterInboxAction: '打开收件箱',
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
			panel: 'Wenyuan Pavilion',
			back: 'Overview',
			inbox: 'Inbox',
			board: 'All tasks',
			projects: 'Projects',
						main: 'Main',
			boardTab: 'Board',
			tabSituation: 'Situation',
			tabsAria: 'Project views',
			composer: 'Write a message… @ a member; paste or drop images and files',
			attachAdd: 'Add images or files',
			attachRemove: 'Remove {name}',
			attachUploading: 'Attachments are still uploading; send again in a moment.',
			attachFailed: 'Upload of “{name}” failed: {message}',
			attachDrop: 'Drop to attach images or files',
			attachTaskMode: 'Attachments go with discussion messages; task mode sends none.',
			mentionList: 'Mention a member',
			taskPlaceholder: 'Task title: what to do',
			taskDefinitionPlaceholder: 'Definition of done (required): how it is accepted, with what evidence',
			taskDefinitionAria: 'Definition of done',
			qaChecklistPlaceholder: 'QA checklist, one per line (required when QA is on)',
			qaChecklistAria: 'QA checklist',
			taskDefinitionRequired: 'Write the definition of done before creating a Task.',
			discuss: 'Discuss',
			taskMode: 'Task',
			send: 'Send',
			createTask: 'Create task',
			enterHint: 'Ctrl/⌘ + Enter to send',
			thread: 'Task record',
			closeThread: 'Close task record',
			threadChat: 'Agent session',
			taskDetail: 'Task details',
			resultDefinition: 'Definition of done',
			qaProgress: 'QA {done}/{total}',
			updated: 'Updated',
			follow: 'Follow',
			unfollow: 'Unfollow',
			convert: 'Turn into task',
			you: 'You',
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
			loadFailedTitle: 'Workbench unreachable',
			loadFailedBody: 'The bootstrap endpoint (/ai-team) cannot be reached; confirm the plugin is enabled and retry.',
		streamDown: 'Live updates stopped; the view may lag while the stream reconnects…',
		streamUp: 'Live updates are back.',
			spike: 'AI Team',
			spikeTitle: 'Wenyuan Pavilion AI Team workbench: compile, collate, edit; direction, acceptance and ledger.',
			navAria: 'Page navigation',
			menu: 'Menu',
			menuAria: 'Open the project and member menu',
			projectsAria: 'Projects',
			agentsAria: 'Agents',
			streamAria: 'Main stream',
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
			inboxGoal: 'Decisions and failures that need you land here',
			inboxEmptyTitle: 'Nothing needs you',
			inboxEmptyBody: 'Member failures, decisions and mentions land here.',
			inboxDecisionTitle: 'Decision required',
			inboxItemTitle: 'Inbox message',
			inboxCompletedTitle: 'Task completed: {title}',
			inboxOpenTask: 'Open Task',
			inboxAck: 'Acknowledge',
			inboxAcked: 'Marked handled.',
			decisionChoose: 'Choose…',
			decisionAnswer: 'Write your decision',
			decisionRecommend: 'Recommended',
			decisionAdopt: 'Adopt',
			decisionAdoptAll: 'Adopt all suggestions',
			decisionAdoptHint: 'Adopt a suggestion, then edit if needed',
			decisionReopen: 'Decide again',
			decisionReopenSuffix: 'review',
			decisionReopened: 'A new editable decision item is ready.',
			decisionSubmit: 'Submit decision',
			decisionSubmitted: 'Decision sent to the team.',
			inboxEmptyAction: 'Open the board',
			projectEmptyTitle: 'No projects yet',
						emptyColumn: 'None',
			expandDone: 'Show all',
			collapseDone: 'Collapse',
			threadEmptyTitle: 'No messages yet',
			threadEmptyBody: 'No task record yet. Reply below, or open the Agent session for full context.',
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
			actCancel: 'Cancel task',
			actReopen: 'Reopen',
			actReassign: 'Reassign…',
			cancelPrompt: 'Cancellation reason (optional)',
			cancelDone: 'Cancelled #{n}.',
			reopenPrompt: 'Reopen reason (optional)',
			reopenDone: 'Reopened #{n}.',
			deleteConfirm: 'Only a never-claimed pending Task can be deleted; it becomes a tombstone. Continue?',
			deleteDone: 'Deleted #{n} (tombstone).',
			reassignPrompt: 'Reassign the accountable owner to (name):',
			reassignDone: 'Reassigned #{n} to {name}.',
			reassignNoTarget: 'No active member is available for reassignment.',
						actDelete: 'Delete',
			convertTitle: 'Turn into task',
			titleLabel: 'Title',
			convertNamePlaceholder: 'One line about what needs doing',
			convertDod: 'Definition of done',
			convertDodPlaceholder: 'What counts as done: a verifiable result or evidence',
			convertContext: 'Context: {m} messages from #{n}',
			convertCancel: 'Cancel',
			convertSubmit: 'Create task',
			convertDone: 'Created #{n} from this thread.',
			convertNoSource: 'This thread has no ledger messages to anchor; cannot convert.',
			conflictTitle: 'Your reply was based on an older thread and was returned',
			conflictNew: 'Thread is at #{head} ({n} new)',
			conflictContinue: 'Continue from latest',
			conflictContinued: 'Send baseline moved to #{head}.',
			replySent: 'Written to Thread #{seq}.',
			replyFailed: 'Reply failed: {message}',
			acceptNote: 'Workbench acceptance: Thread and evidence reviewed.',
			acceptDone: 'Accepted #{n}.',
			acceptFailed: 'Accept failed: {message}',
			changesNeedNote: 'Write the change request in the reply box first.',
			changesDone: 'Changes requested on #{n}.',
			changesFailed: 'Change request failed: {message}',
			followedTask: 'Following #{n}; written to the ledger.',
			unfollowedTask: 'Unfollowed #{n}; completion, blockage or decisions still appear on the board.',
			archivedNote: 'Archived projects are read-only; unarchive is not available yet.',
			agentOpen: 'Chat with {name}',
			moreActions: 'More actions',
			agentChat: 'Direct chat',
			agentChatOpening: 'Opening conversation…',
			agentChatUnavailable: 'This host cannot open a Session.',
			memberTasks: 'Their tasks',
			memberNoTasks: 'No Task belongs to this member yet',
			memberNoTasksBody: 'Create or assign a Task in the Project and it appears here.',
			taskOwner: 'Owner',
			taskAssignee: 'Assignee',
			teamPulseTitle: 'Team activity',
						teamPulseWorking: 'Members picked up the work',
			teamPulseStarting: 'Members are awake and breaking the work down…',
			teamPulseAgents: 'Running: {names}',
			newProject: 'New project',
			addAgent: 'Add member',
			newProjectTitle: 'New project',
			projectName: 'Project name',
			projectGoal: 'Goal',
			workspace: 'Workspace',
			workspaceUnset: 'This Project has no workspace yet',
			workspaceHint: 'Choose a code directory before starting; each Project uses its own directory.',
			workspaceChoose: 'Choose directory',
			workspaceChange: 'Change directory',
			pmoOn: 'PMO auto · on',
			pmoOff: 'PMO auto · off',
			pmoHint: 'PMO answers Human decisions and dispatches the next Tasks; on by default',
			routingHint: 'Members are managed by DSH as subagents: open the subagent from the DSH managed-subagents panel to chat in that session directly (context preserved); a DM here is written into the same session and answered next round.',
			runOn: 'Project run · on',
			runOff: 'Project run · stopping',
			runStateHint: 'Stop: finish the in-flight subtask then halt dispatch (no new tasks/heartbeats/escalations); Start: kick an empty project or resume a stopped one',
			runStarted: 'Project started: PMO begins at the next tick.',
			runStopped: 'Project stopped: in-flight subtasks finish, then dispatch halts.',
			handoffBtn: 'Generate handoff doc',
			handoffHint: 'Generate a chronological handoff document (Human instructions + all task info) into the workspace docs/ folder',
			handoffDone: 'Handoff document written: {path}',
			cancelAllPending: 'Cancel all pending ({n})',
			cancelAllHint: 'Batch-cancel every pending task (one by one, with a summary)',
			cancelAllDone: 'Batch cancel done: {done} ok, {failed} failed.',
			working: 'Working…',
			archiveProject: 'Archive project',
			archiveHint: 'Archive this project (removed from the workbench; ledger kept, DSH sessions unaffected)',
			archiveConfirmTitle: 'Archive project',
			archiveConfirmBody: 'Archive "{name}" and remove it from the workbench? The ledger is kept and member DSH sessions are unaffected.',
			pmoEnabled: 'PMO auto enabled.',
			pmoDisabled: 'PMO auto disabled; decisions go back to the inbox.',
			notifyTaskCreated: 'New Task created',
			notifyTaskClaimed: 'Member claimed a Task',
			notifyTaskSubmitted: 'Task submitted for acceptance',
			notifyTaskAccepted: 'Task accepted',
			notifyTaskChanges: 'Task returned for changes',
			notifyThread: 'New Thread message',
			notifyInbox: 'New inbox item',
			notifyWake: 'Agent woken',
			notifyStream: 'New main-stream message',
			streamUnseen: '{count} new messages',
			notifyClose: 'Dismiss notification',
			workspaceRequired: 'Set the Project workspace first.',
			workspaceSaved: 'Project workspace saved.',
			workspaceDialogTitle: 'Set Project workspace',
			workspaceDialogHint: 'Members run Tasks in this directory; separate Projects use separate directories.',
			workspacePathPlaceholder: 'e.g. D:/work/my-project',
			workspacePickUnavailable: 'This host has no directory picker; type a path.',
			workspacePickFailed: 'Directory picker failed; type a path.',
			workspaceSave: 'Save directory',
			projectCreate: 'Create project',
			projectCreated: 'Created project {name}.',
			projectSwitched: 'Switched project.',
			addAgentTitle: 'Add member',
			memberName: 'Name',
			memberRole: 'Role',
			memberPrompt: 'Initial instruction (optional)',
			memberPromptHint: 'e.g. Task #1 is awaiting acceptance; read tasks and review it independently.',
			memberPreset: 'Recipe',
			presetStandard: 'Standard',
			presetPtc: 'PTC',
			presetMinimal: 'Minimal',
			presetCordis: 'Creative',
			memberProvider: 'Model provider',
			memberModel: 'Model',
	memberReasoning: 'Reasoning',
	memberReasoningDefault: 'Model default',
	memberReasoningNone: 'This model declares no reasoning levels; add reasoningEfforts for it in the DSH provider settings to enable this selector',
	memberReasoningError: 'Could not read reasoning levels: {message}',
	memberReasoningAsk: 'Pick a reasoning level for {model}',
			memberProviderDefault: 'Follow system default',
			memberModelDefault: 'Follow system default',
			memberNoProviders: 'DSH exposes no models yet',
			memberModelsLoading: 'Reading the DSH model directory…',
			memberModelsError: 'Could not read the DSH model directory; system default is still available.',
			memberNoModels: 'No models for this provider',
			memberOwner: 'Make Project owner',
			memberCreate: 'Create and activate',
			memberCopy: 'Duplicate member',
			memberCopyFrom: 'Copy of “{name}”: keeps role, personality, recipe, model, output limit and skills; notes, session and tasks stay with the original.',
			talentMarket: 'Talent market',
			talentCustom: 'Custom',
			talentSearch: 'Search name, role, skill…',
			talentAll: 'All',
			talentHire: 'Hire',
			talentCreate: 'New talent',
			tcHint: 'Set the duty and personality, install a few skills, save a reusable talent.',
			tcName: 'Name', tcRole: 'Role', tcDuty: 'Duty', tcCategory: 'Category', tcTags: 'Tags', tcTagsHint: 'comma-separated', tcPersonality: 'Personality', tcPersonalityHint: 'how it works, its style',
			tcSkills: 'Skills', tcEmpty: 'No skills yet (optional)', tcAddExisting: 'From existing', tcWriteOwn: 'Write one', tcImport: 'Import .md', tcPick: 'Pick an existing skill…', tcAdd: 'Add', tcRemove: 'Remove',
			tcSkillName: 'Skill name (a-z, 0-9, -)', tcSkillBody: 'Skill body (SKILL.md)', tcSkillDup: 'That skill name is already staged', tcSave: 'Save as my talent', tcSaving: 'Saving…',
			memberSaveAsTalent: 'Save as talent', tcFromMember: 'Saved from member “{name}”: its current role, duty, personality and skills are filled in; edit before saving.', tcModelKept: 'Keeps the model: {model}', tcMissing: 'These skills have no readable body and were left out: {skills}', tcDraftFailed: 'Could not read the member draft: {error}',
			projectTeam: 'Team', teamCompose: 'Compose a new team', teamComposeTitle: 'Compose a team', teamComposeHint: 'Pick talents into a team: the same talent can be hired more than once; mark one as the lead (the new project owner).', teamName: 'Team name', teamDesc: 'Description', teamMembers: 'Members', teamPick: 'Pick from talents', teamAdd: 'Add', teamLead: 'Lead', teamEmptyPick: 'Nobody picked yet', teamSave: 'Save team', teamBack: 'Back', teamDelete: 'Delete this team', teamDeleteConfirm: 'Delete your team “{name}”? Its file is removed; projects already created from it and their members are unaffected.', teamLoadFailed: 'Could not load teams: {error}',
			talentEmpty: 'No talent matches.',
			talentLoading: 'Loading the talent market…',
			talentLoadFailed: 'Could not load the talent market: {error}',
			talentSkills: 'Skills: {skills}',
			talentUser: 'Custom',
			avatarTitle: 'Avatar', avatarGender: 'Gender', avatarAge: 'Age', avatarRace: 'Ethnicity', avatarHint: 'Drawn locally from the name (hash-avatar); renaming gives a new face with the same settings.',
			avatar_male: 'Male', avatar_female: 'Female', avatar_neutral: 'Neutral', avatar_baby: 'Baby', avatar_teen: 'Teen', avatar_youth: 'Young', avatar_middle: 'Middle-aged', avatar_old: 'Senior', avatar_asian: 'Asian', avatar_white: 'White', avatar_black: 'Black', avatar_brown: 'Brown', avatar_auto: 'Any',
			profileTabBasic: 'Profile', profileTabModel: 'Model', profileTabSkills: 'Skills', profileTabCollab: 'Collaboration', profileNotes: 'Notes', profileNotesEmpty: 'No notes yet.', profileSkillsEmpty: 'No skills yet; add one by name below, or hire a talent that comes with skills.',
			teamPickDetail: 'Talent details', teamPickDetailEmpty: 'Pick a talent on the left to see its details; “Add” puts it into the team on the right.', teamLeadMark: 'Lead', projectTeamMembers: 'Team members · {n}',
			peopleModelBatch: 'Set model for many', peopleModelTitle: 'Set model', peopleModelHint: 'The selected members switch to this model in every project they are in; each can still be changed in its profile.', peopleModelPick: 'Apply to {n}', peopleModelAll: 'All', peopleModelNone: 'None', peopleModelApply: 'Apply', peopleModelNeed: 'Pick a model first', peopleModelDone: 'Set {model} for {people} members ({done} ok, {failed} failed).',
			talentOfficial: 'Online', catalogNone: 'Online catalog: not synced (using the built-in one)', catalogAt: 'Online catalog: v{version} · synced {time}', catalogSync: 'Sync online catalog', catalogSyncing: 'Syncing…', catalogSyncHint: 'Fetch the latest talents and teams from the official online catalog (npmmirror / jsDelivr); every file is verified, and a failed sync leaves the current one untouched. Your own and edited talents are not affected.', catalogUpdated: 'Synced to v{version} ({files} files).', catalogLatest: 'Already up to date (v{version}).', catalogFailed: 'Sync failed: {error}', catalogClear: 'Use built-in', catalogClearConfirm: 'Delete the local online catalog and go back to the built-in one? Your own and edited talents are not affected.',
			talentFork: 'Make editable', talentForkHint: 'Copy this built-in talent into your own copy (same id, shadows the built-in) so you can install and evolve its skills; hired members use the copy on their next activation.', talentForked: 'Edited', talentRestore: 'Restore built-in', talentRestoreConfirm: 'Delete your editable copy of “{name}” and restore the built-in? Skills installed or evolved in the copy are discarded.', skillEvolve: 'Evolve', skillEvolveHint: 'Have this member optimize the skill with SkillOpt: diagnose the weakest dimension, rewrite, blind review by the reviewer; kept if better, reverted if not.', skillEvolveSent: 'Asked {name} to evolve the skill “{skill}”.', skillEvolveForked: 'Built-in talent “{talent}” was copied into an editable copy, and {name} was asked to evolve the skill “{skill}”.', skillEvolveFailed: 'Could not start skill evolution: {error}',
			talentHint: 'Pick a talent to prefill the form, rename it or change the model, then hire. Your own talents live in ~/.dsh/ai-team/catalog/user/talents/.',
			memberHireFrom: 'Hired from the talent market: “{name}” v{version}. Role, duty, personality and skills are filled in; edit before creating.',
			dutyLead: 'Lead',
			dutyQa: 'QA',
			dutyExecutor: 'Executor',
			memberAdding: 'Creating…',
			memberAdded: 'Member created and activated.',
			cancel: 'Cancel',
			dialogConfirm: 'OK',
			reseatSession: 'Reset session',
			reseatConfirm: 'This closes the member\'s old session and rebuilds a new one in the current project workspace (a session\'s cwd is pinned at creation and cannot be changed in place). Continue?',
			reseatDone: 'Session rebuilt in the current project workspace.',
			decisionNotePlaceholder: 'Extra note (optional, recorded on the thread)',
			decisionFollowUp: 'See project progress',
			followUpMissing: 'No new stream messages since that decision yet.',
			riskTitle: 'Risk list',
			riskBlocked: 'Blocked',
			riskStaleHours: 'pending {n}h',
			riskCounts: 'blocked {blocked} · failures {failures} · stale {stale}',
			followUpMissing: 'No new stream messages since that decision yet.',
			permissionBadge: 'full access',
			permissionNote: 'This member runs with full permissions, only inside this project\'s workspace. Create projects in trusted directories only.',
			obTitle: 'Three steps to start',
			obStep1: '① Set the project workspace',
			obStep1Done: '① Workspace is ready',
			obStep2: '② Meet your members (AGENTS list on the right; rename or adjust freely)',
			obStep3: '③ Say the first sentence',
			obExample: 'Fix the three failing regressions from this run',
			obFill: 'Use example',
			teamQuiet: 'Team is quiet: nothing needs you right now. Healthy.',
			teamBusy: 'Team is moving: {n} task(s) in progress.',
			teamNeedsYou: '{n} thing(s) need your decision or release.',
			failureAuth: 'API key invalid or unauthorized',
			failureBilling: 'Insufficient balance or quota',
			failureRateLimit: 'Rate limited — too many requests',
			failureNetwork: 'Network connection failed',
			failureServer: 'Model server error',
			failureModelUnavailable: 'Requested model not found or unavailable',
			failureContextOverflow: 'Context exceeds the model window',
			failurePolicy: 'Content rejected by safety policy',
			failureUnknown: 'Unknown failure',
			failureSession: 'Session not resumable; auto-rebuild stopped (rebuild manually)',
			shortcutTitle: 'Keyboard shortcuts',
			shortcutInbox: 'Inbox',
			shortcutBoard: 'Task board',
			shortcutPeople: 'People',
			shortcutHome: 'Conversation',
			shortcutComposer: 'Focus composer',
			shortcutClose: 'Close thread / overlay',
			close: 'Close',
			memberProfileTitle: 'Member profile',
			memberProfileTitleName: 'Member profile · {name}',
			memberProfileMeta: '{status} · profile v{version} · distill v{distill}',
			memberPersonality: 'Personality / working style',
			memberSkills: 'Skills',
			memberNotes: 'Recent notes',
			memberMaxTokens: 'Max tokens',
			qaRequired: 'Require QA review',
			qaChecklist: 'QA checklist',
			notePlaceholder: 'Add a note…',
			skillPlaceholder: 'Add a skill, e.g. nuwa-skill',
			messagePlaceholder: 'Message this member…',
			sendMessage: 'Send message',
			messageSent: 'Message sent and member woken.',
			addNote: 'Add note',
			addSkill: 'Add skill',
			retry: 'Retry',
			retried: 'Retried and re-activated.',
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
			discussSent: 'Sent to the Project owner.',
			taskSent: 'Task created.',
			duplicateTask: 'An identical Task already exists (#{number}); opened it instead.',
			qaNeedsChecklist: 'A QA Task needs at least one checklist item.',
			sendFailed: 'Send failed: {message}',
			pendingHuman: 'Needs you',
			inboxUnread: 'Inbox, {n} unread',
			dismiss: 'Dismiss',
			crashTitle: 'Workbench failed to render',
			noProject: 'No project selected',
			navHome: 'Conversation',
			agentsScope: 'Project members',
			people: 'People',
			peopleTitle: 'People',
			peopleEmpty: 'No members yet; add them in a project.',
			peopleGoal: 'Members across projects, grouped by person: load, model and a jump to each project.',
			peopleProjects: '{n} project(s)',
			refresh: 'Refresh',
			peopleActiveTasks: '{n} active task(s)',
			peopleFailure: '{n} recent failure(s)',
			peopleOpenProject: 'Open project',
			peopleLoadFailed: 'Failed to load people: {message}',
			irreversibleBadge: 'no undo',
			pendingTitle: 'Awaiting your acceptance (across projects)',
			eventHistoryTitle: 'Task event history',
			eventHistoryEmpty: 'No events linked to this task yet.',
			aliasTitle: 'Same-person binding',
			aliasSourcePlaceholder: 'Other name',
			aliasTargetPlaceholder: 'Merge into person',
			aliasBind: 'Bind',
			aliasHint: 'Bound names merge into one row in the people pool.',
			aliasRequired: 'Fill in the name to merge first.',
			aliasSaved: 'Merged "{name}" into "{person}".',
			teamBusyN: 'in progress ×{n}',
			pendingAcceptanceN: 'awaiting acceptance ×{n}',
			archivedCount: 'Archived {n}',
			personModelBtn: 'Set model',
			modelCatalogEmpty: 'The model catalog is empty: configure an LLM endpoint in DSH settings first.',
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
			quadrantMissing: 'The Task behind this item is not in the current data.',
			filterLabel: 'Filter: {name}',
			filterClear: 'Clear filter',
			filterInboxExtra: '{n} inbox decision item(s) not on the board',
			filterInboxTitle: '{n} item(s) need you',
			filterInboxBody: 'These are inbox decisions, not Tasks; open the inbox to handle them.',
			filterInboxAction: 'Open inbox',
			filteredEmptyTitle: 'No tasks under this filter',
			filteredEmptyBody: 'Clear the filter to see all tasks.',
			itemCount: '{n} items',
			doneTitle: 'Completion',
			doneAt: 'Done at {time}',
			acceptedBy: 'Accepted by {name}',
			evidenceCount: '{n} evidence items',
			doneNoInfo: 'No completion details recorded',
		};

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
		const TABS = ['main', 'board', 'situation'];
		const cx = (...parts) => parts.filter(Boolean).join(' ');
		// R-04 失败人话化：账本事件语言（member/llm-failed 的 category）转译为
		// 用户语言 + 固定建议动作句式（谁/卡在哪/原因/你可以做什么）。
		const failKey = (category) => 'failure' + String(category ?? 'unknown')
			.split('_')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join('');
		const failureHuman = (t, category) => t(failKey(category ?? 'unknown'));
		// R-18 事件历史的 actor 后缀。
		const actorSuffix = (actor) => actor?.kind === 'human' ? ' · Human'
			: actor?.kind === 'agent' ? ' · ' + (actor.memberId ?? 'Agent')
			: actor?.kind === 'system' ? ' · 系统'
			: '';
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

		function isInformationalInboxItem(item) {
			return item?.ref?.category === 'thread_mention'
				&& !(Array.isArray(item.ref?.questions) && item.ref.questions.length > 0);
		}

		/** The host computes quadrants; the client only renders them (single read model). */
		function deriveQuadrants(data) {
			return data?.quadrants ?? null;
		}

		/** Only the four board columns; `blocked` stays a badge, never a column. */
		function matchesFilter(task, filter, humanId) {
			if (filter === 'q1') {
				return task.status === 'pending_acceptance'
					|| (task.ownerId === humanId && task.status === 'pending' && task.blocked === true);
			}
			if (filter === 'q2') return task.status === 'in_progress';
			if (filter === 'q3') return task.status === 'pending' && task.blocked === true;
			if (filter === 'q4') return task.status === 'done';
			return true;
		}

		const CSS = `
			.at-root { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-family: var(--dsw-font-family); font-size: 13px; line-height: 21px; container-type: inline-size; container-name: at-wb; }
			.at-root *, .at-root *::before, .at-root *::after { box-sizing: border-box; }
			.at-toaststack { position: fixed; right: 18px; bottom: 18px; z-index: 60; display: flex; flex-direction: column; align-items: flex-end; gap: 7px; max-width: min(360px, calc(100vw - 36px)); pointer-events: none; }
			.at-toast { pointer-events: auto; display: flex; align-items: center; gap: 8px; max-width: 100%; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-panel, 0 8px 24px var(--dsw-alias-bg-mask-2)); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 18px; }
			.at-toasticon { display: inline-flex; color: var(--dsw-alias-state-business-primary); flex: 0 0 auto; }
			.at-toasttext { min-width: 0; overflow-wrap: anywhere; }
			.at-toastclose { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 14px; line-height: 16px; cursor: pointer; padding: 0 2px; }
			.at-root :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
			.at-top { height: 40px; flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
			.at-brand { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; white-space: nowrap; }
			.at-spike { display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 16px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
			.at-pending { margin-left: auto; height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-state-warning-primary); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-state-warning-primary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; white-space: nowrap; }
			.at-topproject { margin-left: auto; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-mobile { display: none; position: relative; min-width: 0; }
			.at-mobilesummary { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; list-style: none; }
			.at-mobilesummary::-webkit-details-marker { display: none; }
			.at-mobilepop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; width: min(320px, calc(100vw - 32px)); width: min(320px, calc(100cqw - 16px)); max-height: 70vh; overflow-y: auto; overflow-x: hidden; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-panel, 0 8px 24px var(--dsw-alias-bg-mask-2)); }
			.at-grid { flex: 1; min-height: 0; min-width: 0; position: relative; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
			.at-left { min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 8px 8px 12px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
			.at-center { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); container-type: inline-size; container-name: at-center; }
			/* 右栏是覆盖层（fixed 语义的 absolute 覆盖，不占网格列）：任何宽度下
			   开/关线程面板都不挤压中栏、不触发整栏重排（规格 #6）。 */
			.at-right { position: absolute; top: 0; right: 0; bottom: 0; z-index: 10; min-width: 0; min-height: 0; width: min(420px, 100%); display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-panel, 0 8px 24px var(--dsw-alias-bg-mask-2)); }
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
			.at-inboxitem { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); }
			.at-inboxitem.at-inboxdone { opacity: 0.62; }
			.at-inboxitem.at-inboxstale { border-left: 2px solid var(--dsw-alias-state-warn-primary); }
			.at-inboxitem.at-inboxstale2 { border-left: 3px solid var(--dsw-alias-state-error-primary); }
			.at-inboxbody { min-width: 0; flex: 1; }
			.at-inboxquestions { margin: 6px 0 2px; padding-left: 20px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 19px; }
			.at-inboxquestions li { margin: 3px 0; }
			.at-inboxquestion { display: block; color: var(--dsw-alias-label-primary); }
			.at-inboxoptions { display: block; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-inboxrecommend { display: block; color: var(--dsw-alias-state-business-primary); font-size: 11px; }
			.at-decision { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 4px; }
			.at-decisionhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
			.at-decisionhint { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-decisionrecommend { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; color: var(--dsw-alias-state-business-primary); font-size: 11px; }
			.at-adopt { flex: 0 0 auto; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline; }
			.at-decisionselect, .at-decisioninput { width: 100%; margin-top: 4px; padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; }
			.at-decision .at-btn { align-self: flex-start; }
			.at-inboxtitle { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
			.at-inboxmeta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-inboxstate { color: var(--dsw-alias-label-caption); font-size: 10.5px; }
			.at-inboxactions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
			.at-qacheck { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; }
			.at-qacheck input { accent-color: var(--dsw-alias-state-business-primary); }
			.at-taskfields { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 8px; }
			.at-taskdef, .at-taskqa { width: 100%; box-sizing: border-box; resize: vertical; min-height: 42px; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; }
			.at-taskdef::placeholder, .at-taskqa::placeholder { color: var(--dsw-alias-label-caption); }
			.at-qabadge { display: inline-flex; align-items: center; margin-left: 5px; padding: 0 5px; border: 1px solid var(--dsw-alias-state-business-primary); border-radius: 999px; color: var(--dsw-alias-state-business-primary); font-size: 9px; line-height: 15px; vertical-align: 1px; }
			.at-talented { opacity: 0.82; }
			.at-btn-small { min-height: 24px; padding: 0 8px; font-size: 11px; }
			.at-agentconfig { min-width: 0; display: flex; gap: 4px; align-items: center; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-agentfail { flex: none; color: var(--dsw-alias-state-warn-primary); }
			.at-agentmore, .at-agentchat { flex: 0 0 auto; width: 28px; height: 28px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; cursor: pointer; }
			.at-agentmore:hover, .at-agentchat:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
			.at-agentchat { display: inline-flex; align-items: center; justify-content: center; }
			.at-teampulse { width: 100%; max-width: 760px; margin: 4px auto 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); }
			.at-teampulsehead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
			.at-teampulsetitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
			.at-teampulsecount { font-size: 11px; color: var(--dsw-alias-state-business-primary); }
			.at-teampulselist { display: flex; flex-direction: column; gap: 4px; }
			.at-teampulsetask { display: flex; align-items: center; gap: 7px; width: 100%; padding: 4px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
			.at-teampulsetask:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-teampulseno { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
			.at-teampulsetasktitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
			.at-teampulseowner { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-teampulsehint { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-teampulseagents { margin-top: 6px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-memberview { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 18px; }
			.at-agentbubbles { display: flex; flex-direction: column; gap: 6px; max-width: 620px; margin: 10px 0 4px 40px; }
			.at-agentbubble { display: flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px 12px 12px 3px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
			.at-agentbubble:hover { border-color: var(--dsw-alias-state-business-primary); }
			.at-agentbubbleno { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-agentbubbletext { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
			.at-memberviewhead { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-memberviewid { display: flex; flex-direction: column; min-width: 0; flex: 1 1 180px; }
			.at-memberviewid strong { font-size: 15px; line-height: 22px; }
			.at-memberviewid span { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-memberviewactions { display: flex; gap: 6px; flex-wrap: wrap; }
			.at-memberviewbody { max-width: 760px; margin: 0 auto; padding-top: 14px; }
			.at-memberviewsub { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin-bottom: 8px; }
			.at-membertasklist { display: flex; flex-direction: column; gap: 6px; }
			.at-membertask { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
			.at-membertask:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }
			.at-membertaskno { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; font-size: 11px; }
			.at-membertasktitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
			.at-membertaskmeta { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
			.at-chead { flex: 0 0 auto; padding: 14px 18px 0; }
			.at-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 600; line-height: 22px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-goal { min-width: 0; margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-workspacebar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; min-width: 0; margin-top: 4px; }
			.at-workspacepath { flex: 1 1 100%; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.at-workspacebar .at-btn, .at-workspacebar .at-pmobtn, .at-workspacebar .at-workspacebtn { padding-inline: 8px; font-size: 11px; line-height: 16px; white-space: nowrap; }
			.at-workspacebtn { flex: 0 0 auto; padding: 2px 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
			.at-workspacebtn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-tertiary); }
			.at-pmobtn { flex: 0 0 auto; padding: 2px 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; white-space: nowrap; }
			.at-pmobtn.at-pmo-on { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
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
			.at-streamjumpanchor { position: relative; height: 0; }
			.at-streamjump { position: absolute; left: 50%; bottom: 8px; z-index: 5; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer; box-shadow: var(--dsw-elevation-panel, 0 4px 12px var(--dsw-alias-bg-mask-2)); }
			.at-streamjump:hover { color: var(--dsw-alias-label-primary); }
			.at-msg { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
			.at-avatar { flex: 0 0 auto; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 500; }
			.at-avatar.at-avatar-img { overflow: hidden; border-color: transparent; background: transparent; padding: 0; }
			.at-avatar.at-avatar-img img { display: block; width: 100%; height: 100%; border-radius: 999px; }
			.at-talenttop { display: flex; align-items: center; gap: 10px; min-width: 0; }
			.at-talenttop > .at-talenthead { flex: 1 1 auto; min-width: 0; }
			.at-avatarpick { display: flex; align-items: center; gap: 16px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
			.at-avatarpickrows { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
			.at-avatarpickrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
			.at-avatarpickrow > .at-panetitle { width: 36px; flex: none; }
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
			.at-box textarea { display: block; width: 100%; box-sizing: border-box; min-height: 38px; max-height: 60vh; resize: vertical; padding: 2px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 21px; }
			.at-barrow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
			.at-box { position: relative; }
			.at-box.at-dropping { border-style: dashed; border-color: var(--dsw-alias-state-business-primary); }
			.at-drophint { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; border-radius: inherit; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, transparent); color: var(--dsw-alias-label-secondary); font-size: 12px; pointer-events: none; }
			.at-mentions { position: absolute; left: 8px; bottom: calc(100% + 4px); z-index: 3; min-width: 180px; max-width: calc(100% - 16px); max-height: 240px; overflow-y: auto; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); box-shadow: 0 6px 20px rgba(0, 0, 0, .14); }
			.at-mention { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border-radius: var(--dsw-radius-sm); font-size: 12px; cursor: pointer; }
			.at-mention span { min-width: 0; overflow: hidden; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; }
			.at-mention-on, .at-mention:hover { background: var(--dsw-alias-button-ghost-active-fill); }
			.at-attachrow, .at-msgfiles { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
			.at-attach, .at-msgfile { display: inline-flex; align-items: center; gap: 6px; max-width: 240px; min-height: 28px; padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 11px; text-decoration: none; }
			.at-attach img { width: 28px; height: 28px; object-fit: cover; border-radius: 3px; }
			.at-attach-busy { opacity: .6; }
			.at-attach-error { border-color: var(--dsw-alias-state-danger-primary, #d33); }
			.at-attachname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-attachsize { flex: 0 0 auto; color: var(--dsw-alias-label-caption); }
			.at-attachx { flex: 0 0 auto; padding: 0 2px; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 14px; line-height: 1; cursor: pointer; }
			.at-attachbtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
			.at-attachbtn:hover { color: var(--dsw-alias-label-primary); }
			.at-msgimg { display: block; line-height: 0; }
			.at-msgimg img { max-width: min(320px, 100%); max-height: 240px; width: auto; height: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); object-fit: contain; background: var(--dsw-alias-bg-base); }
			.at-mode { display: inline-flex; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
			.at-mode button { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 0 8px; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
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
			.at-btn { min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; white-space: nowrap; }
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
			.at-taskdetail { margin: 10px 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); }
			.at-taskdetailsum { padding: 8px 10px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; line-height: 18px; }
			.at-taskdetailbody { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; }
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
			.at-modelfields { display: flex; flex-direction: column; gap: 4px; }
			.at-fieldhint { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-fieldrow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
			.at-modalback { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent); }
			.at-modal { width: min(420px, 100%); max-height: 86vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
			.at-modaltitle { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
			.at-modaltitle svg, .at-btn svg, .at-talentduty svg, .at-mode button svg, .at-catalogstate svg { flex: none; }
			/* 内容型弹窗（添加成员 / 人才市场、成员资料、新建项目、组队）：插件页面的 90% 宽高；确认框等小弹窗保持紧凑。 */
			.at-modalback:has(> .at-modal-wide) { padding: 0; }
			.at-modal.at-modal-wide { width: 90%; height: 90%; max-height: 90%; }
			/* 所有弹窗：标题栏固定在顶部，功能按钮在右上角；内容再长也不用滚到底找按钮。 */
			.at-modal { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-auto-rows: max-content; align-content: start; column-gap: 0; row-gap: 12px; padding-top: 0; }
			.at-modal > * { grid-column: 1 / -1; min-width: 0; }
			.at-modal > .at-addtabs { justify-self: start; }
			.at-modal .at-addtabs { padding: 2px; gap: 2px; border-radius: 8px; background: var(--dsw-alias-bg-base); }
			.at-modal .at-addtabs button { min-height: 28px; padding: 0 12px; border-radius: 6px; font-size: 12px; }
			.at-modal .at-addtabs button[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-2); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2); }
			.at-profilebasic { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 12px 16px; align-items: start; }
			.at-profilebasic textarea { min-height: 280px; }
			.at-profilebasic .at-notesbox { max-height: 280px; }
			.at-checkcard { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; }
			.at-checkcard:has(input:checked) { border-color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent); }
			.at-checkcard input { flex: none; accent-color: var(--dsw-alias-state-business-primary); }
			.at-checkcard > span { display: flex; flex-direction: column; min-width: 0; font-size: 12px; line-height: 17px; }
			.at-checkcard small { color: var(--dsw-alias-label-tertiary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-modal > .at-modaltitle { grid-column: 1; grid-row: 1; position: sticky; top: 0; z-index: 3; align-self: stretch; margin: 0; padding: 14px 0 10px; background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-modal > .at-modalactions { grid-column: 2; grid-row: 1; position: sticky; top: 0; z-index: 3; align-self: stretch; align-items: center; margin: 0; padding: 8px 0 8px 12px; background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); }
			.at-actsep { width: 1px; align-self: stretch; margin: 6px 2px; background: var(--dsw-alias-border-l2); }
			.at-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
			.at-btn-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
			.at-btn-warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
			.at-btn-warn:hover { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
			.at-btn-accent { color: var(--dsw-alias-state-business-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent); }
			.at-btn-accent:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); }
			.at-fieldgrid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 12px; }
			.at-fieldgrid3 .at-modelfields, .at-fieldgrid3 .at-modelfields > .at-fieldrow { display: contents; }
			.at-fieldgrid3 .at-modelfields > :not(.at-fieldrow) { grid-column: 1 / -1; }
			.at-notesbox { max-height: 200px; overflow-y: auto; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
			.at-split { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(0, 1.7fr); gap: 16px; align-items: start; }
			.at-teamcomposer { display: grid; grid-template-columns: minmax(200px, 1fr) minmax(0, 1.4fr) minmax(240px, 1.1fr); gap: 14px; align-items: start; }
			.at-pane { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
			.at-panetitle { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; }
			.at-panelist { display: flex; flex-direction: column; gap: 2px; max-height: 58vh; overflow-y: auto; padding: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }
			.at-pickrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
			.at-pickrow:hover { background: var(--dsw-alias-interactive-bg-hover); }
			.at-pickrow[aria-selected="true"] { background: var(--dsw-alias-button-ghost-active-fill); }
			.at-pickrow > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-pickrole { color: var(--dsw-alias-label-tertiary); }
			.at-peoplegrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin: 0 12px 12px; }
			.at-pcard { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
			.at-pcard.at-people-failed { border-color: var(--dsw-alias-state-error-primary); }
			.at-streamwide { max-width: none; }
			.at-pcard .at-peoplebadges { margin-left: 0; }
			.at-pcardhead { display: flex; align-items: center; gap: 8px; min-width: 0; }
			.at-pcardfoot { display: flex; justify-content: flex-end; gap: 6px; margin-top: auto; }
			.at-peoplecheck { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
			@media (max-width: 900px) { .at-split, .at-teamcomposer, .at-fieldgrid3, .at-profilebasic { grid-template-columns: minmax(0, 1fr); } }
			.at-addtabs { align-self: flex-start; }
			.at-tcskills { display: flex; flex-wrap: wrap; gap: 6px; }
			.at-tcskill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: rgba(127,127,127,0.15); font-size: 12px; }
			.at-tcskill button { border: 0; background: transparent; cursor: pointer; font-size: 14px; line-height: 1; color: inherit; padding: 0; }
			.at-tcpick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
			.at-tcpanel { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
			.at-teamrows { display: flex; flex-direction: column; gap: 6px; }
			.at-teamrow { display: grid; grid-template-columns: 24px minmax(0, 1fr) 76px auto auto; gap: 8px; align-items: center; }
			.at-teamrow > .at-modalmeta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-teamlead { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; white-space: nowrap; }
			.at-teampick { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
			.at-teampickrow { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
			.at-teampickrow > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.at-market { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
			.at-catalogstate { display: inline-flex; align-items: center; gap: 5px; }
			.at-marketsearch { width: 100%; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
			.at-marketcats { display: flex; flex-wrap: wrap; gap: 4px; }
			.at-marketcat { min-height: 22px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; cursor: pointer; }
			.at-marketcat[aria-pressed="true"] { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
			.at-marketgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
			.at-talent { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
			.at-talenthead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
			.at-talentname { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
			.at-talentrole { color: var(--dsw-alias-label-secondary); font-size: 12px; }
			.at-talentduty { display: inline-flex; align-items: center; gap: 3px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; line-height: 16px; }
			.at-talentdesc { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
			.at-talentfoot { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin-top: auto; }
			.at-talentfoot .at-tcpick { justify-content: flex-end; flex-wrap: nowrap; margin-top: 0; }
			.at-modalmeta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
			.at-modal .at-check { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
			.at-modal .at-check input { accent-color: var(--dsw-alias-state-business-primary); }
			.at-modalerror { color: var(--dsw-alias-state-error-primary); font-size: 11.5px; line-height: 16px; }
			.at-inlineadd { display: flex; align-items: center; gap: 6px; }
			.at-inlineadd input { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
			.at-modalactions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 2px; }
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
			.at-people { margin: 0 12px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
			.at-people-failed { border-color: var(--dsw-alias-state-error-primary); }
			.at-peoplesum { display: flex; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer; list-style: none; }
			.at-peoplesum::-webkit-details-marker { display: none; }
			.at-peoplename { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; }
			.at-people-role { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-peoplebadges { margin-left: auto; color: var(--dsw-alias-label-caption); font-size: 11px; font-variant-numeric: tabular-nums; }
			.at-peopleprojects { display: flex; flex-direction: column; gap: 4px; padding: 0 10px 10px; }
			.at-peopleproject { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); }
			.at-peopleprojectname { color: var(--dsw-alias-label-secondary); font-size: 12px; }
			.at-peoplestate { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
			.at-peopletasks { margin-left: auto; color: var(--dsw-alias-label-caption); font-size: 11px; font-variant-numeric: tabular-nums; }
			.at-peoplefail { color: var(--dsw-alias-state-error-primary); font-size: 11px; }
			.at-onboard { max-width: 520px; margin: 0 auto; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 8px; }
			.at-onboardtitle { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; }
			.at-obstep { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
			.at-obstep.at-obdone { color: var(--dsw-alias-label-tertiary); }
			.at-obmark { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-caption); font-size: 11px; flex: 0 0 auto; }
			.at-obstep.at-obdone .at-obmark { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
			.at-oblabel { flex: 1 1 auto; min-width: 0; }
			.at-peoplehead { display: flex; align-items: center; gap: 8px; margin: 0 12px 8px; }
			.at-aliasbox { margin: 0 12px 8px; border-bottom: 1px dashed var(--dsw-alias-border-l2); }
			.at-aliasrow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 0; }
			.at-aliasrow .at-decisioninput { flex: 1 1 120px; min-width: 90px; }
			.at-peoplecount { color: var(--dsw-alias-label-caption); font-size: 11px; margin-right: auto; }
			.at-permbadge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-label); font-size: 10.5px; }
			.at-msg-highlight { border-left: 2px solid var(--dsw-alias-state-business-primary); padding-left: 10px; }
			.at-decisionnote { width: 100%; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; resize: vertical; }
			.at-shortcuts { width: 100%; border-collapse: collapse; }
			.at-shortcuts td { padding: 4px 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
			.at-shortcuts kbd { display: inline-block; min-width: 34px; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); font-size: 11px; text-align: center; }
			.at-crashtitle { font-size: 14px; font-weight: 500; line-height: 22px; }
			.at-crashbody { max-width: 60ch; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
			@container at-center (max-width: 759px) {
				.at-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			}
			@container at-center (max-width: 519px) {
				.at-board { grid-template-columns: minmax(0, 1fr); }
			}
			@container at-wb (max-width: 1119px) {
				.at-grid { grid-template-columns: 200px minmax(0, 1fr); }
				.at-right { width: min(420px, 100%); }
				.at-boardwrap { padding: 12px; }
				.at-board { gap: 8px; }
			}
			@container at-wb (max-width: 959px) {
				.at-grid { grid-template-columns: 200px minmax(0, 1fr); }
				.at-right { width: 100%; max-width: none; border-left: 0; box-shadow: none; }
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
				.at-grid { grid-template-columns: minmax(0, 1fr); }
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
			if (name === 'clip') return h('svg', common, h('path', { d: 'M10.5 5.5 6 10a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4L4 8a4.2 4.2 0 0 0 6 6l3.5-3.5' }));
			if (name === 'file') return h('svg', common, h('path', { d: 'M4 2.5h5l3 3v8H4Z' }), h('path', { d: 'M9 2.5v3h3' }));
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
			if (name === 'down') return h('svg', common, h('path', { d: 'M8 3v10M3.5 8.5 8 13l4.5-4.5' }));
			if (name === 'sync') return h('svg', common, h('path', { d: 'M13 6.5A5 5 0 0 0 3.6 5' }), h('path', { d: 'M3.5 2.5V5H6' }), h('path', { d: 'M3 9.5A5 5 0 0 0 12.4 11' }), h('path', { d: 'M12.5 13.5V11H10' }));
			if (name === 'undo') return h('svg', common, h('path', { d: 'M5.5 3.5 2.5 6.5l3 3' }), h('path', { d: 'M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7' }));
			if (name === 'copy') return h('svg', common, h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }), h('path', { d: 'M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2' }));
			if (name === 'user') return h('svg', common, h('circle', { cx: 8, cy: 5.5, r: 2.8 }), h('path', { d: 'M2.5 13.5a5.5 5.5 0 0 1 11 0' }));
			if (name === 'userPlus') return h('svg', common, h('circle', { cx: 6.5, cy: 5.5, r: 2.6 }), h('path', { d: 'M1.5 13.5a5 5 0 0 1 10 0' }), h('path', { d: 'M12.5 4v4M10.5 6h4' }));
			if (name === 'users') return h('svg', common, h('circle', { cx: 6, cy: 5.5, r: 2.4 }), h('path', { d: 'M1.5 13.5a4.5 4.5 0 0 1 9 0' }), h('path', { d: 'M10 3.3a2.4 2.4 0 0 1 0 4.4M12 9.5a4.5 4.5 0 0 1 2.5 4' }));
			if (name === 'cloud') return h('svg', common, h('path', { d: 'M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.7.9 2.6 2.6 0 0 0 .3 5.1Z' }));
			if (name === 'pen') return h('svg', common, h('path', { d: 'M10.5 3 13 5.5 6 12.5H3.5V10Z' }), h('path', { d: 'M9 4.5 11.5 7' }));
			if (name === 'spark') return h('svg', common, h('path', { d: 'M7 2.5 8.3 6.2 12 7.5 8.3 8.8 7 12.5 5.7 8.8 2 7.5 5.7 6.2Z' }), h('path', { d: 'M12.5 10.5v3M11 12h3' }));
			if (name === 'store') return h('svg', common, h('path', { d: 'M2.5 6 3.5 3h9l1 3' }), h('path', { d: 'M2.5 6a1.8 1.8 0 0 0 3.7 0 1.8 1.8 0 0 0 3.6 0 1.8 1.8 0 0 0 3.7 0' }), h('path', { d: 'M3.5 8v5.5h9V8' }));
			if (name === 'folderPlus') return h('svg', common, h('path', { d: 'M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z' }), h('path', { d: 'M8 7.5v3M6.5 9h3' }));
			if (name === 'loop') return h('svg', { width: 18, height: 18, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true', focusable: 'false' }, h('rect', { x: 2.5, y: 5.5, width: 21, height: 21, rx: 6.5, stroke: 'currentColor', strokeWidth: 2.6 }), h('circle', { cx: 23.5, cy: 16, r: 4.8, fill: 'var(--dsw-alias-state-business-primary)' }));
			return null;
		}

		/** 图标 + 文字（按钮、标题、标签共用；图标单色随文字色）。 */
		function withIco(name, label, size = 13) {
			return [h(Ico, { key: 'i', name, size }), h('span', { key: 't' }, label)];
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

		/**
		 * 头像：成员 / 人才按名字由插件本机画（/ai-team/api/avatar.svg，参数见 lib/domain/avatar.js），Human 用首字母。
		 * 只给名字时按当前项目成员表（AVATAR_INDEX）找参数；图片加载失败时退回首字母。
		 */
		function Avatar({ name, human, avatar, seed, size = 24 }) {
			const [brokenUrl, setBrokenUrl] = React.useState('');
			const label = String(name ?? '?');
			const style = size === 24 ? undefined : { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.45) + 'px' };
			const known = human ? null : AVATAR_INDEX.get(label);
			const url = human ? '' : avatarUrl(seed ?? known?.seed ?? avatarSeed(label), avatar ?? known?.avatar ?? AVATAR_FALLBACK, size);
			if (human || url === brokenUrl) return h('span', { className: cx('at-avatar', human && 'at-avatar-human'), style, 'aria-hidden': 'true' }, label.slice(0, 1));
			return h('span', { className: 'at-avatar at-avatar-img', style, 'aria-hidden': 'true' },
				h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer', onError: () => setBrokenUrl(url) }));
		}
		/** 头像参数挑选（性别 / 年龄 / 人种），左边实时预览。人才新建、自定义成员、成员资料共用。 */
		function AvatarPicker({ t, value, seed, onChange }) {
			const current = { ...AVATAR_PICK_DEFAULT, ...(value || {}) };
			return h('div', { className: 'at-avatarpick' },
				h(Avatar, { name: seed, seed, avatar: current, size: 72 }),
				h('div', { className: 'at-avatarpickrows' },
					[['gender', 'avatarGender'], ['age', 'avatarAge'], ['race', 'avatarRace']].map(([key, label]) => h('div', { key, className: 'at-avatarpickrow' },
						h('span', { className: 'at-panetitle' }, t(label)),
						h('div', { className: 'at-mode at-addtabs', role: 'group', 'aria-label': t(label) }, AVATAR_CHOICES[key].map((option) => h('button', {
							key: option,
							type: 'button',
							'aria-pressed': current[key] === option ? 'true' : 'false',
							onClick: () => onChange({ ...current, [key]: option }),
						}, t('avatar_' + option)))))),
					h('div', { className: 'at-modalmeta' }, t('avatarHint'))));
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
				card.irreversible ? h('span', { className: 'at-blocked', title: t('irreversibleBadge') }, t('irreversibleBadge')) : null,
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

		function StreamMessage({ t, item, data, tasks, selected, follows, highlight, onOpenProfile, onChat, onOpen, onToggleFollow }) {
			const author = item.author ?? {};
			// 结构化判定：kind 是权威字段；显示名回退只兼容旧账本流。
			const human = author.kind === 'human' || (author.kind === undefined && agentFor(data, author.name) === null && author.name === t('you'));
			const agent = agentFor(data, author.name);
			const cards = (item.taskIds ?? []).map((id) => tasks.find((task) => task.id === id)).filter(Boolean);
			return h('article', { className: cx('at-msg', human && 'at-msg-human', highlight && 'at-msg-highlight') },
				h(Avatar, { name: author.name ?? (human ? t('you') : '?'), human }),
				h('div', { className: 'at-msgb' },
					h('div', { className: 'at-msgh' },
						// R-03 入口统一：点成员名 = 打开成员面板（与左栏/人员池一致）。
						agent ? h('button', { className: 'at-agentname', type: 'button', onClick: () => onOpenProfile(agent), title: agent.name }, author.name ?? '—')
							: h('b', null, author.name ?? '—'),
						agent ? h('span', { className: 'at-role' }, agent.role) : null,
						h('time', { dateTime: iso(item.at) }, fmtTime(item.at)),
						// 私信直达：Human 的话经同一通道写入该成员会话（原生会话只读）。
						agent && onChat ? h('button', { className: 'at-workspacebtn', type: 'button', title: t('routingHint'), onClick: () => onChat(agent) }, t('agentChat')) : null,
					),
					h('div', { className: 'at-msgt' }, item.body),
					Array.isArray(item.attachments) && item.attachments.length > 0 ? h(MessageAttachments, { item }) : null,
					cards.length ? h(TaskGroup, { t, cards, tasks, selected, follows, onOpen, onToggleFollow }) : null,
				));
		}

		/** #65：主对话消息里的图片（缩略图，点开看原图）与文件（点击下载）；按账本 seq + 序号读回。 */
		function MessageAttachments({ item }) {
			const src = (index) => '/ai-team/api/attachments/content?' + new URLSearchParams({ project: item.projectId ?? '', seq: String(item.seq), index: String(index) }).toString();
			return h('div', { className: 'at-msgfiles' }, item.attachments.map((block, index) => block.type === 'image'
				? h('a', { key: index, className: 'at-msgimg', href: src(index), target: '_blank', rel: 'noopener', title: block.attachment?.name ?? '' },
					h('img', { src: src(index), alt: block.attachment?.name ?? '', loading: 'lazy', width: block.attachment?.width, height: block.attachment?.height }))
				: h('a', { key: index, className: 'at-msgfile', href: src(index), download: block.attachment?.name ?? 'file' },
					h(Ico, { name: 'file' }),
					h('span', { className: 'at-attachname' }, block.attachment?.name ?? 'file'),
					h('span', { className: 'at-attachsize' }, fmtBytes(block.attachment?.bytes)))));
		}

		function ToastStack({ t, toasts, onClose }) {
			if (toasts.length === 0) return null;
			return h('div', { className: 'at-toaststack', role: 'status', 'aria-live': 'polite' },
				toasts.map((toast) => h(ToastRow, { key: toast.id, toast, t, onClose })));
		}

		/** One toast row owning its own expiry timer (cleared on unmount). */
		function ToastRow({ t, toast, onClose }) {
			React.useEffect(() => {
				const timer = setTimeout(() => onClose(toast.id), 7000);
				return () => clearTimeout(timer);
			}, []);
			return h('div', { className: 'at-toast' },
				h('span', { className: 'at-toasticon', 'aria-hidden': 'true' }, h(Ico, { name: 'inbox', size: 13 })),
				h('span', { className: 'at-toasttext' }, toast.text),
				h('button', { className: 'at-toastclose', type: 'button', 'aria-label': t('notifyClose'), onClick: () => onClose(toast.id) }, '×'));
		}

		/** 模态栈：多模态同开时只有栈顶响应 Escape（后开先关）。 */
		const MODAL_STACK = [];

		/**
		 * Shared modal backdrop: Escape closes the TOP modal only, Tab stays
		 * inside the dialog. Module-level so React sees a stable component
		 * type across renders.
		 */
		function ModalBack({ onClose, children }) {
			const backRef = React.useRef(null);
			const onCloseRef = React.useRef(onClose);
			onCloseRef.current = onClose;
			React.useEffect(() => {
				const modalId = Symbol('at-modal');
				MODAL_STACK.push(modalId);
				const onKey = (event) => {
					if (event.defaultPrevented) return;
					// 非栈顶（被更晚打开的模态覆盖）时让位：Escape/Tab 都不处理。
					if (MODAL_STACK[MODAL_STACK.length - 1] !== modalId) return;
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						onCloseRef.current();
						return;
					}
					if (event.key !== 'Tab' || !backRef.current) return;
					const focusables = backRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
					if (focusables.length === 0) {
						event.preventDefault();
						return;
					}
					const first = focusables[0];
					const last = focusables[focusables.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first.focus();
					}
				};
				window.addEventListener('keydown', onKey);
				return () => {
					window.removeEventListener('keydown', onKey);
					const index = MODAL_STACK.indexOf(modalId);
					if (index >= 0) MODAL_STACK.splice(index, 1);
				};
			}, []);
			return h('div', { className: 'at-modalback', ref: backRef }, children);
		}

		/**
		 * 自绘确认/输入对话框（替代原生 confirm/prompt）：confirm 布尔、
		 * prompt 文本、choice 选项。模块级组件 + 调用方自增 key 保证每次
		 * 新对话框重建（输入初始值生效）。
		 */
		function WorkbenchDialog({ t, dialog, onDismiss }) {
			const [value, setValue] = React.useState(dialog.value ?? '');
			const settle = (result) => {
				// 先关框再 resolve：resolve 触发的后续异步命令不应阻断关框。
				onDismiss();
				dialog.resolve(result);
			};
			const cancel = () => settle(dialog.mode === 'confirm' ? false : null);
			const submit = () => settle(dialog.mode === 'confirm' ? true : value.trim());
			// optional 语义：理由类输入允许留空（placeholder 已声明「可留空」）。
			const canSubmit = dialog.mode === 'confirm' || dialog.optional === true || value.trim() !== '';
			return h(ModalBack, { onClose: cancel },
				h('div', {
					className: 'at-modal',
					role: 'dialog',
					'aria-modal': 'true',
					'aria-label': dialog.title,
					onKeyDown: (event) => {
						// 三模式统一：Enter=确认（与原生 prompt 风格一致）。
						if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA' && canSubmit) {
							event.preventDefault();
							submit();
						}
					},
				},
					h('h2', { className: 'at-modaltitle' }, dialog.title),
					dialog.body ? h('p', { className: 'at-modalmeta' }, dialog.body) : null,
					dialog.mode === 'prompt'
						? h('input', {
							value,
							onChange: (event) => setValue(event.target.value),
							placeholder: dialog.placeholder ?? '',
							autoFocus: true,
						})
						: null,
					dialog.mode === 'choice'
						? h('select', { value, onChange: (event) => setValue(event.target.value), autoFocus: true },
							(dialog.options ?? []).map((option) => h('option', { key: option, value: option }, option)))
						: null,
					h('div', { className: 'at-modalactions' },
						h('button', { className: 'at-btn', type: 'button', onClick: cancel }, t('cancel')),
						h('button', { className: 'at-btn at-btn-primary', type: 'button', onClick: submit, disabled: !canSubmit, autoFocus: dialog.mode === 'confirm' }, t('dialogConfirm')))));
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

		function Board({ t, tasks, selected, follows, doneOpen, onToggleDone, onOpen, onToggleFollow, filter, onClearFilter, q1Extra, onBackMain, onOpenInbox, humanId }) {
			const filtered = (filter === 'all' ? tasks : tasks.filter((task) => matchesFilter(task, filter, humanId)))
				.slice()
				.sort((left, right) => (right.number ?? 0) - (left.number ?? 0));
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
						: filter === 'q1' && q1Extra > 0
							? h(EmptyState, {
								t,
								icon: 'inbox',
								title: tf(t, 'filterInboxTitle', { n: q1Extra }),
								body: t('filterInboxBody'),
								action: { label: t('filterInboxAction'), onClick: onOpenInbox },
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

		function AgentRow({ t, agent, onAgent, onAgentMore, onAgentChat }) {
			const statusText = t(AGENT_STATUS[agent.status] ?? 'agentIdle');
			const config = agent.config ?? null;
			const model = config?.model ? config.model : t('agentDefaultModel');
			const context = Number.isFinite(config?.contextWindow) ? ' · ctx ' + Math.round(config.contextWindow / 1000) + 'k' : '';
			const version = Number.isFinite(agent.configVersion) && agent.configVersion > 0 ? ' · v' + agent.configVersion : '';
			const failure = agent.status === 'failed' ? (agent.lastFailure ?? null) : null;
			return h('div', { className: 'at-agent', role: 'listitem' },
				h('span', { className: 'at-dot at-dot-' + (agent.status ?? 'idle'), 'aria-hidden': 'true' }),
				h(Avatar, { name: agent.name, size: 30 }),
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
					className: 'at-agentchat',
					type: 'button',
					'aria-label': tf(t, 'agentOpen', { name: agent.name }),
					title: t('agentChat'),
					onClick: () => onAgentChat(agent),
				}, h(Ico, { name: 'reply', size: 13 })),
				h('button', {
					className: 'at-agentmore',
					type: 'button',
					'aria-label': tf(t, 'agentOpen', { name: agent.name }),
					title: t('moreActions'),
					onClick: () => onAgentMore(agent),
				}, '⋯'));
		}

		function TeamPulse({ t, agents, tasks, onOpen, onCancelAllPending, cancelBusy }) {
			const active = tasks.filter((task) => ['pending', 'in_progress', 'pending_acceptance'].includes(task.status)).slice(-5);
			const pendingTasks = tasks.filter((task) => task.status === 'pending');
			const running = agents.filter((agent) => agent.status === 'running');
			const starting = active.length === 0 && tasks.length === 0 && running.length > 0;
			if (active.length === 0 && !starting) return null;
			const counts = { in_progress: 0, pending: 0, pending_acceptance: 0 };
			for (const task of active) counts[task.status] += 1;
			const summary = [
				counts.in_progress ? `${counts.in_progress} ${t('stInProgress')}` : '',
				counts.pending ? `${counts.pending} ${t('stPending')}` : '',
				counts.pending_acceptance ? `${counts.pending_acceptance} ${t('stPendingAcceptance')}` : '',
			].filter(Boolean).join(' · ');
			return h('section', { className: 'at-teampulse', 'aria-label': t('teamPulseTitle') },
				h('div', { className: 'at-teampulsehead' },
					h('span', { className: 'at-teampulsetitle' }, t('teamPulseTitle')),
					h('span', { className: 'at-teampulsecount' }, summary || t('teamPulseWorking')),
					// P1b：批量取消——Human 无需逐卡点开（用户实证的取消体验痛点）。
					pendingTasks.length > 0 && onCancelAllPending
						? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onCancelAllPending(pendingTasks), disabled: cancelBusy === true, title: t('cancelAllHint') }, cancelBusy ? t('working') : tf(t, 'cancelAllPending', { n: pendingTasks.length }))
						: null),
				active.length
					? h('div', { className: 'at-teampulselist' }, active.map((task) => h('button', {
						key: task.id,
						className: 'at-teampulsetask',
						type: 'button',
						onClick: () => onOpen(task),
					},
						h('span', { className: 'at-teampulseno' }, '#' + taskNo(task)),
						h('span', { className: 'at-teampulsetasktitle' }, task.title),
						h(StatusPill, { t, status: task.status }),
						h('span', { className: 'at-teampulseowner' }, task.owner ?? ''))))
					: h('div', { className: 'at-teampulsehint' }, t('teamPulseStarting')),
				running.length ? h('div', { className: 'at-teampulseagents' }, t('teamPulseAgents').replace('{names}', running.map((agent) => agent.name).join('、'))) : null);
		}

		function InboxDecision({ t, item, onSubmit }) {
			const questions = Array.isArray(item.ref?.questions) ? item.ref.questions : [];
			const [answers, setAnswers] = React.useState(() => questions.map(() => ''));
			const [note, setNote] = React.useState('');
			const [busy, setBusy] = React.useState(false);
			const setAnswer = (index, value) => setAnswers((prev) => prev.map((entry, i) => i === index ? value : entry));
			const recommendations = questions.map((question) => typeof question.recommendation === 'string' ? question.recommendation.trim() : '');
			const hasRecommendations = recommendations.some((value) => value !== '');
			const adoptAll = () => setAnswers((prev) => prev.map((entry, index) => recommendations[index] || entry));
			const complete = questions.every((question, index) => answers[index].trim() !== '');
			const submit = async () => {
				if (!complete || busy) return;
				setBusy(true);
				try {
					// R-06：可选补充说明随决策一起入 Thread/收件箱存档。
					await onSubmit(item, questions.map((question, index) => ({ id: question.id, value: answers[index].trim() })), note.trim());
				} finally {
					setBusy(false);
				}
			};
			return h('div', { className: 'at-decision' },
				hasRecommendations ? h('div', { className: 'at-decisionhead' },
					h('span', { className: 'at-decisionhint' }, t('decisionAdoptHint')),
					h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: adoptAll }, t('decisionAdoptAll'))) : null,
				h('ol', { className: 'at-inboxquestions' }, questions.map((question, index) => h('li', { key: question.id ?? index },
					h('span', { className: 'at-inboxquestion' }, question.text),
					Array.isArray(question.options) && question.options.length
						? h('select', { className: 'at-decisionselect', value: answers[index], onChange: (event) => setAnswer(index, event.target.value) },
							h('option', { value: '' }, t('decisionChoose')),
							question.options.map((option) => h('option', { key: option, value: option }, option)))
						: h('input', { className: 'at-decisioninput', value: answers[index], placeholder: question.recommendation ?? t('decisionAnswer'), onChange: (event) => setAnswer(index, event.target.value) }),
					question.recommendation ? h('div', { className: 'at-decisionrecommend' },
						h('span', null, t('decisionRecommend') + '：' + question.recommendation),
						h('button', { className: 'at-adopt', type: 'button', onClick: () => setAnswer(index, question.recommendation) }, t('decisionAdopt'))) : null))),
				h('textarea', {
					className: 'at-decisionnote',
					value: note,
					placeholder: t('decisionNotePlaceholder'),
					'aria-label': t('decisionNotePlaceholder'),
					onChange: (event) => setNote(event.target.value),
					rows: 2,
				}),
				h('button', { className: 'at-btn at-btn-primary at-btn-small', type: 'button', disabled: !complete || busy, onClick: submit }, busy ? t('saving') : t('decisionSubmit')));
		}

		/**
		 * 人员池「配置模型」：一次给选中的多位成员（在其所在的全部项目）设同一模型；单人入口也走这里（只勾那一位）。
		 * 成员资料里的单独设置照旧保留。
		 */
		function PeopleModelDialog({ t, catalog, catalogError, people, initial, onApply, onClose }) {
			const [picked, setPicked] = React.useState(() => new Set(initial));
			const [provider, setProvider] = React.useState(catalog?.defaultModel?.provider ?? '');
			const [model, setModel] = React.useState(catalog?.defaultModel?.model ?? '');
			const [effort, setEffort] = React.useState('');
			const [busy, setBusy] = React.useState(false);
			const toggle = (name) => setPicked((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
			const apply = async () => {
				if (busy || model === '' || picked.size === 0) return;
				setBusy(true);
				try { await onApply([...picked], { provider, model, ...(effort === '' ? {} : { reasoningEffort: effort }) }); } finally { setBusy(false); }
			};
			return h(ModalBack, { onClose },
				h('div', { className: 'at-modal at-modal-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('peopleModelTitle') },
					h('h2', { className: 'at-modaltitle' }, withIco('layers', t('peopleModelTitle'), 16)),
					h('div', { className: 'at-modalactions' },
						h('button', { className: 'at-btn', type: 'button', onClick: onClose, disabled: busy }, withIco('close', t('cancel'))),
						h('button', { className: 'at-btn at-btn-primary', type: 'button', onClick: () => void apply(), disabled: busy || model === '' || picked.size === 0, title: model === '' ? t('peopleModelNeed') : '' }, withIco('check', busy ? t('saving') : tf(t, 'peopleModelPick', { n: picked.size })))),
					h('div', { className: 'at-modalmeta' }, t('peopleModelHint')),
					h('div', { className: 'at-fieldgrid3' },
						h(ModelFields, { t, catalog, provider, effort, onEffort: setEffort, model, onProvider: setProvider, onModel: setModel, error: catalogError })),
					h('div', { className: 'at-pane' },
						h('div', { className: 'at-tcpick' },
							h('span', { className: 'at-panetitle' }, t('peopleTitle') + ' · ' + picked.size + '/' + people.length),
							h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => setPicked(new Set(people.map((p) => p.name))) }, t('peopleModelAll')),
							h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => setPicked(new Set()) }, t('peopleModelNone'))),
						h('div', { className: 'at-peoplecheck' }, people.map((person) => h('label', { key: person.name, className: 'at-checkcard' },
							h('input', { type: 'checkbox', checked: picked.has(person.name), onChange: () => toggle(person.name) }),
							h(Avatar, { name: person.name, human: false, size: 32 }),
							h('span', null, h('b', null, person.name + (person.role ? ' · ' + person.role : '')),
								h('small', null, (person.projects ?? []).map((row) => row.projectName).join('、')))))))));
		}

		/**
		 * 人员池总览（全局层，11-管理视角 §2）：按"人"聚合各项目身份。
		 * 数据 = GET /ai-team/api/people（各项目账本 members/tasks 的只读聚合）。
		 */
		function PeoplePage({ t, people, error, loading, onOpenProject, onRefresh, localNames, onOpenPerson, onChatPerson, onConfigModel, onBindAlias, aliasDraft }) {
			if (error) return h('div', { className: 'at-stream', role: 'alert' },
				h('div', { className: 'at-streaminner' }, h(EmptyState, { t, icon: 'alert', title: t('peopleTitle'), body: tf(t, 'peopleLoadFailed', { message: error }) })));
			// loading 用中心区域骨架（流内行），不用整页 Skeleton——本组件位于
			// at-center 槽位，整页骨架会嵌套出第二个工作台并干扰容器查询。
			if (loading && !people) {
				return h('div', { className: 'at-stream', role: 'status', 'aria-busy': 'true' },
					h('div', { className: 'at-streaminner' },
						h('div', { className: 'at-skel at-skel-line', style: { width: '40%' } }),
						h('div', { className: 'at-skel at-skel-line', style: { width: '70%' } }),
						h('div', { className: 'at-skel at-skel-line', style: { width: '55%' } })));
			}
			if (!people || people.length === 0) return h('div', { className: 'at-stream', role: 'region', 'aria-label': t('peopleTitle') },
				h('div', { className: 'at-streaminner' }, h(EmptyState, { t, icon: 'layers', title: t('peopleTitle'), body: t('peopleEmpty') })));
			return h('div', { className: 'at-stream', role: 'region', 'aria-label': t('peopleTitle') },
				h('div', { className: 'at-streaminner at-streamwide' },
					h('div', { className: 'at-peoplehead' },
						h('span', { className: 'at-peoplecount' }, loading ? t('loading') : tf(t, 'peopleProjects', { n: people.length })),
						onConfigModel ? h('button', { className: 'at-btn at-btn-small at-btn-accent', type: 'button', onClick: () => onConfigModel(people.map((person) => person.name)) }, withIco('layers', t('peopleModelBatch'), 12)) : null,
						h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: onRefresh, disabled: loading }, withIco('sync', t('refresh'), 12))),
					onBindAlias ? h('details', { className: 'at-aliasbox' },
						h('summary', { className: 'at-peoplesum' }, h('span', { className: 'at-people-role' }, t('aliasTitle'))),
						h('div', { className: 'at-aliasrow' },
							h('input', { className: 'at-decisioninput', value: aliasDraft?.name ?? '', placeholder: t('aliasSourcePlaceholder'), onChange: (event) => aliasDraft.onName(event.target.value) }),
							h('span', { className: 'at-people-role' }, '→'),
							h('input', { className: 'at-decisioninput', value: aliasDraft?.target ?? '', placeholder: t('aliasTargetPlaceholder'), onChange: (event) => aliasDraft.onTarget(event.target.value) }),
							h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onBindAlias(aliasDraft?.target ?? '') }, t('aliasBind'))),
						h('div', { className: 'at-modalmeta' }, t('aliasHint'))) : null,
					h('div', { className: 'at-peoplegrid' }, people.map((person) => {
						const badges = [
							tf(t, 'peopleProjects', { n: person.projects.length }),
							tf(t, 'peopleActiveTasks', { n: person.activeTasks }),
						];
						if (person.failures > 0) badges.push(tf(t, 'peopleFailure', { n: person.failures }));
						const localHere = localNames.has(person.name);
						return h('div', { key: person.name, className: cx('at-pcard', person.failures > 0 && 'at-people-failed') },
							h('div', { className: 'at-pcardhead' },
								h(Avatar, { name: person.name, human: false, size: 40 }),
								h('span', { className: 'at-peoplename' }, person.name),
								person.role ? h('span', { className: 'at-people-role' }, person.role) : null),
							h('div', { className: 'at-peoplebadges' }, badges.join(' · ')),
							h('div', { className: 'at-peopleprojects' }, person.projects.map((row) => {
								const failed = row.lastFailure !== undefined && row.lastFailure !== null;
								return h('div', { key: row.projectId, className: 'at-peopleproject' },
									h('span', { className: 'at-peopleprojectname' }, row.projectName),
									row.talentPool
										? h('span', { className: 'at-peoplestate' }, t('talentPool'))
										: h('span', { className: 'at-peoplestate' }, t(AGENT_STATUS[row.status] ?? 'agentIdle')),
									h('span', { className: 'at-peopletasks' }, tf(t, 'peopleActiveTasks', { n: row.activeTasks })),
									failed ? h('span', { className: 'at-peoplefail', title: row.lastFailure.message ?? '' }, failureHuman(t, row.lastFailure.category)) : null,
									h('button', { className: 'at-btn at-btn-small at-iconbtn', type: 'button', title: t('peopleOpenProject'), 'aria-label': t('peopleOpenProject'), onClick: () => onOpenProject(row.projectId) }, h(Ico, { name: 'chevron', size: 12 })));
							})),
							h('div', { className: 'at-pcardfoot' },
								// R-03 入口统一：在本项目内才能直达资料/私信（跨项目先切项目）。
								localHere ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onOpenPerson(person.name) }, withIco('user', t('memberProfileTitle'), 12)) : null,
								localHere ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onChatPerson(person.name) }, withIco('reply', t('agentChat'), 12)) : null,
								onConfigModel ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onConfigModel([person.name]) }, withIco('layers', t('personModelBtn'), 12)) : null));
					}))));
		}

		/**
		 * R-01 onboarding 三步（空项目主对话内嵌）：设目录 → 认识成员 → 第一
		 * 句话。完成态存会话内，不做持久化（避免新增存储）。
		 */
		function Onboarding({ t, project, agents, onSetWorkspace, onExample }) {
			const step1Done = Boolean(project?.workspacePath);
			const step2Done = agents.length > 0;
			const step = (mark, done, label, action) => h('div', { className: cx('at-obstep', done && 'at-obdone') },
				h('span', { className: 'at-obmark', 'aria-hidden': 'true' }, done ? '✓' : mark),
				h('span', { className: 'at-oblabel' }, label),
				action ?? null);
			return h('div', { className: 'at-onboard', role: 'group', 'aria-label': t('obTitle') },
				h('div', { className: 'at-onboardtitle' }, t('obTitle')),
				step('1', step1Done, t(step1Done ? 'obStep1Done' : 'obStep1'),
					!step1Done ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: onSetWorkspace }, t('workspaceChoose')) : null),
				step('2', step2Done, t('obStep2')),
				step('3', false, t('obStep3'),
					h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: onExample }, t('obFill'))));
		}

		function MemberView({ t, agent, tasks, onBack, onOpenTask, onOpenChat, onOpenProfile }) {
			const recentTasks = tasks.slice().sort((left, right) => (right.number ?? 0) - (left.number ?? 0)).slice(0, 3);
			return h('div', { className: 'at-memberview' },
				h('div', { className: 'at-memberviewhead' },
					h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: onBack }, '← ' + t('back')),
					h('span', { className: 'at-dot at-dot-' + (agent.status ?? 'idle'), 'aria-hidden': 'true' }),
					h('div', { className: 'at-memberviewid' },
						h('strong', null, agent.name),
						h('span', null, (agent.role ?? '') + (agent.qa ? ' · QA' : '') + ' · ' + t(AGENT_STATUS[agent.status] ?? 'agentIdle'))),
					h('div', { className: 'at-memberviewactions' },
						h('button', { className: 'at-btn at-btn-small at-btn-primary', type: 'button', onClick: () => onOpenChat(agent) }, t('agentChat')),
						h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => onOpenProfile(agent) }, t('memberProfileTitle')))),
				recentTasks.length ? h('div', { className: 'at-agentbubbles', role: 'status', 'aria-label': t('memberTasks') },
					recentTasks.map((task) => h('button', {
						key: task.id,
						className: 'at-agentbubble',
						type: 'button',
						onClick: () => onOpenTask(task),
					}, h('span', { className: 'at-agentbubbleno' }, '#' + taskNo(task)), h('span', { className: 'at-agentbubbletext' }, task.title), h(StatusPill, { t, status: task.status })))) : null,
				h('div', { className: 'at-memberviewbody' },
					h('div', { className: 'at-memberviewsub' }, t('memberTasks') + ' · ' + tasks.length),
					tasks.length
						? h('div', { className: 'at-membertasklist' }, tasks.map((task) => h('button', {
							key: task.id,
							className: 'at-membertask',
							type: 'button',
							onClick: () => onOpenTask(task),
						},
							h('span', { className: 'at-membertaskno' }, '#' + taskNo(task)),
							h('span', { className: 'at-membertasktitle' }, task.title),
							h(StatusPill, { t, status: task.status }),
							h('span', { className: 'at-membertaskmeta' }, task.ownerId === agent.id ? t('taskOwner') : t('taskAssignee')))))
						: h(EmptyState, { t, title: t('memberNoTasks'), body: t('memberNoTasksBody'), compact: true })));
		}

		function LeftPanel({ t, data, projectId, scope, tab, inboxUnread, onBack, onInbox, onBoard, onPeople, peopleActive, onProject, onNewProject, onAgent, onAgentMore, onAgentChat, onAddAgent, onRecruit }) {
			const projects = data.projects.filter((project) => !project.archived);
			const activeAgents = data.agents.filter((agent) => agent.status !== 'retired');
			const talentAgents = data.agents.filter((agent) => agent.status === 'retired');
			const archived = data.projects.filter((project) => project.archived);
			const boardActive = scope === 'project' && tab === 'board';
			return h('div', null,
				h('nav', { className: 'at-nav', 'aria-label': t('navAria') },
					h('button', { className: 'at-navrow', type: 'button', onClick: onBack }, h(Ico, { name: 'back' }), h('span', null, t('navHome'))),
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
					h('button', {
						className: cx('at-navrow', peopleActive && 'at-on'),
						type: 'button',
						'aria-current': peopleActive ? 'page' : undefined,
						onClick: onPeople,
					}, h(Ico, { name: 'layers' }), h('span', null, t('people'))),
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
					h('span', { title: t('agentsScope') }, t('agentsScope')),
					h('button', { className: 'at-mini', type: 'button', 'aria-label': t('addAgent'), title: t('addAgent'), onClick: onAddAgent }, h(Ico, { name: 'plus', size: 12 })),
				),
				activeAgents.length
					? h('div', { role: 'list', 'aria-label': t('agentsAria') }, activeAgents.map((agent) => h(AgentRow, { key: agent.id, t, agent, onAgent, onAgentMore, onAgentChat })))
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

		function AcceptancePanel({ t, task, checked, onChecked, checks, onCheck, onAccept, onChanges }) {
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
				Array.isArray(task.qaChecklist) && task.qaChecklist.length > 0 ? h('div', { className: 'at-kv' },
					h('span', { className: 'at-kvlabel' }, t('qaChecklist')),
					h('div', { className: 'at-kvbody' }, task.qaChecklist.map((item, index) => h('label', { key: index, className: 'at-check' },
						h('input', {
							type: 'checkbox',
							checked: checks?.[index]?.passed === true,
							onChange: (event) => onCheck(index, event.target.checked),
						}),
						h('span', null, item))))) : null,
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

		function ConflictBanner({ t, thread, baseSeq, headSeq, onContinue }) {
			const changes = Array.isArray(thread?.changes) ? thread.changes.slice(0, 5) : [];
			return h('div', { className: 'at-conflict', role: 'alert' },
				h('div', { className: 'at-conflicttitle' }, t('conflictTitle')),
				h('div', { className: 'at-conflictnew' }, tf(t, 'conflictNew', { head: headSeq, n: headSeq - baseSeq })),
				changes.length ? h('ul', { className: 'at-conflictlist' }, changes.map((change) => h('li', { key: (change.seq ?? '') + ':' + (change.what ?? '') }, (change.who ?? '—') + ' #' + (change.seq ?? '') + ' ' + (change.what ?? '')))) : null,
				h('div', { className: 'at-conflictactions' },
					h('button', { className: 'at-btn at-btn-quiet', type: 'button', onClick: onContinue }, t('conflictContinue'))));
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

		function TaskDetail({ t, task }) {
			const qa = Array.isArray(task.qaChecklist) ? task.qaChecklist : [];
			const passed = Array.isArray(task.qaChecks) ? task.qaChecks.filter((item) => item.passed === true).length : 0;
			return h('details', { className: 'at-taskdetail', open: task.status !== 'done' },
				h('summary', { className: 'at-taskdetailsum' }, t('taskDetail')),
				h('div', { className: 'at-taskdetailbody' },
					h('div', { className: 'at-kv' },
						h('span', { className: 'at-kvlabel' }, t('resultDefinition')),
						h('div', { className: 'at-kvbody' }, task.resultDefinition || t('noSummary'))),
					qa.length > 0 ? h('div', { className: 'at-kv' },
						h('span', { className: 'at-kvlabel' }, t('qaChecklist')),
						h('div', { className: 'at-kvbody' }, tf(t, 'qaProgress', { done: passed, total: qa.length }) + ' · ' + qa.join(' / '))) : null,
					h('div', { className: 'at-kv' },
						h('span', { className: 'at-kvlabel' }, t('updated')),
						h('div', { className: 'at-kvbody' }, task.updatedAt ? fmtDateTime(task.updatedAt) : '—'))));
		}

		function ThreadPanel({ t, task, thread, project, following, onToggleFollow, onClose, onChat, converting, convert, reply, onReplyChange, onReplySend, replyBase, onContinue, note, onDismissNote, acceptChecked, onAcceptChecked, qaChecks, onQaCheck, onAccept, onChanges, actions, panelRef, replyRef, taskEventsData, onLoadEvents }) {
			const headSeq = thread?.headSeq ?? thread?.entries?.length ?? 0;
			const stale = replyBase !== null && replyBase !== undefined && headSeq > replyBase;
			const entries = Array.isArray(thread?.entries) ? thread.entries : [];
			// #33 任务记录同样打开即在最新回帖：换任务重置，新回帖到达时按是否停在底部决定跟随。
			const threadFollow = useFollowLatest({
				key: task.id,
				shown: !converting,
				count: entries.length,
				tail: entries.length > 0 ? String(entries[entries.length - 1]?.seq ?? '') + '|' + task.status : task.status,
			});
			useFitTextarea(replyRef, reply);
			return h('aside', { className: 'at-right', role: 'complementary', 'aria-label': t('threadAria'), tabIndex: -1, ref: panelRef },
				h('div', { className: 'at-rhead' },
					h('div', { className: 'at-rh' },
						h('div', { className: 'at-rhmeta', title: t('thread') + ' · #' + taskNo(task) }, t('thread') + ' · #' + taskNo(task)),
						h('div', { className: 'at-rhtitle', title: task.title }, task.title)),
					h(FollowToggle, { t, taskNo: taskNo(task), following, onToggle: onToggleFollow }),
					onChat ? h('button', { className: 'at-rbtn', type: 'button', onClick: onChat }, t('threadChat')) : null,
					h('button', { className: 'at-rbtn', type: 'button', 'aria-expanded': Boolean(converting), onClick: convert.onOpen }, t('convert')),
					h('button', { className: 'at-rbtn at-iconbtn', type: 'button', 'aria-label': t('closeThread'), title: t('closeThread'), onClick: onClose }, h(Ico, { name: 'close', size: 14 }))),
				note ? h('div', { className: 'at-rnote', role: 'status' },
					h('span', { className: 'at-notetext' }, note),
					h('button', { className: 'at-noteclose', type: 'button', 'aria-label': t('dismiss'), title: t('dismiss'), onClick: onDismissNote }, h(Ico, { name: 'close', size: 12 }))) : null,
				converting
					? h(ConvertForm, { t, project, task, thread, title: convert.title, dod: convert.dod, onTitle: convert.onTitle, onDod: convert.onDod, onCancel: convert.onCancel, onSubmit: convert.onSubmit })
					: h('div', { className: 'at-rbody', ref: threadFollow.ref, onScroll: threadFollow.onScroll },
						stale ? h(ConflictBanner, { t, thread, baseSeq: replyBase, headSeq, onContinue }) : null,
						task.status === 'done' ? h(DoneSummary, { t, task }) : h(TaskDetail, { t, task }),
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
							checks: qaChecks,
							onCheck: onQaCheck,
							onAccept,
							onChanges,
						}) : null,
						actions.length ? h('section', { className: 'at-actions', 'aria-label': t('taskActions') },
							h('div', { className: 'at-actionhead' },
								h('span', { className: 'at-actiontitle' }, t('taskActions'))),
							h('div', { className: 'at-actionrow' }, actions.map((action) => h('button', {
								key: action.label,
								className: 'at-btn at-btn-quiet',
								type: 'button',
								onClick: action.onClick,
							}, action.label)))) : null),
						// R-18：按需拉取这条任务的账本事件（端点原本无人调用）。独立于
						// actions——没有可用 action 的任务同样要有这条可追溯入口。
						onLoadEvents ? h('div', { className: 'at-actionrow at-eventsopen' },
							h('button', {
								className: 'at-btn at-btn-quiet',
								type: 'button',
								onClick: () => onLoadEvents(task.id),
							}, t('eventHistoryTitle'))) : null,
						// R-18 可追溯入口：这条任务的账本事件时间序。
						// `openTaskEvents` 此前只有定义、没有任何调用点，端点从未被请求过；
						// 这里补一个显式按钮（按需加载，避免每次选中都拉全量事件）。
						taskEventsData && taskEventsData.taskId === task.id ? h('details', { className: 'at-events' },
							h('summary', { className: 'at-actiontitle' }, t('eventHistoryTitle') + ' · ' + taskEventsData.events.length),
							h('div', { className: 'at-peopleprojects' }, taskEventsData.events.map((event) => h('div', { key: event.seq, className: 'at-peopleproject' },
								h('span', { className: 'at-peopleprojectname' }, '#' + event.seq),
								h('span', { className: 'at-peoplestate' }, event.type),
								h('span', { className: 'at-peopletasks' }, fmtTime(event.at) + actorSuffix(event.actor)))))) : null,
				!converting ? h(JumpToLatest, { t, unseen: threadFollow.unseen, onJump: threadFollow.jump }) : null,
				!converting ? h('div', { className: 'at-rfoot' },
					h('div', { className: 'at-box at-rbox' },
						h('textarea', {
							value: reply,
							rows: 2,
							ref: replyRef,
							onMouseUp: (event) => rememberTextareaDrag(event.currentTarget),
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

		function Composer({ t, mode, draft, definition, qaChecklist, disabled, qaRequired, onQaRequired, onDefinition, onQaChecklist, onMode, onDraft, onSend, inputRef, agents, attachments, onAttach, onRemoveAttachment }) {
			const pending = Array.isArray(attachments) ? attachments : [];
			const discuss = mode !== 'task';
			const ready = discuss && pending.some((item) => item.status === 'ready');
			const canSend = !disabled && (draft.trim() !== '' || ready)
				&& !(mode === 'task' && (!draft.trim() || !definition.trim() || (qaRequired && !qaChecklist.trim())));
			const send = () => {
				if (!canSend) return;
				onSend();
			};
			const ownRef = React.useRef(null);
			const boxRef = inputRef ?? ownRef;
			const fileRef = React.useRef(null);
			const [mention, setMention] = React.useState(null);
			const [dragging, setDragging] = React.useState(false);
			useFitTextarea(boxRef, draft);
			const candidates = mention === null ? [] : mentionCandidates(agents, mention.query);
			const track = (el) => {
				const found = el ? mentionQuery(el.value, el.selectionStart ?? el.value.length) : null;
				setMention(found === null ? null : { ...found, caret: el.selectionStart ?? el.value.length, index: 0 });
			};
			const pick = (agent) => {
				if (mention === null || !agent) return;
				const next = applyMention(draft, mention.start, mention.caret, agent.name);
				onDraft(next.text);
				setMention(null);
				const el = boxRef.current;
				if (el) requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.caret, next.caret); });
			};
			const attach = (files) => {
				const list = Array.from(files ?? []);
				if (list.length > 0 && discuss && typeof onAttach === 'function') onAttach(list);
			};
			return h('div', { className: 'at-composer' },
				h('div', { className: 'at-composerinner' },
					h('div', {
						className: cx('at-box', mode === 'task' && 'at-taskmode', dragging && 'at-dropping'),
						onDragOver: (event) => { if (discuss && event.dataTransfer?.types?.includes?.('Files')) { event.preventDefault(); setDragging(true); } },
						onDragLeave: () => setDragging(false),
						onDrop: (event) => { setDragging(false); if (!discuss) return; event.preventDefault(); attach(event.dataTransfer?.files); },
					},
						dragging ? h('div', { className: 'at-drophint', 'aria-hidden': 'true' }, t('attachDrop')) : null,
						candidates.length > 0 ? h('ul', { className: 'at-mentions', role: 'listbox', 'aria-label': t('mentionList') },
							candidates.map((agent, index) => h('li', {
								key: agent.id,
								role: 'option',
								'aria-selected': index === mention.index,
								className: cx('at-mention', index === mention.index && 'at-mention-on'),
								onMouseDown: (event) => { event.preventDefault(); pick(agent); },
							}, h('b', null, '@' + agent.name), agent.role ? h('span', null, agent.role) : null))) : null,
						h('textarea', {
							ref: boxRef,
							onMouseUp: (event) => rememberTextareaDrag(event.currentTarget),
							value: draft,
							rows: 2,
							disabled,
							placeholder: mode === 'task' ? t('taskPlaceholder') : t('composer'),
							'aria-label': t('composerAria'),
							onChange: (event) => { onDraft(event.target.value); track(event.target); },
							onClick: (event) => track(event.currentTarget),
							onBlur: () => setMention(null),
							onPaste: (event) => {
								const files = Array.from(event.clipboardData?.files ?? []);
								if (files.length > 0 && discuss) { event.preventDefault(); attach(files); }
							},
							onKeyDown: (event) => {
								if (candidates.length > 0) {
									if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
										event.preventDefault();
										const step = event.key === 'ArrowDown' ? 1 : candidates.length - 1;
										setMention({ ...mention, index: (mention.index + step) % candidates.length });
										return;
									}
									if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
										event.preventDefault();
										pick(candidates[mention.index] ?? candidates[0]);
										return;
									}
									if (event.key === 'Escape') { event.preventDefault(); setMention(null); return; }
								}
								if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
									event.preventDefault();
									send();
								}
							},
						}),
						pending.length > 0 ? h('div', { className: 'at-attachrow' }, pending.map((item) => h('div', {
							key: item.id,
							className: cx('at-attach', item.status === 'error' && 'at-attach-error', item.status === 'uploading' && 'at-attach-busy'),
							title: item.status === 'error' ? item.error : item.name,
						},
							item.preview ? h('img', { src: item.preview, alt: item.name }) : h(Ico, { name: 'file' }),
							h('span', { className: 'at-attachname' }, item.name),
							h('span', { className: 'at-attachsize' }, item.status === 'uploading' ? '…' : fmtBytes(item.size)),
							h('button', { type: 'button', className: 'at-attachx', 'aria-label': tf(t, 'attachRemove', { name: item.name }), onClick: () => onRemoveAttachment?.(item.id) }, '×')))) : null,
						pending.length > 0 && !discuss ? h('div', { className: 'at-hint' }, t('attachTaskMode')) : null,
						mode === 'task' ? h('div', { className: 'at-taskfields' },
							h('textarea', {
								className: 'at-taskdef',
								rows: 2,
								value: definition,
								disabled,
								placeholder: t('taskDefinitionPlaceholder'),
								'aria-label': t('taskDefinitionAria'),
								onChange: (event) => onDefinition(event.target.value),
							}),
							qaRequired ? h('textarea', {
								className: 'at-taskqa',
								rows: 2,
								value: qaChecklist,
								disabled,
								placeholder: t('qaChecklistPlaceholder'),
								'aria-label': t('qaChecklistAria'),
								onChange: (event) => onQaChecklist(event.target.value),
							}) : null) : null,
						h('div', { className: 'at-barrow' },
							h('div', { className: 'at-mode', role: 'group', 'aria-label': t('modeAria') },
								h('button', { type: 'button', 'aria-pressed': mode === 'discuss', onClick: () => onMode('discuss') }, t('discuss')),
								h('button', { type: 'button', 'aria-pressed': mode === 'task', onClick: () => onMode('task') }, t('taskMode'))),
							discuss ? h('button', { className: 'at-attachbtn', type: 'button', title: t('attachAdd'), 'aria-label': t('attachAdd'), disabled, onClick: () => fileRef.current?.click() }, h(Ico, { name: 'clip' })) : null,
							h('input', { ref: fileRef, type: 'file', multiple: true, hidden: true, onChange: (event) => { attach(event.target.files); event.target.value = ''; } }),
							mode === 'task' ? h('label', { className: 'at-qacheck' },
								h('input', { type: 'checkbox', checked: qaRequired, onChange: (event) => onQaRequired(event.target.checked) }),
								h('span', null, t('qaRequired'))) : null,
							h('span', { className: 'at-hint' }, t('enterHint')),
							h('button', { className: 'at-send', type: 'button', disabled: !canSend, onClick: send }, mode === 'task' ? t('createTask') : t('send'))))));
		}

		function QuadrantCard({ t, meta, quadrant, tasks, items, count, onItem, onViewAll }) {
			const shown = (Array.isArray(items) ? items : []).slice(0, 5);
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
						const hasNumber = Number.isFinite(item.taskNumber);
						const itemTitle = (hasNumber ? '#' + item.taskNumber + ' ' : '') + (item.title ?? '');
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
			if (!quadrants) {
				return h('div', { className: 'at-situation', role: 'tabpanel', id: 'at-panel-situation', 'aria-labelledby': 'at-tab-situation' },
					h('div', { className: 'at-situationinner' },
						h(EmptyState, { t, icon: 'dot', title: t('situationAria'), body: '' })));
			}
			// R-04：「团队安静」与「团队停滞」必须是两种语感——安静是健康，
			// 停滞（等你/等验收/受阻）是要处理的事。
			const needsYou = quadrants.q1.count + quadrants.q3.count;
			const mood = needsYou > 0
				? tf(t, 'teamNeedsYou', { n: needsYou })
				: quadrants.q2.count > 0
					? tf(t, 'teamBusy', { n: quadrants.q2.count })
					: t('teamQuiet');
			return h('div', { className: 'at-situation', role: 'tabpanel', id: 'at-panel-situation', 'aria-labelledby': 'at-tab-situation' },
				h('div', { className: 'at-situationinner' },
					h('div', { className: 'at-qmeta' },
						h('span', null, mood + ' · ' + tf(t, 'quadrantMeta', { time: fmtTime(quadrants.generatedAt) })),
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

		const DUTY_LABEL = { lead: 'dutyLead', qa: 'dutyQa', executor: 'dutyExecutor' };
		/** 人才 / 团队成员的卡片正文（人才市场、组队简介、新建项目的团队成员共用一份）。 */
		function TalentInfo({ t, talent, lead, full }) {
			const badge = talent.forked ? withIco('pen', t('talentForked'), 10)
				: talent.source === 'user' ? withIco('user', t('talentUser'), 10)
					: talent.source === 'official' ? withIco('cloud', t('talentOfficial'), 10) : null;
			return [
				h('div', { key: 'head', className: 'at-talenttop' },
				h(Avatar, { name: talent.name, seed: avatarSeed(talent.name), avatar: talent.avatar ?? AVATAR_FALLBACK, size: 40 }),
				h('div', { className: 'at-talenthead' },
					h('span', { className: 'at-talentname' }, talent.name),
					talent.role ? h('span', { className: 'at-talentrole' }, talent.role) : null,
					talent.duty ? h('span', { className: 'at-talentduty' }, t(DUTY_LABEL[talent.duty])) : null,
					lead ? h('span', { className: 'at-talentduty' }, withIco('check', t('teamLeadMark'), 10)) : null,
					badge ? h('span', { className: 'at-talentduty' }, badge) : null)),
				talent.description ? h('div', { key: 'desc', className: 'at-talentdesc' }, talent.description) : null,
				full && talent.personality ? h('div', { key: 'pers', className: 'at-modalmeta' }, talent.personality) : null,
				talent.skills?.length ? h('div', { key: 'skills', className: 'at-modalmeta' }, tf(t, 'talentSkills', { skills: talent.skills.join('、') })) : null,
			];
		}
		/** 「添加成员」弹窗的人才市场页：分类、搜索、卡片；点「招聘」按人才预填表单。 */
		function TalentMarket({ t, talents, error, query, onQuery, category, onCategory, onHire, onFork, onRestore, onCancel, catalog, catalogBusy, catalogNote, onSync, onClear }) {
			const categories = [...new Set((talents ?? []).map((talent) => talent.category).filter(Boolean))];
			const shown = filterTalents(talents, query, category);
			// Fragment：按钮栏直接挂在弹窗下，由弹窗的标题栏放到右上角。
			return h(React.Fragment, null,
				h('div', { className: 'at-modalactions' },
					onSync && catalog && onClear ? h('button', { type: 'button', className: 'at-btn', disabled: catalogBusy, onClick: onClear }, withIco('undo', t('catalogClear'))) : null,
					onSync ? h('button', { type: 'button', className: 'at-btn at-btn-accent', title: t('catalogSyncHint'), disabled: catalogBusy, onClick: onSync }, withIco('sync', catalogBusy ? t('catalogSyncing') : t('catalogSync'))) : null,
					h('span', { className: 'at-actsep', 'aria-hidden': 'true' }),
					h('button', { className: 'at-btn', type: 'button', onClick: onCancel }, withIco('close', t('cancel')))),
				h('div', { className: 'at-modalmeta' }, t('talentHint')),
				onSync ? h('div', { className: 'at-modalmeta at-catalogstate', role: 'status' }, h(Ico, { name: 'cloud', size: 13 }),
					(catalog ? tf(t, 'catalogAt', { version: catalog.version, time: catalog.syncedAt ? new Date(catalog.syncedAt).toLocaleString() : '' }) : t('catalogNone')) + (catalogNote ? ' · ' + catalogNote : '')) : null,
				h('input', { className: 'at-marketsearch', type: 'search', value: query, placeholder: t('talentSearch'), 'aria-label': t('talentSearch'), onChange: (event) => onQuery(event.target.value), autoFocus: true }),
				categories.length > 1 ? h('div', { className: 'at-marketcats', role: 'group', 'aria-label': t('talentMarket') },
					['', ...categories].map((name) => h('button', {
						key: name || '*',
						type: 'button',
						className: 'at-marketcat',
						'aria-pressed': category === name ? 'true' : 'false',
						onClick: () => onCategory(name),
					}, name || t('talentAll')))) : null,
				error ? h('div', { className: 'at-modalerror', role: 'alert' }, tf(t, 'talentLoadFailed', { error })) : null,
				talents === null ? h('div', { className: 'at-modalmeta' }, t('talentLoading'))
					: shown.length === 0 ? h('div', { className: 'at-modalmeta' }, t('talentEmpty'))
						: h('div', { className: 'at-marketgrid', role: 'list', 'aria-label': t('talentMarket') }, shown.map((talent) => h('div', { key: talent.id, className: 'at-talent', role: 'listitem' },
							h(TalentInfo, { t, talent }),
							h('div', { className: 'at-talentfoot' },
								h('span', { className: 'at-modalmeta' }, [talent.category, ...(talent.tags ?? [])].filter(Boolean).join(' · ')),
								h('span', { className: 'at-tcpick' },
									talent.source !== 'user' && onFork ? h('button', { type: 'button', className: 'at-btn at-btn-small', title: t('talentForkHint'), onClick: () => onFork(talent) }, withIco('copy', t('talentFork'), 12)) : null,
									talent.forked && onRestore ? h('button', { type: 'button', className: 'at-btn at-btn-small', onClick: () => onRestore(talent) }, withIco('undo', t('talentRestore'), 12)) : null,
									h('button', { type: 'button', className: 'at-btn at-btn-small at-btn-primary', onClick: () => onHire(talent) }, withIco('userPlus', t('talentHire'), 12))))))));
		}
		function TalentCreator({ t, initial, onSaved, onCancel }) {
			const seed = initial && initial.draft ? talentCreatorInit(initial) : null;
			const [form, setForm] = React.useState(() => (seed ? seed.form : blankTalentForm()));
			const [pending, setPending] = React.useState(() => (seed ? seed.pending : []));
			const [installable, setInstallable] = React.useState([]);
			const [pick, setPick] = React.useState('');
			const [pickFrom, setPickFrom] = React.useState('');
			const [skName, setSkName] = React.useState('');
			const [skBody, setSkBody] = React.useState('');
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState('');
			const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
			React.useEffect(() => {
				let live = true;
				fetch('/ai-team/api/skills-install', { headers: { accept: 'application/json' } })
					.then((r) => r.json()).then((b) => { if (live) setInstallable(Array.isArray(b && b.skills) ? b.skills : []); })
					.catch(() => {});
				return () => { live = false; };
			}, []);
			function stage(skill) {
				if (pending.some((x) => x.name === skill.name)) { setError(t('tcSkillDup')); return false; }
				setPending((pp) => [...pp, skill]); setError(''); return true;
			}
			function addExisting() {
				const sep = String(pickFrom).indexOf('::'); if (sep < 0) return;
				const talent = pickFrom.slice(0, sep); const name = pickFrom.slice(sep + 2);
				if (stage({ name, kind: 'fork', fromTalent: talent, fromSkill: name })) { setPick(''); setPickFrom(''); }
			}
			function addWritten() {
				const name = skName.trim(); if (!name) return;
				if (stage({ name, kind: 'write', markdown: skBody })) { setPick(''); setSkName(''); setSkBody(''); }
			}
			function importFile(event) {
				const file = event.target.files && event.target.files[0]; if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					const name = (file.name.replace(/\.md$/i, '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)) || 'skill';
					stage({ name, kind: 'write', markdown: String(reader.result || '') });
				};
				reader.readAsText(file); event.target.value = '';
			}
			async function save() {
				if (!form.name.trim() || busy) return;
				setBusy(true); setError('');
				try {
					const res = await fetch('/ai-team/api/talents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...talentFormToBody(form), ...(seed && seed.model ? { model: seed.model } : {}) }) });
					const body = await res.json().catch(() => null);
					if (!res.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + res.status));
					const id = body && body.talent && body.talent.id;
					for (const sk of pending) {
						const payload = sk.kind === 'fork' ? { name: sk.name, fromTalent: sk.fromTalent, fromSkill: sk.fromSkill } : sk.kind === 'member' ? { name: sk.name, fromProject: sk.fromProject, fromMember: sk.fromMember } : { name: sk.name, markdown: sk.markdown };
						const r2 = await fetch('/ai-team/api/talents/' + encodeURIComponent(id) + '/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
						const b2 = await r2.json().catch(() => null);
						if (!r2.ok) throw new Error(((b2 && b2.error && b2.error.message) || ('HTTP ' + r2.status)) + '（' + sk.name + '）');
					}
					onSaved();
				} catch (err) {
					setError((err && err.message) || String(err));
				} finally {
					setBusy(false);
				}
			}
			return h(React.Fragment, null,
				h('div', { className: 'at-modalmeta' }, t('tcHint')),
				initial && initial.error ? h('div', { className: 'at-modalerror', role: 'alert' }, initial.error) : null,
				seed ? h('div', { className: 'at-modalmeta' }, tf(t, 'tcFromMember', { name: seed.sourceName })) : null,
				seed && seed.model ? h('div', { className: 'at-modalmeta' }, tf(t, 'tcModelKept', { model: [seed.model.provider, seed.model.model].filter(Boolean).join(' / ') })) : null,
				seed && seed.missing.length ? h('div', { className: 'at-modalmeta' }, tf(t, 'tcMissing', { skills: seed.missing.join('、') })) : null,
				h('div', { className: 'at-fieldgrid3' },
					h('label', { className: 'at-field' }, h('span', null, t('tcName')), h('input', { value: form.name, onChange: set('name'), autoFocus: true })),
					h('label', { className: 'at-field' }, h('span', null, t('tcRole')), h('input', { value: form.role, onChange: set('role') })),
					h('label', { className: 'at-field' }, h('span', null, t('tcDuty')), h('select', { value: form.duty, onChange: set('duty') }, ['executor', 'qa', 'lead'].map((d) => h('option', { key: d, value: d }, t(DUTY_LABEL[d]))))),
					h('label', { className: 'at-field' }, h('span', null, t('tcCategory')), h('input', { value: form.category, onChange: set('category') })),
					h('label', { className: 'at-field' }, h('span', null, t('tcTags')), h('input', { value: form.tags, onChange: set('tags'), placeholder: t('tcTagsHint') }))),
				h('div', { className: 'at-field' }, h('span', null, t('avatarTitle')),
					h(AvatarPicker, { t, value: form.avatar, seed: avatarSeed(form.name), onChange: (avatar) => setForm((prev) => ({ ...prev, avatar })) })),
				h('label', { className: 'at-field' }, h('span', null, t('tcPersonality')), h('textarea', { value: form.personality, onChange: set('personality'), placeholder: t('tcPersonalityHint') })),
				h('div', { className: 'at-field' }, h('span', null, t('tcSkills')),
					pending.length === 0 ? h('div', { className: 'at-modalmeta' }, t('tcEmpty')) : h('div', { className: 'at-tcskills' }, pending.map((sk) => h('span', { key: sk.name, className: 'at-tcskill' }, sk.name, h('button', { type: 'button', 'aria-label': t('tcRemove'), onClick: () => setPending((pp) => pp.filter((x) => x.name !== sk.name)) }, '×')))),
					h('div', { className: 'at-tcpick' },
						h('button', { type: 'button', className: 'at-btn', onClick: () => setPick(pick === 'existing' ? '' : 'existing') }, withIco('store', t('tcAddExisting'))),
						h('button', { type: 'button', className: 'at-btn', onClick: () => setPick(pick === 'write' ? '' : 'write') }, withIco('pen', t('tcWriteOwn'))),
						h('label', { className: 'at-btn' }, withIco('folderPlus', t('tcImport')), h('input', { type: 'file', accept: '.md,text/markdown,text/plain', style: { display: 'none' }, onChange: importFile }))),
					pick === 'existing' ? h('div', { className: 'at-tcpanel' }, h('select', { value: pickFrom, onChange: (e) => setPickFrom(e.target.value) }, h('option', { value: '' }, t('tcPick')), installable.map((sk) => h('option', { key: sk.talent + '::' + sk.name, value: sk.talent + '::' + sk.name }, sk.name + ' — ' + sk.talentName))), h('button', { type: 'button', className: 'at-btn at-btn-primary', onClick: addExisting }, t('tcAdd'))) : null,
					pick === 'write' ? h('div', { className: 'at-tcpanel' }, h('input', { value: skName, placeholder: t('tcSkillName'), onChange: (e) => setSkName(e.target.value) }), h('textarea', { value: skBody, placeholder: t('tcSkillBody'), onChange: (e) => setSkBody(e.target.value) }), h('button', { type: 'button', className: 'at-btn at-btn-primary', onClick: addWritten }, t('tcAdd'))) : null),
				error ? h('div', { className: 'at-modalerror', role: 'alert' }, error) : null,
				h('div', { className: 'at-modalactions' },
					h('button', { type: 'button', className: 'at-btn', onClick: onCancel }, withIco('close', t('cancel'))),
					h('button', { type: 'button', className: 'at-btn at-btn-primary', disabled: !form.name.trim() || busy, onClick: save }, withIco('check', busy ? t('tcSaving') : t('tcSave')))));
		}
		function TeamComposer({ t, talents, onSaved, onCancel }) {
			const [draft, setDraft] = React.useState({ name: '', description: '', members: [], lead: 0 });
			const [query, setQuery] = React.useState('');
			const [focus, setFocus] = React.useState('');
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState('');
			const shown = filterTalents(talents, query, '');
			const byId = (id) => (talents || []).find((x) => x.id === id);
			const focused = byId(focus) || shown[0] || null;
			function add(talent) { setDraft((d) => ({ ...d, members: [...d.members, { talent: talent.id, name: '' }] })); }
			function remove(index) { setDraft((d) => ({ ...d, members: d.members.filter((_, i) => i !== index), lead: d.lead === index ? 0 : d.lead > index ? d.lead - 1 : d.lead })); }
			function rename(index, name) { setDraft((d) => ({ ...d, members: d.members.map((m, i) => (i === index ? { ...m, name } : m)) })); }
			async function save() {
				const body = teamDraftToBody(draft);
				if (!body.name || body.members.length === 0 || busy) return;
				setBusy(true); setError('');
				try {
					const res = await fetch('/ai-team/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
					const out = await res.json().catch(() => null);
					if (!res.ok) throw new Error((out && out.error && out.error.message) || ('HTTP ' + res.status));
					onSaved(out.team);
				} catch (err) {
					setError((err && err.message) || String(err));
				} finally {
					setBusy(false);
				}
			}
			// 三栏：人才列表 → 选中人才的简介（加入）→ 已组的团队（改名、定负责人、移除）。按钮在弹窗右上角。
			return h(React.Fragment, null,
				h('div', { className: 'at-modalactions' },
					h('button', { type: 'button', className: 'at-btn', onClick: onCancel }, withIco('back', t('teamBack'))),
					h('button', { type: 'button', className: 'at-btn at-btn-primary', disabled: busy || !draft.name.trim() || draft.members.length === 0, onClick: save }, withIco('check', busy ? t('saving') : t('teamSave')))),
				h('div', { className: 'at-modalmeta' }, t('teamComposeHint')),
				h('div', { className: 'at-fieldrow' },
					h('label', { className: 'at-field' }, h('span', null, t('teamName')), h('input', { value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }), autoFocus: true })),
					h('label', { className: 'at-field' }, h('span', null, t('teamDesc')), h('input', { value: draft.description, onChange: (e) => setDraft({ ...draft, description: e.target.value }) }))),
				error ? h('div', { className: 'at-modalerror', role: 'alert' }, error) : null,
				h('div', { className: 'at-teamcomposer' },
					h('div', { className: 'at-pane' },
						h('div', { className: 'at-panetitle' }, t('teamPick')),
						h('input', { className: 'at-marketsearch', type: 'search', value: query, placeholder: t('talentSearch'), 'aria-label': t('talentSearch'), onChange: (e) => setQuery(e.target.value) }),
						talents === null ? h('div', { className: 'at-modalmeta' }, t('talentLoading')) : h('div', { className: 'at-panelist', role: 'listbox', 'aria-label': t('teamPick') }, shown.map((talent) => h('button', {
							key: talent.id,
							type: 'button',
							role: 'option',
							className: 'at-pickrow',
							'aria-selected': focused && focused.id === talent.id ? 'true' : 'false',
							onClick: () => setFocus(talent.id),
							onDoubleClick: () => add(talent),
						}, h('span', { className: 'at-talenttop' }, h(Avatar, { name: talent.name, seed: avatarSeed(talent.name), avatar: talent.avatar, size: 22 }), h('span', null, talent.name, ' ', h('span', { className: 'at-pickrole' }, talent.role))), talent.duty ? h('span', { className: 'at-pickrole' }, t(DUTY_LABEL[talent.duty])) : null)))),
					h('div', { className: 'at-pane' },
						h('div', { className: 'at-panetitle' }, t('teamPickDetail')),
						focused ? h('div', { className: 'at-talent' },
							h(TalentInfo, { t, talent: focused, full: true }),
							h('div', { className: 'at-talentfoot' },
								h('span', { className: 'at-modalmeta' }, [focused.category, ...(focused.tags ?? [])].filter(Boolean).join(' · ')),
								h('span', { className: 'at-tcpick' }, h('button', { type: 'button', className: 'at-btn at-btn-small at-btn-primary', onClick: () => add(focused) }, withIco('plus', t('teamAdd'), 12)))))
							: h('div', { className: 'at-modalmeta' }, t('teamPickDetailEmpty'))),
					h('div', { className: 'at-pane' },
						h('div', { className: 'at-panetitle' }, t('teamMembers') + ' · ' + draft.members.length),
						draft.members.length === 0 ? h('div', { className: 'at-modalmeta' }, t('teamEmptyPick')) : h('div', { className: 'at-teamrows' }, draft.members.map((m, i) => {
							const talent = byId(m.talent) || { name: m.talent, role: '' };
							return h('div', { key: i, className: 'at-teamrow' },
								h(Avatar, { name: m.name || talent.name, seed: avatarSeed(m.name || talent.name), avatar: talent.avatar, size: 24 }),
								h('input', { value: m.name, placeholder: talent.name, 'aria-label': t('teamName'), onChange: (e) => rename(i, e.target.value), onFocus: () => setFocus(m.talent) }),
								h('span', { className: 'at-modalmeta' }, talent.role),
								h('label', { className: 'at-teamlead' }, h('input', { type: 'radio', name: 'team-lead', checked: draft.lead === i, onChange: () => setDraft({ ...draft, lead: i }) }), t('teamLead')),
								h('button', { type: 'button', className: 'at-btn at-btn-small at-iconbtn', 'aria-label': t('tcRemove'), title: t('tcRemove'), onClick: () => remove(i) }, h(Ico, { name: 'close', size: 12 })));
						})))));
		}
		function ModelFields({ t, catalog, provider, model, effort, onEffort, onProvider, onModel, error }) {
			const providers = Array.isArray(catalog?.providers) ? catalog.providers.slice() : [];
			// 推理等级按「提供商 + 模型」按需解析：不同模型支持的档位不同，宿主也随时可能
			// 换适配器，写死一份档位表必然漂移。查不到（服务/适配器报错）与「该模型没有档位」
			// 分开提示，前者不该让用户以为模型不支持推理。
			const [efforts, setEfforts] = React.useState(null);
			const [effortsError, setEffortsError] = React.useState('');
			const [effortsLoading, setEffortsLoading] = React.useState(false);
			React.useEffect(() => {
				let alive = true;
				const routeProvider = provider.trim();
				const routeModel = model.trim();
				if (routeProvider === '' || routeModel === '') {
					setEfforts(null);
					setEffortsError('');
					setEffortsLoading(false);
					return () => { alive = false; };
				}
				setEffortsLoading(true);
				const query = '?provider=' + encodeURIComponent(routeProvider) + '&model=' + encodeURIComponent(routeModel);
				fetch('/ai-team/api/model-efforts' + query, { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const body = await response.json().catch(() => null);
						if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
						return body;
					})
					.then((body) => {
						if (!alive) return;
						// 端点用 ok:false 表达「查不到」：不能当成「该模型没有档位」，否则用户
						// 会以为模型不支持推理，而实际是适配器没回答。
						if (body !== null && typeof body === 'object' && body.ok === false) {
							throw new Error(body?.error?.message ?? t('memberReasoningError'));
						}
						setEfforts({ efforts: Array.isArray(body?.efforts) ? body.efforts : [], defaultEffort: body?.defaultEffort ?? null });
						setEffortsError('');
					})
					.catch((cause) => {
						if (!alive) return;
						setEfforts({ efforts: [], defaultEffort: null });
						setEffortsError(cause?.message ?? String(cause));
					})
					.finally(() => { if (alive) setEffortsLoading(false); });
				return () => { alive = false; };
			}, [provider, model]);
			const availableEfforts = Array.isArray(efforts?.efforts) ? efforts.efforts : [];
			const effortOptions = availableEfforts.slice();
			// 账本里已有的档位若不在当前列表（模型换过/宿主改了档位），保留它以免静默改写。
			if (typeof effort === 'string' && effort !== '' && !effortOptions.some((entry) => entry.id === effort)) {
				effortOptions.push({ id: effort, name: effort });
			}
			const effortHint = effortsError
				? tf(t, 'memberReasoningError', { message: effortsError })
				: efforts !== null && availableEfforts.length === 0 && effortsLoading === false
					? t('memberReasoningNone')
					: '';
			if (provider !== '' && !providers.some((entry) => entry.id === provider)) {
				providers.unshift({ id: provider, name: provider, models: model === '' ? [] : [{ id: model, name: model }], modelCount: model === '' ? 0 : 1 });
			}
			const selected = providers.find((entry) => entry.id === provider);
			const models = Array.isArray(selected?.models) ? selected.models.slice() : [];
			if (model !== '' && !models.some((entry) => entry.id === model)) models.unshift({ id: model, name: model });
			const fallbackProvider = catalog?.defaultModel?.provider ?? '';
			const fallbackModel = catalog?.defaultModel?.model ?? '';
			const chooseProvider = (event) => {
				const next = event.target.value;
				onProvider(next);
				if (next === '') {
					onModel('');
					return;
				}
				if (fallbackProvider === next && fallbackModel !== '') {
					onModel(fallbackModel);
					return;
				}
				const entry = providers.find((candidate) => candidate.id === next);
				onModel(entry?.models?.[0]?.id ?? '');
			};
			const hint = error
				? error
				: catalog === null
					? t('memberModelsLoading')
					: providers.length === 0
						? t('memberNoProviders')
						: provider !== '' && models.length === 0
							? t('memberNoModels')
							: '';
			return h('div', { className: 'at-modelfields' },
				h('div', { className: 'at-fieldrow' },
					h('label', { className: 'at-field' }, h('span', null, t('memberProvider')),
						h('select', { value: provider, onChange: chooseProvider },
							h('option', { value: '' }, t('memberProviderDefault')),
							providers.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name + (entry.modelCount ? ' · ' + entry.modelCount : ''))),
						)
					),
					h('label', { className: 'at-field' }, h('span', null, t('memberModel')),
						h('select', {
							value: model,
							disabled: provider === '' || models.length === 0,
							onChange: (event) => onModel(event.target.value),
						},
							h('option', { value: '' }, t('memberModelDefault')),
							models.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name === entry.id ? entry.id : entry.name + ' · ' + entry.id)),
						)
					),
					h('label', { className: 'at-field' }, h('span', null, t('memberReasoning')),
						h('select', {
							value: typeof effort === 'string' ? effort : '',
							disabled: provider === '' || model === '' || effortsLoading,
							onChange: (event) => onEffort(event.target.value),
						},
							h('option', { value: '' }, t('memberReasoningDefault')),
							effortOptions.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name === entry.id ? entry.id : entry.name + ' · ' + entry.id)),
						)
					)
				),
				hint ? h('div', { className: 'at-fieldhint' }, hint) : null,
				effortHint ? h('div', { className: 'at-fieldhint' }, effortHint) : null);
		}

		// <stream-follow>
		/**
		 * 主对话的「跟随最新」判定（#33：打开主对话总停在最早的消息，要手动拖到底）。
		 * 只读写传入元素的 scrollTop/scrollHeight/clientHeight，不碰 DOM 结构，便于单测。
		 *   - 打开主对话 / 切项目（reset）后贴底，内容晚到或变高时继续贴底；
		 *   - 用户停在底部附近（≤ threshold）即视为跟随，新消息到达自动贴底；
		 *   - 用户上翻后不动其位置（数据刷新不得改变用户滚动位置），只累计未读数，
		 *     由「↓ N 条新消息」按钮（jump）回到底部。
		 */
		function createStreamFollower({ threshold = 48 } = {}) {
			let pinned = true;
			let unseen = 0;
			let count = null;
			const distance = (el) => el.scrollHeight - el.scrollTop - el.clientHeight;
			const bottom = (el) => Math.max(0, el.scrollHeight - el.clientHeight);
			return {
				reset() { pinned = true; unseen = 0; count = null; },
				onScroll(el) {
					pinned = distance(el) <= threshold;
					if (pinned) unseen = 0;
					return unseen;
				},
				/** 消息数或内容变化后调用；返回 { scrollTo: number|null, unseen }。 */
				onContent(el, nextCount) {
					const grown = count === null ? 0 : Math.max(0, nextCount - count);
					count = nextCount;
					if (pinned) { unseen = 0; return { scrollTo: bottom(el), unseen }; }
					unseen += grown;
					return { scrollTo: null, unseen };
				},
				/** 布局变高（卡片展开、字体晚到）时调用：跟随中才贴底。 */
				onResize(el) { return pinned ? bottom(el) : null; },
				jump(el) { pinned = true; unseen = 0; return bottom(el); },
				get pinned() { return pinned; },
			};
		}
		// </stream-follow>

		// <textarea-fit>
		/**
		 * 输入框随内容长高（#65：输入框只显示一两行，长文看不全也拉不大）。
		 *   - 高度 = max(内容高度, 用户拖出来的高度)，封顶 maxHeight，超出才出滚动条；
		 *   - 用户拖动右下角改过高度（与上次自适应结果不同）即记为下限，清空发送后保持；
		 * 只读写传入元素的 style/dataset/scrollHeight/offsetHeight，便于单测。
		 */
		function fitTextarea(el, maxHeight) {
			if (el === null || el === undefined || el.style === undefined) return null;
			const floor = Number(el.dataset?.userHeight) || 0;
			el.style.height = 'auto';
			const want = Math.max(el.scrollHeight, floor);
			const height = Math.min(want, maxHeight);
			el.style.height = height + 'px';
			el.style.overflowY = want > maxHeight ? 'auto' : 'hidden';
			if (el.dataset) el.dataset.fitHeight = String(height);
			return height;
		}
		/** 拖动结束时调用：高度与自适应结果不同 = 用户手动调过，记为下限。 */
		function rememberTextareaDrag(el) {
			if (el === null || el === undefined || !el.dataset) return null;
			const fitted = Number(el.dataset.fitHeight) || 0;
			if (Math.abs(el.offsetHeight - fitted) <= 2) return null;
			el.dataset.userHeight = String(el.offsetHeight);
			return el.offsetHeight;
		}
		// </textarea-fit>

		/** 输入框自适应的 React 接线（主对话与任务回复共用）；封顶为窗口高度的 45%，至少 160px。 */
		function useFitTextarea(ref, value) {
			React.useLayoutEffect(() => {
				const viewport = Number(globalThis.innerHeight) || 800;
				fitTextarea(ref?.current, Math.max(160, Math.floor(viewport * 0.45)));
			}, [ref, value]);
		}

		// <member-copy>
		// 头像：插件本机按名字画（@suifei/hash-avatar 契约 v1，与 avatar.onrpc.com 同图），人才与按原名招来的成员是同一张脸。
		const AVATAR_ROUTE = '/ai-team/api/avatar.svg';
		const AVATAR_CHOICES = { gender: ['male', 'female', 'neutral'], age: ['baby', 'teen', 'youth', 'middle', 'old'], race: ['asian', 'white', 'black', 'brown', 'auto'] };
		/** 没设过头像、也查不到来源人才的成员：亚洲人、青年、性别不指定。 */
		const AVATAR_FALLBACK = { gender: 'neutral', age: 'youth', race: 'asian' };
		/** 自建时的初始选项：亚洲人、青年、男。 */
		const AVATAR_PICK_DEFAULT = { gender: 'male', age: 'youth', race: 'asian' };
		/** 当前项目成员名 → { seed, avatar }，给只拿到名字的地方（消息、人员池）用。 */
		const AVATAR_INDEX = new Map();
		/** 画像种子就是名字：人才和按原名招来的成员同一张脸；改名换脸，参数不变。 */
		function avatarSeed(name) {
			return String(name ?? '').trim() || '?';
		}
		function avatarUrl(seed, avatar, size) {
			const pick = (key) => (AVATAR_CHOICES[key].includes(avatar && avatar[key]) ? avatar[key] : AVATAR_FALLBACK[key]);
			const px = Math.max(16, Math.min(1024, Math.round((Number(size) || 24) * 2)));
			return AVATAR_ROUTE + '?name=' + encodeURIComponent(String(seed ?? '')) + '&gender=' + pick('gender') + '&age=' + pick('age') + '&race=' + pick('race') + '&size=' + px;
		}
		/** 成员的头像参数：自己设过的 > 来源人才的 > 默认（负责人按中年）。 */
		function memberAvatarOf(agent, talents) {
			if (agent && agent.avatar) return agent.avatar;
			const talent = (Array.isArray(talents) ? talents : []).find((x) => x && x.id === (agent && agent.talent));
			if (talent && talent.avatar) return talent.avatar;
			return { ...AVATAR_FALLBACK, age: agent && agent.duty === 'lead' ? 'middle' : AVATAR_FALLBACK.age };
		}
		function rememberAvatars(agents, talents) {
			AVATAR_INDEX.clear();
			for (const agent of Array.isArray(agents) ? agents : []) {
				if (agent && agent.kind !== 'human' && agent.name) AVATAR_INDEX.set(agent.name, { seed: avatarSeed(agent.name), avatar: memberAvatarOf(agent, talents) });
			}
		}
		/**
		 * 复制成员（#65：想要两个「玄策」一起写代码，只能手工重填一遍）。
		 * 沿用角色、人格、运行配方、模型、输出上限与技能；不带笔记、会话与任务（那是原成员自己的经历）。
		 * 名字取「原名去掉尾部数字 + 最小未占用序号」：玄策 → 玄策2，再复制玄策2 → 玄策3。
		 */
		function copyMemberDraft(source, takenNames) {
			const taken = new Set((Array.isArray(takenNames) ? takenNames : []).map((name) => String(name ?? '').trim()));
			const base = String(source?.name ?? '').trim().replace(/\s*\d+$/, '') || 'agent';
			let n = 2;
			while (taken.has(base + n)) n += 1;
			const config = source?.config ?? {};
			const maxTokens = Number(config.maxTokens);
			return {
				name: base + n,
				role: typeof source?.role === 'string' ? source.role : '',
				personality: typeof source?.personality === 'string' ? source.personality : '',
				preset: config.preset ?? source?.preset ?? 'standard',
				provider: config.provider ?? '',
				model: config.model ?? '',
				reasoningEffort: config.reasoningEffort ?? '',
				maxTokens: Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : null,
				skills: (Array.isArray(source?.skills) ? source.skills : []).filter((skill) => typeof skill === 'string' && skill.trim() !== ''),
				sourceName: String(source?.name ?? ''),
				avatar: source?.avatar ?? null,
			};
		}
		/**
		 * 人才市场「招聘」：按人才预填新增成员表单（与复制成员同一份草稿形状），名字被占用时加序号；
		 * 记下来源人才与版本、职责，随 member.add 写进账本。
		 */
		function hireTalentDraft(talent, takenNames) {
			const taken = new Set((Array.isArray(takenNames) ? takenNames : []).map((name) => String(name ?? '').trim()));
			const base = String(talent?.name ?? '').trim() || 'agent';
			let name = base;
			for (let n = 2; taken.has(name); n += 1) name = base + n;
			const model = talent?.model ?? {};
			return {
				name,
				role: typeof talent?.role === 'string' ? talent.role : '',
				personality: typeof talent?.personality === 'string' ? talent.personality : '',
				preset: 'standard',
				provider: model.provider ?? '',
				model: model.model ?? '',
				reasoningEffort: model.reasoningEffort ?? '',
				maxTokens: null,
				skills: (Array.isArray(talent?.skills) ? talent.skills : []).filter((skill) => typeof skill === 'string' && skill.trim() !== ''),
				sourceName: base,
				talent: { id: String(talent?.id ?? ''), version: String(talent?.version ?? '') },
				duty: ['lead', 'qa', 'executor'].includes(talent?.duty) ? talent.duty : null,
				avatar: talent?.avatar ?? null,
			};
		}
		/** 人才市场筛选：分类精确匹配；关键词在名字、岗位、分类、标签、说明、技能里找（不分大小写）。 */
		function filterTalents(talents, query, category) {
			const q = String(query ?? '').trim().toLowerCase();
			return (Array.isArray(talents) ? talents : []).filter((talent) => {
				if (category && talent.category !== category) return false;
				if (q === '') return true;
				return [talent.name, talent.role, talent.category, talent.description, ...(talent.tags ?? []), ...(talent.skills ?? [])]
					.some((field) => String(field ?? '').toLowerCase().includes(q));
			});
		}
		function blankTalentForm() {
			return { name: '', role: '', duty: 'executor', category: '', tags: '', personality: '', avatar: { ...AVATAR_PICK_DEFAULT } };
		}
		/** 新建人才表单 → POST /api/talents 的请求体：标签按逗号/顿号/空白拆开，职责只认三种。 */
		function talentFormToBody(form) {
			const tags = String((form && form.tags) || '').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
			return {
				name: String((form && form.name) || '').trim(),
				role: String((form && form.role) || '').trim(),
				duty: ['lead', 'qa', 'executor'].includes(form && form.duty) ? form.duty : 'executor',
				category: String((form && form.category) || '').trim(),
				tags,
				personality: String((form && form.personality) || '').trim(),
				...(form && form.avatar ? { avatar: form.avatar } : {}),
			};
		}
		/**
		 * 「存为人才」：服务端草稿 → 新建人才页的初值。找得到正文的技能按「从成员拷」暂存，找不到的单列出来。
		 */
		function talentCreatorInit(initial) {
			const draft = (initial && initial.draft) || {};
			const skills = Array.isArray(draft.skills) ? draft.skills : [];
			return {
				form: { name: String(draft.name || ''), role: String(draft.role || ''), duty: ['lead', 'qa', 'executor'].includes(draft.duty) ? draft.duty : 'executor', category: String(draft.category || ''), tags: (Array.isArray(draft.tags) ? draft.tags : []).join(', '), personality: String(draft.personality || ''), avatar: draft.avatar ? { ...draft.avatar } : { ...AVATAR_PICK_DEFAULT } },
				pending: skills.filter((x) => x && x.found).map((x) => ({ name: x.name, kind: 'member', fromProject: initial.projectId, fromMember: initial.memberId })),
				missing: skills.filter((x) => x && !x.found).map((x) => x.name),
				model: draft.model && (draft.model.provider || draft.model.model) ? draft.model : null,
				sourceName: String(draft.name || ''),
			};
		}
		/** 组队草稿 → POST /api/teams 请求体：成员只带人才 id 与（改过的）名字；负责人按下标，越界退回第一位。 */
		function teamDraftToBody(draft) {
			const members = (Array.isArray(draft && draft.members) ? draft.members : []).filter((m) => m && m.talent).map((m) => (String(m.name || '').trim() ? { talent: m.talent, name: String(m.name).trim() } : { talent: m.talent }));
			const lead = Number.isInteger(draft && draft.lead) && draft.lead >= 0 && draft.lead < members.length ? draft.lead : 0;
			return { name: String((draft && draft.name) || '').trim(), description: String((draft && draft.description) || '').trim(), members, lead };
		}
		/** 团队一行摘要：负责人打星，其余按名字列出。 */
		function teamMembersLine(team) {
			return (Array.isArray(team && team.members) ? team.members : []).map((m) => (m.id === team.lead ? '★' : '') + m.name + (m.role ? '·' + m.role : '')).join('、');
		}
		// </member-copy>

		// <composer-rich>
		/**
		 * 输入框里的 @ 与附件（#65）。纯函数，便于单测；服务端用同一份花名册规则识别 @（rich-message.js）。
		 * mentionQuery：光标前最近的 @ 到光标之间没有空白、不超过 16 字时，返回 { start, query }。
		 */
		function mentionQuery(text, caret) {
			const before = String(text ?? '').slice(0, caret);
			const at = before.lastIndexOf('@');
			if (at === -1) return null;
			const query = before.slice(at + 1);
			if (/\s/.test(query) || query.length > 16) return null;
			return { start: at, query };
		}
		/** 在岗 agent 中名字以 query 开头的排前、包含的排后，最多 8 个。 */
		function mentionCandidates(agents, query) {
			const q = String(query ?? '').toLowerCase();
			const active = (Array.isArray(agents) ? agents : []).filter((agent) => agent?.status !== 'retired' && typeof agent?.name === 'string' && agent.name !== '');
			const starts = active.filter((agent) => agent.name.toLowerCase().startsWith(q));
			const contains = active.filter((agent) => !agent.name.toLowerCase().startsWith(q) && agent.name.toLowerCase().includes(q));
			return [...starts, ...contains].slice(0, 8);
		}
		/** 用「@名字 」替换 start..caret，返回新文本与新光标。 */
		function applyMention(text, start, caret, name) {
			const value = String(text ?? '');
			const inserted = '@' + name + ' ';
			return { text: value.slice(0, start) + inserted + value.slice(caret), caret: start + inserted.length };
		}
		const ATTACH_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
		/** 浏览器 File → 上传种类：宿主收的四种图片走 image（会规范化、给模型看），其余一律原样作为文件。 */
		function attachmentKind(file) {
			return ATTACH_IMAGE_TYPES.includes(file?.type) ? 'image' : 'file';
		}
		function fmtBytes(bytes) {
			const n = Number(bytes) || 0;
			if (n < 1024) return n + ' B';
			if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
			return (n / 1024 / 1024).toFixed(1) + ' MB';
		}
		// </composer-rich>

		/**
		 * 滚动容器「跟随最新」的 React 接线（主对话、任务记录共用这一份）。
		 *   key   变化即重置并贴底（切项目/标签/任务）；
		 *   shown 容器在场时才量尺寸；
		 *   count/tail 条目数与最后一条的标识，变化即按 follower 判定贴底或累计未读。
		 * 只用 useLayoutEffect：尺寸读写要在绘制前完成，避免先闪到顶部再跳到底。
		 */
		function useFollowLatest({ key, shown, count, tail }) {
			const ref = React.useRef(null);
			const followerRef = React.useRef(null);
			if (followerRef.current === null) followerRef.current = createStreamFollower();
			const [unseen, setUnseen] = React.useState(0);
			React.useLayoutEffect(() => {
				followerRef.current.reset();
				setUnseen(0);
			}, [key]);
			React.useLayoutEffect(() => {
				const el = ref.current;
				if (!shown || el === null || el === undefined) return;
				const step = followerRef.current.onContent(el, count);
				if (step.scrollTo !== null) el.scrollTop = step.scrollTo;
				setUnseen(step.unseen);
			}, [key, shown, count, tail]);
			React.useLayoutEffect(() => {
				const el = ref.current;
				if (!shown || el === null || el === undefined || typeof ResizeObserver !== 'function') return undefined;
				// 观察每个直接子块：容器自身高度固定，内容变高（卡片展开、字体晚到）只体现在子块上。
				const observer = new ResizeObserver(() => {
					const to = followerRef.current.onResize(el);
					if (to !== null) el.scrollTop = to;
				});
				for (const child of Array.from(el.children ?? [])) observer.observe(child);
				return () => observer.disconnect();
			}, [key, shown, count]);
			return {
				ref,
				unseen,
				onScroll: (event) => setUnseen(followerRef.current.onScroll(event.currentTarget)),
				jump: () => {
					const el = ref.current;
					if (el !== null && el !== undefined) el.scrollTop = followerRef.current.jump(el);
					setUnseen(0);
				},
			};
		}

		/** 「↓ N 条新消息」：零高度锚点 + 绝对定位按钮，不进文档流，不改变任何滚动位置。 */
		function JumpToLatest({ t, unseen, onJump }) {
			if (!(unseen > 0)) return null;
			return h('div', { className: 'at-streamjumpanchor' },
				h('button', { className: 'at-streamjump', type: 'button', onClick: onJump },
					h(Ico, { name: 'down', size: 12 }), tf(t, 'streamUnseen', { count: unseen })));
		}

		function Workbench({ t, ctx }) {
			const [phase, setPhase] = React.useState('loading');
			const [data, setData] = React.useState(null);
			const [loadError, setLoadError] = React.useState('');
			const [projectId, setProjectId] = React.useState('');
			const [scope, setScope] = React.useState('project');
			const [tab, setTab] = React.useState('main');
			const [selected, setSelected] = React.useState('');
			const [threadOpen, setThreadOpen] = React.useState(false);
			const [mode, setMode] = React.useState('discuss');
			const [qaTask, setQaTask] = React.useState(false);
			const [taskDefinition, setTaskDefinition] = React.useState('');
			const [qaChecklistText, setQaChecklistText] = React.useState('');
			const [draft, setDraft] = React.useState('');
			const [note, setNote] = React.useState('');
			const [toasts, setToasts] = React.useState([]);
			const [rightNote, setRightNote] = React.useState('');
			const [reply, setReply] = React.useState('');
			const [follows, setFollows] = React.useState({});
			const [doneOpen, setDoneOpen] = React.useState(true);
			const [boardFilter, setBoardFilter] = React.useState('all');
			const [converting, setConverting] = React.useState(false);
			const [cTitle, setCTitle] = React.useState('');
			const [cDod, setCDod] = React.useState('');
			const [acceptChecked, setAcceptChecked] = React.useState(false);
			const [qaChecks, setQaChecks] = React.useState([]);
			const [addOpen, setAddOpen] = React.useState(false);
			const [mCopy, setMCopy] = React.useState(null);
			// 人才市场（「添加成员」弹窗第一页）：可招聘的人才、筛选条件与当前页。
			const [mTab, setMTab] = React.useState('market');
			const [talents, setTalents] = React.useState(null);
			const [talentError, setTalentError] = React.useState('');
			const [catalogInfo, setCatalogInfo] = React.useState(null);
			const [catalogBusy, setCatalogBusy] = React.useState(false);
			const [catalogNote, setCatalogNote] = React.useState('');
			const [talentQuery, setTalentQuery] = React.useState('');
			const [talentCategory, setTalentCategory] = React.useState('');
			// 「存为人才」：成员草稿（服务端生成），预填新建人才页。
			const [talentInit, setTalentInit] = React.useState(null);
			const [mName, setMName] = React.useState('');
			const [mRole, setMRole] = React.useState('');
			const [mAvatar, setMAvatar] = React.useState(null);
			const [mPrompt, setMPrompt] = React.useState('');
			const [mProvider, setMProvider] = React.useState('');
			const [mEffort, setMEffort] = React.useState('');
			const [mModel, setMModel] = React.useState('');
			const [modelCatalog, setModelCatalog] = React.useState(null);
			const [modelCatalogError, setModelCatalogError] = React.useState('');
			const [mOwner, setMOwner] = React.useState(false);
			const [mBusy, setMBusy] = React.useState(false);
			const [mError, setMError] = React.useState('');
			const [profileAgent, setProfileAgent] = React.useState(null);
			const [pName, setPName] = React.useState('');
			const [pRole, setPRole] = React.useState('');
			const [pAvatar, setPAvatar] = React.useState(null);
			const [pPersonality, setPPersonality] = React.useState('');
			const [pPreset, setPPreset] = React.useState('standard');
			const [pProvider, setPProvider] = React.useState('');
			const [pModel, setPModel] = React.useState('');
			const [pMaxTokens, setPMaxTokens] = React.useState('');
			const [pEffort, setPEffort] = React.useState('');
			const [pNote, setPNote] = React.useState('');
			const [pSkill, setPSkill] = React.useState('');
			const [pMessage, setPMessage] = React.useState('');
			const [pEvolve, setPEvolve] = React.useState('');
			const [pTab, setPTab] = React.useState('basic');
			// 人员池「配置模型」弹窗：选中的成员名（null = 关）。
			const [peopleModel, setPeopleModel] = React.useState(null);
			const [newOpen, setNewOpen] = React.useState(false);
			const [nName, setNName] = React.useState('');
			const [nGoal, setNGoal] = React.useState('');
			const [nWorkspace, setNWorkspace] = React.useState('');
			// 新建项目选团队（2d）：团队列表、所选团队、组队面板。
			const [teamList, setTeamList] = React.useState(null);
			const [nTeam, setNTeam] = React.useState('');
			const [teamLoadError, setTeamLoadError] = React.useState('');
			const [teamComposeOpen, setTeamComposeOpen] = React.useState(false);
			const selectedTeam = (teamList || []).find((entry) => entry.id === nTeam) || null;
			const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
			const [workspaceDraft, setWorkspaceDraft] = React.useState('');
			const [workspaceError, setWorkspaceError] = React.useState('');
			const [workspaceBusy, setWorkspaceBusy] = React.useState(false);
			const [memberViewId, setMemberViewId] = React.useState(null);
			// 人员池（全局层）：进入该 scope 时拉取一次聚合视图。
			const [peopleData, setPeopleData] = React.useState(null);
			const [peopleError, setPeopleError] = React.useState('');
			const [peopleLoading, setPeopleLoading] = React.useState(false);
			// 人员池拉取序号：并发/乱序响应只认最新一次。
			const peopleSeqRef = React.useRef(0);
			// 风险清单（R-07）：进入收件箱时拉取当前项目三类风险。
			const [risksData, setRisksData] = React.useState(null);
			// R-18 任务事件历史。
			const [taskEventsData, setTaskEventsData] = React.useState(null);
			const riskSeqRef = React.useRef(0);
			// R-18 任务事件历史（只读）。
			function openTaskEvents(taskId) {
				fetch(`/ai-team/api/projects/${encodeURIComponent(projectId || '')}/tasks/${encodeURIComponent(taskId)}/events`, { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (!response.ok) throw new Error(payload?.error?.message ?? ('HTTP ' + response.status));
						setTaskEventsData({ taskId, events: payload.events ?? [] });
					})
					.catch(() => setTaskEventsData(null));
			}
			// R-09 待验收跨项目队列。
			const [pendingRows, setPendingRows] = React.useState(null);
			// 拉取失败与「确实没有待验收」必须可区分（旧实现把失败写成空数组）。
			const [pendingError, setPendingError] = React.useState('');
			function loadPending() {
				fetch('/ai-team/api/pending-acceptance', { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (!response.ok) throw new Error(payload?.error?.message ?? ('HTTP ' + response.status));
						setPendingRows(Array.isArray(payload?.rows) ? payload.rows : []);
						setPendingError('');
					})
					.catch((error) => setPendingError(error?.message ?? String(error)));
			}
			function loadRisks() {
				const seq = ++riskSeqRef.current;
				fetch('/ai-team/api/risks' + (projectId ? '?project=' + encodeURIComponent(projectId) : ''), { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (!response.ok) throw new Error(payload?.error?.message ?? ('HTTP ' + response.status));
						if (seq !== riskSeqRef.current) return;
						setRisksData(payload?.risks ?? null);
					})
					.catch(() => { if (seq === riskSeqRef.current) setRisksData(null); })
					.finally(() => { /* 风险区自带空态，不复用 people 的 loading */ });
			}
			// 最新 scope 镜像：SSE 回调在 effect 闭包里拿不到最新值。
			const scopeRef = React.useRef(scope);
			// SSE 断流一次性提示：只提示一次，恢复后重置。
			const streamDownRef = React.useRef(false);
			// 发送在途守卫：双击按钮或连按 Ctrl+Enter 会重复提交同一条消息/回复。
			const sendingRef = React.useRef(false);
			scopeRef.current = scope;
			const [nBusy, setNBusy] = React.useState(false);
			const [nError, setNError] = React.useState('');
			const [pSuccessor, setPSuccessor] = React.useState('');
			const [pBusy, setPBusy] = React.useState(false);
			const [pError, setPError] = React.useState('');
			const [replyBase, setReplyBase] = React.useState(null);
			// R-06 决策回流高亮：主对话中被指认的 stream 消息 id。
			const [streamHighlight, setStreamHighlight] = React.useState(null);
			// P1b 批量取消的忙碌标志——必须位于 Skeleton early-return 之前
			// （React hooks 数量在渲染间必须恒定，否则 #310）。
			const [cancelAllBusy, setCancelAllBusy] = React.useState(false);
			// P17 同人绑定输入（同上：hooks 必须在 early-return 之前）。
			const [aliasName, setAliasName] = React.useState('');
			const [aliasTarget, setAliasTarget] = React.useState('');
			// 自绘确认/输入对话框（替代原生 prompt/confirm，观感与宿主一致）。
			// dialog: { mode: 'confirm'|'prompt'|'choice', title, body, placeholder,
			//           value, options, resolve } — resolve(false|null|字符串)。
			const [dialog, setDialog] = React.useState(null);
			const dialogSeqRef = React.useRef(0);
			// 每次打开新对话框自增 key：WorkbenchDialog 以全新实例挂载，
			// 输入框的初始值（useState 初值）随之生效。
			const askConfirm = (title, body) => new Promise((resolve) => {
				dialogSeqRef.current += 1;
				setDialog({ mode: 'confirm', title, body, resolve });
			});
			const askPrompt = (title, { placeholder = '', value = '', options = null, optional = false } = {}) => new Promise((resolve) => {
				dialogSeqRef.current += 1;
				setDialog({
					mode: options === null ? 'prompt' : 'choice',
					title,
					placeholder,
					value: value ?? (options && options.length > 0 ? options[0] : ''),
					options,
					optional,
					resolve,
				});
			});
			const rightRef = React.useRef(null);
			const replyRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const mobileRef = React.useRef(null);
			// #33 主对话跟随最新（useFollowLatest / createStreamFollower）。
			const streamItems = Array.isArray(data?.stream) ? data.stream : [];
			const mainFollow = useFollowLatest({
				key: projectId + '|' + scope + '|' + tab,
				shown: scope === 'project' && tab === 'main' && data !== null,
				count: streamItems.length,
				tail: streamItems.length > 0 ? streamItems[streamItems.length - 1]?.id ?? '' : '',
			});
			const streamRef = mainFollow.ref;
			const streamUnseen = mainFollow.unseen;
			const onStreamScroll = mainFollow.onScroll;
			const jumpToLatest = mainFollow.jump;
			// R-08 快捷键：composer 聚焦句柄 + `?` 帮助浮层开关。
			const composerInputRef = React.useRef(null);
			const [pendingFiles, setPendingFiles] = React.useState([]);
			const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
			const gPrefixRef = React.useRef(0);
			// Latest-data mirror for effects that must react to `selected` alone,
			// and a monotonically increasing load sequence so a stale bootstrap
			// response can never overwrite a newer one.
			const dataRef = React.useRef(null);
			const loadSeqRef = React.useRef(0);
			const applyData = (next) => {
				dataRef.current = next;
				setData(next);
				// 首次使用：默认项目没有工作目录时，插件还不完整可用——直接把「工作
				// 目录」编辑器打开，并把宿主建议的目录填进去，用户确认后才继续。
				if (next?.setupRequired === true && next?.project?.workspacePath === '') {
					setWorkspaceDraft(next.defaultWorkspace ?? '');
					setWorkspaceError('');
					setWorkspaceOpen(true);
				}
			};

			React.useEffect(() => {
				let alive = true;
				const controller = typeof AbortController === 'function' ? new AbortController() : null;
				// The package is @suifei/dsh-ai-team; the Host prefix is /ai-team.
				// 头像要按成员的来源人才取参数：进工作台（切项目）时顺带取人才列表（没设过头像的老成员靠它）。
				void loadTalents();
				const query = projectId ? '?project=' + encodeURIComponent(projectId) : '';
				async function load() {
					const seq = ++loadSeqRef.current;
					let lastError = null;
					try {
						const response = await fetch('/ai-team/api/bootstrap' + query, {
							headers: { accept: 'application/json' },
							signal: controller ? controller.signal : undefined,
						});
						if (!response.ok) throw new Error('HTTP ' + response.status + ' for /ai-team/api/bootstrap');
						const next = normalizePayload(await response.json());
						if (!next) throw new Error('invalid bootstrap payload');
						if (!alive || seq !== loadSeqRef.current) return;
						applyData(next);
						setLoadError('');
						setPhase('ready');
						return;
					} catch (error) {
						lastError = error;
						if (!alive || (controller && controller.signal.aborted)) return;
					}
					if (seq !== loadSeqRef.current) return;
					// First load: an honest error state with retry. Refresh failure:
					// keep the current data, only record the diagnostic.
					if (dataRef.current === null) {
						console.error(PKG + ': bootstrap unavailable', lastError);
						setLoadError(lastError?.message ?? String(lastError ?? 'unknown'));
						setPhase('error');
					} else {
						console.error(PKG + ': bootstrap refresh failed, keeping current data', lastError);
					}
				}
				load();
				// Event-driven refresh only; the Host sends one frame per command and
				// no heartbeat/timer. A project is required — no magic fallback id here.
				// EventSource 只在**临时**失败时自动重连；一旦被判死（readyState
				// CLOSED，例如服务端返回 4xx/5xx），它不会再试，界面会永远停在
				// 「正在自动重连…」的假承诺上。这里自己接管重建，并在恢复后清掉提示。
				let source = null;
				let retryTimer = null;
				let retryDelay = 2000;
				const openStream = () => {
					if (!alive || typeof EventSource !== 'function' || !projectId) return;
					source = new EventSource('/ai-team/api/projects/' + encodeURIComponent(projectId) + '/events');
					source.addEventListener('change', (raw) => {
						if (!alive) return;
						retryDelay = 2000;
						if (streamDownRef.current) {
							streamDownRef.current = false;
							// 恢复后清掉断流提示；否则「正在自动重连」会一直挂着。
							say('');
							pushToast(t('streamUp'));
						}
						try {
							const frame = JSON.parse(raw.data);
							pushToast(notificationText(frame?.event));
						} catch (error) {
							console.error(PKG + ': malformed SSE frame', error);
						}
						// R-05：人员池驻留时，任何团队变化都触发重拉（无定时器，
						// 事件驱动刷新——与宿主 SSE 合帧节奏一致）。
						if (scopeRef.current === 'people') loadPeople();
						load();
					});
					source.addEventListener('error', () => {
						if (!alive) return;
						console.error(PKG + ': event stream unavailable');
						if (!streamDownRef.current) {
							streamDownRef.current = true;
							say(t('streamDown'));
						}
						// CONNECTING 时浏览器自己会重试，保持原样；CLOSED 表示已放弃，
						// 必须由我们按退避重建，否则永远不会恢复。
						if (source !== null && source.readyState === 2) {
							try { source.close(); } catch { /* already closed */ }
							source = null;
							if (retryTimer === null) {
								const delay = retryDelay;
								retryDelay = Math.min(retryDelay * 2, 30000);
								retryTimer = setTimeout(() => { retryTimer = null; openStream(); }, delay);
							}
						}
					});
				};
				openStream();
				return () => {
					alive = false;
					if (controller) controller.abort();
					if (retryTimer !== null) clearTimeout(retryTimer);
					if (source) source.close();
				};
			}, [projectId]);

			React.useEffect(() => {
				let alive = true;
				fetch('/ai-team/api/models', { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const body = await response.json().catch(() => null);
						if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
						return body;
					})
					.then((body) => {
						if (!alive) return;
						setModelCatalog({
							defaultModel: body?.defaultModel ?? null,
							providers: Array.isArray(body?.providers) ? body.providers : [],
						});
						if (body?.ok === false) setModelCatalogError(body?.error?.message ?? t('memberModelsError'));
					})
					.catch((error) => {
						if (alive) setModelCatalogError(error?.message ?? t('memberModelsError'));
					});
				return () => { alive = false; };
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

			// Reset the right-panel editing state only when the selected Task
			// changes — a background refresh (SSE) must never wipe a draft the
			// user is typing or QA boxes they already ticked.
			React.useEffect(() => {
				const current = dataRef.current;
				const thread = threadFor(current, selected);
				// 宿主投影里没有 baseSeq：读 headSeq。否则 ConflictBanner 永不出现。
				setReplyBase(thread?.headSeq ?? null);
				setAcceptChecked(false);
				const nextTask = current?.tasks?.find((task) => task.id === selected) ?? current?.tasks?.[0];
				setQaChecks((nextTask?.qaChecklist ?? []).map((item) => ({ item, passed: false })));
				setConverting(false);
				setCTitle('');
				setCDod('');
				setRightNote('');
				// 换任务时清掉上一个任务的事件历史，避免张冠李戴（R-18）。放在既有
				// effect 里而不是新增一个：hook 顺序变化会让 headless 渲染夹具错位。
				setTaskEventsData(null);
			}, [selected]);

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
					// Host overlays handle Escape first (defaultPrevented); don't swallow.
					if (event.defaultPrevented) return;
					// 插件自身的模态（确认/表单）是更上层：让位，先关模态。
					if (MODAL_STACK.length > 0) return;
					event.preventDefault();
					event.stopPropagation();
					if (converting) { setConverting(false); return; }
					closeThread();
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [threadOpen, converting]);

			// R-08 快捷键体系（渐进增强）：`g` 前缀导航（i 收件箱 / b 看板 /
			// p 人员 / c 对话）、`/` 聚焦 composer、`?` 帮助浮层。规则：
			// ① 焦点在输入控件时旁路；② 模态栈非空时让位；③ 序列窗口 600ms。
			React.useEffect(() => {
				const onKey = (event) => {
					if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
					const tag = document.activeElement?.tagName;
					if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
					if (MODAL_STACK.length > 0) return;
					if (event.key === '/') {
						event.preventDefault();
						event.stopPropagation();
						if (composerInputRef.current && typeof composerInputRef.current.focus === 'function') composerInputRef.current.focus();
						return;
					}
					if (event.key === '?') {
						event.preventDefault();
						event.stopPropagation();
						setShortcutsOpen(true);
						return;
					}
					// g 前缀：先按 g 记录时间戳并返回；下一个键才做分发。
					// 旧实现把这两个动作写在同一个 `key !== 'g'` 判断之后，
					// 导致 i/b/p/c 永远走不到（g 前缀导航整体失效）。
					const key = event.key.toLowerCase();
					if (key === 'g') {
						gPrefixRef.current = Date.now();
						return;
					}
					if (Date.now() - gPrefixRef.current > 600) return;
					gPrefixRef.current = 0;
					if (key === 'i') { event.preventDefault(); switchInbox(); }
					else if (key === 'b') { event.preventDefault(); switchBoard(); }
					else if (key === 'p') { event.preventDefault(); openPeople(); }
					else if (key === 'c') { event.preventDefault(); goConversation(); }
				};
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, []);

			if (phase === 'error' && !data) {
				return h('div', { className: 'at-root', role: 'alert' },
					h('div', { className: 'at-empty' },
						h('span', { className: 'at-emptyicon', 'aria-hidden': 'true' }, h(Ico, { name: 'alert', size: 28 })),
						h('div', { className: 'at-emptytitle' }, t('loadFailedTitle')),
						h('div', { className: 'at-emptybody' }, loadError || t('loadFailedBody')),
						h('button', { className: 'at-btn', type: 'button', onClick: () => { setPhase('loading'); location.reload(); } }, t('retry'))));
			}
			if (phase === 'loading' || !data) return h(Skeleton, { t });

			const projectRecord = data.projects.find((item) => item.id === projectId) ?? data.projects[0] ?? null;
			const project = projectRecord === null ? null : {
				...projectRecord,
				workspacePath: projectRecord.workspacePath || (data.project?.id === projectRecord.id ? data.project.workspacePath ?? '' : ''),
			};
			const humanId = (data.members ?? []).find((member) => member.kind === 'human')?.id ?? null;
			const tasks = data.tasks;
			const boardTaskCount = tasks.filter((task) => ['pending', 'in_progress', 'pending_acceptance', 'done'].includes(task.status)).length;
			const selectedTask = tasks.find((task) => task.id === selected) ?? tasks[0] ?? null;
			const thread = threadFor(data, selectedTask?.id);
			const quadrants = deriveQuadrants(data);
			// P1b：批量取消全部待处理（逐卡 task.cancel，Human-only；汇总结果）。
			async function cancelAllPending(pendingTasks) {
				if (!Array.isArray(pendingTasks) || pendingTasks.length === 0) return;
				setCancelAllBusy(true);
				let done = 0; let failed = 0;
				try {
					for (const task of pendingTasks) {
						try {
							await runCommand('task.cancel', { taskId: task.id, expectedRevision: task.revision, reason: t('cancelAllHint') });
							done += 1;
						} catch { failed += 1; }
					}
					sayRight(tf(t, 'cancelAllDone', { done, failed }));
					await reloadData();
				} finally {
					setCancelAllBusy(false);
				}
			}
			async function archiveCurrentProject() {
				if (!project) return;
				const answer = await askConfirm(t('archiveConfirmTitle'), tf(t, 'archiveConfirmBody', { name: project.name }));
				if (answer !== true) return;
				try {
					await runCommand('project.archive', { archived: true });
					say(t('archiveDone'));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			// P17：人员池同人绑定（把另一个名字并到某人）——host 路由
			// POST /ai-team/api/people-aliases，绑定后聚合按 personId 合并。
			function bindAlias(personName) {
				const other = aliasName.trim();
				const target = (personName ?? aliasTarget).trim();
				if (!other || !target || other === target) { say(t('aliasRequired')); return; }
				fetch('/ai-team/api/people-aliases', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ name: other, personId: target }),
				}).then(async (response) => {
					const payload = await response.json().catch(() => null);
					if (!response.ok) throw new Error(payload?.error?.message ?? ('HTTP ' + response.status));
					say(tf(t, 'aliasSaved', { name: other, person: target }));
					setAliasName('');
					loadPeople();
				}).catch((error) => sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) })));
			}
			// P2：人员池配置模型——选中的成员在其所在的全部项目逐个 member.config.update（批量；单人也走这里）。
			// 成员资料里的单独设置保留，不受影响（以后再单独改即可）。
			function configPersonModel(names) {
				if (!Array.isArray(names) || names.length === 0) return;
				setPeopleModel(names);
			}
			async function applyPeopleModel(names, patch) {
				const chosen = new Set(names);
				let done = 0; let failed = 0;
				for (const person of peopleData ?? []) {
					if (!chosen.has(person.name)) continue;
					for (const row of person.projects ?? []) {
						for (const memberId of Array.isArray(row.memberIds) ? row.memberIds : []) {
							try {
								await runCommand('member.config.update', { memberId, patch, reason: 'people pool model' }, row.projectId);
								done += 1;
							} catch {
								failed += 1;
							}
						}
					}
				}
				setPeopleModel(null);
				sayRight(tf(t, 'peopleModelDone', { people: chosen.size, model: patch.model, done, failed }));
				await reloadData();
				loadPeople();
			}
			// P6：项目运行态（启动/停止）+ 交接文档落盘。
			const runStopped = (project?.runState ?? 'running') === 'stopped';
			async function toggleRunState() {
				try {
					await runCommand('project.runState', { runState: runStopped ? 'running' : 'stopped' });
					say(runStopped ? t('runStarted') : t('runStopped'));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function makeHandoff() {
				if (!project) return;
				try {
					const result = await runCommand('project.handoff', {});
					sayRight(tf(t, 'handoffDone', { path: result.filePath ?? '' }));
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			const inboxItems = (data.inbox ?? []).filter((item) => !isInformationalInboxItem(item));
			// R-13 老化分档（纯前端派生）：决策项 >24h 加深、>72h 升错误色。
			const inboxAge = (item) => {
				const created = item.createdAt ?? 0;
				if (!Number.isFinite(created) || created <= 0) return '';
				const age = Date.now() - created;
				return age > 72 * 60 * 60 * 1000 ? 'at-inboxstale2' : age > 24 * 60 * 60 * 1000 ? 'at-inboxstale' : '';
			};
			const inboxUnread = inboxItems.filter((item) => item.state === 'unread').length;
			const q1Extra = inboxItems.filter((item) => item.requiresDecision === true && item.state === 'unread').length;
			const threadHead = thread?.headSeq ?? thread?.entries?.length ?? 0;
			const followingOf = (card) => (Object.prototype.hasOwnProperty.call(follows, card.id) ? follows[card.id] : Boolean(card.following));

			function say(text) { setNote(text); }
			function sayRight(text) {
				setRightNote(text);
				// 右侧提示只在 Thread 面板打开时可见：交接文档路径、归档失败、批量取消
				// 汇总这类消息在面板关闭时等于丢失。同一句话再走 toast，保证用户看得到。
				try { pushToast(String(text ?? '')); } catch { /* toast is best effort */ }
			}
			function pushToast(text) {
				if (!text) return;
				const id = Date.now() + ':' + Math.random().toString(36).slice(2, 6);
				setToasts((prev) => [...prev.slice(-3), { id, text }]);
				setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 7000);
			}
			function notificationText(event) {
				if (!event) return '';
				switch (event.type) {
					case 'task/created': return t('notifyTaskCreated');
					case 'task/claimed': return t('notifyTaskClaimed');
					case 'task/submitted': return t('notifyTaskSubmitted');
					case 'task/accepted': return t('notifyTaskAccepted');
					case 'task/changes-requested': return t('notifyTaskChanges');
					case 'thread/posted': return t('notifyThread');
					case 'inbox/item-created': return t('notifyInbox');
					case 'wake/delivered': return t('notifyWake');
					case 'stream/posted': return t('notifyStream');
					default: return '';
				}
			}
			async function toggleFollow(card) {
				if (!card) return;
				const next = !followingOf(card);
				const text = next ? tf(t, 'followedTask', { n: taskNo(card) }) : tf(t, 'unfollowedTask', { n: taskNo(card) });
				try {
					await runCommand('task.follow', { taskId: card.id, following: next });
					setFollows((prev) => ({ ...prev, [card.id]: next }));
					if (threadOpen && selectedTask && selectedTask.id === card.id) sayRight(text); else say(text);
					await reloadData();
				} catch (error) {
					if (threadOpen && selectedTask && selectedTask.id === card.id) sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
					else say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			function openTask(card, event) {
				if (!card) return;
				if (event && event.currentTarget) triggerRef.current = event.currentTarget;
				setSelected(card.id);
				setThreadOpen(true);
				setRightNote('');
			}
			function openTaskById(taskId, event) {
				if (typeof taskId !== 'string' || taskId === '') { say(t('quadrantMissing')); return; }
				const card = (Array.isArray(tasks) ? tasks : []).find((item) => item.id === taskId);
				if (!card) { say(t('quadrantMissing')); return; }
				triggerRef.current = event?.currentTarget ?? null;
				setSelected(card.id);
				setThreadOpen(true);
				setRightNote('');
			}
			function openQuadrantItem(item, event) {
				if (!item) return;
				if (item.taskId) {
					openTaskById(item.taskId, event);
					return;
				}
				if (item.kind === 'inbox') {
					closeMobile();
					setScope('inbox');
					setThreadOpen(false);
					setNote(t('inboxTitle'));
					return;
				}
				say(t('quadrantMissing'));
			}
			function viewQuadrant(key) {
				setBoardFilter(key);
				setTab('board');
				setNote('');
				if (key === 'q4') setDoneOpen(true);
			}
			function goConversation() {
				closeMobile();
				setMemberViewId(null);
				setScope('project');
				setTab('main');
				setThreadOpen(false);
				setNote('');
			}
			function closeMobile() {
				const node = mobileRef.current;
				if (node) node.open = false;
			}
			function switchInbox() {
				closeMobile();
				setMemberViewId(null);
				setScope('inbox');
				setThreadOpen(false);
				setNote('');
				loadPending();
				loadRisks();
			}
			function openPeople() {
				closeMobile();
				setMemberViewId(null);
				setScope('people');
				setThreadOpen(false);
				setNote('');
				loadPeople();
			}
			// R-05：可复用的拉取（页头刷新按钮与 toast 触发共用），序号守卫防乱序。
			function loadPeople() {
				const seq = ++peopleSeqRef.current;
				setPeopleLoading(true);
				setPeopleError('');
				fetch('/ai-team/api/people', { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (!response.ok) throw new Error(payload?.error?.message ?? ('HTTP ' + response.status));
						if (seq !== peopleSeqRef.current) return;
						setPeopleData(Array.isArray(payload?.people) ? payload.people : []);
					})
					.catch((error) => {
						if (seq === peopleSeqRef.current) setPeopleError(error?.message ?? String(error));
					})
					.finally(() => {
						if (seq === peopleSeqRef.current) setPeopleLoading(false);
					});
			}
			function switchBoard() {
				closeMobile();
				setScope('project');
				setTab('board');
				setBoardFilter('all');
				setNote('');
			}
			async function switchProject(next) {
				closeMobile();
				if (next.id === projectId && scope === 'project') return true;
				try {
					await runCommand('project.activate', { projectId: next.id });
					setScope('project');
					setTab('main');
					setMemberViewId(null);
					setBoardFilter('all');
					setThreadOpen(false);
					setReply('');
					await reloadData(next.id);
					setProjectId(next.id);
					say(next.archived ? t('archivedNote') : t('projectSwitched'));
					return true;
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
					return false;
				}
			}
			function openNewProject() {
				setNName('');
				setNGoal('');
				// 默认工作目录由宿主给出（与初装默认项目同源）：留空会让新项目没有
				// 工作目录，成员只能在插件数据目录里跑，workspace attach 也会被拒。
				setNWorkspace(data?.defaultWorkspace ?? '');
				setNError('');
				setNTeam('');
				setTeamComposeOpen(false);
				void loadTeams();
				setNewOpen(true);
			}
			async function togglePmo() {
				if (!project) return;
				try {
					await runCommand('project.pmo.update', { pmoAuto: project.pmoAuto === false }, project.id);
					say(project.pmoAuto === false ? t('pmoEnabled') : t('pmoDisabled'));
					await reloadData();
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function pickWorkspacePath() {
				const service = ctx?.get?.('uiWorkspace') ?? ctx?.uiWorkspace;
				if (service === undefined || service === null || typeof service.pickDirectory !== 'function') {
					return { error: 'unavailable', path: null };
				}
				try {
					return { path: await service.pickDirectory(), error: null };
				} catch {
					return { error: 'failed', path: null };
				}
			}
			async function pickNewWorkspace() {
				const picked = await pickWorkspacePath();
				if (picked.path) setNWorkspace(picked.path);
				else if (picked.error === 'unavailable') setNError(t('workspacePickUnavailable'));
				else if (picked.error === 'failed') setNError(t('workspacePickFailed'));
			}
			function openWorkspaceEditor() {
				setWorkspaceDraft(project?.workspacePath ?? '');
				setWorkspaceError('');
				setWorkspaceOpen(true);
			}
			async function pickProjectWorkspace() {
				const picked = await pickWorkspacePath();
				if (picked.path) setWorkspaceDraft(picked.path);
				else if (picked.error === 'unavailable') setWorkspaceError(t('workspacePickUnavailable'));
				else if (picked.error === 'failed') setWorkspaceError(t('workspacePickFailed'));
			}
			async function saveWorkspace() {
				if (!project || workspaceBusy || !workspaceDraft.trim()) return;
				setWorkspaceBusy(true);
				setWorkspaceError('');
				try {
					await runCommand('project.workspace.update', { workspacePath: workspaceDraft.trim() }, project.id);
					setWorkspaceOpen(false);
					say(t('workspaceSaved'));
					await reloadData();
				} catch (error) {
					setWorkspaceError(error?.message ?? String(error));
				} finally {
					setWorkspaceBusy(false);
				}
			}
			/** 每次打开新建项目现取团队列表：刚组的队、刚改的 team.yml 立刻可选。select 留空表示沿用设置里的默认团队。 */
			async function loadTeams(select) {
				setTeamLoadError('');
				try {
					const response = await fetch('/ai-team/api/teams', { headers: { accept: 'application/json' } });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + response.status));
					setTeamList(Array.isArray(body && body.teams) ? body.teams : []);
					setNTeam(select || (body && body.defaultTeam) || 'default');
				} catch (error) {
					setTeamList([]);
					setTeamLoadError(tf(t, 'teamLoadFailed', { error: (error && error.message) || String(error) }));
				}
			}
			async function removeTeam(team) {
				if (!(await askConfirm(t('teamDelete'), tf(t, 'teamDeleteConfirm', { name: team.name })))) return;
				try {
					const response = await fetch('/ai-team/api/teams/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: team.id }) });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + response.status));
					await loadTeams();
				} catch (error) {
					setNError((error && error.message) || String(error));
				}
			}
			async function createProject() {
				if (!nName.trim() || !nWorkspace.trim() || nBusy) return;
				setNBusy(true);
				setNError('');
				try {
					const result = await runCommand('project.create', { name: nName.trim(), goal: nGoal.trim(), workspacePath: nWorkspace.trim(), ...(nTeam ? { team: nTeam } : {}) });
					const next = result.project;
					setNewOpen(false);
					setScope('project');
					setTab('main');
					await reloadData(next.id);
					setProjectId(next.id);
					say(tf(t, 'projectCreated', { name: next.name }));
				} catch (error) {
					setNError(error?.message ?? String(error));
				} finally {
					setNBusy(false);
				}
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
			async function reloadData(forProject = projectId) {
				const seq = ++loadSeqRef.current;
				const query = forProject ? '?project=' + encodeURIComponent(forProject) : '';
				const response = await fetch('/ai-team/api/bootstrap' + query, { headers: { accept: 'application/json' } });
				if (!response.ok) throw new Error('HTTP ' + response.status);
				const next = normalizePayload(await response.json());
				// A stale response (superseded by a newer load) must not land.
				if (next && seq === loadSeqRef.current) applyData(next);
			}
			async function runCommand(type, payload, targetProject = projectId) {
				if (!targetProject) throw new Error(t('noProject'));
				const response = await fetch('/ai-team/api/projects/' + encodeURIComponent(targetProject) + '/commands', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ type, payload }),
				});
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					const error = new Error(body?.error?.message ?? ('HTTP ' + response.status));
					error.code = body?.error?.code;
					error.details = body?.error?.details;
					throw error;
				}
				return body;
			}
			function openAddAgent() {
				const defaults = modelCatalog?.defaultModel ?? data?.runtime?.defaultModel ?? {};
				setMName('');
				setMRole('');
				setMPrompt('');
				setMProvider(defaults.provider ?? '');
				setMModel(defaults.model ?? '');
				setMEffort(defaults.reasoningEffort ?? '');
				setMOwner((data?.agents ?? []).length === 0);
				setMAvatar({ ...AVATAR_PICK_DEFAULT });
				setMCopy(null);
				setMError('');
				setMTab('market');
				setTalentInit(null);
				setTalentQuery('');
				setTalentCategory('');
				setAddOpen(true);
				setCatalogNote('');
				loadTalents();
				loadCatalogInfo();
			}
			/** 每次打开弹窗现取：用户刚改了 talent.yml 也能立刻看到。 */
			async function loadTalents() {
				setTalentError('');
				try {
					const response = await fetch('/ai-team/api/talents', { headers: { accept: 'application/json' } });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
					setTalents(Array.isArray(body?.talents) ? body.talents : []);
				} catch (error) {
					setTalents([]);
					setTalentError(error?.message ?? String(error));
				}
			}
			/** 第 3 步：在线人才库的本机状态（版本、同步时间）。 */
			async function loadCatalogInfo() {
				try {
					const response = await fetch('/ai-team/api/catalog', { headers: { accept: 'application/json' } });
					const body = await response.json().catch(() => null);
					if (response.ok) setCatalogInfo(body?.official ?? null);
				} catch {}
			}
			/** 同步官方在线人才库：成功后重读人才列表；失败保留现有的并提示原因。 */
			async function syncCatalog() {
				setCatalogBusy(true);
				setCatalogNote('');
				try {
					const response = await fetch('/ai-team/api/catalog/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
					const body = await response.json().catch(() => null);
					if (body && 'official' in body) setCatalogInfo(body.official ?? null);
					if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
					setCatalogNote(body.updated ? tf(t, 'catalogUpdated', { version: body.version, files: body.files }) : tf(t, 'catalogLatest', { version: body.version }));
					await loadTalents();
				} catch (error) {
					setCatalogNote(tf(t, 'catalogFailed', { error: error?.message ?? String(error) }));
				} finally {
					setCatalogBusy(false);
				}
			}
			async function clearCatalog() {
				if (!(await askConfirm(t('catalogClear'), t('catalogClearConfirm')))) return;
				setCatalogBusy(true);
				try {
					await fetch('/ai-team/api/catalog/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
					setCatalogInfo(null);
					setCatalogNote('');
					await loadTalents();
				} catch (error) {
					setCatalogNote(tf(t, 'catalogFailed', { error: error?.message ?? String(error) }));
				} finally {
					setCatalogBusy(false);
				}
			}
			/** 2c：内置人才 fork 成可编辑副本（同 id 遮盖内置，已招成员下次激活读副本）。 */
			async function forkTalent(talent) {
				try {
					const response = await fetch('/ai-team/api/talents/' + encodeURIComponent(talent.id) + '/fork', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
					await loadTalents();
				} catch (error) {
					setTalentError(error?.message ?? String(error));
				}
			}
			/** 删掉可编辑副本，恢复内置版（副本里改过的技能一并丢弃）。 */
			async function restoreTalent(talent) {
				if (!(await askConfirm(t('talentRestore'), tf(t, 'talentRestoreConfirm', { name: talent.name })))) return;
				try {
					const response = await fetch('/ai-team/api/talents/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: talent.id }) });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
					await loadTalents();
				} catch (error) {
					setTalentError(error?.message ?? String(error));
				}
			}
			/** 2c：技能「进化」——服务端必要时先 fork 人才，再私信成员按 SkillOpt 两步优化这份技能。 */
			async function evolveSkill(agent, name) {
				setPEvolve('');
				try {
					const response = await fetch('/ai-team/api/projects/' + encodeURIComponent(projectId) + '/members/' + encodeURIComponent(agent.id) + '/skills/evolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
					setPEvolve(tf(t, body.forked ? 'skillEvolveForked' : 'skillEvolveSent', { name: agent.name, skill: body.skill, talent: body.talent || '' }));
				} catch (error) {
					setPEvolve(tf(t, 'skillEvolveFailed', { error: error?.message ?? String(error) }));
				}
			}
			/** 招聘：按人才预填表单，切到自定义页让 Human 改名、换模型后再确认。 */
			function hireTalent(talent) {
				const draft = hireTalentDraft(talent, (data?.agents ?? []).map((agent) => agent.name));
				const defaults = modelCatalog?.defaultModel ?? data?.runtime?.defaultModel ?? {};
				setMName(draft.name);
				setMRole(draft.role);
				setMProvider(draft.provider || defaults.provider || '');
				setMModel(draft.model || defaults.model || '');
				setMEffort(draft.reasoningEffort || defaults.reasoningEffort || '');
				setMAvatar(draft.avatar ? { ...draft.avatar } : { ...AVATAR_PICK_DEFAULT });
				setMCopy(draft);
				setMError('');
				setMTab('custom');
			}
			/** #65：从成员资料「复制成员」——新增表单按原成员预填，人格/配方/上限/技能随创建一并写入。 */
			function openCopyAgent(source) {
				const draft = copyMemberDraft(source, (data?.agents ?? []).map((agent) => agent.name));
				setMName(draft.name);
				setMRole(draft.role);
				setMPrompt('');
				setMProvider(draft.provider);
				setMModel(draft.model);
				setMEffort(draft.reasoningEffort);
				setMOwner(false);
				setMAvatar({ ...memberAvatarOf(source, talents) });
				setMCopy(draft);
				setMError('');
				setAddOpen(true);
			}
			/** 存为人才：取服务端草稿（职责按身份判定、标出找不到正文的技能），在「新建人才」页预填。 */
			async function openSaveAsTalent(source) {
				try {
					const response = await fetch('/ai-team/api/projects/' + encodeURIComponent(projectId) + '/members/' + encodeURIComponent(source.id) + '/talent-draft', { headers: { accept: 'application/json' } });
					const body = await response.json().catch(() => null);
					if (!response.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + response.status));
					setTalentInit(body);
				} catch (error) {
					setTalentInit({ error: tf(t, 'tcDraftFailed', { error: (error && error.message) || String(error) }) });
				}
				setMCopy(null);
				setMTab('create');
				setAddOpen(true);
				loadTalents();
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
						...(mCopy?.personality ? { personality: mCopy.personality } : {}),
						...(mCopy?.talent?.id ? { talent: mCopy.talent.id, talentVersion: mCopy.talent.version } : {}),
						...(mCopy?.duty ? { duty: mCopy.duty } : {}),
						...(mAvatar ? { avatar: mAvatar } : {}),
					});
					const memberId = added.member.id;
					const patch = {
						...(mProvider.trim() ? { provider: mProvider.trim() } : {}),
						...(mModel.trim() ? { model: mModel.trim() } : {}),
						...(mEffort.trim() ? { reasoningEffort: mEffort.trim() } : {}),
						...(mCopy && mCopy.preset !== 'standard' ? { preset: mCopy.preset } : {}),
						...(mCopy?.maxTokens ? { maxTokens: mCopy.maxTokens } : {}),
					};
					if (Object.keys(patch).length > 0) {
						await runCommand('member.config.update', {
							memberId,
							patch,
							reason: mCopy?.talent ? 'workbench hire talent' : mCopy ? 'workbench copy member' : 'workbench add member',
						});
					}
					for (const skill of mCopy?.skills ?? []) {
						await runCommand('member.skill', { memberId, name: skill });
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
			function openMemberView(agent) {
				closeMobile();
				setMemberViewId(agent.id);
				setScope('project');
				setTab('main');
				setThreadOpen(false);
				setNote('');
			}
			function closeMemberView() {
				setMemberViewId(null);
			}
			async function openAgentChat(agent) {
				closeMobile();
				const service = ctx?.get?.('uiWorkspace') ?? ctx?.uiWorkspace;
				if (service?.openSession === undefined) {
					say(t('agentChatUnavailable'));
					openProfile(agent);
					return;
				}
				if (agent.sessionId) {
					try {
						service.openSession(agent.sessionId);
					} catch (error) {
						say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
						openProfile(agent);
					}
					return;
				}
				try {
					say(t('agentChatOpening'));
					const activated = await runCommand('member.activate', {
						memberId: agent.id,
						prompt: '你正在与 Human 直接对话。先简要说明你是谁、当前负责什么；不要创建 Task，除非 Human 明确要求。',
					});
					await reloadData();
					if (activated?.sessionId) service.openSession(activated.sessionId);
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
					openProfile(agent);
				}
			}
			function openTaskAgentChat(task) {
				const memberId = task?.assigneeId ?? task?.ownerId;
				const agent = data.agents.find((candidate) => candidate.id === memberId) ?? null;
				if (agent === null) {
					say(t('agentChatUnavailable'));
					return;
				}
				void openAgentChat(agent);
			}
			function openProfile(agent) {
				setProfileAgent(agent);
				setPEvolve('');
				setPTab('basic');
				setPName(agent.name ?? '');
				setPRole(agent.role ?? '');
				setPAvatar({ ...memberAvatarOf(agent, talents) });
				setPPersonality(agent.personality ?? '');
				setPPreset(agent.preset ?? agent.config?.preset ?? 'standard');
				setPProvider(agent.config?.provider ?? '');
				setPModel(agent.config?.model ?? '');
				setPMaxTokens(agent.config?.maxTokens ?? '');
				setPEffort(agent.config?.reasoningEffort ?? '');
				setPNote('');
				setPSkill('');
				setPMessage('');
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
						...(pAvatar ? { avatar: pAvatar } : {}),
						reason: 'workbench profile',
					});
					const config = profileAgent.config ?? {};
					const patch = {};
					if (pPreset !== (config.preset ?? profileAgent.preset ?? 'standard')) patch.preset = pPreset;
					if (pProvider.trim() !== (config.provider ?? '')) patch.provider = pProvider.trim();
					if (pModel.trim() !== (config.model ?? '')) patch.model = pModel.trim();
					// 空串 = 跟随模型默认，显式写 null 才能真正清掉账本里的旧档位。
					const nextEffort = pEffort.trim();
					if (nextEffort !== (config.reasoningEffort ?? '')) patch.reasoningEffort = nextEffort === '' ? null : nextEffort;
					const maxTokens = Number(pMaxTokens);
					if (Number.isSafeInteger(maxTokens) && maxTokens > 0 && maxTokens !== config.maxTokens) patch.maxTokens = maxTokens;
					if (Object.keys(patch).length > 0) {
						await runCommand('member.config.update', {
							memberId: profileAgent.id,
							patch,
							reason: 'workbench config',
						});
					}
					setProfileAgent(null);
					say(t('profileSaved'));
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				} finally {
					setPBusy(false);
				}
			}
			async function sendMemberMessage() {
				if (!profileAgent || !pMessage.trim()) return;
				try {
					await runCommand('member.message', { memberId: profileAgent.id, body: pMessage.trim() });
					setPMessage('');
					say(t('messageSent'));
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				}
			}
			async function addNote() {
				if (!profileAgent || !pNote.trim()) return;
				try {
					const result = await runCommand('member.note', { memberId: profileAgent.id, text: pNote.trim() });
					setPNote('');
					setProfileAgent(result.member);
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				}
			}
			async function addSkill() {
				if (!profileAgent || !pSkill.trim()) return;
				try {
					const result = await runCommand('member.skill', { memberId: profileAgent.id, name: pSkill.trim() });
					setPSkill('');
					setProfileAgent(result.member);
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				}
			}
			async function retryProfile() {
				if (!profileAgent || pBusy) return;
				setPBusy(true);
				setPError('');
				try {
					await runCommand('member.retry', { memberId: profileAgent.id });
					const result = await runCommand('member.activate', {
						memberId: profileAgent.id,
						prompt: '你已被重试。先读 tasks/inbox，继续未完成的工作；不要修改无关文件。',
					});
					setProfileAgent(result.member);
					say(t('retried'));
					await reloadData();
				} catch (error) {
					setPError(error?.message ?? String(error));
				} finally {
					setPBusy(false);
				}
			}
			// 会话重建（reseat）：旧会话 cwd 是创建时钉死的（历史账本目录兜底
			// 或先建项目后设目录的成员），resume 不覆盖；force 重建让新会话落
			// 在当前项目工作目录。
			async function reseatProfile() {
				if (!profileAgent || pBusy) return;
				if (!(await askConfirm(t('reseatSession'), t('reseatConfirm')))) return;
				setPBusy(true);
				setPError('');
				try {
					const result = await runCommand('member.activate', {
						memberId: profileAgent.id,
						force: true,
						prompt: '你的会话已在当前项目工作目录重建。先读 tasks/inbox 与项目简报，再继续未完成的工作；不要修改无关文件。',
					});
					setProfileAgent(result.member);
					say(t('reseatDone'));
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
					const result = await runCommand('member.distill', {
						memberId: profileAgent.id,
						mode: 'model',
						reason: 'workbench re-distill',
					});
					setPPersonality(result.member.personality);
					setProfileAgent(result.member);
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
				if (!(await askConfirm(t('leaveTeam'), t('leaveConfirm')))) return;
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
			async function openInboxTask(item) {
				if (item.projectId && item.projectId !== projectId) {
					const switched = await switchProject({ id: item.projectId, name: item.projectName });
					// 切换失败（含 project.activate 被拒）时中止：不把 selected 指向
					// 本项目里不存在的任务卡（否则 effect 会误开第一张卡）。
					if (!switched) return;
				}
				setScope('project');
				setSelected(item.ref?.taskId ?? '');
				setThreadOpen(true);
				setRightNote('');
			}
			async function answerDecision(item, answers, note) {
				try {
					await runCommand('decision.answer', { itemId: item.id, answers, ...(note ? { note } : {}) }, item.projectId ?? projectId);
					say(t('decisionSubmitted'));
					await reloadData();
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			// R-06 决策回流：切到决策所在项目 → 主对话 → 高亮决策之后的首条非 Human
			// 消息（团队接下来的动作）。不做滚动（全局规格 #6），只用左缘强调条。
			async function followUpDecision(item) {
				if (item.projectId && item.projectId !== projectId) {
					const switched = await switchProject({ id: item.projectId, name: item.projectName });
					if (!switched) return;
				}
				setScope('project');
				setTab('main');
				setMemberViewId(null);
				setThreadOpen(false);
				const anchorAt = item.ackedAt ?? item.updatedAt ?? item.createdAt ?? 0;
				const hit = (data.stream ?? []).find((entry) => (entry.at ?? 0) >= anchorAt && entry.author?.kind !== 'human');
				setStreamHighlight(hit?.id ?? null);
			}
			async function reopenDecision(item) {
				try {
					await runCommand('decision.request', {
						title: (item.ref?.title || t('inboxDecisionTitle')) + ' · ' + t('decisionReopenSuffix'),
						questions: item.ref?.questions ?? [],
						taskId: item.ref?.taskId ?? null,
						source: item.ref?.source ?? 'reopen',
					}, item.projectId ?? projectId);
					say(t('decisionReopened'));
					await reloadData();
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function ackInbox(item) {
				try {
					await runCommand('inbox.ack', { itemId: item.id, disposition: 'read' }, item.projectId ?? projectId);
					say(t('inboxAcked'));
					await reloadData();
				} catch (error) {
					say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			/** #65：选中/粘贴/拖入的文件立即上传进 DSH 附件存储；发送时只带已上传好的块。 */
			function attachFiles(files) {
				for (const file of files) {
					const id = 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
					const kind = attachmentKind(file);
					const preview = kind === 'image' && typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
					const name = file.name || (kind === 'image' ? 'image' : 'file');
					setPendingFiles((list) => [...list, { id, kind, name, size: file.size, preview, status: 'uploading', block: null, error: '' }]);
					const query = new URLSearchParams({ kind, name, ...(kind === 'image' ? { type: file.type } : {}) });
					fetch('/ai-team/api/attachments?' + query.toString(), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file })
						.then(async (response) => {
							const body = await response.json().catch(() => null);
							if (!response.ok || !body?.block) throw new Error(body?.error?.message ?? ('HTTP ' + response.status));
							setPendingFiles((list) => list.map((item) => item.id === id ? { ...item, status: 'ready', block: body.block } : item));
						})
						.catch((error) => {
							const message = error?.message ?? String(error);
							setPendingFiles((list) => list.map((item) => item.id === id ? { ...item, status: 'error', error: message } : item));
							say(tf(t, 'attachFailed', { name, message }));
						});
				}
			}
			function removeAttachment(id) {
				setPendingFiles((list) => {
					const gone = list.find((item) => item.id === id);
					if (gone?.preview && typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(gone.preview);
					return list.filter((item) => item.id !== id);
				});
			}
			async function send() {
				const text = draft.trim();
				const withFiles = mode !== 'task' && pendingFiles.some((item) => item.status === 'ready');
				if (!text && !withFiles) return;
				if (mode !== 'task' && pendingFiles.some((item) => item.status === 'uploading')) { say(t('attachUploading')); return; }
				if (sendingRef.current) return;
				sendingRef.current = true;
				try {
					await sendOnce(text);
				} finally {
					sendingRef.current = false;
				}
			}
			async function sendOnce(text) {
				// 目录门槛只拦"要动手"的任务：讨论与建卡无需工作目录（11-管理视角
				// §3）；激活/认领由 Host fail-closed，并把用户引导到目录设置。
				if (!project?.workspacePath && mode === 'task') {
					say(t('workspaceRequired'));
					openWorkspaceEditor();
					return;
				}
				try {
					if (mode === 'task') {
						const definition = taskDefinition.trim();
						const checklist = qaChecklistText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
						if (definition === '') { say(t('taskDefinitionRequired')); return; }
						if (qaTask && checklist.length === 0) { say(t('qaNeedsChecklist')); return; }
						await runCommand('task.create', {
							title: text,
							resultDefinition: definition,
							qaRequired: qaTask,
							...(qaTask ? { qaChecklist: checklist } : {}),
						});
						setTaskDefinition('');
						setQaChecklistText('');
					} else {
						const blocks = pendingFiles.filter((item) => item.status === 'ready').map((item) => item.block);
						await runCommand('stream.post', { body: text, ...(blocks.length > 0 ? { attachments: blocks } : {}) });
						for (const item of pendingFiles) if (item.preview && typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(item.preview);
						setPendingFiles([]);
					}
					setDraft('');
					say(mode === 'task' ? t('taskSent') : t('discussSent'));
					await reloadData();
				} catch (error) {
					if (error?.code === 'E_CONFLICT' && error.details?.taskId) {
						setSelected(error.details.taskId);
						setThreadOpen(true);
						say(tf(t, 'duplicateTask', { number: error.details.number ?? '' }));
					} else if (error?.message?.includes('qaChecklist')) {
						say(t('qaNeedsChecklist'));
					} else {
						say(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
					}
				}
			}
			async function sendReply() {
				const text = reply.trim();
				if (!text || !selectedTask) return;
				// 与发送共用同一个在途守卫：连按 Ctrl+Enter 会写出两条相同回复。
				if (sendingRef.current) return;
				sendingRef.current = true;
				try {
					const result = await runCommand('thread.post', {
						taskId: selectedTask.id,
						baseSeq: replyBase ?? threadHead ?? 0,
						body: text,
					});
					setReply('');
					// 发送成功后把基线推进到新 headSeq，避免自己的回复触发冲突横幅。
					setReplyBase(typeof result.entry?.seq === 'number' ? result.entry.seq : null);
					sayRight(tf(t, 'replySent', { seq: result.entry?.seq ?? '' }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'replyFailed', { message: error?.message ?? String(error) }));
				} finally {
					sendingRef.current = false;
				}
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
			async function submitConvert() {
				if (!selectedTask || !cTitle.trim() || !cDod.trim()) return;
				// FR-049 trigger ②: the whole Thread converts, anchored on the
				// ledger event ids of its entries (dedupe + audit by the Host).
				const sources = (thread?.entries ?? []).map((entry) => entry.eventId).filter(Boolean);
				if (sources.length === 0) { sayRight(t('convertNoSource')); return; }
				try {
					const result = await runCommand('task.convert', {
						sourceEventIds: sources,
						title: cTitle.trim(),
						doneCriteria: cDod.trim(),
					});
					setConverting(false);
					setCTitle('');
					setCDod('');
					sayRight(tf(t, 'convertDone', { n: taskNo(result.task) }));
					await reloadData();
				} catch (error) {
					if (error?.details?.taskId) {
						const card = tasks.find((task) => task.id === error.details.taskId);
						if (card) openTaskById(card.id);
					}
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function acceptTask() {
				if (!selectedTask) return;
				try {
					await runCommand('task.accept', {
						taskId: selectedTask.id,
						expectedRevision: selectedTask.revision,
						note: t('acceptNote'),
						confirmed: acceptChecked,
						checks: qaChecks,
					});
					sayRight(tf(t, 'acceptDone', { n: taskNo(selectedTask) }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'acceptFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function requestChanges() {
				if (!selectedTask) return;
				const note = reply.trim();
				if (!note) {
					sayRight(t('changesNeedNote'));
					return;
				}
				try {
					await runCommand('task.request_changes', {
						taskId: selectedTask.id,
						expectedRevision: selectedTask.revision,
						note,
					});
					setReply('');
					sayRight(tf(t, 'changesDone', { n: taskNo(selectedTask) }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'changesFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function reassignSelected() {
				if (!selectedTask) return;
				const options = (data?.agents ?? []).filter((agent) => agent.status !== 'retired');
				if (options.length === 0) {
					sayRight(t('reassignNoTarget'));
					return;
				}
				const answer = await askPrompt(t('reassignPrompt'), {
					options: options.map((agent) => agent.name),
					value: options[0].name,
				});
				if (answer === null) return;
				const target = options.find((agent) => agent.name === answer.trim() || agent.id === answer.trim());
				if (target === undefined) {
					sayRight(t('reassignNoTarget'));
					return;
				}
				try {
					await runCommand('task.reassign', {
						taskId: selectedTask.id,
						expectedRevision: selectedTask.revision,
						ownerId: target.id,
						reason: 'workbench reassign',
					});
					sayRight(tf(t, 'reassignDone', { n: taskNo(selectedTask), name: target.name }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function cancelSelected() {
				if (!selectedTask) return;
				const reason = await askPrompt(t('cancelPrompt'), { optional: true });
				if (reason === null) return;
				try {
					await runCommand('task.cancel', { taskId: selectedTask.id, expectedRevision: selectedTask.revision, reason });
					sayRight(tf(t, 'cancelDone', { n: taskNo(selectedTask) }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function reopenSelected() {
				if (!selectedTask) return;
				const reason = await askPrompt(t('reopenPrompt'), { optional: true });
				if (reason === null) return;
				try {
					await runCommand('task.reopen', { taskId: selectedTask.id, expectedRevision: selectedTask.revision, reason });
					sayRight(tf(t, 'reopenDone', { n: taskNo(selectedTask) }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			async function deleteSelected() {
				if (!selectedTask) return;
				if (!(await askConfirm(t('actDelete'), t('deleteConfirm')))) return;
				try {
					await runCommand('task.delete', { taskId: selectedTask.id, expectedRevision: selectedTask.revision });
					sayRight(tf(t, 'deleteDone', { n: taskNo(selectedTask) }));
					await reloadData();
				} catch (error) {
					sayRight(tf(t, 'sendFailed', { message: error?.message ?? String(error) }));
				}
			}
			function continueFromLatest() {
				const latest = threadHead;
				setReplyBase(latest);
				sayRight(tf(t, 'conflictContinued', { head: latest }));
			}

			const actions = [];
			if (selectedTask) {
				const status = selectedTask.status;
				if (status !== 'done' && status !== 'cancelled') actions.push({ label: t('actCancel'), onClick: cancelSelected });
				if (status === 'done' || status === 'pending_acceptance') actions.push({ label: t('actReopen'), onClick: reopenSelected });
				if (status !== 'done' && status !== 'cancelled') actions.push({ label: t('actReassign'), onClick: reassignSelected });
				if (status === 'pending' && !selectedTask.assignee && !selectedTask.replies) actions.push({ label: t('actDelete'), onClick: deleteSelected });
			}

			const inInbox = scope === 'inbox';
			const inPeople = scope === 'people';
			const memberViewAgent = data.agents.find((agent) => agent.id === memberViewId) ?? null;
			const memberViewTasks = memberViewAgent === null ? [] : tasks.filter((task) => task.ownerId === memberViewAgent.id || task.assigneeId === memberViewAgent.id);
			const headerTitle = inPeople ? t('peopleTitle') : inInbox ? t('inboxTitle') : project ? '# ' + project.name : t('noProject');
			// 只拿到名字的地方（消息、人员池、批量配置）按这张表找成员的头像参数。
			rememberAvatars(data?.agents, talents);
			const headerGoal = inPeople ? t('peopleGoal') : inInbox ? t('inboxGoal') : (project?.goal ?? '');
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
				onPeople: openPeople,
				peopleActive: scope === 'people',
				onProject: switchProject,
				onNewProject: () => { closeMobile(); openNewProject(); },
				onAgent: (agent) => { closeMobile(); openProfile(agent); },
				onAgentMore: (agent) => { closeMobile(); openProfile(agent); },
				onAgentChat: (agent) => { closeMobile(); void openAgentChat(agent); },
				onAddAgent: () => { closeMobile(); openAddAgent(); },
				onRecruit: (agent) => { closeMobile(); recruit(agent); },
			};

			const body = inPeople
				? h(PeoplePage, {
					t,
					people: peopleData,
					error: peopleError,
					loading: peopleLoading,
					onRefresh: loadPeople,
					localNames: new Set((data.agents ?? []).map((agent) => agent.name)),
					onOpenPerson: (personName) => {
						const agent = data.agents.find((candidate) => candidate.name === personName);
						if (agent) { closeMobile(); openProfile(agent); } else say(t('quadrantMissing'));
					},
					onChatPerson: (personName) => {
						const agent = data.agents.find((candidate) => candidate.name === personName);
						if (agent) { closeMobile(); void openAgentChat(agent); } else say(t('quadrantMissing'));
					},
					onOpenProject: (targetId) => {
						const target = data.projects.find((project) => project.id === targetId);
						if (target) void switchProject(target);
						else say(t('quadrantMissing'));
					},
					onConfigModel: configPersonModel,
					onBindAlias: bindAlias,
					aliasDraft: { name: aliasName, target: aliasTarget, onName: setAliasName, onTarget: setAliasTarget },
				})
				: inInbox
				? h('div', { className: 'at-stream', role: 'region', 'aria-label': t('inboxTitle') },
					h('div', { className: 'at-streaminner' },
						// 失败必须可见：不能把「拉取失败」渲染成「没有待验收」。
						pendingError !== '' ? h('div', { className: 'at-peoplefail', role: 'status' }, tf(t, 'loadFailedBody') + (pendingError ? '（' + pendingError + '）' : '')) : null,
			// R-09 待验收跨项目队列。
						pendingRows !== null && pendingRows.length > 0
							? h('details', { className: 'at-people', open: true },
								h('summary', { className: 'at-peoplesum' },
									h('span', { className: 'at-peoplename' }, t('pendingTitle')),
									h('span', { className: 'at-peoplebadges' }, tf(t, 'peopleProjects', { n: new Set(pendingRows.map((row) => row.projectId)).size }))),
								h('div', { className: 'at-peopleprojects' },
									pendingRows.map((row) => h('div', { key: row.taskId + ':' + row.projectId, className: 'at-peopleproject' },
										h('span', { className: 'at-peopleprojectname' }, '#' + (row.taskNumber ?? row.taskId) + ' ' + row.title),
										row.category === 'irreversible' ? h('span', { className: 'at-peoplefail' }, t('irreversibleBadge')) : null,
										h('span', { className: 'at-peoplestate' }, row.projectName),
										h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => openInboxTask({ ref: { taskId: row.taskId }, projectId: row.projectId }) }, t('inboxOpenTask'))))))
							: null,
						// R-07 风险分区（三类需要 Human 注意的风险，进入收件箱时拉取）。
						risksData && (risksData.counts.blocked + risksData.counts.failures + risksData.counts.staleDecisions) > 0
							? h('details', { className: 'at-people', open: true },
								h('summary', { className: 'at-peoplesum' },
									h('span', { className: 'at-peoplename' }, t('riskTitle')),
									h('span', { className: 'at-peoplebadges' }, tf(t, 'riskCounts', {
										blocked: risksData.counts.blocked,
										failures: risksData.counts.failures,
										stale: risksData.counts.staleDecisions,
									}))),
								h('div', { className: 'at-peopleprojects' },
									risksData.blocked.map((row) => h('div', { key: 'b' + row.taskId, className: 'at-peopleproject' },
										h('span', { className: 'at-peopleprojectname' }, '#' + (row.taskNumber ?? row.taskId) + ' ' + row.title),
										h('span', { className: 'at-peoplestate' }, t('riskBlocked')),
										h('span', { className: 'at-peoplefail' }, t('dependsOn') + ' ' + row.blockedBy.map((id) => '#' + id).join('、')),
										h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => openInboxTask({ ref: { taskId: row.taskId }, projectId: projectId }) }, t('inboxOpenTask')))),
									risksData.failures.map((row) => h('div', { key: 'f' + row.memberId, className: 'at-peopleproject' },
										h('span', { className: 'at-peopleprojectname' }, row.name),
										h('span', { className: 'at-peoplefail', title: row.message ?? '' }, failureHuman(t, row.category ?? 'unknown')),
										h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => {
											const agent = data.agents.find((candidate) => candidate.name === row.name);
											if (agent) { closeMobile(); openProfile(agent); } else say(t('quadrantMissing'));
										} }, t('memberProfileTitle')))),
									risksData.staleDecisions.map((row) => h('div', { key: 's' + row.itemId, className: 'at-peopleproject' },
										h('span', { className: 'at-peopleprojectname' }, row.title),
										h('span', { className: 'at-peoplefail' }, tf(t, 'riskStaleHours', { n: row.waitingHours })),
										row.taskId ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => openInboxTask({ ref: { taskId: row.taskId }, projectId: projectId }) }, t('inboxOpenTask')) : null))))
							: null,
						inboxItems.length
							? inboxItems.map((item) => h('div', { key: item.id, className: cx('at-inboxitem', inboxAge(item), item.state !== 'unread' && 'at-inboxdone') },
								h('div', { className: 'at-inboxbody' },
									h('div', { className: 'at-inboxtitle' },
										item.type === 'decision_required'
											? (item.ref?.title || t('inboxDecisionTitle'))
											: item.type === 'followed_task_update'
												? tf(t, 'inboxCompletedTitle', { title: item.ref?.title ?? item.ref?.taskId ?? '' })
												: t('inboxItemTitle')),
									Array.isArray(item.ref?.questions) && item.ref.questions.length
										? item.state === 'unread'
											? h(InboxDecision, { t, item, onSubmit: (target, answers, note) => answerDecision(target, answers, note) })
											: h('ol', { className: 'at-inboxquestions' }, item.ref.questions.map((question, index) => h('li', { key: question.id ?? index },
												h('span', { className: 'at-inboxquestion' }, question.text),
												Array.isArray(question.options) && question.options.length
													? h('span', { className: 'at-inboxoptions' }, question.options.join(' / '))
													: null,
												question.recommendation ? h('span', { className: 'at-inboxrecommend' }, t('decisionRecommend') + '：' + question.recommendation) : null)))
										: null,
									h('div', { className: 'at-inboxmeta' },
										item.projectName ? item.projectName + ' · ' : '',
										item.ref?.category
											? failureHuman(t, item.ref.category) + ' · '
											: '',
										item.ref?.memberName ?? (item.ref?.memberId ? item.ref.memberId : ''),
										' · ',
										fmtTime(item.createdAt)),
									item.state !== 'unread' ? h('div', { className: 'at-inboxstate' }, item.state) : null),
								h('div', { className: 'at-inboxactions' },
									item.ref?.taskId ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => openInboxTask(item) }, t('inboxOpenTask')) : null,
									item.type === 'decision_required' && item.state !== 'unread' && Array.isArray(item.ref?.questions) && item.ref.questions.length
										? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => reopenDecision(item) }, t('decisionReopen'))
										: null,
									// R-06 决策回流：处理完回到项目现场，看团队接下来的动作。
									item.state !== 'unread' ? h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => { void followUpDecision(item); } }, t('decisionFollowUp')) : null,
									item.state === 'unread' && !(item.type === 'decision_required' && Array.isArray(item.ref?.questions) && item.ref.questions.length)
										? h('button', { className: 'at-btn at-btn-small at-btn-primary', type: 'button', onClick: () => ackInbox(item) }, t('inboxAck'))
										: null)))
							: h(EmptyState, {
								t,
								icon: 'inbox',
								title: t('inboxEmptyTitle'),
								body: t('inboxEmptyBody'),
								action: { label: t('inboxEmptyAction'), onClick: switchBoard },
							})))
				: memberViewAgent && tab === 'main'
					? h(MemberView, {
						t,
						agent: memberViewAgent,
						tasks: memberViewTasks,
						onBack: closeMemberView,
						onOpenTask: openTask,
						onOpenChat: (agent) => { void openAgentChat(agent); },
						onOpenProfile: openProfile,
					})
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
						onOpenInbox: switchInbox,
						onBackMain: () => setTab('main'),
						humanId,
					})
					: tab === 'situation'
						? h(Situation, { t, quadrants, tasks, onItem: openQuadrantItem, onViewAll: viewQuadrant })
						: h(React.Fragment, null, h('div', { className: 'at-stream', role: 'tabpanel', id: 'at-panel-main', 'aria-labelledby': 'at-tab-main', ref: streamRef, onScroll: onStreamScroll },
							h('div', { className: 'at-streaminner', role: 'log', 'aria-live': 'polite', 'aria-label': t('streamAria') },
								h(TeamPulse, { t, agents: data.agents, tasks, onOpen: openTask, onCancelAllPending: cancelAllPending, cancelBusy: cancelAllBusy }),
								data.stream.length
									? data.stream.map((item) => h(StreamMessage, {
										key: item.id,
										t,
										item,
										data,
										tasks,
										selected,
										follows: followingOf,
										highlight: streamHighlight === item.id,
										onOpenProfile: openProfile,
										onChat: (agent) => { closeMobile(); void openAgentChat(agent); },
										onOpen: openTask,
										onToggleFollow: toggleFollow,
									}))
									: h(Onboarding, {
										t,
										project,
										agents: data.agents,
										onSetWorkspace: openWorkspaceEditor,
										onExample: () => setDraft(t('emptyStreamExample')),
									}))),
							h(JumpToLatest, { t, unseen: streamUnseen, onJump: jumpToLatest }));

			return h('div', { className: 'at-root', role: 'region', 'aria-label': t('panel') },
				h('div', { className: 'at-top' },
					h('span', { className: 'at-brand' }, t('panel')),
					h('span', { className: 'at-spike', title: t('spikeTitle') }, t('spike')),
					inboxUnread > 0 ? h('button', { className: 'at-pending', type: 'button', onClick: switchInbox }, t('pendingHuman') + ' · ' + unread) : null,
					h('details', { className: 'at-mobile', ref: mobileRef },
						h('summary', { className: 'at-mobilesummary', 'aria-label': t('menuAria') }, h(Ico, { name: 'menu', size: 14 }), h('span', null, t('menu'))),
						h('div', { className: 'at-mobilepop' }, h(LeftPanel, leftProps))),
					h('span', { className: 'at-topproject', title: headerTitle }, inInbox ? t('inboxTitle') + (unread ? ' · ' + unread : '') : (project?.name ?? ''))),
				h(ToastStack, { t, toasts, onClose: (id) => setToasts((prev) => prev.filter((toast) => toast.id !== id)) }),
				h('div', { className: cx('at-grid', threadOpen && selectedTask && 'at-withthread') },
					h('aside', { className: 'at-left', role: 'region', 'aria-label': t('projectsAria') }, h(LeftPanel, leftProps)),
					h('main', { className: 'at-center' },
						h('header', { className: 'at-chead' },
							h('div', { className: 'at-title', title: headerTitle }, headerTitle),
							headerGoal ? h('div', { className: 'at-goal', title: headerGoal }, headerGoal) : null,
							!inInbox && !inPeople && project ? h('div', { className: 'at-workspacebar' },
								h('span', { className: 'at-workspacepath', title: project.workspacePath || t('workspaceHint') },
									project.workspacePath ? t('workspace') + '：' + project.workspacePath : t('workspaceUnset')),
								h('button', { className: 'at-workspacebtn', type: 'button', onClick: openWorkspaceEditor }, project.workspacePath ? t('workspaceChange') : t('workspaceChoose')),
								h('button', {
									className: cx('at-pmobtn', project.pmoAuto !== false && 'at-pmo-on'),
									type: 'button',
									title: t('pmoHint'),
									'aria-pressed': project.pmoAuto !== false,
									onClick: togglePmo,
								}, project.pmoAuto !== false ? t('pmoOn') : t('pmoOff')),
								h('button', {
									className: cx('at-pmobtn', !runStopped && 'at-pmo-on'),
									type: 'button',
									title: t('runStateHint'),
									'aria-pressed': !runStopped,
									onClick: () => { void toggleRunState(); },
								}, !runStopped ? t('runOn') : t('runOff')),
								h('button', {
									className: 'at-workspacebtn',
									type: 'button',
									title: t('handoffHint'),
									onClick: () => { void makeHandoff(); },
								}, t('handoffBtn')),
								h('button', {
									className: 'at-workspacebtn',
									type: 'button',
									title: t('archiveHint'),
									onClick: () => { void archiveCurrentProject(); },
								}, t('archiveProject'))) : null,
							inInbox || inPeople ? null : h('div', { className: 'at-tabs', role: 'tablist', 'aria-label': t('tabsAria'), onKeyDown: tabKeyDown },
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
								}, t('boardTab'), h('span', { className: 'at-tabcount' }, boardTaskCount)),
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
						note ? h('div', { className: 'at-notewrap' },
							h('div', { className: 'at-note', role: 'status' },
								h('span', { className: 'at-notetext' }, note),
								h('button', { className: 'at-noteclose', type: 'button', 'aria-label': t('dismiss'), title: t('dismiss'), onClick: () => setNote('') }, h(Ico, { name: 'close', size: 12 })))) : null,
						body,
						scope === 'project' && tab === 'main' && !memberViewAgent ? h(Composer, {
							t,
							mode,
							draft,
							// R-04：无目录只限制「任务」模式（执行需要工作目录），讨论仍可发；
							// 输入框本体不禁用，保持轻入口可用。
							disabled: mode === 'task' && (!project || !project.workspacePath),
							qaRequired: qaTask,
							definition: taskDefinition,
							qaChecklist: qaChecklistText,
							onQaRequired: setQaTask,
							onDefinition: setTaskDefinition,
							onQaChecklist: setQaChecklistText,
							onMode: setMode,
							onDraft: setDraft,
							onSend: send,
							inputRef: composerInputRef,
							agents: (data?.agents ?? []).filter((agent) => agent.status !== 'retired'),
							attachments: pendingFiles,
							onAttach: attachFiles,
							onRemoveAttachment: removeAttachment,
						}) : null),
					threadOpen && selectedTask ? h(ThreadPanel, {
						t,
						task: selectedTask,
						thread,
						project,
						following: followingOf(selectedTask),
						onToggleFollow: () => toggleFollow(selectedTask),
						onClose: closeThread,
						onChat: () => openTaskAgentChat(selectedTask),
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
						note: rightNote,
						onDismissNote: () => setRightNote(''),
						acceptChecked,
						onAcceptChecked: setAcceptChecked,
						qaChecks,
						onQaCheck: (index, passed) => setQaChecks((prev) => prev.map((entry, i) => i === index ? { ...entry, passed } : entry)),
						onAccept: acceptTask,
						onChanges: requestChanges,
						actions,
						panelRef: rightRef,
						replyRef,
						taskEventsData,
						onLoadEvents: openTaskEvents,
					}) : null,
					addOpen ? h(ModalBack, { onClose: () => setAddOpen(false) },
						h('form', {
							className: 'at-modal at-modal-wide',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('addAgentTitle'),
							onSubmit: (event) => { event.preventDefault(); createAgent(); },
						},
							h('h2', { className: 'at-modaltitle' }, withIco(mCopy && !mCopy.talent ? 'copy' : 'userPlus', mCopy && !mCopy.talent ? t('memberCopy') : t('addAgentTitle'), 16)),
							mCopy && !mCopy.talent ? null : h('div', { className: 'at-mode at-addtabs', role: 'group', 'aria-label': t('addAgentTitle') },
								h('button', { type: 'button', 'aria-pressed': mTab === 'market' ? 'true' : 'false', onClick: () => setMTab('market') }, withIco('store', t('talentMarket'), 12)),
								h('button', { type: 'button', 'aria-pressed': mTab === 'custom' ? 'true' : 'false', onClick: () => setMTab('custom') }, withIco('pen', t('talentCustom'), 12)),
								h('button', { type: 'button', 'aria-pressed': mTab === 'create' ? 'true' : 'false', onClick: () => setMTab('create') }, withIco('plus', t('talentCreate'), 12))),
							mTab === 'market' && !(mCopy && !mCopy.talent) ? h(TalentMarket, {
								t,
								talents,
								error: talentError,
								query: talentQuery,
								onQuery: setTalentQuery,
								category: talentCategory,
								onCategory: setTalentCategory,
								onHire: hireTalent,
								onFork: (talent) => void forkTalent(talent),
								onRestore: (talent) => void restoreTalent(talent),
								catalog: catalogInfo,
								catalogBusy,
								catalogNote,
								onSync: () => void syncCatalog(),
								onClear: () => void clearCatalog(),
								onCancel: () => setAddOpen(false),
							}) : mTab === 'create' && !(mCopy && !mCopy.talent) ? h(TalentCreator, { key: talentInit && talentInit.memberId ? 'm:' + talentInit.memberId : 'blank', t, initial: talentInit, onSaved: () => { loadTalents(); setTalentInit(null); setMTab('market'); }, onCancel: () => { setAddOpen(false); setTalentInit(null); } }) : [
							mCopy?.talent ? h('div', { key: 'from', className: 'at-modalmeta' }, tf(t, 'memberHireFrom', { name: mCopy.sourceName, version: mCopy.talent.version })) : null,
							mCopy && !mCopy.talent ? h('div', { key: 'from', className: 'at-modalmeta' }, tf(t, 'memberCopyFrom', { name: mCopy.sourceName })) : null,
							h('div', { key: 'nr', className: 'at-fieldrow' },
								h('label', { className: 'at-field' }, h('span', null, t('memberName')),
									h('input', { value: mName, onChange: (event) => setMName(event.target.value), autoFocus: true })),
								h('label', { className: 'at-field' }, h('span', null, t('memberRole')),
									h('input', { value: mRole, onChange: (event) => setMRole(event.target.value) }))),
							h(AvatarPicker, { key: 'av', t, value: mAvatar, seed: avatarSeed(mName), onChange: setMAvatar }),
							h('label', { key: 'prompt', className: 'at-field' }, h('span', null, t('memberPrompt')),
								h('textarea', {
									value: mPrompt,
									onChange: (event) => setMPrompt(event.target.value),
									placeholder: t('memberPromptHint'),
								})),
							h('div', { key: 'model', className: 'at-fieldgrid3' }, h(ModelFields, {
								t,
								catalog: modelCatalog,
								provider: mProvider,
								effort: mEffort,
								onEffort: setMEffort,
								model: mModel,
								onProvider: setMProvider,
								onModel: setMModel,
								error: modelCatalogError,
							})),
							h('label', { key: 'owner', className: 'at-check' },
								h('input', { type: 'checkbox', checked: mOwner, onChange: (event) => setMOwner(event.target.checked) }),
								h('span', null, t('memberOwner'))),
							h('div', { key: 'perm', className: 'at-modalmeta' }, t('permissionNote')),
							mError ? h('div', { key: 'err', className: 'at-modalerror', role: 'alert' }, mError) : null,
							h('div', { key: 'actions', className: 'at-modalactions' },
								h('button', { className: 'at-btn', type: 'button', onClick: () => setAddOpen(false), disabled: mBusy }, withIco('close', t('cancel'))),
								h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: mBusy || !mName.trim() }, withIco('userPlus', mBusy ? t('memberAdding') : t('memberCreate'))))])) : null,
					profileAgent ? h(ModalBack, { onClose: () => setProfileAgent(null) },
						h('form', {
							className: 'at-modal at-modal-wide',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('memberProfileTitle'),
							onSubmit: (event) => { event.preventDefault(); saveProfile(); },
						},
							h('h2', { className: 'at-modaltitle' }, h(Avatar, { name: profileAgent.name, size: 28 }), tf(t, 'memberProfileTitleName', { name: profileAgent.name })),
							// 右上角按钮按用途分组：去看（任务 / 对话）· 复用（复制 / 存为人才）· 会话维护（重试 / 重置 / 重新蒸馏，黄）· 离开（红）· 取消 / 保存。
							h('div', { className: 'at-modalactions' },
								h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => { const target = profileAgent; setProfileAgent(null); openMemberView(target); } }, withIco('board', t('memberTasks'), 12)),
								h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: () => { const target = profileAgent; setProfileAgent(null); void openAgentChat(target); } }, withIco('reply', t('agentChat'), 12)),
								h('span', { className: 'at-actsep', 'aria-hidden': 'true' }),
								h('button', { className: 'at-btn at-btn-small at-btn-accent', type: 'button', onClick: () => { const source = profileAgent; setProfileAgent(null); openCopyAgent(source); }, disabled: pBusy }, withIco('copy', t('memberCopy'), 12)),
								h('button', { className: 'at-btn at-btn-small at-btn-accent', type: 'button', onClick: () => { const source = profileAgent; setProfileAgent(null); void openSaveAsTalent(source); }, disabled: pBusy }, withIco('store', t('memberSaveAsTalent'), 12)),
								h('span', { className: 'at-actsep', 'aria-hidden': 'true' }),
								profileAgent.status === 'failed' ? h('button', { className: 'at-btn at-btn-small at-btn-warn', type: 'button', onClick: retryProfile, disabled: pBusy }, withIco('sync', t('retry'), 12)) : null,
								profileAgent.sessionId ? h('button', { className: 'at-btn at-btn-small at-btn-warn', type: 'button', title: t('reseatConfirm'), onClick: reseatProfile, disabled: pBusy }, withIco('undo', t('reseatSession'), 12)) : null,
								h('button', { className: 'at-btn at-btn-small at-btn-warn', type: 'button', onClick: distillProfile, disabled: pBusy }, withIco('spark', t('redistill'), 12)),
								h('button', { className: 'at-btn at-btn-small at-btn-danger', type: 'button', onClick: leaveProfile, disabled: pBusy }, withIco('block', t('leaveTeam'), 12)),
								h('span', { className: 'at-actsep', 'aria-hidden': 'true' }),
								h('button', { className: 'at-btn', type: 'button', onClick: () => setProfileAgent(null), disabled: pBusy }, withIco('close', t('cancel'))),
								h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: pBusy || !pName.trim() }, withIco('check', pBusy ? t('saving') : t('save')))),
							h('div', { className: 'at-modalmeta' },
								tf(t, 'memberProfileMeta', {
									status: t(AGENT_STATUS[profileAgent.status] ?? 'agentIdle'),
									version: profileAgent.profileVersion ?? 1,
									distill: profileAgent.distillVersion ?? 0,
								})),
							// R-02 权限可见性：把守卫背后的运行事实亮给用户（P6 诚实边界）。
							h('div', { className: 'at-permbadge', title: t('permissionNote') },
								t('permissionBadge') + ' @ ' + (project?.workspacePath || '—')),
							pError ? h('div', { className: 'at-modalerror', role: 'alert' }, pError) : null,
							// 仿系统设置：按用途分页签，一页只放一类设置。
							h('div', { className: 'at-mode at-addtabs', role: 'tablist', 'aria-label': t('memberProfileTitle') },
								[['basic', 'user', 'profileTabBasic'], ['model', 'layers', 'profileTabModel'], ['skills', 'spark', 'profileTabSkills'], ['collab', 'reply', 'profileTabCollab']].map(([id, icon, key]) => h('button', {
									key: id,
									type: 'button',
									role: 'tab',
									'aria-selected': pTab === id ? 'true' : 'false',
									'aria-pressed': pTab === id ? 'true' : 'false',
									onClick: () => setPTab(id),
								}, withIco(icon, t(key), 12)))),
							pTab === 'basic' ? [
								h(AvatarPicker, { key: 'av', t, value: pAvatar, seed: avatarSeed(pName.trim() || profileAgent.name), onChange: setPAvatar }),
								h('div', { key: 'nr', className: 'at-fieldrow' },
									h('label', { className: 'at-field' }, h('span', null, t('memberName')),
										h('input', { value: pName, onChange: (event) => setPName(event.target.value), autoFocus: true })),
									h('label', { className: 'at-field' }, h('span', null, t('memberRole')),
										h('input', { value: pRole, onChange: (event) => setPRole(event.target.value) }))),
								h('div', { key: 'pn', className: 'at-profilebasic' },
									h('label', { className: 'at-field' }, h('span', null, t('memberPersonality')),
										h('textarea', { value: pPersonality, rows: 12, onChange: (event) => setPPersonality(event.target.value) })),
									h('div', { className: 'at-field' }, h('span', null, t('profileNotes')),
										h('div', { className: 'at-inlineadd' },
											h('input', { value: pNote, onChange: (event) => setPNote(event.target.value), placeholder: t('notePlaceholder') }),
											h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: addNote, disabled: !pNote.trim() }, withIco('plus', t('addNote'), 12))),
										profileAgent.notes?.length ? h('div', { className: 'at-notesbox' }, profileAgent.notes.slice(-3).reverse().join('\n\n')) : h('div', { className: 'at-modalmeta' }, t('profileNotesEmpty')))),
							] : null,
							pTab === 'model' ? h('div', { className: 'at-fieldgrid3' },
								h('label', { className: 'at-field' }, h('span', null, t('memberPreset')),
									h('select', { value: pPreset, onChange: (event) => setPPreset(event.target.value) },
										h('option', { value: 'standard' }, t('presetStandard')),
										h('option', { value: 'ptc' }, t('presetPtc')),
										h('option', { value: 'minimal' }, t('presetMinimal')),
										h('option', { value: 'cordis' }, t('presetCordis')))),
								h('label', { className: 'at-field' }, h('span', null, t('memberMaxTokens')),
									h('input', { value: pMaxTokens, onChange: (event) => setPMaxTokens(event.target.value), inputMode: 'numeric' })),
								h('span', { 'aria-hidden': 'true' }),
								h(ModelFields, {
									t,
									catalog: modelCatalog,
									provider: pProvider,
									effort: pEffort,
									onEffort: setPEffort,
									model: pModel,
									onProvider: setPProvider,
									onModel: setPModel,
									error: modelCatalogError,
								})) : null,
							pTab === 'skills' ? [
								profileAgent.skills?.length
									? h('div', { key: 'list', className: 'at-tcskills', 'aria-label': t('memberSkills') },
										profileAgent.skills.map((name) => h('span', { key: name, className: 'at-tcskill' }, name,
											h('button', { type: 'button', className: 'at-btn at-btn-small', title: t('skillEvolveHint'), onClick: () => void evolveSkill(profileAgent, name) }, withIco('spark', t('skillEvolve'), 12)))))
									: h('div', { key: 'none', className: 'at-modalmeta' }, t('profileSkillsEmpty')),
								pEvolve ? h('div', { key: 'ev', className: 'at-modalmeta', role: 'status' }, pEvolve) : null,
								h('div', { key: 'add', className: 'at-inlineadd' },
									h('input', { value: pSkill, onChange: (event) => setPSkill(event.target.value), placeholder: t('skillPlaceholder') }),
									h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: addSkill, disabled: !pSkill.trim() }, withIco('plus', t('addSkill'), 12))),
							] : null,
							pTab === 'collab' ? [
								h('label', { key: 'succ', className: 'at-field' }, h('span', null, t('successor')),
									h('select', {
										value: pSuccessor,
										onChange: (event) => setPSuccessor(event.target.value),
									},
										h('option', { value: '' }, t('noSuccessor')),
										(data?.agents ?? []).filter((candidate) => candidate.id !== profileAgent.id && candidate.status !== 'retired')
											.map((candidate) => h('option', { key: candidate.id, value: candidate.id }, candidate.name + (candidate.qa ? ' · QA' : ''))))),
								h('div', { key: 'msg', className: 'at-inlineadd' },
									h('input', {
										value: pMessage,
										onChange: (event) => setPMessage(event.target.value),
										placeholder: t('messagePlaceholder'),
									}),
									h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: sendMemberMessage, disabled: !pMessage.trim() }, withIco('reply', t('sendMessage'), 12))),
								// 成员作为 DSH 子智能体管理：从「管理的子智能体」面板可直接对话；
								// 此私信写入同一会话，成员下一轮回复。
								h('div', { key: 'hint', className: 'at-modalmeta' }, t('routingHint')),
							] : null)) : null,
					workspaceOpen ? h(ModalBack, { onClose: () => setWorkspaceOpen(false) },
						h('form', {
							className: 'at-modal',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('workspaceDialogTitle'),
							onSubmit: (event) => { event.preventDefault(); saveWorkspace(); },
						},
							h('h2', { className: 'at-modaltitle' }, t('workspaceDialogTitle')),
							h('p', { className: 'at-modalmeta' }, t('workspaceDialogHint')),
							h('label', { className: 'at-field' }, h('span', null, t('workspace')),
								h('div', { className: 'at-inlineadd' },
									h('input', { value: workspaceDraft, onChange: (event) => setWorkspaceDraft(event.target.value), placeholder: data?.workspaceExample ?? t('workspacePathPlaceholder'), autoFocus: true }),
									h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: pickProjectWorkspace }, t('workspaceChoose')))),
							workspaceError ? h('div', { className: 'at-modalerror', role: 'alert' }, workspaceError) : null,
							h('div', { className: 'at-modalactions' },
								h('button', { className: 'at-btn', type: 'button', onClick: () => setWorkspaceOpen(false), disabled: workspaceBusy }, t('cancel')),
								h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: workspaceBusy || !workspaceDraft.trim() }, workspaceBusy ? t('saving') : t('workspaceSave'))))) : null,
					newOpen ? h(ModalBack, { onClose: () => setNewOpen(false) },
						h('form', {
							className: 'at-modal at-modal-wide',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('newProjectTitle'),
							onSubmit: (event) => { event.preventDefault(); createProject(); },
						},
							h('h2', { className: 'at-modaltitle' }, withIco('folderPlus', t('newProjectTitle'), 16)),
							h('div', { className: 'at-modalactions' },
								h('button', { className: 'at-btn', type: 'button', onClick: () => setNewOpen(false), disabled: nBusy }, withIco('close', t('cancel'))),
								h('button', { className: 'at-btn at-btn-primary', type: 'submit', disabled: nBusy || !nName.trim() || !nWorkspace.trim() }, withIco('check', nBusy ? t('saving') : t('projectCreate')))),
							nError ? h('div', { className: 'at-modalerror', role: 'alert' }, nError) : null,
							h('div', { className: 'at-split' },
								h('div', { className: 'at-pane' },
									h('label', { className: 'at-field' }, h('span', null, t('projectName')),
										h('input', { value: nName, onChange: (event) => setNName(event.target.value), autoFocus: true })),
									h('label', { className: 'at-field' }, h('span', null, t('projectGoal')),
										h('textarea', { value: nGoal, rows: 5, onChange: (event) => setNGoal(event.target.value) })),
									h('label', { className: 'at-field' }, h('span', null, t('workspace')),
										h('div', { className: 'at-inlineadd' },
											h('input', { value: nWorkspace, onChange: (event) => setNWorkspace(event.target.value), placeholder: data?.workspaceExample ?? t('workspacePathPlaceholder') }),
											h('button', { className: 'at-btn at-btn-small', type: 'button', onClick: pickNewWorkspace }, withIco('folderPlus', t('workspaceChoose'), 12)))),
									h('label', { className: 'at-field' }, h('span', null, t('projectTeam')),
										teamList === null ? h('div', { className: 'at-modalmeta' }, t('talentLoading'))
											: h('select', { value: nTeam, onChange: (event) => setNTeam(event.target.value) }, teamList.filter((entry) => !entry.broken).map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name + '（' + entry.members.length + '）' + (entry.source === 'user' ? ' · ' + t('talentUser') : ''))))),
									teamLoadError ? h('div', { className: 'at-modalerror', role: 'alert' }, teamLoadError) : null,
									h('div', { className: 'at-tcpick' },
										h('button', { className: 'at-btn at-btn-small at-btn-accent', type: 'button', onClick: () => { setTeamComposeOpen(true); loadTalents(); } }, withIco('users', t('teamCompose'), 12)),
										selectedTeam && selectedTeam.source === 'user' ? h('button', { className: 'at-btn at-btn-small at-btn-danger', type: 'button', onClick: () => void removeTeam(selectedTeam) }, withIco('close', t('teamDelete'), 12)) : null)),
								// 右栏：选中团队的成员卡片（名字、岗位、职责、简介、技能；负责人标出来）。
								h('div', { className: 'at-pane' },
									selectedTeam ? h('div', { className: 'at-panetitle', title: teamMembersLine(selectedTeam) }, selectedTeam.name + ' · ' + tf(t, 'projectTeamMembers', { n: selectedTeam.members.length })) : null,
									selectedTeam && selectedTeam.description ? h('div', { className: 'at-modalmeta' }, selectedTeam.description) : null,
									selectedTeam ? h('div', { className: 'at-marketgrid', role: 'list' }, selectedTeam.members.map((member) => h('div', { key: member.id, className: 'at-talent', role: 'listitem' },
										h(TalentInfo, { t, talent: member, lead: member.id === selectedTeam.lead })))) : null)))) : null,
					teamComposeOpen ? h(ModalBack, { onClose: () => setTeamComposeOpen(false) },
						h('div', { className: 'at-modal at-modal-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('teamComposeTitle') },
							h('h2', { className: 'at-modaltitle' }, withIco('users', t('teamComposeTitle'), 16)),
							h(TeamComposer, { t, talents, onSaved: (team) => { setTeamComposeOpen(false); void loadTeams(team && team.id); }, onCancel: () => setTeamComposeOpen(false) }))) : null,
					peopleModel ? h(PeopleModelDialog, { t, catalog: modelCatalog, catalogError: modelCatalogError, people: peopleData ?? [], initial: peopleModel, onApply: applyPeopleModel, onClose: () => setPeopleModel(null) }) : null,
					dialog ? h(WorkbenchDialog, { key: dialogSeqRef.current, t, dialog, onDismiss: () => setDialog(null) }) : null,
					shortcutsOpen ? h(ModalBack, { onClose: () => setShortcutsOpen(false) },
						h('div', { className: 'at-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('shortcutTitle') },
							h('h2', { className: 'at-modaltitle' }, t('shortcutTitle')),
							h('table', { className: 'at-shortcuts' },
								h('tbody', null,
									[['g i', 'shortcutInbox'], ['g b', 'shortcutBoard'], ['g p', 'shortcutPeople'], ['g c', 'shortcutHome'], ['/', 'shortcutComposer'], ['Esc', 'shortcutClose']].map(([keys, key]) => h('tr', { key: keys },
										h('td', null, h('kbd', null, keys)),
										h('td', null, t(key)))))),
							h('div', { className: 'at-modalactions' },
								h('button', { className: 'at-btn', type: 'button', onClick: () => setShortcutsOpen(false) }, t('close'))))) : null));
		}

		function PavilionMark({ size = 18 }) {
			return h('svg', {
				width: size,
				height: size,
				viewBox: '0 0 24 24',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.8,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				'aria-hidden': 'true',
				focusable: 'false',
			},
				h('path', { d: 'M5 8l7-4 7 4' }),
				h('path', { d: 'M7 11h10' }),
				h('path', { d: 'M4 14h16' }),
				h('path', { d: 'M9 14v3' }),
				h('path', { d: 'M15 14v3' }),
				h('path', { d: 'M4 20c2.5-1.5 5.5-1.5 8 0s5.5 1.5 8 0' }));
		}

		function PanelIcon() {
			return h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'inherit' } }, h(PavilionMark, { size: 18 }));
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
		}

		return { inject: ['slots', 'locale'], apply };
	},
});
