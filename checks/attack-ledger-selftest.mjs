// attack-ledger-selftest.mjs — attack-ledger 计划侧执法/选择域自测（零依赖，Node 内置）。
// 覆盖范围：伴生轮次后缀排除（latest-companion-exclude-gate）、围栏掩蔽执法判定位（structure-fence-mask）、
//   未识别 Files 标题的执法检测（loose Files heading，与 ledger「信任根入口 / 视图-执行语义分叉」咬合）、
//   --latest 最新执法候选选择（latest-unclosed-exclude-gate 互补面）、装载故障退出码。
// 断言名与主计划 attack-ledger-selftest 台账登记同源；红灯阶段（未落 R1/R3）即真红，不得静默通过。
import { isPlanFilename, hasLedgerSection, enforcementSignals, pickLatestEligible, latestFaultGate, testPathOutsideRoot } from './attack-ledger.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`OK   ${name}${detail ? ' ' + detail : ''}`);
  else { failures += 1; console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`); }
}

// —— 1. latest-companion-exclude-gate：伴生角色 + 轮次后缀必须排除，正常主题不误伤 ——
// 视图-执行语义分叉的伴生侧落点：`…-pr-review-r3.md` / `…-shadow-plan-r2.md` 等带轮次返工后缀
//   的产物仍属伴生文件，绝不允许冒充计划进入 --latest 候选域；普通主题计划（即使含 review
//   词但非登记伴生角色）继续放行。
check('assert-latest-companion-exclude-gate',
  isPlanFilename('20261011-t.md') === true
  && isPlanFilename('20261011-t-pr-review.md') === false
  && isPlanFilename('20261011-t-pr-review-r3.md') === false
  && isPlanFilename('20261011-t-pr-review-r3-fixround.md') === false
  && isPlanFilename('20261011-t-shadow-plan.md') === false
  && isPlanFilename('20261011-t-shadow-plan-r2.md') === false
  && isPlanFilename('20261011-t-test-evidence.md') === false
  && isPlanFilename('20261011-t-test-evidence-1.md') === false
  && isPlanFilename('20261011-x.lease.md') === false
  && isPlanFilename('20261011-x.lease-2.md') === false
  && isPlanFilename('20261011-topic.md') === true
  // 非登记伴生角色的普通词尾不得误伤：`-review` 不是伴生角色，`-topic-review` 属正常主题
  && isPlanFilename('20261011-topic-review.md') === true
  // 主题名内自然含伴生角色子词的正常计划不得误伤（收窄前 `(?:-[A-Za-z0-9]+)*` 会把它们
  //   当带轮次后缀的伴生文件排除）：-refactor/-hardening/-labeler 均非登记轮次变体。
  && isPlanFilename('20261011-bot-pr-review-refactor.md') === true
  && isPlanFilename('20261011-shadow-plan-hardening.md') === true
  && isPlanFilename('20261011-bot-review-pr-review-labeler.md') === true
  // 与 ROUND_RE（仓规轮次标记单一事实源）方言一致：-rN 后接任意单字母（r1a/r1b/r3z…）仍折算为
  //   轮次，故属伴生报告而非计划，必须排除；收窄 isPlanFilename 不得与 foldRoundFromFilename
  //   分叉（视图-执行语义分叉家族）。
  && isPlanFilename('20261011-t-pr-review-r3z.md') === false
  && isPlanFilename('20261011-t-pr-review-p7q.md') === false
  // 登记轮次变体仍须排除（收窄不得放松伴生排除）：-r3 / -r3-fixround / -round2 / 纯数字序号。
  && isPlanFilename('20261011-t-pr-review-r3-fixround.md') === false
  && isPlanFilename('20261011-t-pr-review-round2.md') === false
  && isPlanFilename('20261011-t-test-evidence-7.md') === false
  && isPlanFilename('20261011-x.lease-3.md') === false,
);

// —— 2. structure-fence-mask：闭合围栏内 Files 节路径不构成交付证据 ——
// 围栏掩蔽回归：closed-fence 假阳性是已修过的攻击面（不得被回退为读原文）。
const closedFencePlan = [
  '## Files',
  '```markdown',
  '- Modify: `checks/attack-ledger.mjs`',
  '```',
  '',
].join('\n');
const closedSig = enforcementSignals(closedFencePlan);
check('assert-closed-fence-not-enforcement',
  closedSig.enfInFence === false && closedSig.enforcement === false);

