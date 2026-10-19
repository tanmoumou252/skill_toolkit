// bot-review-labeler.mjs —— 承接 bot-review-labeler.yml 两段 actions/github-script 的全部业务逻辑（CI 引擎解耦）。
//   resolvePr(deps)：原 resolve-pr job 的 PR 编号解析脚本；由 `run: node …/bot-review-labeler.mjs resolve-pr` 子命令调用。
//   run(deps)：原 sync-labels job 的标签判定/打分/渲染脚本；由 `run: node …/bot-review-labeler.mjs` 调用。
//   deps = { context, github, core, process, console } —— 与 actions/github-script 注入面同形，
//   harness 注入 mock 可逐字复用既有夹具；CLI 入口（脱离引擎本地运行）经 gh-client + env 自装配 deps。
// 零依赖：仅 Node 内置 + ./gh-client.mjs。API base 经 GITHUB_API_URL 覆写，Bearer=GITHUB_TOKEN。
// TOCTOU：assertCurrentHead() 三处托管标签写/删前均为真实 pulls.get head 复核（安全不变量，契约 C）。
import { readFileSync, appendFileSync } from 'node:fs';
import { createGitHubClient } from './gh-client.mjs';

export async function run(deps) {
  const { context, github, core, process, console } = deps;
// ========================================================
// 0. 解析关联 PR 编号 (安全兼容 Fork PR 及空数组场景)
// ========================================================
const checkRun = context.payload.check_run;
const prNumber = Number(process.env.PR_NUMBER);
// Comment-wake 事件（基仓库受信 issue_comment）不携带 PR head sha：其作用仅为
//   在受信任的基仓库上下文（写 token 不被 clamp 为只读）里重新求值当前轮次，
//   弥补 fork PR 的 pull_request_review 触发器运行于非受信 merge commit、
//   GITHUB_TOKEN 被强制只读而无法写标签的缺口。绑定发生在 2. 轮次校验取得
//   currentHeadSha 之后；栅栏仍以 head-matching authenticated review 为完成判据，
//   评论唤醒无法绕过评审证据。唤醒限官方 Bot 作者，阻断任意人类评论触发写标签。
// 官方 Bot 登录名单一事实源：从 BOT_DEFINITIONS 派生（唯一登记处，不再硬编码）。
// 定义须在评论唤醒门之前（const 不提升，重复定义/ TDZ 约束）。
// logins = 官方 GitHub App 机器人账号（type 恒为 Bot）的逐字登录名，为 4.2/4.3
// 审查/评论文本采集的精确身份闸；pattern 仅用于 check run 维度的名称匹配。
// appId = 官方 App 的公开数字标识，故意硬编码为常量：它是防伪闸（同名伪造 Check Run
// 按 app.id 不符一律排除）的校验锚。改存仓库变量会引入可被篡改的注入点，反而削弱
// 防伪；App ID 本身是公开信息，无保密需求。若某 bot 更换 App 注册，需同步更新此
// 字面量并在变更记录中登记。
const BOT_DEFINITIONS = {
  'coderabbit': { pattern: /coderabbit/i, logins: ['coderabbitai[bot]'], appId: 347564, required: false },
  'kilocode': { pattern: /kilo[-_\s]?code|^kilo$/i, logins: ['kilo-code-bot[bot]'], appId: 2193792, required: true }
};
const CODERABBIT_MAX_FILES = Number(process.env.CODERABBIT_MAX_FILES || '100');
const CODERABBIT_MIN_STARS = Number(process.env.CODERABBIT_MIN_STARS || '10');
const STATUS_COMMENT_MARKER = '<!-- bot-review-labeler:status -->';
const isCommentWake = context.eventName === 'issue_comment';
const trustedCommentLogins = new Set(Object.values(BOT_DEFINITIONS).flatMap(d => d.logins || []));
// 空/缺 logins 定义 fail-closed：派生集合不含该 login（不放行未知 actor）。
// 内联评论编辑事件也投递为 issue_comment（实测 run #101）：评分管道只吃顶层
// marker 评论（4.3），内联正文永不入评——此类事件对重评无输入贡献，直接退出。
if (isCommentWake &&
    (context.payload.comment?.user?.type !== 'Bot' ||
     !trustedCommentLogins.has(context.payload.comment?.user?.login) ||
     context.payload.comment?.pull_request_url != null)) {
  console.log('[PR Check] Untrusted comment author; skipping trusted-writer wake.');
  return;
}
if (context.eventName === 'pull_request_review' && context.payload.review?.user?.type !== 'Bot') {
  console.log('[PR Check] Non-bot review actor; skipping label sync.');
  return;
}
let eventHeadSha = (context.eventName === 'pull_request_target' ||
  context.eventName === 'pull_request_review')
  ? context.payload.pull_request?.head?.sha
  : checkRun?.head_sha;
if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || (!isCommentWake && !eventHeadSha)) {
  console.log('[PR Check] Missing PR number or event head; skipping label sync.');
  return;
}

// ========================================================
// 1. 规范化标签体系定义 (IaC：带 HEX 颜色和描述说明)
// ========================================================
const SYSTEM_LABELS = {
  'ai-reviewed': {
    color: 'cfd3d7', // 浅灰色
    description: '当前轮次已通过 AI Code Review 综合审查'
  },
  'risk:critical': {
    color: 'b60205', // 刺眼深红
    description: '阻塞合并: CodeRabbit [Blocked] 或 Kilo [Critical/Blocker]'
  },
  'risk:high': {
    color: 'd93f0b', // 橙红
    description: '高风险: CodeRabbit [Risky] 或 Kilo [Major/High]'
  },
  'risk:medium': {
    color: 'fbca04', // 警示黄
    description: '中度风险: CodeRabbit [Caution] 或 Kilo [Warning/Medium]'
  },
  'risk:low': {
    color: '0e8a16', // 安全绿
    description: '低风险: CodeRabbit [Ready] 且无严重安全隐患'
  },
  'review:pending': {
    color: 'fbca04',
    description: '审查等待中：必需 Bot 尚未完成或存在进行中的审查'
  },
  'review:unavailable': {
    color: 'cfd3d7',
    description: '本轮没有可用的 AI 审查来源'
  },
  'review:needs-work': {
    color: 'e99695', // 浅粉红
    description: '审查未通过，存在需修改的问题 (Changes Requested)'
  },
  'review:approved': {
    color: '2cbe4e', // 鲜绿
    description: '所有必需审查 Bot 均已核准通过'
  }
};

// 自动确保标签在仓库中存在且颜色、描述一致 (含分页与 422 容错)
async function ensureLabelsProvisioned() {
  const existingRepoLabels = await github.paginate(github.rest.issues.listLabelsForRepo, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    per_page: 100
  });
  const map = new Map(existingRepoLabels.map(l => [l.name, l]));

  for (const [name, meta] of Object.entries(SYSTEM_LABELS)) {
    if (!map.has(name)) {
      console.log(`[Provision] Creating label: ${name}`);
      try {
        await github.rest.issues.createLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          name,
          color: meta.color,
          description: meta.description
        });
      } catch (err) {
        if (err.status !== 422) throw err; // 忽略并发竞争导致的已存在异常
      }
    }
  }
}

// ========================================================
// 2. 轮次校验 (严格对比 PR head.sha，避免过期提交抢占打标)
// ========================================================
const { data: prData } = await github.rest.pulls.get({
  owner: context.repo.owner,
  repo: context.repo.repo,
  pull_number: prNumber
});
const currentHeadSha = prData.head.sha;

if (!eventHeadSha || eventHeadSha !== currentHeadSha) {
  // Comment-wake 事件本身不带 head：绑定到刚取得的 currentHeadSha 后按普通事件继续。
  if (isCommentWake && !eventHeadSha) {
    eventHeadSha = currentHeadSha;
  } else {
    console.log(`[Round Guard] Triggered by stale or missing commit (${eventHeadSha || 'missing'}). Current Head is ${currentHeadSha}. Skipping.`);
    return;
  }
}

// 轮次下界（4.3 顶层评论消费的可用性判定）：不使用 head commit 的 committer/author
//   date——那是 PR 作者完全可控的伪造元数据（git 允许设定任意提交者日期），不足以充当
//   "本轮开始"的可信下界。REST 亦无可信替代：issue events/timeline 无 synchronize
//   事件，committed 事件只携带提交者元数据、无服务器 created_at。因此不设 per-head
//   轮次下界；顶层 issue 评论（无 commit_id 绑定、无法归属 head）一律 fail-closed
//   不消费（见 4.3），评级只采信 head 绑定且身份鉴权的 review 正文与 check run output。

// ========================================================
// 2.1 head 复核原语（const 箭头函数不提升，定义须早于全部调用点）
// ========================================================
// 每次托管标签写操作（barrier 清理、旧标清洗、追加标签）前复核当前 PR
// head 与触发事件 head 一致：旧 head 触发的 job 不得在新 head 生效期间
// 删除或写入任何托管标签。
const assertCurrentHead = async () => {
  const { data: latestPr } = await github.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber
  });
  if (latestPr.head.sha !== eventHeadSha) {
    console.log(`[Round Guard] Head changed before label write (${eventHeadSha} -> ${latestPr.head.sha}). Skipping.`);
    return false;
  }
  return true;
};

