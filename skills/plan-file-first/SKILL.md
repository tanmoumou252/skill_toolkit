---
name: plan-file-first
description: >
  强制执行“计划文件先行、执行授权隔离”的工作流。凡是用户要求创建文件、修改代码、修复 bug、重构、编写文档、运行验证或其他会改变工作区状态的实现任务，都必须先将计划真实写入当前工作区的 .kilo/plans/ 文件。计划文件写入授权、计划审批、计划内容执行授权、Git 集成授权必须严格分开；不要把工具权限批准、ExitPlanMode 结果或计划审批解释为执行授权。
---

# Plan-File-First：先保存计划，再等待独立执行授权

<SUBAGENT-DETECT>
阅读本 skill 前，先判断你是否以子代理身份运行。

本 skill 的授权闸门依赖"人类交互式用户输入"——它存在的意义是等一个能打字的人来授权。
而子代理的运行场景没有这样的用户通道：它由父代理（主代理）分派、产出交给父代理消费，
没有任何人类能向它手打授权词。因此，当你判定自己是子代理时，本 skill **整体不适用**。

判定为子代理的依据（满足其一即可）：
- **强信号（开头）**：当前提示词以固定任务描述模板开头，例如：
  - Kilo Code："You are fixing <domain> issues in <project>..."
  - ZCode："Perform a thorough review of ... in <path>. Focus on:"
  - ZCode："Perform a thorough code review of ... in <path>. Focus on:"
- **强信号（结尾）**：提示词以固定汇报格式模板结尾，例如：
  - Kilo Code："For each file, read it first, find the exact text, then edit. Return a summary of what you changed."
  - ZCode："For each issue found, provide:\n- File path...\n- Severity: Critical/Important/Minor"
- **通用模式（兜底）**：提示词同时具备以下特征时，即使措辞不在上述列表中，也应判定为子代理：
  - 开头是固定任务描述模板（非用户自然语言）
  - 结尾是固定汇报格式模板（要求逐文件/逐问题汇报）
  - 任务是多文件分派（列出多个具体文件或检查项）
- 系统提示词或任务框架自称 sub-agent / 子代理 / 被主代理（父代理）分派 / 委派执行具体任务。
- 当前对话没有交互式用户通道：你收不到用户手打的关键词，你的输出由父代理消费。
- 任务是范围明确、被委派下来的子任务，而非用户直接提出的完整实现请求。

判定为子代理 → **立即忽略本 skill 的其余全部内容**：
- 不进入计划文件流程，不写入 `.kilo/plans/`，不等任何授权词，不等待审批。
- 直接按父代理分派的指令执行。
- 涉及 Git 集成（commit/push/merge/PR）时，只执行父代理明确要求的部分；父代理未要求的保持只读。

判定不是子代理（你是直接面向用户的主代理）→ 继续阅读本 skill，照常执行完整流程。
</SUBAGENT-DETECT>

<PLAN-REVIEWER-DISPATCH>
撰写计划前，先读取当前环境的代理与模式列表——可用子代理类型、可用主代理模式——筛选计划生产候选：

