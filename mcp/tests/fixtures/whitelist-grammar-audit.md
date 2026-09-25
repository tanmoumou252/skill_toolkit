# 存量白名单逐键审计报告 — 20260924-194043

- **位置说明**：本报告为 `mcp/tests/whitelist-audit.mjs` 的受跟踪测试夹具（PR 审查 E1 修正：原落 `.kilo/plans/test-evidence/` 属 Git 忽略目录，会导致 `npm test --prefix mcp` 在干净检出上必红；已迁至受跟踪路径 `mcp/tests/fixtures/`）。
- **审计对象**：`mcp/plan-governor.js` 的 `ALLOW_KEYS`（76 键）、`DENY_KEYS`（50 键）、`FORBIDDEN_KEYS`（11 键）。
- **审计方法**：offline `auditCommand`（`createRequire` 直调模块导出，零派生进程）逐键枚举"写/执行形态"并实测裁决；Cmdlet 参数类型经 T 盘沙箱 `Get-Command <name> -Syntax` 实测；标为可强转的参数经沙箱脚本块（ScriptBlock）强转探针实测。
- **审计性质**：**只读调查**，不修改业务代码；发现的漏洞不在本计划修复（发现即另立计划）。
- **审计结论**：**0 个直通漏洞**。全部写/执行形态均 DENY；全部只读形态均 ALLOW（无误拒）。

## 一、逐键审计表（76 行）

"裁决"为 offline `auditCommand` 实测结果；`DENY` = 该命令的写/执行形态被拒（期望），`ALLOW` = 只读形态放行（期望，验证无误拒）。

