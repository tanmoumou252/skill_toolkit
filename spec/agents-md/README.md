# spec/agents-md — AGENTS.md 模板说明

三份平台 AGENTS.md 由 `checks/build-agents.mjs` 从本块库生成（机器消费面 = 三平台 `manifest.json` 的 `AGENTS.md` 条目 blocks 序列）。本文件只作装配口径说明，不参与构建。

## 推导口径（反推）

以三端现存手写 AGENTS.md 为蓝本三方对勘：**逐字相同者入共享块，不同者原封不动做成平台插槽值或平台独有块**。验收标准：生成产物与各端原稿逐字一致（唯一允许差异 = 头部版本戳行）。正本取 kilocode 端（A 类修齐正本），kilocode/codebuddy 的 AGENTS.md 与原稿逐字等价；zcode 的平台差（EXECUTING 措辞、租约载体条款、直连派发参数头节、写作权五条）全部经插槽与独有块承载。

## 块与插槽

| 块 | 三端 | 插槽 |
|---|---|---|
| `agents-md-shell-policy` | 共享（三端逐字同） | — |
| `agents-md-plan-authorship` | 共享骨架（标题三端同） | `plan_authorship_rules`（kilo 3 条 / codebuddy 2 条 / zcode 5 条，各端原文） |
| `agents-md-execution-iron-laws` | 共享骨架（铁律 1/2/4 三端逐字同） | `iron_laws_title`、`iron_laws_preamble`、`exec_stage_noun`、`rework_reporter`、`terminate_lead`、`delivery_gate_lead`、`law3_tracks`（轨道 A/B，zcode 含租约载体条款）、`carrier_note` |
| `direct-dispatch-header` | zcode 独有 | — |
| `agents-md-hygiene-supplements` | 共享（三端除复审者类型名外逐字同） | `pr_reviewer_type` |

agents 九文件 body 块为整块逐字保真，不做插槽替换；agents 面的平台差异（如派发工具名 `subagent_type`/`subagent_name`）由 AGENTS.md 层共享块的插槽与平台独有块承载，插槽键以三份 `spec/platform/*/manifest.json` 的 `slots` 字段为准。

## agents 九文件 body 块

九份 agents 产物各由一整块承载，实际块库为 4 块：`body-shared-plan-writer.md`、`body-shared-plan-reviewer.md`、`body-shared-pr-reviewer.md`（三端共享角色）与 `body-zcode-plan-writer.md`（zcode plan-writer 独有），逐字保真、不做插槽替换；三端共享面（生效方式、铁律骨架等）由 AGENTS.md 层共享块承载。改 agents 散文＝改对应 body 块，改完运行 `node checks/build-agents.mjs` 重生成。

## 预留块（已迁往 spec/anchor-library/）

- `agents-md-platform-intro`、`agents-md-carrier-note`、`agents-md-zcode-orchestrator`：早期模板化草案的插槽块，反推对勘确认三端原稿均无对应章节后退出装配面，已迁往 `spec/anchor-library/` 作死块归档，不再留在活跃块库。

## 版本戳

产物头部 `<!-- GENERATED from spec@<12位sha256内容哈希>; do not edit -->`；手改产物会被新鲜度闸（generated-product-stale / build --check STALE）判红，改 spec 后运行 `node checks/build-agents.mjs` 重生成。