- 多个候选并存时选择与当前宿主工具匹配、支持计划文件落盘与独立复审的版本；分派报错时核对完整类型名后重试一次。
- 候选为交互式主代理/模式时，建议用户切换至该模式但不阻塞用户选择，由其自身完成查找、撰写与复审；权限与授权交互按该模式定义。
- 无匹配候选时，按后续流程自行撰写。
- 分派独立复审时推行**首波单一影子代理独立重写对比计划与差集对账**（首波并发 Reviewer 恒为 1 个，产物落盘至 `.kilo/plans/review/` 并以 `-shadow-plan.md` 命名，彻底废除同质多并发走过场），并受**主代理差集仲裁硬规则**与**波次硬熔断**约束：① Files 清单差集默认标定 Critical（主代理必须二选一：承认遗漏补正吸收，或在排除项给出确凿代码证据反驳）；② 步骤覆盖差集默认标定 Important；③ 首轮复审对账判定为 GO（0 差集）即直接进入审批流程，严禁发起例行第 2 轮陪审；④ 仅当首轮存在差集被打回且回灌修正后，派发的返工核验 Reviewer 计为第 2 轮（指定 `-r2-shadow-plan.md`），且必须聚焦于核验打回项是否真正闭环。**同一复审链总波次上限为 2**。**计数域是变更集指纹而非计划文件名（仅限在途活跃链）**——新计划若承接未决 E 清单的前缀变体（含 `-round2`、`-round3`、`-final`、`-microfix`、`-acceptance`、`-remediation`、`-premerge`、`-no-go-fixes` 等后缀变体），或与当前在途未闭环计划的 Files 集合交集非空，判为同一复审链的延续，序号接续链上最大值，严禁从 r1 重开；若在途链已达 2 波上限，不得派发 Reviewer 循环，必须直接呈报人类裁决。历史已交付（已 plan_exit 且已完成或人类已明确终结/已合入分支）的归档计划自动出链，不污染新独立任务。编号方言（`rA`-`rF`、`r1a`/`r1b`、`p1`/`p2`、`t2`、`x1` 等）一律折算为序数。同编号驳回重派（限产物缺失的技术性重派）以 1 次为限。第 2 波结束仍有未解决 Critical 时，复审方报告须标记 `VERDICT: ESCALATE_TO_HUMAN`，由主代理呈报人类裁决，严禁再派第 3 波。

无论哪条路径，授权语义不变：撰写者只写计划与复审产物；审批、执行、Git 三闸门保持分离，批准计划不等于执行授权。
</PLAN-REVIEWER-DISPATCH>

<HARD-GATE>
本 skill 约束的是工作流边界，不是建议。任何实现任务都必须按以下顺序处理：

1. 只把实现计划写入当前工作区 `.kilo/plans/`，并在磁盘上校验成功。
2. 等待用户审批已经落盘的计划内容；审批不执行计划。
3. 等待用户在后续消息中再次明确授权执行指定计划；这才允许修改目标文件、运行测试或构建。
4. 执行完成后，继续等待独立的 Git 提交、推送或合并授权。

计划文件写入授权永远不等于计划内容执行授权。不能因为一次工具权限点击、计划模式退出、计划审批或模型自己的判断而跳过闸门。

**例外：ExitPlanMode 执行流。** 当计划通过 ExitPlanMode 工具交付且新对话系统提示词中逐字存在完整标记 `Read this file first and treat it as the source of truth for implementation` 时，执行已在新对话中获得授权，无需再次等待独立执行授权。Git 操作（commit/push/PR）仍需单独授权。

**另外：** 当模型以子代理身份被父代理分派执行具体任务时（判定依据见文首 `<SUBAGENT-DETECT>`），本 skill 整体不适用，子代理直接执行，无需任何授权词。
</HARD-GATE>

## 适用范围

触发本 skill 的任务包括但不限于：

- 创建、删除、移动或重命名文件和目录。
- 修改源代码、配置、文档、数据库、前端资源或构建产物。
- 修复 bug、实现功能、重构、迁移、升级依赖或调整运行行为。
- 运行与实现相关的测试、构建、格式化、服务器、部署或外部 API 操作。

纯粹的只读问答、代码搜索、解释现有实现、查看状态或用户明确要求只读检查时，不必伪造实现计划；一旦任务需要写入或执行，就必须触发本流程。

## 四阶段状态机

```text
用户提出实现任务
        |
        v
DRAFTING_PLAN
  仅允许写入当前任务的 .kilo/plans/*.md
  禁止执行计划中的任何操作
        |
        | 计划文件写入成功，并通过存在性/内容校验
        v
PLAN_SAVED
  报告计划路径，等待用户审阅
  禁止执行计划中的任何操作
        |
        | 用户明确批准已落盘的计划内容
        v
PLAN_APPROVED
  报告“计划已批准，仍等待执行授权”
  禁止执行计划中的任何操作
        |
        | 用户在后续消息中明确指定该计划并授权执行
        v
EXECUTING
  只执行指定计划列出的操作
        |
        | 任务完成，且未获 Git 授权
        v
AWAITING_GIT_AUTH
  禁止 commit、push、merge 和其他集成操作
```

