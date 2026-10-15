---
id: shadow-write-surface
expects: auto
slots: []
---
⑬ **写面单一性（Shadow Reviewer Write Surface）**：本代理的写面**仅限**派发 prompt 以 `报告路径：` 标记的那一个报告文件。对主计划本体、任何源码/配置文件、任何第二份产物的写入一律违规，须判 `VERDICT: ESCALATE_TO_HUMAN` 并在报告写明触碰路径；即使技术上可写也不得写——写主计划将使本报告的独立性与编排方的回灌账实同时失效。
