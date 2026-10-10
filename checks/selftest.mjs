// 不变式检查器自测：证明每个检测器"该咬时真咬、不该咬时不咬"。
// 全部分支以合成文件集驱动 runAll（不读磁盘），故可在真实仓库之外独立验证。
// 每个 FAIL 行都对应一条真实断言失败；红灯即证明检测器未生效。
import { runAll, scanFences } from './invariants.mjs';
// 派生器以命名空间导入存取：红灯阶段该导出不存在，不得让 ESM 链接期 SyntaxError 把「逐条断言真红」
// 降级成「脚手架崩溃假红」（四维语义真红的 [REJECT-FAKE]）；实现落盘后本守卫即直取真函数。
import * as invariants from './invariants.mjs';
const deriveDispatchCarrier = typeof invariants.deriveDispatchCarrier === 'function' ? invariants.deriveDispatchCarrier : () => '<未实现>';
const unclassifiedPlatformFiles = typeof invariants.unclassifiedPlatformFiles === 'function' ? invariants.unclassifiedPlatformFiles : () => [];
const unscannedRoots = typeof invariants.unscannedRoots === 'function' ? invariants.unscannedRoots : () => [];
const scanEntryDirNames = typeof invariants.scanEntryDirNames === 'function' ? invariants.scanEntryDirNames : (xs) => xs;
const allInvariantIds = typeof invariants.allInvariantIds === 'function' ? invariants.allInvariantIds : () => [];
import { attackLedger, checkReportFormat, checkChainOrder, checkReportStructureGate, foldRoundFromFilename, countAttackRows, ATTACK_CLASSES, ENFORCEMENT_FILES, FILES_HEAD_RE, isPlanFilename, hasLedgerSection } from './attack-ledger.mjs';
import * as ledgerNs from './attack-ledger.mjs';
import { PLATFORMS, CLAUSES, DERIVED_CLAUSES, GATES } from './registry.mjs';
// 清点器以命名空间导入存取：红灯阶段该模块仅为空桩（零导出），命名导入会因「缺导出」在
// ESM 链接期抛 SyntaxError 假红；命名空间导入把缺失延迟到守卫抛出
// TypeError: inventory is not a function（四维真红 [PASS-RED] 目标契约缺失）。
// 注：PLATFORMS 导入随本 Replacement 落刀即在场，后续用例的 PLATFORMS.map(...) 不会 ReferenceError。
import * as inventoryNs from './platform-inventory.mjs';
const inventory = typeof inventoryNs.inventory === 'function' ? inventoryNs.inventory : () => { throw new TypeError('inventory is not a function'); };
// 生成器以命名空间导入存取：红灯阶段空桩零导出，命名导入会在 ESM 链接期抛 SyntaxError 假红；
// 命名空间导入把缺失延迟到守卫抛出 TypeError（[PASS-RED] 目标契约缺失），实现落盘后直取真函数。
import * as buildNs from './build-agents.mjs';
const build = typeof buildNs.build === 'function' ? buildNs.build : () => { throw new TypeError('build is not a function'); };
const diffProducts = typeof buildNs.diffProducts === 'function' ? buildNs.diffProducts : () => { throw new TypeError('diffProducts is not a function'); };
const unknownPlatformDirs = typeof buildNs.unknownPlatformDirs === 'function' ? buildNs.unknownPlatformDirs : () => { throw new TypeError('unknownPlatformDirs is not a function'); };
const specHash = typeof buildNs.specHash === 'function' ? buildNs.specHash : () => { throw new TypeError('specHash is not a function'); };
const GENERATED_MARK = typeof buildNs.GENERATED_MARK === 'string' ? buildNs.GENERATED_MARK : '<未实现>';
// VERDICT 单源常量以命名空间 + instanceof 守卫存取：红灯阶段 VERDICT_LINE_RE 尚未导出，直接命名
// 导入会在 ESM 链接期抛 SyntaxError，把「逐条断言真红」降级成「脚手架崩溃假红」（四维语义真红
// [REJECT-FAKE]）；typeof null === 'object' 故用 instanceof RegExp 判定，实现落盘后即直取真常量。
import * as attackLedgerNs from './attack-ledger.mjs';
const VERDICT_LINE_RE = attackLedgerNs.VERDICT_LINE_RE instanceof RegExp ? attackLedgerNs.VERDICT_LINE_RE : null;
const VERDICT_GATE_RE = attackLedgerNs.VERDICT_GATE_RE instanceof RegExp ? attackLedgerNs.VERDICT_GATE_RE : null;

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`OK   ${name}${detail ? ' ' + detail : ''}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`);
  }
}

const has = (files, id, p) => runAll(files).some((v) => v.id === id && (!p || v.path === p));

const skillPath = 'skills/demo/SKILL.md';
const skillFm = ['---', 'name: demo', 'description: d', '---', ''];

// 1) 未闭合围栏必须被检出
check(
  'fence-all-closed-detects-unclosed',
  has([{ path: skillPath, text: [...skillFm, '```md', 'code', ''].join('\n') }], 'fence-all-closed', skillPath),
);

// 2) 4 反引号外层包 3 反引号内层（lean-readme 实况）不得误报
const nested = [...skillFm, '````markdown', '# T', '```bash', 'pnpm i', '```', '````', ''].join('\n');
check('fence-nested-4-3-not-flagged', !has([{ path: skillPath, text: nested }], 'fence-all-closed', skillPath));

// 3) 行内三反引号（非行首）不得被当作围栏（lean-readme:25 形态）
const inline = [...skillFm, '- 严禁使用 `## 快速起步` 或 ```bash``` 命令块。', ''].join('\n');
check('fence-inline-triple-backticks-not-flagged', !has([{ path: skillPath, text: inline }], 'fence-all-closed', skillPath));

// 3b) 行首反引号围栏 info 含反引号（CommonMark 非法 info）属行内代码，不得被当作围栏开启
const infoBacktick = [...skillFm, '```bash`tail', 'plain text', ''].join('\n');
check('fence-backtick-info-with-backtick-not-flagged', !has([{ path: skillPath, text: infoBacktick }], 'fence-all-closed', skillPath));

// 3c) 正控制：波浪号围栏 info 含反引号仍是合法开启，未闭合必须检出（证明守卫只收反引号族）
const tildeInfoBacktick = [...skillFm, '~~~bash`tail', 'plain text', ''].join('\n');
check('fence-tilde-info-backtick-still-opens', has([{ path: skillPath, text: tildeInfoBacktick }], 'fence-all-closed', skillPath));

// 4) 状态机可直接复核：4 反引号外层只应产生 1 对围栏，内层 3 反引号属内容（故不是 2 对）
const st = scanFences(nested);
check('scanFences-nested-pairs-1', st.pairs.length === 1 && st.unclosed.length === 0, `pairs=${st.pairs.length}`);

// 5) 该类文件本应无 frontmatter 却出现 → 检出
check(
  'frontmatter-absent-detected',
  has([{ path: 'kilocode/AGENTS.md', text: ['---', 'name: x', '---', '', 'body', ''].join('\n') }], 'frontmatter-absent', 'kilocode/AGENTS.md'),
);

// 6) 平台私有键串台 → 检出
const leakFm = ['---', 'mode: all', 'description: d', 'options:', '  id: x', 'permission:', '  read: allow', 'agentMode: primary', '---', ''];
check('platform-key-leak-detected', has([{ path: 'kilocode/agents/plan-writer-sp.md', text: leakFm.join('\n') }], 'platform-key-leak'));

// 7) 必需键缺失 → 检出（codebuddy 缺 mcpServers）
const cbFm = ['---', 'name: x', 'description: d', 'model: inherit', 'tools: []', 'agentMode: agentic', 'enabled: true', 'enabledAutoRun: true', '---', ''];
check('frontmatter-keys-required-detected', has([{ path: 'codebuddy/agents/pr-reviewer-sp.md', text: cbFm.join('\n') }], 'frontmatter-keys-required'));

// 8) M2：kilocode 的 edit 写成 map（含嵌套在 permission 下） → 检出
const m2 = ['---', 'mode: subagent', 'description: d', 'options:', '  id: x', 'permission:', '  read: allow', '  edit:', '    "*": deny', '---', ''];
check('kilocode-m2-edit-map-detected', has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m2.join('\n') }], 'kilocode-m2-no-edit-key'));

// 9) M7：bash 写成标量 → 检出；写成 map → 不误报
const m7bad = ['---', 'mode: subagent', 'description: d', 'options:', '  id: x', 'permission:', '  bash: deny', '---', ''];
const m7ok = ['---', 'mode: subagent', 'description: d', 'options:', '  id: x', 'permission:', '  bash:', '    "*": deny', '---', ''];
check('kilocode-m7-bash-scalar-detected', has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m7bad.join('\n') }], 'kilocode-m7-bash-must-be-map'));
check('kilocode-m7-bash-map-not-flagged', !has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m7ok.join('\n') }], 'kilocode-m7-bash-must-be-map'));

// 10) reviewer 的 main 实例键未全 deny / 缺 subagent allow → 检出
const m8 = ['---', 'mode: subagent', 'description: d', 'options:', '  id: plan-reviewer-sp', 'permission:', '  bash:', '    "*": deny', '  plan-governor-main_write_plan: allow', '---', ''];
check('kilocode-reviewer-main-deny-detected', has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m8.join('\n') }], 'kilocode-reviewer-main-deny'));
check('kilocode-reviewer-subagent-allow-detected', has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m8.join('\n') }], 'kilocode-reviewer-subagent-allow'));

// 10b) F6 第 8 键钉死（覆盖缺口闭合）：clean reviewer 缺 plan-governor-main_edit_scoped_file deny → 必咬且报文点名该键
//     （行为契约：常量若被回删为 7 键，本夹具即红；测的是检测集含第 8 键，非数组长度）
const m8b = ['---', 'mode: subagent', 'description: d', 'options:', '  id: plan-reviewer-sp', 'permission:', '  bash:', '    "*": deny', '  plan-governor-main_exec_guarded_command: deny', '  plan-governor-main_exec_sandboxed_command: deny', '  plan-governor-main_copy_into_sandbox: deny', '  plan-governor-main_write_scoped_file: deny', '  plan-governor-main_write_plan: deny', '  plan-governor-main_write_review_report: deny', '  plan-governor-main_write_pr_review_report: deny', '---', ''];
const m8bF6 = runAll([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m8b.join('\n') }]).filter((v) => v.id === 'kilocode-reviewer-main-deny');
check('kilocode-reviewer-main-deny-8th-key-detected', m8bF6.length === 1 && m8bF6[0].msg.includes('plan-governor-main_edit_scoped_file'));
// 10c) F6 负控制：8 键全 deny + subagent allow 的干净 reviewer → 不误报（防收紧误伤；常量新增第 9 键时本夹具转红，迫使同步更新）
const m8c = ['---', 'mode: subagent', 'description: d', 'options:', '  id: plan-reviewer-sp', 'permission:', '  bash:', '    "*": deny', '  plan-governor-main_exec_guarded_command: deny', '  plan-governor-main_exec_sandboxed_command: deny', '  plan-governor-main_copy_into_sandbox: deny', '  plan-governor-main_write_scoped_file: deny', '  plan-governor-main_edit_scoped_file: deny', '  plan-governor-main_write_plan: deny', '  plan-governor-main_write_review_report: deny', '  plan-governor-main_write_pr_review_report: deny', '  plan-governor-subagent_exec_guarded_command: allow', '---', ''];
check('kilocode-reviewer-main-deny-clean-not-flagged', !has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: m8c.join('\n') }], 'kilocode-reviewer-main-deny'));

// 11) 必含条款缺失 → 检出
const zcFm = ['---', 'name: plan-writer-subagent-sp', 'description: d', 'color: orange', 'tools: []', 'permissionMode: dontAsk', 'injectAgentsMd: true', '---', ''];
check(
  'clause-required-detected',
  has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: [...zcFm, '无任何条款', ''].join('\n') }], 'clause-no-green-no-start', 'zcode/agents/plan-writer-subagent-sp.md'),
);

// 11b) 直连派发参数头条款：缺失必咬（正控制）/ 在场不误报（负控制）/ 作用域锁死不溢出
// 该条款锁定"zcode/AGENTS.md 与 skills/zcode-plan-first/SKILL.md 必须写明直连派发参数头义务"，
// 防止快通道/分支级直连审查场景退化为无参数头派发。
// 红绿账目（对照 checks/selftest.mjs 既有惯例，负控制空桩即 PASS 不得据其判红灯充足）：
//   登记前（registry.mjs 无该 id，runAll 永不产生该 violation，has() 恒返 false）：
//     clause-direct-dispatch-header-detected 必 FAIL（[PASS-RED] 断言比对失败）＝真红来源；
//     clause-direct-dispatch-header-clean-not-flagged 与 clause-direct-dispatch-header-scope-locked
//     为负控制类，空桩即 PASS，不得据其判定红灯充足。
//   登记后：三条全绿。
const ZC_AGENTS = 'zcode/AGENTS.md';
const ZC_SKILL = 'skills/zcode-plan-first/SKILL.md';
const ddAgentsOk = ['## 直连派发参数头铁律（CRITICAL: Direct Dispatch Header）', '', '派发 prompt 必须自行构造直连派发参数头。', ''].join('\n');
const ddSkillOk = ['---', 'name: zcode-plan-first', 'description: d', '---', '', '快通道直连派发必须现构直连派发参数头。', ''].join('\n');
check(
  'clause-direct-dispatch-header-detected',
  has([{ path: ZC_AGENTS, text: '轨道 A：参数以主计划步骤 N 已固化的完整派发串逐字取用。' }], 'clause-direct-dispatch-header', ZC_AGENTS)
    && has([{ path: ZC_SKILL, text: [...skillFm, '快通道：配套约束不变，分派 prompt 必须声明唯一写入路径，越界即驳回重派。', ''].join('\n') }], 'clause-direct-dispatch-header', ZC_SKILL),
);
check(
  'clause-direct-dispatch-header-clean-not-flagged',
  !has([{ path: ZC_AGENTS, text: ddAgentsOk }], 'clause-direct-dispatch-header', ZC_AGENTS)
    && !has([{ path: ZC_SKILL, text: ddSkillOk }], 'clause-direct-dispatch-header', ZC_SKILL),
);
// 作用域锁死：expect 刻意只收 ZCode 两份（kilocode 主代理人格即可编辑，无同款缺口），
// 一旦被放宽到三端，本断言立即转红——这是"收窄 expect 以避免范围逃逸"的机器守卫。
// 夹具含同款缺口文案但不在 expect 内；夹具会触发其他 id 的违反，断言按 id 过滤不受干扰。
check(
  'clause-direct-dispatch-header-scope-locked',
  !runAll([
    { path: 'kilocode/AGENTS.md', text: '轨道 A：prompt 参数逐字取用主计划步骤 N 已固化的完整派发串。' },
    { path: 'codebuddy/AGENTS.md', text: '轨道 A：prompt 参数逐字取用主计划步骤 N 已固化的完整派发串。' },
  ]).some((v) => v.id === 'clause-direct-dispatch-header'),
);

// 12) 历史缺陷回放：同文件内 1 处带 -uall、1 处不带 → 配对等式必须检出
const histBad = [
  '---', 'mode: subagent', 'description: d', 'options:', '  id: plan-reviewer-sp', 'permission:', '  bash:', '    "*": deny', '---', '',
  '管道例外（实测 `git status --short | head -5` 放行）；另一处 `git status --short -uall`。', '',
].join('\n');
const histOk = histBad.replace('git status --short | head -5', 'git status --short -uall | head -5');
check('status-uall-detects-historical-defect', has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: histBad }], 'status-uall-complete'));
check('status-uall-clean-not-flagged', !has([{ path: 'kilocode/agents/plan-reviewer-sp.md', text: histOk }], 'status-uall-complete'));

// 13) 闸门声明缺失 → 检出
check(
  'gate-verbatim-detected',
  has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: [...zcFm, '无闸门声明', ''].join('\n') }], 'gate-plan-gate', 'zcode/agents/plan-writer-subagent-sp.md'),
);

// 14) 平台私有调用标识缺失 → 检出（codebuddy 缺 subagent_name）
check(
  'identifier-required-detected',
  has([{ path: 'codebuddy/agents/plan-writer-sp.md', text: [...cbFm.slice(0, -2), 'mcpServers: x', '---', '', '本文未声明参数名。', ''].join('\n') }], 'identifier-codebuddy-task-param'),
);

// 15) 正控制：一份完全合规的 skill 文件对该文件不得产生任何违反
//     注：单文件运行时，其它「必含条款」的目标文件缺失会另报 clause-target-missing 等
//     （那是登记表与文件集不匹配的信号，属预期），故此处按**路径**过滤后断言零违反。
//     `skills/demo/` 为合成路径：它不落在任何条款 expect 模式内，也不在配对等式作用域内
//     （作用域只收两份 plan-first 技能），故"该路径零违反"这一断言是有效且有意义的。
//     ⚠ 本条属负控制类：在**空实现桩阶段会 PASS**，不得据它判定 TDD 红灯充足。
const cleanSkill = [...skillFm, '`status --short -uall`', ''].join('\n');
check(
  'clean-skill-no-violations',
  runAll([{ path: skillPath, text: cleanSkill }]).filter((v) => v.path === skillPath).length === 0,
);

