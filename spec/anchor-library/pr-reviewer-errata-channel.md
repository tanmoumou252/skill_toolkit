---
id: pr-reviewer-errata-channel
expects: auto
slots: []
---
本文件是 PR 审查报告「勘误（ERRATA）通道」机读锚定语义的归档解释（溯源：自 `body-shared-pr-reviewer` 块 `g105` 槽位下沉，代理正文仅保留操作硬要求，本归档不参与产物装配）。

## 机读行两类锚定与失效路径全量解释

机读行分两类锚定，失效语义不同：

**第一类：`VERDICT: GO` / `VERDICT: NO-GO` / `VERDICT: ESCALATE_TO_HUMAN`**，由 `VERDICT_LINE_RE`（`checks/attack-ledger.mjs`）整行闭合锚定，值域为三值闭集。`VERDICT` 修正行行尾仅容忍空格/制表符，不得续写 `:说明`——`VERDICT_LINE_RE` 无可选说明组，续写即不命中锚定。写入三值闭集之外的任何值或行尾续写失配，不命中锚定且被 `verdict-line-out-of-domain-gate` 判红（闸族 pass-line-out-of-domain-gate 此前只覆盖三枚 `*_PASS=` 行，`^VERDICT:` 前缀为闸面唯一缺口，selftest `assert-verdict-out-of-domain-stray-line-detected` 钉死）——末次取值仅暂时退回被推翻的旧行，红灯使失配行无法静默保留旧判定（含旧 GO），勘误必须重写为逐字命中锚定的修正行。

**第二类：`TRUTH_PASS=done` 或 `TRUTH_PASS=partial:<缺项>`、`SEMANTIC_PASS=done` 或 `SEMANTIC_PASS=partial:<缺项>`**，锚定（`TRUTH_PASS_LINE_RE` / `SEMANTIC_PASS_LINE_RE`）取值域为闭集：`done` 与 `partial:<非空缺项>`。修正行行尾仅容忍空格/制表符与可选 `:说明`。写入闭集外的修正值（如纯字母拼错的 `TRUTH_PASS=dnoe`、裸 `TRUTH_PASS=partial`）不命中锚定，末次取值退回被推翻的旧行；且该围栏外行首机读行被值域外机读行闸判红（pass-line-out-of-domain-gate：围栏外行首 `^TRUTH_PASS=` / `^SEMANTIC_PASS=` / `^SHADOW_PASS=` 整行但不命中对应取值正则即红，selftest `assert-truth-pass-out-of-domain-stray-line-detected` 等三族断言钉死）——机器信号在场，但信号归因是「修正行取值非法」而非四问/五问真缺项。写入修正行后仍必须人工核对取值拼写逐字为 `done`（或 `partial:<真实缺项>`）。

两类修正行均必须整行锚定（`^…$` 整行闭合）。独立 `<修正值>` 裸值整行不属于 ERRATA 修正例外：裸值整行不被 PR 侧机读闸消费（值语义闸严格锚 `^VERDICT:` 整行闭合，selftest `assert-truth-pass-verdict-strict-anchor-not-hijacked` 钉死），写了不生效即勘误失效；一旦为容它而放宽锚定即成劫持面。修正行之外的一切散文与行内代码引用仍不构成机读行。

任何一类写入失配的共同后果：机读一律取围栏外最后一次出现，ERRATA 位于报告最末——失配修正行的取值仅暂时退回被推翻的旧行；但失配行本身被对应值域外闸判红（第二类走 `pass-line-out-of-domain-gate` 三族，第一类走 `verdict-line-out-of-domain-gate`），红灯强制把修正行重写为逐字命中锚定的形态，勘误不会"静默失效"。唯一不触闸的失配形态是独立 `<修正值>` 裸值整行（无 `^VERDICT:` / `^*_PASS=` 前缀，不在闸触发域）——所以契约规定其"写了不构成修正"，禁止以裸值替代修正行。
