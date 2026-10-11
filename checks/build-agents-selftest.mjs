// checks/build-agents-selftest.mjs — build-agents.mjs 两个缺陷的 Red-Light 契约测试。
// (1) 残留插槽扫描域须与 renderBlock 替换域对齐：含 `-`/`.`/非 ASCII 的键缺替换同样是漏渲染插槽，
//     必须抛 build-unrendered-slot（旧 SLOT_RESIDUE_RE 词法域漏这些键 ⇒ Red）。
// (2) writeFileAtomicNoFollow 须先完整落盘临时件再原子换名：写循环中途失败时既有目标逐字节不变、
//     且无临时件残留（旧实现 ftruncate/writeFileSync 就地截断 ⇒ Red）。
// 断言名 build-unrendered-slot-rejected / inv-shared-atomic-writer-wired / build-realpath-root-containment
//   与攻击面台账（.kilo/plans/20261011-t3-build-agents.md）断言名逐字对齐，供 attack-ledger 机械对账。
// 期望值一律由行为契约推导，不抄录当前实现行为。零外部依赖，仅 node:fs / node:os / node:path。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, writeFileAtomicNoFollow } from './build-agents.mjs';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK   ' + name + (detail ? ' ' + detail : ''));
  else { failures += 1; console.log('FAIL ' + name + (detail ? ' ' + detail : '')); }
}

// —— 契约 1：残留插槽扫描域与 renderBlock 替换域对齐 ——
// 触发域：renderBlock 对任意 manifest 字符串键做 split('{{k}}').join，故含 -/./非 ASCII 的键
//   （{{my-key}}/{{slot.key}}/{{中文}}）缺替换同样是漏渲染插槽，必须抛 build-unrendered-slot 且
//   报错键逐字含原键（报错保真）。期望值由契约推导：当前正则词法域漏这些键 ⇒ 该断言 Red。
function buildThrowsSlot(text) {
  try {
    build({ blocks: [{ id: 'b', text }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: {} }] } }, [], 'M');
    return { threw: false, msg: '' };
  } catch (e) {
    return { threw: true, msg: String((e && e.message) || e) };
  }
}
const wide = buildThrowsSlot('A {{my-key}} B {{slot.key}} C {{中文}} D');
check('build-unrendered-slot-rejected',
  wide.threw && /^build:/.test(wide.msg) && wide.msg.includes('build-unrendered-slot')
    && wide.msg.includes('{{my-key}}') && wide.msg.includes('{{slot.key}}') && wide.msg.includes('{{中文}}'),
  wide.threw ? 'msg=' + wide.msg : 'build 未抛错：含 -/./非ASCII 键的漏渲染插槽漏检（扫描域未与替换域对齐）');

// 不该触发域（负控制）：纯空白形 {{ }} / {{}} 无键可提，不得判残留。
const wsOnly = buildThrowsSlot('A {{ }} B {{}} C');
check('build-unrendered-slot-whitespace-not-flagged', !wsOnly.threw, wsOnly.threw ? '误判纯空白形为残留: ' + wsOnly.msg : '');

// 正控制：含 - 的键被正确替换后产物零残留、不抛（证明断言非恒红）。
const fullyRendered = (() => {
  try {
    const ps = build({ blocks: [{ id: 'b', text: 'A {{my-key}} B' }] }, { zcode: { files: [{ output: 'agents/pw.md', blocks: ['b'], slots: { 'my-key': 'X' } }] } }, [], 'M');
    return ps.length === 1 && ps[0].text.includes('A X B') && !ps[0].text.includes('{{');
  } catch { return false; }
})();
check('build-unrendered-slot-positive', fullyRendered, '含 - 键被正确替换后不得残留');