// 16-28) 攻击面台账机械对账器（流程补强）：合规零违反 + 违规必咬 + 报告对账不随计划类型短路 + 围栏掩蔽
// 空桩阶段 17-21、23、25、26、27 共 9 条必 FAIL；16/22/24/28 为负控制类（空桩即 PASS），不得据其判定红灯充足。
const ledgerRow = (c) => [
  '- 台账行',
  '  - 类别：' + c,
  '  - 处置：block@gate-' + c,
  '  - 攻击样本：atk-' + c,
  '  - 对照样本：ctl-' + c,
  '  - 断言名：assert-' + c,
  '  - 探针回执：`probe-cmd` Exit 1',
].join('\n');
const planLedgerGood = [
  '# p', '', '## Files', '', '| Modify | `' + 'mcp/plan-governor.js' + '` | x |', '', '## 攻击面台账', '',
  ATTACK_CLASSES.map(ledgerRow).join('\n'), '',
].join('\n');
const implGood = ATTACK_CLASSES.map((c) => 'gate-' + c).join('\n');
const testGood = ATTACK_CLASSES.map((c) => "check('assert-" + c + "', true);").join('\n');
check('ledger-clean-plan-no-violations', attackLedger(planLedgerGood, { implText: implGood, testText: testGood }).length === 0);
const planLedgerMissing = planLedgerGood.replace(ledgerRow(ATTACK_CLASSES[ATTACK_CLASSES.length - 1]), '');
check('ledger-missing-class-detected', attackLedger(planLedgerMissing, { implText: implGood, testText: testGood }).some((v) => v.msg.includes('台账缺类别行')));
check('ledger-bogus-assertion-detected', (() => {
  const t = testGood.replace("check('assert-" + ATTACK_CLASSES[0], "check('bogus-");
  return attackLedger(planLedgerGood, { implText: implGood, testText: t }).some((v) => v.msg.includes('断言名'));
})());
check('ledger-probe-without-exitcode-detected', (() => {
  const p = planLedgerGood.replace('探针回执：`probe-cmd` Exit 1', '探针回执：应拦');
  return attackLedger(p, { implText: implGood, testText: testGood }).some((v) => v.msg.includes('探针回执'));
})());
check('ledger-exclude-without-evidence-detected', (() => {
  const p = '# p\n## Files\n| Modify | `mcp/plan-governor.js` | x |\n\n## 攻击面台账\n\n- 台账行\n  - 类别：' + '展开与 token 边界改写' + '\n  - 处置：exclude: 无实例\n  - 证据：-\n';
  return attackLedger(p, { implText: implGood, testText: testGood }).some((v) => v.msg.includes('证据'));
})());
check('ledger-section-absent-detected', attackLedger('# p\n## Files\n| Modify | `mcp/plan-governor.js` | x |\n', {}).some((v) => v.msg.includes('攻击面台账')));
check('ledger-nonsecurity-plan-exempt', attackLedger('# p\n## Files\n| Modify | `README.md` | x |\n', {}).length === 0);
// 计划未闭合围栏掩蔽 Files 段 ⇒ 不得被误判为非执法而静默跳过台账校验（fail-open）；修复后必须判红
check('ledger-plan-unclosed-fence-failclosed', attackLedger('# p\n```\n未闭合\n\n## Files\n| Modify | `mcp/plan-governor.js` | x |\n\n## 攻击面台账\n\n- 台账行\n  - 类别：视图-执行语义分叉\n  - 处置：block@x\n', { implText: 'x', testText: "check('assert', true);" }).some((v) => v.msg.includes('未闭合')));
check('ledger-report-zero-go-forbidden', attackLedger(planLedgerGood, { implText: implGood, testText: testGood, reportText: 'ATTACKS=0\nPENETRATIONS=0\nVERDICT: GO' }).some((v) => v.msg.includes('zero-attack-go-forbidden')));
check('ledger-report-zero-go-echo-annotated-still-forbidden', attackLedger(planLedgerGood, { implText: implGood, testText: testGood, reportText: 'ATTACKS=0\nPENETRATIONS=0\nVERDICT: GO\nECHO-RISK' }).some((v) => v.msg.includes('zero-attack-go-forbidden')));
check('ledger-nonsecurity-report-still-checked', attackLedger('# p\n## Files\n| Modify | `README.md` | x |\n', { reportText: 'VERDICT: GO' }).some((v) => v.msg.includes('ATTACKS=')));
check('ledger-files-title-trailing-note-detected', attackLedger('# p\n## Files（批间互斥）\n| Modify | `mcp/plan-governor.js` | x |\n', {}).some((v) => v.msg.includes('攻击面台账')));
check('ledger-fenced-fake-files-section-denied', attackLedger('# p\n\n```md\n## Files\n| Modify | `README.md` | x |\n```\n\n## Files\n| Modify | `mcp/plan-governor.js` | x |\n', {}).some((v) => v.msg.includes('攻击面台账')));
check('ledger-fenced-contract-example-ignored', attackLedger('# p\n## Files\n| Modify | `mcp/plan-governor.js` | x |\n\n## 格式契约示例（围栏内不参与结构判定）\n\n```md\n## 攻击面台账\n\n- 台账行\n  - 类别：<占位>\n```\n\n## 攻击面台账\n\n' + ATTACK_CLASSES.map(ledgerRow).join('\n') + '\n', { implText: implGood, testText: testGood }).length === 0);

