# spec/agents-md — AGENTS.md 模板说明

三份平台 AGENTS.md 由 `checks/build-agents.mjs` 从 `spec/blocks/` 块库（本目录仅含本说明文件，无块实体）与三平台 `spec/platform/*/manifest.json` 生成（机器消费面 = 各 manifest 的 `AGENTS.md` 条目 blocks 序列）。本文件只作装配口径说明，不参与构建。

## 推导口径（反推）

以三端现存手写 AGENTS.md 为蓝本三方对勘：**逐字相同者入共享块，不同者原封不动做成平台插槽值或平台独有块**。验收标准：生成产物与各端原稿逐字一致（允许差异 = 头部版本戳行与末行换行归一——build 以 trimEnd 后补单个换行收尾，原稿「文件末尾无换行」形态被归一）。正本取 kilocode 端（A 类修齐正本），kilocode/codebuddy 的 AGENTS.md 与原稿逐字等价；zcode 的平台差（EXECUTING 措辞、租约载体条款、直连派发参数头节、写作权五条）全部经插槽与独有块承载。

## 块与插槽

| 块 | 三端 | 插槽 |
|---|---|---|
| `agents-md-shell-policy` | 共享（三端逐字同） | — |
| `agents-md-plan-authorship` | 共享骨架（标题三端同） | `plan_authorship_rules`（kilo 3 条 / codebuddy 2 条 / zcode 5 条，各端原文） |
| `agents-md-execution-iron-laws` | 共享骨架（铁律 1/2/4 三端逐字同） | `iron_laws_title`、`iron_laws_preamble`、`exec_stage_noun`、`rework_reporter`、`terminate_lead`、`delivery_gate_lead`、`law3_tracks`（轨道 A/B，zcode 含租约载体条款）、`carrier_note` |
| `direct-dispatch-header` | zcode 独有 | — |
| `agents-md-hygiene-supplements` | 共享（三端除复审者类型名外逐字同） | `pr_reviewer_type` |

agents 九文件 body 块为**槽位骨架**（`{{gN}}` 占位符序列），装配时逐槽位替换，并非整块逐字保真；agents 面的平台差异（如派发工具名 `subagent_type`/`subagent_name`）由各端 manifest 中该 agents 条目的 `slots` 值承载（例如 kilocode/codebuddy plan-writer 条目的 `g8`/`g15` 槽与 zcode 对应槽位，`subagent_type` 在三端 AGENTS.md 层零出现、仅存在于 agents 文件），改某端散文＝改该端 manifest 的对应 slots 值，改三端共享面＝改 body 块槽位之外的字面行；插槽键以三份 `spec/platform/*/manifest.json` 的 `slots` 字段为准。

## agents 九文件 body 块

九份 agents 产物各由一个槽位骨架块承载，实际块库为 4 块：`body-shared-plan-writer.md`、`body-shared-plan-reviewer.md`、`body-shared-pr-reviewer.md`（三端共享角色）与 `body-zcode-plan-writer.md`（zcode plan-writer 独有）；块体内 `{{gN}}` 槽位由各端 manifest 的 `slots` 逐值替换，槽位之外的字面行为三端共享面（逐字相同）。改某端散文＝改该端 manifest 对应 slots 值，改三端共享面＝改块体槽位之外字面行；改完运行 `node checks/build-agents.mjs` 重生成。

## 预留块（已迁往 spec/anchor-library/）

- `agents-md-platform-intro`、`agents-md-carrier-note`、`agents-md-zcode-orchestrator`：早期模板化草案的插槽块，反推对勘确认三端原稿均无对应章节后退出装配面，已迁往 `spec/anchor-library/` 作死块归档，不再留在活跃块库。

## 版本戳

产物头部 `<!-- GENERATED from spec@<12位sha256内容哈希>; do not edit -->`；手改产物会被新鲜度闸（generated-product-stale / build --check STALE）判红，改 spec 后运行 `node checks/build-agents.mjs` 重生成。