// Action 自持状态评论只读取定位，不进入任何评分管道；Bot 作者与 marker 双闸防止
// 修改/覆盖用户评论。每次写评论前同样复核 head，避免旧轮次状态覆盖新轮次。
// §0 定版形态（人类 2026-10-14T07:19Z 定版，唯一事实源）：方案3表格 + 证据链接 +
// auto-fill 进度表 + 统一 flat 两段式徽章 + octicon 图标 + emoji 零使用。
// 安全面结论（影子计划 E-1/E-3/E-4/E-5 闭环）：定位前置 + 单一 selfUrl 源；
// 内联采集 评论自身 commit_id 本轮边界闸 + trustedLogins 身份闸；采集失败落降级提示行
// （仅展示面，不阻塞标签主链路）；BOT-METADATA JSON \u003c/\u003e 全转义防 HTML 注释早终止。
// bot key 与 state 枚举保持英文机读（既有断言锚与机读契约）；评分管道零消费。
const BOT_STATE_META = {
  absent:       { label: '缺席',            badge: '状态-缺席-8c959f',          note: '本轮无载体' },
  file_limit:   { label: '跳过审查',         badge: '状态-跳过审查-8c959f',      note: '文件数超限跳过审查' },
  in_progress:  { label: '审查中',           badge: '状态-审查中-d97706',        note: '审查进行中' },
  completed:    { label: '审查完成',         badge: '状态-审查完成-2da44e',      note: '' },
  failed:       { label: '审查失败',         badge: '状态-审查失败-crimson',     note: '审查失败，需人工复核' },
  manual_required: { label: '需人工触发',    badge: '状态-需人工触发-d97706',    note: '需人工触发审查' },
};
const BOT_RISK_LABELS = { 4: '风险评级-高-d93f0b', 3: '风险评级-中-d97706', 2: '风险评级-中-d97706', 1: '风险评级-低-2da44e' };
// 结论徽章整排退役（人类裁决 2026-10-18）：跨 bot 汇总唯一事实源＝PR 标签
//   （review:approved/needs-work/pending/unavailable），逐 bot 明细唯一事实源＝表格列；
//   旧结论徽章常量（唯一消费点即被删的结论徽章段）随之删除。
const AUTOFILL_META = {
  synced: { badge: '已更新-teal', note: (sha) => `对齐 head \`${sha}\`` },
  stale:  { badge: '已生成_但head过期-purp', note: () => '下次 synchronize 自动重填' },
  absent: { badge: '未生成-blueviolet', note: () => '等待首轮触发' },
};
// 资产文件名登记表（与 checks/build-status-badges.mjs 产物冻结镜像；缺名即抛错防裂图）。
const BADGE_FILES = new Set([
  '状态-缺席-8c959f-flat.svg', '状态-跳过审查-8c959f-flat.svg', '状态-审查中-d97706-flat.svg',
  '状态-审查完成-2da44e-flat.svg', '状态-审查失败-crimson-flat.svg', '状态-需人工触发-d97706-flat.svg',
  '风险评级-高-d93f0b-flat.svg', '风险评级-中-d97706-flat.svg', '风险评级-低-2da44e-flat.svg',
  '已更新-teal-flat.svg', '已生成_但head过期-purp-flat.svg', '未生成-blueviolet-flat.svg', '失败-crimson-flat.svg',
]);
// 徽章/图标资产本仓固化（外链零依赖）：静态枚举集一次性生成入库（checks/build-status-badges.mjs，
//   产物冻结），引用走本仓 raw URL；静态文件内容永不变（改内容=换文件名），分支 URL 的
//   Camo 强缓存对静态集无害；HEAD 徽章不落库，改走 shields 动态外链（URL 内嵌 short sha）。
// OCTICON/BADGE 外链工厂已移除；缺映射即抛错（防静默裂图）：新增枚举必须连资产一起补。
const BADGE_BASE = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/raw/${context.payload.repository?.default_branch || 'main'}/.github/assets/badges`;
const ICON = (name, size) => `<img src="${BADGE_BASE}/icon-${name}.svg" width="${size}" height="${size}" valign="middle">`;
const BADGE = (label, style, height) => {
  const known = BADGE_FILES.has(`${label}-${style}.svg`);
  if (!known) throw new Error(`[Status Comment] unknown badge asset for "${label}" (${style}) — add it via checks/build-status-badges.mjs first`);
  return `<img src="${BADGE_BASE}/${label}-${style}.svg"${height ? ` height="${height}"` : ''} valign="middle">`;
};
const AVATAR = (appId) => Number.isInteger(appId) && appId > 0
  ? `<img src="https://avatars.githubusercontent.com/in/${appId}?s=80&v=4" width="18" height="18" valign="middle">`
  : `<img src="https://avatars.githubusercontent.com/u/0?s=80&v=4" width="18" height="18" valign="middle">`;
// E4 单源：头像 appId 从 BOT_DEFINITIONS.appId 派生，禁止双写漂移；未登记 appId 的 bot 落无名头像占位。
const BOT_AVATARS = Object.fromEntries(Object.entries(BOT_DEFINITIONS)
  .filter(([, d]) => Number.isInteger(d.appId) && d.appId > 0)
  .map(([k, d]) => [k, d.appId]));
async function writeStatusComment(botStatuses, verdict, riskScore = null, perBotRatings = {}) {
  // 定位前置（E-1 闭环）：ownComment 单一 selfUrl 事实源，组装前完成。定位失败（仅 transient，
  //   issues:write 已含读面故无 403 面）降级为本轮跳过状态评论：绝不 duplicate marker 评论、
  //   绝不崩溃已落标签的主链路，下次事件重试自愈。
  let comments;
  try {
    comments = await github.paginate(github.rest.issues.listComments, {
      owner: context.repo.owner, repo: context.repo.repo, issue_number: prNumber, per_page: 100
    });
  } catch (err) {
    console.log(`[Status Comment] Own-comment lookup failed (skip this round, heal on next event): ${err?.status || err?.message || err}`);
    return;
  }
  const ownComment = comments.find(comment =>
    comment.body?.includes(STATUS_COMMENT_MARKER) &&
    comment.user?.type === 'Bot' &&
    comment.user?.login === 'github-actions[bot]');
  const selfUrl = ownComment?.html_url || null;
  const repoUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}`;
  const shortSha = currentHeadSha.slice(0, 7);
  // bot 执行结果证据链接（§0 逐项 6，review-finding 修订）：证据必须可归属本轮——
  // 只取「当前 head 已认证 review」（commit_id=currentHeadSha + type=Bot + login 逐字闸，
  // 与 4.2 评分采集同一身份/边界语义）的 html_url；无 head review 且 evidence 为
  // authenticated_check_run 时回退该 bot 最新 completed check run 的 html_url；
  // 其余一律 null（不包 <a> 纯图）。不再从历史顶层评论取链接——顶层评论无 commit_id
  // 绑定、无法归属本轮 head（与 4.3 fail-closed 立场一致）。
  const evidenceUrl = {};
  for (const [key, def] of Object.entries(BOT_DEFINITIONS)) {
    const headReviewHit = headReviews.find(r => r.commit_id === currentHeadSha &&
      r.user?.type === 'Bot' && (def.logins || []).includes(r.user.login) && r.html_url);
    if (headReviewHit) { evidenceUrl[key] = headReviewHit.html_url; continue; }
    evidenceUrl[key] = botStatuses[key]?.evidence === 'authenticated_check_run'
      ? (botStatuses[key]?.checkRunUrl || null)
      : null;
  }
  // 内联评论采集（仅展示面，E-4 闭环）：pulls.listComments；抛错降级为提示行，
  // 绝不上抛、绝不阻塞标签主链路；本轮边界闸 评论自身 commit_id + 身份闸 trustedLogins（E-3 闭环）。
  let inlineComments = null;
  try {
    inlineComments = await github.paginate(github.rest.pulls.listComments, {
      owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber, per_page: 100
    });
  } catch (err) {
    console.log(`[Status Comment] Inline comments fetch failed (display-only, non-blocking): ${err?.status || err?.message || err}`);
  }
  const fetchCommands = [];
  let matchedInline = [];
  let inlineSeverities = new Map();
  if (!Array.isArray(inlineComments)) {
    // 降级提示行（E-4）：采集失败必须对人类可见，区别于"本轮无内联"。
  } else {
    const trustedLogins = new Set(Object.values(BOT_DEFINITIONS).flatMap(d => d.logins || []));
    // 契约 4（PR#21 实测根因修正）：轮次归属键＝评论 pull_request_review_id ∈ headReviewIds
    //   （review 级 commit_id 稳定就绪；评论级 commit_id 由 GitHub 异步重锚，run 39131456470
    //   实测 filtered(commit_id=1) 恒挡命中）。review id 创建即写死、不可变 → 免疫重锚竞态，
    //   且天然排除上一轮评论（不同 review id 不进本轮 headReviewIds）。身份闸 trustedLogins 保留。
    const headReviewIds = new Set(headReviews
      .filter(r => r.user?.type === 'Bot' && trustedLogins.has(r.user?.login))
      .map(r => r.id));
    const filterMiss = { rid: 0, identity: 0 };
    for (const c of inlineComments) {
      const rid = c?.pull_request_review_id;
      if (typeof rid !== 'number' || !headReviewIds.has(rid)) { filterMiss.rid += 1; continue; }
      if (c.user?.type !== 'Bot' || !trustedLogins.has(c.user?.login)) { filterMiss.identity += 1; continue; }
      matchedInline.push(c);
    }
    console.log(`[Status Comment] matchedInline: fetched=${inlineComments.length} matchedInline=${matchedInline.length} filtered(rid=${filterMiss.rid}, identity=${filterMiss.identity})`);
    // 逐条命令（契约 4 人类裁决）：每条命中评论单独一行，按 created_at 升序（原创建顺序）；
    //   id 来自 API 整数响应、经 Number.isSafeInteger 校验后拼入（非评论 body 可控面，零注入）；
    //   命令形态不含 $/反引号（受控通道结构闸兼容），--jq 过滤段只含单引号字面量。
    const severityOf = (bodyText) => {
      const m = /Blocker|Major|Minor|Suggestion/i.exec(String(bodyText || ''));
      return m ? m[0] : null;
    };
    matchedInline.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    // severity 单次提取（计数头与逐行注释同口径，禁第二套锚定正则——E3 教训：
    //   行首锚定会对真实 markdown body（severity 词非行首）系统性低估）。
    const severities = new Map(matchedInline.map(c => [c, severityOf(c.body)]));
    inlineSeverities = severities;
    for (const c of matchedInline) {
      if (!Number.isSafeInteger(c.id) || c.id <= 0) continue;
      const sev = severities.get(c);
      // path 净化（预 PR 审查回灌·注入面）：c.path 是不可信 API 数据——换行可突破
      //   `# ` 行注释与 ```bash 围栏（围栏提前闭合 + 伪命令落围栏外），反引号可破坏
      //   Markdown 代码围栏语义。故强制 String() 后剥离 \r\n 与反引号再拼入注释段；
      //   c.line 仅经安全整数校验后才使用（NaN/对象/超安全整数一律留空，退化不注入）。
      const safePath = String(c.path == null ? '' : c.path).replace(/[\r\n`]/g, '');
      const safeLine = Number.isSafeInteger(c.line) ? c.line : '';
      const pathLine = `${safePath}:${safeLine}`;
      const commentMark = sev ? ` · ${sev}` : '';
      fetchCommands.push(`gh api repos/${context.repo.owner}/${context.repo.repo}/pulls/comments/${c.id} --jq '{path, line, body}'   # ${pathLine}${commentMark}`);
    }
    // 真·兜底（降级面，非主路径）：采集成功但零命中 → login 白名单全量命令（白名单在 jq 内，
    //   防退化全量无过滤）；兜底命令输出 id/pull_request_review_id 供人工归属复核。
    if (fetchCommands.length === 0) {
      const loginJq = [...trustedLogins].map(l => `.user.login == "${l}"`).join(' or ');
      fetchCommands.push(`gh api "repos/${context.repo.owner}/${context.repo.repo}/pulls/${prNumber}/comments?per_page=100" --paginate --jq '.[] | select(${loginJq}) | {id, pull_request_review_id, path, line, body}'`);
    }
  }
  // auto-fill 三态解析（§0.1，review-finding 修订）：body 里的 sentinel 标记是
  //   PR 作者可控数据（head sha 可在推送前预写伪造），故标记只是必要条件——
  //   'synced' 必须由可信源证实：auto-fill 工作流在本 head sha 上存在成功运行
  //   （actions API，服务器权威，仅当标记 sha 与当前 head 一致时才发起这一次查询）。
  //   无标记 → absent；标记 sha 过期，或 sha 一致但无可信成功运行 → stale
  //   （展示语义：已生成但未确认对齐，附注"下次 synchronize 自动重填"仍成立）。
  //   E1 双保险保留：matchAll 取末次标记，跨轮遗留多标记时不取最旧。
  const prBodyText = String(prData.body || '');
  const syncMatches = [...prBodyText.matchAll(/<!-- auto-fill-pr: synced head=([0-9a-f]{40}) -->/g)];
  const lastSyncMatch = syncMatches.length > 0 ? syncMatches[syncMatches.length - 1] : null;
  let autofillState = 'absent';
  if (lastSyncMatch) {
    if (lastSyncMatch[1] !== currentHeadSha) {
      autofillState = 'stale';
    } else {
      let corroborated = false;
      try {
        // 佐证终局契约（review-finding 第三轮收敛）：auto-fill 在其处理的 head commit 上
        //   落 commit status（context=auto-fill-pr, state=success，SHA 键不可伪造）。
        //   labeler 佐证 = ①currentHeadSha 上存在该 status；②按 status.target_url 解出
        //   运行 ID 回查 actions.getWorkflowRun 权威记录，核对该运行实际处理的 PR 编号
        //   与 PR head SHA（run.pull_requests[].number / .head.sha，均不可变）——
        //   两个不可变值与当前轮一致才 synced。不再做任何"从 run 元数据推断处理对象"
        //   的间接推断（branch 名/关联查询均退役）。
        const { data: statuses } = await github.rest.repos.listCommitStatusesForRef({
          owner: context.repo.owner, repo: context.repo.repo, ref: currentHeadSha, per_page: 100
        });
        const autofillStatus = (statuses || []).find(s => s.context === 'auto-fill-pr' && s.state === 'success');
        if (autofillStatus) {
          const runIdMatch = /\/actions\/runs\/(\d+)/.exec(autofillStatus.target_url || '');
          if (runIdMatch) {
            const { data: run } = await github.rest.actions.getWorkflowRun({
              owner: context.repo.owner, repo: context.repo.repo, run_id: Number(runIdMatch[1]),
            });
            // run 本体身份核验（review-finding 契约）：path 对应 auto-fill 工作流、
            //   event 为 pull_request_target、conclusion 为 success——三者确立"这条
            //   权威记录确实是本轮要找的那次成功 auto-fill"。path 按 @ 拆分后仅校验
            //   工作流文件部分（Actions API 以 path@ref 形态返回触发分支的运行记录，
            //   整字段严格相等会把合法带 ref 记录误判为异己；ref 段须非空，fail-closed）。
            // head 关联校验：仅采信 pull_requests[] 提供的可核验身份证据——
            //   pr.number === prNumber 且 pr.head.sha === currentHeadSha（二者均不可变，
            //   rebase/force-push 后该字段是快照）。分支名不是 PR 身份（同一分支可被
            //   多个 PR 引用、分支可重命名/复用），不作为关联推断源；pull_requests 为空
            //   或无可信记录匹配时无可核验关联证据，fail-closed 保持 stale。
            const runPath = String(run?.path || '');
            const atIdx = runPath.indexOf('@');
            const runWorkflowFile = atIdx === -1 ? runPath : runPath.slice(0, atIdx);
            const runIsAutofill = run && runWorkflowFile === '.github/workflows/auto-fill-pr.yml' &&
              (atIdx === -1 || runPath.slice(atIdx + 1).length > 0) &&
              run.event === 'pull_request_target' && run.conclusion === 'success';
            const headLinked = Array.isArray(run?.pull_requests) &&
              run.pull_requests.some(pr => pr.number === prNumber && pr.head && pr.head.sha === currentHeadSha);
            corroborated = Boolean(runIsAutofill && headLinked);
          } else {
            // 无 run 标识的 status（老记录/手写）不可核验 → fail-closed 不佐证。
            console.log('[Status Comment] auto-fill status lacks run id — not corroborated.');
          }
        }
      } catch (err) {
        console.log(`[Status Comment] auto-fill run lookup failed (display-only): ${err?.status || err?.message || err}`);
      }
      autofillState = corroborated ? 'synced' : 'stale';
    }
  }
  const autofillNote = AUTOFILL_META[autofillState].note(autofillState === 'synced' ? shortSha : '');
  const badgeWrap = (url, img) => url ? `<a href="${url}">${img}</a>` : img;
  // HEAD 徽章走 shields 动态外链：URL 内嵌本轮 short sha 天然唯一（免缓存），不落库、
  //   不写仓库文件（本工作流因此无需 contents 写权）；展示与降级同形，绝不阻塞标签主链路。
  const headBadgeImg = `<img src="https://img.shields.io/badge/HEAD-${shortSha}-0969da?style=flat" height="18" valign="middle">`;
  // 关联小节（定版契约）：timeline 反查本 PR 的关联 issue/PR——cross-referenced 事件
  //   source 指向本 PR 或 connected 事件 subject 指向本 PR；按 source/subject.issue 是否带
  //   pull_request 字段分 PR/Issue 归类。渲染＝编号逐行裸写 + 尾随空格（GitHub autolink
  //   驱动形态，实测 PR#18 评论 `#16 \n#19 ` 验证），零 Markdown 链接零徽章；单向缺省整块
  //   不写、全无整节省略、反查失败整节省略（展示面降级，绝不阻塞打标主链路）。
  let linkedPrs = []; let linkedIssues = [];
  try {
    // listEventsForTimeline（GET /issues/{n}/timeline）而非 listEvents（/events）：
    //   cross-referenced/connected 事件只出现在 timeline 端点，/events 永远查不到
    //   （octokit 官方端点名，review 契约；selftest 桩面同名对齐）。
    const linkedEvents = await github.paginate(github.rest.issues.listEventsForTimeline, { owner: context.repo.owner, repo: context.repo.repo, issue_number: prNumber });
    const prSet = new Set(); const issueSet = new Set();
    for (const e of linkedEvents || []) {
      const src = e?.event === 'cross-referenced' ? e.source?.issue
        : (e?.event === 'connected' ? e.subject : null);
      const n = Number(src?.number);
      if (!Number.isInteger(n) || n === prNumber) continue;
      // 双保险类型闸：events API 的 source/subject 精简形态可能不带 pull_request 字段
      //   （GraphQL 必带、REST 不保证），逐编号 GET /issues/N 复验——带 pull_request
      //   字段即实为 PR；复验失败按 events 面判定兜底（降级不误删）。
      let isPr = Boolean(src.pull_request);
      if (!isPr) {
        try {
          const it = await github.rest.issues.get({ owner: context.repo.owner, repo: context.repo.repo, issue_number: n });
          isPr = Boolean(it?.data?.pull_request);
        } catch { /* 复验不可达 → 沿用 events 面判定 */ }
      }
      if (isPr) prSet.add(n); else issueSet.add(n);
    }
    linkedPrs = [...prSet].sort((a, b) => a - b);
    linkedIssues = [...issueSet].sort((a, b) => a - b);
  } catch (err) {
    linkedPrs = []; linkedIssues = [];
    console.log(`[Status Comment] Linked items fetch failed (display-only, section omitted): ${err?.status || err?.message || err}`);
  }
  const renderBody = (url) => {
    const lines = [
      STATUS_COMMENT_MARKER,
      `### ${ICON('git-pull-request', 16)} PR 审查状态 <a href="${repoUrl}/pull/${prNumber}/commits/${currentHeadSha}">${headBadgeImg}</a>`,
      '',
      '| 审查节点 | 执行结果 | 风险量化 | 附注 |',
      '| :--- | :--- | :--- | :--- |',
    ];
    for (const [key, status] of Object.entries(botStatuses)) {
      const meta = BOT_STATE_META[status.state] || { label: status.state, badge: `状态-${status.state}-8c959f`, note: '' };
      const resultBadge = BADGE(meta.badge, 'flat', 18);
      const linked = evidenceUrl[key] ? badgeWrap(evidenceUrl[key], resultBadge) : resultBadge;
      // 风险量化列逐 bot（契约 2 人类裁决）：各 bot 显示自身评级徽章；未评级时
      //   absent/file_limit/manual_required（本轮确定无评级载体）→ N/A，其余未评级态 → —。
      //   全局 riskScore 不再连坐每行（PR#21 缺陷：所有行同显全局汇总分）。
      const botRating = perBotRatings[key] !== undefined ? perBotRatings[key] : null;
      const riskCell = botRating !== null && BOT_RISK_LABELS[botRating]
        ? BADGE(BOT_RISK_LABELS[botRating], 'flat', 18)
        : (['absent', 'file_limit', 'manual_required'].includes(status.state) ? 'N/A' : '—');
      lines.push(`| ${AVATAR(BOT_AVATARS[key] || '')} **${key === 'coderabbit' ? 'CodeRabbit' : 'Kilo Code'}** | ${linked} | ${riskCell} | ${meta.note || '—'} |`);
    }
    lines.push('', '<br>', '');
    // 结论区徽章整排退役（契约 2）：本段仅表格——跨 bot 汇总唯一事实源＝PR 标签，
    //   逐 bot 明细唯一事实源＝上表列；verdict 仍写 BOT-METADATA 机读尾块（展示/机读分离）。
    lines.push(`#### ${ICON('tasklist', 14)} PR 描述填充进度`, '');
    lines.push('| 组件 | 状态 | 附注 |', '| :--- | :--- | :--- |');
    const autofillBadge = BADGE(AUTOFILL_META[autofillState].badge, 'flat', 18);
    const titleRowBadge = badgeWrap(`${repoUrl}/pull/${prNumber}`, autofillBadge);
    lines.push(`| ${ICON('pencil', 14)} **PR 标题** | ${titleRowBadge} | 由 auto-fill 维护，对齐 head \`${shortSha}\` |`);
    lines.push(`| ${ICON('file', 14)} **PR 描述** | ${titleRowBadge} | ${autofillNote} |`);
    lines.push('', '<br>', '');
    // 关联小节渲染：单向缺省整块不写、全无整节省略（linkedPrs/linkedIssues 均空时
    //   icon-link.svg 不在场即整节省略的断言锚）；编号逐行裸写 + 尾随空格。
    if (linkedPrs.length || linkedIssues.length) {
      lines.push(`#### ${ICON('link', 14)} 关联`, '');
      if (linkedPrs.length) {
        // 一行多编号：`#17 #18 ` 同行空格分隔（紧凑形态，人类定版）。
        lines.push(`${ICON('git-pull-request', 14)} **PR**：`, linkedPrs.map((n) => `#${n} `).join(''), '');
      }
      if (linkedIssues.length) {
        lines.push(`${ICON('issue-opened', 14)} **Issue**：`, linkedIssues.map((n) => `#${n} `).join(''), '');
      }
      lines.push('<br>', '');
    }
    lines.push(`##### ${ICON('link-external', 14)} 本评论链接：`, '', '```', url || `${repoUrl}/pull/${prNumber}`, '```', '');
    // 计数头（契约 4）：需改＝Blocker+Major、建议＝Minor+Suggestion，未匹配不计入两侧。
    //   口径与逐行 severityOf 同源（severities Map 单次提取），禁行首锚定（E3 教训）；
    //   采集失败（非数组）不显示计数。
    const needFixCount = [...inlineSeverities.values()].filter((s) => s && /Blocker|Major/i.test(s)).length;
    const suggestionCount = [...inlineSeverities.values()].filter((s) => s && /Minor|Suggestion/i.test(s)).length;
    const countHead = Array.isArray(inlineComments)
      ? `本轮内联评论抓取 [${needFixCount} 条需改 · ${suggestionCount} 条建议]（逐条，复制整块发给 agent）：`
      : `本轮内联评论抓取（逐条，复制整块发给 agent）：`;
    lines.push(`##### ${ICON('code', 14)} ${countHead}`, '');
    if (!Array.isArray(inlineComments)) {
      lines.push('> 内联评论采集失败（仅展示面降级，不影响打标与裁决）', '');
    } else if (matchedInline.length === 0) {
      lines.push('# 本轮无可归属受信内联评论（附兜底全量抓取命令）', '');
    }
    lines.push('```bash', ...fetchCommands, '```');
    // BOT-METADATA 机读尾块（§0 隐藏面）：HTML 注释包裹，渲染面不可见、API body 机读；
    // \u003c/\u003e 全转义（E-5 闭环）：--> 含 >，转义后序列不可存活；JSON.parse 无损还原。
    const metadata = {
      head: currentHeadSha,
      verdict,
      risk_score: riskScore,
      bots: Object.fromEntries(Object.entries(botStatuses).map(([k, s]) => [k, s.state])),
      evidence: Object.fromEntries(Object.entries(botStatuses).map(([k, s]) => [k, s.evidence || 'none'])),
      links: {
        self: url, evidence: evidenceUrl,
        // 关联机读面：仅查到时在场（空数组整键缺席，消费方按缺省=无关联读）。
        ...(linkedPrs.length || linkedIssues.length
          ? { linked_prs: linkedPrs, linked_issues: linkedIssues }
          : {}),
      },
      autofill: { title: autofillState, body: autofillState },
      comment_url: url,
    };
    const metaJson = JSON.stringify(metadata).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    lines.push(`<!-- BOT-METADATA: ${metaJson} -->`);
    return lines.join('\n');
  };
  if (!(await assertCurrentHead())) return;
  if (ownComment) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner, repo: context.repo.repo, comment_id: ownComment.id, body: renderBody(selfUrl)
    });
  } else {
    const { data: created } = await github.rest.issues.createComment({
      owner: context.repo.owner, repo: context.repo.repo, issue_number: prNumber, body: renderBody(selfUrl)
    });
    // 首轮创建时 selfUrl 未知（评论 id 尚未分配），createComment 返回体带 html_url——
    //   立即用真实评论 URL 重渲染并回写，使首轮评论即携带 #issuecomment-… 链接，
    //   不再依赖下一事件才修正（Bug 1：首轮回退 PR URL）。
    // 回写尽力而为（展示面降级）：瞬时失败不阻塞标签主链路（设计声明「仅展示面降级」），
    //   下一事件经 ownComment 分支以 GET 刷新的 selfUrl 重渲染自然自愈。
    const createdUrl = created?.html_url || null;
    if (createdUrl && createdUrl !== selfUrl) {
      try {
        await github.rest.issues.updateComment({
          owner: context.repo.owner, repo: context.repo.repo, comment_id: created.id, body: renderBody(createdUrl)
        });
      } catch (e) {
        console.log(`[Status Comment] Self-URL backfill update failed (non-blocking, self-heals next event): ${e && e.message || e}`);
      }
    }
  }
}