// 29-48) 报告侧攻击配额机器对账（配额去自声明 / 击穿入 E 清单 / 实弹姿态可核 / 标记行锚定 / 末次取值 / 未闭合围栏）
// 空桩阶段（countAttackRows 返回 []、checkReportFormat 未补强、登记表未含对账器）必 FAIL：
//   30-38、40-46、48 共 17 条属 [PASS-RED] 断言比对失败；29、39、47 为负控制类（空桩即 PASS），不得据其判定红灯充足。
const RECEIPT = '自检：`npm test --prefix checks/ledger`（退出码 0）';
const atkRow = (n, indent) => (indent || '') + '- 攻击行: 序号=' + n + ' | 类别=外衣化 | 靶点=checks/attack-ledger.mjs:102 | 构造=c' + n + ' | 探针=`npm test --prefix checks` Exit 0 | 判定=拦截';
const quietRow = (n, indent) => atkRow(n, indent).replace('`npm test --prefix checks` Exit 0', '静态推演');
const REPORT_OK = [atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'SHADOW_PASS=done', 'VERDICT: GO'].join('\n');
const F34 = [atkRow(1), atkRow(2), '', '```md', atkRow(3), atkRow(4), '```', '', RECEIPT, 'ATTACKS=4', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n');
const F44 = [atkRow(1), atkRow(2), '', '```md', atkRow(3), atkRow(4), '```'].join('\n');
const F45 = [quietRow(1, '  '), quietRow(2, '  '), '', RECEIPT, 'ATTACKS=3', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n');
const F48 = [atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO', '', '```text', 'terminal output', '', 'ATTACKS=0', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n');
const rv = (text) => { const v = []; checkReportFormat(text, v); return v; };
const rvSome = (text, frag) => rv(text).some((x) => x.msg.includes(frag));
const auditorPlan = '# p\n## Files\n| Modify | `checks/attack-ledger.mjs` | x |\n';

// 29（负控制）合规最小报告零违反
check('ledger-report-quota-clean-ok', rv(REPORT_OK).length === 0, 'n=' + rv(REPORT_OK).length);
// 30 配额灌水：声明 9 / 登记行实数 2
check('ledger-report-attacks-inflated-detected', rvSome(REPORT_OK.replace('ATTACKS=2', 'ATTACKS=9'), '攻击行实数'));
// 31 纯散文自声明：ATTACKS=24 / 登记行 0
check('ledger-report-attacks-selfdeclared-detected', rvSome(['# r', '', '### 攻击 1：散文推演', '', RECEIPT, 'ATTACKS=24', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), '自声明'));
// 32 序号重复灌水
check('ledger-report-row-seq-duplicate-detected', rvSome([atkRow(1), atkRow(1), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), '序号重复'));
// 33 两方言混用
check('ledger-report-row-dialect-mixed-detected', rvSome(['- 攻击行: 序号=1 | 判定=拦截', '', '| A-2 | x | y |', '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), '方言混用'));
// 34 闭合围栏内伪行不得计入实数（声明 4，围栏外真 2）
check('ledger-report-fenced-rows-not-counted', rvSome(F34, '与攻击行实数 2 不一致'));
// 35 击穿未入 E 清单
check('ledger-report-pen-without-eid-detected', rvSome([atkRow(1), atkRow(2), atkRow(3), '', RECEIPT, 'ATTACKS=3', 'PENETRATIONS=3', 'VERDICT: NO-GO'].join('\n'), 'E 清单编号'));
// 36 PEN 大于 ATTACKS
check('ledger-report-pen-gt-attacks-detected', rvSome([atkRow(1), atkRow(2), atkRow(3), '', '- E-1 x', RECEIPT, 'ATTACKS=3', 'PENETRATIONS=7', 'VERDICT: NO-GO'].join('\n'), '大于 ATTACKS'));
// 37 实弹姿态缺失（探针字段全为静态推演且未标 OFFLINE）
check('ledger-report-probe-posture-missing-detected', rvSome([quietRow(1), quietRow(2), '', 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), 'PROBE=OFFLINE'));
// 38b 伪 E 号仅在闭合围栏内 ⇒ 修复后必须仍判"E 清单编号"缺失（当前原始文本 match 会假绿）
check('ledger-report-fenced-eid-not-counted', rvSome([atkRow(1), atkRow(2), atkRow(3), '', '```', '- E-1 仅在围栏内示例', '```', RECEIPT, 'ATTACKS=3', 'PENETRATIONS=3', 'VERDICT: NO-GO'].join('\n'), 'E 清单编号'));
// 38c 实弹回执仅在闭合围栏内 ⇒ 修复后必须仍判缺 PROBE=OFFLINE/回执（当前原始文本 test 会假绿）。
//   夹具口径（Act 纠偏，理由见证据日志步骤 5-纠偏条目）：围栏外两行必须用 quietRow（探针字段=静态推演，
//   零反引号、零退出码）。若沿用 atkRow，其自带"反引号命令 + Exit 0"探针字段本身就构成围栏外实弹回执
//   ⇒ PROBE_RECEIPT_RE 恒命中 ⇒ 断言退化为永久红夹具、丧失咬合力（计划步骤 4 取 atkRow 属事实遗漏）。
check('ledger-report-fenced-probe-posture-not-counted', rvSome([quietRow(1), quietRow(2), '', '```', RECEIPT, '```', 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), 'PROBE=OFFLINE'));
// 38d 计划侧：合法 - 台账行 下仅在闭合围栏内塞一整套可过校验的伪字段 ⇒ get 不得采信。
//   检索词类名精确：修复前该类被伪字段填入 seen → 无「缺类别行：视图-执行语义分叉」违规（FAIL 红）；
//   修复后伪字段清空 → 该类缺行（OK 绿）。计划串实参以单引号包裹，内层三反引号围栏无需转义。
check('ledger-plan-spoofed-field-in-fence-not-counted', attackLedger('# p\n## Files\n| Modify | `mcp/plan-governor.js` | x |\n\n## 攻击面台账\n\n- 台账行\n```\n  - 类别：视图-执行语义分叉\n  - 处置：block@gate-视图-执行语义分叉\n  - 攻击样本：a\n  - 对照样本：b\n  - 断言名：assert\n  - 探针回执：`probe-cmd` Exit 1\n```\n', { implText: implGood, testText: testGood }).some((v) => v.msg.includes('缺类别行：视图-执行语义分叉')));
// 38 零实弹 GO 必须标 ECHO-RISK
check('ledger-report-offline-go-echo-required', rvSome([atkRow(1), atkRow(2), '', 'PROBE=OFFLINE', 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), '零实弹'));
// 39（负控制）散文引用两标记字面量不得构成姿态声明（误伤对照）
check('ledger-report-prose-marker-not-posture', rv(['# r', '', '建议：待验命令不在白名单时标注 `PROBE=OFFLINE`；零实弹 GO 须标注 ECHO-RISK（零攻击 GO 的处置按计划分级）。', '', atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'SHADOW_PASS=done', 'VERDICT: GO'].join('\n')).length === 0);
// 40 格式行末次取值：前塞裸行遮蔽尾部真值
check('ledger-report-format-line-last-wins', rvSome(['# r', '', 'ATTACKS=9', '', '## 格式行', '', RECEIPT, 'ATTACKS=0', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), 'ECHO-RISK'));
// 41 ECHO-RISK 散文撞词不足以免标
check('ledger-report-echo-prose-mention-insufficient', rvSome(['# r', '', '按契约「零攻击 GO 必须另行标注 ECHO-RISK」，本报告合规。', '', RECEIPT, 'ATTACKS=0', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), 'ECHO-RISK'));
// 42 对账器自身入登记表
check('ledger-enforcement-registry-covers-auditor', ENFORCEMENT_FILES.includes('checks/attack-ledger.mjs'));
// 43 仅涉对账器的计划同样触发台账义务
check('ledger-auditor-plan-requires-ledger', attackLedger(auditorPlan, {}).some((v) => v.msg.includes('攻击面台账')));
// 44 计数助手可直接复核：围栏外 2 行 + 闭合围栏内 2 行 ⇒ 只数到 2，方言 line-row
const counted = countAttackRows(F44);
check('ledger-count-attack-rows-fence-masked', counted.length === 2 && counted.every((r) => r.anchor === 'line-row'), 'rows=' + counted.length);
// 45 缩进 0-3 空格的合规登记行必须计入（声明 3 / 缩进真行 2 ⇒ 报"实数 2"而非"自声明"）
check('ledger-report-indented-rows-counted', rvSome(F45, '与攻击行实数 2 不一致'));
// 46 行首解释句不得冒充 ECHO-RISK 标注（装饰前缀 + 无冒号引导的后缀）
check('ledger-report-marker-explanation-not-counted', rvSome(['# r', '', '- **ECHO-RISK** 语义说明：本标记仅在零攻击时使用', '', RECEIPT, 'ATTACKS=0', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), 'ECHO-RISK'));
// 47（负控制）带列表符/加粗/冒号说明的标记行仍然有效（严格化不得误伤合法装饰形态）
check('ledger-report-decorated-marker-counted', rv([atkRow(1), atkRow(2), '', '- **PROBE=OFFLINE**：本代理无沙箱权限', '', '- ECHO-RISK：纸面放行已明示', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'SHADOW_PASS=done', 'VERDICT: GO'].join('\n')).length === 0);
// 48 未闭合围栏使其后内容整段不可信 ⇒ 直接判红
check('ledger-report-unclosed-fence-detected', rvSome(F48, '未闭合'));

// 49-61) 决策点强校验：链序折叠/上限/断档/前缀锁定 + 报告结构闸（共 14 条 check 调用）。
// 空桩阶段（foldRoundFromFilename 恒返 1、checkChainOrder 恒返 []、checkReportStructureGate 空操作）
// 红绿账目：9 条必 FAIL（[PASS-RED] 断言比对失败）＝ assert-chain-fold-boundary / assert-chain-fold-literal /
//   assert-chain-round-coerce / assert-chain-round-limit / assert-chain-sequence-gap /
//   assert-structure-gate-shadow / assert-structure-gate-pr-review / assert-structure-gate-missing-report /
//   assert-structure-gate-fence-masked；
// 5 条负控制空桩即 PASS（不得据其判定红灯充足）＝ assert-chain-fs-listing-only / assert-chain-base-prefix /
//   assert-structure-gate-clean-ok / assert-structure-gate-unclosed-deferred / assert-chain-path-join-root。
// 49 负控制：空链、合规双轮链、合法双 r1 链（r1 影子 + r1 PR 报告并存，去重后不误判断档）零违反
check('assert-chain-fs-listing-only', checkChainOrder(['a-shadow-plan.md', 'a-r2-shadow-plan.md'], 'a').length === 0 && checkChainOrder([], 'a').length === 0 && checkChainOrder(['a-shadow-plan.md', 'a-pr-review.md'], 'a').length === 0);
// 50 变体折叠与边界锚定（chain-fold-boundary / chain-fold-literal 闸）
check('assert-chain-fold-boundary', foldRoundFromFilename('a-r2-shadow-plan.md') === 2 && foldRoundFromFilename('a-r12-pr-review.md') === 12 && foldRoundFromFilename('xp2-shadow-plan.md') === 1 && foldRoundFromFilename('a-shadow-plan.md') === 1);
check('assert-chain-fold-literal', foldRoundFromFilename('a-r3-shadow-plan.md') === 3 && foldRoundFromFilename('plan-governor-branch-pr-review-r3.md') === 3);
// 51 序号折叠恒为非负整数（round-int-guard 闸：捕获组限定 \d+）
check('assert-chain-round-coerce', Number.isInteger(foldRoundFromFilename('a-r07-shadow-plan.md')) && foldRoundFromFilename('a-r07-shadow-plan.md') === 7);
// 52 轮次上限（标准后缀与携带 rN 变体的非标准后缀形态均须被链扫描捕获）
check('assert-chain-round-limit', checkChainOrder(['a-r3-pr-review.md'], 'a').some((x) => x.msg.includes('超上限')) && checkChainOrder(['a-pr-review-r3.md'], 'a').some((x) => x.msg.includes('超上限')));
// 53 断档（有 r2 无 r1＝跳轮/换名重置；去重后判连续）
check('assert-chain-sequence-gap', checkChainOrder(['a-r2-shadow-plan.md'], 'a').some((x) => x.msg.includes('断档')));
// 54 信任根：非本链前缀的报告不折算、不误伤（chain-base-prefix-locked 闸，前缀锁定带 '-' 边界符；含跨链边界直接回归夹具）
check('assert-chain-base-prefix', checkChainOrder(['other-r3-shadow-plan.md', 'b-r9-pr-review.md'], 'a').length === 0 && checkChainOrder(['ab-r3-shadow-plan.md'], 'a').length === 0);
// 54b 多标记折叠须取最大轮次（chain-fold-max-marker 闸）：单标记语义把 a-r1-r3 折算为 1，
//   后置 r3 同时逃逸超上限熔断与断档判定；修复后 max=3，checkChainOrder 须同时产出两类违规。
check('assert-chain-fold-multi-marker',
  foldRoundFromFilename('a-r1-r3-pr-review.md') === 3
  && checkChainOrder(['a-r1-r3-pr-review.md'], 'a').some((x) => x.msg.includes('超上限'))
  && checkChainOrder(['a-r1-r3-pr-review.md'], 'a').some((x) => x.msg.includes('断档')));
// 55-57 结构闸：合规零违反（负控制）+ 影子/PR 缺段必咬 + 报告缺失
const SHADOW_OK = ['# 影子复审报告', '', '### E 清单', '', '差集为 0（镜像对账表）', '', '复跑比对无偏差', '', '### 终局裁决', '', 'SHADOW_PASS=done', 'GO', ''].join('\n');
const PR_OK = ['# PR 复审报告', '', 'E 清单：无', '', '实跑证据表：`npm test --prefix checks` 退出码 0', '', '已运行核实', '', 'SEMANTIC_PASS=done', 'TRUTH_PASS=done', 'VERDICT: GO', ''].join('\n');
const gv = (t, k) => { const v = []; checkReportStructureGate(t, k, v); return v; };
check('assert-structure-gate-clean-ok', gv(SHADOW_OK, 'shadow').length === 0 && gv(PR_OK, 'pr-review').length === 0);
check('assert-structure-gate-shadow', gv(SHADOW_OK.replace('差集为 0（镜像对账表）', ''), 'shadow').some((x) => x.msg.includes('结构闸缺失')));
check('assert-structure-gate-pr-review', gv(PR_OK.replace('实跑证据表：`npm test --prefix checks` 退出码 0', '').replace('已运行核实', ''), 'pr-review').some((x) => x.msg.includes('结构闸缺失')));
// 58 报告未落盘（物理在场不成立）
check('assert-structure-gate-missing-report', (() => { const v = []; checkReportStructureGate('', 'shadow', v); return v.some((x) => x.msg.includes('未落盘')); })());
// 59 闭合围栏内关键词冒充结构闸 ⇒ 不得放行（structure-gate-outside-fence 闸）
check('assert-structure-gate-fence-masked', gv(['# r', '', '```md', 'E 清单', '终局裁决', '差集', '复跑', '```', ''].join('\n'), 'shadow').some((x) => x.msg.includes('结构闸缺失')));
// 60 未闭合围栏交由 checkReportFormat fail-closed，结构闸不重复计数（负控制，仅 shadow 侧 defer）
check('assert-structure-gate-unclosed-deferred', (() => { const v = []; checkReportStructureGate(SHADOW_OK + '\n```md\n未闭合', 'shadow', v); return v.length === 0; })());
// 61 PR 复审报告未闭合围栏必须 fail-closed（checkReportFormat 仅消费 shadow 报告，pr-review 侧无外部兜底，静默放行即伪造绕过）
check('assert-structure-gate-pr-unclosed-failclosed', (() => { const v = []; checkReportStructureGate(PR_OK + '\n```md\n未闭合', 'pr-review', v); return v.some((x) => x.msg.includes('未闭合')); })());
// 62 路径逃逸负控制：纯数组消费面无外部基准解析（chain-path-join-root 闸，正控）
check('assert-chain-path-join-root', checkChainOrder(['a-shadow-plan.md'], 'a').length === 0);

// 63 base 限定折叠（chain-fold-base-scoped 闸）：计划主题自带 -rN 时轮次折算必须限定在计划基名之后的
//   剩余段——base 传参场景下主题内 -r3（auth-r3-refactor）不得折算为轮次、链序零违反；真变体 -r2 仍
//   正常折算；单参调用形态（默认 base=''）与既有夹具逐条等价。
const TOPIC_BASE = '20260731-153000-auth-r3-refactor';
check('assert-chain-fold-base-scoped',
  foldRoundFromFilename(TOPIC_BASE + '-shadow-plan.md', TOPIC_BASE) === 1
  && checkChainOrder([TOPIC_BASE + '-shadow-plan.md'], TOPIC_BASE).length === 0
  && foldRoundFromFilename(TOPIC_BASE + '-r2-shadow-plan.md', TOPIC_BASE) === 2
  && foldRoundFromFilename('a-r1-r3-pr-review.md', 'a') === 3
  && checkChainOrder(['a-r1-r3-pr-review.md'], 'a').some((x) => x.msg.includes('超上限'))
  && checkChainOrder(['a-r1-r3-pr-review.md'], 'a').some((x) => x.msg.includes('断档'))
  && foldRoundFromFilename('a-r1-r3-pr-review.md') === 3
  && foldRoundFromFilename('xp2-shadow-plan.md') === 1
  && foldRoundFromFilename('a-r07-shadow-plan.md') === 7);

// 64 过滤器与折叠同段（chain-filter-same-scope 闸）：链扫描过滤器与 foldRoundFromFilename 必须消费
//   同一后缀段——base 主题内含 -rN（如 auth-r3-topic）时，非报告文件 *-notes.md 不得因全名命中
//   ROUND_RE 而混入链序扫描（折叠按裸后缀得假 r1），否则真实缺 r1 的断档被完全掩蔽；
//   同段化以 '-' + 后缀补回 base 边界，end 锚定的 SHADOW_RE/PR_REVIEW_RE 边界语义与全名判定
//   严格等价（裸后缀判定会漏掉无轮次标记的报告后缀，如 base=a 时 a-shadow-plan.md 的后缀）。
const SAME_SCOPE_BASE = 'auth-r5-topic';
check('assert-chain-filter-same-scope',
  checkChainOrder([SAME_SCOPE_BASE + '-notes.md', SAME_SCOPE_BASE + '-r2-shadow-plan.md'], SAME_SCOPE_BASE).some((x) => x.msg.includes('断档'))
  && checkChainOrder([SAME_SCOPE_BASE + '-notes.md', SAME_SCOPE_BASE + '-r2-pr-review.md'], SAME_SCOPE_BASE).some((x) => x.msg.includes('断档'))
  && checkChainOrder(['a-shadow-plan.md', 'a-pr-review.md'], 'a').length === 0
  && checkChainOrder(['a-r2-shadow-plan.md'], 'a').some((x) => x.msg.includes('断档'))
  && checkChainOrder([TOPIC_BASE + '-notes.md', TOPIC_BASE + '-r2-shadow-plan.md'], TOPIC_BASE).some((x) => x.msg.includes('断档'))
  && checkChainOrder([TOPIC_BASE + '-shadow-plan.md'], TOPIC_BASE).length === 0);

// 65 计划名匹配谓词（latest-companion-exclude-gate 闸）：兼容 4/6 位时间戳；伴生产物必须排除，
//   否则 --latest 会把证据日志/复审报告误当计划选中（伴生误选 = 视图-执行分叉）。
check('assert-latest-companion-exclude-gate',
  isPlanFilename('20260929-0837-plan.md') === true
  && isPlanFilename('20260731153000-add-export-plan.md') === true
  && isPlanFilename('20261005-date-only-topic-plan.md') === true
  && isPlanFilename('202609291234567890-x.md') === false
  && isPlanFilename('20260731-153000-auth-r3-refactor.md') === true
  && isPlanFilename('20260929-0837-plan-test-evidence.md') === false
  && isPlanFilename('20260929-0837-plan-pr-review.md') === false
  && isPlanFilename('20260929-0837-plan-shadow-plan.md') === false
  && isPlanFilename('20260929-0837-plan.lease.md') === false
  && isPlanFilename('commit_msg.md') === false);

// 66 latest-unclosed-exclude-gate 闸：--latest 选择域排除未闭环工作内存产物——缺「## 攻击面台账」
//   节（围栏外）的时间戳命名计划不进入审计选择域；选择与审计共用同一台账节判定（同源不分叉）。
//   全部候选被排除时选择结果为空，CLI 落 EXIT-2 明确报无可选计划（fail-loud，严禁静默 Exit 0）。
check('assert-latest-unclosed-exclude-gate',
  attackLedgerNs.pickLatestEligible([
    { f: '20261005-agent-body-shared-blocks.md', text: '# 计划\n## Files\n| Modify | `README.md` | x |\n' },
    { f: '20261006-rework.md', text: '# 计划\n## Files\n| Modify | `checks/attack-ledger.mjs` | x |\n\n## 攻击面台账\n- 台账行\n- 类别：视图-执行语义分叉\n' },
  ]).f === '20261006-rework.md'
  && attackLedgerNs.pickLatestEligible([
    { f: 'b.md', text: '# 计划\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).skipped.join(',') === 'b.md'
  && attackLedgerNs.pickLatestEligible([{ f: 'only.md', text: '# 计划\n' }]).f === null
  && attackLedgerNs.pickLatestEligible([]).f === null);
// 67 台账节判定围栏掩蔽：围栏内的假台账标题不得使候选合格（与审计侧 scanFences 掩蔽同口径）。
check('assert-latest-unclosed-exclude-gate-fence-masked',
  attackLedgerNs.pickLatestEligible([{ f: 'a.md', text: '```md\n## 攻击面台账\n```\n' }]).f === null);
// 选择-审计同构（视图-执行语义分叉闭合）：缺「## 攻击面台账」节但 Files 节命中执法文件的候选必须被
//   选中（fail-closed，交审计侧 loud 报缺节，严禁静默 skip 漂移到更旧候选）；未闭合围栏 + 原文命中执法
//   文件名的 fail-closed 变体同入选；围栏掩蔽的假 Files 节不触发入选；非执法类缺节候选仍 skip。
check('assert-latest-enforcement-no-ledger-selected',
  attackLedgerNs.pickLatestEligible([
    { f: 'c.md', text: '# 计划\n## Files\n| Modify | `checks/attack-ledger.mjs` | x |\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).f === 'c.md'
  && attackLedgerNs.pickLatestEligible([
    { f: 'd.md', text: '# 计划\n```md\nchecks/build-agents.mjs\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).f === 'd.md'
  && attackLedgerNs.pickLatestEligible([
    { f: 'e.md', text: '# 计划\n```md\n| Modify | `checks/attack-ledger.mjs` |\n```\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).f === 'a.md'
  && attackLedgerNs.pickLatestEligible([
    { f: 'f.md', text: '# 计划\n## Files\n| Modify | `README.md` | x |\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).f === 'a.md');
// 66 PR 复审报告机读行结构闸（pr-report-semantic-pass-gate）：三端 pr-reviewer 规程硬要求
//   SEMANTIC_PASS=done|partial 行；缺行必咬、含行零违反（partial 禁 GO 不得停留在散文面）。
const PR_NO_SEM = ['# PR 复审报告', '', 'E 清单：无', '', '实跑证据表：`npm test --prefix checks` 退出码 0', '', '已运行核实', '', 'TRUTH_PASS=done', ''].join('\n');
check('assert-pr-report-semantic-pass-gate',
  gv(PR_NO_SEM, 'pr-review').some((x) => x.msg.includes('结构闸缺失')) && gv(PR_OK, 'pr-review').length === 0);

// 67-70 语义五问机读行值语义闸（semantic-pass-partial-no-go）：SEMANTIC_PASS 非 done 与 VERDICT: GO
//   并存必须判红（三端 pr-reviewer 规程硬要求「partial 即禁 GO」，旧结构闸只扫子串存在 ⇒ 两视图分叉零红灯）；
//   done+GO 与 partial+NO-GO / 末次取值改写为 done 为负控制（不得误伤）；`unknown` 等值域外形态
//   自值域收窄起改由结构闸判红（PR_REVIEW_GATE_RES 不命中即「结构闸缺失」），不再经值语义闸。
const SP_OK = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=done\nVERDICT: GO');
const SP_PARTIAL_GO = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial:契约清单（未完成五问节四）\nVERDICT: GO');
const SP_PARTIAL_NOGO = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial:契约清单（未完成五问节四）\nVERDICT: NO-GO');
const SP_UNKNOWN_GO = PR_OK.replace('SEMANTIC_PASS=done', 'SEMANTIC_PASS=unknown');
const SP_ERRATA_DONE = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial:x\nSEMANTIC_PASS=done\nVERDICT: GO');
check('assert-semantic-pass-partial-no-go', rvSome(SP_PARTIAL_GO, 'semantic-pass-partial-no-go'));
check('assert-semantic-pass-non-done-value-no-go', gv(SP_UNKNOWN_GO, 'pr-review').some((x) => x.msg.includes('结构闸缺失') && x.msg.includes('SEMANTIC_PASS')));
check('assert-semantic-pass-done-go-ok', rv(SP_OK).length === 0 && rv(SP_PARTIAL_NOGO).length === 0 && rv(SP_ERRATA_DONE).length === 0);
// 70 接线：PR 复审报告经 attackLedger(prReviewReportText) 同样受此闸约束（shadow 侧走 checkReportFormat）
check('assert-semantic-pass-pr-report-wired',
  attackLedger(auditorPlan, { prReviewReportText: SP_PARTIAL_GO }).some((x) => x.msg.includes('semantic-pass-partial-no-go')));
// 71-77 租约三闸的派发权载体派生（dispatch-carrier-derived / F8b）：载体由平台编排拓扑现场推导，
//   既不依赖单平台名硬编码，也不得把派发义务压到 tools: [] 无派发权的子代理文件上。
const zcodeSubagentFm = ['---', 'name: plan-writer-subagent-sp', 'description: d', 'color: orange', 'tools: []', 'permissionMode: dontAsk', 'injectAgentsMd: true', '---', ''].join('\n');
const zcodeWriterFm = ['---', 'name: plan-writer-sp', 'description: d', 'color: orange', 'tools: []', 'permissionMode: dontAsk', 'injectAgentsMd: true', '---', ''].join('\n');
const kiloWriterFm = ['---', 'mode: all', 'description: d', 'options:', '  id: plan-writer-sp', 'permission:', '  read: allow', '---', ''].join('\n');
const cbWriterFm = ['---', 'name: plan-writer-sp', 'description: d', 'model: inherit', 'tools: []', 'agentMode: agentic', 'enabled: true', 'enabledAutoRun: true', 'mcpServers: x', '---', ''].join('\n');
const LEASE_TRIO = '派发去重租约\n写后立即回读核验首行\n严禁复用固定字面量\n';
const LEASE_IDS = ['clause-dispatch-lease', 'clause-lease-exclusive-readback', 'clause-lease-identity-entropy', 'dispatch-carrier-derived'];

// 71 子代理-only 平台（zcode 现状）：载体＝zcode/AGENTS.md——三闸缺标记必咬、三标记在场不误伤。
check('assert-clause-lease-zcode-agents-carrier',
  has([{ path: 'zcode/AGENTS.md', text: '无租约协议\n' }], 'clause-dispatch-lease', 'zcode/AGENTS.md')
  && has([{ path: 'zcode/AGENTS.md', text: '无租约协议\n' }], 'clause-lease-exclusive-readback', 'zcode/AGENTS.md')
  && has([{ path: 'zcode/AGENTS.md', text: '无租约协议\n' }], 'clause-lease-identity-entropy', 'zcode/AGENTS.md')
  && !has([{ path: 'zcode/AGENTS.md', text: LEASE_TRIO }], 'clause-lease-exclusive-readback', 'zcode/AGENTS.md'));

// 71b 负控（漏配单枚标记）：只缺「写后立即回读核验首行」时仅该闸判红，另两闸不得连带误伤。
check('assert-carrier-derived-marker-partial',
  has([{ path: 'zcode/AGENTS.md', text: '派发去重租约\n严禁复用固定字面量\n' }], 'clause-lease-exclusive-readback', 'zcode/AGENTS.md')
  && !has([{ path: 'zcode/AGENTS.md', text: '派发去重租约\n严禁复用固定字面量\n' }], 'clause-dispatch-lease', 'zcode/AGENTS.md')
  && !has([{ path: 'zcode/AGENTS.md', text: '派发去重租约\n严禁复用固定字面量\n' }], 'clause-lease-identity-entropy', 'zcode/AGENTS.md'));

// 72 负控A（脱钩硬编码 + 拓扑翻转）：zcode 补出编排器代理后，载体迁到该 agent 文件——
//   AGENTS.md 缺标记不再判红；反证「真迁移而非消失」：同拓扑下 agent 文件缺标记必判红于该 agent 路径。
const flipToOrchestrator = [
  { path: 'zcode/AGENTS.md', text: '无租约协议\n' },
  { path: 'zcode/agents/plan-writer-sp.md', text: zcodeWriterFm + LEASE_TRIO },
];
const flipMissingOnAgent = [
  { path: 'zcode/AGENTS.md', text: '无租约协议\n' },
  { path: 'zcode/agents/plan-writer-sp.md', text: zcodeWriterFm + '无租约协议\n' },
];
check('assert-carrier-derived-topology-flip',
  deriveDispatchCarrier(flipToOrchestrator, 'zcode') === 'zcode/agents/plan-writer-sp.md'
  && !has(flipToOrchestrator, 'clause-dispatch-lease', 'zcode/AGENTS.md')
  && !has(flipToOrchestrator, 'clause-lease-exclusive-readback', 'zcode/AGENTS.md')
  && !has(flipToOrchestrator, 'clause-lease-identity-entropy', 'zcode/AGENTS.md')
  && has(flipMissingOnAgent, 'clause-dispatch-lease', 'zcode/agents/plan-writer-sp.md')
  && has(flipMissingOnAgent, 'clause-lease-exclusive-readback', 'zcode/agents/plan-writer-sp.md')
  && has(flipMissingOnAgent, 'clause-lease-identity-entropy', 'zcode/agents/plan-writer-sp.md'));

// 72b 负控A反证（脱钩）：子代理文件不再具备载体身份——它缺标记时，判红不得落在它头上。
check('assert-carrier-derived-subagent-not-carrier',
  deriveDispatchCarrier([{ path: 'zcode/agents/plan-writer-subagent-sp.md' }], 'zcode') === 'zcode/AGENTS.md'
  && !has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: zcodeSubagentFm + '无租约协议\n' }], 'clause-lease-exclusive-readback', 'zcode/agents/plan-writer-subagent-sp.md'));

// 73 负控C（第 4 平台自适应）：新增子代理-only 平台 foo/（无编排器代理）⇒ 载体＝foo/AGENTS.md，
//   三闸必判红于 foo/AGENTS.md；foo 的子代理文件不得被当成载体。
const fourthPlatform = [
  { path: 'foo/AGENTS.md', text: '无租约协议\n' },
  { path: 'foo/agents/plan-writer-subagent-sp.md', text: zcodeSubagentFm + '无租约协议\n' },
];
check('assert-carrier-derived-fourth-platform',
  deriveDispatchCarrier(fourthPlatform, 'foo') === 'foo/AGENTS.md'
  && has(fourthPlatform, 'clause-dispatch-lease', 'foo/AGENTS.md')
  && has(fourthPlatform, 'clause-lease-exclusive-readback', 'foo/AGENTS.md')
  && has(fourthPlatform, 'clause-lease-identity-entropy', 'foo/AGENTS.md')
  && !has(fourthPlatform, 'clause-lease-exclusive-readback', 'foo/agents/plan-writer-subagent-sp.md'));

// 73b fail-closed：派生载体缺场（治理文件被删）不得静默放过租约义务。
check('assert-carrier-derived-missing-carrier-failclosed',
  has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: zcodeSubagentFm + LEASE_TRIO }], 'dispatch-carrier-derived', 'zcode/AGENTS.md'));

// 74 正控：三端编排拓扑齐全、各自派生载体三标记在场 ⇒ 租约三闸与派生闸零违反。
const leaseAllGood = [
  { path: 'kilocode/AGENTS.md', text: '本文不承载租约义务（载体是编排器代理文件）。\n' },
  { path: 'kilocode/agents/plan-writer-sp.md', text: kiloWriterFm + LEASE_TRIO },
  { path: 'codebuddy/AGENTS.md', text: '本文不承载租约义务（载体是编排器代理文件）。\n' },
  { path: 'codebuddy/agents/plan-writer-sp.md', text: cbWriterFm + LEASE_TRIO },
  { path: 'zcode/AGENTS.md', text: LEASE_TRIO },
];
check('assert-carrier-derived-positive-control',
  runAll(leaseAllGood).filter((v) => LEASE_IDS.includes(v.id)).length === 0,
  'ids=' + runAll(leaseAllGood).filter((v) => LEASE_IDS.includes(v.id)).map((v) => v.id + '@' + v.path).join(','));
// 缺载体去重闸：同一平台派生载体缺场只报 1 条 dispatch-carrier-derived（旧实现随条款循环
// 逐条重复上报 3 条同路径违规，属噪声非信息）。
check('assert-carrier-derived-missing-reported-once',
  runAll([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: zcodeSubagentFm }])
    .filter((v) => v.id === 'dispatch-carrier-derived' && v.path === 'zcode/AGENTS.md').length === 1);
// 扫描根差集闸：SCAN_ROOTS 硬编码四目录，新顶层平台目录从不被 walk、其文件对全部闸门不存在，
// 必须在入口大声报错；点目录不构成平台根（内部内存），已登记非平台根（checks/mcp）不误伤。
check('assert-unscanned-root-directory-detected',
  unscannedRoots(scanEntryDirNames(['kilocode', 'codebuddy', 'zcode', 'skills', 'checks', 'mcp', 'newplat', '.kilo']), ['kilocode', 'codebuddy', 'zcode', 'skills']).join(',') === 'newplat');
// 未登记平台 fail-loud 闸：平台治理/代理形态路径若未被 CLASSES 登记分类，必须显式检出，
// 不得被 classify 过滤静默丢弃（静默丢弃=已登记根内新平台文件全部闸门失效且零信号）。
// 登记三平台与非平台根形态路径为负控制（不误伤）。
check('assert-unclassified-platform-file-detected',
  unclassifiedPlatformFiles([
    { path: 'foo/AGENTS.md', text: 'x' },
    { path: 'foo/agents/bar.md', text: 'x' },
    { path: 'zcode/AGENTS.md', text: 'x' },
    { path: 'zcode/agents/plan-writer-subagent-sp.md', text: 'x' },
    { path: 'skills/demo/SKILL.md', text: 'x' },
    { path: 'foo/notes.md', text: 'x' },
    { path: 'a/b/AGENTS.md', text: 'x' },
  ]).join(',') === 'foo/AGENTS.md,foo/agents/bar.md');
// 语义五问机读行职责切分负控：checkReportFormat（shadow 侧）不得对 SEMANTIC_PASS 缺行误伤
// （该行存在性归 pr-review 结构闸、值语义归 semantic-pass-partial-no-go，shadow 报告合法缺行）。
check('assert-report-format-no-semantic-pass-on-shadow',
  rv(REPORT_OK).filter((x) => x.msg.includes('SEMANTIC_PASS')).length === 0);
// 全链接线负控：PR 复审报告缺 SEMANTIC_PASS 行经 attackLedger 完整接线必咬（结构闸），
// partial+GO 经完整接线必咬（值语义）——两闸职责互斥、各自可达、无一回落为零红灯。
check('assert-semantic-pass-full-wiring',
  attackLedger(auditorPlan, { prReviewReportText: PR_NO_SEM }).some((x) => x.msg.includes('结构闸缺失') && x.msg.includes('SEMANTIC_PASS'))
  && attackLedger(auditorPlan, { prReviewReportText: SP_PARTIAL_GO }).some((x) => x.msg.includes('semantic-pass-partial-no-go')));
// 78 SEMANTIC_PASS 结构闸整行锚定：散文提及与行内代码引用不得满足机读行（子串匹配即 fail-open）；
// 独立整行 SEMANTIC_PASS=done 仍须满足（负控制，防收紧误伤）。
check('assert-semantic-pass-gate-whole-line-anchored',
  gv(PR_NO_SEM + '\n审查备注：SEMANTIC_PASS=partial 因五问缺节暂未完成。', 'pr-review').some((x) => x.msg.includes('SEMANTIC_PASS'))
  && gv(PR_NO_SEM + '\n机读行示例：`SEMANTIC_PASS=done`（围栏外行内代码引用不计数）', 'pr-review').some((x) => x.msg.includes('SEMANTIC_PASS'))
  && gv(PR_NO_SEM + '\nSEMANTIC_PASS=done\nVERDICT: GO', 'pr-review').length === 0);
// 79 闸 A 构建产物豁免：node_modules 等本地构建产物根不构成未登记扫描根；真实未登记平台目录仍咬。
check('assert-scan-entry-ignores-build-artifacts',
  scanEntryDirNames(['kilocode', 'codebuddy', 'zcode', 'skills', 'checks', 'mcp', 'node_modules', '.kilo', 'newplat']).join(',') === 'kilocode,codebuddy,zcode,skills,newplat'
  && unscannedRoots(scanEntryDirNames(['node_modules', 'newplat']), ['kilocode', 'codebuddy', 'zcode', 'skills']).join(',') === 'newplat');
// 80 登记常量单一事实源漂移断言：run.mjs 报错文案引用的常量名必须与代码实参同源。
check('assert-scan-registry-constants-drift',
  invariants.SCAN_ROOTS.join(',') === 'kilocode,codebuddy,zcode,skills'
  && invariants.NON_PLATFORM_ROOTS.join(',') === 'checks,mcp,spec'
  && invariants.BUILD_ARTIFACT_ROOTS.join(',') === 'node_modules');
// 81 入口闸 id 登记：防"删掉 run.mjs 闸调用、汇总与 OK 行静默消失"的接线漂移。
check('assert-entry-gate-ids-registered',
  allInvariantIds().includes('unscanned-root-directory') && allInvariantIds().includes('unclassified-platform-file'));
// 82 扫描根差集单点过滤：unscannedRoots 只做 SCAN_ROOTS 差集（二元签名钉死，签名回漂即红），
//   非平台根/构建产物根/点目录的排除收敛于 scanEntryDirNames 单一事实源——入口双处过滤
//   （NON_PLATFORM_ROOTS 既滤于 scanEntryDirNames 又作死参再传入）即口径漂移面。
check('assert-unscanned-roots-single-filter-source',
  unscannedRoots.length === 2
  && unscannedRoots(scanEntryDirNames(['kilocode', 'codebuddy', 'zcode', 'skills', 'checks', 'mcp', 'node_modules', 'newplat', '.kilo']), ['kilocode', 'codebuddy', 'zcode', 'skills']).join(',') === 'newplat'
  && scanEntryDirNames(['checks', 'mcp', 'node_modules', '.kilo', 'newplat']).join(',') === 'newplat');
// 83 SEMANTIC_PASS 机读行尾硬换行容忍：行尾双空格（Markdown 硬换行）不得使机读行漏判；
//   散文缺行仍必咬（负控制）。
check('assert-semantic-pass-gate-trailing-hardbreak-tolerated',
  gv(PR_NO_SEM + '\nSEMANTIC_PASS=done  \nVERDICT: GO', 'pr-review').length === 0
  && gv(PR_NO_SEM, 'pr-review').some((x) => x.msg.includes('SEMANTIC_PASS')));
// 83b 值域收窄后的口径（双机读行行尾硬换行）：裸 `partial`（无冒号缺项）自收窄起属非法形态，
//   改由结构闸判红（GATE_RE 不命中即「结构闸缺失」，行尾硬换行不豁免——行尾容忍只收 [ \t]，
//   非法值本身仍不命中）；合法形态（partial:<非空缺项>、行尾无空白）的值语义闸必咬由第二子句
//   （SP_PARTIAL_GO）承担，合法机读行行尾硬换行不漏判由 513-515 行断言（done 形态）负控制覆盖。
check('assert-semantic-pass-value-trailing-hardbreak-detected',
  gv(PR_NO_SEM + '\nSEMANTIC_PASS=partial  \nVERDICT: GO', 'pr-review').some((x) => x.msg.includes('结构闸缺失') && x.msg.includes('SEMANTIC_PASS'))
  && rvSome(SP_PARTIAL_GO, 'semantic-pass-partial-no-go'));
// 83c 三处取值正则（TRUTH_PASS/SEMANTIC_PASS/SHADOW_PASS 的 *_LINE_RE）行尾 [ \t]* 容忍面的值语义闸钉死：
//   带行尾硬换行空白的 partial:<非空缺项> 修正行必须仍命中取值正则并被值语义闸消费（partial×GO 即红）——
//   若删掉任一 LINE_RE 末尾 [ \t]*，本组三断言全部转红（行不再命中锚定，值语义闸缺行早退、信号消失）。
check('assert-truth-pass-value-trailing-hardbreak-detected',
  attackLedger(auditorPlan, { prReviewReportText: PR_OK.replace('TRUTH_PASS=done', 'TRUTH_PASS=partial:夹具保真度对账（节九未完成）  ') }).some((x) => x.msg.includes('truth-pass-partial-no-go')));
check('assert-semantic-pass-value-trailing-hardbreak-detected-value-side',
  attackLedger(auditorPlan, { prReviewReportText: PR_OK.replace('SEMANTIC_PASS=done', 'SEMANTIC_PASS=partial:契约清单（未完成五问节四）  ') }).some((x) => x.msg.includes('semantic-pass-partial-no-go')));
check('assert-shadow-pass-value-trailing-hardbreak-detected',
  rvSome(REPORT_OK.replace('SHADOW_PASS=done', 'SHADOW_PASS=partial:契约执行闸（⑩ 未逐条给出结论）  '), 'shadow-pass-partial-no-go'));
// 84 VERDICT 机读行结构闸：缺 VERDICT 行的 PR 复审报告必判红——checkReportFormat 只消费
//   shadow 报告、checkSemanticPassVerdict 缺 SEMANTIC_PASS 行时静默跳过，两闸对 pr-review
//   报告 VERDICT 缺行双失明；含行零违反（负控制），完整接线（attackLedger）同咬。
const PR_NO_VERDICT = PR_OK.replace('\nVERDICT: GO', '');
check('assert-pr-report-verdict-gate',
  gv(PR_NO_VERDICT, 'pr-review').some((x) => x.msg.includes('结构闸缺失') && x.msg.includes('VERDICT'))
  && gv(PR_OK, 'pr-review').length === 0);
check('assert-pr-report-verdict-gate-wired',
  attackLedger(auditorPlan, { prReviewReportText: PR_NO_VERDICT }).some((x) => x.msg.includes('VERDICT')));
// 85 报告格式行行尾硬换行（report-format-trailing-hardbreak-gate）：ATTACKS/PENETRATIONS 行尾空白
//   （Markdown 硬换行）不得使格式行漏判（与 SEMANTIC_PASS/VERDICT 行尾 [ \t]* 同口径，消除 fail-closed
//   假红）；容忍面只收 [ \t]，行尾续写非空白字符仍必咬（负控制，防容忍面过宽吞掉非法续写）。
check('assert-report-format-attacks-trailing-hardbreak-tolerated',
  rv([atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2  ', 'PENETRATIONS=0  ', 'SHADOW_PASS=done', 'VERDICT: GO'].join('\n')).length === 0
  && rvSome([atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2x', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n'), '缺 ATTACKS='));
// 86 VERDICT 整行锚定单一事实源（verdict-line-single-source-gate）：结构闸 VERDICT_GATE_RE 与取值闸
//   消费的 VERDICT_LINE_RE 必须同源（source 相等、仅 /m 差异）——三份复制漂移时改结构闸则值语义闸
//   静默跳过（partial+GO 漏判）、只改内联两处则结构闸假红；单源派生后捕获组契约（m[1]＝判定值）与
//   取值枚举严格性（BOGUS 不匹配）由本断言钉死。
check('assert-verdict-line-single-source',
  !!VERDICT_LINE_RE && !!VERDICT_GATE_RE
  && VERDICT_LINE_RE.source === VERDICT_GATE_RE.source
  && VERDICT_GATE_RE.flags.includes('m') && !VERDICT_LINE_RE.flags.includes('m')
  && ('VERDICT: NO-GO'.match(VERDICT_LINE_RE) || [])[1] === 'NO-GO'
  && 'VERDICT: BOGUS'.match(VERDICT_LINE_RE) === null);
// 87-93 真相源四问机读行（TRUTH_PASS）与影子侧完整性行（SHADOW_PASS）的机器闸：
//   结构闸（行存在性，pr-report-truth-pass-gate / shadow-report-shadow-pass-gate）与
//   值语义闸（truth-pass-partial-no-go / shadow-pass-partial-no-go）双层，职责互斥不重叠。
//   红灯期四枚正则在 attack-ledger.mjs 尚未导出，断言经既有 gv/rv/attackLedger 通道实跑比对而红，
//   不依赖 ESM 命名导入，故不存在链接期 SyntaxError 冒充真红（[REJECT-FAKE]）的路径。
// 87 PR 侧结构闸：缺 TRUTH_PASS 行必判红；含行零违反（负控制）。
const PR_NO_TRUTH = PR_OK.replace('\nTRUTH_PASS=done', '');
check('assert-truth-pass-gate',
  gv(PR_NO_TRUTH, 'pr-review').some((x) => x.msg.includes('结构闸缺失') && x.msg.includes('TRUTH_PASS'))
  && gv(PR_OK, 'pr-review').length === 0);
// 88 PR 侧值语义闸：非 done × GO 并存必判红；done × GO 与 非 done × NO-GO 零违反（负控制）。
const TP_PARTIAL_GO = PR_OK.replace('TRUTH_PASS=done', 'TRUTH_PASS=partial:夹具保真度对账（节九未完成）');
const prWired = (text) => attackLedger(auditorPlan, { prReviewReportText: text });
const prWiredSome = (text, frag) => prWired(text).some((x) => x.msg.includes(frag));
check('assert-truth-pass-partial-no-go',
  prWiredSome(TP_PARTIAL_GO, 'truth-pass-partial-no-go')
  && !prWiredSome(TP_PARTIAL_GO.replace('VERDICT: GO', 'VERDICT: NO-GO'), 'truth-pass-partial-no-go')
  && !prWiredSome(PR_OK, 'truth-pass-partial-no-go'));
// 89 PR 侧结构闸整行锚定（负控制）：散文提及与围栏外行内代码引用不得满足 TRUTH_PASS 机读行。
check('assert-truth-pass-gate-whole-line-anchored',
  gv(PR_NO_TRUTH + '\n审查备注：TRUTH_PASS=partial 因四问缺节暂未完成。', 'pr-review').some((x) => x.msg.includes('TRUTH_PASS'))
  && gv(PR_NO_TRUTH + '\n机读行示例：`TRUTH_PASS=done`（行内代码引用不计数）', 'pr-review').some((x) => x.msg.includes('TRUTH_PASS')));
// 90 PR 侧结构闸行尾硬换行容忍（负控制）：合法机读行行尾双空格不得漏判。
check('assert-truth-pass-gate-trailing-hardbreak-tolerated',
  gv(PR_NO_TRUTH + '\nTRUTH_PASS=done  ', 'pr-review').length === 0);
// 91 影子侧结构闸：缺 SHADOW_PASS 行必判红；含行零违反（负控制）。
const SHADOW_NO_SP = SHADOW_OK.replace('\nSHADOW_PASS=done', '');
const REPORT_NO_SP = REPORT_OK.replace('\nSHADOW_PASS=done', '');
// 91 影子侧完整性行存在性闸（shadow-report-shadow-pass-gate）：已下沉至 checkReportFormat（恒执行路径），
//   故非执法类计划的影子报告同样被咬（覆盖面判据见下一节 94）；结构闸侧**不再**承载该行——
//   第三子句（SHADOW_NO_SP 经结构闸零违反）即「移出而非重复」的负控制，防后续被加回造成同一事实两处计数。
check('assert-shadow-pass-gate',
  rv(REPORT_NO_SP).some((x) => x.msg.includes('SHADOW_PASS'))
  && rv(REPORT_OK).filter((x) => x.msg.includes('SHADOW_PASS')).length === 0
  && gv(SHADOW_NO_SP, 'shadow').length === 0);
// 92 影子侧值语义闸：非 done × GO 并存必判红；done × GO 零违反（负控制）；经 checkReportFormat 实跑。
const SP_SHADOW_PARTIAL_GO = [atkRow(1), atkRow(2), '', RECEIPT, 'SHADOW_PASS=partial:契约执行闸（⑩ 未逐条给出结论）', 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n');
check('assert-shadow-pass-partial-no-go',
  rvSome(SP_SHADOW_PARTIAL_GO, 'shadow-pass-partial-no-go')
  && rv(SP_SHADOW_PARTIAL_GO.replace('SHADOW_PASS=partial:契约执行闸（⑩ 未逐条给出结论）', 'SHADOW_PASS=done')).length === 0);
// 93 跨侧职责切分负控制（Global Constraint 4）：shadow 报告缺 TRUTH_PASS 不判红，PR 报告缺 SHADOW_PASS 不判红。
//   影子侧**应当**校验 SHADOW_PASS（存在性归 checkReportFormat、值语义归 shadow-pass-partial-no-go），
//   故旧第 2 子句（断言影子侧不得提及 SHADOW_PASS）已随职责调整反向失效，此处改为钉死跨侧边界：
//   TRUTH_PASS 只在 PR 侧咬、绝不漏进影子侧；SHADOW_PASS 只在影子侧咬、绝不漏进 PR 报告。
check('assert-report-format-no-cross-side-pass-line',
  rv(REPORT_OK).filter((x) => x.msg.includes('TRUTH_PASS')).length === 0
  && attackLedger(auditorPlan, { prReviewReportText: PR_OK }).filter((x) => x.msg.includes('SHADOW_PASS')).length === 0
  && attackLedger(auditorPlan, { prReviewReportText: PR_NO_SEM }).filter((x) => x.msg.includes('SHADOW_PASS')).length === 0);

// 94 非执法类计划覆盖面（F5 闭环判据）：存在性闸在恒执行路径 ⇒ opts.reportText 通道对**任何**计划生效，
//   不再依赖仅 isSec 时注入的 shadowReportText（旧接线即非执法类失明的根因）。
//   plainPlan 的 Files 不含 ENFORCEMENT_FILES ⇒ isSec=false，与 CLI 非执法类分支等价。
const plainPlan = '# p\n## Files\n| Modify | `README.md` | x |\n';
check('assert-shadow-pass-gate-nonsec-plan-covered',
  attackLedger(plainPlan, { reportText: REPORT_NO_SP }).some((x) => x.msg.includes('SHADOW_PASS'))
  && attackLedger(plainPlan, { reportText: REPORT_OK }).filter((x) => x.msg.includes('SHADOW_PASS')).length === 0);
// 95 独立 GO 行形态（F1 闭环判据）：影子结构闸以「终局裁决 + 独立 GO」为合法形态（SHADOW_OK 即此形），
//   值语义闸若只锚 ^VERDICT: 则该形态下取不到判定行而静默跳过 ⇒ partial×GO 零红灯。
//   注意：该形态下 checkReportFormat 会另报「缺 VERDICT: 行」，故判据一律用 some/filter 而非 length === 0。
const standaloneGo = (sp) => [atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', sp, 'GO'].join('\n');
check('assert-shadow-pass-standalone-go-detected',
  rvSome(standaloneGo('SHADOW_PASS=partial:契约执行闸（⑩ 未逐条给出结论）'), 'shadow-pass-partial-no-go')
  && rv(standaloneGo('SHADOW_PASS=done')).filter((x) => x.msg.includes('shadow-pass-partial-no-go')).length === 0);
// 96 影子分支接线（F2 闭环判据）：结构闸之外必须同样跑值语义闸。判据覆盖三种相对关系——
//   ① `reportText` 缺位（调用方只传 shadowReportText）⇒ 补调生效（第一子句）；
//   ② 两路同一份文本 ⇒ 只由 checkReportFormat 计一次（第三子句钉死不重复计数）；
//   ③ 两路取值不同 ⇒ shadowReportText 必须被独立校验（第四子句钉死不漏检）。
check('assert-shadow-pass-shadow-text-only-wired',
  attackLedger(auditorPlan, { shadowReportText: SP_SHADOW_PARTIAL_GO }).some((x) => x.msg.includes('shadow-pass-partial-no-go'))
  && attackLedger(auditorPlan, { shadowReportText: SP_SHADOW_PARTIAL_GO.replace('SHADOW_PASS=partial:契约执行闸（⑩ 未逐条给出结论）', 'SHADOW_PASS=done') }).filter((x) => x.msg.includes('shadow-pass-partial-no-go')).length === 0
  && attackLedger(auditorPlan, { reportText: SP_SHADOW_PARTIAL_GO, shadowReportText: SP_SHADOW_PARTIAL_GO }).filter((x) => x.msg.includes('shadow-pass-partial-no-go')).length === 1
  && attackLedger(auditorPlan, { reportText: REPORT_OK, shadowReportText: SP_SHADOW_PARTIAL_GO }).filter((x) => x.msg.includes('shadow-pass-partial-no-go')).length === 1);
// 97 严格锚不被劫持（F1 闭环判据）：PR 侧值语义闸必须取 `^VERDICT:` 末次，报告里权威 `VERDICT: GO` 之后
//   出现任何裸 `NO-GO` 整行（ERRATA 复写 / 判定表单元格 / 模板示例）都不得劫持末次判定值——劫持即 fail-open，
//   本次要闭合的漏判形态。判据：TP_PARTIAL_GO + '\nNO-GO\n' 必须命中 truth-pass-partial-no-go。
const TP_HIJACK = TP_PARTIAL_GO + '\nNO-GO\n';
check('assert-truth-pass-verdict-strict-anchor-not-hijacked',
  prWiredSome(TP_HIJACK, 'truth-pass-partial-no-go'));
// 98 影子侧独立 GO 形态存在性判定（F4 闭环判据）：SHADOW_GATE_RES 承认「终局裁决 + 独立 GO」为合法形态，
//   checkReportFormat 消费 opts.reportText（恒为影子报告文本）的存在性判定必须同口径，否则代理照 ⑮ 条写独立 GO
//   报告 100% 判红。判据：影子报告含 SHADOW_PASS=done + 末尾 GO，`rv()` 结果不得含「缺 VERDICT」字样。
const SHADOW_STANDALONE_GO = [atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'SHADOW_PASS=done', 'GO'].join('\n');
check('assert-shadow-standalone-go-existence-ok',
  rv(SHADOW_STANDALONE_GO).filter((x) => x.msg.includes('缺 VERDICT')).length === 0);
// 99 attackLedger 独立 shadow 分支的 SHADOW_PASS 存在性（F6 闭环判据，CodeRabbit Major 双子句）：
//   子句 (a) 仅传 shadowReportText 且缺 SHADOW_PASS 行——checkReportFormat(null) 早退、SHADOW_GATE_RES 不含
//     SHADOW_PASS、checkShadowPassVerdict 缺行 return ⇒ 缺 SHADOW_PASS 的影子报告可通过完整性检查（漏判面）。
//   子句 (b) reportText 与 shadowReportText 两路不同且 shadowReportText 缺 SHADOW_PASS——两路文本不同时
//     opts.reportText !== opts.shadowReportText 为真，独立分支必须各自判存在性，否则 shadowReportText
//     逃离存在性闸。CodeRabbit 派发串明确要求覆盖「only shadowReportText」与「differs from reportText」
//     两种接线，缺一即未闭合建议。
check('assert-shadow-only-branch-requires-shadow-pass-anchor',
  attackLedger(auditorPlan, { shadowReportText: REPORT_NO_SP }).some((x) => x.msg.includes('SHADOW_PASS'))
  && attackLedger(auditorPlan, { reportText: REPORT_OK, shadowReportText: REPORT_NO_SP }).some((x) => x.msg.includes('SHADOW_PASS')));
// 100 PR 报告「独立 GO」形态两闸一致性（F2 闭环判据）：修复后 PR 侧值语义闸只锚 `^VERDICT:`，
//   PR 报告若采独立 GO 整行 → 结构闸（PR_REVIEW_GATE_RES 含 VERDICT_GATE_RE）判缺、值语义闸不咬；
//   两闸对该形态一致。判据：TP_PARTIAL_STANDALONE_GO 经 prWired 必须命中「结构闸缺失 · VERDICT」
//   且 `truth-pass-partial-no-go` 计数 0（修复前该计数 = 1，因值语义闸咬到 `GO`，即本用例 Red-Light 首跑必红）。
const TP_PARTIAL_STANDALONE_GO = TP_PARTIAL_GO.replace('VERDICT: GO', 'GO');
check('assert-pr-report-standalone-go-falls-back-to-strict-gate',
  prWired(TP_PARTIAL_STANDALONE_GO).some((x) => x.msg.includes('结构闸缺失') && x.msg.includes('VERDICT'))
  && prWired(TP_PARTIAL_STANDALONE_GO).filter((x) => x.msg.includes('truth-pass-partial-no-go')).length === 0);
// 101 独立 shadow 分支未闭合围栏 fail-closed：仅传 shadowReportText 且文本在合法格式行之后含未闭合围栏时，
//   结构闸（shadow 类静默 return）与旧独立分支（lineView 未解构 unclosed）双双失明 ⇒ 零红灯。
//   契约判据：必须命中「未闭合代码围栏」违规。探针 P1 已实测修复前 P1_UNCLOSED=[]，首跑必红。
const bt = String.fromCharCode(96, 96, 96);
const SHADOW_CLEAN = [atkRow(1), atkRow(2), '', RECEIPT, 'E 清单：无', '终局裁决', '镜像对账表', '复跑比对一致', 'ATTACKS=2', 'PENETRATIONS=0', 'SHADOW_PASS=done', 'GO'].join('\n');
check('assert-shadow-only-unclosed-fence-failclosed',
  attackLedger(auditorPlan, { shadowReportText: SHADOW_CLEAN + '\n' + bt }).some((x) => x.msg.includes('未闭合代码围栏')));
// 102 独立 shadow 分支全量格式闸接线：仅传 shadowReportText 且缺 ATTACKS=/PENETRATIONS= 行时，
//   旧独立分支只咬 SHADOW_PASS ⇒ 格式语义整体逃逸（探针 P2 已实测 P2_NO_ATK=[]，首跑必红）。
//   契约判据：必须命中「缺 ATTACKS」违规（存在性闸咬合即证全量闸已接线）。
const SHADOW_NO_ATK = SHADOW_CLEAN.replace('\nATTACKS=2', '').replace('\nPENETRATIONS=0', '');
check('assert-shadow-only-format-gate-wired',
  attackLedger(auditorPlan, { shadowReportText: SHADOW_NO_ATK }).some((x) => x.msg.includes('缺 ATTACKS')));
// 103 负控制（防重复计数）：两路同源文本（缺 ATTACKS= 形态）时，全量格式闸只由 opts.reportText 路径
//   计一次，独立分支跳过 ⇒ 「缺 ATTACKS」计数恒为 1。修复前后均应成立（C4 单计数契约的可审计钉死）。
check('assert-shadow-text-same-no-double-count',
  attackLedger(auditorPlan, { reportText: SHADOW_NO_ATK, shadowReportText: SHADOW_NO_ATK }).filter((x) => x.msg.includes('缺 ATTACKS')).length === 1);

// 104 pass 机读行值域闸：done|partial:<非空缺项> 之外的任意值（如 banana）即红，不因非 GO 判定豁免。
// 红绿账目（登记前 GATE_RE 值域开放，banana 零违规 ⇒ detected 必 FAIL＝真红；登记后三条全绿）。
const REPORT_SP_BANANA = 'ATTACKS=0\nPENETRATIONS=0\nSHADOW_PASS=banana\nVERDICT: NO-GO\n';
const REPORT_SP_DONE = 'ATTACKS=0\nPENETRATIONS=0\nSHADOW_PASS=done\nVERDICT: NO-GO\n';
check('assert-shadow-pass-value-domain',
  rv(REPORT_SP_BANANA).some((x) => x.msg.includes('SHADOW_PASS'))
  && rv(REPORT_SP_DONE).filter((x) => x.msg.includes('SHADOW_PASS')).length === 0
  && rv('ATTACKS=0\nPENETRATIONS=0\nSHADOW_PASS=partial:契约执行闸\nVERDICT: NO-GO\n').filter((x) => x.msg.includes('SHADOW_PASS')).length === 0);
const PR_PASS_BANANA = 'E 清单：无\n实跑证据表：x\nSEMANTIC_PASS=banana\nTRUTH_PASS=banana\nVERDICT: NO-GO\n';
// 清洁夹具必须用 NO-GO：partial:<非空缺项> 与 VERDICT: GO 并存是值语义闸（truth-pass-partial-no-go）
// 必然击穿形态——与 checks/selftest.mjs:560-566 的 TP_PARTIAL_GO 攻击夹具同构、极性相反（彼为必咬
// 攻击样本，此为零违规负控制），故判定行改 NO-GO 以保持「partial 合法形态在非 GO 下零违规」契约。
const PR_PASS_PARTIAL = PR_OK.replace('TRUTH_PASS=done', 'TRUTH_PASS=partial:夹具保真度对账（节九未完成）').replace('VERDICT: GO', 'VERDICT: NO-GO');
check('assert-truth-pass-value-domain',
  attackLedger(auditorPlan, { prReviewReportText: PR_PASS_BANANA }).some((x) => x.msg.includes('TRUTH_PASS'))
  && attackLedger(auditorPlan, { prReviewReportText: PR_PASS_PARTIAL }).filter((x) => x.msg.includes('TRUTH_PASS')).length === 0);
check('assert-semantic-pass-value-domain',
  attackLedger(auditorPlan, { prReviewReportText: PR_PASS_BANANA }).some((x) => x.msg.includes('SEMANTIC_PASS'))
  && attackLedger(auditorPlan, { prReviewReportText: PR_PASS_PARTIAL }).filter((x) => x.msg.includes('SEMANTIC_PASS')).length === 0);

// 104b 值域外机读行闸（pass-line-out-of-domain-gate）：「合法旧值 + 值域外新值并存」形态——值域收窄后
//   值域外行不命中锚定、末次取值退回旧合法行，值语义闸绿、结构闸被旧行满足 ⇒ 登记前全篇零红灯（fail-open 家族）。
//   本组三断言钉死三族：PR 侧 TRUTH_PASS / SEMANTIC_PASS、影子侧 SHADOW_PASS。
// 红绿账目（登记前无 stray 闸，三夹具零违规 ⇒ detected 必 FAIL＝真红；登记后三条全绿）。
const PR_STRAY_TRUTH = PR_OK.replace('VERDICT: GO', 'TRUTH_PASS=partial\nVERDICT: GO');
const PR_STRAY_SEM = PR_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial\nVERDICT: GO');
const SHADOW_STRAY = REPORT_OK + '\nSHADOW_PASS=partial';
check('assert-truth-pass-out-of-domain-stray-line-detected',
  attackLedger(auditorPlan, { prReviewReportText: PR_STRAY_TRUTH }).some((x) => x.msg.includes('TRUTH_PASS') && x.msg.includes('值域外')));
check('assert-semantic-pass-out-of-domain-stray-line-detected',
  attackLedger(auditorPlan, { prReviewReportText: PR_STRAY_SEM }).some((x) => x.msg.includes('SEMANTIC_PASS') && x.msg.includes('值域外')));
check('assert-shadow-pass-out-of-domain-stray-line-detected',
  rv(SHADOW_STRAY).some((x) => x.msg.includes('SHADOW_PASS') && x.msg.includes('值域外')));

// 105 registry 原子锚点：四问职责正文/结果表标题/计划作者义务正文被删除必须判红（子串必含条款逐条登记）。
// 红绿账目（登记前 clause id 不存在 ⇒ detected 必 FAIL＝真红；负控制空桩即 PASS）。
const PR_FM = ['---', 'name: pr-reviewer', 'description: d', 'tools: []', 'mcpServers: []', '---', ''];
const PW_ZC_FM = ['---', 'name: plan-writer', 'description: d', 'color: orange', 'tools: []', 'permissionMode: dontAsk', 'injectAgentsMd: true', '---', ''];
const FOUR_DUTIES = ['真相源反查（判据必须落在权威源上）', '读纯度与多真相源', '异常路径回滚与持锁活性', '夹具保真度对账', '真相源、读纯度与活性四问节结果表'];
const WRITER_DUTIES = ['逐条列出并各给一行缺席理由', '测试基线文件路径', '先读该基线文件、再逐条复跑其中的每条命令'];
const FOUR_IDS = ['clause-truth-source-anti-lookup', 'clause-read-purity-multi-truth-source', 'clause-liveness-rollback', 'clause-fixture-fidelity-audit', 'clause-four-question-result-table'];
const WRITER_IDS = ['clause-absent-file-per-item-reason', 'clause-baseline-path-declared', 'clause-evidence-verb-rerun'];
check('assert-clause-four-duty-anchors-detected',
  FOUR_DUTIES.every((t, i) => has([{ path: 'zcode/agents/pr-reviewer-subagent-sp.md', text: PR_FM.join('\n') + '无条款\n' }], FOUR_IDS[i])));
check('assert-clause-four-duty-anchors-clean-not-flagged',
  FOUR_DUTIES.every((t, i) => !has([{ path: 'zcode/agents/pr-reviewer-subagent-sp.md', text: PR_FM.join('\n') + t + '\n' }], FOUR_IDS[i])));
check('assert-clause-writer-duty-anchors-detected',
  WRITER_DUTIES.every((t, i) => has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: PW_ZC_FM.join('\n') + '无条款\n' }], WRITER_IDS[i])));
check('assert-clause-writer-duty-anchors-clean-not-flagged',
  WRITER_DUTIES.every((t, i) => !has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: PW_ZC_FM.join('\n') + t + '\n' }], WRITER_IDS[i])));
check('assert-clause-duty-anchors-scope-locked',
  FOUR_DUTIES.every((t, i) => !has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: PW_ZC_FM.join('\n') + t + '\n' }], FOUR_IDS[i])));

// —— 平台清点器（合成文件集，不读磁盘；期望值全部由第 5 节工具契约推导，非抄录实现） ——
const INV_FM = ['---', 'name: pw', 'description: d', 'tools: []', '---', ''];
const ANCHOR_A = '未见红严禁开工';
const mk = (lines) => lines.join('\n');
const invBase = () => PLATFORMS.map((p) => ({ path: `${p}/agents/pw.md`, text: mk([...INV_FM, '前导段', ANCHOR_A, '条款体', '尾段']) }));
// 106 三端同文 ⇒ 全部差异面为零（负控制，锚切分不产生假差异）。
check('inv-identical-zero-diff',
  (() => { const r = inventory(invBase()); return r.anchorSet.diffs.length === 0 && r.sections.diffs.length === 0 && r.frontmatter.diffs.length === 0 && r.fences.diffs.length === 0; })());
// 107 锚集差：一端缺锚文本 ⇒ anchor-set 恰一条、side=missing（锚集差本身记为一条差异）。
check('inv-anchor-set-missing-detected',
  (() => { const f = invBase(); f[1].text = mk([...INV_FM, '前导段', '无锚正文']); const r = inventory(f);
    return r.anchorSet.diffs.some((d) => d.path === 'codebuddy/agents/pw.md' && d.side === 'missing'); })());
// 108 frontmatter 键级 diff：一端多键 ⇒ fm-key-extra 恰一条、键名正确（结构化对比，非文本 diff）。
check('inv-fm-key-extra-detected',
  (() => { const f = invBase(); f[2].text = mk(['---', 'name: pw', 'description: d', 'tools: []', 'color: orange', '---', '前导段', ANCHOR_A, '尾段']); const r = inventory(f);
    return r.frontmatter.diffs.some((d) => d.path === 'zcode/agents/pw.md' && d.key === 'color' && d.kind === 'fm-key-extra'); })());
// 109 围栏内隔离：围栏内差异不进正文块差异、单独归 fences 面（与 lineView 围栏掩蔽同口径）。
const BT = String.fromCharCode(96, 96, 96);
check('inv-fence-isolation',
  (() => { const f = invBase(); f[0].text = mk([...INV_FM, '前导段', ANCHOR_A, BT, '示例 A', BT, '尾段']); f[1].text = mk([...INV_FM, '前导段', ANCHOR_A, BT, '示例 B 不同内容', BT, '尾段']); f[2].text = mk([...INV_FM, '前导段', ANCHOR_A, BT, '示例 A', BT, '尾段']);
    const r = inventory(f); return r.sections.diffs.length === 0 && r.fences.diffs.length === 1; })());
// 110 负控制：围栏内同文 ⇒ fences 面为零（防隔离面误伤）。
check('inv-fence-clean-not-flagged',
  (() => { const f = invBase().map((x) => ({ ...x, text: mk([...INV_FM, '前导段', ANCHOR_A, BT, '示例', BT, '尾段']) })); const r = inventory(f);
    return r.fences.diffs.length === 0; })());
// 111 锚重复出现：取首处为块边界，其余出现各计一条 anchor-repeat 差异（防重复正文被静默吸收）；
// line 断言为文件绝对行号（INV_FM 6 行偏移后重复锚位于第 10 行），防行号回退为掩蔽空间相对序号。
check('inv-anchor-repeat-counted',
  (() => { const f = invBase(); f[0].text = mk([...INV_FM, '前导段', ANCHOR_A, '条款体', ANCHOR_A, '重复段']); const r = inventory(f);
    const d = r.anchorSet.diffs.find((d) => d.path === 'kilocode/agents/pw.md' && d.kind === 'anchor-repeat');
    return !!d && d.line === 10; })());
// 112 三端围栏数不等：按出现序逐对配对，多出的围栏块计一条 fences 差异（不静默丢弃）。
check('inv-fence-count-unequal',
  (() => { const f = invBase(); f[1].text = mk([...INV_FM, '前导段', ANCHOR_A, BT, '示例', BT, BT, '多余围栏', BT, '尾段']); const r = inventory(f);
    return r.fences.diffs.length === 1; })());
// 113 frontmatter 跨角色不配对：CLI 真实混合形态（AGENTS.md 无 frontmatter + agents 有 frontmatter）
// 分属不同 roleOf 组，不得产生任何逐键 fm-key-extra 噪声（组间零对照）。每角色两成员
// （2×AGENTS.md + 2×agents），组内对照真实发生（AGENTS 组双方均无 frontmatter → 合法静默 0 条；
// agents 组键集叶值全等 → 0 条），排除"单成员组平凡 0 差异"的假绿：跨角色误配对即现逐键噪声。
check('inv-fm-cross-role-no-noise',
  (() => { const f = [
      { path: 'kilocode/AGENTS.md', text: mk(['# kilocode 约束', '正文段']) },
      { path: 'zcode/AGENTS.md', text: mk(['# zcode 约束', '正文段']) },
      { path: 'kilocode/agents/pw.md', text: mk([...INV_FM, '前导段', ANCHOR_A]) },
      { path: 'zcode/agents/pw.md', text: mk([...INV_FM, '前导段', ANCHOR_A]) },
    ]; const r = inventory(f); return r.frontmatter.diffs.length === 0; })());
// 114 组参照缺 frontmatter：同组（agents/pw.md）内参照无 frontmatter、成员有 → 恰一条 fm-reference-absent
// 登记信号（非逐键噪声）；成员亦无 frontmatter → 零条目（合法静默）。
check('inv-fm-reference-absent-registered-not-noise',
  (() => { const f = [
      { path: 'kilocode/agents/pw.md', text: mk(['前导段', ANCHOR_A]) },
      { path: 'zcode/agents/pw.md', text: mk([...INV_FM, '前导段', ANCHOR_A]) },
    ]; const r = inventory(f);
    return r.frontmatter.diffs.length === 1 && r.frontmatter.diffs[0].kind === 'fm-reference-absent'
      && r.frontmatter.diffs[0].reference === 'kilocode/agents/pw.md'
      && inventory([
        { path: 'kilocode/agents/pw.md', text: mk(['前导段', ANCHOR_A]) },
        { path: 'zcode/agents/pw.md', text: mk(['前导段', ANCHOR_A]) },
      ]).frontmatter.diffs.length === 0; })());
// 119 反向不对称对称化（M-1）：组参照有 frontmatter、成员无 → 恰一条 fm-member-absent 登记信号
//（修复前走 diffFmTrees 逐键 fm-key-missing 噪声：INV_FM 三键各一条，计数断言红灯）；成员亦有
// frontmatter → 零条目（合法静默，正控排除过度拦截）。
check('inv-fm-member-absent-registered-not-noise',
  (() => { const f = [
      { path: 'kilocode/agents/pw.md', text: mk([...INV_FM, '前导段', ANCHOR_A]) },
      { path: 'zcode/agents/pw.md', text: mk(['前导段', ANCHOR_A]) },
    ]; const r = inventory(f);
    return r.frontmatter.diffs.length === 1 && r.frontmatter.diffs[0].kind === 'fm-member-absent'
      && r.frontmatter.diffs[0].reference === 'kilocode/agents/pw.md'
      && inventory([
        { path: 'kilocode/agents/pw.md', text: mk([...INV_FM, '前导段', ANCHOR_A]) },
        { path: 'zcode/agents/pw.md', text: mk([...INV_FM, '前导段', ANCHOR_A]) },
      ]).frontmatter.diffs.length === 0; })());
// 115 围栏偏移下 unanchored startLine 为文件绝对行号：以重复锚构造 tail 段（E3 修复后单锚后尾段
// 并入块 lines、unanchored 面不再承接，故必须经重复锚后的 tail 冲刷进入 unanchored），尾段在文件
// 第 12 行（INV_FM 6 行 + 锚/围栏三行/重复锚），修复前掩蔽空间 pendingStart 相对值为 4——断言 12
// 即钉死绝对行号契约。
check('inv-unanchored-line-absolute-with-fence',
  (() => { const f = invBase(); f[0].text = mk([...INV_FM, ANCHOR_A, BT, 'code', BT, ANCHOR_A, '尾段A']); f[1].text = mk([...INV_FM, ANCHOR_A, BT, 'code', BT, ANCHOR_A, '尾段B']);
    const r = inventory(f); const d = r.unanchored.diffs.find((d) => d.path === 'codebuddy/agents/pw.md');
    return !!d && d.line === 12; })());
// 116 锚行装饰差异可检出：两端锚后正文逐字相同、仅锚行渲染不同（列表前缀 vs 标题层级）→
// sections 面恰一条差异且锚集面零差异（对齐单元 = 条款锚，锚行本身属比对域）。
check('inv-anchor-line-decoration-diff-detected',
  (() => { const f = [
      { path: 'kilocode/agents/pw.md', text: mk([...INV_FM, '前导段', '- ' + ANCHOR_A, '条款体', '尾段']) },
      { path: 'zcode/agents/pw.md', text: mk([...INV_FM, '前导段', '### ' + ANCHOR_A, '条款体', '尾段']) },
    ]; const r = inventory(f);
    return r.sections.diffs.length === 1 && r.anchorSet.diffs.length === 0; })());
// 117 roleOf 别名归一形态锁定（断言面 = unanchored，唯一消费 roleOf 的差异面）：zcode 的
// -subagent-sp 别名归一为 -sp 后两文件同组，组内前导段差异恰计 1 条 unanchored 差异；
// 别名归一坏（两文件异组不配对）⇒ 0 条即本用例红灯。sections 面按 clauseId 跨全文件配对、
// 不消费 roleOf（platform-inventory.mjs:190-204），不得作为本契约断言面。
check('inv-roleof-subagent-alias-grouped',
  (() => { const f = [
      { path: 'zcode/agents/plan-writer-sp.md', text: mk(['前导段A', ANCHOR_A]) },
      { path: 'zcode/agents/plan-writer-subagent-sp.md', text: mk(['前导段B', ANCHOR_A]) },
    ]; const r = inventory(f); return r.unanchored.diffs.length === 1; })());
// 118 prefix 前导段（首个锚前）unanchored 起始行绝对化锁定（钉死锚命中冲刷与 EOF 冲刷两处无守卫 push）：
// 两同角色 zcode 文件、无 frontmatter、前导段内容互异且各含同一锚。红值推演链（盘面实算）：
// 无 frontmatter → fm 偏移 0；夹具前 3 行为围栏（BT/'code'/BT，scanFences 返回 1-based
// openLine/closeLine），被掩蔽剔除出 outside；'前导段甲/乙' 位于文件
// 第 4 行 → outside 下标 0、outsideLineNos[0] = 4（绝对行号，platform-inventory.mjs 的 lineNo 与
// outsideLineNos 定义处）；splitByAnchors 内 pendingStart = outside 下标 + 1 = 1（掩蔽空间相对
// 序号，splitByAnchors else 分支的 pendingStart 赋值处）——锚命中冲刷时 current 为 null，走
// `else if (pending.length)` 分支体内的无守卫 unanchored.push，
// 修复前 line = 1（红）；修复后 ln(pendingStart - 1) = outsideLineNos[0] = 4（绿）。注：纯无
// frontmatter 且无围栏时掩蔽序号恰等于绝对行号（i+1 双向重合），不可判别——故引入围栏偏移制造
// 掩蔽差，使本用例对锚命中冲刷 push 与 EOF 冲刷 push 漏改真红可复现（防 green-wash）。
check('inv-unanchored-prefix-line-absolute-no-fm',
  (() => { const f = [
      { path: 'zcode/agents/plan-writer-sp.md', text: mk([BT, 'code', BT, '前导段甲', ANCHOR_A]) },
      { path: 'zcode/agents/plan-writer-subagent-sp.md', text: mk([BT, 'code', BT, '前导段乙', ANCHOR_A]) },
    ]; const r = inventory(f);
    return r.unanchored.diffs.length === 1 && r.unanchored.diffs[0].line === 4; })());

// —— 编译产物生成器与新鲜度闸（合成 spec/profile，不读磁盘；期望值由计划第 4 节契约推导） ——
// 夹具路径一律用 expect 域为空的合成路径 agents/pw.md（registry 全表无任何 expect 匹配该形态），
// 避免与 registry 多锚 expect 域碰撞；吞锚闸校验经 build 第三参 clauses 注入合成条款驱动。
const B1_SPEC = { blocks: [
  { id: 'no-green-no-start', text: '未见红严禁开工\n铁律正文。' },
  { id: 'escalate-to-human', text: 'ESCALATE_TO_HUMAN\n呈报人类。' },
] };
const B1_PROFILES = {
  kilocode: { files: [{ output: 'agents/pw.md', frontmatter: 'mode: all\ndescription: d', blocks: ['no-green-no-start', 'escalate-to-human'], slots: {} }] },
  zcode: { files: [{ output: 'agents/pw.md', blocks: ['no-green-no-start'], slots: {} }] },
};
// B1 golden：输出文件集、frontmatter 围栏、生成标记与块序（契约 4.2 行 1）；生成标记断言按
// 版本戳契约（4.1 版本戳行）取模板公共前缀 `GENERATED from spec@`（默认 GENERATED_MARK 为含
// <hash> 占位的模板形态，断言不绑定具体哈希字面量，保证确定性）。
check('build-core-golden',
  (() => { const ps = build(B1_SPEC, B1_PROFILES); return ps.length === 2
    && ps.some((p) => p.path === 'kilocode/agents/pw.md' && p.text.startsWith('---\nmode: all') && p.text.includes('GENERATED from spec@') && p.text.indexOf('未见红严禁开工') < p.text.indexOf('ESCALATE_TO_HUMAN'))
    && ps.some((p) => p.path === 'zcode/agents/pw.md' && !p.text.startsWith('---') && p.text.includes('GENERATED from spec@')); })());
// B2 AGENTS.md 豁免语义：manifest 不声明即不生成（契约 4.2 行 6，编译范围外文件零触碰）。
check('build-agents-md-only-when-declared',
  build(B1_SPEC, { kilocode: { files: [{ output: 'agents/pw.md', frontmatter: 'mode: all', blocks: ['no-green-no-start'], slots: {} }] } }).every((p) => !p.path.endsWith('AGENTS.md')));
// B3 吞锚闸（build-no-anchor-swallow）真吞锚反例（契约 4.1 行 2；夹具保真度）：
// 合成路径 agents/pw.md 的 expect 域为空，经 build 第三参 clauses 显式注入合成条款
//（expect 命中该合成路径），闸校验域与 registry 多锚域零碰撞；块文本渲染前含锚
//「未跟踪新文件铁律」，插槽替换后锚文本被吞 ⇒ 抛错拒产。闸须对「域内锚缺失」与
//「插槽吞掉既有锚」可区分，本用例触发后者。
check('build-swallowed-anchor-rejected',
  (() => { const syn = [{ id: 'synthetic-anchor', expect: [/^zcode\/agents\/pw\.md$/], text: '未跟踪新文件铁律' }]; try { build({ blocks: [{ id: 'b', text: '未跟踪{{x}}铁律：正文' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: { x: '' } }] } }, syn); return false; } catch (e) { return e.message.includes('build-no-anchor-swallow'); } })());
// B3 正控制：同块同路径同合成条款，插槽值补齐锚文本 ⇒ 渲染后锚仍在，正常产出（与 B3 反例构成「被吞 vs 在场」对照）。
check('build-swallowed-anchor-preserved-positive',
  (() => { const syn = [{ id: 'synthetic-anchor', expect: [/^zcode\/agents\/pw\.md$/], text: '未跟踪新文件铁律' }]; const ps = build({ blocks: [{ id: 'b', text: '未跟踪{{x}}铁律：正文' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: { x: '新文件' } }] } }, syn); return ps.length === 1 && ps[0].text.includes('未跟踪新文件铁律'); })());
// B4 吞锚闸负控制：合成路径默认 CLAUSES 域为空（闸不触发、不误伤），插槽值本身含锚文本子串时渲染后文本保留该子串。
check('build-slot-anchor-substring-preserved-positive',
  (() => { const ps = build({ blocks: [{ id: 'b', text: '条款引用 {{x}} 结束' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: { x: '未跟踪新文件铁律' } }] } }); return ps.length === 1 && ps[0].text.includes('未跟踪新文件铁律'); })());
// B4b 残留插槽闸（build-unrendered-slot）：manifest 缺 slot 键 ⇒ 占位符残留进产物，build 必须抛错拒产。
//   期望值溯源装配契约（不得交付未替换插槽），非抄录当前静默出货行为；词法域并集——空白容忍形态
//   {{ g16 }} 与数字首键 {{123}}/{{1x}} 同判；同键多形态/多次出现经 Set 归一（消息中 {{g16}} 恰一次）。
//   正控：全 slot 命中不抛。
check('build-unrendered-slot-rejected',
  (() => { try { build({ blocks: [{ id: 'b', text: 'A {{g16}} B {{ g16 }} C {{123}} D {{1x}}' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: {} }] } }); return false; } catch (e) { return /^build:/.test(e.message) && e.message.includes('build-unrendered-slot') && e.message.includes('agents/pw.md') && e.message.includes('{{g16}}') && e.message.includes('{{123}}') && e.message.includes('{{1x}}') && (e.message.match(/\{\{g16\}\}/g) || []).length === 1; } })());
check('build-unrendered-slot-positive',
  (() => { const ps = build({ blocks: [{ id: 'b', text: 'A {{g16}} B' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: { g16: 'X' } }] } }); return ps.length === 1 && ps[0].text.includes('A X B') && !ps[0].text.includes('{{'); })());
// B4c 重复块 id 闸（build-duplicate-block-id）：同 id 两块 ⇒ 映射后写覆盖前写且枚举序非契约，必须抛错拒产。
check('build-duplicate-block-id-rejected',
  (() => { try { build({ blocks: [{ id: 'dup', text: 'AAAA' }, { id: 'dup', text: 'BBBB' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['dup'], slots: {} }] } }); return false; } catch (e) { return /^build:/.test(e.message) && e.message.includes('build-duplicate-block-id') && e.message.includes('dup'); } })());
check('build-duplicate-block-id-positive',
  (() => { const ps = build({ blocks: [{ id: 'd1', text: 'AAAA' }, { id: 'd2', text: 'BBBB' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['d1', 'd2'], slots: {} }] } }); return ps.length === 1 && ps[0].text.includes('AAAA') && ps[0].text.includes('BBBB'); })());
