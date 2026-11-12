# Changelog

## 0.4.40 - 2026-11-12

**批 9：依赖可达性、账本修复入口、job 状态机、投票解析统一**

- **依赖不能指向已删的卡**：删除是 tombstone，而依赖判定只认 `status === 'done'`——指向一张已删除/已取消的卡会让新卡**永久** blocked 且无修复命令。`task.create` 现在拒绝这类 `blockedBy`。
- **`project.repair` 命令**：`ledger.repair()` 此前没有任何生产调用点，poison 之后只能重启。新增 Human 专用命令，返回 `repair`/`repairs`/`events`/`stateLastSeq` 并记 `ledger.repaired` 诊断。
- **job 状态机三处**：① `deps.vcs.backup` 不是每个适配器都有（git 就没有），无脑调用会 TypeError 让 job 卡到 TTL；② `plan.next` 是在 switch 之前算的，回写会把刚判死的 job 复活成 `judging`，下一轮再拿一个未应用的候选写假记录；③ `rollback` 无条件把陈旧的 `before` 写回 live，会覆盖评审期间的人工修改——现在先校验 live 仍是候选文本。
- **投票解析统一**：评审通道原本用自己的「第一个 `{` 到第一个 `}`」正则，会把模板回显计成票、也会在正文含 `}` 时整票丢弃。现在复用 judge 的平衡扫描解析器，并让它保留 `orderId`。
- 测试：`node --test` **242/242**（新增 4 例）。

## 0.4.39 - 2026-11-12

**第三轮（对抗性复审）回归修复**

三路独立复审对 `b64b4ae..HEAD` 提出 19 条，其中 10 条已修：

- **投影版本必须递增**：我改了折叠语义（接管不再写 claimHistory、换 owner 同步 ownerId）却没升 `FOLD_STATE_VERSION`，旧 checkpoint 会被零尾放采信——升级后「前 owner 仍通过 isLead」「接管继任者仍被排除在验收候选外」永久保留。现为 **v3**，旧 checkpoint 作废重折。
- **repair 只修了段文件**：门面 `repair()` 返回 writer 结果却不重折 state/events，`state.lastSeq` 停在修复前水位，下一次 append 后中间事件永不进投影、零尾放把缺口固化。现在从磁盘重读并 `fold()` 重建，同时落一次 checkpoint。
- **迁移门禁**：此前只按「目标数据更少」判断，若从 `--profile ai-team` 启动一个 CLI，会把 desktop 的 `ai-team/default` 整体搬进该 profile。现在**只允许** `argv-path` 来源（桌面启动器）触发迁移；`resolveProfile` 同时返回来源。
- **迁移回滚**：第二步 rename 失败时目标已被挪走，原实现返回 `kept` 但目标消失，下次 boot 会用空目录重建 registry。现在失败会还原目标。
- **作者契约**：`bootstrap` 的 `stream[].author` 上一版发的是字符串，而客户端读 `item.author.kind/.name`——作者仍显示「—」。现在发 `{ id, kind, name }`。
- **PMO 自动作答进锁**：`autoAnswerDecision` 读 head → 分配 seq → append，与 `thread.post` 并发时同 seq 会被 fold 静默丢弃，Human 的明确决策可能被自动决策替换。
- **建卡校验不再误伤**：只校验**显式传入**的 `ownerId`；默认 owner（退役的 Project owner）不再把工作台建卡入口整个封死。
- **依赖校验**：`blockedBy` 用 `Object.hasOwn`（原型链键不再算「存在」）。
- **决策终态**补上 `done`。
- **别名值容错**：`people-aliases.json` 里非字符串值不再让 `/api/people` 500。
- **迁移后的 judging job**：`job.project` 是绝对路径，迁移后精确比较失败会让这些 job 永久跳过；现在按项目 id 兜底匹配。
- 测试：`node --test` **239/239**（新增 4 例：来源门禁、迁移回滚、别名容错、显式 owner 校验）。

## 0.4.38 - 2026-11-12

**中危批次 8：技能根、决策串行化、失败升级去重**

- **成员技能不再静默缺席**：`loadSkillContext` 只在一个根下找 `skills/`，而调用方传的是**项目账本目录**，它下面永远没有 `skills/`。现在支持多根：工作区 `.dsh/skills`、用户 `~/.dsh/skills`、插件数据目录依次查找。
- **决策命令串行化**：`decision.request` / `decision.answer` 与 task 命令一样纳入 `runExclusive`——`answerDecision` 之前仍在锁外「读 headSeq → 分配 seq → append」，并发时同 seq 会被 fold 去重静默丢弃，双方都返回成功。
- **失败升级不再被自己的决策吞掉**：升级项的去重键用的是 `ref.memberId`，而 `requestDecision` 里同名字段的语义是「申请人」——成员只要有一条自己提的未决决策，ta 的致命失败就再也不会生成升级项。现在升级项带 `ref.kind = 'member_failure'` + `ref.failedMemberId`，按自己的字段去重（旧数据也做了兼容判定）。
- 测试：`node --test` **235/235**（新增 2 例）。

## 0.4.37 - 2026-11-12

**中危批次 7：评审卡收口、job 终态、幽灵成员、重试预算**

- **评审卡三条终态都收口**：成功路径原本会关掉评审卡，超时与 conflict 两条失败路径不会——卡永久 pending 进入 PMO 的 active 集合，被 heartbeat/stall/escalate 反复唤醒评审官。现在收口逻辑抽成一个 `closeReviewCard`，三条路径共用。
- **done 不可被回退**：并发收票/收割时，后到的一次判断可能把已 done 的 job 覆写成 failed（之后 TTL 与统计都按错误状态走）。`writeJob` 现在拒绝用非 done 状态覆盖 done。
- **幽灵成员与幽灵依赖**：`task.create` 之前不校验 `ownerId` / `assigneeId` / `blockedBy`，不存在的 id 会直接写进投影且没有修复命令——卡永久挂在不存在的人名下，或被一个不存在的依赖永久 blocked。现在统一走 `requireMemberRef`（与 `taskCommand` 共用同一实现）。
- **重试预算按请求算**：`retryDecision` 的 `attempt` 原来传的是 `member.attempts`（成员**生命周期**失败计数），换路索引被跳过、预算被历史失败提前耗尽。改为按会话 + 10 分钟窗口的连续失败计数。
- 测试：`node --test` **233/233**（新增 3 例）。

## 0.4.36 - 2026-11-12

**中危批次 6：PMO tick 崩溃、重复决策、接管不污染验收资格、退役终态**

- **PMO tick 不再每轮抛 TypeError**：`autoAnswerDecisions` 在 Human 缺失时返回数字 `0`，调用方按数组迭代直接 TypeError，整个 tick 被打断且每轮重复。改为返回 `[]`。
- **重复决策被拒**：`answerDecision` 没有终态前置，对已 `resolved`/`dismissed`/`superseded` 的决策项再次提交会被接受，重复写 Thread 回复、ack 回来的还是旧答案。
- **接管不再污染验收资格**（INV-07）：`task/taken-over` 把继任者写进 `claimHistory`，而 `isReviewCandidate` 会排除 `claimHistory` 里的人——继任者因此永久没有资格验收自己名下的卡。接管事实改由既有的 `takeoverHistory` 记录。
- **退役是终态**：`member.fail` 与迟到的 `recordMemberFailure` 都不再接受退役成员（此前 retired 会被改写成 failed，随后 `member.bind` 能把成员复活）。
- **删除死代码**：`installFileSkillProvider` 按「`registerProvider` 可能返回 invalidate」处理，而 SDK 契约只返回 disposer——该分支永远不可达，已按契约收敛。
- 测试：`node --test` **231/231**（新增 3 例；另按 INV-07 更新 1 处既有断言）。

## 0.4.35 - 2026-11-12

**中危批次 5：命名空间、poison 恢复、多数决、并发认领**

- **profile 命名空间解析**：桌面启动器按**位置参数**传 profile 目录（`… <dsh-root> …\.dsh\profiles\desktop …`），旧解析只认 `--profile <name>`，于是 desktop profile 的账本全落进 `ai-team/default/`。现在 `--profile x` / `--profile=x` / 位置路径 / `DSH_PROFILE` 都认。
- **一次性、可回退的命名空间搬迁**：只修解析会让既有数据留在 `default/`（界面上团队凭空消失）。启动时若旧命名空间的数据明显多于目标命名空间，则把旧目录整体改名迁入，目标原有内容改名 `*.superseded-<ts>` 保留，不删除任何文件。
- **poison 之后有恢复路径**：回滚失败会把 writer 置为 poisoned，错误信息建议「close and open it again」，但生产代码没有调用点。`repair()` 现在按磁盘真相重建后**解除 poison**（返回 `recoveredFromPoison`），不必等重启。
- **评审改判多数决**：评审通道原本要求**全票**才判定，与 `decideByMajority` 的最少有效票契约相反——漏一票就要空等 30 分钟再判 failed。现在按「应投数量的半数（向上取整）」为门槛，`required` 也按应投数量算（此前按已收票数算，2/3 时会退化成 1 票定案）。
- **task 命令串行化**：`claim/submit/accept/...` 等 12 个写命令此前不在 `runExclusive` 内，「读投影 → 判定 → 追加」可被并发双双通过，同一成员能同时持有两张 in_progress 卡（破坏 INV-05，且投影不会自愈）。
- 测试：`node --test` **229/229**（新增 `namespace` 4 例、poison 恢复 1 例、多数决 1 例、并发认领 1 例；并发那条已用对照组确认「撤掉修复即失败」）。

## 0.4.34 - 2026-11-12

**同人绑定：合并后显示目标名**

- 人员池按名字聚合同一人（同名跨项目合成一行）；「同人绑定」把**不同名字**并到一起。上一版修好了归一化，但合并行的名字取自「遍历顺序里第一个成员」——把「百里」绑到「白砚」后，两行确实合成了一行，显示的名字却是「百里」。现在合并行一律以**别名目标**为准：`X → 白砚` 合成的那一行叫「白砚」，与遍历顺序无关。
- 测试：`node --test` **222/222**（新增 1 例：被绑定名排在前面时仍显示目标名）。

## 0.4.33 - 2026-11-12