// ========================================================
// 3. 栅栏汇合（按必需 bot 可用性判定，完成/不可用/等待分层）
// ========================================================
// 解析当前项目声明的 Bot，并从配置唯一派生 required 子集。
const expectedKeys = (process.env.EXPECTED_BOTS || 'coderabbit,kilocode')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(s => BOT_DEFINITIONS[s]);
const requiredKeys = expectedKeys.filter(key => BOT_DEFINITIONS[key].required);

// 规范拉取当前 Commit 的 Check Runs 列表（分页全量：check_runs 超过一页时首页
//   截断会漏掉后续页的 Bot run，导致 allReady 误判为已完成或漏匹配）
const checkRuns = await github.paginate(github.rest.checks.listForRef, {
  owner: context.repo.owner,
  repo: context.repo.repo,
  ref: currentHeadSha,
  filter: 'all',
  per_page: 100
});

// 栅栏口径（本轮重设计 + PR8 载体实测修订）：完成信号 =「已认证配置 bot + 当前 head
// 可绑定载体」，二者取一——① head 绑定的 authenticated review（login 逐字 + type=Bot，
// 任意非 DISMISSED state，含 COMMENTED；PR8 实测两 bot 的 review 形态为 COMMENTED，
// 旧终态门 APPROVED/CHANGES_REQUESTED 使合法载体被拒、barrier 恒假）；② head 绑定且
// app.id 防伪通过的 completed check run。无 commit_id 绑定的顶层 comment 仅可唤醒求值，
// 永不作完成/评分证据（见 4.3 fail-closed 立场）。
const allReviews = await github.paginate(github.rest.pulls.listReviews, {
  owner: context.repo.owner,
  repo: context.repo.repo,
  pull_number: prNumber,
  per_page: 100
});
const headReviews = allReviews.filter(r => r.commit_id === currentHeadSha && r.state !== 'DISMISSED');