// B5 路径锁（build-output-path-locked）：manifest 文件名映射逃逸平台目录 ⇒ 抛错（契约 4.1 行 1），
// 含反斜杠分隔符变异（path.posix 不识别反斜杠段，先归一再判定）。
check('build-output-path-escape-rejected',
  (() => { const hit = (out) => { try { build(B1_SPEC, { zcode: { files: [{ output: out, blocks: ['no-green-no-start'], slots: {} }] } }); return false; } catch (e) { return e.message.includes('build-output-path-locked'); } }; return hit('../spec/evil.md') && hit('..\\spec\\evil.md'); })());
// B5b 路径锁目录型残余（build-output-path-locked）：规范化结果为 "." 或以 "/" 结尾的输出
//   （'.', './', 'agents/' 及其反斜杠变异）指向目录而非文件 ⇒ 抛错拒产（契约 4.1 行 1 扩展：
//   输出必须是平台目录内的文件路径）。绝对路径与 ".." 既有闸正控不回退。
//   期望值由契约推导（目录型目标不可作为产物路径），非抄录现状。
check('build-output-dir-path-rejected',
  (() => { const hit = (out) => { try { build(B1_SPEC, { zcode: { files: [{ output: out, blocks: ['no-green-no-start'], slots: {} }] } }); return false; } catch (e) { return e.message.includes('build-output-path-locked'); } }; return hit('.') && hit('./') && hit('agents/') && hit('.\\') && hit('agents\\') && hit('a/..'); })());
