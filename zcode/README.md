# zcode

ZCode 平台的三子代理计划流水线，解决原生计划模式产物不落盘与批准即执行问题。

## 职责边界

- 负责：计划起草与回灌（Writer）、落盘计划独立复审（Plan-Reviewer）、未提交 diff 对抗式审查（PR-Reviewer）、主会话调度纪律。
- 不负责：命令黑白名单（单源维护于 `mcp/plan-governor.js`）；通用授权语义（见 `skills/plan-file-first`）。

## 核心入口

- 计划起草: `agents/plan-writer-subagent-sp.md`
- 计划复审: `agents/plan-reviewer-subagent-sp.md`
- 代码复审: `agents/pr-reviewer-subagent-sp.md`

## 消费/调用约定

主会话任务模式四步调度：分派 Writer 落盘 → 分派 Reviewer 复审 → Read 校验产物物理在场 → Writer 回灌后呈报审批。代理类型名必须逐字精确匹配；完整调度规程见 `skills/zcode-plan-first`。

## 生效方式

将 `agents/` 下文件复制到 `~/.zcode/agents/`；将 `skills/` 下相关技能复制到 `~/.zcode/skills/`；将 `AGENTS.md` 放置于仓库根目录或 `~/.zcode/AGENTS.md`。MCP 双实例注册见 `mcp/README.md`。

## 注意事项与暗坑

- 批准计划后宿主可能自动切至 YOLO 模式；受控通道与宿主档位解耦，恒按最严档执法。
- 子代理设 `dontAsk` 免确认，依赖提示词自律；命令执法下沉至 MCP 双实例。
- 产物按目录分流（主计划 `.kilo/plans/`、独立影子对比计划 `.kilo/plans/review/`（以 `-shadow-plan.md` 命名）、代码审查 `.kilo/plans/pr-review/`、测试证据 `.kilo/plans/test-evidence/`），注意定期归档。