// —— 契约 2：writeFileAtomicNoFollow 先落盘临时件再原子换名 ——
// 触发域：写循环中途失败（注入 fs.writeSync 抛错）时既有目标须逐字节不变、无临时件残留。
//   期望值由契约推导：当前实现先截断目标再写 ⇒ 中途失败毁旧产物 ⇒ 该断言 Red。
//   注入同时覆盖 win32 回退路径（fs.writeFileSync 就地截断后抛错）与 POSIX/修复路径（fs.writeSync 抛错）。
const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-agents-atomic-'));
try {
  const sub = path.join(wsRoot, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  const target = path.join(sub, 'target.txt');
  const ORIGINAL = 'PREVIOUS-PRODUCT-CONTENT\nline2\n';
  fs.writeFileSync(target, ORIGINAL, 'utf8');

  const origWriteSync = fs.writeSync;
  const origWriteFileSync = fs.writeFileSync;
  let injected = false;
  try {
    fs.writeSync = function () { injected = true; throw Object.assign(new Error('INJECTED write-loop failure'), { code: 'EINJECT' }); };
    fs.writeFileSync = function (...a) { injected = true; fs.truncateSync(a[0], 0); throw Object.assign(new Error('INJECTED in-place truncate failure'), { code: 'EINJECT' }); };
    let threw = false;
    try { writeFileAtomicNoFollow(wsRoot, target, 'NEW-CONTENT\n'); } catch (e) { threw = true; }
    const after = fs.readFileSync(target, 'utf8');
    check('inv-shared-atomic-writer-wired',
      threw && injected && after === ORIGINAL,
      threw ? ('after=' + JSON.stringify(after) + ' injected=' + injected) : 'writeFileAtomicNoFollow 未抛错（失败未注入或已吞错）');
    const residue = fs.readdirSync(sub).filter((f) => f !== 'target.txt');
    check('inv-shared-atomic-writer-no-temp-residue', residue.length === 0, '残留临时件: ' + residue.join(','));
  } finally {
    fs.writeSync = origWriteSync;
    fs.writeFileSync = origWriteFileSync;
  }
} finally {
  fs.rmSync(wsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// 正常写路径零行为变更对照：成功写后目标内容等于新文本、无临时件残留。
const wsOk = fs.mkdtempSync(path.join(os.tmpdir(), 'build-agents-atomic-ok-'));
try {
  const subOk = path.join(wsOk, 'sub');
  fs.mkdirSync(subOk, { recursive: true });
  const targetOk = path.join(subOk, 'target.txt');
  fs.writeFileSync(targetOk, 'OLD', 'utf8');
  writeFileAtomicNoFollow(wsOk, targetOk, 'NEW-CONTENT\n');
  const residueOk = fs.readdirSync(subOk).filter((f) => f !== 'target.txt');
  check('inv-shared-atomic-writer-success-updates',
    fs.readFileSync(targetOk, 'utf8') === 'NEW-CONTENT\n' && residueOk.length === 0,
    'residue=' + residueOk.join(','));
} finally {
  fs.rmSync(wsOk, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// —— 契约 3：输出父目录 realpath 收容闸（信任根入口 / 链接逃逸） ——
// 触发域：输出父目录 realpath 越出仓库根 ⇒ 拒绝写盘且不触碰目标。经 writeFileAtomicNoFollow 端到端驱动
//   assertProductDirWithinRoot 收容拒写。断言名与台账对齐（回归/接线守卫，修复前后均应绿）。
const wsRootC = fs.mkdtempSync(path.join(os.tmpdir(), 'build-agents-containment-'));
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-agents-outside-'));
try {
  const outsideTarget = path.join(outsideDir, 'target.txt');
  fs.writeFileSync(outsideTarget, 'OUTSIDE', 'utf8');
  let threwC = false;
  let msgC = '';
  try { writeFileAtomicNoFollow(wsRootC, outsideTarget, 'NEW'); } catch (e) { threwC = true; msgC = String((e && e.message) || e); }
  check('build-realpath-root-containment',
    threwC && msgC.includes('output-realpath-root-containment'),
    threwC ? 'msg=' + msgC : '未拒绝越出仓库根的写盘');
  check('build-realpath-root-containment-target-unchanged', fs.readFileSync(outsideTarget, 'utf8') === 'OUTSIDE');
} finally {
  fs.rmSync(wsRootC, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(outsideDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

process.exit(failures === 0 ? 0 : 1);
