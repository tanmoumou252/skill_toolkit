# set-agnes-config.ps1 — 工作流配置工具（人工在目标仓工作区内运行）
# 语义：不是账号全量扇出——在哪个仓的工作区里跑，就配置哪个仓。
# 配置面：全工作流仓库级 Variables 一把配齐（AI_BASE_URL/AI_MODEL/AUTO_FILL_PR_ENABLED/
#   UPSTREAM_REPO/MIRROR_BRANCH），并输出 Secrets 命令原文（AI_API_KEY/PUSH_TOKEN，不代持 key）。
#   归属判定三路（本地 git remote 信息 × gh 登录名交叉）：
#     自有仓        owner==登录名 且非 fork      → 配置
#     自有 fork     owner==登录名 且 fork=true    → 配置本 fork（绝不配置上游！），输出标上游
#     第三方克隆    owner!=登录名                 → 本账号无此仓，拒绝配置并给 fork 指引
# 目标仓名取自远程 URL 的 owner/repo——永远不用本地目录名（目录可随意 clone 改名，远程名才是 API 事实）。
# AI_API_KEY 不代持：打印带已解析仓名的待复制命令，值由人当场粘贴。
# 用法：
#   pwsh -File .github/scripts/set-agnes-config.ps1 -DryRun    # 只判定归属与目标仓名，不写
#   pwsh -File .github/scripts/set-agnes-config.ps1            # 实配 Variables（自有/自有fork 时）
#   pwsh -File .github/scripts/set-agnes-config.ps1 -Remote upstream   # 指定以某 remote 为准（默认 origin）
# 前置：git 仓库工作区 + gh CLI 已登录（gh auth status）。组织仓若 owner≠个人登录名按第三方处理，需人工自判。
# 注：本文件不含任何密钥（key 只以 "<key>" 占位出现于输出文案）；pwsh 7 直读 UTF-8 无 BOM，勿用 Windows PowerShell 5.1 跑（CJK 解码面）。
param(
  [string]$BaseUrl = 'https://api.agnes-ai.cn/v1',   # 必须带 /v1：auto-fill-pr.mjs 只拼接 /chat/completions
  [string]$Model = 'agnes-3.0-flash',
  # UPSTREAM_REPO：sync-upstream.yml 与 pr-cleanup-reset.yml 的上游同步源 (owner/repo)。
  #   留空时脚本按 fork 关系自动推断（是 fork → 取 parent；非 fork → 本仓即上游根，置为自身并落 ::warning::
  #   说明 sync/cleanup 对"自为上游"的仓库是 no-op——没有更上游可同步，wip 沙盒链路由人工 dispatch 或不出网）。
  [string]$UpstreamRepo = '',
  [string]$Remote = 'origin',
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'
# gh 目标主机：GH_HOST 环境变量优先（GHES 场景），未设置默认 github.com；主机不符的远程一律跳过
$ghHost = if ($env:GH_HOST) { $env:GH_HOST } else { 'github.com' }

function Get-OwnerRepo([string]$url) {
  $u = $url -replace '\.git/?$', ''
  # 含端口的 scheme URL（如 ssh://git@ghes.example.com:2222/owner/repo.git）：host 取 authority 剥端口后的纯主机名，
  # 否则 :42 与 GH_HOST 的逐字比较必不相等，该远程会被整段跳过、显式 -Remote 指定它也无法配置
  if ($u -match '^(?:https?://|ssh://)(?:[^@/]+@)?([^/]+)/([^/]+)/([^/]+)$') { return @{ host = ($Matches[1] -replace ':\d+$', ''); owner = $Matches[2]; repo = $Matches[3] } }
  if ($u -match '^[^@/\s]+@([^:]+):([^/]+)/([^/]+)$') { return @{ host = $Matches[1]; owner = $Matches[2]; repo = $Matches[3] } }
  return $null
}

Write-Host '== 1) 读取本工作区 git 远程（本地只读查询） =='
$remoteLines = git config --local --get-regexp '^remote\..*\.url$'
if ($LASTEXITCODE -ne 0 -or -not $remoteLines) { Write-Error '当前目录不是 git 工作区或无远程——请在目标仓库的工作区内运行本脚本'; exit 1 }
$remotes = @()
foreach ($line in $remoteLines) {
  $parts = $line -split '\s+', 2
  if ($parts.Count -ne 2) { continue }
  $name = ($parts[0] -replace '^remote\.', '') -replace '\.url$', ''
  $parsed = Get-OwnerRepo $parts[1]
  if ($null -eq $parsed) { Write-Host ('  跳过不可解析远程: {0} → {1}' -f $name, $parts[1]); continue }
  if ($parsed.host -ne $ghHost) { Write-Host ('  跳过非当前 gh 主机（{0} ≠ {1}）: {2} → {3}' -f $parsed.host, $ghHost, $name, $parts[1]); continue }
  $remotes += [pscustomobject]@{ Name = $name; Owner = $parsed.owner; Repo = $parsed.repo; Url = $parts[1] }
}
if ($remotes.Count -eq 0) { Write-Error '所有远程 URL 均无法解析为 owner/repo'; exit 1 }
foreach ($r in $remotes) { Write-Host ('  {0,-9} → {1}/{2}' -f $r.Name, $r.Owner, $r.Repo) }

Write-Host '== 2) gh 登录身份 × 远程 owner 交叉判定 =='
$viewer = (gh api user --jq .login) -join ''
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($viewer)) { Write-Error "gh api user 失败（exit $LASTEXITCODE / login 空）——先跑 gh auth status"; exit 1 }
Write-Host ('   登录账号：{0}' -f $viewer)
$mine = @($remotes | Where-Object { $_.Owner -eq $viewer })
$preferred = $mine | Where-Object { $_.Name -eq $Remote } | Select-Object -First 1
# 显式指定 -Remote 但未命中自有远程：停止，不回退、不写入、不输出 Secret 命令（是否存在其它自有远程不影响此结论）；
# 未显式指定 -Remote 时保留自动回退；两者均未命中才落入第三方克隆提示路径
if (-not $preferred -and $PSBoundParameters.ContainsKey('Remote')) {
  $ownedNames = ($mine | ForEach-Object { $_.Name }) -join ', '
  if (-not $ownedNames) { $ownedNames = '（无本账号自有远程）' }
  Write-Error ("显式 -Remote {0} 未匹配到本账号自有远程（自有：{1}）——停止配置" -f $Remote, $ownedNames); exit 1
}
if (-not $preferred) { $preferred = $mine | Select-Object -First 1 }
if (-not $preferred) {
  $others = ($remotes | ForEach-Object { "$($_.Name)=$($_.Owner)/$($_.Repo)" }) -join ', '
  Write-Host ('== 判定：第三方克隆（不属于本账号），不配置 ==')
  Write-Host ("   远程归属：{0}；登录账号：{1}" -f $others, $viewer)
  Write-Host '   如需给该上游提 PR：配置属上游仓库维护者，非你权限；如想跑自己的工作流：先在 GitHub 上 fork 本仓，'
  Write-Host '   把 fork 加为某 remote（git remote add myfork <fork-url>）后重跑本脚本即可识别为「自有 fork」。'
  exit 0
}
$target = "$($preferred.Owner)/$($preferred.Repo)"
# fork 细分（仅展示与措辞用；配置目标已锁定为自己的仓名，绝不指向上游）
$apiRaw = gh api ('repos/' + $target) --jq '{fork: .fork, parent: (.parent.full_name // empty)}'
$apiKnown = ($LASTEXITCODE -eq 0)
$api = ($apiRaw -join '')
$apiObj = $null
if ($apiKnown -and $api) { try { $apiObj = $api | ConvertFrom-Json } catch { $apiObj = $null } }
$isFork = [bool]($apiObj -and $apiObj.fork)
$parentName = if ($apiObj -and $apiObj.parent) { $apiObj.parent } else { '' }
$kindText = if (-not $apiKnown) { '自有仓库（fork 状态未知：API 不可达，不影响配置目标）' }
            elseif ($isFork) { "自有 fork（上游 $parentName——不配置上游，只配置本 fork）" }
            else { '自有仓库' }