// B5c 路径锁非字符串入参（build-output-path-locked 既有 typeof 守卫回归锁，攻击面台账
//   「参数类型强转」行断言名对账用；期望值由「output 必须为非空字符串」契约推导）。
check('build-output-nonstring-rejected',
  (() => { const hit = (out) => { try { build(B1_SPEC, { zcode: { files: [{ output: out, blocks: ['no-green-no-start'], slots: {} }] } }); return false; } catch (e) { return e.message.includes('build-output-path-locked'); } }; return hit(0) && hit(null) && hit(['agents/pw.md']); })());
// B5d 目录闸正控（防误伤回归锁）：平台内常规相对文件路径必须仍被接受并正确拼平台前缀。
check('build-output-file-path-still-accepted',
  build(B1_SPEC, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['no-green-no-start'], slots: {} }] } })[0].path === 'zcode/agents/pw.md');
// B6 新鲜度三态（契约 4.1 行 3）：不一致报 stale；一致零违规；磁盘缺失（null）计 stale；
// 行尾 CRLF/LF 漂移两侧归一后比对，语义一致不判 stale（autocrlf checkout 防假红）。
check('build-freshness-stale-detected',
  diffProducts([{ path: 'zcode/AGENTS.md', text: 'new' }], (p) => (p === 'zcode/AGENTS.md' ? 'old' : null)).join(',') === 'zcode/AGENTS.md'
  && diffProducts([{ path: 'zcode/AGENTS.md', text: 'same' }], () => 'same').length === 0
  && diffProducts([{ path: 'zcode/AGENTS.md', text: 'x' }], () => null).length === 1
  && diffProducts([{ path: 'zcode/AGENTS.md', text: 'x\n' }], () => 'x\r\n').length === 0);
