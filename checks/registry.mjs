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
  'plan-governor-main_write_plan',
  'plan-governor-main_write_review_report',
  'plan-governor-main_write_pr_review_report',
];
export const KILOCODE_SUBAGENT_ALLOW_KEY = 'plan-governor-subagent_exec_guarded_command';

const P = 'kilocode|codebuddy|zcode';

// —— 散文面：必含条款（模式驱动的 required set：命中该模式的每个文件都必须含该串） ——
export const CLAUSES = [
  {
    id: 'no-green-no-start',
    text: '未见红严禁开工',
    expect: [
      new RegExp(`^(?:${P})/AGENTS\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
  {
    id: 'review-mode-dual',
    text: 'MODE=cumulative',
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`),
      /^skills\/zcode-plan-first\/SKILL\.md$/,
    ],
  },
  {
    id: 'escalate-to-human',
    text: 'ESCALATE_TO_HUMAN',
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
  {
    id: 'rework-human-clean',
    text: 'REWORK=HUMAN_CLEAN',
    expect: [
      new RegExp(`^(?:${P})/AGENTS\\.md$`),
      new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`),
      /^skills\/zcode-plan-first\/SKILL\.md$/,
    ],
  },
  {
    id: 'untracked-iron-law',
    text: '未跟踪新文件铁律',
    expect: [new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'adversarial-imagining',
    text: '对抗性破坏假想',
    expect: [new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`)],
  },
  {
    id: 'shape-demo-wording',
    text: '形态示范',
    expect: [new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`)],
  },
  {
    id: 'first-wave-concurrency',
    text: '首波并发',
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      /^skills\/(?:zcode-plan-first|plan-file-first)\/SKILL\.md$/,
    ],
  },
  {
    id: 'report-path-marker',
    text: '报告路径：',
    expect: [
      new RegExp(`^(?:${P})/agents/plan-writer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/plan-reviewer[^/]*\\.md$`),
      new RegExp(`^(?:${P})/agents/pr-reviewer[^/]*\\.md$`),
      /^skills\/zcode-plan-first\/SKILL\.md$/,
    ],
  },
];

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
