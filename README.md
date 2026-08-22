# skill_toolkit

一些 Windows 下能更好使用 vibe coding 的 skill。

## 使用环境

本项目中的 skill 均在 Windows 下开发和使用，终端与版本控制工具均为便携版：

- **操作系统**：Windows
- **PowerShell 7（便携版）**：使用官方 ZIP 压缩包，解压到指定目录后，将该目录加入 PATH 环境变量，不依赖 MSI 安装包。
  - 上游仓库：<https://github.com/PowerShell/PowerShell>
- **Git（PortableGit 便携版）**：同样解压到一个指定目录，并将该目录加入 PATH 环境变量。
  - 上游仓库：<https://github.com/git-for-windows/git>（官网：<https://gitforwindows.org>）

也就是说，这两个核心工具都是免安装的便携版：解压 → 放到固定目录 → 把目录写进环境变量，即可在任意终端中直接调用 `pwsh` 和 `git`。

> **提示：取消内置别名，更顺手地使用 Linux 命令**
>
> PowerShell 7 默认把 `ls`、`rm`、`cp`、`mv`、`cat`、`echo` 等名字预置为内置别名（指向 `Get-ChildItem`、`Remove-Item` 等 cmdlet），这会遮蔽 PATH 中 PortableGit 提供的同名 GNU 工具（如 `ls.exe`）。特别地，如果你觉得取消掉 PowerShell 里的这些别名更有利于你直接使用 Linux 命令，可以创建（或编辑）PowerShell 的 Profile 文件，并在其中加入取消别名的命令：
>
> ```powershell
> # 创建 Profile 文件（已存在则跳过），然后编辑它
> New-Item -ItemType File -Path $PROFILE -Force
> notepad $PROFILE
>
> # 在 Profile 中加入以下内容，每次启动 pwsh 时自动移除常见内置别名
> 'ls', 'rm', 'cp', 'mv', 'cat', 'echo' | ForEach-Object {
>     Remove-Item "Alias:$_" -ErrorAction SilentlyContinue
> }
> ```
>
> 相关的别名冲突排查方法见下方 `pwsh-gnu-bridge` 技能。

## 宿主 Code 工具与技能安装目录

这些 skill 在两个 AI 编程工具中使用，安装方式就是把对应的 skill 文件夹复制进它们的技能目录：

| 工具 | 技能安装目录 |
| --- | --- |
| Kilo Code | 用户级：`~/.config/kilo/skills/<skill-name>/` |
| ZCode | 用户级：`~/.zcode/skills/<skill-name>/` |

## 技能列表

### pwsh-gnu-bridge

Windows 下 PowerShell 7 与 GNU 工具互操作规范：约束 PowerShell 7 命令的生成与执行，说明何时按需组合 PortableGit 提供的 GNU 工具，并处理别名冲突、路径、引号、编码、换行符与退出码等跨 Shell 问题。

- 参考项目：<https://github.com/chongchong59699/powershell7-safe-invocation-cn>

### git-commit-msg

生成规范化的 git commit 信息（emoji + Conventional Commits 类型 + 中文 subject/body），并可直接完成 add/commit 操作。

- 参考项目：<https://github.com/Sitoi/ai-commit>
- 特别说明：本 skill 只参考了它的提示词。AI Commit 是一个 VS Code 插件，用它生成提交信息时会受插件 30 秒超时时间的限制，所以才有了这个 skill——在编程工具里使用同一套提示词来完成提交工作，不受插件超时限制。
  - 额外说明，它会在 .kilo/plans/commit_msg.md 写入提交消息供预览。

### plan-file-first

强制执行“计划文件先行、执行授权隔离”的工作流：任何实现任务必须先将计划真实写入工作区的 `.kilo/plans/`，再等待独立的执行授权。

- 主要面向 ZCode：ZCode 的计划文件原本只存在于上下文中；后续更新虽然会把计划写入工作区，但用的是 `plan-sess_<会话UUID>.md` 这类乱码文件名，不利于人类找到当前准确的计划。本 skill 让计划以可读的时间戳+主题文件名真实落盘，便于审阅与追溯。尽管时间戳功能好像不太正常，zcode调用该skill生成的文件名的时间戳和kilocode计划模式写的计划文件名上的时间戳不太一样。
