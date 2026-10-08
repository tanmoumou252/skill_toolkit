// 常驻不变式检查器（机制层）：纯函数式检测器 + 全量扫描入口。
// 设计纪律：只报"违反即无歧义缺陷"的事实；不做语义/文风判断。
// 全部检测器以 [{ path, text }] 为输入，便于自测夹具直接构造（不依赖磁盘）。
import {
  AGENT_KEYS,
  SKILL_KEYS,
  PRIVATE_AGENT_KEYS,
  KILOCODE_FORBIDDEN_AGENT_KEYS,
  KILOCODE_MAP_KEYS,
  KILOCODE_REVIEWER_ROLES,
  KILOCODE_MAIN_DENY_KEYS,
  KILOCODE_SUBAGENT_ALLOW_KEY,
  CLASSES,
  CLAUSES,
  DERIVED_CLAUSES,
  PLATFORM_GOVERNANCE_RE,
  PLATFORM_AGENT_FILE_RE,
  ORCHESTRATOR_AGENT_SUFFIX,
  GATES,
  PAIRED,
  REQUIRED_IDENTIFIERS,
} from './registry.mjs';

export const STRUCTURAL_IDS = [
  'fence-all-closed',
  'frontmatter-absent',
  'frontmatter-present',
  'frontmatter-terminated',
  'frontmatter-keys-whitelist',
  'frontmatter-keys-required',
  'platform-key-leak',
  'kilocode-m2-no-edit-key',
  'kilocode-m7-bash-must-be-map',
  'kilocode-reviewer-main-deny',
  'kilocode-reviewer-subagent-allow',
  'clause-target-missing',
  'gate-target-missing',
  'identifier-target-missing',
  'dispatch-carrier-derived',
];

export function allInvariantIds() {
  return [
    ...STRUCTURAL_IDS,
    ...ENTRY_GATE_IDS,
    ...FRESHNESS_GATE_IDS,
    ...CLAUSES.map((c) => 'clause-' + c.id),
    ...DERIVED_CLAUSES.map((c) => 'clause-' + c.id),
    ...GATES.map((g) => 'gate-' + g.id),
    ...PAIRED.map((p) => p.id),
    ...REQUIRED_IDENTIFIERS.map((r) => 'identifier-' + r.id),
  ];
}

export function countOccurrences(text, sub) {
  if (!sub) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const at = text.indexOf(sub, i);
    if (at === -1) return n;
    n += 1;
    i = at + sub.length;
  }
}

export function classify(path) {
  for (const c of CLASSES) if (c.re.test(path)) return c;
  return null;
}

export function platformOf(path) {
  const head = path.split('/')[0];
  return ['kilocode', 'codebuddy', 'zcode'].includes(head) ? head : null;
}

export function roleOf(path) {
  const base = path.split('/').pop();
  for (const r of ['plan-writer', 'plan-reviewer', 'pr-reviewer']) {
    if (base.startsWith(r)) return r;
  }
  return null;
}

// —— 派发权载体派生（按编排拓扑，不枚举平台名）——
// 平台根＝现场文件集中出现 <dir>/AGENTS.md 或 <dir>/agents/<file>.md 的 dir；深一层即非平台根
// （故 skills/<name>/SKILL.md 不构成平台根），从而新增平台自动纳入推导。
export function platformRoots(files) {
  const roots = new Set();
  for (const f of files) {
    const gov = PLATFORM_GOVERNANCE_RE.exec(f.path);
    if (gov) roots.add(gov[1]);
    const ag = PLATFORM_AGENT_FILE_RE.exec(f.path);
    if (ag) roots.add(ag[1]);
  }
  return [...roots].sort();
}

// 扫描根差集（纯函数，只吃目录名数组）：SCAN_ROOTS 硬编码意味着新顶层平台目录从不被 walk、
// 其文件对全部闸门不可达；本函数把"未登记顶层目录"显式化，由扫描入口大声报错（fail-loud）。
// 点目录（. 开头的内部内存）不触发；非平台工具根与本地构建产物根由入口经 scanEntryDirNames
// 单点过滤后再传入——本函数只做 SCAN_ROOTS 差集，不重复登记非平台根（双处过滤即口径漂移面）。
export function unscannedRoots(topLevelDirNames, scanRoots) {
  const known = new Set(scanRoots);
  return topLevelDirNames.filter((n) => !n.startsWith('.') && !known.has(n)).sort();
}

