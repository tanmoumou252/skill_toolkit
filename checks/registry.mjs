// 常驻不变式登记表（数据层）：只登记"违反即无歧义缺陷"的事实。
// 本文件放"什么必须为真"；机制在 checks/invariants.mjs，入口在 checks/run.mjs。
//
// 设计原则（由实测证据钉住，勿轻改）：
//   1. 【禁含/互斥】只允许用于结构化面——frontmatter 顶层键与键值形态。
//      散文面禁含已被实测证伪：codebuddy 代理文件合法出现 `subagent_type`
//      （否定句与跨平台映射表）；kilocode 代理文件合法出现 `write_scoped_file`
//      （作为必须 deny 的键名）。故不得对散文面做禁含断言。
//   2. 【散文面】只做必含与配对等式，不锁措辞、不锁出现次数——避免任何合法改写即红灯，
//      否则检查器自身会退化成新的收尾生成器（本项目要根治的病）。
//   3. 【平台私有调用标识】用必含表达，不用禁含表达。
//   4. 扫描面按路径模式分类，不硬编码文件清单，新增文件自动纳入。

export const PLATFORMS = ['kilocode', 'codebuddy', 'zcode'];

// —— 扫描面分类 ——
// 登记制局限明示：本表与 platformOf 的平台名硬编码是有意登记制，非疏漏——AGENT_KEYS/
// PRIVATE_AGENT_KEYS 为逐平台键集，新平台键集不可自动推导；若把正则放开为通配，未知平台
// 文件会进入私有键互斥检查而产生假红。新增平台必须显式登记本表、键集与 run.mjs 的
// SCAN_ROOTS；未登记的顶层目录与未分类的平台治理/代理文件分别由 run.mjs 的
// unscanned-root-directory 与 unclassified-platform-file 检查大声报错（fail-loud），不得静默丢弃。
export const CLASSES = [
  { id: 'platform-governance', re: /^(kilocode|codebuddy|zcode)\/AGENTS\.md$/, frontmatter: 'absent' },
  { id: 'platform-agent', re: /^(kilocode|codebuddy|zcode)\/agents\/[^/]+\.md$/, frontmatter: 'present' },
  { id: 'skill', re: /^skills\/[^/]+\/SKILL\.md$/, frontmatter: 'present' },
  {
    id: 'doc',
    re: /^(?:(?:kilocode|codebuddy|zcode)\/README\.md|skills\/README\.md|kilocode\/permission-template\.md|skills\/[^/]+\/references\/[^/]+\.md)$/,
    frontmatter: 'absent',
  },
];

// —— frontmatter 键集（结构化面：互斥与必需） ——
export const AGENT_KEYS = {
  kilocode: {
    whitelist: ['mode', 'description', 'options', 'permission'],
    required: ['mode', 'description', 'options', 'permission'],
  },
  codebuddy: {
    whitelist: ['name', 'description', 'model', 'tools', 'agentMode', 'enabled', 'enabledAutoRun', 'mcpServers'],
    required: ['name', 'description', 'tools', 'mcpServers'],
  },
  zcode: {
    whitelist: ['name', 'description', 'color', 'tools', 'permissionMode', 'injectAgentsMd'],
    required: ['name', 'description', 'tools', 'permissionMode', 'injectAgentsMd'],
  },
};

export const SKILL_KEYS = {
  whitelist: ['name', 'description', 'allowed-tools'],
  required: ['name', 'description'],
};

// 平台私有键：出现在其他平台即判串台
export const PRIVATE_AGENT_KEYS = {
  kilocode: ['mode', 'options', 'permission'],
  codebuddy: ['model', 'agentMode', 'enabled', 'enabledAutoRun', 'mcpServers'],
  zcode: ['color', 'permissionMode', 'injectAgentsMd'],
};

// kilocode 实测雷区（kilocode/permission-template.md 公理 M2 / M7）
export const KILOCODE_FORBIDDEN_AGENT_KEYS = ['edit', 'write'];
export const KILOCODE_MAP_KEYS = ['bash'];