Write-Host ("== 判定：{0} → 配置目标 {1} ==" -f $kindText, $target)

# 全工作流 Variables 配置面（幂等覆盖，一次配齐仓库级 variables）：
#   auto-fill-pr.yml  → AI_BASE_URL / AI_MODEL / AUTO_FILL_PR_ENABLED / AUTO_FILL_PR_ALLOW_EXTERNAL
#   sync-upstream.yml → UPSTREAM_REPO
#   pr-cleanup-reset.yml → UPSTREAM_REPO / MIRROR_BRANCH
# secrets（AI_API_KEY / PUSH_TOKEN）见第 4) 节——本工具不代持密钥，只输出命令原文。
Write-Host ('== 3) Variables 配置（幂等覆盖）：AI_BASE_URL={0}  AI_MODEL={1}  AUTO_FILL_PR_ENABLED=true ==' -f $BaseUrl, $Model)

# 上游同步源推断：显式入参 > fork parent 自动推断 > 非 fork 视为自身（sync/cleanup 链路 no-op 化）。
if (-not $UpstreamRepo) {
  if ($isFork -and $parentName) {
    $UpstreamRepo = $parentName
    Write-Host ('   UPSTREAM_REPO 自动推断自 fork parent：{0}' -f $UpstreamRepo)
  } else {
    $UpstreamRepo = $target
    Write-Host ('   ::warning::非 fork 且未显式传 -UpstreamRepo：UPSTREAM_REPO 置为本仓自身（{0}）。' -f $target)
    Write-Host '   本仓即上游根：sync-upstream（上游=自身）为 no-op，wip 沙盒链路仅由 workflow_dispatch 手动触发；'
    Write-Host '   若本仓镜像自别的仓库，请重跑并显式传 -UpstreamRepo "owner/repo"。'
  }
}