**中危批次 4：验收门禁、权限沿革、技能过滤、job 原子写**

- **Human 验收也要过 QA 门禁**：`accept` 的清单校验原本只在 `reviewer !== null`（Agent）时执行，而 Human 是 UI 上唯一的验收人 —— `qaRequired` 的卡可以零勾选通过，未校验的 `checks` 还会原样写进 `task.qaChecks`。现在对所有验收人生效；没有清单却提交勾选会被拒。
- **换 owner 会同时换权限**：`project/owner-changed` 只更新 `ownerMemberId`，`ownerId` 停在原主；`isLead` 对两者做 OR 判定，于是**前** owner 继续保留 lead 权限。现在两者一起改。
- **技能目录按 `invocation.modelInvocable` 过滤**：`SkillSummary` 把开关放在 `invocation` 下，之前读顶层字段（恒 undefined），`disable-model-invocation` 的技能照样写进成员 prompt。
- **job 文件原子写**：`writeJob` 从裸 `writeFileSync` 改为「写临时文件 + rename」，进程中断不再留下半截 JSON（半截文件会让下一轮 tick 把成功误判成 conflict failed）。
- **rubric 计数不再被捕获组放大**：`String.match` 带捕获组时返回数组含分组，命中一次会被算成多次，dim3 分数系统性虚高。改为 `matchAll` 只数完整匹配。
- 测试：`node --test` **221/221**（新增 `test/audit-medium-batch.test.js` 5 例）。

## 0.4.32 - 2026-11-12

**中危批次 3：前端断流自愈、重复提交、同人绑定**

- **断流不再假装在重连**：`EventSource` 只在临时失败时自己重试；一旦被判死（`readyState === CLOSED`，例如服务端 4xx/5xx），浏览器不会再试，而界面还挂着「正在自动重连…」。现在由前端按 2s→30s 退避重建事件源，卸载时清掉定时器；收到帧后清掉断流提示并提示已恢复。
- **重复提交**：发送与回复共用同一个在途守卫——连按 Ctrl/⌘+Enter 或双击不会写出两条相同的消息/回复。
- **同人绑定真的会合并**：界面把「绑定到谁」的名字当 `personId` 提交，而聚合桶键是 `name:<名字>`，于是别名落到 `person:<名字>`，两行永远合不到一起、提示却是成功。现在服务端把别名的目标归一为 `person:<id>` / `name:<名字>`，聚合时裸名字也按 `name:` 处理，历史数据文件不回改也能生效。
- 测试：`node --test` **216/216**（新增 `client-contract` 结构契约 3 例、人员别名 2 例）。

## 0.4.31 - 2026-11-12

**中危批次 2：Host 会话落账、报告路径判别、PMO 决策遵从建议**

- **Host 会话现在真的会落账**：`bindHostSession` 一直存在却只在「首次创建」时被调用——从 `roots()` 选中既有根会话、或父级换成另一条根会话时都不会写，`state.hostSessionId` 永远为空，归档修复 sweep 看不见它，父级变化后 `sendMessage`/冷恢复直接 `UNAUTHORIZED` 且无自愈。现在每次解析出 Host 都按现状重绑（幂等），失败留诊断。
- **报告路径按存在性判别**：一份 Thread 里常先给示例、后给真实路径，文末还可能附模板。现在优先取**真实存在**的那条，都不存在时才退回「最后一次提到」，不再被文末模板或旧稿带走。
- **PMO 决策遵从问题里的建议**：显式 `recommendation` 现在先按选项字母（`建议 A` ↔ `A. …`）匹配，其次双向包含；只有匹配不上才退回关键词打分。此前关键词打分可以让「建议 A」被选成 B。
- 测试：`node --test` **211/211**。

## 0.4.30 - 2026-11-12

**中危批次：唤醒路径收敛与权限预设可配置**

- **唤醒只剩一条来源**：删掉 HTTP 命令返回后的第二次唤醒规划——`dispatch` 的返回值只有投影、没有事件，那条路径要么算不出计划，要么与账本事件路径用不同去重键重复唤醒。
- **不再让人验收自己的活**：`pmo/review` 之前把**所有** QA 成员都叫上，包括刚交活的 assignee 和 claim 过这张卡的人；现按 `isReviewCandidate` 排除。
- **inbox 唤醒分支修复**：账本写的是扁平载荷（`itemId`/`memberId`/`ref`），waker 却按 `payload.item` 读，导致该分支永不触发；空等人的通知现在会真的叫醒收件人。
- **权限预设名不再硬编码**：`danger-full-access` 只是约定的预设名，部署方改了名字时 `set()` 会抛错、guard 进而拒绝成员的每一次工具调用。现在按「约定名 → 表里第一个 full-access 预设」解析，两个入口（guard 与成员运行时）共用同一个解析器。
- 测试：`node --test` **206/206**。

## 0.4.29 - 2026-11-12

**第二轮审计批次 3：成员唤醒与归档修复补全**

- **第二次唤醒不再丢上下文**：冷恢复拿到的 AgentHandle 现在由 runtime 自己记住；此前 session 变 live 后第二次唤醒会回退到 `subagent.sendMessage`，manager 再做一次冷恢复并以 `NOT_RESUMABLE` 失败，触发上层强制重建、丢掉成员历史（handle 失效时才回退并清理）。
- **归档修复覆盖成员会话自身**：sweep 之前只处理 host 一代；成员会话被单独归档时该成员每回合仍永久 `blocked`。现在 member session 本身也进 victims。
- **roots() 快路径也解归档**：选中 Human 根会话时若它已归档，成员血缘被 gate 永久拒绝，而 sweep 因没有 hostSessionId 看不到它。
- **面板作者名**：`bootstrap` 的 stream 投影补 `author`（客户端读 `item.author`，账本只有 `authorId`），主对话与 Thread 不再恒显示「—」。
- **决策表章节号**：识别中文序号「六」，以 `## 六、…` 写的第 6 节决策表不再解析不出问题。
- **唤醒 prompt 截断**：Main stream 的 Human 正文截到 2000 字符，1MB 级粘贴不再整段进入 Project owner 上下文。
- 测试：`node --test` **203/203**。

## 0.4.28 - 2026-11-12

**第二轮审计：8 条 HIGH + 工作台 409 修复**

- **工作台不可达（409）**：`bootstrap` 曾用「过滤掉归档项目」的列表判定存在性，于是账本里存在、只是已归档的项目被报成 `E_NOT_FOUND`，与 `board()`/`quadrants()` 口径矛盾；归档当前 active 项目时 `booted.activeProjectId` 仍指向已归档账本，刷新后工作台停在错误页。现在存在性按未过滤记录判定，归档项目返回只读视图；无参 bootstrap 使用「该 runtime 账本里真实存在的项目」；归档 active 后自动切到 registry 的 fallback；`ProjectRegistry.setActive` 拒绝归档项目。
- **账本**：poison 闸门移入写队列——同一 tick 并发的两个批次曾同时通过入口检查，先失败者置毒后另一个仍按旧 head 写出重复 seq，账本此后永久打不开；`lock.takeover` 标记现在带 pid/startedAt 且超过 10s 可回收，清理失败会告警而非静默。
- **技能加载**：frontmatter 按 `\r\n|\r|\n` 切分。此前 CRLF 文件的最后一行整行失配（`\r` 是 JS 行终止符，`^…$` 越不过），description 位于末尾的 SKILL.md 会被当成「缺少 description」丢弃——包括插件自带的 skillopt-sleep。
- **命令注入**：SkillOpt gate 新增 `assertSafeProjectDir`，模型可控的 project 必须是真实存在的绝对目录且不含 shell 元字符；仅靠 `quoteArgv` 的双引号挡不住 `$(...)`/反引号。
- **项目创建**：`project.create` 先校验工作目录再写 registry，避免一个打不开的项目让下次 boot 全线 503；`project.activate` 透传 `workspacePath`，否则账本把它写成空、成员激活永远 `E_WORKSPACE_REQUIRED`。
- **adopt 门**：keep 记录的查找覆盖工作区与所有 runtime 数据目录（optimize 写在后者，adopt 之前只查前者，导致恒被拒）。引擎 staging 与评审通道两条流水线的候选仍不同源，失败关闭并记录为设计缺口。
- **打包**：vendor 通配收窄为 `*.py`，`__pycache__/*.pyc` 不再进入发布包（142 → 113 文件、796 → 468 kB）。
- 测试：`node --test` **200/200**。

## 0.4.27 - 2026-11-12

**审计 LOW 收尾（195/195）**

- **诊断可区分**：成员输出探针成功行改名 `member.output.probe`（此前与异常共用 `.fail`，errors 级无法区分）；`request-error` 链三处 catch 补 `*.fail` 诊断（失败记录/换路/恢复）。
- **判别正确性**：`classifyLlmFailure` 把 429 判定提到 billing 之前（带 quota 字样的限流不再被当成致命计费错误）；`scoreSkillRubric` 拒绝 `NaN` dim8；`formatRubric` 的 weakest 排除 dim8，与 `weakestDimension` 同口径。
- **技能目录**：`formatSkillCatalog` 过滤 `modelInvocable === false`（禁止模型调用的技能不再进成员 prompt）；`skillProvider.get()` 读取失败返回 `undefined` 而不是抛错打断回合；disposer 兼容函数/control 两种形状并调用 `invalidate`。
- **账本**：`_scan` 检测重复事件 id 并以 `E_LEDGER_CORRUPT`（`duplicate-id`）拒绝载入。
- **命令层**：`bootstrap` 对未知 `projectId` 报 `E_NOT_FOUND`（与 board/quadrants 同口径）；`decision.answer` 要求答案覆盖全部问题（未知/缺失均 `E_INVALID_ARGUMENT`）。
- **生命周期**：`roots()` 优先挑真正的 Human 根会话（无 `parentSession`、非 subagent）；`member.retire`/`member.leave` 成功后释放常驻 activation 句柄；损坏 job 文件保留并告警。
- 测试：`node --test` **195/195**（+2：`resilience` 的 429/quota 回归、`service` 的 bootstrap+决策完整性）。

## 0.4.26 - 2026-11-12

**审计后续：MEDIUM/LOW 三批清理（193/193）**