let allReady = true;
const targetRuns = [];
const botStatuses = {};
const { data: repositoryData } = await github.rest.repos.get({ owner: context.repo.owner, repo: context.repo.repo });

for (const key of expectedKeys) {
  const def = BOT_DEFINITIONS[key];
  const runs = checkRuns.filter(r => {
    const slugMatch = def.pattern.test(r.name) || def.pattern.test(r.app?.slug || '');
    if (!slugMatch) return false;
    // C2：App ID 防伪——同名伪造 Check Run（非对应官方 App）一律排除；
    //   app.id 缺失/非数字时按不可信处理（fail-closed，不再退回 slug 匹配）。
    if (typeof r.app?.id !== 'number' || r.app.id !== def.appId) {
      console.log(`[Barrier] Ignoring untrusted check run name=${r.name} app=${r.app?.name || 'unknown'} slug=${r.app?.slug || 'unknown'} status=${r.status || 'unknown'} app.id=${String(r.app?.id)}`);
      return false;
    }
    return true;
  });
  const hasHeadReview = headReviews.some(r =>
    r.user?.type === 'Bot' && (def.logins || []).includes(r.user.login));
  const hasCompletedRun = runs.some(r => r.status === 'completed');
  const activeRuns = runs.filter(r => r.status !== 'completed');
  // Re-runs: aggregate the latest attempt for status/failure, not an older failed attempt.
  const latestRun = [...runs].sort((a, b) =>
    (Number(b.run_attempt || 0) - Number(a.run_attempt || 0)) ||
    String(b.completed_at || b.started_at || '').localeCompare(String(a.completed_at || a.started_at || ''))
  )[0];
  const failedRun = latestRun?.status === 'completed' &&
    !['success', 'neutral', 'skipped'].includes(latestRun.conclusion);
  let state = hasHeadReview || hasCompletedRun ? (failedRun ? 'failed' : 'completed') : 'absent';
  let reason = '';
  if (activeRuns.length > 0) {
    state = 'in_progress';
    reason = 'check_run_in_progress';
  } else if (key === 'coderabbit' && !hasHeadReview && !hasCompletedRun) {
    if (prData.changed_files > CODERABBIT_MAX_FILES) {
      state = 'file_limit';
      reason = 'file_limit';
    } else if (repositoryData.stargazers_count < CODERABBIT_MIN_STARS) {
      state = 'manual_required';
      reason = 'manual_required';
    }
  }
  botStatuses[key] = {
    state,
    evidence: hasHeadReview ? 'head_review' : hasCompletedRun ? 'authenticated_check_run' : 'none',
    reason,
    checkRunUrl: latestRun?.html_url || null,
  };
  // failed 是 latestRun 已落终态且 conclusion ∉ {success, neutral, skipped} 的载体（见 347-349）：
  //   GitHub 不会再为同一 run_attempt 重投 completed 事件，据此死等将使必需 bot 永久卡
  //   review:pending（liveness 缺口）。放行进入裁决分支，由 4.1 hasCheckFailure 精确落
  //   review:needs-work；仅必需 bot 的活跃 run（def.required && activeRuns.length > 0）继续等待。
  // E1 观察项修正：活跃 run 阻塞仅对必需 bot 生效——可选 bot 的 in_progress 只记入
  //   状态评论供观察，不阻塞 verdict 出口（其完成自会经 check_run:completed 重评，
  //   required 已齐时无须等待可选 bot）。必需 bot 的 active run 仍一律等待。
  if ((def.required && activeRuns.length > 0) || (def.required && !(state === 'completed' || state === 'failed'))) allReady = false;
  // 评分/失败聚合只用每个 bot「已 completed」的最新 attempt（非 latestRun 本身）：
  //   ① completed 终态才计入 4.1 的 hasCheckFailure / 文本采集；在途 run（含可选 bot 的
  //      in_progress，其 conclusion=null 会误命中 :477 判 failure）一律不入——旧实现靠
  //      barrier 早退隐式保证此不变量，barrier 为可选 bot 放行后必须在此显式设门。
  //   ② 最新 attempt 在途时回退取「最新已 completed attempt」：可选 bot 重试窗口
  //      （旧 attempt 失败终态 + 新 attempt 在途）不得静默丢弃旧失败证据（E-2），
  //      否则当轮误落 review:approved；新 attempt 落定后自会经 check_run 事件重评。
  //   ③ 失败终态（status=completed 且 conclusion∉{success,neutral,skipped}）仍入，保留
  //      failed 放行的 needs-work 语义（case 17 与夹具 19 依赖此）。
  const latestCompletedRun = runs.filter(r => r.status === 'completed').sort((a, b) =>
    (Number(b.run_attempt || 0) - Number(a.run_attempt || 0)) ||
    String(b.completed_at || b.started_at || '').localeCompare(String(a.completed_at || a.started_at || ''))
  )[0];
  if (latestCompletedRun) targetRuns.push(latestCompletedRun);
  if (state === 'absent' || state === 'file_limit' || state === 'manual_required') {
    console.log(`[Barrier] Bot '${key}' availability=${state}${reason ? ` reason=${reason}` : ''}.`);
  }
}

