// 不变式检查器自测：证明每个检测器"该咬时真咬、不该咬时不咬"。
// 全部分支以合成文件集驱动 runAll（不读磁盘），故可在真实仓库之外独立验证。
// 每个 FAIL 行都对应一条真实断言失败；红灯即证明检测器未生效。
import { runAll, scanFences } from './invariants.mjs';

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

console.log(failures === 0 ? 'CHECKS-SELFTEST ALL OK' : 'CHECKS-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
