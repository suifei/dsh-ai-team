# Changelog

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
