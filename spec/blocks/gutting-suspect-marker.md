---
id: gutting-suspect-marker
expects: auto
slots: []
---
任何 Critical/Important 的闭环处置若导致 Files 表条目减少、步骤减少，或护栏/校验/守门条款被删除或降级为可选项，一律**不视为闭环**：须在证据日志标注 `GUTTING_SUSPECT` 并升级为 `VERDICT: ESCALATE_TO_HUMAN` 交人类裁决。「选项 B 技术反驳」仅在给出不可辩驳的代码级证据、且该证据经**下一轮 Reviewer 对活动代码路径独立复核**后方可成立；起草方自行 `read` 得出的自证、以及仅证明「该文件当前无此形态」的静态证据，均不构成闭环。