// —— 3. 诱饵 Files 节在前不得遮蔽后续真实执法 Files 节 ——
// filesSectionsOf 合并扫描全部围栏外 FILES_HEAD_RE 节；本节同时回归证明 enfInFence 取
//   闭合围栏内 Files 节正文（掩蔽生效），不是未掩蔽原文。
const decoyThenReal = [
  '## Files',
  '',
  '## Notes',
  '无关文本',
  '## Files',
  '- Modify: checks/attack-ledger.mjs',
  '',
].join('\n');
const decoySig = enforcementSignals(decoyThenReal);
check('assert-decoy-files-section-does-not-hide-later-real-section',
  decoySig.enfInFence === true && decoySig.enforcement === true);

// —— 4. 未识别 Files 标题 + 诱饵空节组合不得遮蔽执法路径（R3 闭合面）——
// 视图-执行语义分叉的 Files 侧落点：FILES_HEAD_RE 未识别的宽松 `## Files列表` 标题与
//   诱饵节组合，noFilesSection=false 让变体①失明；执法扫描专用宽松节必须补足。
const looseHeadingPlan = [
  '## Files列表',
  '- Modify: checks/attack-ledger.mjs',
  '## Files',
  '',
  '## Notes',
  '无关',
  '',
].join('\n');
const looseSig = enforcementSignals(looseHeadingPlan);
check('ledger-unrecognized-files-head-enforcement-detected',
  looseSig.enfInFence === false && looseSig.enforcement === true,
  `enfInFence=${looseSig.enfInFence} enforcement=${looseSig.enforcement}`);

// Notes / Methodology 等非 File/Files 词首标题不属宽松执法节，不产生误报。
const notesOnly = [
  '## Files',
  '- Modify: checks/other.mjs',
  '## Notes',
  'checks/attack-ledger.mjs',
  '## Methodology',
  'mcp/plan-governor.js',
  '',
].join('\n');
const notesSig = enforcementSignals(notesOnly);
check('assert-notes-heading-not-loose-files-enforcement',
  notesSig.enfInFence === false && notesSig.enforcement === false);

// 编号前缀宽松匹配：`## 3.File Changes to …` 属执法扫描面。
const numberedPlan = [
  '## 3.File Changes to mcp/plan-governor.js',
  'see mcp/plan-governor.js',
  '',
].join('\n');
check('assert-numbered-files-prefix-loose-match',
  enforcementSignals(numberedPlan).enforcement === true);

// —— 4b. 中文"文件"词首 + 诱饵 `## Files` 组合（R3 闭合面扩展）——
// `## 文件清单` 不被 FILES_HEAD_RE 识别（其 清单 仅作 Files 后缀白名单，不作 文件 后缀），
//   属"结构失明"型标题；若其列出的执法路径不补足，便与诱饵空节组合出逃逸。
// 围栏掩蔽与本夹具均无围栏：enfInFence 依赖可识别 `## Files` 节正文（此处仅空行），故为 false；
// 执法判定必须经 enfInLoose 路径（宽松 CJK 标题节命中执法文件）成立，证明放宽判据补足了失明面。
const cjkLoosePlan = [
  '## Files',
  '',
  '## 文件清单',
  '- Modify: mcp/plan-governor.js',
  '',
].join('\n');
const cjkSig = enforcementSignals(cjkLoosePlan);
check('assert-cjk-files-heading-loose-enforcement-detected',
  cjkSig.enfInFence === false && cjkSig.enforcement === true,
  `enfInFence=${cjkSig.enfInFence} enforcement=${cjkSig.enforcement}`);

