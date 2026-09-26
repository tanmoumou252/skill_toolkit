// 不变式检查器自测：证明每个检测器"该咬时真咬、不该咬时不咬"。
// 全部分支以合成文件集驱动 runAll（不读磁盘），故可在真实仓库之外独立验证。
// 每个 FAIL 行都对应一条真实断言失败；红灯即证明检测器未生效。
import { runAll, scanFences } from './invariants.mjs';
import { attackLedger, checkReportFormat, checkChainOrder, checkReportStructureGate, foldRoundFromFilename, countAttackRows, ATTACK_CLASSES, ENFORCEMENT_FILES } from './attack-ledger.mjs';

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
const PR_OK = ['# PR 复审报告', '', 'E 清单：无', '', '实跑证据表：`npm test --prefix checks` 退出码 0', '', '已运行核实', ''].join('\n');
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

console.log(failures === 0 ? 'CHECKS-SELFTEST ALL OK' : 'CHECKS-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
