#!/usr/bin/env bash
# 承接 pr-cleanup-reset.yml「Reset Ephemeral Branch wip」内联 shell（逐字平移）。
# CI 引擎只负责环境/密钥/触发：以下变量由 YAML `env:` 注入（事件数据零 run: 插值）——
#   TARGET_BRANCH, PR_HEAD, UPSTREAM_REPO, MIRROR_BRANCH, GH_TOKEN_PAT, GITHUB_TOKEN；
#   GITHUB_REPOSITORY 为 runner 自带 env。凭证经 env 注入，可脱离引擎本地运行（Linux/git-bash/WSL）。
# 测试覆写面（PR 审查回灌）：PUSH_URL 覆写——注入本仓库（github.com/<GITHUB_REPOSITORY>）之外的
#   推送 URL 供集成测试指向本地 bare 仓库；生产环境缺省（CI/local 均不设该变量）不受影响。
set -euo pipefail

# 关键：actions/checkout 会注入 http.extraheader=GITHUB_TOKEN，优先级高于 URL 内嵌凭证，必须先清除
git config --unset-all http.https://github.com/.extraheader || true
# 选择推送凭证：PUSH_TOKEN（PAT，可更新工作流文件）优先，否则 GITHUB_TOKEN
# （${VAR:-} 形态：set -u 下 env 未注入该键时安全取空——本工作流不注入 GH_TOKEN_PAT，本地直接运行不崩）
if [ -n "${GH_TOKEN_PAT:-}" ]; then
  PUSH_URL="https://x-access-token:${GH_TOKEN_PAT}@github.com/${GITHUB_REPOSITORY}.git"
else
  PUSH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  echo "::warning::未配置 PUSH_TOKEN；wip 含注入的工作流文件，回退推送可能被拒。"
fi
if [ -n "${PUSH_URL_OVERRIDE:-}" ]; then
  PUSH_URL="${PUSH_URL_OVERRIDE}"
fi
echo "PR successfully merged into temporary branch [${TARGET_BRANCH}]."
echo "PR source branch [${PR_HEAD}] will be left untouched."

# 确定上游同步源（清理后 wip 必须回退到它）
if [ -z "${UPSTREAM_REPO}" ]; then
  echo "UPSTREAM_REPO 未配置，自动探测 fork parent..."
  # E-B 可观测性：curl 失败（连接拒绝/超时/404/jq 缺失）与「非 fork（parent 缺席）」必须区分——
  #   || true 仅兜住 set -e 抢跑（保证 ::error:: 诊断可达），curl 退出码经 PIPESTATUS 捕获后分路报形态。
  curl_exit=0
  UPSTREAM_REPO="$(curl -sf "https://api.github.com/repos/${GITHUB_REPOSITORY}" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    | jq -r '.parent.full_name // empty')" || curl_exit=${PIPESTATUS[0]}
  if [ "${curl_exit}" -ne 0 ]; then
    echo "::warning::探测请求失败（curl exit=${curl_exit}：网络不可达/鉴权失败/响应非 JSON/jq 缺失），无法区分是否 fork；按 parent 缺席继续走缺省诊断。"
  fi
fi
if [ -z "${UPSTREAM_REPO}" ]; then
  echo "::error::无法确定上游仓库，wip 无法回退。请设置仓库变量 UPSTREAM_REPO。"
  exit 1
fi

