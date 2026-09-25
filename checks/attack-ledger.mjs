// attack-ledger.mjs — 攻击面台账 / 复审格式行机械对账器（零外部依赖，ESM；复用同目录 CommonMark 围栏状态机）。
// 用法：node checks/attack-ledger.mjs --plan <plan.md> [--impl <f>] [--test <f>] [--report <f>]
//       node checks/attack-ledger.mjs --latest   （自动对账 .kilo/plans 最新时间戳计划 + review/ 最新影子报告）
// 语义红线：结构判定位（Files 节/台账节/台账行）只认围栏外行；标题容忍尾注且防前缀近似；
//   报告格式行检查不随"计划非执法类"短路；断言名绑定 check( 形态；探针回执含反引号命令字面量+退出码。
// 判据事实源=本文件常量与台账格式契约；扩展走代码变更审查链。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanFences } from './invariants.mjs';

export const ATTACK_CLASSES = [
  '展开与 token 边界改写',
  '参数位求值',
  '参数类型强转',
  '配置驱动外部执行',
  '链接与解析基准逃逸',
  '视图-执行语义分叉',
  '信任根入口',
];
export const ENFORCEMENT_FILES = ['mcp/plan-governor.js', 'mcp/webui.js', 'checks/attack-ledger.mjs'];