const allUnavailable = Object.values(botStatuses).every(status =>
  ['absent', 'file_limit', 'manual_required'].includes(status.state));

if (!allReady) {
  console.log('Barrier not reached. Waiting for all expected checks to finish.');
  // 系统性载体缺失必须可观测而非静默死等（完成判据契约 4）：逐 expected bot 复核双载体，
  //   任一 bot 本轮无任何可绑定载体即显式记录；等待分支的标签语义见下方 F7 专用清理。
  const missingCarrierKeys = expectedKeys.filter(key => {
    const def = BOT_DEFINITIONS[key];
    return !headReviews.some(r => r.user?.type === 'Bot' && (def.logins || []).includes(r.user.login))
      && !checkRuns.some(r => (def.pattern.test(r.name) || def.pattern.test(r.app?.slug || '')) && r.status === 'completed' && typeof r.app?.id === 'number' && r.app.id === def.appId);
  });
  if (missingCarrierKeys.length > 0) {
    console.log(`[Barrier] No bindable carrier this round for: ${missingCarrierKeys.join(', ')} (no commit-bound review or authenticated completed check run).`);
  }

  // Remove stale labels from previous round while new checks are pending
  const currentIssueLabels = await github.paginate(github.rest.issues.listLabelsOnIssue, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    per_page: 100
  });
  const existing = new Set(currentIssueLabels.map(l => l.name));

  const waitingStatusLabel = allUnavailable ? 'review:unavailable' : 'review:pending';
  const waitingVerdict = allUnavailable ? 'unavailable' : 'pending';
  for (const l of Object.keys(SYSTEM_LABELS)) {
    // 仅保留本轮动态选出的 pending/unavailable；needs-work 专属于真实风险，不复用于等待。
    if (l === waitingStatusLabel) continue;
    if (existing.has(l)) {
      // 逐个删除前复核 head：barrier 清理同样不得在新 head 生效期间删旧轮标签。
      if (!(await assertCurrentHead())) return;
      console.log(`[Barrier] Removing stale label: ${l}`);
      try {
        await github.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: prNumber,
          name: l
        });
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
  }

  // 等待/不可用分支：清理后落本轮真实状态——in_progress/required 未完成 → review:pending；
  //   全部 bot 皆缺席且非在途 → review:unavailable。needs-work 仅表达真实风险，此分支绝不复用它。
  //   添加前依次复核当前 head、确保标签已 provision，再经既有 addLabels 接口写入；
  //   任一 head 复核失败即整体退出。状态评论（D）在退出前同样落盘，供人类精确定位缺席原因。
  if (!existing.has(waitingStatusLabel)) {
    if (!(await assertCurrentHead())) return;
    await ensureLabelsProvisioned();
    if (!(await assertCurrentHead())) return;
    console.log(`[Barrier] Ensuring explicit ${waitingStatusLabel} status label.`);
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      labels: [waitingStatusLabel]
    });
  }
  await writeStatusComment(botStatuses, waitingVerdict);

  return;
}