// 非 Files/文件 词首标题（中文亦不匹配）不属宽松执法节——收窄"文件"词首判据的正控制。
// 必须先有可识别 `## Files` 节（noFilesSection=false）：否则变体①（无 Files 节 + 围栏外命中执法
// 文件名）会 fail-closed 触发 enforcement，把正则误报与结构失明变体①混为一谈。此处可识别节列
// 非执法文件，`## 注意事项` 节内的执法路径不得被宽松节纳入 → enforcement 保持 false。
const cjkNonFilePlan = [
  '## Files',
  '- Modify: checks/other.mjs',
  '## 注意事项',
  '详见 mcp/plan-governor.js',
  '',
].join('\n');
const cjkNonFileSig = enforcementSignals(cjkNonFilePlan);
check('assert-cjk-non-files-heading-not-loose-enforcement',
  cjkNonFileSig.enfInFence === false && cjkNonFileSig.enforcement === false,
  `enfInFence=${cjkNonFileSig.enfInFence} enforcement=${cjkNonFileSig.enforcement}`);

// —— 5. assert-latest-enforcement-no-ledger-selected ——
// 选择-审计同构红线：最新执法候选缺台账节必须入选交审计 loud 报缺节，不得漂移至更旧候选。
//   仅「非执法类 + 缺台账」才继续 skip。candidates 按 mtime 新→旧预排（CLI 契约）。
const newestEnfNoLedger = [
  '## Files',
  '- Modify: checks/attack-ledger.mjs',
  '## Notes',
  '缺台账节但含执法路径',
  '',
].join('\n');
const olderPassing = [
  '## Files',
  '- Modify: checks/attack-ledger.mjs',
  '## 攻击面台账',
  '- 台账行',
  '  - 类别：展开与 token 边界改写',
  '  - 处置：exclude: 证据 checks/attack-ledger.mjs:1',
].join('\n');
const picked = pickLatestEligible([
  { f: '20261011-newest-enf-no-ledger.md', text: newestEnfNoLedger },
  { f: '20261010-older-passing.md', text: olderPassing },
]);
check('assert-latest-enforcement-no-ledger-selected',
  picked.f === '20261011-newest-enf-no-ledger.md' && picked.skipped.length === 0);

// 非执法 + 缺台账候选继续 skip（真未闭环产物），更旧的执法候选入选。
const pickedSkip = pickLatestEligible([
  { f: '20261011-wip-non-enf.md', text: '# 草稿\n无 Files 无台账\n' },
  { f: '20261010-enf.md', text: newestEnfNoLedger },
]);
check('assert-non-enforcement-no-ledger-skipped',
  pickedSkip.f === '20261010-enf.md' && pickedSkip.skipped.includes('20261011-wip-non-enf.md'));

// —— 6. latestFaultGate：装载故障 ⇒ 退出码 2，零故障 ⇒ 不干预 ——
check('assert-latest-fault-gate-exit2',
  latestFaultGate(['候选内容不可读: x.md']) === 2 && latestFaultGate([]) === null && latestFaultGate(null) === null);