| # | 键 | 家族 | 该命令的写/执行形态（按官方语法枚举） | 裁决 | 探针回执（命令原文） |
| --- | --- | --- | --- | --- | --- |
| 1 | `git status*` | git | 无（纯查询，无写/执行参数） | ALLOW | `git status --porcelain` |
| 2 | `git log*` | git | 写 `--output=FILE`；执行 `--ext-diff` / `--textconv` | DENY | `git log --output=out.txt`；`git log --ext-diff`；`git log --textconv` |
| 3 | `git diff*` | git | 写 `--output=FILE`；执行 `--ext-diff` | DENY | `git diff --output=out.txt`；`git diff --ext-diff` |
| 4 | `git show*` | git | 执行 `--ext-diff` / `--textconv`；写 `--output=FILE` | DENY | `git show --ext-diff`；`git show --textconv README.md`；`git show --output=out.txt` |
| 5 | `git rev-parse*` | git | 无 | ALLOW | `git rev-parse HEAD` |
| 6 | `git grep*` | git | 执行 `-O` / `--open-files-in-pager[=CMD]` / `--textconv` | DENY | `git grep -O evil`；`git grep --open-files-in-pager=evil`；`git grep --textconv x` |
| 7 | `git ls-files*` | git | 无 | ALLOW | `git ls-files` |
| 8 | `git ls-tree*` | git | 无 | ALLOW | `git ls-tree HEAD` |
| 9 | `git rev-list*` | git | 无 | ALLOW | `git rev-list --all` |
| 10 | `git shortlog*` | git | 无 | ALLOW | `git shortlog` |
| 11 | `git blame*` | git | 无 | ALLOW | `git blame README.md` |
| 12 | `git cat-file*` | git | 执行 `--filters` / `--textconv` | DENY | `git cat-file --filters HEAD:README.md` |
| 13 | `git for-each-ref*` | git | 无 | ALLOW | `git for-each-ref` |
| 14 | `git describe*` | git | 无 | ALLOW | `git describe --tags` |
| 15 | `git merge-base*` | git | 无 | ALLOW | `git merge-base HEAD HEAD` |
| 16 | `git tag` | git | 写：`git tag <name>` | DENY | `git tag v1.0.0` |
| 17 | `git tag -l*` | git | 无 | ALLOW | `git tag -l v1` |
| 18 | `git tag --list*` | git | 无 | ALLOW | `git tag --list` |
| 19 | `git branch` | git | 写：`git branch <name>` | DENY | `git branch newb` |
| 20 | `git branch -a` | git | 无 | ALLOW | `git branch -a` |
| 21 | `git branch -r` | git | 无 | ALLOW | `git branch -r` |
| 22 | `git branch -v` | git | 写：`git branch -v <name>` | DENY | `git branch -v newb` |
| 23 | `git branch -vv` | git | 写：`git branch -vv <name>` | DENY | `git branch -vv newb` |
| 24 | `git branch -a -v` | git | 无 | ALLOW | `git branch -a -v` |
| 25 | `git branch --all` | git | 无 | ALLOW | `git branch --all` |
| 26 | `git branch --list` | git | 无 | ALLOW | `git branch --list` |
| 27 | `git branch --show-current` | git | 无 | ALLOW | `git branch --show-current` |
| 28 | `ls*` | POSIX | 无 | ALLOW | `ls -la` |
| 29 | `cat*` | POSIX | 无 | ALLOW | `cat README.md` |
| 30 | `grep*` | POSIX | 无 | ALLOW | `grep -rn x .` |
| 31 | `head*` | POSIX | 无 | ALLOW | `head -5 README.md` |
| 32 | `tail*` | POSIX | 无 | ALLOW | `tail -5 README.md` |
| 33 | `wc*` | POSIX | 无 | ALLOW | `wc -l README.md` |
| 34 | `pwd*` | POSIX | 无 | ALLOW | `pwd` |
| 35 | `date*` | POSIX | 写：`-s` / `--set`（设置系统/硬件时钟） | DENY | `date -s 20200101`；`date --set=20200101` |
| 36 | `where.exe*` | POSIX | 无 | ALLOW | `where.exe node` |
| 37 | `rg*` | POSIX | 执行：`--pre CMD` / `--pre=CMD` | DENY | `rg --pre evil x`；`rg --pre=evil x` |
| 38 | `whoami*` | POSIX | 无 | ALLOW | `whoami` |
| 39 | `diff*` | POSIX | 无 | ALLOW | `diff a.txt b.txt` |
| 40 | `get-childitem*` | Cmdlet | 无（管道第二段/子表达式面由黑名单与结构闸 0.7 承担） | ALLOW | `Get-ChildItem -Path .` |
| 41 | `get-content*` | Cmdlet | 无 | ALLOW | `Get-Content README.md` |
| 42 | `get-date*` | Cmdlet | 无 | ALLOW | `Get-Date` |
| 43 | `select-string*` | Cmdlet | 无 | ALLOW | `Select-String -Pattern x README.md` |
| 44 | `test-path*` | Cmdlet | 无 | ALLOW | `Test-Path README.md` |
| 45 | `measure-object*` | Cmdlet | 无 | ALLOW | `Measure-Object -InputObject 1 -Sum` |
| 46 | `out-string*` | Cmdlet | 无 | ALLOW | `Out-String -InputObject x` |
| 47 | `get-process*` | Cmdlet | 无 | ALLOW | `Get-Process` |
| 48 | `get-service*` | Cmdlet | 无 | ALLOW | `Get-Service` |
| 49 | `get-command*` | Cmdlet | 无 | ALLOW | `Get-Command node` |
| 50 | `get-member*` | Cmdlet | 无 | ALLOW | `Get-Member -InputObject x` |
| 51 | `get-help*` | Cmdlet | 无 | ALLOW | `Get-Help Get-Item` |
| 52 | `get-item*` | Cmdlet | 无 | ALLOW | `Get-Item README.md` |
| 53 | `get-location*` | Cmdlet | 无 | ALLOW | `Get-Location` |
| 54 | `get-variable*` | Cmdlet | 无 | ALLOW | `Get-Variable` |
| 55 | `get-host*` | Cmdlet | 无 | ALLOW | `Get-Host` |
| 56 | `get-history*` | Cmdlet | 无 | ALLOW | `Get-History` |
| 57 | `get-random*` | Cmdlet | 无 | ALLOW | `Get-Random` |
| 58 | `get-psdrive*` | Cmdlet | 无 | ALLOW | `Get-PSDrive` |
| 59 | `get-itemproperty*` | Cmdlet | 无 | ALLOW | `Get-ItemProperty -Path .` |
| 60 | `get-acl*` | Cmdlet | 无 | ALLOW | `Get-Acl README.md` |
| 61 | `get-authenticodesignature*` | Cmdlet | 无 | ALLOW | `Get-AuthenticodeSignature README.md` |
| 62 | `get-filehash*` | Cmdlet | 无 | ALLOW | `Get-FileHash README.md` |
| 63 | `get-computerinfo*` | Cmdlet | 无 | ALLOW | `Get-ComputerInfo` |
| 64 | `get-culture*` | Cmdlet | 无 | ALLOW | `Get-Culture` |
| 65 | `get-uiculture*` | Cmdlet | 无 | ALLOW | `Get-UICulture` |
| 66 | `pytest*` | runner | 执行对象由宿主工程决定（信任根入口，台账类别集第 7 类） | ALLOW | `pytest` |
| 67 | `python -m pytest*` | runner | 同上 | ALLOW | `python -m pytest` |
| 68 | `py -m pytest*` | runner | 同上 | ALLOW | `py -m pytest` |
| 69 | `npm test*` | runner | 同上 | ALLOW | `npm test` |
| 70 | `pnpm test*` | runner | 同上 | ALLOW | `pnpm test` |
| 71 | `cargo test*` | runner | 同上 | ALLOW | `cargo test` |
| 72 | `go test*` | runner | 同上 | ALLOW | `go test ./pkg` |
| 73 | `mvn test*` | runner | 同上 | ALLOW | `mvn test` |
| 74 | `vitest*` | runner | 同上 | ALLOW | `vitest run` |
| 75 | `jest*` | runner | 同上 | ALLOW | `jest` |
| 76 | `python -m unittest*` | runner | 同上 | ALLOW | `python -m unittest` |