// —— 报告侧对账判据（复审报告的攻击配额不得自声明）——
// 攻击行登记锚＝ATTACKS 的计数事实源；新增方言＝代码变更走审查链。
//   line-row ：- 攻击行: 序号=<n> | …（兼容既有 - 台账行: 序号=<n> | …）
//   table-row：| A-<n> | …
// 两方言同一报告内禁止混用（混用即实数不可信）；序号重复即计数可灌水。
// 缩进容忍上限 3＝CommonMark 列表项合法缩进上限（≥4 空格语义为代码块，不计数，与围栏掩蔽同向）。
export const ATTACK_ROW_ANCHORS = [
  { id: 'line-row', re: /^[ \t]{0,3}-[ \t]*(?:攻击行|台账行)[ \t]*[:：][ \t]*序号=(\d+)[ \t]*\|/ },
  { id: 'table-row', re: /^[ \t]{0,3}\|[ \t]*A-(\d+)[ \t]*\|/ },
];
// 姿态标记一律「围栏外 + 行首」判定，且标记之后只允许冒号引导的说明：
//   ① 散文句内引用字面量（复述契约条款）不构成姿态声明，否则合规报告会被误判为零实弹并产出假红；
//   ② 行首解释句（如「ECHO-RISK 语义说明：…」）同样不构成标注，否则人类明示闸被空转满足。
// 两枚标记严格性必须对称，容忍列表符与加粗装饰。
export const OFFLINE_LINE_RE = /^(?:-[ \t]*)?(?:\*\*)?PROBE=OFFLINE(?:\*\*)?[ \t]*(?:[:：].*)?$/;
export const ECHO_LINE_RE = /^(?:-[ \t]*)?(?:\*\*)?ECHO-RISK(?:\*\*)?[ \t]*(?:[:：].*)?$/;
// 实弹回执：反引号命令字面量与退出码在 40 字符内共现（与计划侧「探针回执」判据同口径）。
export const PROBE_RECEIPT_RE = /`[^`]+`[\s\S]{0,40}?(?:exit\s*(?:code)?|退出码)[\s:：=]*-?\d+|(?:exit\s*(?:code)?|退出码)[\s:：=]*-?\d+[\s\S]{0,40}?`[^`]+`/i;
// E 清单编号：E1 / E-1 / E-13 / E-r3-2 等形态。带 g 旗标，仅供 String.match 取全集，
// 严禁改用 .test（lastIndex 状态残留会跨报告串扰）。
const E_ID_RE = /\bE(?:[-#][A-Za-z0-9]+)?[-#]?\d+\b/g;

function lineView(text) {
  const lines = text.split(/\r?\n/);
  const { pairs, unclosed } = scanFences(text);
  const fenced = new Array(lines.length).fill(false);
  for (const p of pairs) {
    for (let i = Math.max(0, p.openLine - 1); i <= Math.min(p.closeLine - 1, lines.length - 1); i++) fenced[i] = true;
  }
  for (const u of unclosed) {
    for (let i = Math.max(0, u - 1); i < lines.length; i++) fenced[i] = true;
  }
  return { lines, fenced, unclosed };
}

function sectionBody(text, headRe) {
  const { lines, fenced } = lineView(text);
  let s = -1;
  for (let i = 0; i < lines.length; i++) if (!fenced[i] && headRe.test(lines[i])) { s = i; break; }
  if (s === -1) return null;
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (!fenced[i] && /^## (?!#)/.test(lines[i])) { e = i; break; }
  return { lines: lines.slice(s + 1, e), fenced: fenced.slice(s + 1, e), start: s + 1 };
}

function filesSectionOf(text) {
  const sec = sectionBody(text, /^## Files(?![\w-])/);
  return sec ? sec.lines.join('\n') : '';
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function checkLedgerRows(planText, opts, v) {
  const { implText = null, testText = null } = opts;
  const sec = sectionBody(planText, /^## 攻击面台账(?![\w-])/);
  if (!sec) { v.push({ msg: '安全执法类计划缺少「## 攻击面台账」节' }); return; }
  const bounds = [];
  for (let i = 0; i < sec.lines.length; i++) if (!sec.fenced[i] && /^- 台账行[ \t]*$/.test(sec.lines[i])) bounds.push(i);
  if (bounds.length === 0) v.push({ msg: '台账节在场但无「- 台账行」记录' });
  const seen = new Set();
  for (let b = 0; b < bounds.length; b++) {
    const chunk = sec.lines.slice(bounds[b], b + 1 < bounds.length ? bounds[b + 1] : sec.lines.length).join('\n');
    const get = (key) => {
      const m = chunk.match(new RegExp('^[ \\t]*-[ \\t]*' + escapeRe(key) + '[：:]\\s*(.+)$', 'm'));
      return m ? m[1].trim() : null;
    };
    const cls = get('类别');
    const disposal = get('处置');
    const att = get('攻击样本');
    const ctrl = get('对照样本');
    const assertName = get('断言名');
    const probe = get('探针回执');
    const evid = get('证据');
    const tag = '台账行[' + (cls || '?') + ']';
    if (!cls || !ATTACK_CLASSES.includes(cls)) { v.push({ msg: tag + ' 类别不在登记类别集：' + cls }); continue; }
    seen.add(cls);
    if (!disposal) { v.push({ msg: tag + ' 处置缺失' }); continue; }
    if (disposal.startsWith('exclude')) {
      if (!evid || !/[\w./\\-]+:\d+/.test(evid)) v.push({ msg: tag + ' 排除行缺 路径:行号 证据' });
      continue;
    }
    if (!disposal.startsWith('block@')) { v.push({ msg: tag + ' 处置须为 block@<闸名> 或 exclude: <理由>' }); continue; }
    const gate = disposal.slice('block@'.length).trim();
    if (gate.length < 2) { v.push({ msg: tag + ' block@ 闸名为空或过短：' + gate }); }
    else if (implText === null) { v.push({ msg: tag + ' 未传 --impl，闸名无法机械对账（fail-closed）' }); }
    else if (!implText.includes(gate)) { v.push({ msg: tag + ' 闸名未在实现文件逐字检索到：' + gate }); }
    if (!att || !ctrl) v.push({ msg: tag + ' 拦截行缺攻击样本或对照样本' });
    if (!probe || !/(exit\s*(code)?|退出码)[\s:：=]*-?\d+/i.test(probe) || !/`[^`]+`/.test(probe)) {
      v.push({ msg: tag + ' 探针回执缺失，或未含反引号命令字面量与退出码' });
    }
    if (!assertName) { v.push({ msg: tag + ' 断言名缺失' }); }
    else if (testText === null) { v.push({ msg: tag + ' 未传 --test，断言名无法机械对账（fail-closed）' }); }
    else if (!new RegExp('check\\(\\s*[\'"`]' + escapeRe(assertName)).test(testText)) {
      v.push({ msg: tag + ' 断言名未在测试文件以 check( 调用形态逐字检索到：' + assertName });
    }
  }
  for (const c of ATTACK_CLASSES) if (!seen.has(c)) v.push({ msg: '台账缺类别行：' + c });
}

// 围栏外「末次」行锚定取值：契约即「报告尾部固定行」，故取最后一击；
// 围栏掩蔽防「散文先塞 ATTACKS=9 遮蔽尾部真值」与「围栏内示例灌水」。
function lastAnchoredLine(text, re) {
  const { lines, fenced } = lineView(text);
  let hit = null;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const m = lines[i].match(re);
    if (m) hit = { m, line: i + 1 };
  }
  return hit;
}

// 姿态标记：围栏外 + 行首（容忍列表符与加粗装饰，其后仅允许冒号引导的说明）。
function hasMarkerLine(text, re) {
  const { lines, fenced } = lineView(text);
  return lines.some((l, i) => !fenced[i] && re.test(l.trim()));
}

// 登记攻击行点数：围栏外逐行匹配登记锚，返回 { anchor, seq, line } 序列。
export function countAttackRows(reportText) {
  const { lines, fenced } = lineView(reportText);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    for (const a of ATTACK_ROW_ANCHORS) {
      const m = lines[i].match(a.re);
      if (m) { hits.push({ anchor: a.id, seq: Number(m[1]), line: i + 1 }); break; }
    }
  }
  return hits;
}

export function checkReportFormat(reportText, v) {
  if (reportText === null || reportText === undefined) return;
  // ⓪ 未闭合围栏使其后内容整段被掩蔽（含尾部真格式行）⇒ 判定不可信，直接判红（fail-closed）。
  const { unclosed } = lineView(reportText);
  if (unclosed.length > 0) {
    v.push({ msg: '复审报告含未闭合代码围栏（第 ' + unclosed.join('、') + ' 行起）：其后内容被整段掩蔽，格式行与攻击行判定不可信' });
  }
  const atkHit = lastAnchoredLine(reportText, /^ATTACKS=(\d+)$/);
  const penHit = lastAnchoredLine(reportText, /^PENETRATIONS=(\d+)$/);
  const verdictHit = lastAnchoredLine(reportText, /^VERDICT:\s*(GO|NO-GO|ESCALATE_TO_HUMAN)$/);
  if (!atkHit) v.push({ msg: '复审报告缺 ATTACKS= 行锚定格式行（围栏外独立整行）' });
  if (!penHit) v.push({ msg: '复审报告缺 PENETRATIONS= 行锚定格式行（围栏外独立整行）' });
  if (!verdictHit) v.push({ msg: '复审报告缺 VERDICT: 行锚定格式行（围栏外独立整行）' });
  const isGo = !!verdictHit && verdictHit.m[1] === 'GO';
  const echo = hasMarkerLine(reportText, ECHO_LINE_RE);
  const offline = hasMarkerLine(reportText, OFFLINE_LINE_RE);
  const nAtk = atkHit ? Number(atkHit.m[1]) : null;
  const nPen = penHit ? Number(penHit.m[1]) : null;
  // ① 攻击配额不得自声明：声明值必须等于围栏外登记行实数（单一方言、序号不重复）。
  if (nAtk !== null) {
    const rows = countAttackRows(reportText);
    const dialects = [...new Set(rows.map((r) => r.anchor))];
    if (dialects.length > 1) v.push({ msg: '攻击行锚定方言混用（' + dialects.join('、') + '）：实数对账不可信' });
    if (nAtk > 0 && rows.length === 0) {
      v.push({ msg: 'ATTACKS=' + nAtk + ' 为自声明：报告无任一登记锚定攻击行（- 攻击行: 序号=N | … 或 | A-N |）' });
    } else if (rows.length !== nAtk) {
      v.push({ msg: 'ATTACKS=' + nAtk + ' 与攻击行实数 ' + rows.length + ' 不一致（攻击配额不得自声明）' });
    }
    const seqs = rows.map((r) => r.seq);
    if (new Set(seqs).size !== seqs.length) v.push({ msg: '攻击行序号重复：计数可灌水' });
    if (nAtk === 0 && isGo && !echo) v.push({ msg: '零攻击 GO 未标注 ECHO-RISK（回声放行必须明示人类）' });
  }
  // ② 击穿必须入 E 清单，且计数不得自相矛盾。
  if (nAtk !== null && nPen !== null && nPen > nAtk) v.push({ msg: 'PENETRATIONS=' + nPen + ' 大于 ATTACKS=' + nAtk + '：计数自相矛盾' });
  if (nPen !== null && nPen > 0 && new Set(reportText.match(E_ID_RE) || []).size === 0) {
    v.push({ msg: 'PENETRATIONS=' + nPen + ' > 0 但报告无 E 清单编号（击穿必须入 E 清单）' });
  }
  // ③ 实弹姿态必须可核：有回执，或独立成行自认零实弹；零实弹 GO 与回声放行同级。
  //    前置 nAtk>0：零攻击报告本无回执可言，否则与 ECHO-RISK 判据自相矛盾。
  if (nAtk === null || nAtk > 0) {
    if (!offline && !PROBE_RECEIPT_RE.test(reportText)) {
      v.push({ msg: '复审报告既无实弹探针回执（反引号命令字面量+退出码）也未独立成行标注 PROBE=OFFLINE' });
    }
    if (offline && isGo && !echo) v.push({ msg: '零实弹（PROBE=OFFLINE）GO 未标注 ECHO-RISK（纸面放行必须明示人类）' });
  }
}

export function attackLedger(planText, opts = {}) {
  const v = [];
  const fsec = filesSectionOf(planText);
  if (ENFORCEMENT_FILES.some((f) => fsec.includes(f))) checkLedgerRows(planText, opts, v);
  checkReportFormat(opts.reportText ?? null, v);
  return v;
}

function newestMd(dir, pred) {
  try {
    const xs = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') && pred(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return xs.length > 0 ? path.join(dir, xs[0].f) : null;
  } catch { return null; }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
  let planPath = arg('--plan'), implPath = arg('--impl'), testPath = arg('--test'), reportPath = arg('--report');
  let latestMode = false;
  if (process.argv.includes('--latest')) {
    latestMode = true;
    planPath = newestMd(path.join(root, '.kilo', 'plans'), (f) => /^\d{8}-\d{6}-.+\.md$/.test(f));
    if (!planPath) { console.log('ATTACK-LEDGER EXIT-2 .kilo/plans 下无时间戳命名计划文件'); process.exit(2); }
    const planTextPre = fs.readFileSync(planPath, 'utf8');
    const fsec = filesSectionOf(planTextPre);
    const impls = ENFORCEMENT_FILES.filter((f) => fsec.includes(f)).map((f) => path.join(root, f));
    implPath = impls.length > 0 ? impls : null;
    const tm = fsec.match(/`([^`]*(?:tests|selftest)[^`]*\.mjs)`/);
    testPath = tm ? path.join(root, tm[1]) : null;
    const base = path.basename(planPath, '.md');
    reportPath = newestMd(path.join(root, '.kilo', 'plans', 'review'), (f) => f.startsWith(base) && f.endsWith('-shadow-plan.md'));
    console.log('LATEST-PLAN: ' + path.relative(root, planPath));
    console.log('IMPL: ' + (implPath ? implPath.map((p) => path.relative(root, p)).join(',') : 'none') + ' TEST: ' + (testPath ? path.relative(root, testPath) : 'none') + ' REPORT: ' + (reportPath ? path.basename(reportPath) : 'none'));
  }
  if (!planPath) { console.log('用法：node checks/attack-ledger.mjs --plan <plan.md> [--impl <f>] [--test <f>] [--report <f>] 或 --latest'); process.exit(2); }
  const readOpt = (p) => (Array.isArray(p) ? p.map((x) => fs.readFileSync(x, 'utf8')).join('\n') : (p ? fs.readFileSync(p, 'utf8') : null));
  const violations = attackLedger(fs.readFileSync(planPath, 'utf8'), {
    implText: readOpt(implPath),
    testText: readOpt(testPath),
    reportText: readOpt(reportPath),
  });
  if (latestMode && !reportPath && violations.length === 0) {
    const isSec = ENFORCEMENT_FILES.some((f) => filesSectionOf(fs.readFileSync(planPath, 'utf8')).includes(f));
    if (isSec) violations.push({ msg: '--latest 模式下安全执法类计划尚无影子报告（报告在场是 GO 前置）' });
  }
  for (const x of violations) console.log('FAIL ' + x.msg);
  console.log(violations.length === 0 ? 'ATTACK-LEDGER ALL OK' : 'ATTACK-LEDGER FAILURES=' + violations.length);
  process.exit(violations.length === 0 ? 0 : 1);
}