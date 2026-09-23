---
name: pwsh-gnu-bridge
description: >
  在 Windows 上生成、执行、调试或评估任何终端命令前必须使用（MUST load before writing ANY shell command）。两类触发——①语法类：PowerShell 7/pwsh 命令编写、git/node/npm/python 等原生程序调用、PortableGit 的 grep/awk/sed/ls/rm 等 GNU 工具用法、POSIX 脚本是否需 Git Bash 的判定；②权限类：命令被拒绝、弹授权窗、Ask/deny/白名单拦截、宿主命令审批制度选型、无确认模式下安全边界设计。排查症状：ls -la/rm -rf/cp -r 等 GNU 参数报错、"找不到与参数名称匹配的参数"、不是 cmdlet 的名称、ParameterBindingException、别名冲突、Get-Command 解析、Remove-Alias 与 Profile、NoProfile、中文乱码、UTF-8 BOM、CRLF/LF、$LASTEXITCODE 退出码、heredoc、export、进程替换、.sh 脚本、含空格或非 ASCII 路径、引号与参数传递、递归删除/覆盖等高风险文件操作。
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
- 编写命令强制使用完整 Cmdlet 名称（如 `Remove-Item`、`Get-ChildItem`）或明确的二进制可执行文件，从根源消除别名探测的必要。
- 只有命令确实存在解析歧义、跨 Shell 风险或不可逆后果时，才展开说明并调整写法。

## 能力选择顺序

1. 读取、精确编辑和写入文件时，优先使用宿主提供的专用工具（如内置读取、补丁编辑工具）。
2. Windows 路径、对象管道、进程、服务和安全文件操作优先使用 PowerShell cmdlet。
3. `git`、`node`、`npm`、`python` 等原生程序直接从 PowerShell 调用。
4. `grep`、`awk`、`sed`、`head`、`tail`、`wc`、`sort`、`uniq` 等 GNU 工具只在文本流处理确实更清晰时使用。键集对齐：`grep*/head*/tail*/wc*` 属 allow 键集；`awk*/sed*/sort*/uniq*/xargs*` 为**禁入清单**成员（`sed -i` 原地改写、`sort -o` 写出、`xargs` 任意执行、`awk print|"cmd"` 间接执行均具写/执行能力）——只读取代一律首选 `grep`/`Select-String`，非用 awk/sed 不可时按"键集外，落 Ask 属预期，禁申请加键"处理。
5. Bash heredoc、复杂 POSIX 流程、Shell 循环、进程替换或现有 `.sh` 脚本交给 Git Bash。`.sh`/`.ps1` 脚本本体必须经宿主编辑/写入工具创建——重定向与 `New-Item*`/`Set-Content*` 属 deny 键集写通道，任何制度下都不得用命令生成文件。

不要为了体现 GNU 工具可用而强行替换清晰、安全的 PowerShell 写法。

## 宿主权限审批与白名单契合规范

宿主环境通常采用基于 AST 拆段与整串通配匹配的自动审批白名单：规则键编译为 `^...$` 锚定的正则，`*` 匹配任意字符（含空格与 `/`），Windows 下大小写不敏感；多条规则命中时以书写顺序最后一条为准，未命中默认 Ask（如只读放行 `git status*`、`git log*`、`Get-ChildItem*`）。管道与复合命令按语法树拆段、每段独立命中白名单才整体放行；脚本块花括号是否拆段随会话 shell 的语法树而定（pwsh 会话拆检、Git Bash 会话不拆检，见下文脚本块借道与"常见错误信号"节）。含 `;`、`&`、`&&`、`\|\|`、命令内换行任一的复合/链式命令，与单段含 `<`、`>`、`$(`、反引号的非平铺结构，一律不得使用。关于管道：宿主原生终端严禁一切管道（AGENTS.md 铁律）；**纯白名单只读管道例外**（分隔符仅单个 `|`、每段均命中允许键集、整条无上述结构字符，如 `git log --oneline | head -5`）仅在已接入 `plan-governor` 的 MCP 受控通道中生效，宿主原生终端不适用。编写命令时必须兼顾执行安全与白名单契合度，防范不必要的人工询问（Ask）：

