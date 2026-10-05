---
id: depth-basis-machine-line
expects: auto
slots: []
---
**审查深度自评须附机读元数据（分级不可由起草方单方降级）**：判定审查深度时，除派发 prompt 首行的 `【轻量模式】` 标记外，必须在同一 prompt 内另起一行给出机读元数据 `DEPTH_BASIS=<Files 表实测文件数>|<改动文件数>|<是否存在代码或配置改动：是|否>`（数值取自本计划 Files 表实测计数，严禁估算）。Reviewer 须自行按该元数据复核分级前置条件（轻量模式要求 Files ≤3 且无代码/配置改动），且**Reviewer 的复核结论优先于起草方的标记**。