- **账本写入安全**：`_rollback` 本身失败时置 `E_LEDGER_POISONED`（要求 close+open），不再让 `fd=null` 的句柄继续接单；段号改为按**磁盘最大段号 + 1**推导（旧实现会复用已存在段号 → 永久 `EEXIST`）；空账本不再预创建段文件（否则空段被当尾段删掉，首段跳到 `000002`）。
- **命令层输入校验**：`member.add` 校验 id 类型/唯一性与 status 枚举；`member.config.update` 忽略请求里夹带的 `policy`（防止自行放宽白名单）；`inbox.ack` 校验归属；`decision` 写入投影；`project.create` 校验工作目录存在并拒绝重复 id；`task.assign/reassign` 校验目标成员存在且未退役。
- **路径与作者身份**：`backfillHumanMentions` 只接受工作目录内的 `.md`（`resolve+relative` 包含性校验）；`postStream` 按 actor 写 `kind`（agent 发言不再冒充 `human_message`）。
- **调度**：PMO tick 按 Project 去重（`pmoBusy` + `pmo.tick.skip`）；`wakeKeys` 改为先判定工作目录再占键（跳过不再永久丢事件）；`waker` 去重键追加成员与 Project 作用域；`task/created` 按 `payload.taskId` 回投影取任务。
- **SkillOpt 判别质量**：多数决要求有效票过半（3→2、5→3）；`parseJudgeOutput` 逐个尝试平衡括号对象并取**最后**一个合法结论（模板回显不再丢票）；rubric dim6 在无 `resourcePaths` 时按「未验证」给中性分；评审通道 job 补 30 分钟兜底 TTL。
- **视图与前端**：`q4Limit` 真正生效；周报不再把 PMO 自动决策算作 Human 介入；`findReportPath` 支持正斜杠与带空格/引号路径；`g` 前缀快捷键恢复；Thread 冲突检测改读 `headSeq` 并在发送后推进基线；`loadPending` 失败不再伪装成「没有待验收」；`loadRisks` 不再借用 people 的加载态；SSE 断流首次可见提示。
- 测试：`node --test` **193/193**（+9：`judge-parse` 5、`weekly-report-path` 2、`ledger` 2）。

## 0.4.25 - 2026-11-12

**全量代码审计收口：17 条 HIGH 全部修复**

- **成员回合永久 `blocked` 的根因（R6）**：`archived-session-gate` 会沿 subagent 血缘上溯，而旧版为隐藏会话把 Team Host **归档**——所有成员都是它的子会话，于是每回合在发出模型请求前被拒（实测 453 blocked / 0 completed）。`lib/runtime/host-agent.js` 不再归档 host；新增 `lib/runtime/host-repair.js` 在 boot 与 `ensureParent` 时把 host 及成员 `parentSession` 解归档。
- **`team` 首回合不可见**：可见性原按「请求者是否已知成员」判定，而成员 `sessionId` 在 `activate()` 返回后才写入 → 首个 model step 恒缺 `team`（43→44 工具）。改为 `when: () => booted !== null`，非成员仍由工具自身 `E_NOT_MEMBER` 拒绝。
- **SkillOpt 越权面**：新增 `lib/skillopt/tool-access.js`——`run/adopt/schedule/unschedule/optimize/jobs/judge` 只允许 Team 成员或 Human 面对根会话，一次性子代理调用一律拒绝。
- **SkillOpt 落盘链**：`apply-candidate` 先落 job 再改 live；keep/revert 落盘前比对 sha（冲突则 `failed`）+ 备份 + `tmp+rename` 原子替换；`results.tsv` 增 `proposal_sha` 列，adopt 门的 keep 必须绑定本次候选。
- **评审票序**：每票带 `orderId`，按 id 归票、去重、票数 ≤ 请求数；乱序/重复回帖不再移位或反转 keep/revert。
- **waker**：`task/created` 按 `payload.taskId` 回投影取任务（原读不存在的 `payload.task`，该路径永不唤醒）；去重键追加成员与 Project 作用域。
- **其他**：项目归档同步写 registry；冷唤醒只 resume 一次并由 resumed agent 投递（不再二次冷恢复导致 `NOT_RESUMABLE` 丢历史）；自愈判据改用结构化错误码；`turn/end` 的 `blocked`/`error` 不再静默丢弃；`taskCard` 补 `submission`/`completedAt`/`acceptedBy`。
- 测试：`node --test` **180/180**（新增 `tool-access`、`host-repair`、`review-votes` 三套）。
- 审计报告：`docs/审计报告-2026-11-12-全量代码审计.md`。

## 0.3.90 - 2026-11-12

**Darwin Phase 2 自动 hill-climbing 循环（`skillopt_optimize`）**

- 每轮：rubric 诊断最大加权短板 → 独立生成器产出候选（子代理，仅改该维度）→ 写入 → paired 独立 judge 多数决 → keep 保留 / revert 回滚 → results.tsv 追加。
- 约束：单维改动、150% 体积上限、连续 2 轮 margin 全 slight/tie 触顶 break（HL-4 见好就收）、judge 不可用即回滚（未验证改动绝不保留）。
- 版本化双模式：项目是**干净 git 仓库**时 commit/revert（新提交回滚，不用 reset --hard）；否则 `.skillopt-sleep/backups/*.bak` 文件备份恢复。
- 结果记录 `<project>/.skillopt-sleep/results.tsv`（9 列，与 darwin 格式一致）；keep/revert 记 `eval_mode=paired`。
- 测试：`test/skillopt-optimize.test.js` 9 项（短板诊断与平局、plateau 判据、候选校验、keep/revert/跳过/回滚/触顶、TSV 9 列）。


## 0.3.89 - 2026-11-12

**完全对齐 darwin-skill v2.1（9 维 rubric + 独立 judge）**

- **9 维 rubric（`skillopt_rubric`）**：结构 59（Frontmatter 7 / 工作流 12 / 失败模式 12 / 检查点 6 / 具体性 18 / 资源 4）+ 效果 35（架构 12 / 实测 23）+ Meta 6（反例黑名单）——静态启发式评分带逐维证据；**绝对总分明确标注 TRIAGE-ONLY**（绝不作 keep/revert 依据），dim8 未实测时标注 dry-run。
- **独立 judge（`skillopt_judge`）**：paired 同-judge 比较 + A/B 随机化盲评 + 奇数 N（默认 3，可配 `skilloptJudgeVotes`）多数决（better≥worse→keep，含 tie；无有效票→inconclusive 不得 adopt）；judge 是**一次性独立子代理**（`subagents.startActivation`），上下文干净，杜绝自评自改。
- **adopt 验证门**：`skillopt_adopt` 经 `wrapToolsWithAdoptGate` 包装——先读 staged 候选与 live 基线，跑独立 judge；revert/inconclusive/无法验证时**拒绝 adopt** 并给出理由（unverified adopt is refused），keep 才放行引擎。
- **根因修复**：插件 `inject` 增加 `tools`/`shell`——此前 shell 服务未就绪时 SkillOpt 整段静默跳过（diag 实测 `hasShell:false`）；judge 的 `ensureParent` 改惰性引用（修复 TDZ `Cannot access before initialization`）。
- **工具输出协议修复**：`skillopt_rubric`/`skillopt_judge` 的 render 返回 content 数组（此前 `content.some is not a function`）。
- 测试：`test/darwin-alignment.test.js` 10 项（rubric 强弱对照/权重和 100、A/B 盲评与解析、多数决与平局、judge-runner 子代理注入、adopt 门 keep/revert/inconclusive/无法验证、只拦 adopt 不动其他工具）。


## 0.3.86 - 2026-11-12

- **技能进化链路可观测性**：health 新增 `runtime.services`（tools.register / shell / 已注册的 skillopt_* 工具清单）；SkillOpt 注册条件不满足时记 `skillopt.skip.fail` 诊断——消除「静默未启用」的排查盲区（此前只能靠 diag 猜）。
- 实证：本机 7 个 skillopt 工具全部注册、Python 3.11 引擎可运行（`status` 实跑 `nights so far: 0`）；技能进化链路**已就绪但从未运行**（默认 mock backend 为安全默认）。


## 0.3.84 - 2026-11-12

- **旧会话自动迁移（review 修复）**：唤醒失败且错误表明 subagent 不可用时（旧形态成员会话由 agents.create 创建、不在 subagent catalog），自动以 subagent 形态重建一次（重置会话）并记录 member.autoreseat 诊断——避免成员在重构后静默不再被唤醒，用户无需手动迁移。


## 0.3.83 - 2026-11-12

- **人员池模型下拉 [object Object] 修复**：modelCatalog 的 providers[].models 元素是 {id,name} 对象，P2 之前按字符串拼接。改为按 {id,name} 取值，并用索引映射代替字符串拆解（模型显示名可能含分隔符）。
- 渲染 E2E：bootstrap fixture 的 models 改为真实 {id,name} 形状；新增 **[object Object] 守卫**（任何对象被当字符串拼进 UI 文本即失败）——同类数据形状错误今后提交前被拦截。


## 0.3.82 - 2026-11-12

- **成员会话形态修正（取代 0.3.78–0.3.81 的 header 门方案）**：成员改回由 DSH **子智能体**管理（subagents.startActivation，label/cwd/parent/delivery）——成员会话登记 subagent catalog，从 DSH「管理的子智能体」面板进入即可直接对话、**保留上下文**（宿主父→子投递），且不再出现在工作区会话列表（与真实 subagent 一致）。
- **移除 project.chatGate 特性**（命令/fold/服务门/bootstrap 字段/client 按钮与文案/自动重建收敛/chat-gate-sync 模块与测试）——对话入口即宿主子智能体面板，无需门控，也不再以「重建会话」为代价。
- 私信保留为插件侧写入同一会话的通道（无条件可用）；routingHint 改为指引「从管理的子智能体面板对话」。
- 契约测试 	est/member-activation.test.js（激活/唤醒路径）；历史成员会话需一次「重置会话」以 subagent 形态重建。


## 0.3.81 - 2026-11-12

- **官方资料合规评审复核**：评审代理的 7 medium / 6 low 逐条对照当前源码复核——locale 覆盖、硬编码文案、SSE 清空草稿、模态 Escape/焦点陷阱、toast 字面色、grid 第三列（实为 absolute 浮层）、SSE 诊断、prj_main 兜底**均不成立或已修**（多数为评审后已被后续修复覆盖，二手材料必须核实的实例）；唯一可执行项（index.js 未使用常量 PROJECT_ID）已删除。结论归档 docs/15。


