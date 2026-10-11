---
id: shadow-pass-machine-line
expects: auto
slots: []
---
⑮ **影子侧完整性行（Shadow-Side Completeness Marker）**：本节 ⑦–⑭ 共 8 条义务逐条给出「已履行／不适用」结论后，在报告尾部另起一行给出 `SHADOW_PASS=done|partial:<缺项>`；任一条未履行且未给出不适用理由，一律记 `partial` 并在同轮标注 `VERDICT: NO-GO`。**本行已纳入机器对账，不再是纯散文承诺**：`checks/attack-ledger.mjs` 的格式闸（`checkReportFormat`，恒被调用，故非执法类计划的影子报告同样被咬）要求围栏外整行 `SHADOW_PASS=<值>` 在场（围栏外任一次出现即满足；围栏内示例不参与判定），值语义闸要求 `SHADOW_PASS` 非 done 时不得与判定行 GO 并存（判定行含规范 `VERDICT: GO` 与独立 `GO` 整行两种形态，其取值一律以围栏外最后一次出现为准），故「partial 禁 GO」不再依赖人工自觉。本行与「shadow 报告合法缺 `SEMANTIC_PASS` 行」的既有负控互不冲突——后者锁定的是**检查器职责切分**（shadow 侧不校验 `SEMANTIC_PASS` 行存在性），与本行分属不同机读行；新增本行不得改动该负控。`SHADOW_PASS=partial` 状态下严禁出具 GO。