export const KILOCODE_REVIEWER_ROLES = ['plan-reviewer', 'pr-reviewer'];
export const KILOCODE_MAIN_DENY_KEYS = [
  'plan-governor-main_exec_guarded_command',
  'plan-governor-main_exec_sandboxed_command',
  'plan-governor-main_copy_into_sandbox',
  'plan-governor-main_write_scoped_file',
  'plan-governor-main_edit_scoped_file',
  'plan-governor-main_write_plan',
  'plan-governor-main_write_review_report',
  'plan-governor-main_write_pr_review_report',
];
export const KILOCODE_SUBAGENT_ALLOW_KEY = 'plan-governor-subagent_exec_guarded_command';

// —— 臃肿闸门：产物字节棘轮上限（Wave 1 装机值，机制在 invariants.mjs product-size-budget，入口在 run.mjs）——
// 设计纪律（本计划「字节棘轮闸」）：上限只降不升——任何会话再往 prompt 塞说明书即判红，减法从此不可逆。
// 键为 CLASSES.id（'platform-agent'＝9 个 agents/*.md 产物、'platform-governance'＝3 份 AGENTS.md），
//   值为逐件字节上限（utf8 字节数）。装机值即历史最高点，写入 SIZE_BUDGET_CEILING 永久钉死。
// per-file 豁免：确需突破类别上限的个别文件，必须在 SIZE_BUDGET_EXEMPT 显式登记 { cap, reason }，
//   严禁静默放行；豁免本身不得抬高类别默认上限（棘轮只针对类别默认值与天花板两层）。
export const SIZE_BUDGET = {
  'platform-agent': 12000,
  'platform-governance': 10000,
};
// 棘轮天花板＝Wave 1 装机值，是「上限被抬高」形态的机器检出基准：SIZE_BUDGET 任一键值 > 天花板即红。
export const SIZE_BUDGET_CEILING = {
  'platform-agent': 12000,
  'platform-governance': 10000,
};
// per-file 豁免登记表（显式登记，缺省空＝无豁免）。cap 为该文件的生效上限、reason 必填。
// 2026-10-16T22:5xZ 接力步骤 5 口径 B 登记（棘轮两层未动：SIZE_BUDGET/CEILING 保持装机值）：
//   实测锚+电报祈使地板高于类别默认上限（步骤 4 实测：转写/硬压均为负收益或触红线），逐件显式登记；
//   本表＝登记时点实测地板的显式快照（声明面压缩已收口，零合法续压面）。cap＝登记时实测值+512（禁取整抬高；实测下移后 cap 只随下移不上调）。
// 2026-10-18 人类裁决＝豁免认可；10 件实测低于登记 cap 的按「cap 只随实测下移」规则 re-pin（新 cap＝min(现 cap, 实测+512)），reason 更新为已复核通过。
export const SIZE_BUDGET_EXEMPT = {
  'codebuddy/agents/plan-writer-sp.md': { cap: 30299, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'codebuddy/agents/plan-reviewer-sp.md': { cap: 28431, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'codebuddy/agents/pr-reviewer-sp.md': { cap: 23235, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'kilocode/agents/plan-writer-sp.md': { cap: 27889, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'kilocode/agents/plan-reviewer-sp.md': { cap: 28448, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'kilocode/agents/pr-reviewer-sp.md': { cap: 21234, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'zcode/agents/plan-writer-subagent-sp.md': { cap: 21339, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'zcode/agents/plan-reviewer-subagent-sp.md': { cap: 30470, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'zcode/agents/pr-reviewer-subagent-sp.md': { cap: 23077, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
  'zcode/AGENTS.md': { cap: 17306, reason: '锚+电报祈使地板实测；已复核通过（2026-10-18 人类裁决）' },
};

const P = 'kilocode|codebuddy|zcode';

// —— 条款文本派生（§14 长期项定案落地）——
// CLAUSES.text 历史上是锚库正文的「字面重复（双写）」：spec/anchor-library/<id>.md 改措辞而
//   registry 未同步即触发吞锚闸 fail-closed 拒产（2026-10-15 review-severity-axiom 实证，
//   见 stacked-pr-handover §14）。派生修法：`fromAnchor(id)` 自归档锚块正文**运行时读取**条款
//   text，单一事实源——锚库改措辞，registry 自动跟随，双写漂移结构性消除。
// 消费契约（三闸不变）：CLAUSES.text 仍须是 expect 命中的**产物文件**正文的子串（吞锚闸
//   build-agents.mjs / F8 invariants.mjs / anchor-library-registry-no-drift selftest.mjs）。
//   因此 fromAnchor 取的子串必须**同时**在锚库与渲染产物中逐字在场——产物只装配 spec/blocks/**，
//   锚库不参与装配，故派生串只能取「锚库与 spec/blocks 的交叉子串」（同一裁决双写的现存事实，
//   如 `严重度按四要素裁定`）。锚文件缺失/子串失配 fail-loud 抛错（登记表加载即炸，不留静默漂移）。
// 豁免与归档纪律不变：条款 id 仍须有 anchor-library 归档块（selftest 咬）；expect 模式照旧。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_ROOT = fileURLToPath(new URL('..', import.meta.url));

export function fromAnchor(id, substr) {
  const file = path.join(REGISTRY_ROOT, 'spec', 'anchor-library', id + '.md');
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`[registry] anchor-library/${id}.md 读取失败（条款文本派生 fail-loud）: ${e.message}`);
  }
  if (!content.includes(substr)) {
    throw new Error(`[registry] 派生子串不在 anchor-library/${id}.md 正文（锚库改措辞后须同步此处交叉子串）: ${substr}`);
  }
  return substr;
}

// —— 散文面：必含条款（模式驱动的 required set：命中该模式的每个文件都必须含该串） ——
export const CLAUSES = [
  {
    id: 'no-green-no-start',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('no-green-no-start', '未见红严禁开工'),
    expect: [
      new RegExp(`^(?:${P})/AGENTS\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
  {
    id: 'review-mode-dual',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-mode-dual', 'MODE=cumulative'),
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`),
      /^skills\/zcode-plan-first\/SKILL\.md$/,
    ],
  },
  {
    id: 'escalate-to-human',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('escalate-to-human', 'ESCALATE_TO_HUMAN'),
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
  {
    id: 'rework-human-clean',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('rework-human-clean', 'REWORK=HUMAN_CLEAN'),
    expect: [
      new RegExp(`^(?:${P})/AGENTS\\.md$`),
      new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`),
      /^skills\/zcode-plan-first\/SKILL\.md$/,
    ],
  },
  {
    id: 'untracked-iron-law',
    // 豁免派生（字面保留）：text 仅在锚库归档与产物在场、不在 spec/blocks 装配面上游——
    //   fromAnchor 派生串要求「锚库 ∩ blocks 交叉」，本条不满足交叉前提，fromAnchor 会 fail-loud。
    //   改锚库措辞须手动同步本字面（无自动跟随），属有意豁免而非遗漏。
    text: '未跟踪新文件铁律',
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'adversarial-imagining',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('adversarial-imagining', '对抗性破坏假想'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'shape-demo-wording',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('shape-demo-wording', '形态示范'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'first-wave-concurrency',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('first-wave-concurrency', '首波并发'),
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
  {
    id: 'report-path-marker',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('report-path-marker', '报告路径：'),
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`),
      /^skills\/zcode-plan-first\/SKILL\.md$/,
    ],
  },
  {
    id: 'direct-dispatch-header',
    // 豁免派生（字面保留）：活跃装配块（spec/blocks 在场、无锚库归档义务，selftest 豁免集同源），
    //   无锚库可派生，text 字面是唯一事实源；若未来该块退役下沉，再转 fromAnchor。
    text: '直连派发参数头',
    // 锁定 ZCode 侧"无主计划直连派发也必须现构参数头"的义务文本。
    // 散文面只做必含（registry.mjs:9-10），不锁措辞、不锁出现次数。
    expect: [/^zcode\/AGENTS\.md$/, /^skills\/zcode-plan-first\/SKILL\.md$/],
  },
  {
    id: 'invariant-enumeration',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('invariant-enumeration', '不变量枚举'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'falsifiable-attack',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('falsifiable-attack', '爆炸半径'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'interleaving-matrix',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('interleaving-matrix', '事件交错矩阵'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'greenlight-downgrade',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('greenlight-downgrade', '覆盖证据'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'blackbox-first',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('blackbox-first', '黑盒先行'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'semantic-five-duties',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('semantic-five-duties', '语义正确性五问对抗义务'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'truth-source-four-duties',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('truth-source-four-duties', '真相源、读纯度与活性四问'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'truth-source-anti-lookup',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('truth-source-anti-lookup', '真相源反查（判据必须落在权威源上）'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'read-purity-multi-truth-source',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('read-purity-multi-truth-source', '读纯度与多真相源'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'liveness-rollback',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('liveness-rollback', '异常路径回滚与持锁活性'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'fixture-fidelity-audit',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('fixture-fidelity-audit', '夹具保真度对账'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'four-question-result-table',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('four-question-result-table', '真相源、读纯度与活性四问节结果表'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'depth-basis-machine-line',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('depth-basis-machine-line', 'DEPTH_BASIS='),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'close-by-adding-not-gutting',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('close-by-adding-not-gutting', 'Critical 闭环禁缩范围'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'independence-depth-not-delegable',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('independence-depth-not-delegable', '独立性与分级不可覆写'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'dispatch-contract-violation-marker',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('dispatch-contract-violation-marker', 'DISPATCH_CONTRACT_VIOLATED'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'shadow-errata-channel',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('shadow-errata-channel', '## ERRATA'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'shadow-write-surface',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('shadow-write-surface', '写面单一性'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'shadow-duplicate-dispatch',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('shadow-duplicate-dispatch', 'DUPLICATE_DISPATCH'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'dispatch-mode-violated-marker',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('dispatch-mode-violated-marker', 'DISPATCH_MODE_VIOLATED'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'gutting-suspect-marker',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('gutting-suspect-marker', 'GUTTING_SUSPECT'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'zero-finding-escalated-marker',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('zero-finding-escalated-marker', 'ZERO_FINDING_ESCALATED'),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'shadow-pass-machine-line',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('shadow-pass-machine-line', 'SHADOW_PASS='),
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'truth-pass-machine-line',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('truth-pass-machine-line', 'TRUTH_PASS='),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'fixture-rerun-blocked-marker',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('fixture-rerun-blocked-marker', 'FIXTURE_RERUN=BLOCKED_READONLY'),
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'absent-file-per-item-reason',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('absent-file-per-item-reason', '逐条列出并各给一行缺席理由'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'baseline-path-declared',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('baseline-path-declared', '测试基线文件路径'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'evidence-verb-rerun',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('evidence-verb-rerun', '先读该基线文件、再逐条复跑其中的每条命令'),
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'review-severity-axiom',
    // 派生条款（fromAnchor 单一事实源首例）：text 不再字面双写，锚库改措辞即自动跟随；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-severity-axiom', '严重度按四要素裁定'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-doc-evidence-duty',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-doc-evidence-duty', '失败语义必须对权威文档取证'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-omission-audit',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-omission-audit', '遗漏型审查'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-two-pass-disclosure',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-two-pass-disclosure', '两遍法与披露解耦'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-transaction-three-questions',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-transaction-three-questions', '事务三问'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-writer|plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-heterogeneous-lens',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-heterogeneous-lens', '异源透镜'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-coupling-lineage',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-coupling-lineage', '影响面按耦合谱系探'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-design-law',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-design-law', '先毁后建'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-writer|plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-quick-check',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-quick-check', '一页速查'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'review-dispatch-diff-section',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('review-dispatch-diff-section', '与派发主张的差集'),
    expect: [new RegExp(`^(?:${P})/agents/(?:plan-reviewer|pr-reviewer)[^/]*\\.md$`)],
  },
  {
    id: 'landing-timing-skeleton-sentinel',
    // 派生条款（fromAnchor 单一事实源）：text 运行时取自锚库正文，双写漂移结构性消除；
    //   子串取「锚库正文 ∩ 渲染产物正文」交叉段（产物只装配 spec/blocks/**，见 fromAnchor 契约）。
    text: fromAnchor('landing-timing-skeleton-sentinel', '首笔即落骨架+哨兵'),
    // 分段落笔（增量落盘）时序义务（§7）：长文起草首笔即落骨架+哨兵，其后每节一次串替换。
    // 义务文本锚定在 body-incremental-landing.md 的「时序义务」节；plan-writer 三端流水线
    // 步骤 2 与 zcode 落盘回报句、两份 plan-first 技能（主会话直写长计划场景）同须在场。
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
];

// —— 派生载体条款（数据层只登记"必须为真"的文本，不登记任何文件清单或平台名）——
// 租约三闸的必含载体不是静态清单，而是「该平台的派发权载体」，由 invariants.mjs 依据现场文件集
// 按编排拓扑推导：平台存在 <plat>/agents/plan-writer-sp.md（该平台有编排器代理）⇒ 载体＝该 agent
// 文件；不存在（子代理-only 平台，父会话即编排器）⇒ 载体＝<plat>/AGENTS.md。
// 旧实现把载体写成平台名硬编码（zcode 单点）叠加 */agents/plan-writer*.md 通配，导致派发义务被要求
// 在场于 tools: [] 且无派发权的 plan-writer-subagent-sp.md，并使新增平台与拓扑翻转无法自动纳入。
export const DERIVED_CLAUSES = [
  { id: 'dispatch-lease', text: '派发去重租约' },
  { id: 'lease-exclusive-readback', text: '写后立即回读核验首行' },
  { id: 'lease-identity-entropy', text: '严禁复用固定字面量' },
];

// 编排拓扑谓词：只描述路径形态，不枚举平台名（新增平台与拓扑翻转自动纳入推导）。
export const PLATFORM_GOVERNANCE_RE = /^([^/]+)\/AGENTS\.md$/;
export const PLATFORM_AGENT_FILE_RE = /^([^/]+)\/agents\/[^/]+\.md$/;
export const ORCHESTRATOR_AGENT_SUFFIX = 'agents/plan-writer-sp.md';

// —— 逐字闸门声明：plan-gate 用不含引号的片段，规避全角引号导致的不可确定比对 ——
export const GATES = [
  {
    id: 'plan-gate',
    parts: ['本次审批仅为计划审批——批准后不得直接执行', 'Git 集成需再单独授权。*'],
    expect: [/^zcode\/agents\/plan-writer[^/]*\.md$/, /^zcode\/agents\/plan-reviewer[^/]*\.md$/],
  },
  {
    id: 'pr-gate',
    parts: ['*本次审批仅为代码变更审查——审查通过不等于合入授权；合入、提交或推送需用户在审查通过后另行明确授权。*'],
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
];

// —— 配对等式：同一文件内 count(a) 必须等于 count(b)。
//    因 b 含子串 a，恒有 count(a) >= count(b)；等式成立 ⟺ 每一处 a 都是 b 形态。——
export const PAIRED = [
  {
    id: 'status-uall-complete',
    a: 'status --short',
    b: 'status --short -uall',
    // 作用域刻意**不收全量 skill 类**：`skills/pwsh-gnu-bridge/SKILL.md` 的 3 处
    // `git status --short`（:60/:79/:133）是「权限制度探针」与「只读探测写法」的语法示例，
    // `-uall` 与该技能目的无关，纳入即误红。`-uall` 只在承载审查职责的文件上有意义，
    // 故作用域与"审查者口径"对齐（3 份 AGENTS.md + 9 份平台代理 + 两份 plan-first 技能）。
    scope: [
      new RegExp(`^(?:${P})/AGENTS\\.md$`),
      new RegExp(`^(?:${P})/agents/[^/]+\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
];

// —— 平台私有调用标识：必含（非禁含） ——
export const REQUIRED_IDENTIFIERS = [
  { id: 'kilocode-task-param', platform: 'kilocode', role: 'plan-writer', text: 'subagent_type' },
  { id: 'codebuddy-task-param', platform: 'codebuddy', role: 'plan-writer', text: 'subagent_name' },
];