## 0.3.80 - 2026-11-12

- **chatGate 自动收敛（UX 一致性修正）**：开关切换不再要求手动「重置会话」——PMO 巡检对**空闲**成员自动重建会话（每轮最多 2 个，约 1 分钟内收敛；忙碌成员等回合结束再应用，绝不打断进行中的工作）；boot 时以账本当前值初始化，避免重启即全体重建。命令返回 note 如实说明「自动生效 + 会话记忆会重置」。
- planChatGateReseats 纯函数（可选重建计划）+ 3 项测试（idle/busy/cold/retired/limit）。


## 0.3.79 - 2026-11-12

- **Human 直聊门接入项目开关**：成员会话 header 的 parentSession 现在由项目 chatGate 决定——open（默认）不带 parentSession（宿主放行 Human 在 DSH 主界面直接输入）；closed 带 parentSession（宿主按 subagent-owned 拒绝）。门只对新建/重建会话生效（header 不可变），切换开关时命令返回明确说明（已有成员需「重置会话」）。2 项映射测试（open/closed 两种 header 断言）。


## 0.3.78 - 2026-11-12

- **【关键】成员会话对 Human 只读的根因修复**：宿主 hasApiSessionSubagentOwner 除 origin=subagent 外，对「header 带 parentSession 且 parent 拥有该 agent」的会话同样判定为 subagent-owned 并拒绝 Human 输入。插件 direct 模式创建成员会话时恰好设置了 meta.parentSession，导致所有成员会话被拒。现移除该 header 字段（驱动改用 agents.resume 的 parentAgent，不依赖 header）——新激活/重置后的成员会话可在 DSH 主界面直接输入。
- 已存在成员需执行一次「重置会话」（reseat）使新 header 生效。


## 0.3.77 - 2026-11-12

- **Human 对话入口直达**：主对话流成员消息头新增「私信」按钮（此前需点名字→资料面板→私信三步）；私信直达该成员会话写入通道。
- **routingHint 文案讲清语义**：原生会话直写被宿主拒绝（非开关问题）；私信输入即写入成员会话（与团队指令同一通道），成员下一轮在同一会话可见并回复——对应用户实证的 session/agent-busy 困惑。


## 0.3.76 - 2026-11-12

- **【致命 UI】项目头按钮嵌套修复（用户实证，0.3.70 遗留）**：Human 对话按钮的闭合括号被挪到行末，三个后续按钮成为它的 children（HTML 禁止 button 嵌套，表现为一个大按钮框住全部）。修正闭合位置。渲染 E2E 新增 **nested-button 守卫**（红绿验证：还原 bug 时精确报错），此类结构错误今后提交前即被拦截。


## 0.3.75 - 2026-11-12

- **P17 人员池同人绑定 UI 恢复**：人员池头部「同人绑定」表单（源名 → 目标人 → 绑定，POST /ai-team/api/people-aliases），跨项目身份合并可配置（host 路由此前已就绪，UI 在历史回退中丢失）。
- **P5a 取证定论**：direct-subagent address 经源码取证为**读取**子代理会话日志/历史投影的地址通路（kind:subagent 用 childSessionId 校验），非 Human 输入投递通路——原生直聊为宿主硬边界，最终确认不可达；等效通道为私信直通。
- 渲染 E2E #310 守卫在本次施工中实际拦截了两处新引入的 early-return 后 hooks（已改到 state 区）。


## 0.3.74 - 2026-11-12

- **P2 人员池统一模型配置**：人员池行级「统一配置模型」入口——选 LLM 端点后对该成员在**所有项目**逐个 member.config.update（跨项目批量），免去逐项目×逐成员修改（NO_ADAPTER / max_tokens 超限场景的根治入口）。
- **P5b 工作目录存在性校验**：project.workspace.update 校验目录真实存在且为目录（配置不存在的目录会让成员会话 cwd 无效、回合全失败——用户实证 working-directory does not exist）。
- 回归测试：+2 host 级断言（不存在目录 → 409；最后 active 项目归档 → 409）。


## 0.3.73 - 2026-11-11

- **项目头开关失效修复**：bootstrap 的 projects[] 在 registry 重映射时丢弃了 chatGate/runState（按钮状态永远默认「开」，点击后 UI 不更新）；归档 409 修复：归档保护在 service 内判定（只见自己账本，恒为最后项目）→ 移到 Host 路由层用 registry 全局清单判定。


﻿# Changelog

## 0.3.72 - 2026-11-11

- 项目头按钮栏布局修复：路径独占一行、按钮行自动换行并紧凑化（6 控件溢出错位，用户截图实证）。

## 0.3.71 — 2026-11-11

- **【致命】工作台 #310 崩溃修复（用户实证）**：批量取消的忙碌标志 useState 被放在了 Workbench 的 Skeleton early-return **之后**——loading→ready 重渲染时 hooks 数量增多，触发 React #310 白屏。移到 early-return 之前的 state 区。渲染 E2E 的 React mock 同步加 **#310 守卫**：同一组件跨渲染 hooks 数量增多立即抛错（并在 0.3.69 类改动合入前即拦截）。

## 0.3.70 — 2026-11-11

- **项目全局掌控：启动 / 停止 / 交接**（用户需求）：新命令 `project.runState`（Human-only，账本留痕）——**停止**：PMO tick 与事件唤醒双门停止一切派发（正在执行的子任务自然完成，私信仍可）；**启动**：空项目显式启动解除 P1a 等待门（Human 点启动即指令）或停止的项目继续开工（下一 tick ≤60s 生效）。新命令 `project.handoff`：按时序生成**交接文档**（Human 指令时序 + 任务全量状态/证据/QA + Thread 摘要 + 接手提示）写入工作目录 `docs/HANDOFF-<时间戳>.md`，账本留痕路径。项目头新增「项目运行 · 开/停止中」与「生成交接文档」按钮（chatGate/archive 旁）。bootstrap 下发 runState。

## 0.3.69 — 2026-11-11

用户实证问题批（docs/phase1-2026-11-10/15-问题清单）：

- **空项目不再被 PMO 自动开工**：`pmo/continue` 加门——从未有过任务的项目等待 Human 首条指令（新装用户配置目录后不再被自动建卡）；
- **批量取消**：「团队动态」分区新增「取消全部待处理（n）」按钮（逐卡 task.cancel + 成功/失败汇总），免去逐卡点开；
- **会话标题加项目前缀**：`【项目名】成员名（角色）`——多项目同名成员在 DSH 侧栏可区分；
- **项目归档（软删）**：新命令 `project.archive`（Human-only，账本留痕）+ 项目头「归档项目」按钮：bootstrap 过滤 archived 项目，成员 DSH 会话不受影响；最后一个 active 项目不可归档；
- 问题清单与 P2（人员池批量模型配置）/P5（direct-subagent 取证）计划见 docs/phase1-2026-11-10/15。

## 0.3.68 — 2026-11-11

- **【致命】取消任务对话框卡死修复（用户实证三连）**：①根因是 `WorkbenchDialog` 挂载处**漏传 `onDismiss` prop**——settle/cancel 调用 `onDismiss()` 抛 TypeError，`setDialog(null)` 永不执行，对话框永久驻留无法关闭；②「确定没反应」实为 resolve 已执行（任务在后台真实取消）但关框崩溃吞掉了全部反馈；③「理由可留空」的提示与确定按钮禁用矛盾，且 host 域层 `cancelTask/reopenTask` 的 `requireText(reason)` 也强制必填——三层各自为政。现修复：挂载处显式传 `onDismiss: () => setDialog(null)`；settle 先关框后 resolve（后续异步不再阻断）；对话框新增 `optional` 语义（理由类输入允许留空）；domain 层 cancel/reopen 理由改 `optionalText`（留空记空串，超长边界保留）。新增 cancel/reason 链路测试 2 项（138 总）。

## 0.3.67 — 2026-11-11

- review 整改：PMO tick 的 prune 数组补入 `pmoLastDispatch`——补派节流时钟的任务条目在离开 active 集后随其余四个时钟一并清理，消除慢性 Map 增长（与 0.3.57 同类问题的复发面闭合）。

## 0.3.66 — 2026-11-11

- **pending 快速补派（用户实证的开工等待问题）**：取证发现 task/created 的事件唤醒可能在责任位正忙时被投递语义吞掉，而账本没有「回合结束/空闲」事件（member.status 只有 running/failed 写点，idle 一直是 bootstrap 显示兜底）——pending 卡的第二次提示要等 10 分钟心跳、30 分钟停滞，这正是「待处理等很久不开工」的根源。现 PMO 60s tick 增加状态检查兜底：pending 且责任位**非 running** → 立即 `pmo/dispatch` 补派（每分钟最多一次，bucket 参与 dedupe key），开工等待从最长 10 分钟压到一个 tick；prompt 明确「认领推进，不再负责则 reassign 交还」。in_progress/done 不补派；retired/failed 不唤醒。waker 分支 3 项新测试（136 总）。

## 0.3.65 — 2026-11-11

- **Human↔成员对话门（项目级开关）**：成员的原生会话由团队路由驱动，宿主守卫（`session/agent-busy`）拒绝直接输入——这是宿主核心行为且无配置面。插件以产品通道补齐体验：
  - 新命令 `project.chatGate`（Human-only，账本留痕 `project/chat-gate`）切换项目级对话门：**开（默认）**= 资料面板私信直通成员下一轮（waker prompt 注入，等价原生对话效果）；**关**= 私信通道停用，`member.message` 被正常人话拒绝（不产生事件、不唤醒成员）；
  - 项目头新增「Human 对话 · 开/关」切换按钮（与 PMO 开关同款交互）；
  - 成员资料私信区新增**常驻路由说明**（解释原生直聊被拒的原因、指引走私信），关门时输入框禁用 + 正常提示（替代宿主黑 toast 的报错体验）；
  - bootstrap 下发 `chatGate`（默认 open，旧账本向后兼容，不升 stateVersion）。
  - 测试：gate 门禁/留痕/Human-only/非法值/bootstrap 下发共 2 项新测试（133 总）。

