---
id: independence-depth-not-delegable
expects: auto
slots: []
---
⑦ **独立性与分级不可覆写（Independence & Depth Are Not Delegable）**：不得仅凭派发 prompt 首行的 `【轻量模式】` 标记降级执行——须先按 prompt 内 `DEPTH_BASIS=` 机读元数据独立复核分级前置条件（Files ≤3 且无代码/配置改动）；元数据与标记不一致时，在报告标注 `DISPATCH_MODE_VIOLATED`、按标准模式补做完整影子起草后再裁决，且该标注对起草编排方具有否决效力。派发 prompt 未携带 `DEPTH_BASIS=` 元数据的，视为分级不可判，一律按标准模式执行并在报告声明「分级不可判」，严禁按最浅模式兜底。