1. **精准界定管道使用边界（严禁展示型管道，受限允许流处理管道）**：
   - 宿主权限解析器会将管道 `|` 拆解为多个独立阶段（Parsed Commands），**管道中的每一个命令都必须独立命中白名单才会自动放行**。
   - **展示型与排版型管道分级管控**：终端输出用于供 Agent 消费；`| Format-Table`、`| Format-List`、`| Select-Object` 未入尾段白名单，追加即触发 Ask，仍严禁；`| Out-String` 已入尾段白名单可自动放行，但其价值仅为排版，对 Agent 消费并无增益，非必要不追加（输出消费风格建议而非权限禁令）。
   - 文件检索优先使用原生扁平参数：`Get-ChildItem -Recurse -Depth 3 -File -Name`。
   - 数据流处理管道仅在下游工具确在白名单内时使用（如已放行 `Select-String*`、`grep*`、`head*` 时：`git log --oneline -20 | head -n 5`）。

2. **跨仓库探测与会话状态污染防范**：
   - `git -C <path> <subcmd>` 会使命令前缀变为 `git -C`，若宿主白名单仅配置 `git log*` 将无法匹配。
   - **防范状态污染**：在持久终端会话中，严禁随意使用 `Set-Location <path>` 而不恢复工作目录，这会导致后续命令在错误路径执行产生严重回归。
   - **推荐实践**：
       - 若当前已在目标仓库，直接执行标准平铺命令（如 `git status --short`、`git log -n 5`）。
       - 若需探测外部仓库，首选使用 bash 工具的 `workdir` 参数指定目标仓库路径后再执行标准平铺命令；严禁配置或请求 `"git -C * log*"` 类通配放行——该键可匹配 `git -C <repo> reset --hard log`、`git -C <repo> push origin log` 等写操作（deny `git reset*`/`git push*` 均不命中），属高危绕过；亦不得以 pushd/popd 或 `Set-Location` 切换目录后不恢复的方式探测（会话状态污染）。

3. **正则语法与转义安全（防范 AST 误判为 Shell 管道）**：
   - 在 `git grep`、`grep` 或 `Select-String` 中匹配多模式时，严禁使用带 `"` 与 `\|` 的复杂双引号嵌套（语法解析器极易将其误切分为多个子命令）。
   - 统一使用扩展正则参数 `-E` 配合外层单引号 `'...'`：
     - 正确：`git grep -En '(git ls-tree|git rev-list|git blame)' -- target_dir/`
     - 错误：`git grep -n "git ls-tree\|"git rev-list..."`

4. **原子化与单行平铺原则（复合/链式结构闸，全模式 deny）**：
   - 日常只读探测与查询命令，一律采用平铺单行直接调用，严禁包装成含变量赋值与控制流的多行脚本（例如 `$exe='git'; & $exe`），否则会导致 AST 无法提取有效子命令而必定触发 Ask。
   - 任何连接符复合一律禁用：含 `;`、`&`、`&&`、`||`、命令内换行任一的复合/链式命令，与含 `<`/`>`、命令替换 `$()`、反引号的非平铺结构，拆成单行单命令逐条执行，写操作走宿主编辑工具。
   - 管道仅当下游在白名单内可用：分隔符仅单个 `|`、每段均命中允许键集、整条无上述结构字符时放行。

## 权限制度判定与熔断（先判定，再选策略）

本技能《宿主权限审批与白名单契合规范》一节的契合策略**只在判定为 WHITELIST 制度后全量启用**。宿主权限制度是变量不是常量——每次会话首次落终端命令前，先按标准探针归类：

