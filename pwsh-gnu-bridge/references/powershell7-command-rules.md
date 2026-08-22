# PowerShell 7 命令规则

## 路径处理

- 对真实路径优先使用 `-LiteralPath`，仅在明确需要通配符时使用 `-Path`。
- 带空格、方括号、中文或其他非 ASCII 字符的路径应作为单独参数传递，不要拼接进命令字符串。
- 复杂 cmdlet 参数优先使用 splatting。

```powershell
$params = @{
    LiteralPath = 'C:\项目目录\Data[1]\input.txt'
    Destination = 'C:\项目目录\Output Folder'
    ErrorAction = 'Stop'
}

Copy-Item @params
```

## 原生程序调用

普通前台原生程序使用调用运算符和参数数组：

```powershell
$exe = 'git'
$args = @('-C', 'C:\项目目录\My Project', 'status', '--short')
& $exe @args
if ($LASTEXITCODE -ne 0) {
    throw "git failed with exit code $LASTEXITCODE"
}
```

不要把含用户输入、复杂路径、JSON 或正则的参数拼接成单个命令字符串。不要为了调用普通程序额外套 `cmd.exe /c`。

## Cmdlet 错误处理

关键操作应把非终止错误转换为终止错误：

```powershell
$ErrorActionPreference = 'Stop'
Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
```

不要使用 `$LASTEXITCODE` 判断 cmdlet、函数或 PowerShell 表达式是否成功。需要捕获错误时使用 `try` 和 `catch`。

## 引号与变量

- 单引号字符串按字面值处理，适合不需要 PowerShell 变量展开的正则和 GNU 程序片段。
- 双引号字符串会展开 `$variable` 和 `$()`，只在确实需要插值时使用。
- 传给 `awk` 的 `$1`、`$2` 等字段表达式通常需要置于 PowerShell 单引号中。
- 当参数本身包含单引号、多层正则、JSON 或多层 Shell 语法时，优先写临时 `.ps1` 或 `.sh` 文件，不继续堆叠转义。

```powershell
git log --oneline | awk '{print $1}'
grep -E '^[A-Za-z]+$' src/index.ts
```

示例中的参数名称必须替换为目标程序真实支持的参数，不能把 PowerShell 参数格式套给 GNU 程序。

## `Start-Process` 的边界

普通前台执行不使用 `Start-Process`。只有需要提权、新窗口、隐藏窗口、文件关联或进程分离时才使用它。

`Start-Process -ArgumentList` 会重新组合参数，复杂参数边界应使用 `ProcessStartInfo.ArgumentList`：

```powershell
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $exe
$psi.UseShellExecute = $false
foreach ($arg in $args) {
    $psi.ArgumentList.Add($arg)
}

$process = [System.Diagnostics.Process]::Start($psi)
$process.WaitForExit()
if ($process.ExitCode -ne 0) {
    throw "Process failed with exit code $($process.ExitCode)"
}
```

## 多行脚本

当命令包含多行逻辑、JSON、XML、复杂正则、here-string、非 ASCII 路径或批量文件变更时，优先写唯一命名的临时 `.ps1` 文件，然后使用：

```text
pwsh.exe -NoLogo -NoProfile -NonInteractive -File <script.ps1>
```

仅在当前执行器不是 PowerShell 7 且任务确实需要 PowerShell 语义时显式启动 `pwsh.exe`。默认终端已经是 PowerShell 7 时，不要重复包装。

## 高风险文件操作

递归删除、移动或覆盖前必须：

1. 解析预期根目录与目标路径的绝对路径。
2. 使用路径语义验证目标位于预期根目录内部，不能只使用字符串 `StartsWith`。
3. 拒绝空路径、磁盘根目录、用户主目录和工作区根目录等高风险目标。
4. 操作前检查目标，操作后验证结果。
5. 临时资源使用唯一名称，并通过 `try` 和 `finally` 清理。

不要默认推荐 `Remove-Item -Recurse -Force`、`rm -rf`、`sed -i` 或强制覆盖。只有目标已经检查且操作得到授权时才能使用。