**补充探针（写/执行形态的旁路变体，全部 DENY）**：

- `Get-ChildItem . | Remove-Item -Recurse` → DENY（管道第二段命中黑名单 `remove-item*`）。
- `Get-Content README.md | Set-Content out.txt` → DENY（管道第二段命中黑名单 `set-content*`）。
- `Get-ChildItem (Remove-Item -Recurse src)` → DENY（结构闸 0.7：pwsh 子表达式）。
- `Get-ChildItem {Remove-Item -Recurse src}` → DENY（结构闸 0.7：pwsh 脚本块）。

## 二、Cmdlet 参数类型表（26 个白名单 Cmdlet）

"参数类型"取自 T 盘沙箱 `pwsh -NoProfile -Command "Get-Command <name,...> -Syntax"` 实测输出（Exit 0）。
"ScriptBlock 型参数"= 参数类型直接为 `scriptblock` 者；"可强转参数"= 类型为 `Object[]` / `psobject` / `pspropertyexpression[]` 等可接受任意对象者（理论强转面）。

| # | Cmdlet | 参数类型概览（实测 Syntax 摘要） | ScriptBlock 型参数 | 可强转参数 | 强转探针回执 |
| --- | --- | --- | --- | --- | --- |
| 1 | `Get-ChildItem` | `Path string[]` `Filter string` `Include/Exclude string[]` `Attributes FlagsExpression[FileAttributes]` `Depth uint` | 无 | 无 | 不适用 |
| 2 | `Get-Content` | `Path string[]` `ReadCount/TotalCount long` `Tail int` `Credential pscredential` `Encoding Encoding` `Stream string` | 无 | 无 | 不适用 |
| 3 | `Get-Date` | `Date datetime` `Year/Month/Day/... int` `Format string` `UFormat string` `UnixTimeSeconds long` | 无 | 无 | 不适用 |
| 4 | `Select-String` | `Pattern string[]` `InputObject psobject` `Culture string` `Context int[]` `Encoding Encoding` | 无 | `InputObject psobject` | **证伪**：`Select-String -Pattern x -InputObject {Set-Content t:\coerce-ss.txt x}` → 报 `Cannot evaluate parameter 'InputObject' ... script block ... no input`；标记文件 `coerce-ss.txt` 未创建（Test-Path False） |
| 5 | `Test-Path` | `Path string[]` `PathType TestPathType` `OlderThan/NewerThan datetime` `Credential pscredential` | 无 | 无 | 不适用 |
| 6 | `Measure-Object` | `Property pspropertyexpression[]` `InputObject psobject` | 无 | `Property` / `InputObject` | **证伪**：`Measure-Object -InputObject {Set-Content t:\coerce-mo.txt x} -Sum` → 同上拒执行；`coerce-mo.txt` 未创建 |
| 7 | `Out-String` | `Width int` `InputObject psobject` | 无 | `InputObject psobject` | **证伪**：`Out-String -InputObject {Set-Content t:\coerce-os.txt x}` → 拒执行；`coerce-os.txt` 未创建 |
| 8 | `Get-Process` | `Name string[]` `Id int[]` `InputObject Process[]` | 无 | `InputObject` 限 `Process[]`（非任意对象） | 不适用（类型受限） |
| 9 | `Get-Service` | `Name string[]` `DisplayName string[]` `InputObject ServiceController[]` | 无 | `InputObject` 限 `ServiceController[]` | 不适用（类型受限） |
| 10 | `Get-Command` | `Name string[]` `ArgumentList Object[]` `ParameterType PSTypeName[]` `Module string[]` | 无 | `ArgumentList Object[]` | **证伪**：`Get-Command node -ArgumentList {Set-Content t:\coerce-gc.txt x}` → 报 `ArgumentList parameter can be specified only when retrieving a single cmdlet or script`；`coerce-gc.txt` 未创建 |
| 11 | `Get-Member` | `Name string[]` `InputObject psobject` `MemberType PSMemberTypes` `View PSMemberViewTypes` | 无 | `InputObject psobject` | **证伪**：`Get-Member -InputObject {Set-Content t:\coerce-gm.txt x}` → 拒执行；`coerce-gm.txt` 未创建 |
| 12 | `Get-Help` | `Name string` `Path string` `Category string[]` `Parameter string[]` | 无 | 无 | 不适用 |
| 13 | `Get-Item` | `Path string[]` `Filter string` `Credential pscredential` `Stream string[]` | 无 | 无 | 不适用 |
| 14 | `Get-Location` | `PSProvider string[]` `PSDrive string[]` `StackName string[]` | 无 | 无 | 不适用 |
| 15 | `Get-Variable` | `Name string[]` `Scope string` `Include/Exclude string[]` | 无 | 无 | 不适用 |
| 16 | `Get-Host` | 仅 `<CommonParameters>` | 无 | 无 | 不适用 |
| 17 | `Get-History` | `Id long[]` `Count int` | 无 | 无 | 不适用 |
| 18 | `Get-Random` | `Maximum/Minimum Object` `InputObject Object[]` `SetSeed int` `Count int` | 无 | `Maximum/Minimum Object`、`InputObject Object[]` | **证伪**：`Get-Random -InputObject {Set-Content t:\coerce-gr.txt x}` → 脚本块被当作数据对象输出（stdout 回显其字符串形态），**未执行**；`coerce-gr.txt` 未创建 |
| 19 | `Get-PSDrive` | `Name/LiteralName string[]` `Scope string` `PSProvider string[]` | 无 | 无 | 不适用 |
| 20 | `Get-ItemProperty` | `Path string[]` `Name string[]` `Filter string` `Credential pscredential` | 无 | 无 | 不适用 |
| 21 | `Get-Acl` | `Path string[]` `InputObject psobject` `Audit` `Filter string` | 无 | `InputObject psobject` | **证伪**：`Get-Acl -InputObject {Set-Content t:\coerce-ga.txt x}` → 报 `necessary method, GetSecurityDescriptor, does not exist`；`coerce-ga.txt` 未创建 |
| 22 | `Get-AuthenticodeSignature` | `FilePath string[]` `Content byte[]` `SourcePathOrExtension string[]` | 无 | `Content byte[]`（字节数组强转，非执行面） | 不适用（非对象强转执行面） |
| 23 | `Get-FileHash` | `Path string[]` `Algorithm string` `InputStream Stream` | 无 | `InputStream Stream`（流对象，非执行面） | 不适用（非对象强转执行面） |
| 24 | `Get-ComputerInfo` | `Property string[]` | 无 | 无 | 不适用 |
| 25 | `Get-Culture` | `Name string[]` `NoUserOverrides` `ListAvailable` | 无 | 无 | 不适用 |
| 26 | `Get-UICulture` | 仅 `<CommonParameters>` | 无 | 无 | 不适用 |

