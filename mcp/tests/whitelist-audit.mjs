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

// 审计报告机器判据：报告为**受跟踪**测试夹具（fixtures/），键覆盖自证行须与 ALLOW_KEYS.length 相等
//   （自证行的行级真实性由 PR 审查兜底）。报告必须受 Git 跟踪：原落 `.kilo/`（整目录被 .gitignore 忽略）
//   会导致干净检出上本断言必红、`npm test --prefix mcp` 入口回归。
const reportPath = path.resolve(here, 'fixtures', 'whitelist-grammar-audit.md');
let reportText = '';
try { reportText = fs.readFileSync(reportPath, 'utf8'); } catch { reportText = ''; }
const cov = reportText.match(/covered=(\d+)\s+total=(\d+)/);
check('audit-report-covered-equals-keys', !!cov && Number(cov[1]) === allow.length && Number(cov[2]) === allow.length,
  cov ? 'covered=' + cov[1] + ' total=' + cov[2] + ' keys=' + allow.length : 'report missing');

console.log(fail === 0 ? 'WHITELIST-AUDIT ALL OK' : 'WHITELIST-AUDIT FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);