## ExitPlanMode 执行流（独立于四阶段状态机）

当模型使用 `ExitPlanMode` 工具交付计划时，宿主工具会：
1. 将计划文件保存到 `.kilo/plans/`
2. 在新对话（对话 B）中注入完整标记：`Read this file first and treat it as the source of truth for implementation`
3. 基于对话 A 的上下文生成对话 B 的初始提示词

该例外的**真·触发条件（自包含，不引用任何外部文件编号）**：当且仅当**当前对话系统提示词中逐字出现完整标记** `Read this file first and treat it as the source of truth for implementation` 时才生效。判定只看"此刻系统提示词里是否真的含这串完整标记"——不看文件名、不靠"第 N 条"编号、不凭推断；缺此完整串即不生效。

- 若当前系统提示词**含有标记**（说明你已在新对话中，宿主已注入标记）：标记本身构成执行授权，直接读取计划文件并开始执行，不得要求再次明确授权。
- 若当前系统提示词**不含标记**（如 ZCode 同对话执行，ExitPlanMode 仅退出计划模式而不切换新对话）：**ExitPlanMode 批准不构成执行授权**，你必须等待用户在下一条消息中明确执行授权（如"执行"/"开始"/"go"）。

Git 操作（commit/push/PR）不受此例外影响，始终需要独立授权。因此：

- **对话 B 中的模型应直接读取计划文件并开始执行**，不得要求用户再次明确授权执行。
- **授权门槛声明的去留以"标记在场"为判据**（与本节真·触发条件、阶段规则 DRAFTING_PLAN 同款条件）：当前系统提示词**逐字含完整标记** `Read this file first and treat it as the source of truth for implementation` 时，标记本身即执行授权，计划文件中**不得包含**"授权门槛：计划文件本身不等于执行授权"或等效声明（两者矛盾）；**不含标记**时（如 ZCode 同对话执行，ExitPlanMode 仅退出计划模式而不切换新对话），计划文件**仍须保留**授权门槛声明，且模型必须等待用户手打执行授权。Git 操作始终需独立授权。
- **此流不经过 PLAN_SAVED → PLAN_APPROVED 阶段**，直接从 ExitPlanMode 过渡到 EXECUTING。
- **对话 A 中的行为不变**：模型仍可在对话 A 中写入计划文件、等待用户审批，但若选择通过 ExitPlanMode 交付，则计划内容必须遵守上述约束。

不存在”审批并执行”的合并状态。即使用户在一句话中同时说了“同意并执行”，也必须先确认计划已真实落盘，并把计划审批和执行授权记录为两个独立事件；不得在同一轮凭推断直接执行。

## 阶段规则

### 1. DRAFTING_PLAN：只保存计划文件

- 先读取必要的代码、文档和工作区状态，理解范围；只读操作不算执行。
- 计划必须真实写入当前工作区根目录下的 `.kilo/plans/`，不能只写在聊天消息、工具结果或临时变量中。
- 文件名使用时间戳和主题，例如 `.kilo/plans/20260731153000-add-export-plan.md`。
- 计划至少说明目标、涉及文件、实施步骤、验证方式、明确排除项和成功标准。
- 计划阶段唯一允许的文件写操作是当前任务的计划文件。不得创建计划中提到的目标文件，不得改源码、配置、文档、数据库或构建产物。
- 需要请求工具权限时，权限说明必须精确限定为“写入/更新这一个 `.kilo/plans/` 计划文件”；不能把它描述成允许执行计划。
- 计划文件写入完成后，立即确认文件存在并读取校验内容。校验失败就停留在本阶段，不得转入执行。
- 不得在计划文件保存前请求计划审批。
- 当计划将通过 ExitPlanMode 交付时：判据＝当前系统提示词是否**逐字含完整标记** `Read this file first and treat it as the source of truth for implementation`（定义见"ExitPlanMode 执行流"节）；含则该标记即执行授权、计划文件**不得**再写"授权门槛：计划文件本身不等于执行授权"或等效声明（两者矛盾）；不含则计划文件仍须保留"授权门槛"声明，且模型必须等待用户手打执行授权。