console.log(`>>> All required bots (${requiredKeys.join(', ')}) completed for round ${currentHeadSha.slice(0, 7)}!`);

// F6 状态门已被 per-bot 可用性分类吸收：in_progress 在 barrier 内直接判为等待分支
//   （review:pending + 状态评论），不再走独立的静默 return。

// ========================================================
// 4. 解析与分值评定（对齐全量数据源与真实评级字段）
// ========================================================
let codeRabbitText = '';
// codeRabbitHeadText 只聚合「可绑定当前 head」的 CodeRabbit 载体：4.1 当前 head completed
//   check run output + 4.2 head 绑定 review 正文；不含 4.3b 顶层摘要评论（顶层评论无
//   commit_id 绑定，旧 head 的 Merge Risk 不得冒充本轮裁决）。head 绑定评级单独解析后
//   仅用于 review:approved 核准门（allExpectedResolved）；展示/风险分仍取 codeRabbitText。
let codeRabbitHeadText = '';
let kiloCodeText = '';
let hasCheckFailure = false;

// 4.1 提取 Checks API 中的 Output 文本
for (const run of targetRuns) {
  const textBlob = `${run.output?.title || ''}\n${run.output?.summary || ''}\n${run.output?.text || ''}`;
  if (/coderabbit/i.test(run.name) || /coderabbit/i.test(run.app?.slug || '')) {
    codeRabbitText += `\n${textBlob}`;
    codeRabbitHeadText += `\n${textBlob}`;
  }
  if (/kilo/i.test(run.name) || /kilo/i.test(run.app?.slug || '')) {
    kiloCodeText += `\n${textBlob}`;
  }
  if (run.conclusion !== 'success' && run.conclusion !== 'neutral' && run.conclusion !== 'skipped') {
    hasCheckFailure = true;
  }
}

// 4.2 提取 Pull Request 官方 Review 意见 (pulls.listReviews)
// 身份闸：仅 type=Bot 且登录名逐字命中配置的官方账号（见 BOT_DEFINITIONS.logins）。
// 旧口径用 /coderabbit/i、/kilo/i 模糊匹配 login，任何登录名含该子串的人类账号
// 都能把伪造文本灌进评分管道（如发布 "severity: critical" 的冒名评论）。
const isBotReview = (user, key) =>
  user?.type === 'Bot' && (BOT_DEFINITIONS[key]?.logins || []).includes(user.login);
const reviews = allReviews; // 复用栅栏处单次同参 listReviews（Bot W8：二次调用耗配额）；消费点 :503/:578/:588 均取原始未过滤数组，与 headReviews 同源同参，去重不改过滤语义
// 正文采集与栅栏同源排除已撤销（DISMISSED）review：撤销的评审不得影响评级。
for (const rev of reviews.filter(r => r.commit_id === currentHeadSha && r.state !== 'DISMISSED')) {
  if (isBotReview(rev.user, 'coderabbit')) { codeRabbitText += `\n${rev.body || ''}`; codeRabbitHeadText += `\n${rev.body || ''}`; }
  if (isBotReview(rev.user, 'kilocode')) kiloCodeText += `\n${rev.body || ''}`;
}

// 4.3 顶层 issue 评论消费收窄开口（C-A，20261017 计划）：仅消费带对应 bot marker 的
//   顶层摘要评论——身份闸（type=Bot + BOT_DEFINITIONS.logins 逐字命中）与 marker 双闸，
//   无 marker 或 login 不符的顶层评论仍不消费（fail-closed 立场收窄不破）。
//   根因：两个 bot 的真实风险字段（CodeRabbit Merge Risk / Kilo 计数表）只发在顶层
//   issue 评论，旧口径整体排除导致评分双 null。marker 常量：
//     CodeRabbit = `summarize by coderabbit.ai`（PR #18 实测 issuecomment 6231963193）
//     Kilo       = `<!-- kilo-review -->`（PR #18 实测 issuecomment 6232162632）
//   采集失败（REST 异常）→ 本轮跳过该面（下一事件自愈），不阻塞裁决主链路。
//   实装位置在 4.4 之前（crScore/kiloScore 解析消费这些文本）。
let kiloCarrierTexts = [];

// --- 4.3b 顶层摘要评论受信消费（C-A 实装）---
const TOP_LEVEL_MARKERS = { coderabbit: 'summarize by coderabbit.ai', kilocode: '<!-- kilo-review -->' };
let topComments = null;
try {
  topComments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner, repo: context.repo.repo, issue_number: prNumber, per_page: 100
  });
} catch (err) {
  console.log(`[Scoring] Top-level comment fetch failed (skipped this round, heals next event): ${err?.status || err?.message || err}`);
}
if (Array.isArray(topComments)) {
  for (const [key, marker] of Object.entries(TOP_LEVEL_MARKERS)) {
    // 取最新：listComments 分页按创建时间升序返回，find 取最早命中——多份摘要并存时把
    //   旧轮风险级当本轮消费（跨轮 stale）。filter 全部命中后取数组末位＝最近创建份；
    //   单命中（原地编辑常态）与原 find 同一份、行为零变化；身份+marker 双闸原样保留。
    const hits = topComments.filter(c =>
      c.user?.type === 'Bot' &&
      (BOT_DEFINITIONS[key]?.logins || []).includes(c.user.login) &&
      typeof c.body === 'string' && c.body.includes(marker));
    const hit = hits[hits.length - 1];
    if (hit) {
      const text = `\n${hit.body}`;
      if (key === 'coderabbit') codeRabbitText += text;
      else kiloCarrierTexts.push(hit.body);
    }
  }
}

// --- 4.4 CodeRabbit 官方 Merge Readiness 提取 (支持 Emoji 与 Markdown 标记) ---
let crScore = null; // null: 本轮未解析出评级；1: Ready, 2: Caution, 3: Risky, 4: Blocked
// 汇总全部 band 出现项而非首个匹配（Rework-5·Bot 意见）：codeRabbitText 聚合多载体
//   （check run output + review 正文）与多 attempt，先匹配先赢会让靠前文本的 'ready' 遮蔽
//   靠后的更严 band——与 4.6 最严原则、及同段 severity 行的全文 presence 判定口径不对称。
//   逐档判定按 blocked>risky>caution>ready 严序取用；等级识别格式与 crScore 语义不变。
//   Rework-6：交替式按最长前缀优先——「Merge Readiness band: Blocked」短语形里连接词 band 必须被
//   前缀整体消费，否则捕获组落在 'band'（间隙类不含字母，回退不能越过词界）→ 真 Blocked 被静默吞掉。
const crBands = [...codeRabbitText.matchAll(/(?:merge\s*readiness\s*band|readiness\s*band|merge\s*readiness)[^a-zA-Z\r\n]{0,8}([a-zA-Z]+)/gi)].map(m => m[1].toLowerCase());
const crBandHas = (band) => crBands.includes(band);

