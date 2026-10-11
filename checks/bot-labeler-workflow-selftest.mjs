import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github', 'workflows', 'bot-review-labeler.yml');
const text = fs.readFileSync(workflowPath, 'utf8');

function check(name, ok, detail = '') {
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`OK   ${name}`);
}

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

// --- 栅栏：存在按 currentHeadSha 过滤的 head 评审集合（R4）---
// 注意：listReviews 分页调用跨多行，用 dotall 旗标让 `.` 跨行匹配。
check('workflow-barrier-collects-head-reviews',
  /const headReviews = [\s\S]*?\.filter\(r => r\.commit_id === currentHeadSha\)/.test(text));

// --- 栅栏：完成判据基于官方 bot 在当前 head 的 authenticated review 存在性（R4）---
check('workflow-barrier-requires-head-review-presence',
  text.includes('r.user?.type') &&
  /r\.user\?\.type === 'Bot' \&\& \(def\.logins \|\| \[\]\)\.includes\(r\.user\.login\)/.test(text) &&
  /hasHeadReview\s*=\s*headReviews\.some\(/.test(text));

// --- 栅栏：旧口径死等不再残留——等待日志不得再以 "check run has not appeared" 兜底 ---
// 断言：文本中不得再出现旧 "check run has not appeared yet" 死等措辞（已被 review 判据取代）。
check('workflow-barrier-no-stale-checkrun-wait',
  !text.includes("check run has not appeared yet"));

// --- 身份闸 fail-closed：app.id 缺失必须排除（R5，不得退回 slug-only）---
// 断言：check-run 身份闸使用 "typeof r.app?.id !== 'number'" 的 fail-closed 形态，
// 而非旧的 "typeof r.app?.id === 'number' && r.app.id !== def.appId" 退回形态。
check('workflow-checkrun-identity-fail-closed',
  /if \(typeof r\.app\?\.id !== 'number' \|\| r\.app\.id !== def\.appId\) return false;/.test(text));
// 反向锚：旧的退回形态必须已从文件中消失。
check('workflow-no-stale-appid-slug-fallback',
  !text.includes("if (typeof r.app?.id === 'number' && r.app.id !== def.appId) return false;"));

// --- github-script 固定 Node-24 兼容 SHA（runtime-warning 处理）---
check('workflow-github-script-node24-sha',
  /actions\/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3/.test(text));
// 反向锚：旧的 v7 标签不得残留。
check('workflow-no-stale-github-script-v7',
  !text.includes('actions/github-script@v7'));

// --- 4.3 本轮边界主源（本轮事实纠偏）：官方 bot 在当前 head 的最新 review submitted_at
// ---   为主边界；CodeRabbit 无 check run 也必须能归因本轮，否则其 Walkthrough 摘要
// ---   永远被跳过（评论域契约）。旧口径的 started_at 仅作兜底。
check('workflow-round-boundary-uses-head-review-submitted-at',
  /headReviewForBot = headReviews\.filter\(/.test(text) &&
  /latestHeadReview\.submitted_at/.test(text) &&
  /if \(!timeStr\) \{/.test(text));

console.log('BOT-LABELER-SELFTEST ALL OK');