## 0.3.64 — 2026-11-11

- **风险清单失败行去刷屏（根治）**：0.3.63 的 240 字符行内截断在真实 tool-call 错误串下仍占据整卡（用户截图实证）。改为行内**只渲染人话分类**（如「未知失败」），完整技术原文移入 hover title（点「成员资料」看成员详情）；管理视图的信息密度回归「一屏可扫读」。渲染 E2E 同步加防刷屏断言：任何 UI children 字符串不得超过 200 字符——超长诊断原文只允许走 title 属性，此类回归今后提交前即被拦截。

## 0.3.63 — 2026-11-11

- 修复风险清单「失败」永挂：成员恢复后 `member/recovered` 此前不清 `lastFailure`，一次瞬时 tool/LLM 失败会永远钉在 Human 的风险清单；fold 恢复即清除 + 风险视图对旧账本防御（failure 早于 lastRecoveredAt 不计）；
- 失败消息入库截断 400 字符（3KB tool dump 不再轰击账本与 UI）；前端风险行截断 240 + hover 全文；
- 实测案例：玄策 10:30 的 edit 参数 JSON 截断，08:26 已恢复三连，风险清单仍挂昨日原文——本版本后此类瞬态失败自动出局。

## 0.3.62 — 2026-11-11

- **【致命】工作台渲染崩溃修复**：主对话流 `StreamMessage` 调用处的 `onOpenProfile` 简写属性引用了 Workbench 作用域中不存在的标识符（正确目标是 `openProfile` 函数），首次渲染即抛 `ReferenceError: onOpenProfile is not defined` 使整个工作台白屏。改为显式 `onOpenProfile: openProfile`（与 MemberView 调用点一致）。`node --check` 对简写属性语法不报错，静态检查存在盲区；
- **新增无头渲染 E2E**（[test/client.render.test.js](test/client.render.test.js)）：行为级 React mock（hooks 游标模拟调用顺序、createElement 即时求值函数组件、class 组件走 render()、mount-effect 去重）驱动完整工作台树求值（loading → bootstrap 数据 → 消息流/任务卡/团队脉搏），断言全程无引用错误；红绿闭环验证：重新引入本 bug 时测试精确复现 `ReferenceError: onOpenProfile is not defined`。此类渲染期裸引用错误今后在提交前即被拦截。

## 0.3.61 — 2026-11-11

- 修复验收死锁放大器：`pending_acceptance` 的 review 催办分支 `continue` 会跳过 60 分钟升级，QA 每 10 分钟被叫、Thread 裁定的执行手永不唤醒；现在验收滞留 ≥60 分钟同样触发 escalate（配合 085085d 同时唤醒 Project owner）。

## 0.3.60 — 2026-11-11

执行计划第二批（管理视角算法与账本工具面，docs/phase1-2026-11-10/12-详细执行计划 T-201~T-210 部分）：

- **R-07 风险清单投影**：`riskView`（受阻任务/失败成员/待决超时三类，纯函数零新事件）+ `GET /ai-team/api/risks`，4 项单测；
- **R-09 待验收跨项目队列**：`GET /ai-team/api/pending-acceptance` 聚合路由 + 收件箱页「等你验收」分区（行级跳转任务，irreversible 徽章标注）；
- **R-10 成员负载**：`people-view` 扩展 inProgress/pendingAcceptance/pending/blocked 计数（owner/assignee 双责任位），人员池行内徽章展示；
- **R-11 项目周报双解读**：`weeklyView` 纯投影（正向=完成清单/一次通过；负向=返工清单/Human 介入）+ `GET /projects/:id/weekly`；
- **R-15 账本工具面**：`lib/ledger/tools.js`（audit/stats/export 自包含导出包）+ `bin/ledger-tools.mjs` CLI（独立进程校验 hash 链，篡改账本 exit 非零有测试）；不做 gc/压缩（D1 裁定 append-only 即历史不可变）；
- **R-17 person 别名键**：`aggregatePeople` 可选别名桶（`people-aliases.json` 视图层绑定）+ `POST /api/people-aliases`；
- **R-18 任务事件历史**：`GET /projects/:id/tasks/:taskId/events` 只读路由 + 任务详情「任务事件历史」折叠（seq/type/时间/actor 后缀人话行）；
- **R-04 补充**：任务卡 irreversible「不可撤回」徽章（看板/卡片视图）；
- **R-13 收件箱老化**：决策项 >24h warn 左缘条、>72h error 左缘条（纯前端派生）。

## 0.3.59 — 2026-11-10

执行计划第一批（P0 八条）落实（docs/phase1-2026-11-10/12-详细执行计划 T-101~T-108）：

- **R-01 onboarding 三步**：空项目主对话内嵌「设目录 → 认识成员 → 第一句话」步骤清单（完成态打勾、示例句点击即填、设目录直达按钮），替代裸空态；
- **R-02 权限可见性**：成员资料常驻「完全权限 @ `<工作目录>`」徽章 + 人话解释；加成员表单同步说明（把守卫背后的事实亮给用户）；
- **R-03 找一个人入口统一**：左栏成员行点击、主对话消息头成员名、人员池行内「资料/私信」三个入口统一打开成员面板；私信仍落原生 session；
- **R-04 失败与停滞人话化**：失败 category 映射为用户语言（billing→余额不足 等 9 类），收件箱/人员池统一渲染；态势页顶部增加团队状态语（安静=健康 / 推进中 / 需要你处理），「合法空闲」与「停滞」可区分；composer 无目录只限任务模式，讨论彻底放行；
- **R-05 人员池刷新**：页头刷新按钮 + 驻留时 SSE 变化自动重拉（事件驱动、无定时器），序号守卫防乱序；
- **R-06 决策回流**：决策表单加可选补充说明（随 answer 写入 Thread 与决策存档）；已读决策加「看项目进展」——切项目、主对话定位决策之后的首条团队消息并左缘高亮（不滚动，遵守规格 #6）；
- **R-07 风险清单 V1**：新投影 `riskView`（受阻任务/失败成员/待决超时三类，纯函数零新事件）+ `GET /ai-team/api/risks`；收件箱页顶部关联分区展示（行级跳转：受阻任务、失败成员资料、超时决策），4 项单测；
- **R-08 快捷键体系**：`g i/b/p/c` 前缀导航、`/` 聚焦 composer、`?` 帮助浮层；输入焦点与模态栈旁路，渐进增强。

## 0.3.58 — 2026-11-10

复审轮（对照官方资料复查前三轮整改引入的代码 + 全文角落），两份并行复审报告的发现全部整改：

- **修复类**
  - 【高危·实证复现】checkpoint 竞态：写队列只串行化批次本身，B 批次可在 A 的 facade 续体推进 state 之前提交——旧实现按 `writer.head` 落盘会持久化"state 落后于 lastSeq"的检查点，崩溃重开零尾放**静默吞掉投影**。改为按 fold 已应用前缀水位（`state.lastSeq/lastHash`）落盘，重开尾放从水位+1 自洽重放；新增并发批间触发 + 崩溃重开回归测试（[test/checkpoint-race.test.js](test/checkpoint-race.test.js)）。
  - 【致命】客户端两处本轮回归：`inPeople` 在声明前引用（TDZ，工作台每次渲染崩溃）；`WorkbenchDialog` resolve 后不复位 state（确认/输入对话框永久驻留挡住整页）。均已修，并补 confirm 按钮初始焦点、三模式统一 Enter 提交。
  - `resumedHandles` Set→Map 后 teardown 迭代漏改（冷唤醒成员句柄卸载时从不 dispose）——改 `values()`。
  - 「人员池」loading 态误用整页 Skeleton（中心列嵌套出第二个工作台）——改中心区域行骨架；人员池拉取加序号守卫；打开项目失败给提示；收件箱跳任务在切项目失败时中止。
  - wake 链路 `projectCwd` 的账本目录兜底**彻底移除**（`projectWorkspace` 显式取项目目录）：无目录项目不 wake（`wake.skip` 留痕），activate 不 fail-open——同时给出历史游离会话（如 mem_lead 的 e7575995）的正规重建入口「重置会话」（先释放旧句柄再在工作目录重建；workspace 校验先于句柄释放）。
  - `failure-policy`：fallback 判定提前于重试预算（maxAttempts=1 时备用路由不再永远不可达）；`waker` 对 failed 成员不自动唤醒（恢复走 member.retry / Human 重试，注释声明）；`postStream` 返回的 seq 改用账本事件 seq（原幻影计数并发下与投影不一致）；bootstrap 的 selected thread 与 threads 同一 50 条窗口（`entryTotal`）；'h1' 幽灵兜底 id 三处清为 `humanId()`。
- **规程类**
  - diag 契约闭合：dispatch 前置校验失败也落 `dispatch.fail`；HTTP 层失败统一落 `route.reject`（errors 白名单不再是死键）；activate 拒绝/重建落 `activate.reject`/`member.reseat`；`activateProject` 透传 diag（自建项目的 ledger.open/checkpoint/repair 行不再缺失）。
  - skillopt adopt 归因门补 `.latest` 指针的 manifest 校验（残指针按扫描回退，报因准确）。
  - people-view 空名成员按 id 独立成行；failures 字段语义文档化（展示口径）。
  - 客户端死键再清 5×2（agents/boardAria/projectEmptyBody/actHandoff/teamPulseCount）；CSS 清理（.at-check 同名覆盖改 `.at-modal .at-check` 作用域、.at-withthread 死选择器×3、.at-composerbox 死类名、冗余断点行）。

## 0.3.57 — 2026-11-10

管理视角信息架构（docs/11）：先把边界事实核清楚，再按"事按项目、人与待决按全局"调整呈现，不新增领域数据。

