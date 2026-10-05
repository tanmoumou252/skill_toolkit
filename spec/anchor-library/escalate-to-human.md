---
id: escalate-to-human
expects: auto
slots: []
---
**熔断中继**：复审以 **2 个波次为上限**（波次定义：首波内并发的多份报告同属第 1 轮，其后每次因 Critical 回灌而重派的批次各计 1 轮）。第 2 波结束仍有未解决 Critical 时，报告必须显式标记 `VERDICT: ESCALATE_TO_HUMAN`，由编排器呈报人类裁决；人类给出指示后按指示定稿，严禁再派发 Reviewer 循环。