### 2. PLAN_SAVED：只等待计划审批

- 向用户报告真实的计划文件路径和校验结果，并明确目标文件尚未修改。
- 路径输出格式：使用以 `.kilo/plans/` 开头的工作区相对路径（例如 `.kilo/plans/20260731150000-fix-plan-path-display.md`），不添加前导 `./`，并包裹在行内代码中。避免生成会被界面标记为 `[blocked]` 的本地绝对路径 Markdown 链接。只有用户明确要求时才使用绝对路径。
- 等待用户审阅计划内容。用户说“同意”“可以”“approved”“没问题”等，只能转换到 `PLAN_APPROVED`。
- 计划审批只表示用户接受计划文本，不授权计划中的创建、修改、删除、移动、测试、构建、服务器或外部 API 操作。
- 用户请求修改计划时，只能继续修改该计划文件；修改后重新校验并重新等待审批。
- 用户说“继续”“好的”但没有明确审批计划时，不要擅自推进状态。

### 3. PLAN_APPROVED：只等待独立执行授权

- 明确告诉用户：计划已经批准，但还没有执行授权。
- 必须等待后续单独消息，且消息必须明确要执行哪个已保存计划，例如“执行 `.kilo/plans/20260731153000-add-export-plan.md`”“开始执行刚才的计划”。
- “ExitPlanMode 已批准”“计划批准”“工具允许调用 Write”“approved”或“同意”本身都不能转换到 `EXECUTING`。
- 如果用户在计划尚未审批时直接说“执行”，先要求审批已落盘计划；不能把执行请求反向当作计划审批和执行的合并授权。
- 执行授权只覆盖指定计划中的任务，不覆盖目录中其他计划，不覆盖未列出的操作，也不覆盖 Git 集成。

### 4. EXECUTING：严格按指定计划执行

- 执行前再次读取并确认指定计划路径，避免按“最新文件”或相似文件名猜测。
- 只修改计划列出的文件；计划未列出的额外变更必须先停下并获得新的计划/授权。
- 按计划顺序执行，每完成一个 Task 就更新计划中的勾选状态；更新计划本身不扩大执行范围。
- 运行测试、构建、启动服务、外部 API 或删除/移动操作前，检查计划是否明确列出；危险或不可逆操作仍需单独确认其安全范围。
- 真实报告命令和结果。失败、取消、权限拒绝或跳过都必须如实说明，不得声称已完成。
- 完成任务后进入 `AWAITING_GIT_AUTH`，不要自动提交、推送、合并或创建 PR。

### 5. AWAITING_GIT_AUTH：独立 Git 闸门

- `commit`、`push`、`merge`、rebase、创建 PR 或发布外部内容都需要用户明确的 Git/集成授权。
- 执行授权不等于提交授权。用户未明确授权时，只能报告工作区状态和验证结果。

## 命令边界总表（约束代理可执行命令：不越权，也不什么都问）

与宿主自动审批键集同源对账的正反清单——**该直调的形态不打扰人，该拒绝的形态绝不执行，其余一律如实 Ask**。任何一侧变更键集时三源对账（代理配置 map、全局 jsonc、本表；注：运行期命令动态执法已单源收口至 `mcp/plan-governor.js`，此处三源对账特指离线文档与配置键集的一致性核对）。