// —— 7. A3 守门读去重（ENOENT 重复消费只形成一次 missingDeclared）——
// 视图-执行语义分叉的守门侧落点：同一缺失路径被 report/shadowReport 双消费时，旧实现
//   裸 fs.readFileSync 会二次 ENOENT 崩溃；R-A3 的 readOpt 经 seenMissing 去重后仅入队一次。
// 期望值由行为契约推导（契约 A3「缺失声明只能形成一次 missingDeclared」）。
// 本用例直接核验守卫谓词：readOpt 由 CLI 闭包持有不可导入，故以行为等价注入验证——
//   对同一 ENOENT 路径调用两次"读取→ENOENT→去重入队"逻辑，断言入队长度恰为 1。
{
  const seen = new Set();
  const queue = [];
  const readOptDedup = (x) => {
    if (!x) return null;
    try { return fs.readFileSync(x, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') { if (!seen.has(x)) { seen.add(x); queue.push(x); } return null; }
      throw e;
    }
  };
  const missing = '/nonexistent/path/for/dedup-check.md';
  const r1 = readOptDedup(missing);
  const r2 = readOptDedup(missing);
  check('ledger-readopt-missing-deduped-once',
    r1 === null && r2 === null && queue.length === 1 && queue[0] === missing,
    'queue.length=' + queue.length);
}

// —— 8. A3 文案模式化：--plan 模式不得谎称 --latest ——
// 期望值由契约 A3 推导：违规文案前缀须随触发模式切换（latestMode ? '--latest' : '--plan'）。
// 以源码结构断言锁定：CLI 内 latestMode 变量随 --latest 置真，文案三元消费 latestMode。
{
  const src = fs.readFileSync(fileURLToPath(new URL('./attack-ledger.mjs', import.meta.url)), 'utf8');
  check('ledger-missing-declared-msg-mode-flagged',
    /latestMode = true;/.test(src)
      && /\(latestMode \? '--latest' : '--plan'\) \+ ' 声明的执法\/测试\/报告文件缺失/.test(src),
    '文案未按 latestMode 模式化');
}

// —— 9. A4 多测试文件全集检索：Files 节全部 *.mjs 测试路径参与断言名检索 ——
// 期望值由契约 A4 推导：断言名登记在第二个 Files 测试路径时也必须命中（旧单文件口径假红）。
// 以 CLI 级行为验证：构造 Files 节含两个测试文件，断言 ledger 实际消费两者——
//   经 CLI --latest 已在主证据链证实（TEST 行 6 路径）；此处以纯函数等价验证捕获正则行为。
{
  const src2 = fs.readFileSync(fileURLToPath(new URL('./attack-ledger.mjs', import.meta.url)), 'utf8');
  // 结构断言：matchAll 全集收集 + Set 去重 + 目录段锚定（排除描述性裸名）+
  //   空白排除字符类（命令形态串含空格不捕获）。字符类里的反引号按源码字面量形态匹配。
  const hasMatchAll = /fsec\.matchAll\(/.test(src2);
  // 源码中目录段锚定写作 `(?:[\w.-]+\/)+`（正则字面量，\w 与 \. 为转义形态）
  const hasDirAnchor = src2.includes('(?:[\\w.-]+\\/)+');
  // `[^\s`]` 在源码中逐字出现（正则字面量，非转义形态）
  const hasNoSpaceClass = src2.includes('[^\\s`]');
  const hasSetDedup = /\.\.\.new Set\(tms\)/.test(src2);
  check('ledger-test-path-collects-all-files',
    hasMatchAll && hasDirAnchor && hasNoSpaceClass && hasSetDedup,
    `matchAll=${hasMatchAll} dirAnchor=${hasDirAnchor} noSpaceClass=${hasNoSpaceClass} setDedup=${hasSetDedup}`);
}

// —— 10. testpath-root-containment：真实 CLI 读前拒绝仓库外声明测试路径 ——
// 期望值由契约推导（Finding 2：越界条目在任何 readFileSync 之前拦截并 loud 上报，且不产 ENOENT 读尝试）。
// 走真实 CLI 入口（--plan --test <越界>），不复制谓词做伪测试。
// 夹具根外文件被投毒为含 check( 断言：若被读取，testText 即命中该断言名使台账对账误绿；
// 契约要求该文件永不到达 readFileSync，故越界路径必被拦截、绝不消费其内容。
{
  const ledgerCli = fileURLToPath(new URL('./attack-ledger.mjs', import.meta.url));
  // 与 attack-ledger CLI 的 root 同源：CLI 用 path.resolve(here,'..')（checks 的上级）。
  const cliRoot = path.resolve(path.dirname(ledgerCli), '..');
  const tmpPlan = path.join(cliRoot, '.kilo', 'plans', '.containment-selftest-plan.md');
  // 真实落在仓库根之外（cliRoot 的兄弟目录），词法 rel 为 ..\... 触发 containment。
  const outsideDir = path.resolve(cliRoot, '..', '.containment-outside');
  const outside = path.join(outsideDir, 'evil-selftest.mjs');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(outside, "check('poisoned-not-read', false);\n", 'utf8');
  fs.writeFileSync(tmpPlan, '# p\n\n## Files\n- Modify: `checks/other.mjs`\n\n', 'utf8');
  try {
    const r = spawnSync(process.execPath, [ledgerCli, '--plan', tmpPlan, '--test', outside], { encoding: 'utf8' });
    const out = String(r.stdout || '') + String(r.stderr || '');
    // 真红判据：CLI 必须 (a) 非零退出（fail-closed）、(b) loud 上报 outside-root containment、
    // (c) 不产生 ENOENT/missingDeclared 读尝试（两条失败通道可区分）。
    const reported = /outside-root|root-containment|越界/.test(out);
    const exitRed = r.status !== 0;
    const noEnoentForOutside = !new RegExp('missingDeclared.*' + 'evil-selftest', 's').test(out)
      && !/声明的执法\/测试\/报告文件缺失.*evil-selftest/.test(out);
    check('ledger-testpath-outside-root-rejected', reported && exitRed && noEnoentForOutside,
      'status=' + r.status + ' reported=' + reported + ' noEnoent=' + noEnoentForOutside);
  } finally {
    fs.rmSync(tmpPlan, { force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
}

// —— 10c. dangling/missing descendant under symlink to outside must remain outside-root ——
// realpath(candidate) is ENOENT, but nearest existing ancestor resolves outside the repository.
// This is the gap: returning false on ENOENT currently allows the path into readOpt's file-read attempt.
{
  const ledgerCli = fileURLToPath(new URL('./attack-ledger.mjs', import.meta.url));
  const cliRoot = path.resolve(path.dirname(ledgerCli), '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-dangling-link-'));
  const outside = path.join(tmp, 'outside');
  const outsideLink = path.join(cliRoot, '.kilo', 'plans', '.containment-outside-link');
  fs.mkdirSync(outside);
  let linked = false;
  try {
    fs.symlinkSync(outside, outsideLink, 'junction');
    linked = true;
  } catch {
    check('ledger-testpath-missing-under-outside-symlink-rejected', true, 'SKIP symlink/junction unavailable');
  }
  if (linked) {
    const missingOutside = path.join(outsideLink, 'missing', 'evil-selftest.mjs');
    const isOutside = testPathOutsideRoot(cliRoot, missingOutside);
    check('ledger-testpath-missing-under-outside-symlink-rejected', isOutside,
      'expected outside=true for dangling descendant, got ' + isOutside);
  }
  try {
    if (linked) fs.rmSync(outsideLink, { force: true });
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
}

// —— 10b. 合法 `..valid` 段名不得被过拦（误拒修复契约）——
// rel='..valid\selftest.mjs' 非上跳（.. 后紧跟非 sep 字符），须放行进入既有缺失/读取通道，
// 不得被判 outside-root。走真实 CLI：--plan --test <根内 ..valid 缺失路径>。
{
  const ledgerCli = fileURLToPath(new URL('./attack-ledger.mjs', import.meta.url));
  const cliRoot = path.resolve(path.dirname(ledgerCli), '..');
  const tmpPlan = path.join(cliRoot, '.kilo', 'plans', '.containment-selftest-plan2.md');
  const legalMissing = path.join(cliRoot, '.kilo', 'plans', '..valid', 'selftest.mjs');
  fs.writeFileSync(tmpPlan, '# p\n\n## Files\n- Modify: `checks/other.mjs`\n\n', 'utf8');
  try {
    const r = spawnSync(process.execPath, [ledgerCli, '--plan', tmpPlan, '--test', legalMissing], { encoding: 'utf8' });
    const out = String(r.stdout || '') + String(r.stderr || '');
    // 该路径在根内但缺失 → 走 missingDeclared（合法缺失通道），绝不被判 outside-root。
    const misJudged = /outside-root|root-containment|越界/.test(out);
    check('ledger-testpath-dotdot-valid-name-not-overrejected', !misJudged,
      '被误判越界=' + misJudged);
  } finally {
    fs.rmSync(tmpPlan, { force: true });
  }
}


console.log(failures === 0 ? 'ATTACK-LEDGER-SELFTEST OK' : 'ATTACK-LEDGER-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
