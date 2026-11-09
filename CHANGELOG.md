# Changelog

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