- **允许（只读取证与测试，单行平铺直调）**：`git status*`、`git log*`、`git diff*`、`git show*`、`git rev-parse*`、`git grep*`、`git ls-files*`、`git ls-tree*`、`git rev-list*`、`git shortlog*`、`git blame*`、`git cat-file*`、`git for-each-ref*`、`git describe*`、`git merge-base*`、`git tag`、`git tag -l*`、`git tag --list*`、`git branch`、`git branch -a*`、`git branch -r*`、`git branch -v*`、`git branch --all*`、`git branch --list*`、`git branch --show-current*`、`ls*`、`cat*`、`grep*`、`head*`、`tail*`、`wc*`、`pwd*`、`date*`、`where.exe*`、`rg*`、`whoami*`、`diff*`、`Get-ChildItem*`、`Get-Content*`、`Get-Date*`、`Select-String*`、`Test-Path*`、`Measure-Object*`、`Out-String*`、`pytest*`、`python -m pytest*`、`py -m pytest*`、`npm test*`、`pnpm test*`、`cargo test*`、`go test*`、`mvn test*`、`vitest*`、`jest*`、`python -m unittest*`、`Get-Process*`、`Get-Service*`、`Get-Command*`、`Get-Member*`、`Get-Help*`、`Get-Item*`、`Get-Location*`、`Get-Variable*`、`Get-Host*`、`Get-History*`、`Get-Random*`、`Get-PSDrive*`、`Get-ItemProperty*`、`Get-Acl*`、`Get-AuthenticodeSignature*`、`Get-FileHash*`、`Get-ComputerInfo*`、`Get-Culture*`、`Get-UICulture*`。

> 键集按跨平台单源口径对齐：`rg*`、`whoami*` 两平台通用无差异；`diff*` 已入单源，但 GNU `diff` 仅在 Git Bash 会话为真只读，pwsh 会话裸 `diff` 是 `Compare-Object` 别名（缺参挂交互提示），故 pwsh 会话不将裸 `diff` 用作真只读对比——需对比文件时用 `git diff --no-index <a> <b>`；其它测试器不在单源清单内的，由人按宿主权限配置流程补入（技能不处方新增键）。
> `date*` 仅放行只读形态；`date -s` / 裸数字设时（如 `date 122514252026`）/ `-f FILE` 等写形态由时钟闸拦截，不因命中允许键而放行。
- **拒绝（绝不执行；写通道与状态变更；文件创建/修改/删除一律宿主编辑工具）**：`Set-Content*`、`Add-Content*`、`Out-File*`、`New-Item*`、`Remove-Item*`、`Clear-Content*`、`Move-Item*`、`Copy-Item*`、`Rename-Item*`、`cp*`、`xcopy*`、`robocopy*`、`rm*`、`del*`、`rd*`、`rmdir*`、`git difftool*`、`git add*`、`git commit*`、`git push*`、`git reset*`、`git checkout*`、`git stash*`、`npm install*`、`pip install*`、`mv *`、`mv`、`touch*`、`tee*`、`dd*`、`ln *`、`chmod*`、`chown*`、`truncate*`、`sed -i*`、`node -e*`、`node --eval*`、`node -p*`、`node --print*`、`python -c*`、`python3 -c*`、`py -c*`、`perl -e*`、`ruby -e*`、`php -r*`、`npm ci*`、`git clean*`、`git restore*`、`git apply*`、`git switch*`。
- **命令包装前缀（绝不执行，全模式不豁免）**：`command `、`env `、`nohup `、`eval `、`exec `、`builtin `、`time ` 置于命令前，以及 `sh -c` / `bash -c` / `zsh -c` / `dash -c` / `ksh -c` 类壳包装——含**组合短选项簇**（`-lc` / `-ec` / `-xc` / `-eux -c`）、**长选项 + `-c`**（`--login -c`）、**紧贴参数**（`-c"…"`）与**带路径前缀的壳**（`/bin/bash -c`、`/usr/bin/sh -c`、`./bash -c`、`C:/…/bash.exe -c`）；`git -c` 后也允许紧贴式（`-ccore.pager=sh`）。前缀把真命令推到参数位，使黑名单段首前缀匹配整体失效；壳 `-c` 更是完整任意命令通道。（`xargs` 不归本类，由下方禁入清单 `xargs*` 覆盖。）
- **`--output` 写逃逸参数（绝不执行，全模式不豁免）**：只读命令不得携带 `--output=<path>` / `--output <path>`（含以引号或反斜杠打断字面量的变体，如 `--out'put'=`、`--output\=`、`\-\-output=`）——白名单前缀对该参数整体失效，可借只读命令向磁盘任意路径写盘。
- **外部进程派生参数（绝不执行，全模式不豁免）**：`--open-files-in-pager`（含无歧义前缀缩写 `--open`/`--op`/`--open-f` 等）、`--ext-diff`、`--paginate`、`--config-env`、`--pre`/`--pre-glob`/`--pre-command`、`--textconv`（含缩写 `--textc` 等）、`--filters`，以及 `git -c`（含紧贴式 `-c<键>=`）对 `core.pager` / `core.editor` / `core.sshCommand` / `core.hooksPath` / `core.fsmonitor` / `diff.external` / `interactive.diffFilter` 的注入——白名单只读命令可借这些参数派生外部进程，使前缀白名单整体失效。
- **展开构造（绝不执行，全模式不豁免）**：命令中出现 `$` 或反引号的展开构造（`$'…'` ANSI-C 引号、`$IFS` 词分割、`$(…)` 命令替换、`${VAR}` 参数展开）——展开可改写命令 token 边界，使裁决视图与执行视图分叉。单引号内的字面 `$`（如 `cat '$HOME'`）不属此类，bash 语义下确为字面量。
- **禁入（不得申请放行；宿主原生通道落 Ask 属预期，MCP 通道一律 deny）**：`find*`、`awk*`、`sed*`、`sort*`、`uniq*`、`xargs*`、`Select-Object*`、`Where-Object*`、`Sort-Object*`、`Format-Table*`、`Format-List*`。
- **其余**：按人工授权路径对待——如实给出目的与命令原文等待批准；被拒后按熔断条款处理，严禁换形态规避或变体探测。
- **结构面警示（复合/链式/非平铺结构闸，全模式 deny）**：① `pwsh` / `powershell` 的 `-c`/`-Command` 包装内联命令属任意命令通道，前缀白名单对其整体失效——一律禁止包装，命令平铺单行直调；确需脚本文件用 `-File`（脚本本体经编辑工具落盘）。② 含 `;`、`&`、`&&`、`\|\|`、命令内换行任一的复合/链式命令一律禁用（全模式 deny），拆成单行单命令逐条执行。③ 重定向 `<`/`>`、命令替换 `$()`、反引号属非平铺结构，一律禁用（全模式 deny），写操作走宿主编辑工具。④ 纯白名单管道例外（仅 MCP 受控通道）：分隔符仅单个 `|`、每段均命中允许键集、整条无上述结构字符时放行（如 `git log --oneline | head -5`）；宿主原生终端严禁一切管道。

