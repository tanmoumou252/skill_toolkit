#!/usr/bin/env bash
# 承接 sync-upstream.yml「Fetch Upstream & Provision Ephemeral Branch wip」内联 shell（逐字平移）。
# CI 引擎只负责环境/密钥/触发：以下变量由 YAML `env:` 注入（事件数据零 run: 插值）——
#   UPSTREAM_REPO, GH_TOKEN_PAT, GITHUB_TOKEN, UPSTREAM_BRANCH, MIRROR_BRANCH, STAGING_BRANCH；
#   GITHUB_REPOSITORY 为 runner 自带 env。凭证经 env 注入，可脱离引擎本地运行（Linux/git-bash/WSL）。
set -euo pipefail

# 0. 选择推送凭证：PUSH_TOKEN（PAT，可更新工作流文件）优先，否则 GITHUB_TOKEN（无法推含工作流的分支）
#    （${VAR:-} 形态：set -u 下 env 未注入该键时安全取空——CI 恒注入，本地直接运行不崩）
# 关键：actions/checkout 会注入 http.extraheader=GITHUB_TOKEN，优先级高于 URL 内嵌凭证，
# 必须先清除，否则 PAT 永远不生效、推送恒以 App 身份被拒
git config --unset-all http.https://github.com/.extraheader || true
if [ -n "${GH_TOKEN_PAT:-}" ]; then
  PUSH_URL="https://x-access-token:${GH_TOKEN_PAT}@github.com/${GITHUB_REPOSITORY}.git"
  echo "使用 PUSH_TOKEN 推送（支持工作流文件）。"
else
  PUSH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  echo "::warning::未配置 PUSH_TOKEN；若上游分支包含 .github/workflows/* 推送将被拒绝。Settings → Secrets and variables → Actions 新增 PUSH_TOKEN。"
fi

# 测试覆写面（PR 审查回灌）：PUSH_URL_OVERRIDE 指向本地 bare 仓库供集成测试免网执行；
#   生产环境缺省（CI/local 均不设该变量）不受影响。
if [ -n "${PUSH_URL_OVERRIDE:-}" ]; then
  PUSH_URL="${PUSH_URL_OVERRIDE}"
fi

# 1. 探测上游仓库：手动输入 > 仓库变量 > 自动探测 fork parent（fork 仓库元数据自带，无需用户配置）
if [ -z "${UPSTREAM_REPO}" ]; then
  echo "UPSTREAM_REPO 未显式配置，自动探测 fork parent..."
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
  echo "::error::无法确定上游仓库：本仓库不是 fork（无 parent）。请在 workflow_dispatch 表单填写 upstream_repo，或设置仓库变量 UPSTREAM_REPO。"
  exit 1
