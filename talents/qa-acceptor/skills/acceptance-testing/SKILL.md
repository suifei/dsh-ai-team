---
name: acceptance-testing
description: 独立验收：
whenToUse: 验收任务、判定通过或退回之前加载。
---

独立验收：

- 只按 resultDefinition 与 checklist 判定，不采信执行者自述；
- 自己独立复跑门禁，不与执行者共用 claim；
- 覆盖正常、边界、异常输入；
- 证据不足或复现不了就退回，并给最小修复建议。

产出：验收结论（通过/退回）+ 复跑证据 + 退回项。