**标准探针（顺序执行，均单行只读）**：
1. `git status --short` —— 被拒 → **HOSTILE**（直接跳熔断条款，禁一切整形试错）。
2. 放行后，观察本会话既有历史信号：任何命令（含写类/复合类）出现过 Ask/拒绝 → **WHITELIST**；从未出现任何询问 → 暂按 **OPEN** 处理，一旦后续出现首次 Ask 即当场改判 WHITELIST 并启用契合规范。

| 制度 | 观测信号 | 本技能语料的启用方式 |
| --- | --- | --- |
| **OPEN**（无闸） | 探针直通且全 session 无任何询问信号 | 不为"契合"浪费任何整形 token；语法纪律**整体降格为安全自缚**——复合语法与写类命令依旧禁止：不是不能，是不该，此时没有任何人肉闸门兜底，铁律即唯一防线。 |
| **WHITELIST**（形态敏感） | 存在"有的直通、有的被拦"信号 | 契合规范启用，以首枪命中为目标；注意其效力以"单行平铺形态"为限——被 deny 键覆盖或键集外的合法只读用法（GNU 工具、heredoc 等通用章节）落 Ask 属制度分层的**预期行为，不是语料错误**；需首枪命中时优先内置只读工具。契合失败按熔断铁律处理。 |
| **HOSTILE**（闸门全闭） | 标准探针单行只读即被拒，或终端工具未注入 | **立即停止整形**——改道内置只读工具（Read/Grep/Glob）；不可用即报告 BLOCKED。此时白名单契合章节价值为零，继续试错即越权。 |

**熔断铁律（任何制度通用）**：同一意图被宿主权限拒绝后：至多一次改用内置只读工具（Read/Grep/Glob）的改道；第二次受阻立即停手，如实报告 BLOCKED 与原始命令及拒绝形态。严禁以语法变体、拆分拼接或更换命令行工具反复探测闸门边界——探测行为本身视同越权。

**反向处方禁令**：本技能只教"按观察到的制度怎么写命令"，**永不处方"往白名单加哪个键"**。键集合变更只发生在权限配置自身的维护流程里、由人裁决；代理遇到"被拦但明显属于合理只读取证需求"时，正确动作是把命令原文与拦截形态记入汇报，交人类定夺。

## 命令边界总表（与宿主自动审批键集同源对账）

以下三组边界即宿主权限系统的键集现实，**任何一侧变更键集时须三源对账**（代理配置 map、全局 jsonc、本表；注：运行期命令动态执法已单源收口至 `mcp/plan-governor.js`，此处三源对账特指离线文档与配置键集的一致性核对）。WHITELIST 制度下命中即闸门后果；无确认制度下本表降格为自缚红线——deny 形态不因没人拦而可执行。

- **允许（只读取证与测试，单行平铺直调）**：`git status*`、`git log*`、`git diff*`、`git show*`、`git rev-parse*`、`git grep*`、`git ls-files*`、`git ls-tree*`、`git rev-list*`、`git shortlog*`、`git blame*`、`git cat-file*`、`git for-each-ref*`、`git describe*`、`git merge-base*`、`git tag`、`git tag -l*`、`git tag --list*`、`git branch`、`git branch -a*`、`git branch -r*`、`git branch -v*`、`git branch --all*`、`git branch --list*`、`git branch --show-current*`、`ls*`、`cat*`、`grep*`、`head*`、`tail*`、`wc*`、`pwd*`、`date*`、`where.exe*`、`rg*`、`whoami*`、`diff*`、`Get-ChildItem*`、`Get-Content*`、`Get-Date*`、`Select-String*`、`Test-Path*`、`Measure-Object*`、`Out-String*`、`pytest*`、`python -m pytest*`、`py -m pytest*`、`npm test*`、`pnpm test*`、`cargo test*`、`go test*`、`mvn test*`、`vitest*`、`jest*`、`python -m unittest*`、`Get-Process*`、`Get-Service*`、`Get-Command*`、`Get-Member*`、`Get-Help*`、`Get-Item*`、`Get-Location*`、`Get-Variable*`、`Get-Host*`、`Get-History*`、`Get-Random*`、`Get-PSDrive*`、`Get-ItemProperty*`、`Get-Acl*`、`Get-AuthenticodeSignature*`、`Get-FileHash*`、`Get-ComputerInfo*`、`Get-Culture*`、`Get-UICulture*`。