fi
# 自指闸（首个 fetch/push 前）：上游配置指向本仓库时同步退化为自我覆盖（fork 自抓自，
#   强推镜像/staging 分支改写自身历史）——GitHub 仓库名 owner/repo 大小写不敏感，故
#   不区分大小写比较。命中即跳过同步并成功退出，绝不触碰任何 fetch/push。
if [ "$(printf '%s' "${UPSTREAM_REPO}" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "${GITHUB_REPOSITORY}" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "::notice::UPSTREAM_REPO (${UPSTREAM_REPO}) 与本仓库 (GITHUB_REPOSITORY) 相同，跳过自同步。"
  exit 0
fi
echo "上游仓库: ${UPSTREAM_REPO}"
# 测试覆写面（PR 审查回灌）：UPSTREAM_URL_OVERRIDE 指向本地 bare 仓库供集成测试免网执行；
#   生产环境缺省（CI/local 不设该变量）仍走 https://github.com/<UPSTREAM_REPO>.git。
if [ -n "${UPSTREAM_URL_OVERRIDE:-}" ]; then
  UPSTREAM_URL="${UPSTREAM_URL_OVERRIDE}"
else
  UPSTREAM_URL="https://github.com/${UPSTREAM_REPO}.git"
fi
# 1a. 分支名安全闸（首个网络/推送动作前强制执行）：workflow_dispatch 入参直通 refs/heads 强推面——
#   ① 不合 Git 分支名规则（ref-format 检查）的值会让 push 失败或产生歧义 ref；
#   ② 任一分支名为 hub 会把上游内容强推覆盖控制分支（自动化层被抹，引擎自毁）；
#   ③ MIRROR_BRANCH == STAGING_BRANCH 会让"镜像基线"与"PR 沙盒"互相覆盖，基线失守。
#   校验失败立即退出，绝不触碰任何 fetch/push。
check_branch_name() {
  case "$1" in
    ''|-*|*..*|*[@[:space:]~^:?*\[]*|*.lock|*/'|'*) return 1 ;;
  esac
  case "$1" in
    */.|/.|/./*|*./|*/.|*//|*.) return 1 ;;
  esac
  return 0
}
for _b in "${MIRROR_BRANCH}" "${STAGING_BRANCH}"; do
  if ! check_branch_name "${_b}"; then
    echo "::error::分支名不合法：${_b}（含空格/控制符/../*/@{/尾点尾斜杠/.lock 等，见 git check-ref-format）。"
    exit 1
  fi
done
if [ "${MIRROR_BRANCH}" = "hub" ] || [ "${STAGING_BRANCH}" = "hub" ]; then
  echo "::error::MIRROR_BRANCH/STAGING_BRANCH 不得为 hub（控制分支）：强推将覆盖自动化层所在的控制面。"
  exit 1
fi
if [ "${MIRROR_BRANCH}" = "${STAGING_BRANCH}" ]; then
  echo "::error::MIRROR_BRANCH 与 STAGING_BRANCH 相同（${MIRROR_BRANCH}）：镜像基线与 PR 沙盒共用分支会互相覆盖。"
  exit 1
fi
git remote add upstream "${UPSTREAM_URL}" || true
git fetch upstream "${UPSTREAM_BRANCH}"

# 2. 更新本仓库镜像 dev（强制对齐上游 dev，丢弃本地镜像上的任何漂移）
git push "${PUSH_URL}" "upstream/${UPSTREAM_BRANCH}:refs/heads/${MIRROR_BRANCH}" --force

# 3. 基于上游最新提交重建临时分支 wip（若存在旧 wip 直接覆盖，等效回退到上游最新提交）
git checkout -B "${STAGING_BRANCH}" "upstream/${UPSTREAM_BRANCH}"

# 4. 【关键破局步】：从默认分支（中转控制分支）overlay 整个 .github/ 自动化层到 wip
# 触发 yml + 脚本 + 模板 + 资产是一个原子整体，整目录覆盖结构上杜绝 MODULE_NOT_FOUND；
# 只盖 .github/ 不碰产品代码，PR diff 干净。wip 上有了 auto-fill-pr.yml，
# 其 ref:base_ref 检出 wip 时即可看到配套的 auto-fill-pr.mjs。
# 【供应链闸】overlay 只覆盖同名路径、不删除 hub 没有的文件——上游 dev 若携带 .github/workflows/*，
#   会被原样带进 wip；wip 上的工作流以仓库级 PUSH_TOKEN 运行（pull_request_target 语义），攻击者
#   借 PR 合并夹带的工作流即可窃取凭证。故叠加前先整目录清除上游带来的 .github/workflows，
#   使 wip 仅保留 origin/hub（受信控制面）声明的工作流。
git fetch origin hub
if [ -d .github/workflows ]; then
  git rm -rq --ignore-unmatch .github/workflows
fi
git checkout origin/hub -- .github/
git add .github/ .coderabbit.yaml

git commit -m "ci: overlay full automation layer onto ephemeral staging [skip ci]" || true

# 5. 强制推送到远程临时分支 wip
git push "${PUSH_URL}" "${STAGING_BRANCH}" --force
echo "Ephemeral staging branch [${STAGING_BRANCH}] is ready for PR testing."