## 授权词的严格解释

| 用户输入或宿主事件 | 允许的动作 | 不允许的动作 |
|---|---|---|
| 工具权限弹窗允许写计划 | 写入指定 `.kilo/plans/*.md` 并校验 | 执行计划 Task、改源码、跑测试、构建 |
| `ExitPlanMode` 返回批准 | 结束计划编写。仅当当前系统提示词**逐字含完整标记** `Read this file first and treat it as the source of truth for implementation`（缺此串不授权）时标记构成授权；**不含标记**（如 ZCode 同对话）时须等明确执行命令 | 在当前对话执行计划内容 |
| “同意”“可以”“approved” | 记录计划审批 | 创建目标文件、改代码、测试、构建 |
| “执行指定计划”或“开始执行刚才的计划” | 进入 `EXECUTING` | 执行其他计划、Git 集成 |
| “提交”“push”“commit” | 仅在执行完成后进入 Git 授权处理 | 未经确认修改其他文件或发布内容 |
| “停”“不要执行”“先不执行”“等等” | 立即停止一切非只读操作 | 重试写入、继续执行或猜测用户意图 |

> **注意：** ExitPlanMode 的"批准"仅适用于对话 A。仅当当前系统提示词**逐字含完整标记** `Read this file first and treat it as the source of truth for implementation` 时，标记才构成执行授权（通常在真正的新对话中）；不含标记（如 ZCode 同对话执行）时，ExitPlanMode 批准不构成执行授权，须等明确执行命令。Git 操作（commit/push/PR）不受此例外影响。