// C-A Merge Risk 摘要形态（PR #18 实测：`<summary><strong>Merge Risk:</strong>
//   <strong>🟡 Moderate</strong></summary>`；文档已知形态 Low/Moderate/High/Blocked 等）。
//   级别词映射与 Kilo severity 语义对齐：low→1 / moderate|caution→2 / high|risky→3 / critical|blocked→4。
//   未知级别词（如 🟣 Unknown）不捕获、不报错，静默落 null（fail-closed）。
//   `**Change:**`（Other/Ready）仅作 secondary，不单独定级。
// 同行匹配 + 风险级别词词边界：`[^<\r\n]*?` 把捕获限在同一行（不得跨行吃后续正文），
//   词前 `\b` 避免级别词被前导子串拼出（如 'low' 误命中 'follow'），词后 `\b` 避免未知
//   级别词后正文里的子串被当级别（如 '🟣 Unknown\n…high…' 误命中 'high'）。未知级别词
//   仍不捕获、落 null（fail-closed 不变）。
const crMergeRisks = [...codeRabbitText.matchAll(/Merge\s*Risk:?\s*(?:<\/strong>\s*)?(?:<strong>\s*)?(?:[^<\r\n]*?\b)?(low|moderate|high|blocked|critical|risky|caution|ready)\b/gi)].map(m => m[1].toLowerCase());
const crRiskRank = { low: 1, ready: 1, caution: 2, moderate: 2, risky: 3, high: 3, critical: 4, blocked: 4 };
const crMergeRiskScore = crMergeRisks.length > 0 ? Math.max(...crMergeRisks.map(w => crRiskRank[w])) : null;

if (crBandHas('blocked') || /\bseverity:\s*critical\b/i.test(codeRabbitText)) {
  crScore = 4;
} else if (crBandHas('risky') || /\bseverity:\s*major\b/i.test(codeRabbitText)) {
  crScore = 3;
} else if (crBandHas('caution') || /\bseverity:\s*minor\b/i.test(codeRabbitText)) {
  crScore = 2;
} else if (crBandHas('ready')) {
  crScore = 1;
}
// 跨形态取严合并：band 链与 Merge Risk 同 :909 crRiskRank 1-4 刻度，同文并存时
//   Merge Risk 不得被更轻的 band 吞掉（ready+High 应取 3）；非 null 时取 max。
//   risk null → band 链结果原样保持；band null + risk 非 null → 取 risk（与原兜底分支等价）。
if (crMergeRiskScore !== null) crScore = crScore === null ? crMergeRiskScore : Math.max(crScore, crMergeRiskScore);

// head 绑定评级（核准门专用）：对「4.1 当前 head completed check run + 4.2 head review」文本
//   重跑同一套取严解析，排除 4.3b 顶层评论。current head 载体无 band/风险而仅旧顶层 Merge Risk
//   存在时本值落 null → 据以下 allExpectedResolved 收紧判 coderabbit 未落定。解析口径与上方
//   crScore 完全同构，仅输入文本域不同。
const crHeadBands = [...codeRabbitHeadText.matchAll(/(?:merge\s*readiness\s*band|readiness\s*band|merge\s*readiness)[^a-zA-Z\r\n]{0,8}([a-zA-Z]+)/gi)].map(m => m[1].toLowerCase());
const crHeadHasBand = (band) => crHeadBands.includes(band);
const crHeadMergeRisks = [...codeRabbitHeadText.matchAll(/Merge\s*Risk:?\s*(?:<\/strong>\s*)?(?:<strong>\s*)?(?:[^<\r\n]*?\b)?(low|moderate|high|blocked|critical|risky|caution|ready)\b/gi)].map(m => m[1].toLowerCase());
const crHeadMergeRiskScore = crHeadMergeRisks.length > 0 ? Math.max(...crHeadMergeRisks.map(w => crRiskRank[w])) : null;
let crScoreHeadBound = null;
if (crHeadHasBand('blocked') || /\bseverity:\s*critical\b/i.test(codeRabbitHeadText)) {
  crScoreHeadBound = 4;
} else if (crHeadHasBand('risky') || /\bseverity:\s*major\b/i.test(codeRabbitHeadText)) {
  crScoreHeadBound = 3;
} else if (crHeadHasBand('caution') || /\bseverity:\s*minor\b/i.test(codeRabbitHeadText)) {
  crScoreHeadBound = 2;
} else if (crHeadHasBand('ready')) {
  crScoreHeadBound = 1;
}
if (crHeadMergeRiskScore !== null) crScoreHeadBound = crScoreHeadBound === null ? crHeadMergeRiskScore : Math.max(crScoreHeadBound, crHeadMergeRiskScore);

// --- 4.5 Kilo Code 真实等级提取 (严格对齐 Blocker / Warning / Suggestion) ---
// K 系列契约（Bot 意见）：优先解析 Kilo 官方 Overview 计数表形态（PR8 实测，comment
//   id 6117996536：`**Status:** N Issues Found` + `| Severity | Count |` 三行计数）——
//   按大于零的最严重档赋级；`Status: No Issues Found` 或计数全零 → 最低评级（1）。
//   既有 severity/bare 前缀正则保留为其他输出格式的兜底（次序：计数表先于兜底）。
// 载体分解析（review-finding 契约）：kiloCodeText 聚合多载体（check run output + review
//   正文），全文混合解析会让旧载体的计数表（全零→1）遮蔽另一载体的真实发现——
//   按载体分别解析各自得分后取最高（与 4.4 CodeRabbit 汇总多 band 最严原则同构）。
const kiloCarrierTextsAggregated = targetRuns
  .filter(run => /kilo/i.test(run.name) || /kilo/i.test(run.app?.slug || ''))
  .map(run => `${run.output?.title || ''}\n${run.output?.summary || ''}\n${run.output?.text || ''}`);
