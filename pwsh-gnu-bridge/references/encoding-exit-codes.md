# PowerShell 7 编码、换行与退出码

## 先定位编码问题发生在哪一层

PowerShell 7 的 UTF-8 默认行为比 Windows PowerShell 5.1 更一致，但以下层次彼此独立：

- PowerShell 控制台输入与输出编码。
- PowerShell 向原生程序传递文本时使用的编码。
- 原生程序自身读取和输出文本时使用的编码。
- 文件实际保存的编码及 BOM。
- 文件使用 CRLF 还是 LF 换行。

遇到中文乱码时，不要直接假定设置 `$OutputEncoding` 就能解决。应先确定乱码发生在控制台显示、PowerShell 管道、原生程序输出还是文件读取阶段。

## 控制台和原生程序管道

需要检查当前设置时，可以使用：

```powershell
$InputEncoding
$OutputEncoding
```

如确实需要统一为 UTF-8，可在当前 PowerShell 7 会话中设置：

```powershell
$utf8 = [System.Text.UTF8Encoding]::new($false)
$InputEncoding = $utf8
$OutputEncoding = $utf8
```

这只影响相应的控制台或管道边界，不会自动修改已有文件的编码，也不能修复原生程序内部使用了错误编码的问题。

## UTF-8 无 BOM 与 LF 文件

需要稳定写入 UTF-8 无 BOM、LF 换行的文件时，显式构造内容和编码：

```powershell
$lines = @(
    'DATABASE_URL=postgres://localhost:5432/mydb'
    'REDIS_URL=redis://localhost:6379'
)

$content = ($lines -join "`n") + "`n"
$encoding = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($path, $content, $encoding)
```

写入前应确保父目录存在，并验证目标路径位于预期工作范围。不要把未经验证的 `Set-Content -NewLine` 参数当作通用解决方案。

写入后可以检查 BOM 和 CRLF：

```powershell
$bytes = [System.IO.File]::ReadAllBytes($path)
$hasUtf8Bom = $bytes.Length -ge 3 -and
    $bytes[0] -eq 0xEF -and
    $bytes[1] -eq 0xBB -and
    $bytes[2] -eq 0xBF

$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
$hasCrLf = $text.Contains("`r`n")

if ($hasUtf8Bom -or $hasCrLf) {
    throw 'File encoding or line endings do not match the requirement.'
}
```

## 原生程序退出码

`git`、`node`、`npm`、`python` 和 GNU 工具属于原生程序。调用后立即保存 `$LASTEXITCODE`：

```powershell
& git status --short
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    throw "git failed with exit code $exitCode"
}
```

必须立即读取，因为后续原生程序可能覆盖 `$LASTEXITCODE`。不要使用以前命令遗留的值判断当前操作。

## PowerShell cmdlet 错误

不要使用 `$LASTEXITCODE` 判断 `Copy-Item`、`Remove-Item`、`Set-Content` 等 cmdlet。关键操作应产生终止错误：

```powershell
$ErrorActionPreference = 'Stop'

try {
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
}
catch {
    throw "Copy failed: $($_.Exception.Message)"
}
```

`$?` 只表示最近一次 PowerShell 操作是否成功，容易被后续表达式覆盖。关键流程优先使用终止错误和 `try`、`catch`，不要依赖较远位置的 `$?`。

## 跨 Shell 退出码传播

PowerShell 调用原生程序时：

```powershell
& $exe @args
$exitCode = $LASTEXITCODE
exit $exitCode
```

Git Bash 调用程序时：

```bash
command arg1 arg2
status=$?
exit "$status"
```

包装层必须返回内部命令的真实退出码。不要在保存状态码之前执行清理命令；需要清理时，先保存状态，再清理，最后退出。

## 流水线注意事项

混合 PowerShell 对象管道和原生文本管道时，需要明确最终检查哪个程序的结果。不要假定流水线中任意环节失败都会自动变成 PowerShell 终止错误。

如果每个环节都必须成功，复杂流程应拆开执行并分别检查状态，或使用能够明确传播失败状态的脚本结构。

## 常见错误

- 看到中文乱码就无条件设置 `$OutputEncoding`。
- 把控制台编码、文件编码和原生程序编码当成同一件事。
- 声称 `Set-Content -Encoding utf8` 在所有 PowerShell 版本中行为完全一致。
- 需要 LF 时只依赖当前平台默认换行。
- 使用 `$LASTEXITCODE` 判断 cmdlet。
- 在检查 `$LASTEXITCODE` 之前又运行另一个原生程序。
- 跨 Shell 包装后忽略内部程序的退出码。