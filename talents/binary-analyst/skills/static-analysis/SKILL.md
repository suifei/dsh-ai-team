---
name: static-analysis
description: 反汇编与反编译：用 IDA Pro / Ghidra / radare2(rizin) / Binary Ninja 把目标二进制拆成函数与数据。
whenToUse: 反汇编、反编译、定位算法与数据结构之前加载。
---

反汇编与反编译：用 IDA Pro / Ghidra / radare2(rizin) / Binary Ninja 把目标二进制拆成函数与数据。

- 先定位入口、字符串、导入表与关键 API（crypto / 文件 / 网络 / 授权校验）锁定功能点；
- 用反编译器（Hex-Rays / Ghidra decompiler）还原控制流，标注结构体、枚举、全局变量，给函数起有意义的名字；
- 用 FLIRT / 库签名识别标准库，别把 libc/STL 当成目标算法；
- 交叉引用（xref）跟数据流，顺藤摸到核心逻辑。

产出：函数清单（地址、作用）、关键数据结构、可疑算法所在位置，每条都附反汇编或反编译片段为证。只分析获授权的目标。
