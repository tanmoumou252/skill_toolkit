# skills

通用技能规范与安装路径映射：覆盖计划工作流、Windows 终端互操作、提交信息生成与文档规范。

## 职责边界

- 负责：技能规范本体与各平台安装路径映射。
- 不负责：平台专属调度细节（见各平台 AGENTS.md）；受控命令执行执法（单源维护于 `mcp/plan-governor.js`）。

## 核心入口

| 技能 | 作用 | 入口文件 |
| --- | --- | --- |
| plan-file-first | 计划先行与三闸门分离 | `skills/plan-file-first/SKILL.md` |
| zcode-plan-first | ZCode 识别即分派与落盘校验闭环 | `skills/zcode-plan-first/SKILL.md` |
| pwsh-gnu-bridge | PowerShell 7 与 PortableGit 工具互操作 | `skills/pwsh-gnu-bridge/SKILL.md` |
| git-commit-msg | 规范提交信息生成 | `skills/git-commit-msg/SKILL.md` |
| lean-readme | 极简分级路标型 README 规范 | `skills/lean-readme/SKILL.md` |

## 消费/调用约定

由平台宿主按匹配规则自动加载。安装路径：Kilo 复制到 `~/.config/kilo/skills/<name>/`，ZCode 复制到 `~/.zcode/skills/<name>/`，CodeBuddy 复制到 `~/.codebuddy/skills/<name>/`；`references/` 目录随技能整体复制。

## 注意事项与暗坑

- `zcode-plan-first` 自足内含三闸门分离语义，仅供 ZCode 主会话/任务模式使用。
- `git-commit-msg` 是纯提交消息生成器：仅输出 commit 正文与提交命令原文，不执行任何 Git 写操作；提交/推送恒为人类在宿主终端的特权。
- 《命令边界总表》在 `pwsh-gnu-bridge` 与 `plan-file-first` 中作为参考性设计基线维护；终端放行与拦截的单源权威为 `mcp/plan-governor.js`，新增或调整命令以 `plan-governor.js` 为准，无需执行多源同步。此「无需多源同步」仅豁免 skills 文档里的参考性命令基线表，**不豁免运行时被消费的展示元数据**——例如 `mcp/webui.js` 的 `STRUCTURE_GATES` 显示闸清单由 WebUI 实际渲染供操作者安全自审，必须与 `plan-governor.js` 执法闸逐一同步，并由不变量断言钉死防漂移。
