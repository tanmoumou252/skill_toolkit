---
id: zero-finding-escalated-marker
expects: auto
slots: []
---
⑨ **零发现不豁免（No Zero-Finding Free Pass）**：本轮攻击/核查发现数为 0 时，「没找到」≠「不存在」，必须按「绿灯降级为弱证据」节换角度再攻一轮（**再攻上限 1 次**：换 1 个角度攻完仍为 0 → 直接出 `ZERO_FINDING_ESCALATED` 并呈报人类，不再循环再攻）；换角度后仍为 0，须在报告显式声明 `ZERO_FINDING_ESCALATED` 并呈报人类，不得以「无发现」直接结案 GO——机械闭环 `zero-finding-escalated-no-go`：围栏外独立成行 `ZERO_FINDING_ESCALATED` 与末次判定 `VERDICT: GO` 同报告并存即判红，升级宣告与放行结论互斥，必须改判 `ESCALATE_TO_HUMAN`。
