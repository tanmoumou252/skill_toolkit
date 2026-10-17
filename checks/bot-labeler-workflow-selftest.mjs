import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github', 'workflows', 'bot-review-labeler.yml');
const text = fs.readFileSync(workflowPath, 'utf8');

// 结构断言用 check（首错即停）；行为 harness 用非抛出 record 以逐格留证。
function check(name, ok, detail = '') {
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`OK   ${name}`);
}
let behaviorFailures = 0;

check('bot-labeler-resolve-pr-job',
  text.includes('resolve-pr:') &&
  text.includes('listPullRequestsAssociatedWithCommit') &&
  text.includes("core.setOutput('number', number || '')"));
check('bot-labeler-pr-concurrency',
  text.includes('needs: resolve-pr') &&
  text.includes('group: bot-sync-${{ needs.resolve-pr.outputs.number }}') &&
  text.includes("needs.resolve-pr.outputs.number != ''"));
// queue: max 必须落在 sync-labels concurrency 内，group 之后、cancel-in-progress: false 之前。
check('bot-labeler-queue-max-pending',
  /group: bot-sync-\$\{\{ needs\.resolve-pr\.outputs\.number \}\}\s*\n\s*queue:\s*max\s*\n\s*cancel-in-progress:\s*false/.test(text));
check('bot-labeler-head-recheck-before-label-writes',
  (text.match(/assertCurrentHead/g) || []).length >= 3 &&
  text.includes('latestPr.head.sha !== eventHeadSha'));
// 清理写操作前的 head 复核（闭合清理期 TOCTOU 窗口）：复核调用必须出现在
// removeLabel 循环之前，而非仅存在于 addLabels 之前。
const cleanupSectionIdx = text.indexOf('// 5. 应用标签与旧标清洗');
const cleanupLoopIdx = text.indexOf('for (const l of allManagedLabels)', cleanupSectionIdx);
const cleanupRemoveIdx = text.indexOf('github.rest.issues.removeLabel', cleanupLoopIdx);
const preCleanupRecheck = cleanupSectionIdx !== -1 && cleanupLoopIdx !== -1 &&
  text.slice(cleanupSectionIdx, cleanupLoopIdx).includes('await assertCurrentHead()');
check('bot-labeler-head-recheck-before-cleanup',
  cleanupRemoveIdx !== -1 && preCleanupRecheck);
// 正向标签（ai-reviewed/risk）语义改为「全部必需 bot 通过」：正向门以 requiredKeys 为准，
// 可选 bot 缺席不再阻塞（计划决策 1）。
check('bot-labeler-all-bots-rated-gate',
  text.includes('const ratingByBot') &&
  text.includes("requiredKeys.length > 0 && requiredKeys.every(key => ratingByBot[key] !== null)") &&
  text.includes('if (hasParseableRating)') === false &&
  text.includes('if (allBotsRated)'));
check('bot-labeler-incomplete-rating-needs-work',
  text.includes('partialRating || hasCheckFailure') &&
  text.includes("toAdd.add('review:needs-work')"));
// 完整评级分支状态表达式不得残留恒假的 !allBotsRated 子条件。
check('bot-labeler-status-verdict-no-dead-allbotsrated',
  text.includes('const targetStatusLabel = (hasCheckFailure || hasChangesRequested || finalScore >= 3)'));

// --- E2 契约：每次托管标签删除前必须复核 head，且复核必须落在"删除条件"与
// --- "removeLabel 调用"之间（守的是真实写操作，不是文件中某处存在调用）。
// --- 期望值由契约推导：guard 索引须严格大于条件索引且严格小于删除调用索引。
function guardBeforeDelete(conditionIdx, deleteIdx, guardIdx) {
  return conditionIdx >= 0 && deleteIdx >= 0 && guardIdx > conditionIdx && guardIdx < deleteIdx;
}

// --- 旧标清洗循环（5. 应用标签与旧标清洗 → for (const l of allManagedLabels)）
const cleanupLoopStart = text.indexOf('for (const l of allManagedLabels)', cleanupSectionIdx);
const cleanupCondition = text.indexOf('if (!toAdd.has(l) && existing.has(l))', cleanupLoopStart);
const cleanupDeleteIdx = text.indexOf('github.rest.issues.removeLabel', cleanupCondition);
const cleanupGuardIdx = text.indexOf('await assertCurrentHead()', cleanupCondition);
check('bot-labeler-cleanup-loop-per-delete-head-recheck',
  cleanupLoopStart >= 0 && guardBeforeDelete(cleanupCondition, cleanupDeleteIdx, cleanupGuardIdx));

// --- 同家族：barrier 清理循环（检查未就绪路径）同样逐个删除托管标签，
// --- 删除条件 if (existing.has(l)) 与 removeLabel 之间也必须有 head 复核。
const barrierStartIdx = text.indexOf('if (!allReady)');
const barrierLoopStart = text.indexOf('for (const l of Object.keys(SYSTEM_LABELS))', barrierStartIdx);
const barrierCondition = text.indexOf('if (existing.has(l))', barrierLoopStart);
const barrierDeleteIdx = text.indexOf('github.rest.issues.removeLabel', barrierCondition);
const barrierGuardIdx = text.indexOf('await assertCurrentHead()', barrierCondition);
check('bot-labeler-barrier-loop-per-delete-head-recheck',
  barrierLoopStart >= 0 && guardBeforeDelete(barrierCondition, barrierDeleteIdx, barrierGuardIdx));

// --- TDZ 不变量：assertCurrentHead 是 const 箭头函数（不提升），其定义必须
// --- 早于第一个调用点；barrier 循环在脚本前段执行，定义后移即 ReferenceError。
const assertDefIdx = text.indexOf('const assertCurrentHead');
const assertFirstCallIdx = text.indexOf('await assertCurrentHead()');
check('bot-labeler-assert-current-head-defined-before-use',
  assertDefIdx >= 0 && assertFirstCallIdx >= 0 && assertDefIdx < assertFirstCallIdx);

// --- Fixture fidelity: extract the real regex literals from the workflow text and
// --- assert their behavior, so a regression in the production anchor is caught.
// 4.5 载体分解析重构后，三个 bare 正则内联在 kiloScoreOf 函数体内（不再有独立 const）——
//   从 kiloScoreOf 体按出现顺序抓取（critical→warning→suggestion 各恰一处正则字面），
//   保真语义不变（行锚定 + 解析行为）。
function extractKiloBareRegexes() {
  const fnStart = text.indexOf('const kiloScoreOf = (text) =>');
  const fnEnd = text.indexOf('let kiloScore = null', fnStart);
  if (fnStart === -1 || fnEnd === -1) return null;
  const body = text.slice(fnStart, fnEnd);
  const regexes = [...body.matchAll(/\/((?:\^\|\\n\)|\(\?:\^\|\\n\))[^/]+)\/([a-z]+)/g)].map(m => new RegExp(m[1], m[2]));
  return regexes;
}
const kiloBareRegexes = extractKiloBareRegexes();
const prodBareCritical = kiloBareRegexes && kiloBareRegexes[0];
const prodBareWarning = kiloBareRegexes && kiloBareRegexes[1];
const prodBareSuggestion = kiloBareRegexes && kiloBareRegexes[2];
check('workflow-bare-critical-regex-extractable', prodBareCritical instanceof RegExp);
check('workflow-bare-warning-regex-extractable', prodBareWarning instanceof RegExp);
check('workflow-bare-suggestion-regex-extractable', prodBareSuggestion instanceof RegExp);

// --- Line-anchor invariant: every bare-severity regex must be line-anchored.
check('workflow-bare-critical-regex-line-anchored', prodBareCritical && /\(\?\:\^\|\\n\)/.test(prodBareCritical.source));
check('workflow-bare-warning-regex-line-anchored', prodBareWarning && /\(\?\:\^\|\\n\)/.test(prodBareWarning.source));
check('workflow-bare-suggestion-regex-line-anchored', prodBareSuggestion && /\(\?\:\^\|\\n\)/.test(prodBareSuggestion.source));

// --- Behavior cases run against the production-extracted regexes (not a copy).
check('workflow-bare-critical-parses', prodBareCritical.test('**CRITICAL:**\nIssue'));
check('workflow-bare-blocker-parses', prodBareCritical.test('- **BLOCKER:**\nIssue'));
check('workflow-bare-warning-parses', prodBareWarning.test('**WARNING:**\nIssue'));
check('workflow-bare-suggestion-parses', prodBareSuggestion.test('**SUGGESTION:**\nNice work'));
check('workflow-ordinary-warning-text-does-not-parse', !prodBareWarning.test('The WARNING is only mentioned in prose.'));
check('workflow-ordinary-suggestion-text-does-not-parse', !prodBareSuggestion.test('A SUGGESTION is noted inline.'));

// ================================================================
// T1 — review-based barrier 契约断言（本轮新增：完成判据从 check run
// 存在性切换为官方 bot 在 currentHeadSha 上的 authenticated review 存在性）。
// 这些断言在业务改动前必须红灯（four-dimension 真红：断言与比对失败）。
// ================================================================

// --- 触发域：pull_request_review submitted 必须显式声明（R1）---
check('workflow-declares-pull-request-review-submitted-trigger',
  /pull_request_review:\s*\n\s*types:\s*\[submitted\]/.test(text));

// --- 触发域：sync-labels.if 必须放行 review 事件（R2，E1 闭合）---
// 断言：if 表达式块内含 pull_request_review 事件名放行；精确锚定 job if 表达式片段，
// 避免仅匹配到别处的 event_name 字符串。
check('workflow-sync-labels-if-admits-review-event',
  /if:\s*>\s*\n\s*needs\.resolve-pr\.outputs\.number != '' \&\&\s*\n\s*\(github\.event_name == 'pull_request_target' \|\|\s*\n\s*github\.event_name == 'pull_request_review' \|\|/.test(text));

// --- step-0 head 解析：review 事件须从 payload.pull_request.head.sha 取 head（R3）---
check('workflow-step0-resolves-review-head',
  /context\.eventName === 'pull_request_target' \|\|\s*\n\s*context\.eventName === 'pull_request_review'\)\s*\n\s*\? context\.payload\.pull_request\?\.head\?\.sha/.test(text));

// --- 栅栏：存在按 currentHeadSha 过滤并排除 DISMISSED 的 head 评审集合（R4）---
// 注意：listReviews 分页调用跨多行，用 dotall 旗标让 `.` 跨行匹配。
check('workflow-barrier-collects-head-reviews',
  /const headReviews = [\s\S]*?\.filter\(r => r\.commit_id === currentHeadSha && r\.state !== 'DISMISSED'\)/.test(text));

// --- F-3r（Bot W8）：listReviews 同参分页调用在脚本内必须恰出现 1 次（去重配额）---
// 基线形态（修复前）=2 次（:314 栅栏 + :496 评分），此锚先红后绿。
check('workflow-listreviews-paginate-called-exactly-once',
  (text.match(/github\.rest\.pulls\.listReviews/g) || []).length === 1);

