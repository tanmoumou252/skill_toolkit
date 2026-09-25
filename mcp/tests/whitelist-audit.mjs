// whitelist-audit.mjs — ALLOW_KEYS 存量逐键审计表征钉住套件（只读裁决，零派生进程）。
// 性质 = 表征/钉住测试：无业务代码变更，故不适用经典验红；
//   首跑绿 = 钉住成功；任何"应拦"用例 FAIL = 审计发现（进报告发现区并另立计划修复）。
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '..', 'plan-governor.js');
const gov = createRequire(SERVER)(SERVER);

let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail !== undefined ? ' ' + detail : '')); };

const allow = gov.ALLOW_KEYS || [];
const deny = gov.DENY_KEYS || [];
const forbidden = gov.FORBIDDEN_KEYS || [];

check('audit-key-inventory', allow.length > 0 && deny.length > 0 && forbidden.length > 0,
  'allow=' + allow.length + ' deny=' + deny.length + ' forbidden=' + forbidden.length);

// 审计事实钉（首批：PR#1 已证写形态，防回漂）——应拦
const writeShaped = [
  'git branch -v probe-created',
  'git branch -vv probe-created',
  'git branch newbranch',
  'git branch --list -v',
  'git tag v1.0.0',
];
for (const c of writeShaped) check('audit-write-deny ' + c, gov.auditCommand(c).ok === false);

// 应放对照（只读形态不得误拒）
const readShaped = ['git branch', 'git branch -a', 'git branch -vv', 'git tag', 'git tag -l'];
for (const c of readShaped) check('audit-read-allow ' + c, gov.auditCommand(c).ok === true);

// 审计报告机器判据：报告为**受跟踪**测试夹具（fixtures/），键覆盖由逐行探针重跑派生（见下方 coverageOf），
//   不采信报告内任何自声明计数行。报告必须受 Git 跟踪：原落 `.kilo/`（整目录被 .gitignore 忽略）
//   会导致干净检出上本断言必红、`npm test --prefix mcp` 入口回归。
const reportPath = path.resolve(here, 'fixtures', 'whitelist-grammar-audit.md');
let reportText = '';
try { reportText = fs.readFileSync(reportPath, 'utf8'); } catch { reportText = ''; }
// 覆盖度判据由下方 coverageOf(reportText) 逐键探针重跑派生（audit-report-coverage-by-reprobe + 篡改控制），不再信任自声明 covered=total= 行。
// 覆盖度不得自声明：解析逐键表每行（6 列，第 2 列反引号键、第 5 列裁决、第 6 列反引号探针集），
//   对每探针实跑 gov.auditCommand：ALLOW 行须 ≥1 探针且全部 ok===true；DENY 行须 ≥1 探针且全部 ok===false。
//   键名与 ALLOW_KEYS 逐字相等（含 * 尾）才计覆盖；require 每个 allow 键被覆盖。
const allowSet = new Set(allow);
function coverageOf(text) {
  const covered = new Set();
  for (const row of text.split(/\r?\n/)) {
    const m = row.match(/^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|\s*[^|]*\|\s*[^|]*\|\s*(ALLOW|DENY)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    if (!allowSet.has(key)) continue;
    const want = m[2] === 'ALLOW';
    const probes = (m[3].match(/`[^`]+`/g) || []).map((p) => p.slice(1, -1));
    if (probes.length === 0) continue;
    if (probes.every((p) => gov.auditCommand(p).ok === want)) covered.add(key);
  }
  return covered;
}
const coveredKeys = coverageOf(reportText);
check('audit-report-coverage-by-reprobe', coveredKeys.size === allow.length,
  'covered=' + coveredKeys.size + '/' + allow.length + (coveredKeys.size !== allow.length ? ' missing: ' + [...allowSet].filter((k) => !coveredKeys.has(k)).join(',') : ''));
// 篡改控制（反假绿）：翻转夹具第 16 行（git tag 精确 DENY 键）裁决 DENY→ALLOW，其探针 `git tag v1.0.0`
//   实为 DENY ⇒ 该行不再计覆盖（覆盖 75）；自声明 covered=76 行原样在场 ⇒ 旧断言被骗而新断言必红，
//   证「不信任自声明」语义真实成立。replace 目标串逐字取自 fixtures:30（本会话 grep 实核）。
const tamperedRow = '| 16 | `git tag` | git | 写：`git tag <name>` | DENY | `git tag v1.0.0` |';
check('audit-coverage-row-target-present', reportText.includes(tamperedRow), reportText.includes(tamperedRow) ? 'fixture row 16 present' : 'fixture row 16 target missing');
const tampered = reportText.replace(tamperedRow, '| 16 | `git tag` | git | 写：`git tag <name>` | ALLOW | `git tag v1.0.0` |');
check('audit-coverage-detects-tampered-verdict', coverageOf(tampered).size === allow.length - 1,
  'tamperedCovered=' + coverageOf(tampered).size + ' expect=' + (allow.length - 1));

console.log(fail === 0 ? 'WHITELIST-AUDIT ALL OK' : 'WHITELIST-AUDIT FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);