// —— 扫描根登记常量（机制层单一事实源，run.mjs 与 selftest 共用，防名实漂移）——
// NON_PLATFORM_ROOTS＝显式登记的非平台工具根；BUILD_ARTIFACT_ROOTS＝gitignore 的本地构建产物
// 根（如任何 checkout 跑过包管理器都会出现的 node_modules），不构成"未登记平台目录"。
// 零依赖纪律：不引 child_process 调 git 做 gitignore 语义过滤（子进程使 checks 套件脱离纯函数
// 可测域、引入平台二进制依赖与输出解析脆弱面），采用显式登记表 + 漂移断言同级兜底。
export const SCAN_ROOTS = ['kilocode', 'codebuddy', 'zcode', 'skills'];
export const NON_PLATFORM_ROOTS = ['checks', 'mcp', 'spec'];
export const BUILD_ARTIFACT_ROOTS = ['node_modules'];
export const ENTRY_GATE_IDS = ['unscanned-root-directory', 'unclassified-platform-file'];
// 新鲜度闸 id 登记（单一事实源）：检测逻辑由 run.mjs 消费 freshnessFailures 承载，id 登记于此使
// allInvariantIds() 正向枚举含该闸（run.mjs 零违规时输出 OK <id> 行），杜绝绿色盲区。
export const FRESHNESS_GATE_IDS = ['generated-product-stale'];

// 入口目录名过滤（纯函数）：点目录（内部内存）、显式登记的非平台工具根与本地构建产物根
// 都不是"未登记扫描根"；其余顶层目录全部进入 unscannedRoots 差集判定。
export function scanEntryDirNames(topLevelDirNames) {
  const skip = new Set([...NON_PLATFORM_ROOTS, ...BUILD_ARTIFACT_ROOTS]);
  return topLevelDirNames.filter((n) => !n.startsWith('.') && !skip.has(n));
}

// 未登记平台 fail-loud 检测（纯函数，只吃路径，不读磁盘）：平台治理/代理形态路径命中
// 通用拓扑正则却未被 CLASSES 登记分类 ⇒ 已扫描根内该类文件在 classify 过滤面被静默
// 丢弃、全部闸门失效；本函数把该态显式化，由扫描入口大声报错（fail-loud）。
// 触发域收窄声明：本函数输入面=已扫描根内文件；未登记顶层目录由 unscannedRoots 先行拦截。
export function unclassifiedPlatformFiles(files) {
  return files
    .filter((f) => (PLATFORM_GOVERNANCE_RE.test(f.path) || PLATFORM_AGENT_FILE_RE.test(f.path)) && classify(f.path) === null)
    .map((f) => f.path);
}

// 派生规则：平台存在编排器代理文件 <plat>/agents/plan-writer-sp.md ⇒ 派发权载体＝该 agent 文件；
// 否则（子代理-only 平台，父会话即编排器）⇒ 派发权载体＝<plat>/AGENTS.md。精确等值判定，
// 不用「前缀通配」——前缀通配会把派发义务扩散到无派发权的兄弟子代理文件上。
export function deriveDispatchCarrier(files, platform) {
  const paths = new Set(files.map((f) => f.path));
  const orchestrator = `${platform}/${ORCHESTRATOR_AGENT_SUFFIX}`;
  return paths.has(orchestrator) ? orchestrator : `${platform}/AGENTS.md`;
}

// —— 围栏状态机（CommonMark 语义）——
// 开启：行首 0~3 空格后的连续 >=3 个 ` 或 ~
// 闭合：同字符、长度 >= 开启长度、且标记后除空白外无内容（无 info string）
// 围栏内部的其它行一律按内容处理，不开启新围栏（故 4 反引号可安全包住 3 反引号）
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

