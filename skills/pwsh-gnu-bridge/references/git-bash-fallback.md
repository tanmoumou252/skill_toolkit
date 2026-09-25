# Git Bash 降级与互操作

## 何时使用 Git Bash

仅在任务真正依赖 POSIX Shell 语义时使用 Git Bash，例如：

- 执行已有 `.sh` 脚本。
- 使用 Bash heredoc。
- 使用 Shell 循环、函数、进程替换或 Bash 特有展开。
- 执行由多段 `awk`、`sed` 和管道组成且已经按 POSIX Shell 编写的流程。

单个 GNU 程序可以直接从 PowerShell 7 调用，不需要仅因使用 `grep`、`awk` 或 `sed` 就启动 Git Bash。

## 根据当前执行器选择方式

- 当前执行器已经是 Git Bash：直接使用 Bash 语法，不要再套一层 `bash -c` 或先从 PowerShell 创建临时脚本。
- 当前执行器已经是 PowerShell 7：简单 GNU 命令直接调用；复杂 POSIX 脚本交给 Git Bash。
- 当前执行器未知：先依据宿主环境信息判断；只有语法差异会影响结果时才执行轻量只读检测。

不要仅根据主机是 Windows 就假定当前命令一定由 PowerShell 解析。

## 路径边界

PowerShell 通常使用 Windows 路径：

```text
C:\项目目录\My Project\input.txt
```

Git Bash 的 Shell 工具通常可以使用：

```text
/c/项目目录/My Project/input.txt
```

不要无条件转换路径。Windows 原生程序即使从 Git Bash 启动，也可能更适合接收 Windows 路径。应根据最终接收参数的程序决定路径格式，并把带空格或非 ASCII 字符的路径作为一个独立参数传递。

需要可靠转换时，可以在 Git Bash 中使用 `cygpath`，但应先确认它可用：

```bash
command -v cygpath
cygpath -w '/c/项目目录/My Project/input.txt'
```

## 从 PowerShell 7 调用 Git Bash

简单命令可以显式调用已解析的 `bash.exe` 或 `sh.exe`，但不要把复杂脚本拼接成多层 `-c` 字符串。

复杂脚本应：

1. 使用唯一临时文件名。
2. 以 UTF-8 无 BOM、LF 换行写入。
3. 通过参数传递动态值，不把用户输入插入脚本文本。
4. 检查 Git Bash 的退出码。
5. 使用 `try` 和 `finally` 清理临时文件。

不要使用固定的 `temp_task.sh`，避免并发冲突和失败后遗留。

## 从 Git Bash 调用 PowerShell 7

当前外层执行器是 Git Bash，而任务需要 PowerShell 语义时，可以显式调用：

```bash
pwsh.exe -NoLogo -NoProfile -NonInteractive -File script.ps1
status=$?
exit "$status"
```

对于复杂 PowerShell 代码，优先使用临时 `.ps1` 文件，而不是在 Bash 单引号、双引号和 PowerShell 引号之间反复转义。

## 退出码传播

跨 Shell 调用时，外层 Shell 必须传播内部命令的退出码：

- PowerShell 调用原生程序后立即读取 `$LASTEXITCODE`。
- Git Bash 调用程序后立即读取 `$?`。
- 包装脚本退出时显式返回保存的状态码。

不要在读取状态码之前运行其他原生程序，否则可能覆盖真正需要检查的结果。

## 常见错误

- PowerShell 7 已是默认终端，却重复套 `pwsh.exe -Command`。
- 当前工具已经使用 Git Bash，却再次运行 `bash -c`。
- 为单个 `grep` 或 `awk` 命令启动完整 Git Bash。
- 把 Bash heredoc、`export` 或进程替换直接写进 PowerShell。
- 把 Windows 路径机械转换成 `/c/...` 后传给 Windows 原生程序。
- 在多层命令字符串中插入用户输入。
- 使用固定临时脚本名称或忽略清理与退出码。