# 在 PowerShell 7 中使用 GNU 工具

## 基本原则

PortableGit 提供的 GNU 工具可以从 PowerShell 7 调用，但外层语法仍由 PowerShell 解析。GNU 程序可用不代表 PowerShell 自动支持 Bash 语法。

仅在文本流处理通过 GNU 工具表达得更清晰时使用 `grep`、`awk`、`sed`、`head`、`tail`、`wc`、`sort`、`uniq` 等程序。Windows 路径、安全文件操作和对象处理通常更适合 PowerShell cmdlet。

## 检查命令解析结果

`ls`、`rm`、`cp`、`cat`、`curl`、`find` 等名称可能解析为 PowerShell 别名、cmdlet 或外部程序。使用 GNU 参数前先确认实际目标：

```powershell
Get-Command ls -All
Get-Command rm -All
Get-Command grep -All
Get-Command awk -All
```

不要假定 `ls.exe`、`rm.exe` 或其他同名可执行文件一定存在，也不要把别名冲突归因于 `-NoProfile`。

### 别名移除与 Profile 状态

用户可能在 PowerShell 7 Profile 中通过 `Remove-Alias` 移除 `ls`、`cp`、`mv`、`rm`、`cat` 别名，使这些名称直接解析到 GNU 工具。此配置仅适用于已确认的个人环境，不得作为通用前提。

- 宿主明确当前会话已加载该 Profile 且 GNU 工具在 PATH 时，可直接使用 GNU 命令，无需重复执行 `Remove-Alias`。
- 环境未知或首次使用 GNU 参数前，使用 `Get-Command ls,cp,mv,rm,cat -All` 检查实际解析目标（`Get-Command` 在允许键集内（见 SKILL.md「允许（只读取证与测试，单行平铺直调）」清单）；WHITELIST 下优先以宿主内置 Grep/Glob 完成同款排查）。
- `pwsh.exe -NoProfile` 不加载 Profile，必须按该会话自己的解析结果处理。
- 别名移除后 `rm` 可能解析到 GNU `rm.exe`，但删除操作仍须遵守安全规则，不得默认推荐 `rm -rf`。
- 可移植脚本应使用完整 PowerShell cmdlet 名称或已确认路径的外部程序，不依赖 Profile 状态。

## 文本管道

PowerShell 可以把原生程序的文本输出传给 GNU 工具：

```powershell
git status --short | grep 'M '          # 宿主正例（两段均在 allow 键集）；MCP 受控通道亦放行（纯白名单只读管道例外）
git log --oneline | awk '{print $1}'    # awk* 禁入清单：宿主落 Ask 属预期，MCP 受控通道直接硬拒（非 Ask），禁申请加键；只读首选 grep
```

注意以下边界：

- PowerShell 对象经过原生程序边界时会转换为文本。
- GNU 工具输出重新进入 PowerShell 后也是文本，不会保留原始 PowerShell 对象类型。
- 需要结构化属性、排序和筛选时，优先使用 PowerShell 对象管道。
- 需要逐行正则和传统 UNIX 文本处理时，可以使用 GNU 工具。
- 白名单边界：`awk*`、`sed*`、`sort*`、`uniq*`、`xargs*` 不得加入宿主 allow 白名单——`xargs` 可执行任意后续命令（如 `xargs rm`）、`sed -i` 原地改写文件、`sort -o` 写出文件、`awk` 可经 `print | "cmd"` 管道间接执行外部命令，均非真只读；保持未命中白名单统一落 Ask 即为期望行为。

## 引号与变量展开

PowerShell 单引号不会展开 `$variable`、`$1` 或 `$()`，因此适合大多数 GNU 正则和 `awk` 程序：

```powershell
grep -E '^[A-Za-z]+$' src/index.ts
awk '{print $1}' input.txt
```

这不是无条件规则。如果表达式需要 PowerShell 插值，或参数本身包含单引号、JSON、多层正则或另一层 Shell 语法，应使用参数变量、参数数组或临时脚本，避免持续堆叠转义。

## 文件修改

`sed -i` 属禁入清单（原地改写文件），`rm*` 属 deny 键集——都不要作为默认方式。文件创建与修改一律宿主专用编辑/写入工具；如果必须批量修改，应先限定目标范围、检查匹配内容、保留可审阅的变更，并在修改后验证结果（批量通道仅适用于人工授权场景）。

同样，不要默认推荐 `rm -rf`。递归删除前必须检查绝对路径、验证目标位于预期根目录内，并排除磁盘根目录、用户主目录和工作区根目录。

## 选择建议

- 查看和筛选文本：GNU 工具或 PowerShell 均可，选择更清晰的一种。
- 操作 PowerShell 对象：使用 PowerShell cmdlet。
- 操作 Windows 文件路径：优先使用带 `-LiteralPath` 的 PowerShell cmdlet。
- 执行已有 `.sh` 脚本或复杂 POSIX 语法：使用 Git Bash。
- 普通文件读取和精确替换：优先使用宿主专用工具，而不是 Shell 命令。