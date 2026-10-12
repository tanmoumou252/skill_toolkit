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
check('bot-labeler-all-bots-rated-gate',
  text.includes('const ratingByBot') &&
  text.includes('scores.length > 0 && scores.every(score => score !== null)') &&
  text.includes('if (hasParseableRating)') === false &&
  text.includes('if (allBotsRated)'));
check('bot-labeler-incomplete-rating-needs-work',
  text.includes('hasParseableRating || hasCheckFailure') &&
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
function extractRegex(name) {
  const re = new RegExp(`const ${name} = /(.+)/([a-z]+);`);
  const m = text.match(re);
  if (!m) return null;
  return new RegExp(m[1], m[2]);
}
const prodBareCritical = extractRegex('bareCriticalOrBlocker');
const prodBareWarning = extractRegex('bareWarning');
const prodBareSuggestion = extractRegex('bareSuggestion');
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

// --- 栅栏：完成判据基于官方 bot 在当前 head 的 authenticated review（任意非 DISMISSED state，含 COMMENTED）
//     或完成 check run（app.id 防伪）之一；评论顶层无 commit_id 不能满足完成。---
check('workflow-barrier-requires-bindable-head-carrier',
  /const hasHeadReview = headReviews\.some\([\s\S]{0,180}?\(def\.logins \|\| \[\]\)\.includes\(r\.user\.login\)/.test(text) &&
  /!hasHeadReview && !runs\.some\(r => r\.status === 'completed'\)/.test(text) &&
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
  //   1) `.kilo/plans/20261011-t1-bot-labeler.md:193` 登记该 SHA 为 actions/github-script v9.0.0 的
  //      不可变 Node-24 提交（Node.js 20 deprecation / runtime-warning 处理）；
  //   2) `.kilo/plans/test-evidence/20261011-four-task-baseline.md:62` 记录两处 `@v7` → 该 SHA 的实改；
  //   3) runner 版本前置由 `.kilo/logs_103132623553/0_sync-labels.txt:1` 实测（2.337.0 ≥ 2.327.1）。
  //   断言仍逐字锁定该 pin，v7 标签由反向锚 workflow-no-stale-github-script-v7 锁死不得回归；
  //   SHA 变更须走代码变更审查链并同步以上三处登记。
  /actions\/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3/.test(text));
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
  !/github\.rest\.issues\.listComments\(/.test(text) &&
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

// --- F1：barrier 未完成清理循环必须跳过 review:/risk: 裁决组（新形态）---
check('workflow-barrier-cleanup-skips-verdict-labels',
  (() => {
    const barrierIdx = text.indexOf('if (!allReady)');
    const loopStart = text.indexOf('for (const l of Object.keys(SYSTEM_LABELS))', barrierIdx);
    const loopEnd = text.indexOf('return;', text.indexOf('removeLabel', loopStart));
    if (barrierIdx === -1 || loopStart === -1 || loopEnd === -1) return false;
    const loop = text.slice(loopStart, loopEnd);
    return /if \(\(l\.startsWith\('review:'\) \|\| l\.startsWith\('risk:'\)\)\) continue;/.test(loop);
  })());
// 反向锚：无裁决组跳过的旧循环（直接 `if (existing.has(l))` 起删）不得复活。
check('workflow-no-stale-barrier-cleanup-deletes-verdict',
  !/for \(const l of Object\.keys\(SYSTEM_LABELS\)\) \{\s*\n\s*if \(existing\.has\(l\)\) \{/.test(text));

// --- F5：无评级分支必须显式保留 needs-work（新形态）---
check('workflow-no-rating-preserves-needs-work-verdict',
  /No parseable rating; preserving an explicit review:needs-work verdict\./.test(text) &&
  (() => {
    const elseIdx = text.lastIndexOf('Neither bot produced a parseable rating');
    if (elseIdx !== -1) return false; // 旧"清空裁决"文案零残留
    const partialIdx = text.indexOf('Partial ratings or failed check');
    const noRateIdx = text.indexOf('No parseable rating; preserving');
    return partialIdx !== -1 && noRateIdx !== -1 && noRateIdx > partialIdx;
  })());
// 反向锚：旧"无评级即清空全部裁决"语义不得复活。
check('workflow-no-stale-no-rating-clears-verdict',
  !/Neither bot produced a parseable rating\. Clearing review labels\./.test(text));

// ================================================================
// 在途改动双锚（F1/F2/F5 之外的两处执行前已存在的加固，与本计划叠加）
// 这两处不在本计划 Replacement 集内，故此前无断言保护——补入防止被无红灯回退。
// ================================================================

// --- 在途 1：barrier 通过后、评级解析前，check run 状态门（新形态）——
// 正向：`targetRuns.some(run => run.status !== 'completed')` 在场，未完成的 run 阻塞评级段。
check('workflow-barrier-passed-check-run-status-gate',
  /if \(targetRuns\.some\(run => run\.status !== 'completed'\)\)/.test(text) &&
  text.includes('Some configured check runs are not completed'));
// 反向锚（区域切片式，非长正则）："barrier 通过"日志与"4. 解析与分值评定"节头之间必须存在
//   状态门；旧形态两段直接相邻（barrier 通过即解析）⇒ 区间内无状态门 ⇒ 红。
check('workflow-no-stale-barrier-passed-without-status-gate',
  (() => {
    const logIdx = text.indexOf('All configured bots');
    const sec4Idx = text.indexOf('4. 解析与分值评定');
    if (logIdx === -1 || sec4Idx === -1 || sec4Idx <= logIdx) return false;
    return /targetRuns\.some\(run => run\.status !== 'completed'\)/.test(text.slice(logIdx, sec4Idx));
  })());

// --- 在途 2：`skipped` check run 结论不算失败检查（新形态）——
// 正向：conclusion 条件显式排除 `skipped`；`skipped` 是"未跑"而非"跑挂"。
check('workflow-skipped-conclusion-not-failure',
  /run\.conclusion !== 'success' && run\.conclusion !== 'neutral' && run\.conclusion !== 'skipped'/.test(text));
// 反向锚：把 `skipped` 当失败的旧形态（三条件无排除）不得复活。
check('workflow-no-stale-skipped-as-failure',
  !/run\.conclusion !== 'success' && run\.conclusion !== 'neutral'\s*\n\s*\{/
    .test(text.slice(text.indexOf('let hasCheckFailure'), text.indexOf('// 4.2 提取 Pull Request'))));

// ================================================================
// 行为级 harness（F2 + 载体矩阵）：提取 workflow sync-labels 内联脚本并真实执行，
// mock github/context/core/process，断言标签 API 真实调用（不以文本位置为 Oracle）。
// 契约（Finding 1/3）：完成信号=已认证 bot 的 head-bound 可绑定载体；顶层 comment 仅唤醒。
// 期望值由契约推导，不以当前实现为 Oracle；gate-removal 变异必须被捕获（突变验证）。
// ================================================================
function extractSyncLabelsScript(y) {
  const lines = y.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (/^([ \t]*)script:[ \t]*\|[ \t]*$/.test(lines[i])) starts.push(i);
  if (starts.length === 0) throw new Error('未提取到内联 script 块');
  // YAML block scalar 语义：以最小内容缩进为公共前缀统一剥除（保留相对缩进，行尾空白无意义）。
  const s = starts[starts.length - 1];
  const keyIndent = lines[s].match(/^[ \t]*/)[0].length;
  const body = [];
  for (let s2 = s + 1; s2 < lines.length; s2++) {
    const l = lines[s2];
    if (l.trim() === '') { body.push(''); continue; }
    const ind = l.match(/^[ \t]*/)[0].length;
    if (ind <= keyIndent) break;
    body.push(l);
  }
  const nonEmpty = body.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return '';
  const common = Math.min(...nonEmpty.map((l) => l.match(/^ */)[0].length));
  return body.map((l) => (l.trim() === '' ? '' : l.slice(common))).join('\n');
}

// 从 sync-labels 内联脚本真实执行；mock github/context/process，记录标签 API 调用。
// 不复制谓词：完成/不完成完全由脚本在真实数据上的执行结果决定。
async function runWorkflow({ eventName, payload, env, headSha, reviews, checkRuns, issueLabels, repoLabels, scriptSrc }) {
  const labelsAdded = []; const labelsRemoved = []; const provisioned = [];
  const calls = { add: 0, remove: 0, create: 0, pullsGet: 0 };
  const logs = [];
  const repo = { owner: 'o', repo: 'r' };
  const revs = reviews || [];
  const runs = checkRuns || [];
  const github = {
    paginate: async (fn) => {
      const result = await fn();
      if (Array.isArray(result)) return result;
      const data = result?.data;
      if (Array.isArray(data)) return data;
      return data?.reviews || data?.check_runs || [];
    },
    rest: {
      pulls: {
        get: async () => { calls.pullsGet += 1; return { data: { head: { sha: headSha } } }; },
        listReviews: async () => ({ data: revs }),
      },
      checks: { listForRef: async () => ({ data: { check_runs: runs } }) },
      issues: {
        listLabelsForRepo: async () => ({ data: (repoLabels || []).map((n) => ({ name: n })) }),
        listLabelsOnIssue: async () => ({ data: (issueLabels || []).map((n) => ({ name: n })) }),
        addLabels: async (p) => { calls.add += 1; labelsAdded.push(p.labels); },
        removeLabel: async (p) => { calls.remove += 1; labelsRemoved.push(p.name); },
        createLabel: async (p) => { calls.create += 1; provisioned.push(p.name); },
      },
    },
  };
  const context = { eventName, payload: payload || {}, repo };
  const core = { setOutput: () => {} };
  const process = { env: env || {} };
  const consoleMock = { log: (...a) => logs.push(a.join(' ')) };
  const fn = new Function('context', 'github', 'core', 'process', 'console',
    'return (async () => {\n' + (scriptSrc || extractSyncLabelsScript(text)) + '\n})()');
  const err = await fn(context, github, core, process, consoleMock).then(() => null, (e) => e);
  return { calls, labelsAdded, labelsRemoved, provisioned, logs, err };
}

const COMMENTED = { commit_id: 'HEAD', state: 'COMMENTED', user: { type: 'Bot', login: 'kilo-code-bot[bot]' } };
const prPayload = (headSha) => ({ pull_request: { head: { sha: headSha } } });

// --- 完成判据矩阵：官方 bot 在当前 head 的 COMMENTED/APPROVED/CHANGES_REQUESTED review 均满足栅栏；
//     DISMISSED / 非当前 head / login 不匹配 / 作者缺失 / 无载体 一律不满足（顶层 comment 仅唤醒）。
async function barrierCase(opts) {
  const r = await runWorkflow({
    eventName: opts.eventName || 'issue_comment',
    payload: opts.payload || { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: opts.expectedBots || 'kilocode' },
    headSha: 'HEAD',
    reviews: opts.reviews || [],
    checkRuns: opts.checkRuns || [],
    issueLabels: opts.issueLabels || [],
    repoLabels: opts.repoLabels || ['ai-reviewed', 'risk:low', 'review:approved', 'review:needs-work'],
  });
  return r;
}
// 行为 harness 用非抛出记录器（区别于上方结构断言的抛出 check），以便逐格输出红/绿。
function record(name, ok, detail) {
  if (ok) console.log(`OK   ${name}${detail ? ' ' + detail : ''}`);
  else { behaviorFailures += 1; console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`); }
}

// 1. COMMENTED head-bound bot review → 满足栅栏（PR8 实测载体形态）→ 进入 verdict 写标签。
{
  const r = await barrierCase({ reviews: [COMMENTED] });
  record('workflow-completes-on-commented-head-review',
    r.err === null && r.calls.add > 0,
    r.err ? 'err=' + String((r.err && r.err.message) || r.err).split('\n')[0] : 'add=' + r.calls.add + ' logs=' + r.logs.join(' | '));
}
// 2. APPROVED / CHANGES_REQUESTED 仍满足（回归：旧终态仍合法）。
{
  const rA = await barrierCase({ reviews: [{ ...COMMENTED, state: 'APPROVED' }] });
  const rC = await barrierCase({ reviews: [{ ...COMMENTED, state: 'CHANGES_REQUESTED' }] });
  record('workflow-completes-on-approved-and-changes-requested',
    rA.calls.add > 0 && rC.calls.add > 0,
    'approved add=' + rA.calls.add + ' changes add=' + rC.calls.add);
}
// 3. DISMISSED 不满足；不误写。
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, state: 'DISMISSED' }] });
  record('workflow-dismissed-review-not-complete', r.err === null && r.calls.add === 0,
    'add=' + r.calls.add);
}
// 4. 非当前 head 的 review 不满足。
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, commit_id: 'OLD' }] });
  record('workflow-stale-head-review-not-complete', r.calls.add === 0, 'add=' + r.calls.add);
}
// 5. login 不匹配（type Bot 但非配置官方账号）不满足。
{
  const r = await barrierCase({ reviews: [{ ...COMMENTED, user: { type: 'Bot', login: 'evil-bot[bot]' } }] });
  record('workflow-unauthorized-login-review-not-complete', r.calls.add === 0, 'add=' + r.calls.add);
}
// 6. 作者缺失（无 user）不满足。
{
  const r = await barrierCase({ reviews: [{ commit_id: 'HEAD', state: 'COMMENTED' }] });
  record('workflow-missing-author-review-not-complete', r.calls.add === 0, 'add=' + r.calls.add);
}
// 7. 顶层 comment 唤醒本身不构成完成信号：仅评论（无 head review、无 check run）→ 不完成。
{
  const r = await barrierCase({ eventName: 'issue_comment', payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } }, reviews: [], checkRuns: [] });
  const hasDiag = r.logs.some((l) => l.includes('No bindable carrier this round for:'));
  record('workflow-unbound-comment-not-completion-evidence', r.calls.add === 0 && hasDiag,
    'add=' + r.calls.add + ' diag=' + hasDiag);
}
// 8. 无载体 → 等待 + 显式诊断（非静默死等）。
{
  const r = await barrierCase({ reviews: [], checkRuns: [] });
  const hasDiag = r.logs.some((l) => l.includes('No bindable carrier this round for:'));
  record('workflow-no-carrier-waits-with-diagnostic', r.err === null && r.calls.add === 0 && hasDiag,
    'add=' + r.calls.add + ' diag=' + hasDiag);
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
// 11. 受信 bot 顶层评论唤醒（type=Bot + 派生登录名命中）→ 不早退，进入求值。
{
  const r = await runWorkflow({
    eventName: 'issue_comment',
    payload: { comment: { user: { type: 'Bot', login: 'kilo-code-bot[bot]' } } },
    env: { PR_NUMBER: '8', EXPECTED_BOTS: 'kilocode' },
    headSha: 'HEAD', reviews: [COMMENTED], checkRuns: [],
  });
  record('workflow-trusted-bot-comment-wake-proceeds', r.err === null && r.calls.pullsGet > 0 && r.calls.add > 0,
    'pullsGet=' + r.calls.pullsGet + ' add=' + r.calls.add);
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
//     合法终态=barrier 等待分支——清理非裁决 stale 标签 + 载体缺失诊断，verdict 标签不落地。
{
  const r = await barrierCase({
    expectedBots: 'coderabbit,kilocode',
    reviews: [COMMENTED],
    issueLabels: ['ai-reviewed', 'review:approved'],
  });
  const diagNames = r.logs.some((l) => l.includes('No bindable carrier this round for: coderabbit'));
  record('workflow-pr8-coderabbit-absent-waits-no-verdict',
    r.err === null && r.calls.add === 0
      && r.labelsRemoved.includes('ai-reviewed')
      && !r.labelsRemoved.includes('review:approved')
      && diagNames,
    'add=' + r.calls.add + ' removed=' + JSON.stringify(r.labelsRemoved) + ' diag=' + diagNames);
}

// --- 突变验证：删除 actor 门后 harness 必须捕获（证明夹具对 gate-removal 敏感，非文本断言）---
{
  // 从提取文本中移除 pull_request_review actor 门（F2 门）的整块条件（gate-removal 变异）。
  const actorGate = "if (context.eventName === 'pull_request_review' && context.payload.review?.user?.type !== 'Bot')";
  if (!text.includes(actorGate)) { check('workflow-actor-gate-present-for-mutation', false, 'actor gate 未在场'); }
  else {
    // 突变体：actor 门条件恒假（等价于删除门）。human actor 事件将不再早退，深入求值并写标签。
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
    // 契约（突变验证）：human actor 在 actor 门被移除后，脚本不再早退——它会把 human 当作合法
    //   actor 继续求值并在有载体时写标签；这正是该门必须存在的反证。若夹具对 mutation 不敏感
    //   （add 仍为 0），则 harness 失效（假绿风险）。
    record('workflow-harness-catches-actor-gate-removal',
      r.err === null && r.calls.add > 0,
      'add=' + r.calls.add + ' err=' + (r.err ? String(r.err.message).split('\n')[0] : 'null'));
  }
}

console.log(behaviorFailures === 0 ? 'BOT-LABELER-SELFTEST ALL OK' : 'BOT-LABELER-SELFTEST FAILURES=' + behaviorFailures);
process.exit(behaviorFailures === 0 ? 0 : 1);