- **边界核实（取证结论，写进 docs/11 §1）**：看板/态势/主对话/Thread/项目成员**本来就是按项目**（每 Project 一个账本与 runtime）；"全局"的观感来自呈现错位——左栏首项叫「项目总览」却只是回主对话、AGENTS 区无归属标注、收件箱是跨项目聚合。
- **人员池（全局层，新增）**：`GET /ai-team/api/people`（纯函数 `aggregatePeople` 复用各项目账本投影，按姓名聚合同人跨项目身份/状态/失败/活跃任务数）+ 左栏「人员」入口 + 人员总览页（人员卡展开"项目×状态"，可一键跳转项目）。一个 agent 兼顾 N 个项目 = N 行项目身份，聚合在一屏管理（数据结构原本就支持：每项目账本各绑一条 sessionId）。
- **呈现修正**：左栏首项更名「对话」（消除名实错位）；AGENTS 区标注「本项目成员」。
- **无目录轻入口**：项目可不带工作目录创建（稍后设置）；讨论与建卡不再被目录拦截（原实现连讨论都发不出）；需要成员执行时 Host `member.activate` fail-closed 返回 `E_WORKSPACE_REQUIRED`——修掉 `projectCwd` 的账本目录兜底会让人agent 在插件数据目录里干活的隐患，cwd 显式取项目工作目录；客户端任务模式无目录时提示并一键打开目录设置。

## 0.3.56 — 2026-11-10

遗留项跟进轮：五项未整改全部落地（论证 / 评估补优 / 弥补 / 一手证据改进 / 规模化优化）。

- **checkpoint 接线（论证后落地）**：`openLedger` 新增 `checkpoint` 选项并接入 395 行既有 checkpoint 模块（此前为生产死代码）。实证（`.ptc/tools/bench-checkpoint.mjs`，2 万事件合成账本）：boot 从 493ms 降到 205ms（**-58%**）；5 万事件 1147ms → 522ms（-54%）；checkpoint 体积恒定 210KB。检查点齐平时跳过全量 readAll（账本事件列表惰性化，不再随事件数常驻内存），尾部存在时一次读盘续放投影。保存节奏：boot 落地板 + 每 500 次追加 + close 前必落（防抖下限 50）；primary 损坏回退 backup，再退全量重放；保存失败可见告警且绝不影响追加。`ProjectRuntime.open` 默认启用；`ledger.recovery` 暴露恢复方式供诊断。
- **投影封顶（长迭代不膨胀）**：`state.stream` 封顶最近 500 条（新增 `streamTotal` 精确计数）、每个 Thread entries 封顶最近 500 条（headSeq 保持单调精确）；`FOLD_STATE_VERSION` 升到 2。完整历史仍在账本事件里可重放。bootstrap 进一步按窗口切尾（stream 200、每线程 50，带 `entryTotal`）。
- **SSE 合帧**：同一 Project 250ms 窗口内的多条账本事件合并为一次快照帧（原来每条事件全量重算 board+quadrants 并整帧广播是平方级放大）；帧内 event 取窗口末条，客户端 rev 守卫幂等。
- **右栏改为全宽度覆盖层**（评估后优化）：原宽容器为第三网格列（384px），开/关线程面板会挤压中栏并整栏重排，违反全局规格 #6「板块展开不得改变阅读状态」；统一为 absolute 覆盖（窄容器既有行为），任意宽度零重排，窄档视觉不变。
- **原生 prompt/confirm 全部替换**为自绘 `WorkbenchDialog`（复用 ModalBack：Escape 关闭 + Tab 焦点圈闭）：离开团队、改派（下拉选择）、取消理由、重开理由、删除确认共 5 处；观感与宿主一致。
- **skillopt_adopt 归因门（一手证据）**：引擎每轮 run 把验证所用 backend 写进 `staging/<ts>/diagnostics.json`（cycle.py）；adopt 执行前读取并 fail-closed——mock 验证的提案拒绝落地（分数是合成信号）、diagnostics 缺失或无 backend 字段同样拒绝并指引重跑。真实后端放行。`adoptGuardVerdict` 可导出测试，新增 5 项单测。

## 0.3.55 — 2026-11-10

按 DSH 官方插件开发资料（cordis-plugin-development / practices / 各包 README）做全量插件实现 review 后的整改：

- **修复类（行为变化）**
  - 「转为 Task」从本地假动作接通真实账本：右栏 Thread → `task.convert`（sourceEventIds=Thread 条目事件 id），冲突时自动跳转已存在的 Task；移除嵌入的 MOCK 演示数据与 fallback 假反馈，bootstrap 不可达时显示诚实的错误态 + 重试（同能力不再并存简化实现）；
  - LLM 失败治理语义修正：rate_limit 无 fallback 时不再同路由即时重试烧预算（终态留给下次唤醒）；fallback 补丁写账本后本轮即结束（活体步骤拿不到新路由，原实现仍重试已失败模型）；补丁/恢复/故障记录失败不再静默；
  - `member.distill` 的蒸馏约束从无效的顶层 `system` 字段改为 system 角色消息（GenerateOptions 无该字段，原约束被静默丢弃）；
  - retired 成员三条"复活"通道封死：member.bind / member.retry 命令层守卫 + fold 对 session-bound / retry-requested / recovered 的投影防御（retired 必须走 member.rejoin）；
  - dispatch 校验 agent actor 必须存在于成员表且未退役，QA 门对查不到的 reviewer 改为 fail-closed；
  - 客户端 '你' 字面判定改结构化 ownerId/kind（宿主 taskCard/bootstrap 增加 ownerId）；刷新不再覆盖正在编辑的表单与 QA 勾选；bootstrap 并发响应按序守卫；宽/窄容器行为不变；
  - skill provider 对齐 dsh-skill-filesystem 官方语义：`disable-model-invocation`/`user-invocable` 宽松布尔解析（非法拼写整技能丢弃）、description 必填、官方 rank（project 100/200、user 400、bundled 600）、支持平铺 `<name>.md`；
  - wake 冷恢复产生的 AgentHandle 纳入插件自有清理（teardown 不再遗留成员激活）；wakeKeys 改 seq 水位窗口淘汰，pmo 时钟表随任务失活修剪；系统事件 projectId 由调用方传入（多项目不再错挂 keys[0]）；projects.json 损坏时保留现场文件再回退默认；writer 跨段前对旧段 fsync、批内查重不再全量拷贝；fold stream/thread 有序追加替代全量排序；
  - `member-tools` 补声明 askHuman 一直在读的 `title` 参数（原 schema 无此字段且 additionalProperties:false，标题永远传不进来）。
- **规程符合类**
  - 新增 `lib/diaglog.js`（off/errors/full 三档，发布默认 errors）+ Config 面（diagLevel/diagLogDir/diagLogMaxBytes/skilloptBackend/skilloptTimeoutMs）；dispatch 入口/失败/耗时、wake、PMO 自动决策、member 故障与恢复、boot、ledger 修复全部有埋点；
  - skill provider 注册位置与 rank 对齐官方（bundled 最后，用户目录压过随包副本）；
  - 插件显示元数据补齐 `locale/en.json` + `locale/zh.json`（meta.title/description）并导出；
  - `/ai-team/api/skills-debug` 调试端点改由 `DSH_AI_TEAM_TEST=1` 门控；
  - 客户端 locale 死键/演示残留键清理，四处模态补 Escape 关闭与 Tab 焦点圈闭，toast 计时器随组件卸载清理。

## 0.3.54 — 2026-11-10

- 默认花名册扩到 6 名 Agent：新增 **知微（UX 设计）**——以用户体验为第一核心研究目标 UI/UE；**观澜（业务）**——从运营/用户视角洞察真实需求并提出 UX 改进意见；
- 既有项目自动补齐缺失的核心角色（同角色已存在则不重复添加，自定义花名册不被覆盖）；
- PMO 会议（pmo/continue）从只唤醒 owner 改为**带上所有 Agent 成员**：owner 主持，其余成员以 pmo_meeting 参会并从专业视角在 Thread 发言。

## 0.3.53 — 2026-11-10

修复全新环境安装三连问题（严重）：

- **`{{model}}` 无值**：成员/宿主 session 只把 provider/model 挂在活体 Agent options 上；进程重启后恢复的 session 两者皆无，prompt 渲染失败。现在 activation/wake/boot 都会把 `model/selection` 写入 session 日志，路由跨重启持久有效；
- **插件开关破坏宿主**：卸载清理此前是 fire-and-forget，旧组合未清理完新组合已激活。现在 disposer 完全等待宿主/激活/账本清理收尾，且绝不抛错；
- **首次安装即坏**：`boot()` 同步异常或 skill provider/team tool 注册异常会让组合激活失败。现在全部降级为警告，插件激活永不失败。

## 0.3.52 — 2026-11-10

- bootstrap 返回全部 Task 的 Thread 映射，修复卡片显示 6 条回复但右栏打开为空的错位；
- 右栏标题改为「任务记录」，新增可展开的任务详情（结果定义、QA 进度、更新时间）；
- 右栏「Agent 会话」直接打开该 Agent 的 DSH session，完整上下文不再在插件里重复；
- 左栏返回标签由「对话」改为「项目总览」，避免与任务 Thread 混淆。

## 0.3.51 — 2026-11-10

- 唤醒后再同步一次 session 标题：cold session 在唤醒前无法 rename，唤醒变 live 后补同步；
- 避免 QA/闲置 Agent 长期保留旧任务标题。

## 0.3.50 — 2026-11-10

- PMO 自动决策覆盖无结构化问题的 `decision_required`：按当前 Task/Thread 最高价值路径推进并 ack，不再留 unread；
- 收件箱不再因为 Agent 只发 decision_required、不带 questions 而卡住。

## 0.3.49 — 2026-11-10

- PMO 每分钟同步 agent session 标题为 `Agent（角色）`，覆盖历史任务标题；
- 标题已是目标值时不再写 title 事件，避免重复日志。

## 0.3.48 — 2026-11-10

- 改回“一个 Agent 一个持久 session”：新 Task 复用原 session，不再每任务新开；
- session 标题固定为 `Agent（角色）`，任务名只留在 Task/Thread，不再随任务改名；
- 首次 activation 发送身份/个性/核心 skill，后续 wake 只发 Task 增量与任务边界；
- 修复 identity / skill catalog / core skill 在每次任务提示词中重复的问题；
- 任务边界提示要求先读 Task/Thread，避免跨任务上下文污染。

## 0.3.47 — 2026-11-10

- 修复 PMO review nudge 使用 `member.qa` 判断、真实账本 QA 成员用 role 表示导致永远不唤醒白砚的问题；
- 改为统一使用 `isQaMember`，并补 role=验收 的测试。