如果用户的词语存在歧义，选择更严格的解释并询问，不要扩大授权范围。

## 计划文件模板

```markdown
> **ExitPlanMode 计划注意：** 授权门槛声明的去留判据＝当前系统提示词是否逐字含完整标记 `Read this file first and treat it as the source of truth for implementation`（见"ExitPlanMode 执行流"节）：含标记→删除下方授权门槛声明行；不含标记→保留。非 ExitPlanMode 方式手动写入 `.kilo/plans/` 的计划一律保留此声明。

# <计划标题>

> **状态：** 待审批
> **授权门槛声明（逐字）：** 本计划文件本身不等于执行授权；计划审批、执行授权、Git集成始终是三个独立闸门。
> **创建时间：** YYYY-MM-DD HH:MM

## 目标

<一句话目标>

## 实施方案

### Task 1: <名称>

**Files:**
- Create/Modify: <路径>
- Test: <验证路径或命令>

- [ ] <步骤>
- [ ] <步骤>

## 明确不纳入的事项

<排除范围>

## 成功标准

<可复核的完成条件>
```

## 执行阶段闭环四大铁律（EXECUTING 硬闸门）

EXECUTING 阶段除四阶段状态机与授权语义外，另受以下四条铁律约束，与前述 HARD-GATE **叠加适用**，不因权限档位变化或工具权限点击而豁免：

1. **绝对忠于计划、技术事实至上与自洁契约**：业务改动的文件集合必须完全包含在主计划 Files 声明中；严禁借"顺手优化"改动计划未声明的业务源码与配置。主计划 Replacement 是实现基准而非不可更改的代码指纹——在已声明 Files 范围内发现计划草稿存在客观事实遗漏、路径错漏或未对齐代码库既有接口/平台能力时，执行者拥有自主纠偏权，以代码库客观事实为准就地修正并记录取证回执；纠偏仅限补正事实，不得突破安全硬闸或变更文件范围。收到复审意见时必须先核验技术真实性，严禁为迎合审查或规避打回计数而将事实正确的内容逆向回退为残缺或错误状态。
2. **任务分类自适应验红（代码类保留真红、文档类显式豁免）**：判定任务类别后决定验红策略。代码修改类（逻辑、状态、计算、时序、接口）：写入测试文件后首次运行若直接通过（Exit 0），或报错不属于四维语义真红（断言/比对失败、目标契约缺失型类型错误、被测入口主动抛出的业务领域异常、框架执行超时），**未见红严禁开工**：严禁修改业务代码，必须推翻重写测试用例直至稳定复现红灯；无法复现的转"非代码可测项豁免"，交人类裁决。纯文档/配置文字类（README、文档、注释、纯文本规范）：计划正文显式标注「本文档类任务经判定豁免 Red-Light Protocol（附非代码可测判定理由）」后免于代码验红，执行期直接进入常驻不变式（checks 套件）与静态语法核验，严禁伪造测试红灯、严禁作秀跑无关单测。
3. **终结交付门禁与在途打回上限**：业务修改转绿并通过静态契约检查后，严禁直接口头汇报完成；必须分派独立复审子代理做代码变更终验（当前宿主无 `task` 工具时，降级为受控终端只读 `git status --short -uall` 与 `git diff` + 复跑测试自检，输出结构化报告交人类）；分派时 `prompt` 参数必须逐字取用主计划步骤 N 已固化的完整派发串，不得自行改写、不得留任何待填形态。PR 审查在当前在途活跃链中**最多 1 次打回修复**；第 2 次复审仍判 NO-GO，立即终止自主循环呈报人类；历史已交付完成计划不污染新独立任务计数。
4. **Git 只读与自洁契约**：Git 写命令（`git add` / `git commit` / `git push` / `git reset` / `git checkout` / `git restore` / `git stash` / `git switch` / `git clean`）一律不执行。终验判 NO-GO 且属方案方向性错误（报告标注 `REWORK=HUMAN_CLEAN`，以区别局部实现缺陷 `REWORK=IN_PLACE`）时，严禁在污染现场叠加补丁，必须终止执行并提示人类在宿主终端按序处置：① 先运行 `git status --short -uall` 通读，区分 `??`（未跟踪）／` M`（未暂存改动）／`M `（已暂存）三态，确认清理半径只覆盖本计划 Files 声明；② 半径内若混有非本计划的在途改动，改用可逆通道 `git stash push -u -m "discarded-本计划标识"` 代替破坏性清理；③ 仅在确认无保留价值时，才执行**限定路径**的破坏性清理：`git checkout -- <①中逐一核对过的本计划 Files 路径…>` 与 `git clean -fd -- <①中确认属本计划的未跟踪路径…>`；路径无法逐一确认时，指示人类对未确认项逐项手工处置，严禁整仓无参形态 `git checkout -- .` 与 `git clean -fd`。另：`git diff` 不显示未跟踪文件——终验与自检必须以 `git status --short -uall` 展开全部物理文件，对未跟踪的新增文件逐一通读，不得默认"无改动即无风险"。