// --- 栅栏：完成判据基于官方 bot 在当前 head 的 authenticated review（任意非 DISMISSED state，含 COMMENTED）
//     或完成 check run（app.id 防伪）之一；评论顶层无 commit_id 不能满足完成。---
check('workflow-barrier-requires-bindable-head-carrier',
  /const hasHeadReview = headReviews\.some\([\s\S]{0,180}?\(def\.logins \|\| \[\]\)\.includes\(r\.user\.login\)/.test(text) &&
  /hasHeadReview \|\| hasCompletedRun/.test(text) &&
  /const hasCompletedRun = runs\.some\(r => r\.status === 'completed'\)/.test(text) &&
  /r\.commit_id === currentHeadSha && r\.state !== 'DISMISSED'/.test(text) &&
  !/\['APPROVED',\s*'CHANGES_REQUESTED'\]\.includes\(r\.state\)/.test(text));
check('workflow-no-bindable-carrier-diagnostic',
  /No bindable carrier this round for:/.test(text));

// --- F2：pull_request_review 事件 actor 类型门（新形态）——review.user.type 非 Bot 即跳过 ---

// --- 评分：review 正文采集与栅栏同源排除 DISMISSED，已撤销评审不得灌入评分管道 ---
check('workflow-scoring-bodies-exclude-dismissed',
  /for \(const rev of reviews\.filter\(r => r\.commit_id === currentHeadSha && r\.state !== 'DISMISSED'\)\)/.test(text));

// --- 栅栏：旧口径死等不再残留——等待日志不得再以 "check run has not appeared" 兜底 ---
// 断言：文本中不得再出现旧 "check run has not appeared yet" 死等措辞（已被 review 判据取代）。
check('workflow-barrier-no-stale-checkrun-wait',
  // 结构式（非散文缺失式）：BARRIER 未完成分支不得出现旧「check run has not appeared yet」死等措辞，
  //   且 barrier 判据必须包含 head-review 存在性（hasHeadReview）与终态 state 词（APPROVED/
  //   CHANGES_REQUESTED）——死等已被 review 终态门取代。
  !text.includes('check run has not appeared yet') &&
  /hasHeadReview\s*=\s*headReviews\.some\(/.test(text) &&
  text.includes('APPROVED') && text.includes('CHANGES_REQUESTED'));

// --- 身份闸 fail-closed：app.id 缺失必须排除（R5，不得退回 slug-only）---
// 断言：check-run 身份闸使用 "typeof r.app?.id !== 'number'" 的 fail-closed 形态，
// 而非旧的 "typeof r.app?.id === 'number' && r.app.id !== def.appId" 退回形态。
check('workflow-checkrun-identity-fail-closed',
  // R-F3 迁移：app.id 闸多行化（if (…) { console.log(…); return false; }），以 dotall 锚整块；
  //   反向夹具 workflow-no-stale-appid-slug-fallback 仍锁旧单行退回形态不得复活，二者不冲突。
  /if \(typeof r\.app\?\.id !== 'number' \|\| r\.app\.id !== def\.appId\) \{[\s\S]{0,400}?return false;/.test(text));
// 反向锚：旧的退回形态必须已从文件中消失。
check('workflow-no-stale-appid-slug-fallback',
  !text.includes("if (typeof r.app?.id === 'number' && r.app.id !== def.appId) return false;"));

// --- github-script 固定 Node-24 兼容 SHA（runtime-warning 处理）---
check('workflow-github-script-node24-sha',
  // 出处声明（本断言 SHA 的可核验事实源，非凭空捏造）：
  //   1) 2026-10-16 会话实取：`git ls-remote https://github.com/actions/github-script.git refs/tags/v8`
  //      ＝ ed597411d8f924073f98dfc5c65a23a2325f34cd（v8.0.0 release note 明确 "Update Node.js version
  //      support to 24.x"，GitHub 签名验证 tag；runner 最低 v2.327.1）；
  //   2) 旧 3a2844b7…（v7 系，action.yml 声明 node20）自 2026-09-23 runner 移除 node20 后仅剩 warning 噪音，
  //      本轮按欠账清单（stacked-pr-handover §2）升级清偿；
  //   3) runner 版本前置沿用 `.kilo/logs_103132623553/0_sync-labels.txt:1` 实测（2.337.0 ≥ 2.327.1）。
  //   断言仍逐字锁定该 pin，v7 标签由反向锚 workflow-no-stale-github-script-v7 锁死不得回归；
  //   SHA 变更须走代码变更审查链并同步以上登记。
  /actions\/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd/.test(text));
// 反向锚：旧的 v7 标签不得残留。
check('workflow-no-stale-github-script-v7',
  !text.includes('actions/github-script@v7'));

// --- T2 — fork PR review 受信写面契约：fork PR 的 pull_request_review 触发器运行在
// ---   非受信 merge commit、GITHUB_TOKEN 被 clamp 为只读，无法完成标签写入。受信写面
// ---   必须由基仓库上下文的事件承担：本工作流声明 issue_comment（投递到基仓库、以基
// ---   仓库 token 执行默认分支工作流），仅作评论唤醒（Bot 作者闸 + 无 head 绑定 currentHead），
// ---   评审证据仍由栅栏的 head-matching authenticated review 提供。

// --- 受信写面：issue_comment 触发必须显式声明 created/edited（fork review 的受信唤醒路）---
check('workflow-declares-issue-comment-trusted-writer-trigger',
  /issue_comment:\s*\n\s*types:\s*\[created, edited\]/.test(text));

// --- 唤醒闸：评论唤醒必须限官方 Bot 作者（type=Bot），人类评论不得触发写标签求值 ---
check('workflow-comment-wake-gates-bot-author',
  /context\.payload\.comment\?\.user\?\.type !== 'Bot'/.test(text) &&
  /isCommentWake = context\.eventName === 'issue_comment'/.test(text));

// --- step-0：评论唤醒在无 head sha 时放行（不提前 return），head 绑定延后到轮次校验 ---
check('workflow-comment-wake-defers-head-binding',
  /\(!isCommentWake && !eventHeadSha\)/.test(text) &&
  /isCommentWake && !eventHeadSha\)\s*\{\s*\n\s*eventHeadSha = currentHeadSha;/.test(text));

// --- sync-labels.if 必须放行 issue_comment（受信唤醒进入 job 求值）---
check('workflow-sync-labels-if-admits-issue-comment',
  /github\.event_name == 'issue_comment'/.test(text));

// --- resolve-pr：issue 顶层评论事件必须可归因 PR 编号（issue.pull_request 存在性闸）---
check('workflow-resolve-pr-admits-issue-comment-number',
  /context\.payload\.issue\?\.pull_request \? context\.payload\.issue\.number/.test(text));

// --- 4.3 轮次下界（fail-closed）：不得以 head commit 的 committer/author date 充当轮次下界
// ---   （该日期是 PR 作者可控伪造的元数据）；且无可信 per-head 下界时不得消费未绑定 head 的
// ---   顶层 issue 评论。评级只采信 head 绑定且身份鉴权的 review 正文（4.2）与 check run output（4.1）。
check('workflow-no-untrusted-commit-date-boundary',
  !/github\.rest\.repos\.getCommit\(/.test(text) &&
  !/currentHeadCommit\.commit\?\.committer\?\.date/.test(text) &&
  !/currentHeadStartedAt/.test(text));
check('workflow-no-unbound-top-level-comment-consumption',
  text.includes('github.rest.issues.listComments') &&
  text.includes('comment.body?.includes(STATUS_COMMENT_MARKER)') &&
  (() => {
    // 反向夹具（区域切片式）：4.1/4.2 评分管道区间内不得出现来自 issues.listComments/
    //   comment 变量的文本拼接。取 4.1 节头到 4.4 节头之间的切片，锚定真实消费点。
    const start = text.indexOf('4.1 提取 Checks API');
    const end = text.indexOf('4.4 CodeRabbit');
    if (start === -1 || end === -1 || end <= start) return false;
    const scoring = text.slice(start, end);
    return !/github\.rest\.issues\.listComments\(/.test(scoring) &&
      !/codeRabbitText\s*\+=\s*[^\n]*comment/.test(scoring) &&
      !/kiloCodeText\s*\+=\s*[^\n]*comment/.test(scoring);
  })() &&
  !/botRoundBoundaries/.test(text) &&
  !/latestBotComment/.test(text));
// 反向锚：旧口径（按 bot 最新 head review submitted_at 推边界 / run started_at 兜底）必须消失。
check('workflow-round-boundary-no-review-submitted-at-inference',
  !text.includes('latestHeadReview') && !text.includes('headReviewForBot') &&
  !/matchingRun && matchingRun\.started_at/.test(text));

// ================================================================
// F1/F2/F5 护栏回归夹具（结构式双锚：新形态在场 + 旧形态零残留）
// 补 E-1 缺口：本轮新落地的登录白名单、review actor 门、barrier 裁决组跳过、
//   无评级 needs-work 保留四护栏此前无任何专属断言；旧断言用宽松子串匹配，
//   对新旧实现同绿（如 login 白名单判定里的 type!=='Bot' 子串在旧形态同样存在）。
// 现各补一条结构式断言（锚新形态关键表达式）与一条反向锚（锁旧形态不得复活）。
// ================================================================

// --- F1：评论唤醒登录名白名单（新形态）——受信登录名从 BOT_DEFINITIONS 派生 + 双条件 AND 取反门 ---
check('workflow-comment-wake-trusted-login-whitelist',
  /const trustedCommentLogins = new Set\(Object\.values\(BOT_DEFINITIONS\)\.flatMap\(d => d\.logins \|\| \[\]\)\)/.test(text) &&
  /if \(isCommentWake &&\s*\n\s*\(context\.payload\.comment\?\.user\?\.type !== 'Bot' \|\|\s*\n\s*!trustedCommentLogins\.has\(context\.payload\.comment\?\.user\?\.login\)\)\)/.test(text));
// 反向锚：硬编码登录名集合不得复活（单一事实源 = BOT_DEFINITIONS 派生）。
check('workflow-no-stale-hardcoded-trusted-login-set',
  !/const trustedCommentLogins = new Set\(\[/.test(text));
// 反向锚：仅 type!=='Bot' 无登录名白名单的旧形态不得复活（任意 Bot 登录名即可唤醒）。
check('workflow-no-stale-comment-wake-type-only-gate',
  !/if \(isCommentWake && context\.payload\.comment\?\.user\?\.type !== 'Bot'\)/.test(text));

// --- F1 附加（bot login 单一事实源）：BOT_DEFINITIONS 唯一定义且早于唤醒门消费（const 不提升/TDZ 约束）---
check('workflow-bot-definitions-single-source-before-use',
  (() => {
    const defs = text.match(/const BOT_DEFINITIONS = \{/g) || [];
    const defIdx = text.indexOf('const BOT_DEFINITIONS');
    const useIdx = text.indexOf('trustedCommentLogins = new Set(Object.values(BOT_DEFINITIONS)');
    return defs.length === 1 && defIdx >= 0 && useIdx >= 0 && defIdx < useIdx;
  })());

// --- F2：pull_request_review 事件 actor 类型门（新形态）——review.user.type 非 Bot 即跳过 ---
check('workflow-pull-request-review-actor-type-gate',
  /if \(context\.eventName === 'pull_request_review' && context\.payload\.review\?\.user\?\.type !== 'Bot'\)/.test(text) &&
  text.includes('[PR Check] Non-bot review actor; skipping label sync.'));
// 反向锚：无 actor 门的旧形态（review 事件直接进入标签同步，step-0 无 review user 判定）不得复活。
//   新形态在 eventHeadSha 解析与 prNumber 校验之间插入 pull_request_review actor 门；旧形态无该门，
//   故断言「review actor 门文本在场」即等价锁定旧形态缺席（与正向断言 workflow-pull-request-review-actor-type-gate 互补）。
check('workflow-no-stale-review-event-without-actor-gate',
  text.includes("context.eventName === 'pull_request_review' && context.payload.review?.user?.type !== 'Bot'"));

// --- F7：barrier 未完成清理循环只保留本轮状态标签（pending 或 unavailable），删除陈旧 approved/risk。
check('workflow-barrier-cleanup-retains-waiting-status-label',
  (() => {
    const barrierIdx = text.indexOf('if (!allReady)');
    const loopStart = text.indexOf('for (const l of Object.keys(SYSTEM_LABELS))', barrierIdx);
    if (barrierIdx === -1 || loopStart === -1) return false;
    const skipIdx = text.indexOf("if (l === waitingStatusLabel) continue;", loopStart);
    const existingIdx = text.indexOf('if (existing.has(l))', loopStart);
    return skipIdx !== -1 && existingIdx !== -1 && skipIdx < existingIdx;
  })());
// 反向锚：旧的「跳过整个 review:/risk: 裁决组」通用前缀 skip 不得复活（它与 F7 白名单保留语义相反）。
check('workflow-no-stale-barrier-cleanup-skips-all-verdict',
  !/if \(\(l\.startsWith\('review:'\) \|\| l\.startsWith\('risk:'\)\)\) continue;/.test(text));
// --- 等待分支循环后必须按 waitingStatusLabel 添加 pending/unavailable，且为 ensure-before-add ---
check('workflow-barrier-waiting-ensures-waiting-status-label',
  (() => {
    const barrierIdx = text.indexOf('if (!allReady)');
    if (barrierIdx === -1) return false;
    const ensureIdx = text.indexOf('if (!existing.has(waitingStatusLabel))', barrierIdx);
    const addIdx = text.indexOf('labels: [waitingStatusLabel]', ensureIdx);
    if (ensureIdx === -1 || addIdx === -1) return false;
    const block = text.slice(ensureIdx, addIdx);
    const guardIdx = block.indexOf('await assertCurrentHead()');
    const provIdx = block.indexOf('ensureLabelsProvisioned()');
    return guardIdx !== -1 && provIdx !== -1 && guardIdx < provIdx &&
      text.includes("'review:pending'") && text.includes("'review:unavailable'");
  })());
// 反向锚：无裁决组跳过的旧循环（直接 `if (existing.has(l))` 起删）不得复活。
check('workflow-no-stale-barrier-cleanup-deletes-verdict',
  !/for \(const l of Object\.keys\(SYSTEM_LABELS\)\) \{\s*\n\s*if \(existing\.has\(l\)\) \{/.test(text));

// --- F5（契约 3 C-B 翻转，20261017 计划）：纯无评级 → verdict=no-rating 显式态（旧「无条件 needs-work」退役）；
//     needs-work 仅由 check failure / CHANGES_REQUESTED 单独决定（新文案分支锚 + 排序锚保留）。
check('workflow-no-rating-preserves-needs-work-verdict',
  /No parseable rating with check failure \/ CHANGES_REQUESTED; marking review:needs-work\./.test(text) &&
  /No parseable rating; verdict falls back to no-rating \(N\/A\)\./.test(text) &&
  (() => {
    const elseIdx = text.lastIndexOf('Neither bot produced a parseable rating');
    if (elseIdx !== -1) return false; // 旧"清空裁决"文案零残留
    const partialIdx = text.indexOf('Partial ratings or failed check');
    const noRateIdx = text.indexOf('No parseable rating; verdict falls back');
    const noRateFailIdx = text.indexOf('No parseable rating with check failure');
    return partialIdx !== -1 && noRateIdx !== -1 && noRateFailIdx !== -1 &&
      noRateIdx > partialIdx && noRateFailIdx > partialIdx;
  })());
// 反向锚：旧"无评级即清空全部裁决"语义不得复活。
check('workflow-no-stale-no-rating-clears-verdict',
  !/Neither bot produced a parseable rating\. Clearing review labels\./.test(text));

// ================================================================
// 在途改动双锚（F1/F2/F5 之外的两处执行前已存在的加固，与本计划叠加）
// 这两处不在本计划 Replacement 集内，故此前无断言保护——补入防止被无红灯回退。
// ================================================================

// --- 在途 1：按 bot 分类的状态门（新形态）：匹配 run 仍 in_progress → barrier 的 pending 分支。
check('workflow-barrier-passed-check-run-status-gate',
  /const activeRuns = runs\.filter\(r => r\.status !== 'completed'\)/.test(text) &&
  /def\.required && activeRuns\.length > 0/.test(text) &&
  /def\.required && !\(state === 'completed' \|\| state === 'failed'\)/.test(text) &&
  text.includes("'review:pending'"));
// 反向锚：活跃 run 阻塞不受 required 门控的旧形态不得复活（可选 bot in_progress 误阻塞 barrier）。
check('workflow-no-stale-unconditional-active-run-block',
  !/if \(activeRuns\.length > 0 \|\| \(def\.required/.test(text));
// 结构断言（E-1 护栏显式化，E-2 r2 收紧）：targetRuns 聚合必须以「最新已 completed attempt」为
//   源——barrier 为可选 bot 放行后，此门是 4.1 不误纳在途 run 的唯一保证，且重试窗口不得
//   丢弃旧失败证据；恒 push 与「latestRun 门控」旧形态均不得复活。
check('workflow-aggregation-gates-on-completed-run',
  /const latestCompletedRun = runs\.filter\(r => r\.status === 'completed'\)\.sort\(/.test(text) &&
  /if \(latestCompletedRun\) targetRuns\.push\(latestCompletedRun\)/.test(text) &&
  !/if \(latestRun\) targetRuns\.push\(latestRun\)/.test(text) &&
  !/if \(latestRun && latestRun\.status === 'completed'\) targetRuns\.push\(latestRun\)/.test(text));
// 反向锚：旧形态把 required bot 的 failed 也当作非完成阻塞 barrier，导致必需 bot 永久 pending；
//   该表达式不得复活。
check('workflow-no-stale-block-on-failed-required-state',
  !/def\.required && state !== 'completed'/.test(text));
// 反向锚：不再保留 barrier 之后的旧静默状态门；活跃 run 必须在写 status label/comment 的 barrier 路径表达。
check('workflow-no-stale-barrier-passed-without-status-gate',
  !/if \(targetRuns\.some\(run => run\.status !== 'completed'\)\)/.test(text) &&
  /activeRuns\.length > 0/.test(text));

// --- 在途 2：`skipped` check run 结论不算失败检查（新形态）——
// 正向：conclusion 条件显式排除 `skipped`；`skipped` 是"未跑"而非"跑挂"。
check('workflow-skipped-conclusion-not-failure',
  /run\.conclusion !== 'success' && run\.conclusion !== 'neutral' && run\.conclusion !== 'skipped'/.test(text));
// 反向锚：把 `skipped` 当失败的旧形态（三条件无排除）不得复活。
check('workflow-no-stale-skipped-as-failure',
  !/run\.conclusion !== 'success' && run\.conclusion !== 'neutral'\s*\n\s*\{/
    .test(text.slice(text.indexOf('let hasCheckFailure'), text.indexOf('// 4.2 提取 Pull Request'))));

check('workflow-status-labels-declared',
  /'review:pending':\s*\{/.test(text) && /'review:unavailable':\s*\{/.test(text));
check('workflow-required-bot-field-and-thresholds',
  /'coderabbit': \{[^}]*required: false/.test(text) &&
  /'kilocode': \{[^}]*required: true/.test(text) &&
  /^ {6}CODERABBIT_MAX_FILES: '100'$/m.test(text) &&
  /^ {6}CODERABBIT_MIN_STARS: '10'$/m.test(text) &&
  /const CODERABBIT_MAX_FILES = Number\(process\.env\.CODERABBIT_MAX_FILES/.test(text) &&
  /const CODERABBIT_MIN_STARS = Number\(process\.env\.CODERABBIT_MIN_STARS/.test(text));
check('workflow-file-limit-and-manual-required-signals',
  /prData\.changed_files\s*>\s*CODERABBIT_MAX_FILES/.test(text) &&
  /repositoryData\.stargazers_count\s*<\s*CODERABBIT_MIN_STARS/.test(text));
check('workflow-status-comment-marker-and-bot-owner-lookup',
  text.includes("const STATUS_COMMENT_MARKER = '<!-- bot-review-labeler:status -->'") &&
  text.includes("comment.body?.includes(STATUS_COMMENT_MARKER)") &&
  text.includes("comment.user?.type === 'Bot'") &&
  text.includes("comment.user?.login === 'github-actions[bot]'") &&
  /github\.rest\.issues\.updateComment\(/.test(text) &&
  /github\.rest\.issues\.createComment\(/.test(text));

// --- §0 定版形态结构锚（方案3表格 + 证据链接 + 进度表 + 统一 flat 两段式徽章 + emoji 零使用）。
//     期望值溯源：主计划 §0 人类定版（2026-10-14T07:19Z）契约，非抄录当前实现。
// S1 表格定版：审查表表头/进度表表头/统一 flat 两段式徽章在场（plastic 形态已退役，负向锁死不回退）。
check('workflow-status-comment-finalized-table-form',
  text.includes('| 审查节点 | 执行结果 | 风险量化 | 附注 |') &&
  text.includes('| 组件 | 状态 | 附注 |') &&
  /BADGE\([^)]*'flat'/.test(text) &&
  !/BADGE\([^)]*'plastic'/.test(text));
// S1b 徽章/图标本仓固化 + HEAD 徽章 shields 化（Finding 1 修订）：iconify 零出现；静态徽章经
//   BADGE_FILES 登记表走本仓 raw URL（缺映射即抛，防静默裂图；图标 raw URL 由 octicon 锚 :432 覆盖）；
//   HEAD 徽章走 shields 动态外链，writeStatusComment 内绝不出现仓库文件写入 API（getContent/
//   createOrUpdate）——负向锁死"去 contents:write 写库"这一收口不被回退。
check('workflow-status-comment-badges-repo-localized',
  (() => {
    const fnStart = text.indexOf('async function writeStatusComment');
    if (fnStart === -1) return false;
    const section41 = text.indexOf('4.1 提取 Checks API');
    const body = text.slice(fnStart, section41 > fnStart ? section41 : text.length);
    return body.includes('img.shields.io/badge/HEAD-') &&
      !body.includes('createOrUpdateFileContents') &&
      !body.includes('repos.getContent') &&
      !body.includes('api.iconify.design');
  })() &&
  /const BADGE_FILES = new Set\(\[/.test(text) &&
  /unknown badge asset/.test(text) &&
  !/^[ \t]*contents:[ \t]*write[ \t]*(#.*)?$/m.test(text) &&
  (text.match(/img\.shields\.io/g) || []).length === 1); // 仅 HEAD 徽章 shields 外链一处// S2 图标定版（本仓固化后修订）：octicon path 固化于 .github/assets/badges/（icon-*.svg 六枚，
//   生成器 checks/build-status-badges.mjs 着色 #57606a），工作流以 ICON(name,size) 引用本仓 raw URL；
//   emoji 零使用（负向锚：status comment 区段（常量区 BOT_STATE_META 起）不匹配 emoji 码点区间，
//   区间含 U+2600-27BF（✅ U+2705 等杂项符号）与 U+1F300-1FAFF）。
check('workflow-status-comment-octicon-icons-no-emoji',
  ['git-pull-request', 'tasklist', 'link-external', 'code', 'pencil', 'file']
    .every((ic) => text.includes(`ICON('${ic}'`)) &&
  text.includes("BADGE_BASE}/icon-${name}.svg") &&
  (() => {
    const start = text.indexOf('BOT_STATE_META');
    const end = text.indexOf('// 3. 栅栏汇合');
    if (start === -1 || end === -1 || end <= start) return false;
    return !/[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}]/u.test(text.slice(start, end));
  })());
// S2b 徽章清单单源漂移闸（方案 B，人类锁定 p5 §6.2）：build-status-badges.mjs 的 BADGES 手抄了
//   labeler 五表（BOT_STATE_META/RISK/VERDICT/AUTOFILL），单一事实源在 labeler、生成侧为冻结镜像；
//   本闸解析两侧并断言产物 .svg 文件名集（`${file}-${shape}.svg` 口径）逐字相等，缺/多即红。
{
  const genText = fs.readFileSync(path.join(root, 'checks', 'build-status-badges.mjs'), 'utf8');
  const gStart = genText.indexOf('const BADGES = [');
  const gEnd = gStart === -1 ? -1 : genText.indexOf('];', gStart);
  const genNames = new Set();
  if (gEnd !== -1) {
    for (const m of genText.slice(gStart, gEnd).matchAll(/\[\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*\]/g)) {
      genNames.add(`${m[1]}-flat.svg`);
    }
  }
  const bStart = text.indexOf('const BADGE_FILES = new Set([');
  const bEnd = bStart === -1 ? -1 : text.indexOf(']);', bStart);
  const labelerNames = new Set();
  if (bEnd !== -1) {
    for (const m of text.slice(bStart, bEnd).matchAll(/'([^']+\.svg)'/g)) labelerNames.add(m[1]);
  }
  const onlyGen = [...genNames].filter((x) => !labelerNames.has(x));
  const onlyLabeler = [...labelerNames].filter((x) => !genNames.has(x));
  check('badge-registry-no-drift',
    genNames.size > 0 && labelerNames.size > 0 && onlyGen.length === 0 && onlyLabeler.length === 0,
    'onlyGenerator=' + JSON.stringify(onlyGen) + ' onlyLabeler=' + JSON.stringify(onlyLabeler));
}
// S3 内联采集区段隔离：pulls.listComments 仅出现在 writeStatusComment 区段（4.1 节头之前）。
check('workflow-inline-comments-fetched-in-status-comment-only',
  text.includes('github.rest.pulls.listComments') &&
  (() => {
    const fnStart = text.indexOf('async function writeStatusComment');
    const fnEnd = text.indexOf('\n            }\r\n', fnStart) !== -1
      ? text.indexOf('\n            }\r\n', fnStart)
      : text.indexOf('\n            }\n', fnStart);
    const section41 = text.indexOf('4.1 提取 Checks API');
    if (fnStart === -1 || fnEnd === -1 || section41 === -1 || fnEnd > section41) return false;
    const body = text.slice(fnStart, fnEnd);
    return body.includes('github.rest.pulls.listComments');
  })());
// S4 证据链接定版：HEAD 徽章 commit 链接 + bot 执行结果徽章 html_url 包裹 + 进度表 auto-fill 三态解析。
// S4b 取末次 sentinel 双保险（E1 契约）：实现侧用 matchAll 取末次标记（first-match 跨轮累积时取最旧）。
check('workflow-autofill-sentinel-last-match-resolution',
  /syncSentinelRe|matchAll\s*\(/.test(text) &&
  /lastSyncMatch|\.at\(-1\)|\[matches\.length - 1\]/.test(text));
check('workflow-status-comment-evidence-links',
  text.includes('/commits/${') &&
  text.includes('auto-fill-pr: synced head=') &&
  text.includes('已更新') && text.includes('已生成_但head过期') && text.includes('未生成'));
// S5 采集 fail-safe：try/catch 降级行在场。
check('workflow-inline-comments-fetch-fail-safe',
  text.includes('catch (err)') &&
  text.includes('内联评论采集失败'));
// S6 自引用收敛：ownComment?.html_url 单一事实源 + fenced 链接块（§0 定版形态：本评论链接节）。
check('workflow-status-comment-self-url-converges',
  text.includes('ownComment?.html_url') &&
  text.includes('本评论链接'));
// S7 BOT-METADATA 转义器在场。
check('workflow-bot-metadata-tail-with-escaping',
  text.includes('BOT-METADATA') &&
  text.includes("replace(/</g, '\\\\u003c')") &&
  text.includes("replace(/>/g, '\\\\u003e')") &&
  text.includes('comment_url'));

// ================================================================
// 行为级 harness（F2 + 载体矩阵）：提取 workflow sync-labels 内联脚本并真实执行，
// mock github/context/core/process，断言标签 API 真实调用（不以文本位置为 Oracle）。
// 契约（Finding 1/3）：完成信号=已认证 bot 的 head-bound 可绑定载体；顶层 comment 仅唤醒。
// 期望值由契约推导，不以当前实现为 Oracle；gate-removal 变异必须被捕获（突变验证）。
// ================================================================
function extractSyncLabelsScript(y) {
  const lines = y.split(/\r?\n/);
  // 锚定 sync-labels job：先定位 `sync-labels:` 作业键，再取其之后的第一个 script 块。
  //   不假设「最后一个 script 块就是 sync-labels」——后续追加/重排含 script 的 step 会让
  //   提取器静默执行错脚本而文本断言仍绿（行为套件假绿）。取首个而非末个，同步保序安全。
  let jobIdx = -1;
  for (let i = 0; i < lines.length; i++) if (/^\s{0,4}sync-labels:\s*$/.test(lines[i])) { jobIdx = i; break; }
  if (jobIdx === -1) throw new Error('未定位 sync-labels job');
  // job 边界：从 job 键之后第一个缩进 ≤ job 键缩进的非空行终止，使 script 收集与唯一性判定锁在本 job 内。
  const jobKeyIndent = lines[jobIdx].match(/^[ \t]*/)[0].length;
  let jobEnd = lines.length;
  for (let i = jobIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (lines[i].trim().startsWith('#')) continue;
    if (lines[i].match(/^[ \t]*/)[0].length <= jobKeyIndent) { jobEnd = i; break; }
  }
  const starts = [];
  for (let i = jobIdx + 1; i < jobEnd; i++) if (/^([ \t]*)script:[ \t]*\|[ \t]*$/.test(lines[i])) starts.push(i);
  // 结构锚（评审 359）：sync-labels job 必须恰含 1 个 script 块——缺失/歧义一律拒绝执行，
  //   而非靠内部符号名把守（符号名是实现对细节非契约，重命名常量不应使 harness 崩溃）。
  if (starts.length !== 1) throw new Error('sync-labels job 内 script 块数非 1（实际 ' + starts.length + '，疑似结构变动）；拒绝在歧义块上执行');
  const s = starts[0];
  const keyIndent = lines[s].match(/^[ \t]*/)[0].length;
  const body = [];
  for (let s2 = s + 1; s2 < jobEnd; s2++) {
    const l = lines[s2];
    if (l.trim() === '') { body.push(''); continue; }
    const ind = l.match(/^[ \t]*/)[0].length;
    if (ind <= keyIndent) break;
    body.push(l);
  }
  const nonEmpty = body.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) throw new Error('sync-labels script 块为空');
  const common = Math.min(...nonEmpty.map((l) => l.match(/^ */)[0].length));
  const script = body.map((l) => (l.trim() === '' ? '' : l.slice(common))).join('\n');
  // 错提取防呆：脚本体必引用标签写调用 addLabels/removeLabel（行为契约级结构锚，
  //   区别于绑定单一实现符号名的 SYSTEM_LABELS），提取错块时 fail-loud，绝不静默执行他脚本。
  if (!/\baddLabels\s*\(/.test(script) || !/\bremoveLabel\s*\(/.test(script))
    throw new Error('提取到的 script 未引用标签写调用 addLabels/removeLabel（疑似提取错脚本块）');
  return script;
}

// 从 sync-labels 内联脚本真实执行；mock github/context/process，记录标签 API 调用。
// 不复制谓词：完成/不完成完全由脚本在真实数据上的执行结果决定。
// 可用性模型扩展：pulls.get 携 changed_files（file_limit 信号，与 head.sha 同一响应，
//   零额外调用）；repos.get 携 stargazers_count（manual_required 信号，一次读取）；
//   issues.listComments/createComment/updateComment 承载 D 契约 Action 自持状态评论——
//   mock 内维护 comments 数组，使定位(create/update)与断言(update 而非 create)可观测。
async function runWorkflow({ eventName, payload, env, headSha, headBranchRef, reviews, checkRuns, issueLabels, repoLabels, changedFiles, stars, comments, pullComments, prBody, headShaAfter, switchAfterCall, commitStatuses, autofillRunRecord, scriptSrc }) {
  const labelsAdded = []; const labelsRemoved = []; const provisioned = [];
  const calls = { add: 0, remove: 0, create: 0, pullsGet: 0, reposGet: 0, listComments: 0, pullsListComments: 0, createComment: 0, updateComment: 0 };
  const logs = [];
  const repo = { owner: 'o', repo: 'r' };
  const revs = reviews || [];
  const runs = checkRuns || [];
  // 可变评论集（引用传入数组，使 updateComment 就地生效、断言可查最终正文）。
  const commentList = comments || [];
  // F-8 桩保真（GitHub REST checks/listForRef 官方默认 filter=latest——每个 name 只回最新
  //   attempt）：调用方未显式传 filter:'all' 时按 name 折叠到最大 run_attempt，旧 attempt 不可见。
  //   期望值取官方文档口径（两次核对，见计划 F-8），非抄录当前实现（现实现未传 filter）。
  const latestAttemptOnly = (rs) => {
    const best = new Map();
    for (const r of rs) {
      const prev = best.get(r.name);
      if (!prev || Number(r.run_attempt || 0) > Number(prev.run_attempt || 0)) best.set(r.name, r);
    }
    return [...best.values()];
  };
  const github = {
    paginate: async (fn, params) => {
      const result = await fn(params);
      if (Array.isArray(result)) return result;
      const data = result?.data;
      if (Array.isArray(data)) return data;
      return data?.reviews || data?.check_runs || data?.comments || [];
    },
    rest: {
      pulls: {
        // head drift simulation: pulls.get returns headSha for the first switchAfterCall reads,
        // then headShaAfter (E1 TOCTOU/self-heal fixture). Defaults keep every existing case stable.
        get: async () => {
          calls.pullsGet += 1;
          const sha = (typeof switchAfterCall === 'number' && calls.pullsGet > switchAfterCall)
            ? (headShaAfter || headSha)
            : headSha;
          return { data: { head: { sha, ref: headBranchRef || 'feature-branch' }, changed_files: changedFiles, body: prBody } };
        },
        listReviews: async () => ({ data: revs }),
        // D2 契约：内联评论采集面（pulls.listComments）——返回 data 数组供 paginate 展开；
        //   元素形如 { id, pull_request_review_id, user: {type, login}, html_url }。
        listComments: async () => { calls.pullsListComments += 1; return { data: pullComments || [] }; },
      },
      repos: {
        get: async () => { calls.reposGet += 1; return { data: { stargazers_count: stars } }; },
        // D8c 终局佐证桩：回放 currentHeadSha 上的 commit status 列表（context/state 筛选由被测代码自持）。
        listCommitStatusesForRef: async () => { calls.listStatuses = (calls.listStatuses || 0) + 1; return { data: commitStatuses || [] }; },
      },
      // F-8 桩保真：未显式 filter:'all' 时模拟官方默认 latest（每 name 仅最新 attempt 可见）。
      checks: { listForRef: async (params) => ({ data: { check_runs: params && params.filter === 'all' ? runs : latestAttemptOnly(runs) } }) },
      // D8c 终局佐证桩：repos.listCommitStatusesForRef 回放注入的 commitStatuses（currentHeadSha
      //   上的 status 列表，由被测代码自行按 context/state 筛选）；actions.getWorkflowRun 回放
      //   autofillRunRecord（权威 run 记录：path 文件部分/event/conclusion 本体身份 + pull_requests[]
      //   head 关联，被测代码自行核对本体身份与 head 关联两段）。
      actions: {
        getWorkflowRun: async (params) => {
          calls.getWorkflowRun = (calls.getWorkflowRun || 0) + 1;
          calls.lastRunId = params.run_id;
          return { data: autofillRunRecord || { id: params.run_id, pull_requests: [] } };
        },
      },
      issues: {
        listLabelsForRepo: async () => ({ data: (repoLabels || []).map((n) => ({ name: n })) }),
        listLabelsOnIssue: async () => ({ data: (issueLabels || []).map((n) => ({ name: n })) }),
        addLabels: async (p) => { calls.add += 1; labelsAdded.push(p.labels); },
        removeLabel: async (p) => { calls.remove += 1; labelsRemoved.push(p.name); },
        createLabel: async (p) => { calls.create += 1; provisioned.push(p.name); },
        listComments: async () => { calls.listComments += 1; return { data: commentList }; },
        createComment: async (p) => {
          calls.createComment += 1;
          const id = 900 + commentList.length;
          const htmlUrl = `https://github.com/o/r/pull/8#issuecomment-${id}`;
          commentList.push({ id, body: p.body, html_url: htmlUrl, user: { type: 'Bot', login: 'github-actions[bot]' } });
          return { data: { id, html_url: htmlUrl } };
        },
        updateComment: async (p) => {
          calls.updateComment += 1;
          const target = commentList.find((c) => c.id === p.comment_id);
          if (target) target.body = p.body;
          return { data: {} };
        },
      },
    },
  };
  const context = { eventName, payload: payload || {}, repo };
  const core = { setOutput: () => {} };
  const process = { env: env || {} };
  const consoleMock = { log: (...a) => logs.push(a.join(' ')) };
  // 提取失败不再穿出顶层 await 终止进程（评审 359）：捕获进 err，使载体矩阵与后续用例仍逐例上报真实原因。
  let scriptBody = scriptSrc;
  let extractErr = null;
  if (!scriptBody) {
    try { scriptBody = extractSyncLabelsScript(text); }
    catch (e) { extractErr = e; scriptBody = ''; }
  }
  // 构造期 SyntaxError（YAML 编辑事故产出非法 JS）与提取失败同走逐例 err 通道（评审 359 契约）：
  //   new Function 同步 throw 不被 await 链 .then(onrejected) 覆盖，必须就地捕获，否则裸穿终止套件。
  let fn = null;
  let constructErr = null;
  try {
    fn = new Function('context', 'github', 'core', 'process', 'console',
      'return (async () => {\n' + scriptBody + '\n})()');
  } catch (e) {
    constructErr = e;
  }
  // E2 可读性修正：err 优先级拆为显式逐级求值，语义与 F6 契约逐字等价——
  //   extractErr（提取失败）> constructErr（构造期 SyntaxError）> runtimeErr（运行期异常），
  //   且保留短路语义：前两者在场时不再执行 fn，避免无谓跑空脚本体。
  let runtimeErr = null;
  if (!extractErr && !constructErr && fn) {
    runtimeErr = await fn(context, github, core, process, consoleMock).then(() => null, (e) => e);
  }
  const err = extractErr || constructErr || runtimeErr;
  return { calls, labelsAdded, labelsRemoved, provisioned, comments: commentList, logs, err };
}

const COMMENTED = { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'kilo-code-bot[bot]' } };
const prPayload = (headSha) => ({ pull_request: { head: { sha: headSha } } });

// --- 完成判据矩阵：官方 bot 在当前 head 的 COMMENTED/APPROVED/CHANGES_REQUESTED review 均满足栅栏；
//     DISMISSED / 非当前 head / login 不匹配 / 作者缺失 / 无载体 一律不满足（顶层 comment 仅唤醒）。
async function barrierCase(opts) {
  const r = await runWorkflow({
    eventName: opts.eventName || 'issue_comment',
    payload: opts.payload || { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: opts.expectedBots || 'coderabbit,kilocode' },
    headSha: 'HEAD',
    reviews: opts.reviews || [],
    checkRuns: opts.checkRuns || [],
    issueLabels: opts.issueLabels || [],
    repoLabels: opts.repoLabels || ['ai-reviewed', 'risk:low', 'review:approved', 'review:needs-work', 'review:pending', 'review:unavailable'],
    changedFiles: opts.changedFiles,
    stars: opts.stars,
    comments: opts.comments,
    pullComments: opts.pullComments,
    prBody: opts.prBody,
    headBranchRef: opts.headBranchRef,
    commitStatuses: opts.commitStatuses,
    autofillRunRecord: opts.autofillRunRecord,
  });
  return r;
}
// 行为 harness 用非抛出记录器（区别于上方结构断言的抛出 check），以便逐格输出红/绿。
function record(name, ok, detail) {
  if (ok) console.log(`OK   ${name}${detail ? ' ' + detail : ''}`);
  else { behaviorFailures += 1; console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`); }
}

// 1. COMMENTED head-bound bot review → 满足栅栏（PR8 实测载体形态）→ 进入 verdict 写标签 + 状态评论。
{
  const r = await barrierCase({ reviews: [ { ...COMMENTED, body: 'WARNING: minor' } ] });
  record('workflow-completes-on-commented-head-review',
    r.err === null && r.calls.add > 0 && r.calls.createComment > 0,
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'add=' + r.calls.add + ' createComment=' + r.calls.createComment + ' logs=' + r.logs.join(' | '));
}
// 2. APPROVED / CHANGES_REQUESTED 仍满足（回归：旧终态仍合法）。
{
  const rA = await barrierCase({ reviews: [{ ...COMMENTED, state: 'APPROVED', body: 'SUGGESTION: ok' }] });
  const rC = await barrierCase({ reviews: [{ ...COMMENTED, state: 'CHANGES_REQUESTED', body: 'SUGGESTION: ok' }] });
  record('workflow-completes-on-approved-and-changes-requested',
    rA.calls.add > 0 && rC.calls.add > 0 && rA.calls.createComment > 0 && rC.calls.createComment > 0,
    'approved add=' + rA.calls.add + ' changes add=' + rC.calls.add);
}
// Rework-5（Bot 意见·多 band 聚合）：CodeRabbit 正文先后携 'ready' 与 'blocked' 两 band——
//   旧"先匹配先赢"让靠前宽松档遮蔽靠后更严档（落 risk:low+approved）。契约期望：严序取用 →
//   risk:critical + review:needs-work，approved 不得在场。旧实现下本用例＝红（期望由 4.6 最严原则推导）。
{
  const r = await barrierCase({ reviews: [
    { ...COMMENTED, body: 'SUGGESTION: ok' },
    { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' },
      body: 'Merge Readiness: Ready\n\n中间文本\n\nMerge Readiness: Blocked' },
  ] });
  const flat = r.labelsAdded.flat();
  record('workflow-coderabbit-multi-band-wins-strictest',
    r.err === null && flat.includes('risk:critical') && flat.includes('review:needs-work') && !flat.includes('review:approved'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(flat));
}
// Rework-6（Bot 意见·连接词 band 吞噬）：完整短语形 "Merge Readiness band: Blocked"——旧正则间隙类
//   [^a-zA-Z\r\n] 吞不掉连接词 'band'，捕获组落在 'band' 而非 'Blocked'（'band' 非档位词 → crScore=null
//   → coderabbit 失评静默放行）。期望：连接词被跳过、严格档命中 → risk:critical + review:needs-work。
{
  const r = await barrierCase({ reviews: [
    { ...COMMENTED, body: 'SUGGESTION: ok' },
    { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' },
      body: '### Merge Readiness band: Blocked\n\n存在高危发现' },
  ] });
  const flat = r.labelsAdded.flat();
  record('workflow-coderabbit-readiness-band-phrase-blocked',
    r.err === null && flat.includes('risk:critical') && flat.includes('review:needs-work'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(flat));
}
// F4（band 正则收紧回归，三例边界）：工作流 4.4 的 band 间隙量词收紧为 {0,8}（CodeRabbit 实测
//   band 词与标签间填充 ≤4 空格/分隔符，8 为 2 倍裕度）——过长填充不得被当作 band 分隔符吞进
//   捕获（防"散文里远处的档位词"被误绑定为 band 值）。三例：① 正常 2 空格分隔命中；② 9 个
//   连字符（超裕度）不命中；③ 紧邻（零分隔）命中。期望值溯源＝收紧语义本身，非抄录实现。
{
  // ① 正常 2 空格：命中（回归保护——收紧不得误伤合法形态）
  const r1 = await barrierCase({ reviews: [
    { ...COMMENTED, body: 'SUGGESTION: ok' },
    { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' },
      body: 'Merge Readiness:  Blocked' },
  ] });
  const f1 = r1.labelsAdded.flat();
  record('workflow-coderabbit-band-two-space-hits',
    r1.err === null && f1.includes('risk:critical') && f1.includes('review:needs-work'),
    r1.err ? 'err=' + String((r1.err && r1.err.message) || r1.err).split('\n')[0] : 'labels=' + JSON.stringify(f1));
  // ② 9 个连字符（超 2 倍裕度）：不得命中 → coderabbit 失评 → needs-work 兜底而非 risk:critical
  const r2 = await barrierCase({ reviews: [
    { ...COMMENTED, body: 'SUGGESTION: ok' },
    { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' },
      body: 'Merge Readiness --------- Blocked' },
  ] });
  const f2 = r2.labelsAdded.flat();
  record('workflow-coderabbit-band-nine-hyphens-miss',
    r2.err === null && !f2.includes('risk:critical'),
    r2.err ? 'err=' + String((r2.err && r2.err.message) || r2.err).split('\n')[0] : 'labels=' + JSON.stringify(f2));
  // ③ 紧邻（零分隔）：命中
  const r3 = await barrierCase({ reviews: [
    { ...COMMENTED, body: 'SUGGESTION: ok' },
    { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' },
      body: 'Merge Readiness:Blocked' },
  ] });
  const f3 = r3.labelsAdded.flat();
  record('workflow-coderabbit-band-adjacent-hits',
    r3.err === null && f3.includes('risk:critical'),
    r3.err ? 'err=' + String((r3.err && r3.err.message) || r3.err).split('\n')[0] : 'labels=' + JSON.stringify(f3));
  // ④ 恰 8 个连字符（=上界，无空格，间隙总长恰 8）：必须命中（钉死 {0,8} 上界含 8 本身，防上界漂移到更小值误伤合法形态）
  const r4 = await barrierCase({ reviews: [
    { ...COMMENTED, body: 'SUGGESTION: ok' },
    { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' },
      body: 'Merge Readiness--------Blocked' },
  ] });
  const f4 = r4.labelsAdded.flat();
  record('workflow-coderabbit-band-eight-hyphens-hits',
    r4.err === null && f4.includes('risk:critical'),
    r4.err ? 'err=' + String((r4.err && r4.err.message) || r4.err).split('\n')[0] : 'labels=' + JSON.stringify(f4));
}
// 3. DISMISSED 不满足 barrier；等待分支落 review:unavailable（本轮无可评级来源），不误落最终 risk/approved。
// K-1（Bot 意见·Kilo Overview 计数表形态）：Kilo 真实输出 `**Status:** 10 Issues Found` +
//     `| Severity | Count |` 计数表（PR8 实测，comment id 6117996536）——现有 4.5 正则
//     （severity: 行 + bare 前缀）全部不命中 → kiloScore=null → :592 误落 review:needs-work。
//     契约期望：计数表按大于零的最严重档赋予评级（3 WARNING + 7 SUGGESTION → kiloScore=2 → risk:medium）。
{
  const kiloTable = [
    '<!-- kilo-review -->',
    '',
    '## Code Review Summary',
    '',
    '**Status:** 10 Issues Found | **Recommendation:** Address before merge',
    '',
    '### Overview',
    '| Severity | Count |',
    '|----------|-------|',
    '| CRITICAL | 0 |',
    '| WARNING | 3 |',
    '| SUGGESTION | 7 |',
  ].join('\n');
  const r = await barrierCase({ reviews: [{ ...COMMENTED, body: kiloTable }] });
  const flat = r.labelsAdded.flat();
  record('workflow-kilo-overview-count-table-rates',
    r.err === null && flat.includes('risk:medium') && flat.includes('ai-reviewed'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(flat));
}
// K-1b（review-finding 契约）：计数表 MAJOR/HIGH > 0 → kiloScore=3 → risk:high（对齐
//     SYSTEM_LABELS「Kilo [Major/High]」描述）；仅 WARNING > 0 仍 risk:medium。
{
  const kiloMajor = [
    '<!-- kilo-review -->',
    '**Status:** 2 Issues Found',
    '### Overview',
    '| Severity | Count |',
    '|----------|-------|',
    '| MAJOR | 2 |',
    '| SUGGESTION | 5 |',
  ].join('\n');
  const rMajor = await barrierCase({ reviews: [{ ...COMMENTED, body: kiloMajor }] });
  const kiloHigh = kiloMajor.replace('| MAJOR | 2 |', '| HIGH | 1 |').replace('2 Issues Found', '1 Issues Found');
  const rHigh = await barrierCase({ reviews: [{ ...COMMENTED, body: kiloHigh }] });
  record('workflow-kilo-overview-major-high-rate-high',
    rMajor.err === null && rMajor.labelsAdded.flat().includes('risk:high') &&
      rHigh.err === null && rHigh.labelsAdded.flat().includes('risk:high'),
    'major=' + JSON.stringify(rMajor.labelsAdded.flat()) + ' high=' + JSON.stringify(rHigh.labelsAdded.flat()));
}
// K-1c（review-finding 契约）：severity 兜底不再覆盖计数表结果——计数表全零（kiloScore=1）
//     且正文含 severity: critical 行时仍取计数表评级（risk:low），不被兜底拉爆。
{
  const kiloZeroWithStray = [
    '<!-- kilo-review -->',
    '**Status:** No Issues Found',
    '### Overview',
    '| Severity | Count |',
    '|----------|-------|',
    '| CRITICAL | 0 |',
    '| SUGGESTION | 0 |',
    '',
    'severity: critical (historical note)',
  ].join('\n');
  const r = await barrierCase({ reviews: [{ ...COMMENTED, body: kiloZeroWithStray }] });
  record('workflow-kilo-overview-zero-count-not-overridden-by-fallback',
    r.err === null && r.labelsAdded.flat().includes('risk:low') && !r.labelsAdded.flat().includes('risk:critical'),
    'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// K-2（同族）：`Status: No Issues Found`（零问题形态）——契约：计数均为零/无问题时赋最低评级
//     risk:low（而非 kiloScore=null 误入 :592 无评级分支落 needs-work）。
{
  const kiloClean = [
    '<!-- kilo-review -->',
    '',
    '**Status:** No Issues Found',
  ].join('\n');
  const r = await barrierCase({ reviews: [{ ...COMMENTED, body: kiloClean }] });
  const flat = r.labelsAdded.flat();
  record('workflow-kilo-no-issues-found-rates-low',
    r.err === null && flat.includes('risk:low') && flat.includes('ai-reviewed') && !flat.includes('review:needs-work'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(flat));
}
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, state: 'DISMISSED' }] });
  record('workflow-dismissed-review-not-complete', r.err === null && r.calls.add === 1 && r.calls.createComment > 0 &&
    r.labelsAdded.flat().includes('review:unavailable') && !r.labelsAdded.flat().includes('review:needs-work'),
    'add=' + r.calls.add + ' createComment=' + r.calls.createComment + ' labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// 4. 非当前 head 的 review 不满足 barrier。
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, commit_id: 'OLD' }] });
  record('workflow-stale-head-review-not-complete', r.calls.add === 1 && r.calls.createComment > 0 &&
    r.labelsAdded.flat().includes('review:unavailable'), 'add=' + r.calls.add);
}
// 5. login 不匹配（type Bot 但非配置官方账号）不满足 barrier。
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, user: { type: 'Bot', login: 'evil-bot[bot]' } }] });
  record('workflow-unauthorized-login-review-not-complete', r.calls.add === 1 && r.calls.createComment > 0 &&
    r.labelsAdded.flat().includes('review:unavailable'), 'add=' + r.calls.add);
}
// 6. 作者缺失（无 user）不满足 barrier。
{
  const r = await barrierCase({ reviews: [{ commit_id: 'HEAD', state: 'COMMENTED' }] });
  record('workflow-missing-author-review-not-complete', r.calls.add === 1 && r.calls.createComment > 0 &&
    r.labelsAdded.flat().includes('review:unavailable'), 'add=' + r.calls.add);
}
// 7. 顶层 comment 唤醒本身不构成完成信号：仅评论（无 head review、无 check run）→ 等待并写 unavailable，非 needs-work。
{
  const r = await barrierCase({ eventName: 'issue_comment', payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } }, reviews: [], checkRuns: [] });
  const hasDiag = r.logs.some((l) => l.includes('No bindable carrier this round for:'));
  record('workflow-unbound-comment-not-completion-evidence', r.calls.add === 1 && r.calls.createComment > 0 &&
    r.labelsAdded.flat().includes('review:unavailable') && !r.labelsAdded.flat().includes('review:needs-work') && hasDiag,
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()) + ' diag=' + hasDiag);
}
// 8. 无载体 → 等待 + 显式诊断 + review:unavailable（非 needs-work、非静默死等）。
{
  const r = await barrierCase({ reviews: [], checkRuns: [] });
  const hasDiag = r.logs.some((l) => l.includes('No bindable carrier this round for:'));
  record('workflow-no-carrier-waits-with-diagnostic', r.err === null && r.calls.add === 1 && r.calls.createComment > 0 &&
    r.labelsAdded.flat().includes('review:unavailable') && !r.labelsAdded.flat().includes('review:needs-work') && hasDiag,
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()) + ' diag=' + hasDiag);
}
// 9. F2 actor 门：human actor 的 pull_request_review 触发 → 零标签变更。
{
  const r = await runWorkflow({
    eventName: 'pull_request_review',
    payload: { review: { user: { type: 'User' } }, pull_request: { head: { sha: 'HEAD' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
  });
  record('workflow-human-review-actor-no-label-writes',
    r.err === null && r.calls.add === 0 && r.calls.remove === 0 && r.calls.create === 0 && r.calls.pullsGet === 0,
    'add=' + r.calls.add + ' remove=' + r.calls.remove + ' create=' + r.calls.create + ' pullsGet=' + r.calls.pullsGet);
}
// 10. F2 actor 门：missing actor（review.user 缺失）→ 零标签变更。
{
  const r = await runWorkflow({
    eventName: 'pull_request_review',
    payload: { review: {}, pull_request: { head: { sha: 'HEAD' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
  });
  record('workflow-missing-review-actor-no-label-writes',
    r.err === null && r.calls.add === 0 && r.calls.remove === 0 && r.calls.create === 0 && r.calls.pullsGet === 0,
    'add=' + r.calls.add + ' remove=' + r.calls.remove + ' create=' + r.calls.create + ' pullsGet=' + r.calls.pullsGet);
}
// 11. 受信 bot 顶层评论唤醒（type=Bot + 派生登录名命中）→ 不早退，进入求值并写状态评论
//     （契约 3 C-B 翻转：夹具正文无可解析评级 → verdict=no-rating 零裁决标签，仅状态评论）。
{
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
  });
  const metaMatch = (r.comments[0]?.body || '').match(/<!-- BOT-METADATA: (.*?) -->/s);
  let meta = null;
  try { meta = metaMatch ? JSON.parse(metaMatch[1]) : null; } catch { meta = null; }
  record('workflow-trusted-bot-comment-wake-proceeds', r.err === null && r.calls.pullsGet > 0 && meta !== null && meta.verdict === 'no-rating',
    'pullsGet=' + r.calls.pullsGet + ' add=' + r.calls.add + ' verdict=' + (meta && meta.verdict));
}
// 12. 非受信顶层评论（任意 bot 登录名未命中派生集合）→ 唤醒闸 fail-closed 早退，零标签变更。
{
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'evil-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
  });
  record('workflow-untrusted-bot-comment-wake-denied',
    r.err === null && r.calls.add === 0 && r.calls.pullsGet === 0,
    'add=' + r.calls.add + ' pullsGet=' + r.calls.pullsGet);
}

// 13. PR8 真实形态（EXPECTED_BOTS='coderabbit,kilocode'，coderabbit 本轮零载体，kilocode COMMENTED）：
//     可用性模型正解——可选 bot coderabbit 缺席不阻塞，必需 bot kilocode 完成即出正向裁决，
//     缺席原因记入状态评论；诊断仍记录 coderabbit 载体缺失。
{
  const r = await barrierCase({
    expectedBots: 'coderabbit,kilocode',
    changedFiles: 107,
    stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: looks good' }],
    issueLabels: ['ai-reviewed', 'review:approved'],
  });
  const diagNames = r.logs.some((l) => l.includes("Bot 'coderabbit' availability=file_limit")) &&
    (r.comments[0]?.body || '').includes('"coderabbit":"file_limit"');
  record('workflow-pr8-coderabbit-absent-yields-verdict',
    r.err === null && r.calls.add > 0 && r.calls.createComment > 0
      && r.labelsAdded.flat().includes('risk:low')
      && !r.labelsAdded.flat().includes('review:needs-work')
      && diagNames,
    'add=' + r.calls.add + ' createComment=' + r.calls.createComment + ' added=' + JSON.stringify(r.labelsAdded.flat()) + ' diag=' + diagNames);
}

// 14. F6：head-bound review 满足载体，但匹配的官方 run 仍 in_progress → 该 bot in_progress →
//     本轮不可出裁决 → 等待分支落 review:pending；不得写正向标签，最终 verdict 推迟到 completed 重评。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, state: 'APPROVED' }],
    checkRuns: [{
      name: 'Kilo Code Review',
      status: 'in_progress',
      conclusion: null,
      app: { slug: 'kilo-code', id: 2193792 },
      output: { title: 'CRITICAL', summary: 'unfinished', text: '' },
    }],
    issueLabels: ['ai-reviewed', 'review:approved'],
  });
  record('workflow-in-progress-check-run-blocks-verdict',
    r.err === null && r.calls.add === 1 && r.calls.remove === 2 &&
      r.labelsAdded.flat().includes('review:pending') &&
      !r.labelsAdded.flat().includes('review:needs-work') &&
      r.logs.some((l) => l.includes('No bindable carrier this round for:')),
    'add=' + r.calls.add + ' remove=' + r.calls.remove + ' labels=' + JSON.stringify(r.labelsAdded.flat()) + ' logs=' + r.logs.join(' | '));
}
// 15. F6 对照：同一匹配 run 已完成（success）→ 状态门放行 → 进入 verdict 写标签 + 状态评论。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, state: 'APPROVED' }],
    checkRuns: [{
      name: 'Kilo Code Review',
      status: 'completed',
      conclusion: 'success',
      app: { slug: 'kilo-code', id: 2193792 },
      output: { title: 'SUGGESTION: ready', summary: '', text: '' },
    }],
  });
  record('workflow-completed-check-run-allows-verdict',
    r.err === null && r.calls.add > 0 && r.calls.createComment > 0,
    'add=' + r.calls.add + ' createComment=' + r.calls.createComment + ' logs=' + r.logs.join(' | '));
}
// 16. 等待分支清理陈旧 approved/risk/ai-reviewed 与陈旧的 needs-work（needs-work 不再被等待分支保留），
//     落 review:unavailable（全 bot 缺席非在途，本轮无可评级来源）。
{
  const withNeeds = await barrierCase({
    reviews: [], checkRuns: [],
    issueLabels: ['ai-reviewed', 'risk:high', 'review:approved', 'review:needs-work'],
  });
  const withoutNeeds = await barrierCase({
    reviews: [], checkRuns: [],
    issueLabels: ['ai-reviewed', 'risk:high', 'review:approved'],
    repoLabels: ['ai-reviewed', 'risk:low', 'review:approved', 'review:needs-work'],
  });
  record('workflow-waiting-cleans-stale-including-needs-work',
    withNeeds.err === null && withNeeds.calls.add === 1 &&
      withNeeds.labelsAdded.flat().includes('review:unavailable') &&
      withNeeds.labelsRemoved.includes('ai-reviewed') &&
      withNeeds.labelsRemoved.includes('risk:high') &&
      withNeeds.labelsRemoved.includes('review:approved') &&
      withNeeds.labelsRemoved.includes('review:needs-work') &&
      !withNeeds.labelsAdded.flat().includes('review:needs-work'),
    'removed=' + JSON.stringify(withNeeds.labelsRemoved) + ' added=' + JSON.stringify(withNeeds.labelsAdded.flat()));
  record('workflow-waiting-adds-missing-unavailable',
    withoutNeeds.err === null &&
      withoutNeeds.labelsRemoved.includes('ai-reviewed') &&
      withoutNeeds.labelsRemoved.includes('risk:high') &&
      withoutNeeds.labelsRemoved.includes('review:approved') &&
      withoutNeeds.labelsAdded.flat().includes('review:unavailable') &&
      withoutNeeds.provisioned.includes('review:unavailable'),
    'added=' + JSON.stringify(withoutNeeds.labelsAdded.flat()) + ' provisioned=' + JSON.stringify(withoutNeeds.provisioned));
}

// ================================================================
// Availability/status model (plan 20261012-bot-review-availability-status):
// tests first, direct behavioral coverage for file_limit/manual_required/pending/unavailable,
// own-comment idempotency and authored comment wake-loop rejection.
// ================================================================
{
  const r = await barrierCase({
    changedFiles: 107,
    stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: looks good' }],
  });
  record('workflow-file-limit-does-not-block-required-kilo',
    r.err === null && r.calls.add > 0 && r.labelsAdded.flat().includes('ai-reviewed') &&
      r.calls.createComment === 1 && (r.comments[0]?.body || '').includes('"coderabbit":"file_limit"'),
    'add=' + r.calls.add + ' comments=' + r.calls.createComment + ' reason=' + ((r.comments[0]?.body || '').includes('"coderabbit":"file_limit"')));
}
{
  const r = await barrierCase({
    changedFiles: 1,
    stars: 5,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: looks good' }],
  });
  record('workflow-manual-required-does-not-block-required-kilo',
    r.err === null && r.calls.add > 0 && r.labelsAdded.flat().includes('ai-reviewed') &&
      r.calls.createComment === 1 && (r.comments[0]?.body || '').includes('"coderabbit":"manual_required"'),
    'add=' + r.calls.add + ' comments=' + r.calls.createComment + ' reason=' + ((r.comments[0]?.body || '').includes('"coderabbit":"manual_required"')));
}
{
  const r = await barrierCase({
    changedFiles: 1,
    stars: 100,
    reviews: [],
    checkRuns: [{ name: 'Kilo Code Review', status: 'in_progress', conclusion: null,
      app: { slug: 'kilo-code', id: 2193792 }, output: { title: '', summary: '', text: '' } }],
  });
  record('workflow-required-in-progress-is-pending',
    r.err === null && r.calls.add === 1 && r.labelsAdded.flat().includes('review:pending') &&
      !r.labelsAdded.flat().includes('ai-reviewed') && r.calls.createComment === 1,
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()));
}
{
  const r = await barrierCase({ changedFiles: 107, stars: 100, reviews: [], checkRuns: [] });
  record('workflow-no-completed-review-source-is-unavailable',
    r.err === null && r.calls.add === 1 && r.labelsAdded.flat().includes('review:unavailable') &&
      !r.labelsAdded.flat().includes('review:pending') && r.calls.createComment === 1 &&
      (r.comments[0]?.body || '').includes('"coderabbit":"file_limit"'),
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()));
}
{
  const selfComment = { id: 71, body: '<!-- bot-review-labeler:status -->\nold', user: { type: 'Bot', login: 'github-actions[bot]' } };
  const r = await barrierCase({
    changedFiles: 1, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [selfComment],
  });
  record('workflow-status-comment-updates-own-marker-comment',
    r.err === null && r.calls.listComments > 0 && r.calls.updateComment === 1 && r.calls.createComment === 0 &&
      r.comments.length === 1 && r.comments[0].body.includes('<!-- bot-review-labeler:status -->') &&
      r.comments[0].body.includes('HEAD'),
    'list=' + r.calls.listComments + ' update=' + r.calls.updateComment + ' create=' + r.calls.createComment);
}
{
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { issue: { pull_request: {} }, comment: { user: { type: 'Bot', login: 'github-actions[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
  });
  record('workflow-action-comment-wake-is-rejected',
    r.err === null && r.calls.pullsGet === 0 && r.calls.add === 0 && r.calls.remove === 0,
    'pullsGet=' + r.calls.pullsGet + ' add=' + r.calls.add + ' remove=' + r.calls.remove);
}

// E1 self-heal: head drift mid-wait-cleanup leaves partial state (guard aborts old-head job),
// then the new head's own event reconciles to a correct verdict — proving the declared
// pull_request_target:synchronize trigger self-heals the non-atomic per-label window.
{
  const partial = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' },
    headSha: 'HEAD', headShaAfter: 'HEAD2', switchAfterCall: 2,
    reviews: [{ ...COMMENTED, state: 'DISMISSED' }],
    issueLabels: ['ai-reviewed', 'review:approved', 'risk:high'],
    repoLabels: ['ai-reviewed', 'risk:low', 'review:approved', 'review:needs-work', 'review:pending', 'review:unavailable'],
  });
  const healed = await runWorkflow({
    eventName: 'pull_request_target',
    payload: { pull_request: { head: { sha: 'HEAD2' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' },
    headSha: 'HEAD2',
    reviews: [{ ...COMMENTED, commit_id: 'HEAD2', body: 'SUGGESTION: ok' }],
    issueLabels: ['review:approved', 'risk:high'],
    repoLabels: ['ai-reviewed', 'risk:low', 'review:approved', 'review:needs-work', 'review:pending', 'review:unavailable'],
    changedFiles: 1, stars: 100,
  });
  record('workflow-head-drift-partial-then-self-heals',
    partial.err === null && partial.labelsRemoved.includes('ai-reviewed') &&
      !partial.labelsRemoved.includes('risk:high') && partial.calls.add === 0 &&
      healed.err === null && healed.labelsAdded.flat().includes('ai-reviewed') &&
      healed.labelsRemoved.includes('risk:high') && healed.calls.createComment > 0,
    'partial removed=' + JSON.stringify(partial.labelsRemoved) + ' add=' + partial.calls.add +
      ' | healed added=' + JSON.stringify(healed.labelsAdded.flat()) + ' removed=' + JSON.stringify(healed.labelsRemoved));
}

// E3 negative: a foreign Bot's comment carrying the marker must NOT be overwritten — the
// Action must create its own comment (author login gate), not update the foreign id.
// Bug 1 修复后：create 轮会对自己新创建的评论做一次 URL 回填更新（uuid，非 foreign id）——
//   断言改为「恰 1 次 update 且 foreign 原文完好 + 自有评论被回填真实 #issuecomment- 链接」，
//   既守住「绝不覆写他人 marker 评论」原意，又接纳首轮自回填的新语义（update=1 非 foreign）。
{
  const foreign = { id: 77, body: '<!-- bot-review-labeler:status -->\nnot ours', user: { type: 'Bot', login: 'coderabbitai[bot]' } };
  const r = await barrierCase({
    changedFiles: 1, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [foreign],
  });
  record('workflow-foreign-bot-marker-comment-not-updated',
    r.err === null && r.calls.createComment === 1 && r.calls.updateComment === 1 &&
      foreign.body.includes('not ours') &&
      r.comments.some((c) => c.id !== foreign.id && c.user?.login === 'github-actions[bot]' && String(c.body).includes('#issuecomment-')),
    'update=' + r.calls.updateComment + ' create=' + r.calls.createComment + ' foreignIntact=' + foreign.body.includes('not ours'));
}

// E5 boundary: exactly at threshold uses the plan's strict comparisons and must remain absent.
{
  const atMaxFiles = await barrierCase({ changedFiles: 100, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }] });
  const atMinStars = await barrierCase({ changedFiles: 1, stars: 10, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }] });
  record('workflow-threshold-boundaries-remain-absent',
    atMaxFiles.err === null && atMinStars.err === null &&
      !atMaxFiles.comments[0]?.body.includes('file_limit') &&
      !atMinStars.comments[0]?.body.includes('manual_required') &&
      atMaxFiles.comments[0]?.body.includes('**CodeRabbit**') &&
      (atMaxFiles.comments[0]?.body || '').includes('"coderabbit":"absent"') &&
      atMinStars.comments[0]?.body.includes('**CodeRabbit**') &&
      (atMinStars.comments[0]?.body || '').includes('"coderabbit":"absent"'),
    'max=' + JSON.stringify(atMaxFiles.comments[0]?.body) + ' min=' + JSON.stringify(atMinStars.comments[0]?.body));
}

// E2: real newline-separated status comment body (not literal backslash-n) and E4 latest attempt selection.
{
  const r = await barrierCase({ changedFiles: 107, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }] });
  const body = r.comments[0]?.body || '';
  const kiloOldFailed = { name: 'Kilo Code Review', status: 'completed', conclusion: 'failure', run_attempt: 1, app: { slug: 'kilo-code', id: 2193792 }, output: { title: 'CRITICAL: old', summary: '', text: '' } };
  const kiloNewSuccess = { name: 'Kilo Code Review', status: 'completed', conclusion: 'success', run_attempt: 2, app: { slug: 'kilo-code', id: 2193792 }, output: { title: 'SUGGESTION: rerun', summary: '', text: '' } };
  const rerun = await barrierCase({ reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }], checkRuns: [kiloOldFailed, kiloNewSuccess] });
  record('workflow-status-comment-uses-real-newlines-and-latest-attempt',
    r.err === null && body.includes('\n') && !body.includes('\\n') && body.split('\n').length >= 3 &&
      rerun.err === null && rerun.labelsAdded.flat().includes('ai-reviewed') && !rerun.labelsAdded.flat().includes('review:needs-work'),
    'newlines=' + body.split('\n').length + ' rerun=' + JSON.stringify(rerun.labelsAdded.flat()));
}

// 17. failed 终态必须放行 barrier 进入裁决分支，落 review:needs-work，而非永久 review:pending 死等。
//     契约：required bot 的 completed run conclusion='failure' 且本轮无 active run → allReady=true
//     → 4.1 hasCheckFailure=true → 走 partialRating/hasCheckFailure 分支 → 'review:needs-work'。
//     期望值溯源：行为契约"触发域应放行"与"下游裁决推演 2（必需 bot 正文无评级时）"，
//     非抄录当前实现（当前实现错误地阻塞 barrier）。
{
  const r = await barrierCase({
    reviews: [],
    checkRuns: [{
      name: 'Kilo Code Review',
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 1,
      app: { slug: 'kilo-code', id: 2193792 },
      output: { title: 'Review failed', summary: 'internal error', text: '' },
    }],
  });
  record('workflow-failed-required-run-enters-verdict-not-pending',
    r.err === null && r.labelsAdded.flat().includes('review:needs-work') &&
      !r.labelsAdded.flat().includes('review:pending') &&
      !r.labelsAdded.flat().includes('review:unavailable'),
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()));
}

// 18. E1 观察项修正契约：可选 bot 的 in_progress 不阻塞 barrier——必需 bot 已终态时
//     直接出裁决；可选 bot 的 in_progress 状态仅记入状态评论。期望值溯源：行为契约 1/2
//     （required 门控收窄），非抄录当前实现（当前实现首支无门控，可选 in_progress 误阻塞）。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    checkRuns: [{
      name: 'CodeRabbit Review',
      status: 'in_progress',
      conclusion: null,
      app: { slug: 'coderabbitai', id: 347564 },
      output: { title: 'scanning', summary: '', text: '' },
    }],
  });
  record('workflow-optional-bot-inprogress-does-not-block-required-verdict',
    r.err === null && r.labelsAdded.flat().includes('review:approved') &&
      !r.labelsAdded.flat().includes('review:pending') &&
      !r.labelsAdded.flat().includes('review:needs-work') &&
      (r.comments[0]?.body || '').includes('"coderabbit":"in_progress"'),
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()) +
      ' status=' + String(r.comments[0]?.body).split('\n').find((l) => l.includes('coderabbit')));
}

// 19. E-2 重试窗口（r2 回灌）：可选 bot「旧 attempt 失败终态 + 新 attempt 在途」——barrier 已放行
//     （可选在途不阻塞），但旧失败证据必须仍在聚合中（回退取最新已 completed attempt），落
//     review:needs-work；状态评论照旧如实显示 coderabbit: in_progress。期望值溯源：PR 审查报告
//     E-2 方案 (a) + 行为契约 6②，非抄录当前实现（当前实现以 latestRun 为唯一输入，在途时整条
//     丢弃旧失败证据，误落 review:approved）。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    checkRuns: [
      { name: 'CodeRabbit Review', status: 'completed', conclusion: 'failure', run_attempt: 1,
        app: { slug: 'coderabbitai', id: 347564 }, output: { title: 'Review failed', summary: 'internal error', text: '' } },
      { name: 'CodeRabbit Review', status: 'in_progress', conclusion: null, run_attempt: 2,
        app: { slug: 'coderabbitai', id: 347564 }, output: { title: 'scanning', summary: '', text: '' } },
    ],
  });
  record('workflow-optional-bot-retry-window-preserves-failure-evidence',
    r.err === null && r.labelsAdded.flat().includes('review:needs-work') &&
      !r.labelsAdded.flat().includes('review:approved') &&
      !r.labelsAdded.flat().includes('review:pending') &&
      (r.comments[0]?.body || '').includes('"coderabbit":"in_progress"'),
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()) +
      ' status=' + String(r.comments[0]?.body).split('\n').find((l) => l.includes('coderabbit')));
}

// 19.5 F-8（r 回灌新增）：listForRef 未显式传 filter:'all' 时，GitHub 官方默认 filter=latest
//     仅返回每个 name 的最新 attempt——重试窗口（旧 attempt 失败终态 + 新 attempt 在途）的旧失败
//     证据在 API 层就不可见，栅栏聚合 (:344 run_attempt 排序 / :385-389 latestCompletedRun 回退)
//     全部以"旧 attempt 可见"为前提，故旧失败被静默丢弃、当轮可误落 review:approved。
//     期望值溯源：行为契约 F-8 触发域 + 官方 REST 文档口径（桩按默认 latest 折叠，只回新 in_progress），
//     非抄录当前实现。本用例须真红：未传 filter 时旧失败终态丢失 → 断言 needs-work 在场即红。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    checkRuns: [
      { name: 'CodeRabbit Review', status: 'completed', conclusion: 'failure', run_attempt: 1,
        app: { slug: 'coderabbitai', id: 347564 }, output: { title: 'Review failed', summary: 'internal error', text: '' } },
      { name: 'CodeRabbit Review', status: 'in_progress', conclusion: null, run_attempt: 2,
        app: { slug: 'coderabbitai', id: 347564 }, output: { title: 'scanning', summary: '', text: '' } },
    ],
  });
  record('workflow-listforref-filter-all-preserves-retry-window',
    r.err === null && r.labelsAdded.flat().includes('review:needs-work') &&
      !r.labelsAdded.flat().includes('review:approved') &&
      (r.comments[0]?.body || '').includes('"coderabbit":"in_progress"'),
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()) +
      ' status=' + String(r.comments[0]?.body).split('\n').find((l) => l.includes('coderabbit')));
}

// 20. E-3 退化组合（r2 回灌 + 契约 3 C-B 翻转）：EXPECTED_BOTS 仅含可选 bot 且其在途——requiredKeys 为空，
//     夹具无可解析评级 → 落 no-rating 显式态（零裁决标签），不得 pending（无必需 bot 可等），
//     不得 unavailable（in_progress 非 unavailable 语义）。期望值溯源：行为契约 3（退化组合）+ 契约 3 C-B。
//     用例名保留 `fallback` 语义锚（旧 `needs-work` 后缀为 C-B 翻转前残留，断言体为准）。
{
  const r = await barrierCase({
    expectedBots: 'coderabbit',
    reviews: [],
    checkRuns: [{
      name: 'CodeRabbit Review', status: 'in_progress', conclusion: null,
      app: { slug: 'coderabbitai', id: 347564 }, output: { title: 'scanning', summary: '', text: '' },
    }],
  });
  record('workflow-optional-only-expected-bots-fallback-no-rating',
    r.err === null && !r.labelsAdded.flat().includes('review:approved') &&
      !r.labelsAdded.flat().includes('review:pending') &&
      !r.labelsAdded.flat().includes('review:unavailable') &&
      !r.labelsAdded.flat().includes('review:needs-work') &&
      (r.comments[0]?.body || '').includes('"coderabbit":"in_progress"') &&
      (r.comments[0]?.body || '').includes('"verdict":"no-rating"'),
    'add=' + r.calls.add + ' labels=' + JSON.stringify(r.labelsAdded.flat()));
}

// E6/F3: job-level YAML comments must not truncate jobEnd — extraction still finds the block.
// 期望值溯源：行为契约 F3 触发域（注释行不得被判为 job 边界），非抄录当前实现。
// E1-r2 修正：整行 splice 保留原缩进，把浅注释作为独立行插在 sync-labels 的 script: 行之前。
//   旧实现把该行判为下一 job 边界 → jobEnd 截断 → starts=0 → throw（真红）；
//   新实现跳过注释行 → starts=1 提取成功（转绿）。禁止字符串级 splice（破坏列位、恒绿/永红）。
{
  const flines = text.split(/\r?\n/);
  const fj = flines.findIndex((l) => /^\s{0,4}sync-labels:\s*$/.test(l));
  const fk = fj + 1 + flines.slice(fj + 1).findIndex((l) => /^([ \t]*)script:[ \t]*\|[ \t]*$/.test(l));
  const ok0 = fj >= 0 && fk > fj && fk < flines.length;
  record('workflow-f3-fixture-anchor-found', ok0);
  // trap 取 job 键同缩进（sync-labels 键缩进=2）：浅缩进方能在旧实现里被判为边界。
  const jobKeyIndent = (flines[fj] || '').match(/^[ \t]*/)[0].length;
  const trap = ' '.repeat(jobKeyIndent) + '# job-level boundary trap';
  const synth = ok0 ? flines.slice(0, fk).concat([trap], flines.slice(fk)).join('\n') : text;
  let ok = false;
  let detail = '';
  try {
    extractSyncLabelsScript(synth);
    ok = true;
  } catch (e) {
    detail = String(e.message).split('\n')[0];
  }
  record('workflow-job-boundary-skips-yaml-comment-lines', ok, detail);
}
// E7/F6: syntactically invalid script body must surface as per-case err, never crash the suite.
// 期望值溯源：F6 契约（构造期 SyntaxError 归并进 err 返回路径）。E2-r2 修正：断言比对异常
//   类型（instanceof SyntaxError），而非在 err.message 里找 "SyntaxError" 类名（Function
//   Constructor 抛的 message 只含 "Unexpected token"，类名在 err.name，旧断言修复后仍假红）。
{
  const broken = "const x = ;\n github.rest.issues.addLabels(\n github.rest.issues.removeLabel(";
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
    scriptSrc: broken,
  });
  record('workflow-new-function-syntax-error-surfaces-as-case-err',
    r.err !== null && r.err instanceof SyntaxError,
    'err=' + (r.err ? String(r.err.name) + ': ' + String(r.err.message).split('\n')[0] : 'null'));
}

// --- 突变验证：删除 actor 门后 harness 必须捕获（证明夹具对 gate-removal 敏感，非文本断言）---
{
  // 从提取文本中移除 pull_request_review actor 门（F2 门）的整块条件（gate-removal 变异）。
  const actorGate = "if (context.eventName === 'pull_request_review' && context.payload.review?.user?.type !== 'Bot')";
  if (!text.includes(actorGate)) { check('workflow-actor-gate-present-for-mutation', false, 'actor gate 未在场'); }
  else {
    // 突变体：actor 门条件恒假（等价于删除门）。human actor 事件将不再早退，深入求值并写标签。
    //   提取失败不再使进程崩溃（评审 359）：捕获为 loud FAIL 证据，突变用例仍产出逐例上报。
    try {
      const src = extractSyncLabelsScript(text).replace(
        "if (context.eventName === 'pull_request_review' && context.payload.review?.user?.type !== 'Bot')",
        "if (false)");
      const r = await runWorkflow({
        eventName: 'pull_request_review',
        payload: { review: { user: { type: 'User' } }, pull_request: { head: { sha: 'HEAD' } } },
        env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
        headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
        scriptSrc: src,
      });
      // 契约（突变验证 + 契约 3 C-B 翻转）：human actor 在 actor 门被移除后，脚本不再早退——
      //   它会把 human 当作合法 actor 继续求值（夹具无可解析评级 → 状态评论 verdict=no-rating 落盘）。
      //   若夹具对 mutation 不敏感（零 API 调用），则 harness 失效（假绿风险）。
      record('workflow-harness-catches-actor-gate-removal',
        r.err === null && r.calls.pullsGet > 0 && r.calls.createComment > 0,
        'pullsGet=' + r.calls.pullsGet + ' createComment=' + r.calls.createComment + ' err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null'));
    } catch (e) {
      record('workflow-harness-catches-actor-gate-removal', false,
        'extract/mutation failed: ' + String(e && e.message).split('\n')[0]);
    }
  }
}

// ================================================================
// D 系列契约（§0 定版形态：方案3表格 + 证据链接 + 进度表 + BOT-METADATA 六键）。
// 期望值溯源：主计划 §0 人类定版（2026-10-14T07:19Z），非抄录当前实现。
// D1 表格形态 + 机读枚举共存：表格行 **CodeRabbit** 与 metadata bots 并存。
{
  const r = await barrierCase({ changedFiles: 107, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }] });
  record('workflow-status-comment-table-and-machine-enumeration',
    r.err === null && r.calls.createComment === 1 &&
      r.comments[0]?.body.includes('**CodeRabbit**') &&
      r.comments[0]?.body.includes('跳过审查') &&
      (r.comments[0]?.body || '').includes('"bots":{"coderabbit":"file_limit"'),
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') + ' head=' + String(r.comments[0]?.body).split('\n')[1]);
}
// D2 内联命令块分组：2 条同 review id + 1 条无主 + 1 条人类内联 → 恰 1 行 select(==551)。
{
  const pullComments = [
    { id: 1, pull_request_review_id: 551, commit_id: 'HEAD', path: 'a.js', line: 10, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } },
    { id: 2, pull_request_review_id: 551, commit_id: 'HEAD', path: 'b.js', line: 20, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } },
    { id: 3, pull_request_review_id: null, commit_id: 'HEAD', path: 'c.js', line: 30, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } },
    { id: 4, pull_request_review_id: 551, commit_id: 'HEAD', path: 'd.js', line: 40, user: { type: 'User', login: 'human' } },
  ];
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, id: 551, body: 'SUGGESTION: ok' }],
    pullComments,
  });
  const body = r.comments[0]?.body || '';
  record('workflow-inline-fetch-command-grouped-by-review-id',
    r.err === null && r.calls.pullsListComments > 0 &&
      body.includes('--paginate') &&
      body.includes('select(.pull_request_review_id == 551 and .commit_id == "HEAD" and (.user.login == "kilo-code-bot[bot]"))') &&
      body.includes('{path, line, body}') &&
      !body.includes('select(.pull_request_review_id == null)') &&
      (body.match(/select\(/g) || []).length === 1,
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') + ' cmds=' + (body.match(/select\(/g) || []).length);
}
// D2b 无受信 head review 内联 → 命令块为空（review-finding 契约：不再输出 != null 兜底命令，
//   防历史/无关内联整批拉给 agent）。
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, id: 552, body: 'SUGGESTION: ok' }], pullComments: [] });
  const body = r.comments[0]?.body || '';
  record('workflow-inline-empty-yields-no-command',
    r.err === null && !body.includes('select(.pull_request_review_id != null)') &&
      !body.includes('select(.pull_request_review_id ==') &&
      body.includes('```bash'),
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') +
      ' cmds=' + (body.match(/select\(/g) || []).length);
}
// D2c 陈旧边界：评论自身 commit_id 非当前 head（历史/已过期内联）不入命令——只输出挂在本轮 diff 上的评论。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, id: 552, body: 'SUGGESTION: ok' }],
    pullComments: [{ id: 20, pull_request_review_id: 552, commit_id: 'OLD', path: 'z.js', line: 1, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } }],
  });
  const body = r.comments[0]?.body || '';
  record('workflow-inline-command-excludes-stale-commit-id',
    r.err === null && !body.includes('select(.pull_request_review_id ==') &&
      (body.match(/select\(/g) || []).length === 0,
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null'));
}
// D2d 重锚纳入：评论自身 commit_id 已重锚到当前 head，但其所属 review 的 commit_id 仍是旧 head
//   （review id 不在 headReviews）——必须仍被纳入命令（Bug 2 回归：按 review commit_id 过滤会误丢）。
{
  const r = await barrierCase({
    reviews: [{ ...COMMENTED, id: 552, body: 'SUGGESTION: ok' }],
    pullComments: [{ id: 30, pull_request_review_id: 999, commit_id: 'HEAD', path: 'z.js', line: 1, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } }],
  });
  const body = r.comments[0]?.body || '';
  record('workflow-inline-command-includes-reanchored-review-id',
    r.err === null && body.includes('select(.pull_request_review_id == 999') &&
      body.includes('.commit_id == "HEAD"') &&
      (body.match(/select\(/g) || []).length === 1,
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null'));
}
// D3 首轮即收敛：create 轮立即用 createComment 返回的 html_url 重渲染并 updateComment 回填
//   （不再依赖第二轮 update 才修正——首轮评论即携带真实 #issuecomment-… 链接）。
{
  const created = await barrierCase({ reviews: [{ ...COMMENTED, id: 553, body: 'SUGGESTION: ok' }], pullComments: [] });
  const body1 = created.comments[0]?.body || '';
  const updated = await barrierCase({
    reviews: [{ ...COMMENTED, id: 553, body: 'SUGGESTION: ok' }],
    comments: created.comments.slice(),
    pullComments: [],
  });
  const body2 = updated.comments[0]?.body || '';
  record('workflow-self-url-converges-on-first-create',
    created.err === null && created.calls.createComment === 1 && created.calls.updateComment === 1 &&
      body1.includes('issuecomment-') &&
      body1.includes('"comment_url":"https://github.com/o/r/pull/8#issuecomment-') &&
      !body1.includes('https://github.com/o/r/pull/8\n') &&
      updated.err === null && updated.calls.updateComment === 1 &&
      body2.includes('"comment_url":"https://github.com/o/r/pull/8#issuecomment-'),
    'create=' + created.calls.createComment + ' update1=' + created.calls.updateComment + ' update2=' + updated.calls.updateComment + ' urlRound1=' + body1.includes('issuecomment-'));
}
// D4 BOT-METADATA 六键：JSON.parse 往返 + schema（head/verdict/risk_score/bots/evidence/links/autofill/comment_url）。
{
  const r = await barrierCase({ changedFiles: 1, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }, { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'coderabbitai[bot]' }, body: 'Merge Readiness: Ready' }], pullComments: [] });
  const body = r.comments[0]?.body || '';
  const m = body.match(/<!-- BOT-METADATA: (.*?) -->/s);
  let meta = null;
  try { meta = m ? JSON.parse(m[1]) : null; } catch (e) { meta = null; }
  record('workflow-bot-metadata-json-roundtrip',
    r.err === null && m !== null && meta !== null &&
      typeof meta.head === 'string' && meta.head === 'HEAD' &&
      ['complete', 'risk', 'partial', 'pending', 'unavailable'].includes(meta.verdict) &&
      ('risk_score' in meta) &&
      meta.bots && meta.bots.coderabbit === 'completed' && meta.bots.kilocode === 'completed' &&
      meta.evidence && ('links' in meta) && ('autofill' in meta) &&
      ('comment_url' in meta),
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') + ' meta=' + JSON.stringify(meta));
}
// D5 转义对抗：html_url 含 --> 与 < 时注释不早终止、JSON 仍可解析。
{
  const hostile = { id: 71, body: '<!-- bot-review-labeler:status -->\nold', html_url: 'https://x/pull/8#issuecomment-71--><script>', user: { type: 'Bot', login: 'github-actions[bot]' } };
  const r = await barrierCase({ reviews: [{ ...COMMENTED, id: 555, body: 'SUGGESTION: ok' }], comments: [hostile], pullComments: [] });
  const body = r.comments[0]?.body || '';
  const tail = body.match(/<!-- BOT-METADATA: (.*?) -->/s);
  let meta = null;
  try { meta = tail ? JSON.parse(tail[1]) : null; } catch (e) { meta = null; }
  record('workflow-bot-metadata-escapes-html-comment-terminator',
    r.err === null && tail !== null && meta !== null && meta.comment_url === 'https://x/pull/8#issuecomment-71--><script>',
    'tails=' + (body.match(/<!-- BOT-METADATA/g) || []).length + ' meta=' + JSON.stringify(meta));
}
// D6 采集抛错 fail-safe：listComments 拒绝 → 降级行在场、标签照写、无 err 逃逸。
//   桩须是「被 paginate 调用时才返回 rejected Promise」的 async 函数，而非立即执行的 IIFE：
//   `(async()=>{throw})() || fn` 会在求值实参时把 Promise 对象（非函数）传给 paginate → paginate 内
//   `fn(params)` 抛 TypeError（非 API 拒绝）且被弃的 rejected Promise 触发 unhandled rejection（实测崩全链）。
{
  const broken = extractSyncLabelsScript(text).replace(
    'github.rest.pulls.listComments',
    'async () => { throw new Error("boom"); }');
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
    scriptSrc: broken,
  });
  record('workflow-inline-fetch-failure-degrades-not-blocks',
    r.err === null &&
      (r.comments[0]?.body || '').includes('内联评论采集失败') &&
      r.logs.some((l) => l.includes('boom')),
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') + ' add=' + r.calls.add +
      ' degraded=' + (r.comments[0]?.body || '').includes('内联评论采集失败') +
      ' boomCaught=' + r.logs.some((l) => l.includes('boom')));
}
// D6b 定位降级 fail-safe：issues.listComments（writeStatusComment 内）拒绝 → 本轮跳过状态评论
//   （不 create 不 update、无 err 逃逸），标签照写、主链路不崩；下次事件重试自愈。
//   桩同为「被 paginate 调用才 reject 的 async 函数」；降级语义区别于 D6——D6 是内联采集（展示面
//   降级行仍写入），本用例是 ownComment 定位（直接跳过评论写，不 duplicate marker 评论）。
{
  const broken = extractSyncLabelsScript(text).replace(
    'github.rest.issues.listComments',
    'async () => { throw new Error("lookup-boom"); }');
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
    scriptSrc: broken,
  });
  record('workflow-own-comment-lookup-failure-skips-not-crashes',
    r.err === null && r.calls.createComment === 0 && r.calls.updateComment === 0 &&
      r.logs.some((l) => l.includes('lookup-boom')),
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') + ' add=' + r.calls.add +
      ' create=' + r.calls.createComment + ' update=' + r.calls.updateComment +
      ' lookupCaught=' + r.logs.some((l) => l.includes('lookup-boom')));
}
// D7 评分管道零消费：变体验证——把内联采集结果拼入 codeRabbitText 的篡改体必须被捕获。
//   篡改点移入评分区可达作用域：直接在 codeRabbitText 聚合行拼接常量攻击串（证明夹具对
//   "评分区混入评论正文"敏感——干净实现不含该串故 approved，篡改体拉爆评级被捕获）。
{
  const ATTACK = 'Merge Readiness band: Blocked';
  // 夹具侧防求值：${textBlob} 以 \${ 转义写入篡改串，仅在被执行脚本内展开。
  const tampered = extractSyncLabelsScript(text).replace(
    'codeRabbitText += `\\n${textBlob}`;',
    'codeRabbitText += `\\n${textBlob}\\n' + ATTACK + '`;');
  // 4.1 提取循环以 targetRuns 为输入（无 completed run 时循环体不执行、篡改行不运行）——
  //   夹具须携 coderabbit completed check run 使篡改行真实执行（夹具保真：攻击面在最短路径上可观测）。
  const crRun = { name: 'CodeRabbit Review', status: 'completed', conclusion: 'success', run_attempt: 1,
    app: { slug: 'coderabbitai', id: 347564 }, output: { title: '', summary: '', text: '' } };
  const common = {
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' },
    headSha: 'HEAD',
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    checkRuns: [crRun],
    pullComments: [{ id: 9, pull_request_review_id: 556, path: 'x.js', line: 1, body: ATTACK, user: { type: 'Bot', login: 'coderabbitai[bot]' } }],
  };
  const r = await runWorkflow({ ...common, scriptSrc: tampered });
  const clean = await runWorkflow(common);
  record('workflow-inline-bodies-never-feed-scoring',
    r.labelsAdded.flat().includes('review:approved') === false &&
      clean.labelsAdded.flat().includes('review:approved') === true,
    'tampered=' + JSON.stringify(r.labelsAdded.flat()) + ' clean=' + JSON.stringify(clean.labelsAdded.flat()));
}
// D8 进度表三态：auto-fill sentinel 标记 head 匹配 → 已更新（teal）；不匹配 → 已生成_但head过期（purp）；无标记 → 未生成（blueviolet）。
//   夹具 sha 用 40-hex 形态（实现侧标记正则锚 [0-9a-f]{40}）。
{
  const SHA40 = 'a5bc8f3dd2c5f1c985ef4b0f835a6e04b77218e1';
  const SYNC = '<!-- auto-fill-pr: synced head=';
  const syncedBody = 'PR 标题与描述由 auto-fill 维护。\n' + SYNC + SHA40 + ' -->';
  const staleBody = 'PR 标题与描述由 auto-fill 维护。\n' + SYNC + '0000000000000000000000000000000000000000 -->';
  const rSync = await runWorkflow({
    eventName: 'pull_request_target', payload: { pull_request: { head: { sha: SHA40 } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' }, headSha: SHA40, headBranchRef: 'feature-branch',
    reviews: [{ ...COMMENTED, commit_id: SHA40, body: 'SUGGESTION: ok' }], pullComments: [], prBody: syncedBody,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: `https://github.com/o/r/actions/runs/42` }],
    autofillRunRecord: { id: 42, path: '.github/workflows/auto-fill-pr.yml', event: 'pull_request_target', conclusion: 'success', head_branch: 'feature-branch', pull_requests: [{ number: 8, head: { sha: SHA40 } }] },
  });
  const rStale = await runWorkflow({
    eventName: 'pull_request_target', payload: { pull_request: { head: { sha: SHA40 } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' }, headSha: SHA40,
    reviews: [{ ...COMMENTED, commit_id: SHA40, body: 'SUGGESTION: ok' }], pullComments: [], prBody: staleBody,
  });
  const rNone = await runWorkflow({
    eventName: 'pull_request_target', payload: { pull_request: { head: { sha: SHA40 } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' }, headSha: SHA40,
    reviews: [{ ...COMMENTED, commit_id: SHA40, body: 'SUGGESTION: ok' }], pullComments: [], prBody: '',
  });
  record('workflow-autofill-progress-table-three-states',
    rSync.err === null && rStale.err === null && rNone.err === null &&
      (rSync.comments[0]?.body || '').includes('已更新') &&
      (rStale.comments[0]?.body || '').includes('已生成_但head过期') &&
      (rNone.comments[0]?.body || '').includes('未生成') &&
      (rSync.comments[0]?.body || '').includes('"autofill":{"title":"synced","body":"synced"') &&
      (rStale.comments[0]?.body || '').includes('"title":"stale"') &&
      (rNone.comments[0]?.body || '').includes('"title":"absent"'),
    'sync=' + (rSync.comments[0]?.body || '').includes('已更新') + ' stale=' + (rStale.comments[0]?.body || '').includes('已生成_但head过期') + ' none=' + (rNone.comments[0]?.body || '').includes('未生成') +
      ' err=' + (rSync.err ? String(rSync.err.message).split('\n')[0] : 'null'));
}
// D8b 跨轮累积（E1 契约）：PR body 带两条旧 sentinel（模拟 auto-fill 多轮追加未清理）→
//   labeler 须取末次（最新）标记判态，first-match 取最旧会导致恒 stale 误判。
{
  const SHA_A = 'a5bc8f3dd2c5f1c985ef4b0f835a6e04b77218e1';
  const SHA_B = 'b7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9';
  const SHA_C = 'c8d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0';
  const accumulated = [
    'PR 标题与描述由 auto-fill 维护。',
    '<!-- auto-fill-pr: synced head=' + SHA_A + ' -->',
    '',
    '其他正文',
    '<!-- auto-fill-pr: synced head=' + SHA_B + ' -->',
  ].join('\n');
  const r = await runWorkflow({
    eventName: 'pull_request_target', payload: { pull_request: { head: { sha: SHA_B } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' }, headSha: SHA_B, headBranchRef: 'feature-branch',
    reviews: [{ ...COMMENTED, commit_id: SHA_B, body: 'SUGGESTION: ok' }], pullComments: [], prBody: accumulated,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: `https://github.com/o/r/actions/runs/43` }],
    autofillRunRecord: { id: 43, path: '.github/workflows/auto-fill-pr.yml', event: 'pull_request_target', conclusion: 'success', head_branch: 'feature-branch', pull_requests: [{ number: 8, head: { sha: SHA_B } }] },
  });
  record('workflow-autofill-accumulated-sentinels-resolve-latest',
    r.err === null &&
      (r.comments[0]?.body || '').includes('已更新') &&
      (r.comments[0]?.body || '').includes('"autofill":{"title":"synced","body":"synced"'),
    'resolved=' + (r.comments[0]?.body || '').includes('已更新') +
      ' err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null'));
  // SHA_C 不等于末次 SHA_B → 判 stale（而非最旧 SHA_A 的比对结果——二者同为 stale，故以 synced 判定为主锚）。
  const rStale = await runWorkflow({
    eventName: 'pull_request_target', payload: { pull_request: { head: { sha: SHA_C } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' }, headSha: SHA_C,
    reviews: [{ ...COMMENTED, commit_id: SHA_C, body: 'SUGGESTION: ok' }], pullComments: [], prBody: accumulated,
    autofillRuns: [{ head_sha: SHA_B, conclusion: 'success', name: 'auto-fill-pr' }],
  });
  record('workflow-autofill-accumulated-sentinels-stale-when-mismatch',
    rStale.err === null && (rStale.comments[0]?.body || '').includes('已生成_但head过期'),
    'resolved=' + (rStale.comments[0]?.body || '').includes('已生成_但head过期') +
      ' err=' + (rStale.err ? String(rStale.err.message).split('\n')[0] : 'null'));
}
// D8c synced 可信源（review-finding 终局契约）：佐证 = auto-fill 落在 currentHeadSha 上的
//   commit status（context=auto-fill-pr, state=success）——SHA 键不可伪造；且按 status.target_url
//   解出运行 ID 回查 getWorkflowRun 权威记录，核验 run 本体身份（path 文件部分=event=conclusion，
//   path 允许带 @ref 后缀）与 head 关联（pull_requests[] 的 number+head.sha 与当前轮一致）。
//   无 status / status 无 run 标识 / run 本体不匹配 / head 关联不中（含 pull_requests 空数组）→ stale。
{
  const SHA = 'd9e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1';
  const prBody = 'PR 标题与描述由 auto-fill 维护。\n<!-- auto-fill-pr: synced head=' + SHA + ' -->';
  const RUN_ID = 424242;
  const RUN_URL = `https://github.com/o/r/actions/runs/${RUN_ID}`;
  const base = {
    eventName: 'pull_request_target', payload: { pull_request: { head: { sha: SHA } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'coderabbit,kilocode' }, headSha: SHA,
    reviews: [{ ...COMMENTED, commit_id: SHA, body: 'SUGGESTION: ok' }], pullComments: [], prBody,
  };
  const okRun = {
    id: RUN_ID, path: '.github/workflows/auto-fill-pr.yml', event: 'pull_request_target',
    conclusion: 'success', head_branch: 'feature-branch',
    pull_requests: [{ number: 8, head: { sha: SHA } }],
  };
  const uncorroborated = await runWorkflow(base);
  // 全链佐证：currentHeadSha 上有 auto-fill status → target_url 解出 run id → getWorkflowRun
  //   权威记录 run 本体身份 + head 关联均通过 → synced。
  const corroborated = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: okRun,
  });
  // 反证①：同 run 记录但 pull_requests 指向他 PR（number 9）→ head 关联不中 → stale。
  const foreignPr = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, pull_requests: [{ number: 9, head: { sha: SHA } }] },
  });
  // 反证②：run 本体不是 auto-fill 工作流（path 篡改/为他工作流）→ 不佐证（旧轮运行佐证新 head 错位同形态）。
  const foreignWorkflow = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, path: '.github/workflows/other.yml' },
  });
  // 反证③：run.event 非 pull_request_target（push 形态仿冒）→ 不佐证。
  const wrongEvent = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, event: 'push' },
  });
  // 反证④：run.conclusion 非 success → 不佐证。
  const notSuccess = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, conclusion: 'failure' },
  });
  // 反证⑤：pull_requests 空数组（fork 视角已知 API 缺陷形态）→ 无可核验关联证据，
  //   分支名不是 PR 身份（同一分支可被多个 PR 引用）→ fail-closed 判 stale。
  const forkEmptyPrs = await runWorkflow({
    ...base, headBranchRef: 'feature-branch',
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, pull_requests: [] },
  });
  // 反证⑥：pull_requests 指向他 PR 编号（number 9）且 sha 匹配 → 关联不中 → stale。
  const foreignPrNumber = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, pull_requests: [{ number: 9, head: { sha: SHA } }] },
  });
  // 反证⑦：status 存在但 target_url 无 run 标识（老记录/手写）→ 不可核验 fail-closed → stale。
  const noRunId = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: 'https://example.com/no-run' }],
  });
  // 正证⑧：path 带 @ref 后缀（Actions API 权威记录常见形态）→ 仍按工作流文件部分识别 → synced。
  const refSuffixedPath = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, path: '.github/workflows/auto-fill-pr.yml@main' },
  });
  // 反证⑨：path 带 @ref 但指向他工作流 → 本体身份不匹配 → stale。
  const refSuffixedForeignWorkflow = await runWorkflow({
    ...base,
    commitStatuses: [{ context: 'auto-fill-pr', state: 'success', target_url: RUN_URL }],
    autofillRunRecord: { ...okRun, path: '.github/workflows/other.yml@main' },
  });
  record('workflow-autofill-synced-requires-trusted-run',
    uncorroborated.err === null && (uncorroborated.comments[0]?.body || '').includes('已生成_但head过期') &&
      corroborated.err === null && (corroborated.comments[0]?.body || '').includes('已更新') &&
      (corroborated.comments[0]?.body || '').includes('"autofill":{"title":"synced","body":"synced"') &&
      foreignPr.err === null && (foreignPr.comments[0]?.body || '').includes('已生成_但head过期') &&
      foreignWorkflow.err === null && (foreignWorkflow.comments[0]?.body || '').includes('已生成_但head过期') &&
      wrongEvent.err === null && (wrongEvent.comments[0]?.body || '').includes('已生成_但head过期') &&
      notSuccess.err === null && (notSuccess.comments[0]?.body || '').includes('已生成_但head过期') &&
      forkEmptyPrs.err === null && (forkEmptyPrs.comments[0]?.body || '').includes('已生成_但head过期') &&
      foreignPrNumber.err === null && (foreignPrNumber.comments[0]?.body || '').includes('已生成_但head过期') &&
      noRunId.err === null && (noRunId.comments[0]?.body || '').includes('已生成_但head过期') &&
      refSuffixedPath.err === null && (refSuffixedPath.comments[0]?.body || '').includes('已更新') &&
      refSuffixedForeignWorkflow.err === null && (refSuffixedForeignWorkflow.comments[0]?.body || '').includes('已生成_但head过期'),
    'uncor=' + (uncorroborated.comments[0]?.body || '').includes('已生成_但head过期') +
      ' cor=' + (corroborated.comments[0]?.body || '').includes('已更新') +
      ' foreignPr=' + (foreignPr.comments[0]?.body || '').includes('已生成_但head过期') +
      ' foreignWf=' + (foreignWorkflow.comments[0]?.body || '').includes('已生成_但head过期') +
      ' wrongEvent=' + (wrongEvent.comments[0]?.body || '').includes('已生成_但head过期') +
      ' notSuccess=' + (notSuccess.comments[0]?.body || '').includes('已生成_但head过期') +
      ' forkEmpty=' + (forkEmptyPrs.comments[0]?.body || '').includes('已生成_但head过期') +
      ' foreignPrNum=' + (foreignPrNumber.comments[0]?.body || '').includes('已生成_但head过期') +
      ' noRunId=' + (noRunId.comments[0]?.body || '').includes('已生成_但head过期') +
      ' refPath=' + (refSuffixedPath.comments[0]?.body || '').includes('已更新') +
      ' refForeignWf=' + (refSuffixedForeignWorkflow.comments[0]?.body || '').includes('已生成_但head过期') +
      ' err=' + (uncorroborated.err ? String(uncorroborated.err.message).split('\n')[0] : 'null'));
}
// D9 证据链接（review-finding 修订契约）：证据只取当前 head 已认证 review 的 html_url；
//   无 head review 但 evidence=authenticated_check_run 时回退 checkRunUrl；否则纯图。
//   历史顶层评论（无 commit_id 绑定）不再作为证据来源。
{
  const withReview = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, html_url: 'https://github.com/o/r/pull/8#pullrequestreview-557', body: 'SUGGESTION: ok' }],
    pullComments: [],
  });
  const checkRunOnly = await barrierCase({
    changedFiles: 1, stars: 100, pullComments: [],
    checkRuns: [{ name: 'CodeRabbit Review', status: 'completed', conclusion: 'success', run_attempt: 1,
      html_url: 'https://github.com/o/r/pull/8/actions/runs/42', app: { slug: 'coderabbitai', id: 347564 }, output: { title: '', summary: '', text: '' } }],
  });
  const historyCommentOnly = await barrierCase({
    changedFiles: 1, stars: 100, pullComments: [],
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [{
      id: 80, html_url: 'https://github.com/o/r/pull/8#issuecomment-80',
      body: '<!-- This is an auto-generated comment: summarize\nSummary here',
      user: { type: 'Bot', login: 'coderabbitai[bot]' },
    }],
  });
  const bare = await barrierCase({ changedFiles: 1, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }], pullComments: [] });
  const statusOf = (list) => list.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.includes('BOT-METADATA'))?.body || '';
  record('workflow-evidence-link-wraps-bot-result-badge',
    withReview.err === null && statusOf(withReview.comments).includes('<a href="https://github.com/o/r/pull/8#pullrequestreview-557">') &&
      checkRunOnly.err === null && statusOf(checkRunOnly.comments).includes('<a href="https://github.com/o/r/pull/8/actions/runs/42">') &&
      historyCommentOnly.err === null && !statusOf(historyCommentOnly.comments).includes('#issuecomment-80') &&
      bare.err === null && !statusOf(bare.comments).includes('<a href="https://github.com/o/r/pull/8#'),
    'review=' + statusOf(withReview.comments).includes('#pullrequestreview-557') +
      ' run=' + statusOf(checkRunOnly.comments).includes('actions/runs/42') +
      ' historyRejected=' + !statusOf(historyCommentOnly.comments).includes('#issuecomment-80') +
      ' bare=' + statusOf(bare.comments).includes('<a href="https://github.com/o/r/pull/8#'));
}
// D10 HEAD 徽章 commit 链接形态：{repoUrl}/pull/{n}/commits/{fullSha}。
{
  const r = await barrierCase({ changedFiles: 1, stars: 100, reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }], pullComments: [] });
  const body = r.comments[0]?.body || '';
  record('workflow-head-badge-links-to-commit',
    r.err === null && body.includes('/pull/8/commits/HEAD'),
    'err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null') + ' found=' + body.includes('/commits/'));
}