// B7 未知平台目录 fail-loud（契约 4.1 行 5）：spec/platform/ 下非 PLATFORMS 目录被识别，
// loadSpec 对其中含 manifest.json 者报错拒产（读盘判定在 CLI/loadSpec 层，selftest 依纯函数惯例只测识别函数）。
check('build-unknown-platform-dir-rejected',
  unknownPlatformDirs(['kilocode', 'codebuddy', 'zcode']).length === 0
  && unknownPlatformDirs(['kilocode', 'foo']).join(',') === 'foo');
// B8 specHash 确定性（契约 4.4 ①）：同 spec 同 profiles 恒同哈希（深拷贝输入，排除对象同一性干扰；
// sha256 前 12 位十六进制，node:crypto 内置零新依赖）。
check('build-spec-hash-deterministic',
  specHash(B1_SPEC, B1_PROFILES) === specHash({ blocks: B1_SPEC.blocks.map((b) => ({ ...b })) }, JSON.parse(JSON.stringify(B1_PROFILES))));
// B9 specHash 敏感性（契约 4.4 ②）：块正文或 manifest（profiles）任一字符变化 ⇒ 哈希变化。
check('build-spec-hash-sensitive',
  specHash({ blocks: [{ id: 'a', text: 'x' }] }, {}) !== specHash({ blocks: [{ id: 'a', text: 'y' }] }, {})
  && specHash({ blocks: [{ id: 'a', text: 'x' }] }, {}) !== specHash({ blocks: [{ id: 'a', text: 'x' }] }, { zcode: { files: [] } }));
// B10 generatedMark 注入（契约 4.1 版本戳行 / 4.4 ③⑤）：build 第四参注入固定 mark ⇒
// golden 确定性可断言（纯函数不计算真实哈希，真实哈希注入面在 CLI/checkFreshness 层）。
check('build-generated-mark-injectable',
  build(B1_SPEC, B1_PROFILES, undefined, 'GENERATED from spec@v1; do not edit').every((p) => p.text.includes('GENERATED from spec@v1') && !p.text.includes('spec@<hash>')));

// —— 真实 spec 装配 golden（期望值由装配契约推导：registry expect 域 + manifest 装配清单）——
// 与上文合成用例不同，本组用例加载磁盘上的真实 spec/blocks 与三平台 manifest（loadSpec 语义的
// 最小复现，经 fileURLToPath 锚定仓库根，不依赖 cwd），断言产物件数与关键锚段/载体/闸门文本在场。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// 缺导出负控去向：空桩守卫删除后，导出缺失使 checkFreshness 为 undefined，新鲜度自洽断言处以
// TypeError（目标契约缺失，[PASS-RED]）响红——防护不静默丢失；run.mjs 侧同态失效为 ESM 链接期
// SyntaxError（fail-loud）。
const checkFreshness = buildNs.checkFreshness;
const SPEC_ROOT = fileURLToPath(new URL('..', import.meta.url));
function loadRealSpec() {
  const blocksDir = path.join(SPEC_ROOT, 'spec', 'blocks');
  const blocks = fs.readdirSync(blocksDir).filter((f) => f.endsWith('.md')).map((f) => {
    const raw = fs.readFileSync(path.join(blocksDir, f), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) throw new Error('块文件缺 frontmatter: spec/blocks/' + f);
    const id = (m[1].match(/^id:\s*(\S+)\s*$/m) || [])[1];
    if (!id) throw new Error('块文件缺 frontmatter id: spec/blocks/' + f);
    return { id, text: raw.slice(m[0].length).replace(/^\r?\n/, '').trimEnd() };
  });
  const profiles = {};
  for (const platform of PLATFORMS) {
    const mf = path.join(SPEC_ROOT, 'spec', 'platform', platform, 'manifest.json');
    if (fs.existsSync(mf)) profiles[platform] = JSON.parse(fs.readFileSync(mf, 'utf8'));
  }
  return { spec: { blocks }, profiles };
}
const REAL = loadRealSpec();
const REAL_PRODUCTS = build(REAL.spec, REAL.profiles);
const realByText = new Map(REAL_PRODUCTS.map((p) => [p.path, p.text]));
const realText = (p) => realByText.get(p) || '';
// golden：12 件产物；三份 AGENTS.md 含铁律锚；zcode/AGENTS.md 承载直连派发参数头与租约三闸（派生载体=AGENTS.md）；
// kilocode/codebuddy 的 plan-writer-sp.md 承载租约三闸（派生载体=plan-writer-sp.md）；plan-gate 逐字文本
// 装配进 zcode 两份 agents 文件；pr-gate 逐字文本装配进三平台 pr-reviewer 文件。
check('build-real-spec-agents-md-golden',
  REAL_PRODUCTS.length === 12
  && ['kilocode', 'codebuddy', 'zcode'].every((p) => realText(p + '/AGENTS.md').includes('未见红严禁开工'))
  && realText('zcode/AGENTS.md').includes('直连派发参数头')
  && realText('zcode/AGENTS.md').includes('派发去重租约')
  && realText('zcode/AGENTS.md').includes('写后立即回读核验首行')
  && realText('zcode/AGENTS.md').includes('严禁复用固定字面量')
  && ['kilocode', 'codebuddy'].every((p) => realText(p + '/agents/plan-writer-sp.md').includes('派发去重租约')
    && realText(p + '/agents/plan-writer-sp.md').includes('写后立即回读核验首行')
    && realText(p + '/agents/plan-writer-sp.md').includes('严禁复用固定字面量'))
  && ['zcode/agents/plan-writer-subagent-sp.md', 'zcode/agents/plan-reviewer-subagent-sp.md'].every((p) => realText(p).includes('本次审批仅为计划审批——批准后不得直接执行') && realText(p).includes('Git 集成需再单独授权。*'))
  && ['kilocode/agents/pr-reviewer-sp.md', 'codebuddy/agents/pr-reviewer-sp.md', 'zcode/agents/pr-reviewer-subagent-sp.md'].every((p) => realText(p).includes('本次审批仅为代码变更审查——审查通过不等于合入授权；合入、提交或推送需用户在审查通过后另行明确授权。')));
// 新鲜度自洽：真实 spec 与磁盘产物逐件一致（build --check 同源判定）。
check('build-real-spec-freshness-self-consistent', checkFreshness(SPEC_ROOT).length === 0);
// CLI 装配路径契约（diffProducts 的 diskGet 回调参数恒为路径字符串）：build-agents CLI 层
// 按 p.path 取属性曾致首次非空构建崩溃（undefined.split），本用例钉死字符串参数契约防回退。
check('build-diff-products-path-string-contract', (() => {
  let allStrings = true;
  const stale = diffProducts([{ path: 'zcode/AGENTS.md', text: 'x' }, { path: 'kilocode/AGENTS.md', text: 'y' }], (p) => { allStrings = allStrings && typeof p === 'string'; return p === 'zcode/AGENTS.md' ? 'x' : null; });
  return allStrings && stale.join(',') === 'kilocode/AGENTS.md';
})());

// —— M1/M2/M3 收尾断言（合并计划 C9；期望值由行为契约推导，非抄录实现）——
// M1 键序归一：profiles 仅对象键插入序不同、语义相同 ⇒ 哈希必等（不该触发域）；
//   正控：值变化 ⇒ 哈希必不等（触发域，B9 不回退）。canonicalizeValue 未接入前先红（AssertionError）。
check('build-spec-hash-key-order-invariant',
  specHash({ blocks: [] }, { zcode: { files: [{ output: 'x', blocks: ['b'] }] } })
    === specHash({ blocks: [] }, { zcode: { files: [{ blocks: ['b'], output: 'x' }] } })
  && specHash({ blocks: [] }, { zcode: { files: [{ output: 'x', blocks: ['b'] }] } })
    !== specHash({ blocks: [] }, { zcode: { files: [{ output: 'y', blocks: ['b'] }] } }));