export function scanFences(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  const stack = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) continue;
    const marks = m[2];
    const info = m[3];
    const ch = marks[0];
    const len = marks.length;
    // CommonMark：反引号围栏的 info string 不得含反引号（含则该行是行内代码，既不开启也不闭合围栏）；
    // 波浪号围栏无此限制（info 可含反引号）。
    if (ch === '`' && info.includes('`')) continue;
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (ch === top.ch && len >= top.len && info.trim() === '') {
        pairs.push({ ...top, closeLine: i + 1 });
        stack.pop();
      }
      continue;
    }
    stack.push({ ch, len, info: info.trim(), openLine: i + 1 });
  }
  return { pairs, unclosed: stack.map((f) => f.openLine) };
}

// —— frontmatter：缩进感知浅解析（足以区分标量叶子与嵌套 map） ——
export function parseYamlish(lines) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  let blockScalarIndent = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    const t = raw.trim();
    const at = t.indexOf(':');
    if (at <= 0) continue;
    const key = t.slice(0, at).trim().replace(/^["']|["']$/g, '');
    const val = t.slice(at + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (val === '') {
      const node = {};
      parent[key] = node;
      stack.push({ indent, node });
    } else {
      parent[key] = val;
      if (val === '>' || val === '|' || val === '>-' || val === '|-' || val === '>+' || val === '|+') {
        blockScalarIndent = indent;
      }
    }
  }
  return root;
}

export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if ((lines[0] || '').trim() !== '---') return { present: false };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { present: true, terminated: false, endLine: -1, keys: [], tree: {} };
  const tree = parseYamlish(lines.slice(1, endIdx));
  return { present: true, terminated: true, endLine: endIdx + 1, keys: Object.keys(tree), tree };
}