# 回退方案：wip 不删除，直接强推重置到本仓库镜像分支（= 上游最新提交）。
# 等效于"回退 wip 到 a111 并丢弃 a111..a222 的全部合并内容"，且 wip 永远在场，
# 不留"分支已删等下一次 sync 才重建"的真空期。
# 重置后叠加 .github/ 自动化层（PR 审查回灌·同步/清理并发覆盖防护）：强推把 wip 回退到镜像分支后
#   wip 不再携带自动化层（脚本/工作流/模板）——下一次 PR 自 wip 切出时 auto-fill-pr.yml 检出 wip
#   将找不到配套脚本（MODULE_NOT_FOUND）。从 origin/hub（控制分支）整目录叠加回 .github/ 再提交，
#   与 sync-upstream.sh 第 4 步同口径（原子整体，杜绝 MODULE_NOT_FOUND）。
git fetch origin "${MIRROR_BRANCH}"
git push "${PUSH_URL}" "+origin/${MIRROR_BRANCH}:refs/heads/${TARGET_BRANCH}" --force
git fetch origin hub
# 本地 HEAD 必须先对齐「重置后的目标分支」再叠加：runner 检出面（hub）上 TARGET_BRANCH 的本地
#   分支可能停留在旧合并态——overlay 若叠在旧 HEAD 上会把合并内容带回远程 wip（污染回潮）。
#   checkout -B 强制把本地 TARGET_BRANCH 指到 origin/MIRROR_BRANCH（与 sync-upstream.sh 建枝同口径）。
git checkout -B "${TARGET_BRANCH}" "origin/${MIRROR_BRANCH}"
# 【供应链闸】PR 合并进 wip 可夹带 .github/workflows/*（PR 面文件随合并存活）；overlay 只覆盖同名
#   路径、不删除 hub 没有的文件——夹带工作流会以仓库级凭证运行（pull_request_target 语义）。
#   叠加前整目录清除 .github/workflows，使 wip 仅保留 origin/hub（受信控制面）声明的工作流。
if [ -d .github/workflows ]; then
  git rm -rq --ignore-unmatch .github/workflows
fi
git checkout origin/hub -- .github/
# 注意：镜像分支上 .github/ 可能整树未跟踪，`git diff HEAD -- .github/` 不显示未跟踪差异——
#   空差异判 no-op 会漏提交（实测夹具回归）。故先 `git add -A .github/` 收编未跟踪面，
#   再以「暂存区 vs HEAD 是否真有差异」决定是否提交（镜像分支恰与 hub 层同树时才 no-op）。
git add -A .github/
if git diff --cached --quiet; then
  echo ".github/ automation layer already aligned with origin/hub; no overlay commit needed."
else
  git commit -m "ci: overlay full automation layer onto ephemeral staging [skip ci]"
fi
# overlay 提交只在本地 TARGET_BRANCH 上成立——必须随重置一并推送到目标分支，
#   否则远程 wip 仍是裸镜像（无自动化层），下一次 PR 自 wip 切出即 MODULE_NOT_FOUND。
# 【推送诊断】overlay 提交恢复的工作流文件与 hub 逐字相同（同路径同内容已存在于同仓另一分支 →
#   免 workflow scope，GITHUB_TOKEN 可推）。若仍被远端拒（hub 上游变更致内容不同等），带行动指引
#   报拒绝原因后 fail-closed——绝不静默吞掉：远程 wip 缺自动化层即下一次 PR 的 MODULE_NOT_FOUND。
push_log="$(mktemp)"
if ! git push "${PUSH_URL}" "${TARGET_BRANCH}" --force 2>&1 | tee "${push_log}"; then
  if grep -q 'without .workflows. permission' "${push_log}"; then
    echo "::error::最终推送被 GitHub 拒绝：GITHUB_TOKEN 无 workflow scope 且 overlay 工作流文件与 hub 不再逐字一致（豁免失效）。"
    echo "::error::处置：在 hub 分支核对 .github/workflows 与 wip 历史差异；需人工以带 workflow scope 的凭证推送一次，或恢复 hub 侧文件一致性。"
  else
    echo "::error::最终推送失败（详见上方 git 输出）：远程 wip 未获得 overlay 提交。"
  fi
  rm -f "${push_log}"
  exit 1
fi
rm -f "${push_log}"
echo "Ephemeral branch [${TARGET_BRANCH}] has been reset to [${MIRROR_BRANCH}] (= upstream latest)."
echo "Ephemeral branch [${TARGET_BRANCH}] automation layer re-overlaid from origin/hub."