// M1 __proto__ 自有键保留（回归锁）：含 __proto__ 自有键的 profiles，canonicalize 后该键仍影响哈希
//   （不被原型 setter 静默丢弃），且不污染全局 Object.prototype（探针 probe-proto 证伪污染假设）。
check('build-spec-hash-proto-key-preserved',
  (() => {
    const withProto = JSON.parse('{ "__proto__": { "z": 1 }, "zcode": { "files": [] } }');
    const withoutProto = { zcode: { files: [] } };
    const before = ({}).polluted;
    const h1 = specHash({ blocks: [] }, withProto);
    const h2 = specHash({ blocks: [] }, withoutProto);
    return typeof h1 === 'string' && h1.length === 12 && h1 !== h2 && before === undefined && ({}).polluted === undefined;
  })());
// M2 闸错误翻译（契约四格，含 r1 E2 回灌族谓词）：loadSpec: 前缀 Error 翻译 / SyntaxError 翻译 /
//   正常透传 / 非族 TypeError 原样上抛。freshnessFailures 未落盘前守卫别名抛
//   TypeError('freshnessFailures is not a function')（四维·目标契约缺失），进程崩溃红。
const freshnessFailures = typeof buildNs.freshnessFailures === 'function'
  ? buildNs.freshnessFailures
  : () => { throw new TypeError('freshnessFailures is not a function'); };
const cliLoadOutcome = typeof buildNs.cliLoadOutcome === 'function'
  ? buildNs.cliLoadOutcome
  : () => { throw new TypeError('cliLoadOutcome is not a function'); };
check('build-freshness-failures-translates-throw',
  (() => {
    const bad = freshnessFailures(() => { throw new Error('loadSpec: 块文件缺 frontmatter id: x'); }, '.');
    const syntax = freshnessFailures(() => { throw new SyntaxError('Unexpected token } in JSON'); }, '.');
    const good = freshnessFailures(() => ['a/b.md'], '.');
    let bugRethrown = false;
    try { freshnessFailures(() => { throw new TypeError('checker bug'); }, '.'); }
    catch (e) { bugRethrown = (e instanceof TypeError) && e.message === 'checker bug'; }
    return bad.specError === 'loadSpec: 块文件缺 frontmatter id: x' && Array.isArray(bad.payload) && bad.payload.length === 0
      && syntax.specError === 'Unexpected token } in JSON' && syntax.payload.length === 0
      && good.specError === null && good.payload.join(',') === 'a/b.md'
      && bugRethrown;
  })());
