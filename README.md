# skill_toolkit

Windows 平台 AI 编程的技能规程、代理流水线与受控 MCP 终端集合。

## 生效方式

- 技能：将 `skills/<skill-name>/` 复制到 `~/.config/kilo/skills/`（Kilo Code）、`~/.zcode/skills/`（ZCode）或 `~/.codebuddy/skills/`（CodeBuddy）。
- 代理：将各平台 `agents/` 下文件复制到对应配置目录（Kilo Code 为 `~/.config/kilo/agents/`，ZCode 为 `~/.zcode/agents/`，CodeBuddy 为 `~/.codebuddy/agents/`）。
- MCP：将 `mcp/plan-governor.js` 以双实例（main / subagent）注册进平台配置。
- 前置依赖：便携版 PowerShell 7 与 PortableGit 解压后加入 PATH。

## 架构导航

- zcode: ZCode 平台三子代理流水线、调度纪律与 MCP 绑定
- kilocode: Kilo Code 平台独立主编排代理与双复审流水线
- codebuddy: CodeBuddy 平台三代理职责与工具名基线
- skills: 通用技能规程集（计划先行、终端互操作、提交信息等）
- mcp: plan-governor 双实例受控终端与写面引导闸
- checks: 规程文档常驻不变式自动化质检套件（零依赖自测与防漂移守卫）

## 核心入口

- ZCode 约束: zcode/AGENTS.md
- Kilo Code 约束: kilocode/AGENTS.md
- CodeBuddy 约束: codebuddy/AGENTS.md
- ZCode 主编排: zcode/agents/plan-writer-subagent-sp.md
- Kilo Code 主编排: kilocode/agents/plan-writer-sp.md
- CodeBuddy 主编排: codebuddy/agents/plan-writer-sp.md
- MCP 守卫服务: mcp/plan-governor.js
- 核心技能: skills/plan-file-first/SKILL.md

## 全局约束

- 职责边界：仅覆盖计划起草与计划/代码复审流程，不介入获批后的实现与部署。
- 三闸门分离：计划审批、执行授权、Git 集成授权独立分立，批准计划不等于执行授权。
- 产物分流：主计划落 `.kilo/plans/`，独立影子对比计划落 `.kilo/plans/review/`（以 `-shadow-plan.md` 命名），代码审查报告落 `.kilo/plans/pr-review/`，测试证据与前置基线证据落 `.kilo/plans/test-evidence/`。
- 受控终端恒定最严档：只读与测试命令静默放行，灰区与写命令一律拒绝走宿主原生交互。
- 零外部运行时依赖：Node.js >= 20，纯原生模块实现。

## 上游致谢

- 流程体系基于 SuperPower，终端规范与提交规程承接 PowerShell 7、PortableGit 与 AI Commit。
