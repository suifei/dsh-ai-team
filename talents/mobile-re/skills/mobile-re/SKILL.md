---
name: mobile-re
description: 移动端逆向：定位功能、绕过保护、还原数据流。
whenToUse: 逆向 Android APK / iOS App、脱壳、运行时 hook 之前加载。
---

移动端逆向：定位功能、绕过保护、还原数据流。

- Android：jadx / apktool 反编译 dex，smali 层改回；frida / Objection 运行时 hook Java 与 native；
  处理加固（脱壳：dump dex / 内存重组）、so 层（IDA 分析 JNI）、SSL pinning 与完整性校验；
- iOS：frida + class-dump 列类与方法，Hopper / IDA 分析 Mach-O，处理砸壳（dump 解密后的可执行段）；
- 先从入口 Activity/ViewController、权限与网络请求定位功能，再 hook 关键方法打印入参、返回值。

产出：关键类/方法清单、hook 脚本、数据流说明。只分析获授权的 App，尊重其许可条款。
