# CodeBuddy Agents

CodeBuddy 平台 SuperPower 计划工程三代理：主编排器与双独立复审子代理。

## 职责边界

- 负责：主计划起草与回灌、落盘计划独立复审、未提交 diff 对抗式审查。
- 不负责：命令黑白名单（单源维护于 `mcp/plan-governor.js`）；审查规范本体（内嵌于各代理文件）。

## 核心入口

- 主编排器: `agents/plan-writer-sp.md`
- 计划复审: `agents/plan-reviewer-sp.md`
- 代码复审: `agents/pr-reviewer-sp.md`

## 消费/调用约定

被宿主作为自定义代理加载，工具名以 `agents/` 各代理文件文末「本客户端工具名基线」为准（`write_to_file` / `replace_in_file` / `read_file` / `search_content` / `search_file` 等）。主编排器需手动切换，子代理通过 `task` 派发。

## 生效方式

将 `agents/` 下文件复制到 `~/.codebuddy/agents/`。MCP 双实例注册见 `mcp/README.md`。

## 注意事项与暗坑

- 本客户端无 `plan_exit`，交付方式为口头呈报加路径交付。
- MCP 写蜜罐工具恒拒，落盘必须走宿主原生写工具。
- 产物目录分流：Writer 写入 `.kilo/plans/`，独立影子对比计划写入 `.kilo/plans/review/`（以 `-shadow-plan.md` 命名），代码审查报告写入 `.kilo/plans/pr-review/`，测试证据与前置基线证据写入 `.kilo/plans/test-evidence/`。