# MIRROR_BRANCH：cleanup 回退目标的镜像分支名（sync/cleanup 脚本缺省 'dev'；显式落变量消除缺省歧义）。
$mirrorBranch = if ($isFork -and $parentName) { 'dev' } else { 'main' }
# 非 fork 的自根仓库没有独立镜像分支概念：镜像分支=默认分支，由上面 UPSTREAM_REPO=自身保持 no-op 一致性。

if ($DryRun) {
  Write-Host ('  [dry] gh variable set AI_BASE_URL/AI_MODEL/AUTO_FILL_PR_ENABLED/UPSTREAM_REPO/MIRROR_BRANCH --repo ' + $target)
  Write-Host ('  [dry] UPSTREAM_REPO={0}  MIRROR_BRANCH={1}' -f $UpstreamRepo, $mirrorBranch)
} else {
  gh variable set AI_BASE_URL --body $BaseUrl --repo $target
  $e1 = $LASTEXITCODE
  gh variable set AI_MODEL --body $Model --repo $target
  $e2 = $LASTEXITCODE
  # AUTO_FILL_PR_ENABLED=true：auto-fill-pr.yml 的 job.if 缺省值为 'false'，不显式置 true 整个 job 直接 Skipped
  gh variable set AUTO_FILL_PR_ENABLED --body 'true' --repo $target
  $e3 = $LASTEXITCODE
  gh variable set UPSTREAM_REPO --body $UpstreamRepo --repo $target
  $e4 = $LASTEXITCODE
  gh variable set MIRROR_BRANCH --body $mirrorBranch --repo $target
  $e5 = $LASTEXITCODE
  if ($e1 -eq 0 -and $e2 -eq 0 -and $e3 -eq 0 -and $e4 -eq 0 -and $e5 -eq 0) { Write-Host ('  ✓ ' + $target + '（AI_BASE_URL/AI_MODEL/AUTO_FILL_PR_ENABLED/UPSTREAM_REPO/MIRROR_BRANCH）') }
  else { Write-Host ('  ✗ ' + $target + "（variable exits $e1/$e2/$e3/$e4/$e5——核对 gh auth 对该仓写权限）"); exit 1 }
}

Write-Host '== 4) Secret 配置（本工具不代持 key——复制下行，把 <key> 换成真实值执行） =='
if ($isFork) { Write-Host '   （fork 语义：本配置仅对 base=本fork 的 PR 生效；发往上游的 PR 走上游仓库配置）' }
Write-Host ('   （介意 --body 进会话历史的话，改用交互形态：gh secret set AI_API_KEY --repo ' + $target + '）')
Write-Host ('gh secret set AI_API_KEY --body "<key>" --repo {0}' -f $target)
# PUSH_TOKEN：sync-upstream.sh 推送 wip 的必需凭证（非可选）——wip 的 overlay 提交必然携带
#   .github/workflows/*（中转+沙盒设计核心：自动化层随沙盒进 PR），GITHUB_TOKEN 对该形态恒被
#   GitHub 硬拒（refusing to allow ... without workflows permission，且 permissions: 块无 workflows 键）。
#   仅允许 classic PAT 带 workflow scope（fine-grained PAT 选 Workflows: Read and Write）。
#   GITHUB_TOKEN 回退分支只对「上游不含任何工作流文件」的极端场景兜底，本架构下视为配置缺失。
Write-Host '   PUSH_TOKEN（必需）：classic PAT 勾选 workflow scope（或 fine-grained PAT 授 Workflows R/W）。'
Write-Host ('gh secret set PUSH_TOKEN --body "<pat-with-workflow-scope>" --repo {0}' -f $target)

# 收尾暂停：双击/右键运行时窗口会随脚本结束立即关闭，输出无法阅读；终端内运行时回车即过。
#   输入重定向（CI/管道喂入）时 Read-Host 会立即 EOF 报错或挂起——仅未重定向才暂停。
if ($Host.Name -eq 'ConsoleHost' -and -not $psISE -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
  Write-Host ''
  Read-Host '（按回车关闭）' | Out-Null
}
