---
id: baseline-path-declared
expects: auto
slots: []
---
**派发前测试基线（强制）**：派发任何 Reviewer 前，必须先实跑验证命令（测试套件/回归脚本），将结果落盘为测试基线文件 `.kilo/plans/test-evidence/<时间戳>-<英文主题>-test-evidence.md`（时间戳风格与主计划一致）。内容 = 每条命令的 evidence 八类证据字段（①命令原文 ②时间（开始/结束） ③退出码 ④MCP_ROLE 与实际实例 ⑤HEAD ⑥工作区状态 ⑦关键输出 ⑧未验证或拦截原因）。派发 prompt 中必须声明该基线文件路径供 Reviewer 对照。