## 0.3.46 — 2026-11-10

- 验收催办时钟改用 Task 提交时间，assignee 在 Thread 继续发言不会再掩盖 QA 静默；
- 修复 Task 长期 pending_acceptance 但 QA 未收到催办的问题。

## 0.3.45 — 2026-11-10

- PMO 新增验收催办：QA Task 进入 pending_acceptance 超过 10 分钟仍无验收时，自动唤醒所有 QA 成员，要求独立复跑并验收/退回；
- 覆盖“执行者已提交、QA 静默”的卡点，不把验收推回 Human。

## 0.3.44 — 2026-11-10

- PMO 新增 60 分钟升级：Task 超过 60 分钟仍未完成时唤醒 owner，要求评估拆分/补人/缩小范围/重定验收，不只催进度；
- 升级与 10 分钟 heartbeat、30 分钟 stall 分离，全部由插件算法执行。

## 0.3.43 — 2026-11-10

- PMO 进度判断使用 Task 最后活动与 Thread 最后回复的较大值，Agent 在 Thread 有进展时不会被误判停滞；
- 10 分钟心跳与 30 分钟 stall 互斥，不再同一 tick 重复唤醒两条；
- 心跳/停滞仍完全由插件算法执行。

## 0.3.42 — 2026-11-10

- 把「PMO 只能由插件算法执行，禁止人工/外部脚本指挥」写入内置 ai-team-core skill 并加测试；
- 用户反馈的问题必须落成插件算法与测试，不靠人工催办/改标题。

## 0.3.41 — 2026-11-10

- Agent 切换到新 Task 时启动**任务级 session**，标题为 `#N 任务名`；同一 Task 复用同一 session；
- 不再把旧 Task 的 session 改名复用，减少会话串线与无意义标题；
- 启动时把 active Task 的 assignee session 标题同步为任务名。

## 0.3.40 — 2026-11-10

- Agent session 标题按当前 Task 命名（`#N 任务名`），不再显示“你是 XX（执行）”这类首轮 prompt；
- 成员同一时间只执行一个 Task，session 按任务复用并改名，避免每轮新增无名会话；
- 启动时把 active Task 的 assignee session 标题同步为任务名。

## 0.3.39 — 2026-11-10

- PMO 心跳：active Task 超过 10 分钟没有 Thread 更新时唤醒 assignee，要求发一条可见进度（不要求完成）；
- 30 分钟仍无更新则升级为 stall 唤醒 owner+assignee；
- 解决“Agent session 在跑但 Task/Thread 看不到进度、看起来不干活”的可见性问题。

## 0.3.38 — 2026-11-10

- PMO 每 60s 检测 active Task 是否超过 30 分钟无更新；超时唤醒 owner + assignee，要求继续或报告卡点，避免任务静默停住；
- bootstrap task card 增加 `updatedAt`，为停滞检测和 UI 提供真实活动时间。

## 0.3.37 — 2026-11-10

- 默认团队增加编程 Agent「玄策」（mem_coder，role=编程）；新 Project 默认为 4 名 Agent；
- PMO/QA 可把开发任务按专长分给执行/编程成员并行推进；
- 当前项目已把 T5 改派玄策，与青岚 T4 并行。

## 0.3.36 — 2026-11-10

- 修复 bootstrap route 覆盖 projects 时丢失 `pmoAuto`，导致 PMO 开关点一下又回到“开”；
- 增加 integration 断言：projects[0].pmoAuto 默认 true；
- 策略不变：PMO 默认开启，Project header 可关。

## 0.3.35 — 2026-11-10

- 内置 `ai-team-core` skill 自动注入所有 Agent wake；
- 状态变化 toast 气泡、成员视图最近 Task 状态气泡；
- PMO 自动推进 prompt 加入复盘/头脑风暴/深度研究会议要求。

## 0.3.34 — 2026-11-10

- 新增 Project 级 PMO 全自动开关，默认开启；关闭后决策回到收件箱；
- PMO 每 60s 检查：未读结构化决策按最高价值建议自动决策，不需要 Human 再确认；
- 无 active Task 时自动唤醒 Project owner 续派下一批 Task，避免「全部完成但停住」；
- PMO 自动决策写入 Task Thread，author=mem_pmo，并唤醒 owner/assignee；
- 插件新增状态变化 toast 气泡；成员视图新增最近 Task 状态气泡；
- 内置 `ai-team-core` skill（单一实现、网页取证/代理、懒惰高级程序员、最小依赖、日志埋点），所有 Agent wake 自动注入；
- PMO 续派 prompt 要求先做复盘/头脑风暴/深度研究会议，再产出验收标准与下一批 Task。

## 0.3.33 — 2026-11-10

- 看板「需要你」的收件箱数量改为统计真实未读决策项，不再受 Q1 items 最多 5 条的限制，也不再混入进度汇报；
- 与收件箱、态势 Q1 的数量口径保持一致。

## 0.3.32 — 2026-11-10

- 四象限「需要你」与收件箱使用同一过滤：纯进度汇报不再计入 Q1；
- 看板「需要你」筛选无 Task 但有真实收件箱决策时，显示「需要你处理 N 条」并一键打开收件箱，不再显示空任务；
- Client 侧同步过滤旧 bootstrap 的 Q1，无需重启宿主也能消除截图里的 3 条假待办。

## 0.3.31 — 2026-11-10

- 信息性 Thread 汇报（“推进记录/备案/Human 决策收到”）不再生成 Human 决策收件箱项，避免“打开 Task 后无事可做”；
- 收件箱只保留真正的问题：`askHuman`、报告六问、失败/需要决定；
- 旧账本里的同类 `thread_mention` 项在 bootstrap/client 中隐藏，不再计入“待你处理”；
- 真正决策提交后仍自动回写 Thread 并唤醒 owner，不需要 Human 再发一句话。

## 0.3.30 — 2026-11-10

- 已提交的决策项增加「重新决策」：复用原六问/选项/建议重开一份未读项，可直接采纳建议后修改；
- 看板已完成默认展开、按 Task 号倒序；
- 决策建议逐条/全部采纳。

## 0.3.29 — 2026-11-10

- 看板「已完成」默认展开，不再先折叠成「展开全部」；
- 看板各列按 Task number 倒序，最新任务优先显示；
- 收件箱决策支持逐条「采纳」与「全部采纳建议」，建议直接填入可编辑输入框。

## 0.3.28 — 2026-11-10

- 收件箱决策项增加逐条「采纳」与「全部采纳建议」；建议直接填入可编辑输入框，不再手抄；
- 提交仍要求所有问题有答案，采纳后可继续修改。

## 0.3.27 — 2026-11-10

- 主对话「任务」模式拆成标题 + 验收标准；不再把 Human 原话直接当 resultDefinition；
- 开启 QA 时必须逐行填写 checklist，否则不能提交；
- 修复真实项目 #3/#4 的根因：重复创建、宽泛结果定义、QA 空清单；
- 重复 Task 的第二条会打开已有卡，不再静默新建。

## 0.3.26 — 2026-11-10

- Task 创建增加重复保护：相同 title/resultDefinition/owner 的 active Task 会被拒绝并返回已有 Task；
- 主对话「任务」模式收到重复错误时自动打开已有 Task，不再产生 #3/#4 这类重复卡；
- `qaRequired=true` 但没有 qaChecklist 时拒绝创建，避免产生无法验收的 #4；
- 成员有 `pending_acceptance` Task 时不能再 claim 下一张，阻止 T2/T3 在 T1 验收前提前开工；
- `team() accept` 现在透传 checks，QA Agent 不再需要走 Human API。

## 0.3.25 — 2026-11-10

- 收件箱未读数按 `state=unread` 统计，决策提交后「待你处理」立即消失；
- 已答/已 dismiss 的报告六问不会在重启后再次导入；
- 收件箱决策项显示提问成员名字，不再显示 `mem_*`。

## 0.3.24 — 2026-11-10

- 修复 member `team` 工具 accept 未透传 `checks` 的缺口：agent QA 带 checklist 验收不再 E_INVALID_STATE；
- 增加 `checks` schema，并覆盖 QA agent 带清单验收测试。

## 0.3.23 — 2026-11-10

- 报告六问只生成一个结构化收件箱项，不再按每条 Thread mention 重复；
- 在现有项目账本副本上验证：1 个决策项、6 个问题、未读。

## 0.3.22 — 2026-11-10

- 报告路径提取只接受无空格的绝对路径，避免把 Thread 叙述当成报告路径；
- 六问导入在现有报告上验证为 6/6。

## 0.3.21 — 2026-11-10

- 打开 Project 时，如果 Thread 里提到 Human 并登记了 Markdown 报告路径，会从报告的「6. 需 Human 决策的问题清单」提取全部问题；
- 现有项目无需重新问一遍：升级重启后，§6 六问直接进收件箱并可逐项填写提交；
- 收件箱决策标题显示问题数（如「需 Human 决策 · 6 问」）。

## 0.3.20 — 2026-11-10

- 收件箱决策项可直接选择/填写并提交，Human 决策会回写 Task Thread 并唤醒 owner；
- 顶部「待你处理」入口保持一键可达；
- 决策提交后收件箱状态 resolved，不再需要先 ack 再回复。

## 0.3.19 — 2026-11-10

- 新增 `team askHuman`：Agent 必须把每个 Human 决策问题、选项、推荐项逐条提交；
- 收件箱决策项直接展开问题/选项/推荐，不再要求翻报告或 Thread；
- 顶部增加「待你处理 · N」一键入口；
- Thread 中 @Human 的普通消息仍自动生成决策项。

## 0.3.18 — 2026-11-10

- 打开 Project 时回填已有 Thread 中对 Human 的拍板请求到收件箱；
- 修复升级前已有的“Thread 里等 Human 决定，但收件箱为空”。

## 0.3.17 — 2026-11-10

- Thread 中 Agent 明确提到 Human / 请你拍板时，自动创建 Human 决策收件箱项；
- 团队动态计数改为真实状态拆分：进行中 / 待处理 / 待验收，不再把待处理算成“正在推进”；
- 收件箱的决策项保留 Thread 标题，便于识别。

## 0.3.16 — 2026-11-10

