// platform-inventory 专属自测：--out 缺值守卫（R1）与 outBase 子段符号链接前置拒绝（containment 回归锁）。
// 红→绿账目见 .kilo/plans/20261011-t4-inventory-gov-conflict.md。
// 零外部依赖，仅用 node 内置模块。命名空间导入：空桩阶段零导出，命名导入会在 ESM 链接期抛
// SyntaxError 假红；命名空间导入把缺失延迟到守卫抛出 TypeError（[PASS-RED] 目标契约缺失）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as inv from './platform-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'checks', 'platform-inventory.mjs');
const SPEC_ROOT = root;

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`OK   ${name}${detail ? ' ' + detail : ''}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`);
  }
}

// 最小三平台夹具：CLI 与 runInventory 均只消费 AGENTS.md（agents/ 可选），每端一份。
function mkPlat(r) {
  for (const q of ['kilocode', 'codebuddy', 'zcode']) {
    fs.mkdirSync(path.join(r, q));
    fs.writeFileSync(path.join(r, q, 'AGENTS.md'), '---\nname: x\n---\n\nbody\n');
  }
}

// —— 测试 a：--out 缺值守卫（R1，RED→GREEN 真红驱动）——
// 期望值溯源（行为契约）：--out 作为末尾 token（无值）或下一 token 为另一选项（以 -- 开头）时，
//   CLI 必须 exit 2 并明确报错，绝不产生 undefined.json / --check.json；合法相对 basename 照常放行。
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-out-missing-'));
  try {
    mkPlat(tmp);
    fs.mkdirSync(path.join(tmp, '.kilo'));
    // 攻击样本 A：--out 作为最后一个 argv token（无值）→ 必须 exit 2 且无 undefined.json
    const r = spawnSync(process.execPath, [cli, '--out'], { cwd: tmp, encoding: 'utf8' });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const noUndefined = !fs.existsSync(path.join(tmp, '.kilo', 'plans', 'undefined.json'));
    check('inv-out-missing-value-rejected',
      r.status === 2 && noUndefined && /--out 缺少值/.test(out),
      'status=' + r.status + ' undefined.json=' + !noUndefined);
    // 退化样本：--out 紧跟另一选项 --check → 不得把 --check 当值消费，必须 exit 2
    const r2 = spawnSync(process.execPath, [cli, '--out', '--check'], { cwd: tmp, encoding: 'utf8' });
    const noFlagValue = !fs.existsSync(path.join(tmp, '.kilo', 'plans', '--check.json'));
    check('inv-out-flag-as-value-rejected',
      r2.status === 2 && noFlagValue,
      'status=' + r2.status + ' --check.json=' + !noFlagValue);
    // 对照样本：合法相对 basename → exit 0，不失败（not-trigger 域，防过度拦截）
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-out-ok-'));
    try {
      mkPlat(tmp2);
      fs.mkdirSync(path.join(tmp2, '.kilo'));
      const r3 = spawnSync(process.execPath, [cli, '--out', '20261011-inv'], { cwd: tmp2, encoding: 'utf8' });
      const out3 = String(r3.stdout || '');
      check('inv-out-valid-value-accepted',
        r3.status === 0 && out3.includes('PLATFORM-INVENTORY files=3')
          && fs.existsSync(path.join(tmp2, '.kilo', 'plans', '20261011-inv.json')),
        'status=' + r3.status);
    } finally { fs.rmSync(tmp2, { recursive: true, force: true }); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// —— 测试 b：outBase 子段符号链接在 mkdir 前被拒绝（containment 已在场的回归锁）——
// 期望值溯源：runInventory 的 outBase 子段符号链接预扫（:336-346）在 mkdirSync（:367）之前执行，
//   任一既有子段为符号链接即抛 PLATFORM-INVENTORY FAIL，recursive mkdir 不得在盘外产生任何新条目。
//   本用例在基线已绿（守卫已存在）：证明「子段符号链接可穿越 mkdir」的缺口不成立 → containment SKIP。
{
  fs.mkdirSync(path.join(SPEC_ROOT, '.kilo'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(SPEC_ROOT, '.kilo', '.inv-t4-sym-'));
  try {
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    let dirLink = true;
    try { fs.symlinkSync(outside, path.join(out, 'evil'), 'junction'); } catch { dirLink = false; }
    if (!dirLink) {
      // 与 win32 分支同语义：环境无法构造夹具（junction 创建失败）即如实 SKIP 并说明，
      //   绝不产出假 FAIL（夹具不可得≠守卫失效）；保真度对齐 scoped-edit-mode-selftest win32 分支。
      check('inv-parentdir-symlink-before-mkdir-rejected', true, 'SKIP 环境限制：无法创建目录 junction（夹具不可得），非守卫失效');
    } else {
      let threw = false;
      try { inv.runInventory(SPEC_ROOT, out, 'evil/deep'); }
      catch (e) { threw = /PLATFORM-INVENTORY FAIL/.test(String(e.message)); }
      check('inv-parentdir-symlink-before-mkdir-rejected',
        threw && fs.readdirSync(outside).length === 0,
        'threw=' + threw + ' outsideEntries=' + fs.readdirSync(outside).length);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// —— 测试 c：D1 新增三形态（空串 / 等号空值 / 重复旗标）——
// 期望值溯源（行为契约 D1）：显式空串 `--out ''`、等号空值 `--out=`、重复 `--out` 均 exit 2
//   且无 `.json` 空 basename 产物；`--out=foo` 与 `--out foo` 等价接受（等号式解析补全）。
//   旧实现仅判 `outArg === undefined || outArg.startsWith('--')`，空串与等号空值会静默落默认
//   basename 或写出 `.json` ⇒ 本组用例在旧实现上 Red。
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-out-d1-'));
  try {
    mkPlat(tmp);
    fs.mkdirSync(path.join(tmp, '.kilo'));
    const plansDir = path.join(tmp, '.kilo', 'plans');
    const noEmptyBase = () => !fs.existsSync(path.join(plansDir, '.json'));
    // 攻击样本 D1-a：显式空串 --out '' → exit 2，无 .json
    const rEmpty = spawnSync(process.execPath, [cli, '--out', ''], { cwd: tmp, encoding: 'utf8' });
    const outEmpty = String(rEmpty.stdout || '') + String(rEmpty.stderr || '');
    check('inv-out-empty-string-rejected',
      rEmpty.status === 2 && noEmptyBase() && /--out 缺少值或为空/.test(outEmpty),
      'status=' + rEmpty.status + ' .json=' + !noEmptyBase());
    // 攻击样本 D1-b：等号空值 --out= → exit 2，无 .json
    const rEq = spawnSync(process.execPath, [cli, '--out='], { cwd: tmp, encoding: 'utf8' });
    const outEq = String(rEq.stdout || '') + String(rEq.stderr || '');
    check('inv-out-equals-empty-rejected',
      rEq.status === 2 && noEmptyBase() && /--out 缺少值或为空/.test(outEq),
      'status=' + rEq.status + ' .json=' + !noEmptyBase());
    // 攻击样本 D1-c：重复 --out → exit 2（拒绝多义输入，不采用"最后一个优先"）
    const rDup = spawnSync(process.execPath, [cli, '--out', 'a', '--out', 'b'], { cwd: tmp, encoding: 'utf8' });
    const outDup = String(rDup.stdout || '') + String(rDup.stderr || '');
    check('inv-out-duplicate-rejected',
      rDup.status === 2 && /重复 --out 参数/.test(outDup),
      'status=' + rDup.status);
    // 对照样本 D1-d：等号式合法值 --out=foo → exit 0，与 --out foo 等价（等号式解析补全）
    const tmpEq = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-out-eq-'));
    try {
      mkPlat(tmpEq);
      fs.mkdirSync(path.join(tmpEq, '.kilo'));
      const rEqOk = spawnSync(process.execPath, [cli, '--out=20261011-eq'], { cwd: tmpEq, encoding: 'utf8' });
      const outEqOk = String(rEqOk.stdout || '');
      check('inv-out-equals-valid-accepted',
        rEqOk.status === 0 && outEqOk.includes('PLATFORM-INVENTORY files=3')
          && fs.existsSync(path.join(tmpEq, '.kilo', 'plans', '20261011-eq.json')),
        'status=' + rEqOk.status);
    } finally { fs.rmSync(tmpEq, { recursive: true, force: true }); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

process.exit(failures === 0 ? 0 : 1);