// ================================================================
// C-A/C-B/契约 4（20261017-autofill-labeler-fix）：顶层摘要评论采集面 + verdict 兜底 +
//   空块提示行 + byReview 诊断日志。期望值由计划契约 3/4 推导，非抄录实现。
// ================================================================

// C-A1：CodeRabbit 顶层摘要评论（marker `summarize by coderabbit.ai` + 受信 login + type=Bot）
//   含 `**Merge Risk:** **🟡 Moderate**` → crScore=2（moderate）→ 与 kilo SUGGESTION(1) 取最严=2 → risk:medium。
//   旧实现 4.3 fail-closed 零读顶层评论 → 双 null → needs-work（红）。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [{
      id: 81,
      body: '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n<summary><strong>Merge Risk:</strong> <strong>🟡 Moderate</strong> · up to <code>50ddc</code></summary>',
      user: { type: 'Bot', login: 'coderabbitai[bot]' },
    }],
    pullComments: [],
  });
  record('workflow-top-level-comment-coderabbit-merge-risk-moderate',
    r.err === null && r.labelsAdded.flat().includes('risk:medium') && !r.labelsAdded.flat().includes('review:needs-work'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// C-A1b：Merge Risk: High → crScore=3 → risk:high。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [{
      id: 82,
      body: '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\nMerge Risk: High — 多处高危发现',
      user: { type: 'Bot', login: 'coderabbitai[bot]' },
    }],
    pullComments: [],
  });
  record('workflow-top-level-comment-coderabbit-merge-risk-high',
    r.err === null && r.labelsAdded.flat().includes('risk:high'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// C-A1c：已知 marker 但级别词未知（🟣 Unknown）→ 该正则不捕获、不 crash、score 落 null → 兜底分支（C-B）。
//   反例强化（review 契约）：正文追加含 “high” 子串的文本，使测试实际覆盖风险级别正则的误匹配闸门——
//   旧跨行 + 无词边界正则会把后续正文里的 'high' 当级别词误命中，本用例据此暴露该漏面。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [{
      id: 83,
      body: '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\nMerge Risk: 🟣 Unknown\n后续说明文本含有 high 这个词，不得被当级别误命中',
      user: { type: 'Bot', login: 'coderabbitai[bot]' },
    }],
    pullComments: [],
  });
  record('workflow-top-level-comment-unknown-risk-word-fail-closed',
    r.err === null && !r.labelsAdded.flat().includes('risk:critical') && !r.labelsAdded.flat().includes('risk:high'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// C-A1d：无 marker 顶层评论不消费（4.3 fail-closed 立场收窄不破）——同形态正文缺 marker → 双 null → 兜底。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [{
      id: 84,
      body: 'Merge Risk: High（无 marker 的顶层评论）',
      user: { type: 'Bot', login: 'coderabbitai[bot]' },
    }],
    pullComments: [],
  });
  record('workflow-top-level-comment-without-marker-not-consumed',
    r.err === null && !r.labelsAdded.flat().includes('risk:high'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// C-A1e：marker 在但 login 非受信（伪造 Bot）→ 不消费。
//   反例强化（review 契约）：正文补齐 CodeRabbit marker，确保用例能检验不可信登录名闸门
//   （marker 在场却因 login 不符而 fail-closed，不与 C-A1d「无 marker」路径混淆）。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    comments: [{
      id: 85,
      body: '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\nMerge Risk: High',
      user: { type: 'Bot', login: 'evil-bot[bot]' },
    }],
    pullComments: [],
  });
  record('workflow-top-level-comment-untrusted-login-not-consumed',
    r.err === null && !r.labelsAdded.flat().includes('risk:high'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// C-A2：Kilo 顶层评论（marker `<!-- kilo-review -->` + 受信 login）含计数表 → kiloScore=2 → risk:medium。
{
  const kiloTop = [
    '<!-- kilo-review -->',
    '**Status:** 3 Issues Found',
    '### Overview',
    '| Severity | Count |',
    '|----------|-------|',
    '| CRITICAL | 0 |',
    '| WARNING | 1 |',
    '| SUGGESTION | 2 |',
  ].join('\n');
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: '' }],
    comments: [{ id: 86, body: kiloTop, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } }],
    pullComments: [],
  });
  record('workflow-top-level-comment-kilo-count-table-rates',
    r.err === null && r.labelsAdded.flat().includes('risk:medium') && r.labelsAdded.flat().includes('ai-reviewed'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// C-B：评分双 null（无顶层评论或顶层无 marker）→ verdict 落 `no-rating` 而非 `risk`，
//   风险量化列 `N/A`，不加 review:needs-work（纯无评级不伪造 needs-work）。
//   兼测意图：夹具 reviews body 为中文纯散文（「本轮无评级形态…」），同时验证 4.5 severity
//   兜底正则不误命中中文散文（severity/风险/level 前缀均不在场）——正负两面兼得。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: '本轮无评级形态（正文既无 band 也无计数表）' }],
    comments: [],
    pullComments: [],
  });
  const body = r.comments[0]?.body || '';
  const metaMatch = body.match(/<!-- BOT-METADATA: (.*?) -->/s);
  let meta = null;
  try { meta = metaMatch ? JSON.parse(metaMatch[1]) : null; } catch { meta = null; }
  record('workflow-no-rating-verdict-falls-back-to-no-rating',
    r.err === null && meta !== null && meta.verdict === 'no-rating' &&
      !r.labelsAdded.flat().includes('review:needs-work') &&
      body.includes('N/A'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0]
      : 'verdict=' + (meta && meta.verdict) + ' labels=' + JSON.stringify(r.labelsAdded.flat()));
}
// 契约 4a：采集成功零内联 → bash 块含显式提示行 `# 本轮无可归属受信内联评论`。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    pullComments: [],
  });
  const body = r.comments[0]?.body || '';
  record('workflow-inline-empty-block-explicit-hint',
    r.err === null && body.includes('# 本轮无可归属受信内联评论'),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'hint=' + body.includes('# 本轮无可归属受信内联评论'));
}
// 契约 4a 负控：有受信内联 → 不出提示行。
{
  const pullComments = [{ id: 40, pull_request_review_id: 551, commit_id: 'HEAD', path: 'a.js', line: 1, user: { type: 'Bot', login: 'kilo-code-bot[bot]' } }];
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, id: 551, body: 'SUGGESTION: ok' }],
    pullComments,
  });
  const body = r.comments[0]?.body || '';
  record('workflow-inline-present-no-hint',
    r.err === null && !body.includes('# 本轮无可归属受信内联评论') && body.includes('select('),
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'hintAbsent=' + !body.includes('# 本轮无可归属受信内联评论'));
}
// 契约 4b：byReview 诊断日志——过滤循环后输出 inlineComments.length 与 byReview 计数（含被过滤原因）。
{
  const r = await barrierCase({
    changedFiles: 1, stars: 100,
    reviews: [{ ...COMMENTED, body: 'SUGGESTION: ok' }],
    pullComments: [],
  });
  const diag = r.logs.join('\n');
  record('workflow-byreview-diagnostic-logged',
    r.err === null && /\[Status Comment\] byReview/.test(diag),
    'diag=' + diag.split('\n').filter((l) => l.includes('byReview')).join(' | ').slice(0, 200));
}

console.log(behaviorFailures === 0 ? 'BOT-LABELER-SELFTEST ALL OK' : 'BOT-LABELER-SELFTEST FAILURES=' + behaviorFailures);
process.exit(behaviorFailures === 0 ? 0 : 1);