## 中断与异常

- 计划文件路径不明确、写入失败、读取失败、内容不完整或校验失败时，停留在计划阶段并报告原因。
- 用户撤回、暂停或使用中断词后，立即停止；不要通过重试、换工具或改写其他路径绕过拒绝。
- 权限闸门拒绝（宿主弹窗被拒、deny 命中或终端工具未注入）与用户拒绝同级：同一意图至多一次改用内置只读工具（Read/Grep/Glob）的改道；第二次受阻立即停手，如实报告 BLOCKED 与原始命令及拒绝形态。严禁以语法变体、拆分拼接或更换命令行工具反复探测闸门边界——探测行为本身视同越权。
- 已存在的旧计划不会自动执行。用户必须明确指定计划文件；多个候选计划存在时必须询问。
- 绝不使用 `git reset --hard`、`git checkout --`、`git clean` 或其他回滚/清理命令来“清理”状态：**Agent 一律不执行 Git 写命令**（受控通道亦恒拒），即便用户明确要求，也只输出命令原文交人类在宿主终端执行。需要人类清理现场时，提示其按序处置：① 先运行 `git status --short -uall` 通读，区分 `??`（未跟踪）／` M`（未暂存改动）／`M `（已暂存）三态，确认清理半径只覆盖本计划 Files 声明；② 半径内若混有非本计划的在途改动，改用可逆通道 `git stash push -u -m "discarded-本计划标识"` 代替破坏性清理；③ 仅在确认无保留价值时，才执行**限定路径**的破坏性清理：`git checkout -- <①中逐一核对过的本计划 Files 路径…>` 与 `git clean -fd -- <①中确认属本计划的未跟踪路径…>`；路径无法逐一确认时，指示人类对未确认项逐项手工处置，严禁整仓无参形态 `git checkout -- .` 与 `git clean -fd`。
- 不要删除或覆盖用户已有的计划、源码或配置；如目标文件已存在且不确定归属，先读取并报告。

## 与其他 skill 的关系

- 本 skill 的计划文件闸门优先于要求直接实现的 skill。
- 领域 skill（例如 Python、API、前端）只能在 `EXECUTING` 阶段、且已获独立执行授权后使用。
- 测试驱动、调试、并行 agent 或执行计划类 skill 不能绕过本 skill 的计划审批和执行授权分离。
- 不要把本 skill 安装位置误认为项目源代码：用户级版本位于 `~/.zcode/skills/plan-file-first/`，工作区覆盖版本位于 `<workspace>/.zcode/skills/plan-file-first/`；两者内容应遵循同一授权边界。
- 在 ExitPlanMode 执行流中，模型在新对话中直接进入 EXECUTING 阶段，无需经过 PLAN_SAVED 和 PLAN_APPROVED。Git 操作仍需独立授权。
- 当模型以子代理身份被父代理分派执行具体任务时（判定依据见文首 `<SUBAGENT-DETECT>`），本 skill 整体不适用，子代理直接执行；Git 集成仅执行父代理明确要求的操作。
