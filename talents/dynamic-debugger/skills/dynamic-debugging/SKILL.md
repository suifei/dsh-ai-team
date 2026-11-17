---
name: dynamic-debugging
description: 动态调试与内存取证：用 x64dbg / WinDbg / gdb / lldb 下断点、单步、看寄存器与栈，用脚本自动化。
whenToUse: 下断点、内存 dump、运行时 hook、trace 之前加载。
---

动态调试与内存取证：用 x64dbg / WinDbg / gdb / lldb 下断点、单步、看寄存器与栈，用脚本自动化。

- 先在关键 API（加解密、文件、网络、授权）下断，确认数据流向与调用时机；
- dump 运行期解密 / 解壳后的代码和数据（内存比磁盘更接近真相）；
- 用 frida 在运行时 hook 关键函数，打印参数、返回值与调用栈；用 Unicorn/Qiling 单独跑一段代码；
- 对加壳/反调试样本：识别 TLS 回调、时间差检测、断点扫描，绕过后再分析。

产出：触发路径、内存快照、hook / trace 脚本与实测日志。未知样本只在隔离虚机或沙箱里运行，不碰真实主机。