> 键集按跨平台单源口径对齐：`rg*`、`whoami*` 两平台通用无差异；`diff*` 已入单源，但 GNU `diff` 仅在 Git Bash 会话为真只读，pwsh 会话裸 `diff` 是 `Compare-Object` 别名（缺参挂交互提示），故 pwsh 会话不将裸 `diff` 用作真只读对比——需对比文件时用 `git diff --no-index <a> <b>`；其它测试器不在单源清单内的，由人按宿主权限配置流程补入（技能不处方新增键）。
> `date*` 仅放行只读形态；`date -s` / 裸数字设时（如 `date 122514252026`）/ `-f FILE` 等写形态由时钟闸拦截，不因命中允许键而放行。
- **拒绝（绝不执行；文件创建/修改/删除一律宿主专用编辑工具，不走命令行）**：`Set-Content*`、`Add-Content*`、`Out-File*`、`New-Item*`、`Remove-Item*`、`Clear-Content*`、`Move-Item*`、`Copy-Item*`、`Rename-Item*`、`cp*`、`xcopy*`、`robocopy*`、`rm*`、`del*`、`rd*`、`rmdir*`、`git difftool*`、`git add*`、`git commit*`、`git push*`、`git reset*`、`git checkout*`、`git stash*`、`npm install*`、`pip install*`、`mv *`、`mv`、`touch*`、`tee*`、`dd*`、`ln *`、`chmod*`、`chown*`、`truncate*`、`sed -i*`、`node -e*`、`node --eval*`、`node -p*`、`node --print*`、`python -c*`、`python3 -c*`、`py -c*`、`perl -e*`、`ruby -e*`、`php -r*`、`npm ci*`、`git clean*`、`git restore*`、`git apply*`、`git switch*`。
- **展开构造（绝不执行，全模式不豁免）**：命令中出现 `$` 或反引号的展开构造（`$'…'` ANSI-C 引号、`$IFS` 词分割、`$(…)` 命令替换、`${VAR}` 参数展开）——展开可改写命令 token 边界，使裁决视图与执行视图分叉。单引号内的字面 `$`（如 `cat '$HOME'`）不属此类，bash 语义下确为字面量。
- **命令包装前缀（绝不执行，全模式不豁免）**：`command `、`env `、`nohup `、`eval `、`exec `、`builtin `、`time ` 置于命令前，以及 `sh -c` / `bash -c` / `zsh -c` / `dash -c` / `ksh -c` 类壳包装——含**组合短选项簇**（`-lc` / `-ec` / `-xc` / `-eux -c`）、**长选项 + `-c`**（`--login -c`）、**紧贴参数**（`-c"…"`）与**带路径前缀的壳**（`/bin/bash -c`、`/usr/bin/sh -c`、`./bash -c`、`C:/…/bash.exe -c`）；`git -c` 后也允许紧贴式（`-ccore.pager=sh`）。前缀把真命令推到参数位，使黑名单段首前缀匹配整体失效；壳 `-c` 更是完整任意命令通道。（`xargs` 不归本类，由下方禁入清单 `xargs*` 覆盖。）
- **`--output` 写逃逸参数（绝不执行，全模式不豁免）**：只读命令不得携带 `--output=<path>` / `--output <path>`（含以引号或反斜杠打断字面量的变体，如 `--out'put'=`、`--output\=`、`\-\-output=`）——白名单前缀对该参数整体失效，可借只读命令向磁盘任意路径写盘。
- **外部进程派生参数（绝不执行，全模式不豁免）**：`--open-files-in-pager`（含无歧义前缀缩写 `--open`/`--op`/`--open-f` 等）、`--ext-diff`、`--paginate`、`--config-env`、`--pre`/`--pre-glob`/`--pre-command`、`--textconv`（含缩写 `--textc` 等）、`--filters`，以及 `git -c`（含紧贴式 `-c<键>=`）对 `core.pager` / `core.editor` / `core.sshCommand` / `core.hooksPath` / `core.fsmonitor` / `diff.external` / `interactive.diffFilter` 的注入——白名单只读命令可借这些参数派生外部进程，使前缀白名单整体失效。
- **禁入（不得申请放行；宿主原生通道落 Ask 属预期，MCP 通道一律 deny）**：`find*`（`-delete/-exec` 写能力）、`awk*`、`sed*`（sed -i 写操作）、`sort*`、`uniq*`、`xargs*`、`Select-Object*`、`Where-Object*`、`Sort-Object*`、`Format-Table*`、`Format-List*`。
- **其余一切命令**：按人工授权路径对待——如实给出目的与命令原文等待批准；严禁换形态规避，严禁变体探测。
- **结构面警示（复合/链式/非平铺结构闸，全模式 deny）**：① 以 `pwsh` / `powershell` 的 `-c`/`-Command` 包装内联命令属于**任意命令通道**——段首前缀白名单对它整体失效（包装壳不命中任何拒绝键，内联真命令被壳遮蔽），一律禁止包装执行：命令平铺单行直调；确需脚本文件用 `-File`（脚本本体经编辑工具落盘）。② 含 `;`、`&`、`&&`、`\|\|`、命令内换行任一的复合/链式命令一律禁用（全模式 deny），拆成单行单命令逐条执行。③ 重定向 `<`/`>`、命令替换 `$()`、反引号属非平铺结构，一律禁用（全模式 deny），写操作走宿主编辑工具。④ 唯一可能的结构例外=纯白名单管道：分隔符仅单个 `|`、每段均命中允许键集、整条无上述结构字符时放行（如 `git log --oneline | head -5`）；其余管道应拆成单条调用或换白名单下游。

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
- **动态传参安全与只读探测解耦**：
  - **交互式只读探测**（无动态外部输入）：写扁平单行命令（如 `git status --short`、`git diff --stat`），直接命中前缀白名单。
  - **自动化脚本或含动态输入**：调用原生程序时使用参数数组，不拼接字符串：
    ```powershell
    $args = @('status', '--short')
    & 'git' @args
    ```
  - 普通前台程序使用调用运算符 `&`，不要无故使用 `Start-Process` 或 `cmd.exe /c`。
  - 不习惯性添加 `-ExecutionPolicy Bypass`。

