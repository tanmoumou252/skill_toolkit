---
name: pwsh-gnu-bridge
description: >
  在 Windows 上生成或执行任何终端命令前使用。覆盖 PowerShell 7 / pwsh 命令编写调试、调用 git、node、npm、python 等原生程序、使用 PortableGit 的 grep、awk、sed、ls、rm 等 GNU 工具、判断 POSIX 脚本是否需要 Git Bash。用于排查症状：ls -la、rm -rf、cp -r 等 GNU 参数报错，提示找不到与参数名称匹配的参数，不是 cmdlet 的名称，ParameterBindingException，别名冲突，Get-Command 解析，Remove-Alias 与 Profile，NoProfile，中文乱码，UTF-8 BOM，CRLF/LF 换行，$LASTEXITCODE 退出码，heredoc，export，进程替换，.sh 脚本，含空格或非 ASCII 路径，引号与参数传递，递归删除、覆盖等高风险文件操作。即使宿主已有基础 shell 提示仍需加载：本技能额外覆盖别名解析与 Profile 状态、编码分层、退出码传播、Git Bash 适用边界、高风险操作的路径包含性校验。
---

# PowerShell 7 与 GNU 工具互操作规范

## 核心定位

本技能约束 Windows 环境下 PowerShell 7 命令的生成与执行，并说明如何按需组合 PortableGit 提供的 GNU 工具。

目标环境通常已将 PowerShell 7 配置为默认终端。宿主明确当前 Shell 是 PowerShell 7 时，直接编写 PowerShell 7 命令，不要为每条命令重复包装 `pwsh.exe -Command`。

不要把以下环境混为一谈：

- `pwsh.exe` 是 PowerShell 7。
- `powershell.exe` 通常是 Windows PowerShell 5.1。
- Git Bash、`bash.exe` 和 `sh.exe` 解释 POSIX Shell 语法。
- GNU 单体程序可以从 PowerShell 7 调用，但这不会让 PowerShell 自动支持 Bash 语法。

如果宿主明确使用 Git Bash、CMD 或其他执行器，应按该执行器的语法编写外层命令。只有任务确实需要 PowerShell 语义时，才显式调用 `pwsh.exe`。

## 最小干涉原则

本技能是命令生成前的检查规范，不是输出模板。加载后：

- 本技能一旦在当前会话加载即持续生效，不需要在后续每条命令前重复加载。
- 宿主已给出环境信息、且待执行命令本身已经正确时，静默通过，直接执行。
- 不要因为加载了本技能就额外输出规范说明、环境分析或选型理由。
- 不要重写已经清晰、安全、可用的命令，也不要为了体现 GNU 工具可用而替换正常的 PowerShell 写法。
- 不要重复执行 `Get-Command`、`$PSVersionTable` 等探测；同一会话内已确认的结论直接复用。
- 只有命令确实存在解析歧义、跨 Shell 风险或不可逆后果时，才展开说明并调整写法。

## 能力选择顺序

1. 读取、精确编辑和写入文件时，优先使用宿主提供的专用工具。
2. Windows 路径、对象管道、进程、服务和安全文件操作优先使用 PowerShell cmdlet。
3. `git`、`node`、`npm`、`python` 等原生程序直接从 PowerShell 调用。
4. `grep`、`awk`、`sed`、`head`、`tail`、`wc`、`sort`、`uniq` 等 GNU 工具只在文本流处理确实更清晰时使用。
5. Bash heredoc、复杂 POSIX 流程、Shell 循环、进程替换或现有 `.sh` 脚本交给 Git Bash。

不要为了体现 GNU 工具可用而强行替换清晰、安全的 PowerShell 写法。

## 默认终端判断

优先相信宿主提供的环境信息，不要无意义地重复探测：

- 宿主明确默认 Shell 是 PowerShell 7：直接执行 PowerShell 7 命令。
- 宿主明确当前工具使用 Git Bash：外层命令按 Bash 语法编写；需要 PowerShell 时显式调用 `pwsh.exe`。
- 宿主未说明 Shell，且语法差异会影响结果：进行轻量只读检测。

PowerShell 7 中可使用：

```powershell
$PSVersionTable.PSVersion
$PSNativeCommandArgumentPassing
Get-Command pwsh, grep, awk -ErrorAction SilentlyContinue
```

不要静默把复杂 PowerShell 7 脚本退回 `powershell.exe` 执行。

## PowerShell 7 命令原则

- 真实文件路径优先使用 `-LiteralPath`；只有故意使用通配符时才使用 `-Path`。
- 复杂 cmdlet 参数使用 splatting。
- 需要失败即停止时，使用 `$ErrorActionPreference = 'Stop'` 和关键 cmdlet 的 `-ErrorAction Stop`。
- 调用原生程序时使用参数数组，不拼接包含用户输入的命令字符串。
- 普通前台程序使用调用运算符 `&`，不要无故使用 `Start-Process` 或 `cmd.exe /c`。
- 不习惯性添加 `-ExecutionPolicy Bypass`。

```powershell
$exe = 'git'
$args = @('-C', 'C:\项目目录\My Project', 'status', '--short')
& $exe @args
if ($LASTEXITCODE -ne 0) {
    throw "git failed with exit code $LASTEXITCODE"
}
```

更多路径、引号、参数传递、进程和安全文件操作规则见 references/powershell7-command-rules.md。

## GNU 工具不是 PowerShell 别名

PowerShell 中的 `ls`、`rm`、`cp`、`cat`、`curl` 等名称可能解析为别名、cmdlet或外部程序。GNU 参数不能直接假定适用于同名 PowerShell 命令。

