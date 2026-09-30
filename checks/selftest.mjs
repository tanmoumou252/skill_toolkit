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
import { attackLedger, checkReportFormat, checkChainOrder, checkReportStructureGate, foldRoundFromFilename, countAttackRows, ATTACK_CLASSES, ENFORCEMENT_FILES, isPlanFilename } from './attack-ledger.mjs';
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

// 11) 必含条款缺失 → 检出
const zcFm = ['---', 'name: plan-writer-subagent-sp', 'description: d', 'color: orange', 'tools: []', 'permissionMode: dontAsk', 'injectAgentsMd: true', '---', ''];
check(
  'clause-required-detected',
  has([{ path: 'zcode/agents/plan-writer-subagent-sp.md', text: [...zcFm, '无任何条款', ''].join('\n') }], 'clause-no-green-no-start', 'zcode/agents/plan-writer-subagent-sp.md'),
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
check('ledger-report-zero-go-echo-required', attackLedger(planLedgerGood, { implText: implGood, testText: testGood, reportText: 'ATTACKS=0\nPENETRATIONS=0\nVERDICT: GO' }).some((v) => v.msg.includes('ECHO-RISK')));
check('ledger-report-zero-go-echo-annotated-ok', !attackLedger(planLedgerGood, { implText: implGood, testText: testGood, reportText: 'ATTACKS=0\nPENETRATIONS=0\nVERDICT: GO\nECHO-RISK' }).some((v) => v.msg.includes('ECHO-RISK')));
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
const REPORT_OK = [atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n');
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
check('ledger-report-prose-marker-not-posture', rv(['# r', '', '建议：待验命令不在白名单时标注 `PROBE=OFFLINE`；契约另要求零攻击 GO 标注 ECHO-RISK。', '', atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n')).length === 0);
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
check('ledger-report-decorated-marker-counted', rv([atkRow(1), atkRow(2), '', '- **PROBE=OFFLINE**：本代理无沙箱权限', '', '- ECHO-RISK：纸面放行已明示', RECEIPT, 'ATTACKS=2', 'PENETRATIONS=0', 'VERDICT: GO'].join('\n')).length === 0);
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
const SHADOW_OK = ['# 影子复审报告', '', '### E 清单', '', '差集为 0（镜像对账表）', '', '复跑比对无偏差', '', '### 终局裁决', '', 'GO', ''].join('\n');
const PR_OK = ['# PR 复审报告', '', 'E 清单：无', '', '实跑证据表：`npm test --prefix checks` 退出码 0', '', '已运行核实', '', 'SEMANTIC_PASS=done', 'VERDICT: GO', ''].join('\n');
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
  && isPlanFilename('202609291234567890-x.md') === false
  && isPlanFilename('20260731-153000-auth-r3-refactor.md') === true
  && isPlanFilename('20260929-0837-plan-test-evidence.md') === false
  && isPlanFilename('20260929-0837-plan-pr-review.md') === false
  && isPlanFilename('20260929-0837-plan-shadow-plan.md') === false
  && isPlanFilename('20260929-0837-plan.lease.md') === false
  && isPlanFilename('commit_msg.md') === false);
// 66 PR 复审报告机读行结构闸（pr-report-semantic-pass-gate）：三端 pr-reviewer 规程硬要求
//   SEMANTIC_PASS=done|partial 行；缺行必咬、含行零违反（partial 禁 GO 不得停留在散文面）。
const PR_NO_SEM = ['# PR 复审报告', '', 'E 清单：无', '', '实跑证据表：`npm test --prefix checks` 退出码 0', '', '已运行核实', ''].join('\n');
check('assert-pr-report-semantic-pass-gate',
  gv(PR_NO_SEM, 'pr-review').some((x) => x.msg.includes('结构闸缺失')) && gv(PR_OK, 'pr-review').length === 0);

// 67-70 语义五问机读行值语义闸（semantic-pass-partial-no-go）：SEMANTIC_PASS 非 done 与 VERDICT: GO
//   并存必须判红（三端 pr-reviewer 规程硬要求「partial 即禁 GO」，旧结构闸只扫子串存在 ⇒ 两视图分叉零红灯）；
//   done+GO 与 partial+NO-GO / 末次取值改写为 done 为负控制（不得误伤）。
const SP_OK = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=done\nVERDICT: GO');
const SP_PARTIAL_GO = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial:契约清单（未完成五问节四）\nVERDICT: GO');
const SP_PARTIAL_NOGO = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial:契约清单（未完成五问节四）\nVERDICT: NO-GO');
const SP_UNKNOWN_GO = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=unknown\nVERDICT: GO');
const SP_ERRATA_DONE = REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial:x\nSEMANTIC_PASS=done\nVERDICT: GO');
check('assert-semantic-pass-partial-no-go', rvSome(SP_PARTIAL_GO, 'semantic-pass-partial-no-go'));
check('assert-semantic-pass-non-done-value-no-go', rvSome(SP_UNKNOWN_GO, 'semantic-pass-partial-no-go'));
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
  && invariants.NON_PLATFORM_ROOTS.join(',') === 'checks,mcp'
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
// 83b 值语义锚定同口径（双机读行行尾硬换行）：SEMANTIC_PASS 行与 VERDICT 行行尾各带空白时仍必咬——
//   SEMANTIC_PASS_LINE_RE 或 VERDICT 行锚定任一行尾容忍回退，semHit/verdictHit 即为 null、闸静默跳过，
//   本断言立即转红。SEMANTIC_PASS 取裸值形态（无冒号尾注）是回退可观测的前提：(?::.*)? 会把尾注与
//   行尾空白一并吞掉，带尾注夹具对行尾容忍回退零咬合（把空格插在冒号前更会 NO MATCH 永久红）；
//   无空白形态负控制由本断言第二子句（SP_PARTIAL_GO＝冒号尾注、行尾无空白）承担。
check('assert-semantic-pass-value-trailing-hardbreak-detected',
  rvSome(REPORT_OK.replace('VERDICT: GO', 'SEMANTIC_PASS=partial  \nVERDICT: GO  '), 'semantic-pass-partial-no-go')
  && rvSome(SP_PARTIAL_GO, 'semantic-pass-partial-no-go'));
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
  rv([atkRow(1), atkRow(2), '', RECEIPT, 'ATTACKS=2  ', 'PENETRATIONS=0  ', 'VERDICT: GO'].join('\n')).length === 0
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
console.log(failures === 0 ? 'CHECKS-SELFTEST ALL OK' : 'CHECKS-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