（详见 references/powershell7-command-rules.md）

## GNU 工具不是 PowerShell 别名

PowerShell 中的 `ls`、`rm`、`cp`、`cat`、`curl` 等名称可能解析为别名、cmdlet 或外部程序。GNU 参数不能直接假定适用于同名 PowerShell 命令。

出现 `ls -la`、`rm -rf` 等参数错误时，先检查解析结果（`Get-Command` 在允许键集内，见上方「允许（只读取证与测试）」清单（单行平铺直调）；遇解析/路由异常时优先改用内置 `Grep`/`Glob`/`Read` 达成同款排查——它们不经 Bash 权限链）：

```powershell
Get-Command ls -All
Get-Command rm -All
Get-Command grep -All
```

然后选择：

- 使用清晰的 PowerShell cmdlet 及其参数。
- 或调用已经确认来源的 GNU 可执行程序。

不得猜测 `ls.exe`、`rm.exe` 一定存在，也不得把别名冲突错误归因于 `-NoProfile`。

（详见 references/gnu-tools-in-pwsh.md）

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
- Agent 编写命令时必须默认使用完整 PowerShell cmdlet 名称（如 `Remove-Item`、`Copy-Item`、`Get-Content`）或已确认路径的 GNU 外部程序（如 `C:/Program Files/Git/usr/bin/rm.exe`），不依赖 Profile 状态，从根源规避别名混淆。
- `pwsh.exe -NoProfile` 不加载用户 Profile，因此必须按该会话自己的解析结果处理，不得假定该会话中别名已被移除或 GNU 工具已优先。
- 别名存在时 `rm` 解析为 `Remove-Item`，别名移除后 `rm` 可能解析到 GNU `rm.exe`，但两者都不能绕过删除安全检查，仍不得默认推荐 `rm -rf`。