出现 `ls -la`、`rm -rf` 等参数错误时，先检查解析结果：

```powershell
Get-Command ls -All
Get-Command rm -All
Get-Command grep -All
```

然后选择：

- 使用清晰的 PowerShell cmdlet及其参数。
- 或调用已经确认来源的 GNU 可执行程序。

不得猜测 `ls.exe`、`rm.exe` 一定存在，也不得把别名冲突错误归因于 `-NoProfile`。

GNU 工具的命令解析、文本管道和引号规则见 references/gnu-tools-in-pwsh.md。

## PowerShell 别名移除与 GNU 工具解析

个人环境中，用户可能在 PowerShell 7 Profile 中移除与 GNU 工具同名的别名：

```powershell
Remove-Alias -Force -ErrorAction SilentlyContinue ls
Remove-Alias -Force -ErrorAction SilentlyContinue cp
Remove-Alias -Force -ErrorAction SilentlyContinue mv
Remove-Alias -Force -ErrorAction SilentlyContinue rm
Remove-Alias -Force -ErrorAction SilentlyContinue cat
```

此配置适合 PowerShell 7 默认终端且 PortableGit GNU 工具已进入 PATH 的个人环境，但不得作为所有会话和其他 Agent 的通用前提。

### 别名移除后的处理规则

- 宿主明确当前会话已加载该 Profile、别名已移除且 GNU 工具在 PATH 时，可以直接使用相应 GNU 命令，不需要每次重新执行 `Remove-Alias`。
- 不得擅自修改用户 Profile。上述五条仅作为可选 Profile 配置参考，写入时需用户明确授权。
- 环境未知、首次依赖 GNU 参数语义或执行高风险操作前，使用 `Get-Command ls,cp,mv,rm,cat -All` 或逐项 `Get-Command` 检查实际解析目标。
- `pwsh.exe -NoProfile` 不加载用户 Profile，因此必须按该会话自己的解析结果处理，不得假定该会话中别名已被移除或 GNU 工具已优先。
- 别名存在时 `rm` 解析为 `Remove-Item`，别名移除后 `rm` 可能解析到 GNU `rm.exe`，但两者都不能绕过删除安全检查，仍不得默认推荐 `rm -rf`。
- 可移植脚本应使用完整 PowerShell cmdlet 名称（如 `Remove-Item`、`Copy-Item`、`Get-Content`）或已确认路径的 GNU 外部程序（如 `C:\Program Files\Git\usr\bin\rm.exe`），不依赖 Profile 状态。

## Git Bash 的适用边界

PowerShell 7 更现代、更强大，但不会自动获得完整 Bash 语法。以下场景才使用 Git Bash：

- Bash heredoc。
- 复杂 `.sh` 脚本。
- POSIX Shell 循环、函数或进程替换。
- 强依赖 Bash 展开和管道行为的流程。

当前执行器本身已经是 Git Bash 时，直接使用其 Bash 能力，不要再从 PowerShell 创建临时 `.sh` 文件。当前执行器是 PowerShell 7 且脚本较复杂时，使用唯一临时脚本、LF 换行和可靠清理，不要拼接脆弱的多层 `sh -c` 字符串。

详见 references/git-bash-fallback.md。

## 编码、换行和状态判断

- PowerShell 7 的 UTF-8 行为比 Windows PowerShell 5.1 更一致，但控制台编码、管道编码、原生程序编码和文件编码仍是不同问题。
- 不要看到中文乱码就只修改 `$OutputEncoding`；先确定乱码发生在哪一层。
- 需要 UTF-8 无 BOM 和 LF 时，使用经过验证的文件写入方式，并进行字节级或换行验证。
- 原生程序完成后立即读取 `$LASTEXITCODE`，避免使用陈旧值。
- 不使用 `$LASTEXITCODE` 判断 cmdlet 成败。关键 cmdlet 应转换为终止错误并通过异常处理。
- 跨 Shell 调用必须显式传播内部命令的退出码。

详见 references/encoding-exit-codes.md。

## 高风险操作

递归删除、移动、覆盖、批量替换或终止进程前：

1. 解析目标和预期根目录的绝对路径。
2. 验证目标确实位于预期根目录内部，不能只做字符串前缀比较。
3. 拒绝空路径、磁盘根目录、用户主目录和工作区根目录等高风险目标，除非用户明确要求。
4. 先检查目标，再执行不可逆操作。
5. 操作后验证结果。

不要把 `rm -rf`、`sed -i` 或强制覆盖作为默认推荐。

## 缺少仓库约束文件时

可以只读查找 `AGENTS.md`、`CLAUDE.md`、README、贡献指南、项目脚本和附近目录中的约束文件。

如果没有找到：

- 不臆造项目规则。
- 不因此默认生成 Linux 命令。
- 继续遵循宿主系统指令、已加载技能、仓库配置、项目脚本和附近代码模式。

本技能不能覆盖宿主权限、计划审批、Git保护规则或专用工具优先级。

## 常见错误信号

看到以下情况时先停止并重新判断执行器和命令解析：

- 默认终端已经是 PowerShell 7，却又为整条命令套 `pwsh.exe -Command`。
- 在 PowerShell 中直接写 `ls -la` 或 `rm -rf`，但没有确认命令解析结果。
- 把 Bash heredoc、`export` 或进程替换当作 PowerShell 语法。
- 用 `$LASTEXITCODE` 判断 `Copy-Item`、`Remove-Item` 等 cmdlet。
- 使用固定临时脚本名称，且失败时没有清理。
- 将带空格或非 ASCII 的路径拼入命令字符串。
- 命令已经正确，却仍被反复重写、反复解释或反复探测环境。