for (const rev of reviews.filter(r => r.commit_id === currentHeadSha && r.state !== 'DISMISSED')) {
  if (isBotReview(rev.user, 'kilocode')) kiloCarrierTextsAggregated.push(rev.body || '');
}
kiloCarrierTexts.push(...kiloCarrierTextsAggregated);
const kiloScoreOf = (text) => {
  const rows = [...text.matchAll(/^\|\s*(CRITICAL|BLOCKER|WARNING|MAJOR|HIGH|SUGGESTION|MINOR|LOW|INFO)\s*\|\s*(\d+)\s*\|/gim)]
    .map(m => ({ sev: m[1].toUpperCase(), count: Number(m[2]) }));
  if (rows.length > 0) {
    const countOf = (sev) => rows.filter(r => r.sev === sev).reduce((n, r) => n + r.count, 0);
    if (countOf('CRITICAL') + countOf('BLOCKER') > 0) return 4;
    if (countOf('HIGH') + countOf('MAJOR') > 0) return 3; // HIGH/MAJOR 对齐 SYSTEM_LABELS risk:high（Kilo [Major/High]）
    if (countOf('WARNING') > 0) return 2;
    if (countOf('SUGGESTION') + countOf('MINOR') + countOf('LOW') + countOf('INFO') > 0) return 1;
    return 1; // 计数均为零（含 Status: No Issues Found 同轮形态）→ 最低评级，不落入无评级分支
  }
  if (/status:\*{0,2}\s*no\s*issues\s*found/i.test(text)) return 1;
  // severity/bare 前缀兜底（同载体：计数表未解析出评级时才走文本评级）。
  if (/(?:severity|风险|level)[\s:|*#-]*(critical|严重|blocker|致命)/i.test(text) || /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?(?:CRITICAL|BLOCKER)(?:\*\*)?\s*:/im.test(text)) return 4;
  if (/(?:severity|风险|level)[\s:|*#-]*(high|高危|major|高)/i.test(text)) return 3;
  if (/(?:severity|风险|level)[\s:|*#-]*(warning|中危|medium|中)/i.test(text) || /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?WARNING(?:\*\*)?\s*:/im.test(text)) return 2;
  if (/(?:severity|风险|level)[\s:|*#-]*(suggestion|low|低危|minor|低|info)/i.test(text) || /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?SUGGESTION(?:\*\*)?\s*:/im.test(text)) return 1;
  return null;
};
let kiloScore = null; // null: 本轮未解析出评级；1: Suggestion, 2: Warning, 3: High, 4: Critical
for (const carrierText of kiloCarrierTexts) {
  const s = kiloScoreOf(carrierText);
  if (s !== null && (kiloScore === null || s > kiloScore)) kiloScore = s;
}

// --- 4.6 裁决汇总（最严原则，正向标签以「全部必需 bot 通过」为门，可选 bot 缺席不阻塞）---
const ratingByBot = { coderabbit: crScore, kilocode: kiloScore };
const scores = expectedKeys.map(key => ratingByBot[key]);
const hasParseableRating = scores.some(score => score !== null);
// 正向门：每个 required bot 都解析出评级才写 ai-reviewed/风险标签；可选 bot 缺席记入
//   状态评论但不阻塞（决策 1）。finalScore 取所有已解析 bot（含可选 bot）的最严分。
const allBotsRated = requiredKeys.length > 0 && requiredKeys.every(key => ratingByBot[key] !== null);
// 契约 3（人类裁决 2026-10-18）：approved 门收紧——每个 expected bot 须「已评级或确定性缺席
//   （file_limit/manual_required）」；required 齐评但可选 bot 尚未落定（absent 无载体）→
//   review:pending（诚实等待，非核准），其后续事件重评自然升级。EXPECTED_BOTS 只含 required 时
//   allExpectedResolved ≡ allBotsRated，行为零变化。
// 内联回灌收紧（PR#21 CodeRabbit）：in_progress/absent 态即使评级非 null 也不算落定——
//   4.3b 顶层评论消费无 head 绑定，absent/in_progress bot 的评级可能来自旧 head 的顶层评论
//   （`Merge Risk: Low` 穿透核准门冒充本轮裁决）。再补 completed 空载体一支：本轮载体的评级
//   只信任 head 绑定的 review / completed check run（crScoreHeadBound）；completed 但 head 绑定
//   文本无可解析评级（评级仅由旧顶层评论填充）同样不算落定，保持 review:pending 等待重评。
//   file_limit/manual_required 为确定性缺席，仍视作落定。kilocode 判定口径不变。
const allExpectedResolved = expectedKeys.every(key => {
  const st = botStatuses[key]?.state;
  if (['in_progress', 'absent'].includes(st)) return false;
  if (['file_limit', 'manual_required'].includes(st)) return true;
  const resolvedRating = key === 'coderabbit' ? crScoreHeadBound : ratingByBot[key];
  return resolvedRating !== null;
});
let finalScore = allBotsRated ? Math.max(...requiredKeys.map(key => ratingByBot[key]), ...scores.filter(score => score !== null)) : null;
const partialRating = !allBotsRated && hasParseableRating;
let verdict = 'risk';
const allRiskLabels = ['risk:critical', 'risk:high', 'risk:medium', 'risk:low'];
const allStatusLabels = ['review:needs-work', 'review:approved', 'review:pending', 'review:unavailable'];
const allManagedLabels = ['ai-reviewed', ...allRiskLabels, ...allStatusLabels];
const toAdd = new Set();

if (allBotsRated) {
  const scoreLabelMap = {
    4: 'risk:critical',
    3: 'risk:high',
    2: 'risk:medium',
    1: 'risk:low'
  };
  const targetRiskLabel = scoreLabelMap[finalScore];

  // 状态裁决：检查是否有 CHANGES_REQUESTED 状态或 Check 状态失败
  // 无需在此重复 DISMISSED 排除：GitHub review state 为互斥枚举
  // （commented/changes_requested/approved/dismissed），撤销会把 state 改写为
  // DISMISSED，故 state === 'CHANGES_REQUESTED' 不可能命中已撤销评审。
  const hasChangesRequested = reviews.some(r => r.commit_id === currentHeadSha && r.state === 'CHANGES_REQUESTED');
  const targetStatusLabel = (hasCheckFailure || hasChangesRequested || finalScore >= 3)
    ? 'review:needs-work'
    : (allBotsRated && allExpectedResolved ? 'review:approved' : 'review:pending');

  console.log(`[Verdict] Head: ${currentHeadSha.slice(0, 7)} => Risk: ${targetRiskLabel}, Status: ${targetStatusLabel} (CR: ${crScore}, Kilo: ${kiloScore})`);
  toAdd.add('ai-reviewed');
  toAdd.add(targetRiskLabel);
  toAdd.add(targetStatusLabel);
  verdict = targetStatusLabel === 'review:approved' ? 'complete' : 'risk';
} else if (partialRating || hasCheckFailure || reviews.some(r => r.commit_id === currentHeadSha && r.state === 'CHANGES_REQUESTED')) {
  // 部分 bot 有评级（必需 bot 缺席）或当前 head 有失败 Check 或 CHANGES_REQUESTED 评审 → 标记 needs-work；本分支不引入 ai-reviewed/risk。
  toAdd.add('review:needs-work');
  console.log(`[Verdict] Head: ${currentHeadSha.slice(0, 7)} => Partial ratings or failed check / CHANGES_REQUESTED. Marking review:needs-work.`);
  verdict = 'partial';
} else {
  // C-B 兜底（20261017 计划）：放宽采集面后仍无任何评级 → 显式「无评级」态 verdict=no-rating，
  //   不再硬写 risk / 无条件加 review:needs-work（纯无评级不伪造成风险发现）。
  //   needs-work 仅由 hasCheckFailure / CHANGES_REQUESTED 单独决定。
  const hasChangesRequestedNoRating = reviews.some(r => r.commit_id === currentHeadSha && r.state === 'CHANGES_REQUESTED');
  if (hasCheckFailure || hasChangesRequestedNoRating) {
    toAdd.add('review:needs-work');
    console.log(`[Verdict] Head: ${currentHeadSha.slice(0, 7)} => No parseable rating with check failure / CHANGES_REQUESTED; marking review:needs-work.`);
    verdict = 'risk';
  } else {
    console.log(`[Verdict] Head: ${currentHeadSha.slice(0, 7)} => No parseable rating; verdict falls back to no-rating (N/A).`);
    verdict = 'no-rating';
  }
  finalScore = null;
}

// ========================================================
// 5. 应用标签与旧标清洗
// ========================================================
// 写标签前复核当前 PR head 与触发事件 head 一致，防止过期 job 抢占写标。
if (!(await assertCurrentHead())) return;

await ensureLabelsProvisioned();

const currentIssueLabels = await github.paginate(github.rest.issues.listLabelsOnIssue, {
  owner: context.repo.owner,
  repo: context.repo.repo,
  issue_number: prNumber,
  per_page: 100
});
const existing = new Set(currentIssueLabels.map(l => l.name));

// 仅在 toAdd 有明确 verdict 时移除未被保留的同组历史标签；无评级分支已加入 review:needs-work。
 //   barrier 未完成分支另有专用语义（F7）：清陈旧 approved/risk，仅保留并显式补写本轮等待态标签（pending/unavailable）；needs-work 不复用于等待。
// 清理前再次复核 head：初次复核通过后到实际删标签之间 head 可能被 push 更新，
// 旧 job 不得在新 head 生效期间删除当轮标签（闭合清洗窗口的 TOCTOU）。
if (!(await assertCurrentHead())) return;
for (const l of allManagedLabels) {
  if (!toAdd.has(l) && existing.has(l)) {
    // 逐个删除前再次复核 head：闭合循环内逐个 removeLabel 之间的 TOCTOU 窗口。
    if (!(await assertCurrentHead())) return;
    console.log(`[Cleanup] Removing obsolete label: ${l}`);
    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        name: l
      });
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
}

// 写入当前轮次新标签
const finalAdd = Array.from(toAdd).filter(l => !existing.has(l));
if (finalAdd.length > 0 && !(await assertCurrentHead())) return;
if (finalAdd.length > 0) {
  console.log(`[Apply] Adding labels: ${finalAdd.join(', ')}`);
  await github.rest.issues.addLabels({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    labels: finalAdd
  });
}

// 裁决分支同步状态评论（D 契约）：汇总逐 bot 状态、缺席原因与本轮裁决/风险分，
//   定位与二次编辑规则同等待遇分支；评论内容不回流评分管道。
//   仅裁决分支传 perBotRatings（ratingByBot 定义于 4.6、裁决分支内）；等待分支（:809 区）
//   不传（TDZ：ratingByBot 该处尚不存在），缺省 {} 落 N/A/— 即等待语义。
await writeStatusComment(botStatuses, verdict, finalScore, ratingByBot);
}

export async function resolvePr(deps) {
  const { context, github, core, process, console } = deps;
let number = context.payload.pull_request?.number ||
  context.payload.check_run?.pull_requests?.[0]?.number ||
  (context.payload.issue?.pull_request ? context.payload.issue.number : undefined);
if (!number && context.payload.check_run) {
  const { data: prs } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    commit_sha: context.payload.check_run.head_sha
  });
  number = prs[0]?.number;
}
core.setOutput('number', number || '');

}

// CLI 入口（脱离引擎本地运行）：runner 仅 `run: node .github/scripts/bot-review-labeler.mjs [resolve-pr]`。
//   context 由 GITHUB_EVENT_PATH + 事件元数据装配；github 经 gh-client（.status + Link 全量分页）；
//   core.setOutput 写入 $GITHUB_OUTPUT（跨 job outputs 机制等价替代）；凭证经 env 注入（GITHUB_TOKEN）。
async function buildCliDeps() {
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let payload = {};
  if (eventPath) {
    payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  }
  const full = process.env.GITHUB_REPOSITORY || (payload && payload.repository && payload.repository.full_name) || '';
  const [owner, repoName] = String(full).split('/');
  const context = {
    eventName,
    payload,
    repo: { owner, repo: repoName },
    serverUrl: process.env.GITHUB_SERVER_URL || 'https://github.com',
  };
  const github = createGitHubClient({});
  const core = {
    setOutput(name, value) {
      const out = process.env.GITHUB_OUTPUT;
      if (out) appendFileSync(out, name + '=' + value + '\n');
      else console.log('::set-output name=' + name + '::' + value);
    },
  };
  return { context, github, core, process, console, eventPathPresent: Boolean(eventPath) };
}

// 仅在作为脚本直接运行时装配 CLI deps 并分派（被 harness import 时不执行）。
const invokedAsScript = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/.github/scripts/bot-review-labeler.mjs');
if (invokedAsScript) {
  const deps = await buildCliDeps();
  if (!deps.eventPathPresent) {
    console.error('::error::GITHUB_EVENT_PATH 缺失：非事件驱动调用，fail-closed 早退（不抛裸堆栈）。');
  } else if (process.argv[2] === 'resolve-pr') {
    await resolvePr(deps);
  } else {
    await run(deps);
  }
}
