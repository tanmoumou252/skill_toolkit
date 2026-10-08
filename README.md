# skill_toolkit

Windows 平台 AI 编程的技能规程、代理流水线与受控 MCP 终端集合。

## 编译产物（重要）

三端 12 份平台文件（3×AGENTS.md + 9×agents）是编译产物：由 `node checks/build-agents.mjs` 从 `spec/blocks/` 与 `spec/platform/*/manifest.json` 生成，头部带 `<!-- GENERATED from spec@<hash> -->` 版本戳，手改会被新鲜度闸（`node checks/build-agents.mjs --check`）判红。修改入口在 `spec/`，改完重生成。

## 分层修改指南

| 改什么 | 去哪里改 |
|---|---|
| 机器执法规则 | `checks/registry.mjs` |
| 三端 AGENTS.md 共享散文 | `spec/blocks/agents-md-*.md` |
| 三端差异（插槽值） | `spec/platform/*/manifest.json` 的 `slots` |
| agents 角色散文（三端共享） | `spec/blocks/body-shared-*.md` |
| zcode plan-writer 独有散文 | `spec/blocks/body-zcode-plan-writer.md` |
| agents frontmatter | manifest 的 `frontmatter` 字段 |
| zcode 独有 AGENTS 块（直连派发参数头） | `spec/blocks/direct-dispatch-header.md`（经 zcode manifest 的 `AGENTS.md` 条目装配；执法条款「直连派发参数头」见 `checks/registry.mjs`） |

收尾三连：`node checks/build-agents.mjs` → `node checks/run.mjs` → `node checks/build-agents.mjs --check`。

## 生效方式

- 技能：将 `skills/<skill-name>/` 复制到 `~/.config/kilo/skills/`（Kilo Code）、`~/.zcode/skills/`（ZCode）或 `~/.codebuddy/skills/`（CodeBuddy）。
- 平台文件：将各平台 `AGENTS.md` 与 `agents/` 复制到对应配置目录（Kilo Code 为 `~/.config/kilo/`，ZCode 为 `~/.zcode/`，CodeBuddy 为 `~/.codebuddy/`）。安装仍是复制；这些文件是编译产物，修改必须改 `spec/` 后重生成，不得直改本仓产物。
- MCP：将 `mcp/plan-governor.js` 以双实例（main / subagent）注册进平台配置。
- 前置依赖：便携版 PowerShell 7 与 PortableGit 解压后加入 PATH。

## 架构导航

- zcode: ZCode 三子代理流水线（约束: zcode/AGENTS.md；主编排: zcode/agents/plan-writer-subagent-sp.md）
- kilocode: Kilo Code 独立主编排与双复审流水线（约束: kilocode/AGENTS.md；主编排: kilocode/agents/plan-writer-sp.md）
- codebuddy: CodeBuddy 三代理职责与工具名基线（约束: codebuddy/AGENTS.md；主编排: codebuddy/agents/plan-writer-sp.md）
- skills: 通用技能规程集（核心: skills/plan-file-first/SKILL.md）
- mcp: plan-governor 双实例受控终端（守卫服务: mcp/plan-governor.js）
- checks: 规程文档常驻不变式自动化质检套件（零依赖自测与防漂移守卫）

## 全局约束

- 职责边界：仅覆盖计划起草与计划/代码复审流程，不介入获批后的实现与部署。
- 三闸门分离：计划审批、执行授权、Git 集成授权独立分立，批准计划不等于执行授权。
- 产物分流：主计划落 `.kilo/plans/`，独立影子对比计划落 `.kilo/plans/review/`（以 `-shadow-plan.md` 命名），代码审查报告落 `.kilo/plans/pr-review/`，测试证据与前置基线证据落 `.kilo/plans/test-evidence/`。
- 受控终端恒定最严档：只读与测试命令静默放行，灰区与写命令一律拒绝走宿主原生交互。
- 零外部运行时依赖：Node.js >= 20，纯原生模块实现。

## 上游致谢

- 流程体系基于 [SuperPower](https://github.com/obra/superpowers)，终端规范与提交规程承接 PowerShell 7 [案例](https://github.com/chongchong59699/powershell7-safe-invocation-cn)、PortableGit 与 [AI Commit](https://github.com/Sitoi/ai-commit)。
- PR 审查规程与判定哲学深度吸纳 [pr-agent](https://github.com/The-PR-Agent/pr-agent)。