- 点击 Agent 列表中的成员名字直接打开真实对话；
- 没有 session 时先激活，再打开；
- 打开失败时落到成员资料，资料内提供「直接对话」和「他的任务」按钮。

## 0.3.15 — 2026-11-10

- 成员 Session 自动挂到 Project workspace，不再散落在 DSH「未分组」；
- Task Thread 增加「对话」按钮，直接打开 assignee/owner 的真实 Session；
- 成员行增加直接对话按钮；点名字进入成员任务视图；
- 团队动态只在有 active Task 时显示（或全新项目刚唤醒时），已完成不再显示“正在拆解”；
- `huashu-nuwa` 从 Team 技能目录、prompt catalog 与 notes 加载中排除。

## 0.3.14 — 2026-11-10

- 主对话顶部增加「团队动态」：显示正在推进的 Task、owner 和运行中的成员；
- 点击团队动态里的 Task 直接打开 Thread；没有 Task 时显示“成员已唤醒，正在拆解”；
- 解决 Human 发消息后主对话没有反馈、只能去任务看板找 Task 的问题。

## 0.3.13 — 2026-11-10

- 点击成员名字进入成员视图：该成员负责/执行的任务列表 + 直接对话 + 资料入口；
- 目录选择改用 `ctx.get('uiWorkspace').pickDirectory()`，修复「当前宿主不支持目录选择」；
- 选择目录取消不再误报为不支持；保留手填路径兜底。

## 0.3.12 — 2026-11-10

- 点击成员名字直接打开该 Agent 的 DSH 原生 Session，可与它直接对话；
- 没有 session 的空闲成员会先激活再打开；
- 「⋯」仍打开成员资料，资料内也增加「直接对话」按钮。

## 0.3.11 — 2026-11-10

- 修复空闲默认成员不接收 Main stream：owner 无 session 时先自动激活，再记录 `wake/delivered`；
- Project 增加工作目录：默认项目首次进入提示选择，新建项目必填，成员 cwd 使用项目目录；
- 多 Project 用 name + workspacePath 区分，切换时显示各自目录；
- `team` 工具新增 `members`（返回精确 id/name/role），创建 Task 时 ownerId/assigneeId 按 id 或名字解析并校验；
- Main stream wake prompt 注入成员 id 清单，避免模型把名字拼音当 ownerId。

## 0.3.10 — 2026-11-09

- 默认成员改为小说式虚拟名：墨渊（主理人）/ 青岚（执行）/ 白砚（验收）；
- 旧版 0.3.9 及以前的默认名（沈舟/林岚/顾清）在打开 Project 时自动升级；
- 只升级精确匹配的旧默认名，用户自定义名字不会被覆盖。

## 0.3.9 — 2026-11-09

- 图标改为极简线条：重檐 + 出檐 + 立柱 + 渊水，侧栏与市场图标统一；
- awesome-dsh-plugin 分类改为 `agi`（AGI 架构探索）。

## 0.3.8 — 2026-11-09

- 收件箱「对话」返回改为文渊阁内部主对话，不再依赖宿主 `layout.selectPanel(conversation)`；
- 修复空收件箱点击返回出现 “spike：宿主没有可用的 layout…” 的错误提示。

## 0.3.7 — 2026-11-09

- 侧栏 PanelIcon 真正使用文渊阁印章图标（此前后仍是 loop 占位符）；
- 图标同步到 npm 包、README 和市场条目。

## 0.3.6 — 2026-11-09

- 新图标：重檐阁楼 + 三开间柱 + 渊水纹 + 朱印，墨蓝 / 金 / 朱红；
- 桌面 profile 从 npm 安装 0.3.6，重启后加载。

## 0.3.5 — 2026-11-09

- 新 Project 默认成员：沈舟（主理人）/ 林岚（执行）/ 顾清（验收），均可在成员资料中改；
- 默认 Lead 成为 Project owner，让一句话开工可以直接唤醒团队；
- Provider / Model 改为读取 DSH `llm.listProviders()` + `llm.listModels()` 的下拉，不再手填 id；
- 新增 `GET /ai-team/api/models` 与 `lib/host/model-catalog.js`；
- 默认成员只在 Project 没有 Agent 时播种一次，不覆盖用户已有 roster。

## 0.3.4 — 2026-11-09

- README 精装修：品牌、快速开始、能力地图、架构图、API、验证证据、文档索引；
- 发布到 npm / GitHub Releases，补充 repository / homepage / keywords / LICENSE；
- desktop profile 改为从 npm 安装。

## 0.3.3 — 2026-11-09

- 产品显示名改为「文渊阁」（Wenyuan Pavilion），取藏修、校勘、纂辑之意；
- 保持包名 `@suifei/dsh-ai-team` 与内部 Team 域对象不变。

## 0.3.2 — 2026-11-09

- 产品显示名改为「三省」（Three Departments），副标「三省六部」；
- 修复热加载时 permission 服务尚未就绪导致 `BOOT_FAILED / permission services are unavailable`，Host 显式 inject `permissionPresets` 与 `sandboxPolicy`；
- 四象限空 items / null taskNumber / 无 taskId 的决策项做健壮处理，避免点击异常与 `#null` 文案。

## 0.3.1 — 2026-11-09

- SkillOpt 完全内置：7 个 `skillopt_*` 工具、Python engine bootstrap、`skillopt-sleep` 技能随插件分发，不再装到用户 DSH；
- 冷恢复重新 mount member preset，修复重启后 `pwsh/read/write` 工具消失；
- 失败决策自动带 taskId；跨 Project 收件箱可一键打开 Task；
- 双真实 provider SSE：DeepSeek 与 Zhipu 各自项目独立分桶；
- 测试 82 条。

## 0.3.0 — 2026-11-09

- 并发 ProjectRuntime：启动打开全部 Project，各自 ledger/Waker/SSE/Team 工具路由；
- 跨 Project 收件箱：聚合、项目标记、按项目 ack、打开 Task 前切项目；
- V-10：新增真实 turn 中途降级 E2E 测试钩子（生产 403），守卫在工具调用前修复权限；
- billing/网络：测试专用 `ai-team-fault` LLM adapter，真实 Agent loop 验证 402 与 ECONNRESET 分类/恢复；
- 技能：新增 `ai-team-files` provider，发现 `~/.dsh/skills` 与项目技能；nuwa/distilly/darwin/SkillOpt 四个技能安装并由真实成员加载。

## 0.2.6 — 2026-11-09

- 工具调用前权限守卫：managed member 若在 turn 中途被降级，下一步工具前先修复为 danger-full-access；修不好则拒绝；
- 非成员工具调用不受影响；
- V-10 从“仅激活时检查”前移到每次工具调用。

## 0.2.5 — 2026-11-09

- 成员 config 新增 `preset`：`standard / ptc / minimal / cordis`，默认 `standard`；
- 资料抽屉可选择运行配方；
- 激活时 mount 对应 preset，未知配方被校验拒绝。

## 0.2.4 — 2026-11-09

- 修复成员工具链：`agents.create` 的 setup 里 mount `standard` preset，成员获得 pwsh/read/write/edit/skill 等完整工具；
- 真实成员用 pwsh 写文件、用 skill 加载 DSH 技能并写结果；
- 健康检查暴露 `presets` 与 `skillsService`。

## 0.2.3 — 2026-11-09

- 成员 activation/wake 注入 DSH `skills` 目录摘要（名称/描述/何时用，最多 12 条）；
- 完整技能正文由成员自己的 `skill` 工具按需加载；
- 保留 `<dataDir>/skills/<name>/SKILL.md` 有界注入。

## 0.2.2 — 2026-11-09

- 多 Project 单活动切换：每 Project 独立 ledger，`projects.json` 索引；
- Host `project.create` / `project.activate`；
- UI 新建项目弹窗 + 项目列表切换；
- 切换后重拉 bootstrap、重连 SSE，未完成 Task 由 `team/startup` 恢复；
- 已知限制：同一时刻只开一个 Project runtime，非活动项目不并发唤醒。

## 0.2.1 — 2026-11-09

- QA checklist 硬门禁：`qaRequired` + `qaChecklist`，全部通过才能 accept。
- 启动恢复：`team/startup` 恢复未完成 Task，无定时器；真实重启 E2E 跑通。
- 抽出 `ProjectRuntime`（默认项目行为不变），为多 Project 做准备。
- 修复资料抽屉白屏（early-return 前引用 selectedTask / data null）。
- 真实浏览器验证 DM：`member.message` + wake，成员 session 前进。

## 0.2.0 — 2026-11-09

M2.5「团队进化」迭代。

### 新增

- 成员资料：name / role / personality / profileVersion；Human 可编辑，空个性按“不修改”处理。
- 自我进化：`team.evolve` 只允许 Agent 改自己的 personality；验收后 reflection wake 触发；真实跑通并写 `member/distilled`。
- 模型蒸馏：`member.distill(mode:'model')` 由 Host 单步调用 `llm.stream`，无工具、固定 JSON schema；真实跑通。
- 人才库：`member.leave` / `member.rejoin`，身份与 session 保留；`member.takeover` 接遗留 Task，保留 claim/takeover 历史。
- QA：`qaRequired` 硬门禁、`qaChecklist` 逐项通过、QA 优先自动 reviewer；真实 QA 自动验收。
- 备忘/技能：`team.note` / `team.skill` / `team.recall`；`<dataDir>/skills/<name>/SKILL.md` 有界加载进 prompt。
- 私信：`member.message` 只唤醒目标成员。
- 关注：`task.follow`；验收后给仍关注者生成 `followed_task_update`。
- 收件箱：真实 `data.inbox`、ack、打开 Task；失败恢复 UI（改配置 + retry）。
- 启动恢复：`team/startup` 恢复未完成 Task，无定时器；真实重启 E2E。
- 任务动作 UI：取消/重开/删除/改派；Thread 回复/验收/退回真实命令。
- 安装/卸载/升级文档与 profile 隔离检查。

### 测试

- `node --test` 71/71。

### 已知边界

- 单机、单 Human；多 Project 仍以默认 Project 为主。
- 技能文件只进 prompt，不是可执行工具注册。
- 外部失败注入仅覆盖真实 401；billing/网络注入仍待。
- 多 Project、V-10、真实卸载/升级演练未完成。