// B7a loadSpec 读盘 fail-loud 正控（回归锁，锁定既有行为）：临时目录内未登记平台含 manifest.json →
// checkFreshness 经翻译闸返回 loadSpec: 前缀 specError。用例不要求先红（行为已在场），防读盘路径回退。
check('build-loadspec-unknown-platform-manifest-throws',
  (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-unknown-platform-'));
    try {
      fs.mkdirSync(path.join(tmp, 'spec', 'blocks'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'spec', 'platform', 'foo'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'spec', 'blocks', 'a.md'), '---\nid: a\n---\n\n正文');
      fs.writeFileSync(path.join(tmp, 'spec', 'platform', 'foo', 'manifest.json'), '{}');
      const r = freshnessFailures(checkFreshness, tmp);
      return r.specError !== null && r.specError.includes('loadSpec:');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
// B7b 已登记平台 manifest 缺失 fail-loud：三 manifest 缺二（kilocode 在场）→ loadSpec 抛
// manifest-missing-fail-loud 前缀错误并经翻译闸结构化；修复前静默降级（specError=null 且 stale 含
// 'agents/pw.md'）即本用例红灯。output 选 'agents/pw.md'（CLAUSES/GATES expect 域外）：若用
// 'AGENTS.md'，修复前 build 先因块文本缺锚抛 build-no-anchor-swallow（specError 非 null），把吞锚
// 错误误当"已拦静默降级"，未隔离 E5 缺陷。
check('build-manifest-missing-fail-loud',
  (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-manifest-missing-'));
    try {
      fs.mkdirSync(path.join(tmp, 'spec', 'blocks'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'spec', 'platform', 'kilocode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'spec', 'blocks', 'a.md'), '---\nid: a\n---\n\n正文');
      fs.writeFileSync(path.join(tmp, 'spec', 'platform', 'kilocode', 'manifest.json'), JSON.stringify({ files: [{ output: 'agents/pw.md', blocks: ['a'] }] }));
      const r = freshnessFailures(checkFreshness, tmp);
      return r.specError !== null && r.specError.includes('manifest-missing-fail-loud') && r.payload.length === 0;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
// —— PR#5 收尾：F1 报错保真 / F4 吞锚判定域收窄 / F3 预载等价 / F6 FM 键序归一 / F9 id 分裂 / F12 故障闸 ——
check('build-slot-residue-error-preserves-key', (() => {
  try {
    buildNs.build({ blocks: [{ id: 'b1', text: 'x {{my key}} y' }] }, { zcode: { files: [{ output: 'x.md', blocks: ['b1'], slots: {} }] } }, [], 'M');
    return false;
  } catch (e) {
    return e.message.includes('{{my key}}') && !e.message.includes('{{mykey}}');
  }
})());
check('build-anchor-swallow-ignores-frontmatter', (() => {
  try {
    buildNs.build({ blocks: [{ id: 'b1', text: 'body without anchor' }] }, { zcode: { files: [{ output: 'x.md', frontmatter: 'note: ONLY-IN-FRONTMATTER-ANCHOR', blocks: ['b1'], slots: {} }] } }, [{ id: 'c1', text: 'ONLY-IN-FRONTMATTER-ANCHOR', expect: [/x\.md/] }], 'M');
    return false;
  } catch (e) {
    return e.message.includes('build-no-anchor-swallow');
  }
})());
check('build-anchor-in-body-still-passes', (() => {
  try {
    buildNs.build({ blocks: [{ id: 'b1', text: 'has ANCHOR-OK inside' }] }, { zcode: { files: [{ output: 'x.md', blocks: ['b1'], slots: {} }] } }, [{ id: 'c2', text: 'ANCHOR-OK', expect: [/x\.md/] }], 'M');
    return true;
  } catch { return false; }
})());
check('check-freshness-preloaded-equivalent', (() => {
  const { spec, profiles } = buildNs.loadSpec(SPEC_ROOT);
  return JSON.stringify(buildNs.checkFreshness(SPEC_ROOT)) === JSON.stringify(buildNs.checkFreshness(SPEC_ROOT, { spec, profiles }));
})());
check('fm-diff-keyorder-canonical', inventoryNs.diffFmTrees({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }).length === 0);
check('fm-diff-value-still-detected', inventoryNs.diffFmTrees({ a: { x: 1 } }, { a: { x: 2 } }).length === 1);
check('freshness-spec-error-id-registered', allInvariantIds().includes('generated-product-spec-error'));
const latestFaultGate = typeof ledgerNs.latestFaultGate === 'function'
  ? ledgerNs.latestFaultGate
  : () => { throw new TypeError('latestFaultGate is not a function'); };
check('latest-fault-gate-fail-closed', latestFaultGate(['any fault']) === 2 && latestFaultGate([]) === null && latestFaultGate(undefined) === null);
// B7c CLI 装载 Outcome（M-2）：cliLoadOutcome 把 loadSpec fail-loud 经翻译闸结构化——夹具同 B7b
//（仅 kilocode manifest 在场，loadSpec 抛 manifest-missing-fail-loud）；修复前函数缺失 → 守卫别名
// 抛 TypeError（四维·目标契约缺失）。这是 CLI --check/写盘路径消费的同一函数（单一事实源）。
check('build-cli-load-outcome-translated',
  (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-load-'));
    try {
      fs.mkdirSync(path.join(tmp, 'spec', 'blocks'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'spec', 'platform', 'kilocode'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'spec', 'blocks', 'a.md'), '---\nid: a\n---\n\n正文');
      fs.writeFileSync(path.join(tmp, 'spec', 'platform', 'kilocode', 'manifest.json'), JSON.stringify({ files: [{ output: 'agents/pw.md', blocks: ['a'] }] }));
      const r = cliLoadOutcome(tmp);
      return r.specError !== null && r.specError.includes('manifest-missing-fail-loud');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
// M3 tail 段合并：重复锚后 3 行连续无锚 ⇒ 单一 unanchored 段（对照旧逐行 3 段，探针
//   probe-m3-tail 实测 tailSegCount=3）；repeats 计数不变（不该触发域）。
//   合并修正：经 inventoryNs 命名空间调用（selftest:19 已导入，消除源计划 A1 具名导入不确定项）。
check('inv-tail-region-coalesced',
  (() => {
    const A = 'ANCHORX';
    const r = inventoryNs.splitByAnchors(['前导段', A, '条款体', A, 'tail1', 'tail2', 'tail3'], [{ id: 'c1', text: A }]);
    const tailSegs = r.unanchored.filter((s) => /^tail/.test(s.lines[0] || ''));
    return tailSegs.length === 1 && tailSegs[0].lines.length === 3 && r.repeats.length === 1;
  })());
// M3 tail 后接不同新锚：tail 残留冲刷入 unanchored，新锚另起块，重复锚既有块 .lines 不被误清（退化语义）。
check('inv-tail-then-new-anchor-no-clobber',
  (() => {
    const A = 'ANCHORX';
    const B = 'ANCHORY';
    const r = inventoryNs.splitByAnchors([A, '条款体', A, 'tail1', 'tail2', B, '新块体'], [{ id: 'c1', text: A }, { id: 'c2', text: B }]);
    const tailSeg = r.unanchored.find((s) => (s.lines[0] || '') === 'tail1');
    const blockC1 = r.blocks.get('c1');
    return !!tailSeg && tailSeg.lines.length === 2 && r.blocks.has('c2') && r.repeats.length === 1
      && !!blockC1 && blockC1.lines.length > 0;
  })());

// —— 台账/Files 编号形态判据（判据单一事实源 = attack-ledger 常量；期望值由标题语法契约推导）——
// L1 台账节判据：编号形态（整数与多级小数）与裸形态同为在场；前缀近似（含中文近似后缀）与围栏内示例不在场。
check('ledger-ledger-head-numbered-tolerant',
  hasLedgerSection('# t\n\n## 6. 攻击面台账\n\n- 台账行\n') === true
  && hasLedgerSection('## 攻击面台账\n') === true
  && hasLedgerSection('## 6.2. 攻击面台账\n') === true
  && hasLedgerSection('## 攻击面台账笔记\n') === false
  && hasLedgerSection('```\n## 攻击面台账\n```\n') === false);
// L2 编号形态 Files 节的执法识别：Files 节含执法文件（编号标题 `## 5. Files 清单`）→ 计划进入
// 台账审计域，缺台账节产出结构性红（修复前 isSec=false 静默豁免即红灯）。
check('ledger-numbered-files-enforcement-detected',
  attackLedger('# p\n\n## 5. Files 清单\n\n| Create | `checks/build-agents.mjs` | 生成器 |\n').some((x) => x.msg.includes('攻击面台账')));
// L3 Files 标题粘连与无空格编号形态（检测域回归锁）：粘连与无空格编号形态必须命中 FILES_HEAD_RE
// 并使执法类计划进入台账对账域（缺台账节判红）；白名单尾缀外的 CJK 续写与 ASCII 近似词仍拒；
// 多级编号与既有在用形态不回退。期望值由标题语法契约推导。
check('ledger-files-head-cjk-glued-detected',
  FILES_HEAD_RE.test('## Files清单') === true
  && FILES_HEAD_RE.test('## 5.Files清单') === true
  && FILES_HEAD_RE.test('## Files 清单') === true
  && FILES_HEAD_RE.test('## 5. Files 清单') === true
  && FILES_HEAD_RE.test('## Files 声明') === true
  && FILES_HEAD_RE.test('## 6.2. Files 清单') === true
  && FILES_HEAD_RE.test('## Files') === true
  && FILES_HEAD_RE.test('## Files清单占位') === false
  && FILES_HEAD_RE.test('## Files清单说明') === false
  && FILES_HEAD_RE.test('## FilesNotes') === false
  && FILES_HEAD_RE.test('## 文件清单') === false
  && attackLedger('# p\n\n## Files清单\n\n| Modify | `checks/attack-ledger.mjs` | 对账器 |\n').some((x) => x.msg.includes('攻击面台账')));
// L2b 无 Files 节原文命中执法文件 + 诱饵 Files 节遮蔽（fail-closed）：
//   ① 标题白名单尾缀外变体（## Files列表）列出执法文件——FILES_HEAD_RE 不识别即无可识别 Files 节，
//      围栏外原文命中执法文件名时按执法类处理，缺台账节判红（修复前 enforcement=false 静默豁免）；
//   ② 诱饵 ## Files（只列 README）之后出现真实执法 ## Files 节——必须合并扫描全部围栏外
//      FILES_HEAD_RE 节而非只取第一个（修复前只取首节 → enfInFence=false 漏检）。
//   负控不回退：执法文件名只在闭合围栏内出现且无 Files 节 → 非执法类（围栏掩蔽示例不触发，
//   与 assert-latest-enforcement-no-ledger-selected e.md 判定位同源不分叉）。期望值由契约推导。
check('ledger-unrecognized-files-head-enforcement-detected',
  attackLedger('# p\n\n## Files列表\n\n| Modify | `checks/attack-ledger.mjs` | 对账器 |\n').some((x) => x.msg.includes('攻击面台账'))
  && attackLedger('# p\n\n## Files列表\n\n| Modify | `README.md` | x |\n').length === 0
  && attackLedger('# p\n```md\n| Modify | `checks/build-agents.mjs` |\n```\n').filter((x) => x.msg.includes('攻击面台账')).length === 0);
check('ledger-decoy-files-section-enforcement-detected',
  attackLedger('# p\n\n## Files\n\n| Modify | `README.md` | x |\n\n## Files\n\n| Modify | `checks/build-agents.mjs` | 生成器 |\n').some((x) => x.msg.includes('攻击面台账')));
// L2c 选择-审计同构（视图-执行语义分叉闭合）：上述两变体候选在 --latest 选择域同样入选，
//   严禁选择视图静默 skip 而漂移到更旧候选（与审计侧 enforcementSignals 同源判据）。
check('assert-latest-unrecognized-and-decoy-files-selected',
  attackLedgerNs.pickLatestEligible([
    { f: 'g.md', text: '# 计划\n\n## Files列表\n\n| Modify | `checks/attack-ledger.mjs` | x |\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).f === 'g.md'
  && attackLedgerNs.pickLatestEligible([
    { f: 'h.md', text: '# 计划\n\n## Files\n\n| Modify | `README.md` | x |\n\n## Files\n\n| Modify | `mcp/plan-governor.js` | x |\n' },
    { f: 'a.md', text: '# 计划\n## 攻击面台账\n- 台账行\n' },
  ]).f === 'h.md');
// L2d 契约反例（期望值由契约推导）：存在空正文的可识别 Files 节 ≠ 无 Files 节——空节不触发
//   fail-closed 加严；执法名仅现于闭合围栏内且无 Files 节 → 非执法类（围栏掩蔽示例不触发）。
check('ledger-empty-recognized-files-is-not-no-files',
  attackLedger('# p\n## Files\n\n## Notes\nmentions checks/attack-ledger.mjs\n', {}).length === 0);
// L4 --latest 候选装载归因（readdir/stat/read 分开归因）：happy path 零 fault、目录不可读归因为
// 「计划目录不可读」且候选空——「计划存在但不可读」不得再误报「无时间戳命名计划文件」。
check('assert-latest-candidates-collect-tmpdir',
  (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-candidates-'));
    try {
      fs.writeFileSync(path.join(tmp, '20260101-0000-plan-a.md'), '# a\n## 攻击面台账\n- 台账行\n');
      fs.writeFileSync(path.join(tmp, '20260101-0000-plan-a-test-evidence.md'), 'x');
      fs.writeFileSync(path.join(tmp, 'notes.md'), 'x');
      const r1 = attackLedgerNs.collectLatestCandidates(tmp);
      const r2 = attackLedgerNs.collectLatestCandidates(path.join(tmp, 'missing-dir'));
      return r1.candidates.length === 1 && r1.candidates[0].f === '20260101-0000-plan-a.md' && r1.faults.length === 0
        && r2.candidates.length === 0 && r2.faults.length === 1 && r2.faults[0].includes('计划目录不可读');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
// 分级回归锁·非执法类（by-design 正控语义保留，落刀前后恒绿，不计红灯）：非执法类计划（Files 不含
// ENFORCEMENT_FILES）零攻击 GO 带独立成行 ECHO-RISK 放行、缺标注仍红（期望值由分级契约推导）。
check('ledger-report-nonsec-zero-go-echo-annotated-ok',
  attackLedger('# p\n## Files\n| Modify | `README.md` | x |\n', { reportText: 'ATTACKS=0\nPENETRATIONS=0\nVERDICT: GO\nSHADOW_PASS=done\nECHO-RISK' }).length === 0);
check('ledger-report-nonsec-zero-go-echo-required',
  attackLedger('# p\n## Files\n| Modify | `README.md` | x |\n', { reportText: 'ATTACKS=0\nPENETRATIONS=0\nVERDICT: GO\nSHADOW_PASS=done' }).some((v) => v.msg.includes('ECHO-RISK')));

// 新鲜度闸 id 正向在场断言：generated-product-stale 必须进入 allInvariantIds()（run.mjs 输出出现
// OK 行），杜绝「实现在场、登记缺席」的绿色盲区。
check('assert-freshness-gate-id-registered', allInvariantIds().includes('generated-product-stale'));
// 真实 12 文件集 golden：期望区间按实测基准
// （files=12 / anchorSet=374 / frontmatter=60 / sections=64 / fences=5 / unanchored=35 / 总 538）
// 外扩良性漂移带宽核定；接线断裂（面数错乱/文件数错）即越界红。
// 注：anchorSet/总带上界系审查方法论补强计划（10 条 partial-domain CLAUSES）执行期重标定，
// 先例 8c6edc9（上次加 CLAUSES 同步重标定本带）。
check('inv-real-12-file-golden',
  (() => {
    const files = inventoryNs.collectPlatformFiles(SPEC_ROOT);
    const r = inventory(files);
    const inRange = (x, lo, hi) => x >= lo && x <= hi;
    const total = r.anchorSet.diffs.length + r.frontmatter.diffs.length + r.sections.diffs.length + r.fences.diffs.length + r.unanchored.diffs.length;
    return files.length === 12
      && inRange(r.anchorSet.diffs.length, 240, 440) && inRange(r.frontmatter.diffs.length, 40, 80)
      && inRange(r.sections.diffs.length, 30, 85) && inRange(r.fences.diffs.length, 1, 15)
      && inRange(r.unanchored.diffs.length, 10, 60) && inRange(total, 370, 640);
  })());
// CLI 写链 tmpdir 化：真实 12 文件读入 + renderMarkdown + 双报告写盘全链，写面落 tmpdir（只读铁律
// 安全）；带段 base（seg/inv-seg）锁定输出父目录递归建目录契约（端到端可写，无 ENOENT）。
check('inv-cli-write-chain-tmpdir',
  (() => {
    fs.mkdirSync(path.join(SPEC_ROOT, '.kilo'), { recursive: true });   // .kilo 可能不存在（未初始化克隆）：先保证父目录，避免夹具 ENOENT 假红
    const tmp = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.inv-selftest-out-'));
    try {
      const r = inventoryNs.runInventory(SPEC_ROOT, tmp, 'inv-golden');
      const rSeg = inventoryNs.runInventory(SPEC_ROOT, tmp, 'seg/inv-seg');
      return r.result.files.length === 12 && typeof r.total === 'number'
        && fs.existsSync(path.join(tmp, 'inv-golden.json')) && fs.existsSync(path.join(tmp, 'inv-golden-report.md'))
        && fs.existsSync(path.join(tmp, 'seg', 'inv-seg.json')) && fs.existsSync(path.join(tmp, 'seg', 'inv-seg-report.md'));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
// 缺治理文件 fail-loud：任一平台缺 AGENTS.md ⇒ 结构化抛错（消息含平台与文件路径），拒绝静默跳过。
check('inv-cli-missing-agents-fail-loud',
  (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-missing-agents-'));
    try { inventoryNs.runInventory(tmp, tmp, 'x'); return false; }
    catch (e) { return e.message.includes('缺少平台治理文件') && e.message.includes('AGENTS.md'); }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
// --out 收容闸：拒绝 .. 段 / 盘符 / 绝对路径，接受普通相对路径、带段相对路径与纯名（带段名端到端
// 可写由 runInventory 建目录保障）。
check('inv-out-base-guard',
  inventoryNs.outBaseRejected('../evil') === true
  && inventoryNs.outBaseRejected('C:/evil') === true
  && inventoryNs.outBaseRejected('reports/inv') === false
  && inventoryNs.outBaseRejected('inv-base') === false);
// --out symlink 写逃逸守卫：outDir 内指向目录外的目录符号链接（junction）与既有输出文件符号链接
// 均拒绝写盘；Node 建 symlink 在 Windows 可能需权限，创建失败时容忍跳过该断言（环境限制非逻辑通过）。
check('inv-symlink-escape-rejected', (() => {
  fs.mkdirSync(path.join(SPEC_ROOT, '.kilo'), { recursive: true });     // 同上：保证 .kilo 存在，避免夹具 ENOENT 假红
  const tmp = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.inv-selftest-sym-'));
  try {
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    let dirLink = true;
    try { fs.symlinkSync(outside, path.join(out, 'seg'), 'junction'); } catch { dirLink = false; }
    if (dirLink) {
      let threw = false;
      try { inventoryNs.runInventory(SPEC_ROOT, out, 'seg/inv'); }
      catch (e) { threw = e.message.includes('PLATFORM-INVENTORY FAIL'); }
      if (!threw) return false;
      // 多段 base：首段即既有 junction，递归建目录会穿越链接在盘外产生 out/a 等目录——同样必须拒绝。
      let threwMulti = false;
      try { inventoryNs.runInventory(SPEC_ROOT, out, 'seg/a/inv'); }
      catch (e) { threwMulti = e.message.includes('PLATFORM-INVENTORY FAIL'); }
      if (!threwMulti) return false;
      fs.rmSync(path.join(out, 'seg'), { recursive: true, force: true });
    }
    let fileLink = true;
    try { fs.symlinkSync(outside, path.join(out, 'inv.json'), 'file'); } catch { fileLink = false; }
    if (fileLink) {
      try { inventoryNs.runInventory(SPEC_ROOT, out, 'inv'); return false; }
      catch (e) { return e.message.includes('PLATFORM-INVENTORY FAIL'); }
    }
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// —— build-agents 写盘守卫：逐段 lstat 拒软链 + mkdir 后 realpath 收容 ——
// 期望值溯源（非抄录实现行为）：契约「任一既有段软链即拒」→ 攻击根下 .kilo 指向外部时，
//   assertSafeProductOutput(root,'.kilo/plans/x.md') 必须抛错；对照（全不存在/普通目录）不抛。
check('build-symlink-segment-reject', (() => {
  const g = buildNs.assertSafeProductOutput;
  if (typeof g !== 'function') return false;            // 红灯阶段守卫未实现 → 断言真红（[PASS-RED] 目标契约缺失）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-sym-'));
  try {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-ext-'));
    fs.mkdirSync(path.join(tmp, '.kilo'));
    try { fs.symlinkSync(external, path.join(tmp, '.kilo', 'plans'), 'junction'); } catch { return false; }
    let threw = false;
    try { g(tmp, '.kilo/plans/kilocode/AGENTS.md'); } catch (e) { threw = /output-symlink-segment-guard/.test(String(e.message)); }
    if (!threw) return false;
    // 对照：全不存在的新建链（首段普通、.kilo 为真目录）不得误拒——plans 不存在→放行交 mkdir。
    try { g(tmp, '.kilo/newdir/x.md'); } catch { return false; }
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// 期望值溯源：契约「realpath 越出 rootReal 即拒」→ 攻击父目录 realpath 落在 root 外必抛；正常嵌套放行。
check('build-realpath-root-containment', (() => {
  const g = buildNs.assertProductDirWithinRoot;
  if (typeof g !== 'function') return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-contain-'));
  try {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-cext-'));
    fs.mkdirSync(path.join(tmp, '.kilo'));
    let threw = false;
    try { g(tmp, external); } catch (e) { threw = /output-realpath-root-containment/.test(String(e.message)); }
    if (!threw) return false;                            // 外部目录作父目录：realpath 越界必须拒
    const legit = path.join(tmp, '.kilo', 'plans');
    fs.mkdirSync(legit, { recursive: true });
    try { g(tmp, legit); } catch { return false; }        // 正常子目录：恰为 rootReal+sep 前缀，放行
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// —— platform-inventory CLI 根段预检：.kilo/plans 任一软链 → 拒绝（不入 runInventory）——
// 期望值溯源：契约「root→outDir 段软链即拒、不存在放行」，与 runInventory 的 tmpdir 直调语义正交。
check('inventory-cli-root-segment-symlink-reject', (() => {
  const g = inventoryNs.cliOutDirSymlinkFree;
  if (typeof g !== 'function') return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-sym-'));
  try {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-ext-'));
    try { fs.symlinkSync(external, path.join(tmp, '.kilo'), 'junction'); } catch { return false; }
    try { if (g(tmp) !== false) return false; } finally { fs.rmSync(path.join(tmp, '.kilo'), { recursive: true, force: true }); }
    fs.mkdirSync(path.join(tmp, '.kilo'));                // .kilo 真目录、plans 不存在 → 放行
    if (g(tmp) !== true) return false;
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// —— Rework（PR 复审 E1/E2）：真实写盘入口与 CLI 黑盒端到端断言 ——
// E1：build 写盘循环不再只测 helper——经 writeProducts 真实写链（lstat 预检→mkdir→realpath 收容→writeFileSync）
//   在隔离根驱动 junction 攻击，断言拒写且盘外零文件；正控验证正常嵌套写盘落点与内容。
check('build-write-loop-junction-rejected', (() => {
  if (typeof buildNs.writeProducts !== 'function') return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-loop-sym-'));
  try {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-loop-ext-'));
    fs.mkdirSync(path.join(tmp, '.kilo'));
    try { fs.symlinkSync(external, path.join(tmp, '.kilo', 'plans'), 'junction'); } catch { return false; }
    let threw = false;
    try { buildNs.writeProducts(tmp, [{ path: '.kilo/plans/kilocode/AGENTS.md', text: 'x' }]); }
    catch (e) { threw = /output-symlink-segment-guard/.test(String(e.message)); }
    if (!threw) return false;
    return fs.readdirSync(external).length === 0;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
check('build-write-loop-normal-dir-ok', (() => {
  if (typeof buildNs.writeProducts !== 'function') return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-loop-ok-'));
  try {
    buildNs.writeProducts(tmp, [{ path: '.kilo/plans/kilocode/AGENTS.md', text: 'hello' }]);
    return fs.readFileSync(path.join(tmp, '.kilo', 'plans', 'kilocode', 'AGENTS.md'), 'utf8') === 'hello';
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// 断言夹具前置：.kilo 可能不存在（未初始化克隆）→ 先确保父目录存在，避免 mkdtemp 抛 ENOENT 造成夹具假红。
fs.mkdirSync(path.join(SPEC_ROOT, '.kilo'), { recursive: true });
// —— build-agents 最终组件软链拒写（原子打开 + 逐段 lstat 双保险）——
// 期望值溯源（非抄录实现行为）：契约「最终组件软链不得被跟随」→ 目标文件本身为指向盘外受害文件的软链时，
//   writeProducts 必须拒绝且绝不经链接覆写 victim（内容保持 ORIG）。
// fail-closed：链接创建失败即判失败返回 false，不设 made 静默跳过分支（攻击前置无法成立时不得报 OK）。
check('build-write-final-symlink-rejected', (() => {
  if (typeof buildNs.writeProducts !== 'function') return false;   // 红灯阶段守卫未实现 → 断言真红（[PASS-RED] 目标契约缺失）
  const tmp = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.bao-final-sym-'));
  const ext = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.bao-final-ext-'));
  try {
    const victim = path.join(ext, 'victim.txt');
    fs.writeFileSync(victim, 'ORIG');
    fs.mkdirSync(path.join(tmp, '.kilo', 'plans', 'kilocode'), { recursive: true });
    try { fs.symlinkSync(victim, path.join(tmp, '.kilo', 'plans', 'kilocode', 'AGENTS.md'), 'file'); } catch { return false; }
    let threw = false;
    try { buildNs.writeProducts(tmp, [{ path: '.kilo/plans/kilocode/AGENTS.md', text: 'x' }]); }
    catch (e) { threw = /output-symlink-segment-guard|output-atomic-open-nofollow|ELOOP/.test(String(e.message)); }
    if (!threw) return false;
    return fs.readFileSync(victim, 'utf8') === 'ORIG';             // 受害文件未被经链接覆写
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(ext, { recursive: true, force: true });
  }
})());
// —— runInventory 写前仓库根锚定收容（本计划权威守卫的回归锁：未加固实现下必然红）——
// 期望值溯源：契约「root→outDir 任一段为既有符号链接即拒，且 mkdir 与报告写均不得经链接逃逸」。
//   变体 A：root→outDir 末段（.kilo/plans）为指向盘外的 junction（审查意见场景）→ 必抛且盘外零文件。
//   变体 B：链中段为 junction → 拒绝必须前置于 mkdir：递归建目录不得在盘外产生任何新条目。
check('inv-root-anchored-containment-rejected', (() => {
  const tmp = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.inv-root-sym-'));
  const outA = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-root-a-'));
  const outB = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-root-b-'));
  try {
    fs.mkdirSync(path.join(tmp, 'a', '.kilo'), { recursive: true });
    try { fs.symlinkSync(outA, path.join(tmp, 'a', '.kilo', 'plans'), 'junction'); } catch { return false; }
    let threwA = false;
    try { inventoryNs.runInventory(SPEC_ROOT, path.join(tmp, 'a', '.kilo', 'plans'), 'inv'); }
    catch (e) { threwA = /PLATFORM-INVENTORY FAIL/.test(String(e.message)); }
    if (!threwA) return false;
    if (fs.readdirSync(outA).length !== 0) return false;
    try { fs.symlinkSync(outB, path.join(tmp, 'b'), 'junction'); } catch { return false; }
    let threwB = false;
    try { inventoryNs.runInventory(SPEC_ROOT, path.join(tmp, 'b', 'plans'), 'inv'); }
    catch (e) { threwB = /PLATFORM-INVENTORY FAIL/.test(String(e.message)); }
    if (!threwB) return false;
    return fs.readdirSync(outB).length === 0;                      // 盘外零新条目：mkdir 未逃逸
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outA, { recursive: true, force: true });
    fs.rmSync(outB, { recursive: true, force: true });
  }
})());
// —— 写盘完整性：一次写盘必须完整落位全部字节（短写不得产生截断产物）——
// 期望值溯源：契约「完整写入」→ 2 MiB 文本写盘后逐字等值；截断/少写即失败。
// 说明：本断言是写完整性契约的回归锁（对比实现行为，非竞态注入）；它不锁定 O_NOFOLLOW 分支——
//   该分支的可达性由平台常量决定（见 §12 未验证假设），本文件不伪造其在本机的红/绿。
check('build-write-large-text-complete', (() => {
  if (typeof buildNs.writeProducts !== 'function') return false;
  const tmp = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.bao-large-'));
  try {
    const text = 'A'.repeat(2 * 1024 * 1024);
    buildNs.writeProducts(tmp, [{ path: '.kilo/plans/kilocode/AGENTS.md', text }]);
    return fs.readFileSync(path.join(tmp, '.kilo', 'plans', 'kilocode', 'AGENTS.md'), 'utf8') === text;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// E2：inventory CLI 拒绝出口不再只测 helper——真实 CLI 子进程（cwd=隔离根）验证退出码 2 + 失败文案 + 盘外零报告；
//   正控验证普通/缺失目录预检放行（CLI 正常出 0，输出 PLATFORM-INVENTORY files=3）。
check('inventory-cli-reject-exit-2-no-outside-write', (() => {
  const cli = path.join(SPEC_ROOT, 'checks', 'platform-inventory.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-atk-'));
  try {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-atk-ext-'));
    try { fs.symlinkSync(external, path.join(tmp, '.kilo'), 'junction'); } catch { return false; }
    const r = spawnSync(process.execPath, [cli], { cwd: tmp, encoding: 'utf8' });
    const out = String(r.stdout || '') + String(r.stderr || '');
    if (r.status !== 2) return false;
    if (!out.includes('PLATFORM-INVENTORY FAIL') || !out.includes('含既有符号链接')) return false;
    return fs.readdirSync(external).length === 0;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
check('inventory-cli-normal-missing-dir-not-rejected', (() => {
  const cli = path.join(SPEC_ROOT, 'checks', 'platform-inventory.mjs');
  const mkPlat = (r) => { for (const q of ['kilocode', 'codebuddy', 'zcode']) { fs.mkdirSync(path.join(r, q)); fs.writeFileSync(path.join(r, q, 'AGENTS.md'), '---\nname: x\n---\n\nbody\n'); } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-ok-'));
  try {
    mkPlat(tmp);
    fs.mkdirSync(path.join(tmp, '.kilo'));
    const r1 = spawnSync(process.execPath, [cli], { cwd: tmp, encoding: 'utf8' });
    const out1 = String(r1.stdout || '') + String(r1.stderr || '');
    if (r1.status !== 0 || !out1.includes('PLATFORM-INVENTORY files=3') || out1.includes('含既有符号链接')) return false;
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-cli-ok2-'));
    try {
      mkPlat(tmp2);
      const r2 = spawnSync(process.execPath, [cli], { cwd: tmp2, encoding: 'utf8' });
      const out2 = String(r2.stdout || '') + String(r2.stderr || '');
      if (r2.status !== 0 || !out2.includes('PLATFORM-INVENTORY files=3') || out2.includes('含既有符号链接')) return false;
      return fs.existsSync(path.join(tmp2, '.kilo', 'plans'));
    } finally { fs.rmSync(tmp2, { recursive: true, force: true }); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// inv-shared-atomic-writer-wired：platform-inventory 最终写盘必须经共享原子写盘器 writeFileAtomicNoFollow
//   期望值溯源至行为契约（非抄录现实现）：POSIX 分支 openSync 携 O_NOFOLLOW 位；win32 回退分支目标
//   路径 lstat 计数 ≥2（platform-inventory 预检 1 + 共享写盘器 isSymlinkNow 复核 1）。改造前裸 writeFileSync
//   → 两分支均不达 → 真红；改造后经共享写盘器 → 达成。本断言锁接线事实，不声称 win32 残窗已消除（诚实声明）。
check('inv-shared-atomic-writer-wired', (() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-wired-'));
  try {
    for (const q of ['kilocode', 'codebuddy', 'zcode']) {
      fs.mkdirSync(path.join(tmp, q));
      fs.writeFileSync(path.join(tmp, q, 'AGENTS.md'), '---\nname: x\n---\n\nbody\n');
    }
    fs.mkdirSync(path.join(tmp, '.kilo'));
    const invMod = path.join(SPEC_ROOT, 'checks', 'platform-inventory.mjs');
    const probeSrc = [
      "var fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');",
      "var seq=[];",
      "var _l=fs.lstatSync;fs.lstatSync=function(p){seq.push(['lstat',String(p)]);return _l.apply(fs,arguments);};",
      "var _w=fs.writeFileSync;fs.writeFileSync=function(p){seq.push(['write',String(p)]);return _w.apply(fs,arguments);};",
      "var _o=fs.openSync;fs.openSync=function(p,f){seq.push(['open',String(p),String(f)]);return _o.apply(fs,arguments);};",
      "import(pathToFileURL(process.env.INV_MOD).href).then(function(m){",
      "  var out=path.join(process.cwd(),'.kilo','plans');",
      "  try{ m.runInventory(process.cwd(),out,'inv'); }catch(e){}",
      "  console.log('SEQ:'+JSON.stringify(seq));",
      "},function(e){ console.log('ERR:'+String(e)); });"
    ].join('\n');
    const probeFile = path.join(tmp, 'probe.cjs');
    fs.writeFileSync(probeFile, probeSrc);
    const r = spawnSync(process.execPath, [probeFile], {
      cwd: tmp,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { INV_MOD: invMod }),
    });
    if (r.status !== 0) return false;
    const out = String(r.stdout || '');
    if (out.includes('ERR:')) return false;
    const m = out.match(/^SEQ:(.*)$/m);
    if (!m) return false;
    let seq; try { seq = JSON.parse(m[1]); } catch { return false; }
    if (!Array.isArray(seq)) return false;
    const jp = path.join(tmp, '.kilo', 'plans', 'inv.json');
    const mp = path.join(tmp, '.kilo', 'plans', 'inv-report.md');
    const lstatCnt = (p) => seq.filter((x) => Array.isArray(x) && x[0] === 'lstat' && x[1] === p).length;
    if (typeof fs.constants.O_NOFOLLOW === 'number') {
      const openedNoFollow = (p) => seq.some((x) =>
        Array.isArray(x) && x[0] === 'open' && x[1] === p &&
        (Number(x[2]) & fs.constants.O_NOFOLLOW) === fs.constants.O_NOFOLLOW);
      return openedNoFollow(jp) && openedNoFollow(mp);
    }
    return lstatCnt(jp) >= 2 && lstatCnt(mp) >= 2;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})());
// anchor-library ↔ registry 漂移棘轮（回归锁）：registry 各条目 id 的归档块
// 必须在场且承载锚文本（CLAUSES/DERIVED 按 text，GATES 按 parts 逐片段）；豁免集动态取自
// 活跃装配块 id 集（当前仅 direct-dispatch-header 仍在 spec/blocks 装配、无归档义务）。
// 归档文件名映射：闸块归档名带 gate- 前缀（gate-plan-gate.md 等，盘面实测），条款块不带。
check('anchor-library-registry-no-drift',
  (() => {
    const libDir = path.join(SPEC_ROOT, 'spec', 'anchor-library');
    const activeIds = new Set(REAL.spec.blocks.map((b) => b.id));
    const missing = [];
    const checkOne = (id, texts) => {
      if (activeIds.has(id)) return;
      const f = path.join(libDir, id + '.md');
      const fg = path.join(libDir, 'gate-' + id + '.md');
      const file = fs.existsSync(f) ? f : (fs.existsSync(fg) ? fg : null);
      if (file === null) { missing.push(id + '（归档缺席）'); return; }
      const content = fs.readFileSync(file, 'utf8');
      for (const t of texts) if (!content.includes(t)) missing.push(id + '（缺锚文本）');
    };
    for (const c of CLAUSES) checkOne(c.id, [c.text]);
    for (const c of DERIVED_CLAUSES) checkOne(c.id, [c.text]);
    for (const g of GATES) checkOne(g.id, g.parts);
    return missing.length === 0;
  })());

console.log(failures === 0 ? 'CHECKS-SELFTEST ALL OK' : 'CHECKS-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
