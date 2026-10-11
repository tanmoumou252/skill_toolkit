// attack-ledger-selftest.mjs — attack-ledger 计划侧执法/选择域自测（零依赖，Node 内置）。
// 覆盖范围：伴生轮次后缀排除（latest-companion-exclude-gate）、围栏掩蔽执法判定位（structure-fence-mask）、
//   未识别 Files 标题的执法检测（loose Files heading，与 ledger「信任根入口 / 视图-执行语义分叉」咬合）、
//   --latest 最新执法候选选择（latest-unclosed-exclude-gate 互补面）、装载故障退出码。
// 断言名与主计划 attack-ledger-selftest 台账登记同源；红灯阶段（未落 R1/R3）即真红，不得静默通过。
import { isPlanFilename, hasLedgerSection, enforcementSignals, pickLatestEligible, latestFaultGate } from './attack-ledger.mjs';

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

console.log(failures === 0 ? 'ATTACK-LEDGER-SELFTEST OK' : 'ATTACK-LEDGER-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
