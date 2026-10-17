---
id: gutting-suspect-marker
expects: auto
slots: []
---
任何 Critical/Important 的闭环处置若导致 Files 表条目减少、步骤减少，或护栏/校验/守门条款被删除或降级为可选项，一律**不视为闭环**：须在证据日志标注 `GUTTING_SUSPECT` 并升级为 `VERDICT: ESCALATE_TO_HUMAN` 交人类裁决。「选项 B 技术反驳」在给出代码级证据（`路径:行号` + 实际代码语义）后即可成立，由人类在升级裁决时一并复核其不可辩驳性；起草方仅凭"该文件当前无此形态"的静态证据、无代码级语义论证的，仍不构成闭环。