## Git Bash 的适用边界

PowerShell 7 更现代、更强大，但不会自动获得完整 Bash 语法。以下场景才使用 Git Bash：

- Bash heredoc。
- 复杂 `.sh` 脚本。
- POSIX Shell 循环、函数或进程替换。
- 强依赖 Bash 展开和管道行为的流程。

当前执行器本身已经是 Git Bash 时，直接使用其 Bash 能力，不要再从 PowerShell 创建临时 `.sh` 文件。当前执行器是 PowerShell 7 且脚本较复杂时，使用唯一临时脚本、LF 换行和可靠清理，不要拼接脆弱的多层 `sh -c` 字符串。

（详见 references/git-bash-fallback.md）

## 编码、换行和状态判断

- PowerShell 7 的 UTF-8 行为比 Windows PowerShell 5.1 更一致，但控制台编码、管道编码、原生程序编码和文件编码仍是不同问题。
- 不要看到中文乱码就只修改 `$OutputEncoding`；先确定乱码发生在哪一层。
- 需要 UTF-8 无 BOM 和 LF 时，文件写入一律走宿主编辑/写入工具（`Set-Content*`、`Out-File*`、`Add-Content*` 属 deny 键集，不得作为写通道）；字节级或换行验证用 `Get-Content*`（allow 键集）或宿主读取工具。
- 原生程序完成后立即读取 `$LASTEXITCODE`，避免使用陈旧值。
- 不使用 `$LASTEXITCODE` 判断 cmdlet 成败。关键 cmdlet 应转换为终止错误并通过异常处理。
- 跨 Shell 调用必须显式传播内部命令的退出码。

（详见 references/encoding-exit-codes.md）

## 高风险操作

递归删除、移动、覆盖、批量替换或终止进程前：

1. 解析目标和预期根目录的绝对路径。
2. 验证目标确实位于预期根目录内部，不能只做字符串前缀比较。
3. 拒绝空路径、磁盘根目录、用户主目录和工作区根目录等高风险目标，除非用户明确要求。
4. 先检查目标，再执行不可逆操作。
5. 操作后验证结果。

`rm*`、`del*`、`rd*`、`rmdir*`、`Remove-Item*`、`Copy-Item*`、`Move-Item*`、`xcopy*`、`robocopy*` 属 deny 键集——自动审批制度下根本不会放行；`sed -i` 属禁入清单。本节流程仅适用于人工授权场景；常规文件变更一律宿主编辑/写入工具。

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
- 破坏宿主白名单前缀：例如对只读命令随意使用前置 `-C` 参数或过度包装多行变量赋值。
- 无谓管道：为终端数据消费盲目追加 `| Format-Table`、`| Select-Object` 导致触发审批。
- 引发 AST 误判：在正则搜索参数中拼接带有 `\"` 和 `\|` 的复杂嵌套转义长串。
- 脚本块借道：在 `Where-Object { ... }`、`ForEach-Object { ... }` 等花括号脚本块内夹带白名单外命令；Git Bash 会话下宿主以 bash 语法树解析、花括号不拆段，整条命令按首命令匹配白名单即可放行，绕过即成——pwsh 会话虽会拆段拦截，也不得依赖该差异。
- 会话状态污染：为了执行外部探测随意使用 `Set-Location` 却未在操作后恢复初始目录。
- 命令已经正确，却仍被反复重写、反复解释或反复探测环境。
