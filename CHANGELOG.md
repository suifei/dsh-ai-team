# Changelog

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