export function runAll(files) {
  const v = [];
  const push = (id, path, msg) => v.push({ id, path, msg });

  for (const f of files) {
    const cls = classify(f.path);
    if (!cls) continue;

    // F1 围栏全闭合
    const fence = scanFences(f.text);
    if (fence.unclosed.length > 0) {
      push('fence-all-closed', f.path, `未闭合围栏开于行: ${fence.unclosed.join(', ')}`);
    }

    // F2 frontmatter 在场 / 缺席
    const fm = parseFrontmatter(f.text);
    if (cls.frontmatter === 'absent' && fm.present) {
      push('frontmatter-absent', f.path, '该类文件不应含 frontmatter');
    }
    if (cls.frontmatter === 'present') {
      if (!fm.present) {
        push('frontmatter-present', f.path, '缺少 frontmatter');
        continue;
      }
      if (!fm.terminated) {
        push('frontmatter-terminated', f.path, 'frontmatter 未以 --- 收口');
        continue;
      }

      // F3 键集：白名单外 / 必需缺失
      const spec = cls.id === 'skill' ? SKILL_KEYS : AGENT_KEYS[platformOf(f.path) || ''];
      if (spec) {
        const extra = fm.keys.filter((k) => !spec.whitelist.includes(k));
        if (extra.length > 0) push('frontmatter-keys-whitelist', f.path, `白名单外键: ${extra.join(', ')}`);
        const missing = spec.required.filter((k) => !fm.keys.includes(k));
        if (missing.length > 0) push('frontmatter-keys-required', f.path, `缺少必需键: ${missing.join(', ')}`);
      }

      if (cls.id === 'platform-agent') {
        const plat = platformOf(f.path);

        // F4 平台私有键互斥（结构化面）
        for (const [owner, keys] of Object.entries(PRIVATE_AGENT_KEYS)) {
          if (owner === plat) continue;
          const leak = keys.filter((k) => fm.keys.includes(k));
          if (leak.length > 0) push('platform-key-leak', f.path, `混入 ${owner} 私有键: ${leak.join(', ')}`);
        }

        // F5 kilocode 实测雷区（公理 M2 / M7）
        if (plat === 'kilocode') {
          const permTree = fm.tree.permission && typeof fm.tree.permission === 'object' ? fm.tree.permission : {};
          const bad = KILOCODE_FORBIDDEN_AGENT_KEYS.filter((k) => fm.keys.includes(k) || Object.prototype.hasOwnProperty.call(permTree, k));
          if (bad.length > 0) push('kilocode-m2-no-edit-key', f.path, `MD 内不得声明: ${bad.join(', ')}`);
          for (const k of KILOCODE_MAP_KEYS) {
            const inPerm = fm.tree.permission && typeof fm.tree.permission === 'object' ? fm.tree.permission[k] : undefined;
            const holder = inPerm === undefined ? fm.tree[k] : inPerm;
            if (typeof holder === 'string') {
              push('kilocode-m7-bash-must-be-map', f.path, `${k} 不得写成标量（会触发工具整体裁剪）`);
            }
          }
        }

        // F6 kilocode 复审者的 main 实例全 deny + subagent allow
        if (plat === 'kilocode' && KILOCODE_REVIEWER_ROLES.includes(roleOf(f.path))) {
          const perm = fm.tree.permission && typeof fm.tree.permission === 'object' ? fm.tree.permission : {};
          const notDeny = KILOCODE_MAIN_DENY_KEYS.filter((k) => perm[k] !== 'deny');
          if (notDeny.length > 0) push('kilocode-reviewer-main-deny', f.path, `main 实例键未 deny: ${notDeny.join(', ')}`);
          if (perm[KILOCODE_SUBAGENT_ALLOW_KEY] !== 'allow') {
            push('kilocode-reviewer-subagent-allow', f.path, `缺少 ${KILOCODE_SUBAGENT_ALLOW_KEY}: allow`);
          }
        }
      }
    }

    // F7 配对等式
    for (const p of PAIRED) {
      if (!p.scope.some((re) => re.test(f.path))) continue;
      const a = countOccurrences(f.text, p.a);
      const b = countOccurrences(f.text, p.b);
      if (a !== b) push(p.id, f.path, `${p.a} 出现 ${a} 次，其中带 -uall 的仅 ${b} 次`);
    }
  }

  // F8 条款必含集
  for (const c of CLAUSES) {
    for (const re of c.expect) {
      const hit = files.filter((f) => re.test(f.path));
      if (hit.length === 0) push('clause-target-missing', String(re), '该模式未匹配到任何文件');
      for (const f of hit) {
        if (!f.text.includes(c.text)) push('clause-' + c.id, f.path, `缺少必含条款: ${c.text}`);
      }
    }
  }

  // F8b 派发权载体派生（dispatch-carrier-derived）：租约三闸的必含载体由编排拓扑现场推导，
  // 不采用平台名硬编码，也不用 */agents/plan-writer*.md 通配（该通配会把派发义务要求在场于
  // tools: [] 且无派发权的 plan-writer-subagent-sp.md）。载体缺场即判红（fail-closed）：
  // 治理文件被删或新平台漏配时，租约义务不得静默消失（残差竞态会随之复发）。
  for (const platform of platformRoots(files)) {
    const carrier = deriveDispatchCarrier(files, platform);
    const hit = files.filter((f) => f.path === carrier);
    if (hit.length === 0) {
      // 缺场去重：每平台只报 1 条（旧实现随条款循环重复上报 3 条同路径违规）。
      push('dispatch-carrier-derived', carrier, `派发权载体缺场（平台 ${platform}）：${carrier}`);
      continue;
    }
    for (const c of DERIVED_CLAUSES) {
      for (const f of hit) {
        if (!f.text.includes(c.text)) push('clause-' + c.id, f.path, `缺少必含条款: ${c.text}`);
      }
    }
  }

  // F9 闸门声明逐字（片段）
  for (const g of GATES) {
    for (const re of g.expect) {
      const hit = files.filter((f) => re.test(f.path));
      if (hit.length === 0) push('gate-target-missing', String(re), '该模式未匹配到任何文件');
      for (const f of hit) {
        const missing = g.parts.filter((part) => !f.text.includes(part));
        if (missing.length > 0) push('gate-' + g.id, f.path, `闸门声明不完整，缺片段: ${missing.join(' | ')}`);
      }
    }
  }

  // F10 平台私有调用标识必含
  for (const r of REQUIRED_IDENTIFIERS) {
    const hit = files.filter(
      (f) => classify(f.path)?.id === 'platform-agent' && platformOf(f.path) === r.platform && roleOf(f.path) === r.role,
    );
    if (hit.length === 0) push('identifier-target-missing', `${r.platform}/${r.role}`, '未匹配到文件');
    for (const f of hit) {
      if (!f.text.includes(r.text)) push('identifier-' + r.id, f.path, `缺少平台私有标识: ${r.text}`);
    }
  }

  return v;
}