**参数类型表结论**：26 个白名单 Cmdlet **无一**存在 `scriptblock` 型参数；6 个可强转面（`Select-String`/`Measure-Object`/`Out-String`/`Get-Command`/`Get-Member`/`Get-Acl`，另 `Get-Random`）全部经沙箱脚本块强转探针实测，**无一执行**（全部证伪）。纵深：即便可强转，结构闸 0.7 对 pwsh 路由命令的引号外 `( ) { } @` 一律拒绝（补充探针已实证）。

## 三、发现区

**无发现**（0 findings）。

- 全部 76 键的写/执行形态均被拒（无直通）。
- 全部 76 键的只读形态均放行（无误拒）。
- 26 个 Cmdlet 无 ScriptBlock 型参数；可强转面强转探针全部证伪。
- 测试 runner 族（11 键）为已声明信任根入口（台账类别集第 7 类），其"执行对象由仓库内容决定"语义为设计内声明，不属本审计发现。

## 四、方法与证据来源

- **offline 逐键裁决**：T 盘沙箱 `.kilo/probe-whitelist-audit.mjs`（`createRequire` 直调 `mcp/plan-governor.js` 导出，零派生进程；`node probe-whitelist-audit.mjs`，Exit 0），实测 `ALLOW_KEYS=76 DENY_KEYS=50 FORBIDDEN_KEYS=11`。
- **Cmdlet 参数类型**：T 盘沙箱 `pwsh -NoProfile -Command "Get-Command <26 名逗号列表> -Syntax"`（Exit 0）。
- **强转探针**：T 盘沙箱 `pwsh -NoProfile -Command "…-InputObject {Set-Content t:\coerce-*.txt x}…"`（脚本块载荷；随后 `Test-Path` 逐一验证标记文件均 False）。
- **机器判据**：`mcp/tests/whitelist-audit.mjs` 的 `audit-key-inventory`（键表非空）与 `audit-report-coverage-by-reprobe`（逐行重跑本表探针，每 `ALLOW_KEYS` 键≥1 探针且全部命中其行裁决方计覆盖，覆盖数须等于 `ALLOW_KEYS.length`）+ `audit-coverage-detects-tampered-verdict`（翻裁决即红的反假绿控制）以机械重跑钉住键覆盖，不采信下方任何自声明计数行。

covered=76 total=76

> 注：上行为历史自声明快照，**不再是机器判据**；键覆盖唯一事实源为 `audit-report-coverage-by-reprobe` 对本表逐行探针的重跑结果。