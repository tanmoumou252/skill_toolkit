# set-agnes-config.ps1 — auto-fill-pr 接线配置工具·工作区口径（人工在目标仓工作区内运行）
# 语义（人类 2026-10-13T21:04Z 明确）：不是账号全量扇出——在哪个仓的工作区里跑，就配置哪个仓。
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
  [string]$BaseUrl = 'https://api.agnes-ai.cn/v1',   # 必须带 /v1：auto-fill-pr.mjs 只拼接 /chat/completions（实测读数见 .kilo 证据件 E8）
  [string]$Model = 'agnes-3.0-flash',
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

Write-Host ('== 3) Variables 配置（幂等覆盖）：AI_BASE_URL={0}  AI_MODEL={1} ==' -f $BaseUrl, $Model)
if ($DryRun) {
  Write-Host ('  [dry] gh variable set AI_BASE_URL/AI_MODEL --repo ' + $target)
} else {
  gh variable set AI_BASE_URL --body $BaseUrl --repo $target
  $e1 = $LASTEXITCODE
  gh variable set AI_MODEL --body $Model --repo $target
  $e2 = $LASTEXITCODE
  if ($e1 -eq 0 -and $e2 -eq 0) { Write-Host ('  ✓ ' + $target) }
  else { Write-Host ('  ✗ ' + $target + "（variable exits $e1/$e2——核对 gh auth 对该仓写权限）"); exit 1 }
}

Write-Host '== 4) Secret 配置（本工具不代持 key——复制下行，把 <key> 换成真实值执行） =='
if ($isFork) { Write-Host '   （fork 语义：本配置仅对 base=本fork 的 PR 生效；发往上游的 PR 走上游仓库配置）' }
Write-Host ('   （介意 --body 进会话历史的话，改用交互形态：gh secret set AI_API_KEY --repo ' + $target + '）')
Write-Host ('gh secret set AI_API_KEY --body "<key>" --repo {0}' -f $target)
