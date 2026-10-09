// edit_scoped_file 原子替换权限位继承契约测试。
// 结构守卫断言（guard-present）全平台生效；POSIX 权限位动态断言仅非 win32 生效。
// 零外部依赖，仅用 node:child_process / node:fs / node:os / node:path。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'mcp', 'plan-governor.js');
const isWin = process.platform === 'win32';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`OK   ${name}${detail ? ' ' + detail : ''}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ' ' + detail : ''}`);
  }
}

// 结构守卫（全平台）：实现必须在 rename 前以不跟随链接的方式读取既有 mode 并对临时文件 chmodSync。
// 期望值溯源：行为契约「临时文件继承既有目标权限位，lstat 失败回退默认写行为」。
const implText = fs.readFileSync(serverPath, 'utf8');
check(
  'scoped-edit-mode-inherit-guard-present',
  /existingMode = fs\.lstatSync\(g\.target\)\.mode & 0o7777/.test(implText) &&
    /if \(existingMode !== null\) fs\.chmodSync\(tmpTarget, existingMode\);\s*\r?\n\s*fs\.renameSync\(tmpTarget, g\.target\)/.test(implText),
  isWin ? '(Windows 动态 chmod 断言跳过，以结构守卫代偿)' : '',
);

// 集成测试：spawn 真实 MCP server，走 stdio JSON-RPC 调 edit_scoped_file。
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-edit-mode-'));
fs.mkdirSync(path.join(ws, '.kilo', 'plans'), { recursive: true });
const target = path.join(ws, '.kilo', 'plans', 'mode-inherit.md');
fs.writeFileSync(target, 'alpha-beta-gamma\n', 'utf8');
if (!isWin) fs.chmodSync(target, 0o600); // 夹具初值人为收紧，非当前实现默认值

const child = spawn(process.execPath, [serverPath], {
  cwd: ws,
  env: { ...process.env, MCP_ROLE: 'main' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function rpc(method, params, timeoutMs = 15000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('rpc timeout: ' + method)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mode-inherit-selftest', version: '0.0.0' } });
  const res = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'mode-inherit.md', old_string: 'beta', new_string: 'BETA', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-edit-replaces-content', !res.result?.isError && fs.readFileSync(target, 'utf8') === 'alpha-BETA-gamma\n');

  if (!isWin) {
    // 动态断言（POSIX）：rename 替换后权限位必须继承夹具初值 0o600（默认新建权限通常为 0o644，夹具初值人为收紧以区分）。
    const mode = fs.statSync(target).mode & 0o777;
    check('scoped-edit-mode-inherited', mode === 0o600, 'actual=' + mode.toString(8));
  } else {
    check('scoped-edit-mode-inherited', true, 'SKIP win32（chmodSync 声明性，动态断言不可测，已如实声明）');
  }

  const leftovers = fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-edit-'));
  check('scoped-edit-no-tmp-left', leftovers.length === 0, leftovers.join(','));
  // F1 锁断言（跨进程编辑互斥）：预置锁文件 → 编辑须 fail-closed 拒绝；释放后成功且无锁残留。
  const lockHold = path.join(ws, '.kilo', 'plans', '.tmp-lock-mode-inherit.md.lock');
  fs.writeFileSync(lockHold, 'held', 'utf8');
  const resLocked = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'mode-inherit.md', old_string: 'BETA', new_string: 'DELTA', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-edit-lock-held-rejected', !!resLocked.result?.isError && resLocked.result.content[0].text.includes('scoped-edit-lock-timeout'));
  fs.unlinkSync(lockHold);
  const resAfter = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'mode-inherit.md', old_string: 'BETA', new_string: 'GAMMA', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  // ④ 即时老化通道端到端回归载体（契约 ④）：模拟"unlink 失败后已打 mtime 老化戳"的盘面态
  //   ＝ self-pid（server 子进程真实 pid，口径同 :128-130 既有用例的 child.pid 修正）+ JSON.time
  //   新鲜（time 龄项未满）+ mtime 已回拨 11000ms（utimes 生效态）→ edit 须即时成功回收且无锁残留。
  //   注：本用例在"龄满 self-pid 判陈旧"（161965d 已实现）语义下 Red 阶段即绿属预期——红灯职责
  //   由 scoped-release-failure-aging-stamp-guard 结构守卫承担，本块证明修复落点与既有回收域一致。
  const stampTarget = path.join(ws, '.kilo', 'plans', 'stamp-probe.md');
  fs.writeFileSync(stampTarget, 'stamp-p', 'utf8');
  const stampLock = path.join(ws, '.kilo', 'plans', '.tmp-lock-stamp-probe.md.lock');
  fs.writeFileSync(stampLock, JSON.stringify({ pid: child.pid, time: Date.now() }), 'utf8');
  const stampAged = new Date(Date.now() - 11000);
  fs.utimesSync(stampLock, stampAged, stampAged);
  const resStamp = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'stamp-probe.md', old_string: 'stamp-p', new_string: 'stamp-P', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-release-failure-stamp-evicted',
    !resStamp.result?.isError &&
      fs.readFileSync(stampTarget, 'utf8') === 'stamp-P' &&
      fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-')).length === 0);
  try { fs.unlinkSync(stampLock); } catch { /* 已被回收则忽略 ENOENT */ }
  try { fs.unlinkSync(stampTarget); } catch { /* 已不存在则忽略 */ }
  check('scoped-edit-no-lock-residue', !resAfter.result?.isError && fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-')).length === 0);
  // 陈旧锁自愈回收断言：预置垃圾内容锁 + mtime 回拨满 LOCK_STALE_MS → 编辑须成功回收并落盘。
  const staleGarbage = path.join(ws, '.kilo', 'plans', '.tmp-lock-mode-inherit.md.lock');
  fs.writeFileSync(staleGarbage, 'held', 'utf8');
  const old = new Date(Date.now() - 11000);
  fs.utimesSync(staleGarbage, old, old);
  const resStaleGarbage = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'mode-inherit.md', old_string: 'GAMMA', new_string: 'EPSILON', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-lock-stale-garbage-evicted', !resStaleGarbage.result?.isError && fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-')).length === 0);
  // 无效 pid 域断言：预置 {"pid":"abc"} 锁 + mtime 回拨 → 编辑须按不可解析回收。
  const stalePidDomain = path.join(ws, '.kilo', 'plans', '.tmp-lock-mode-inherit.md.lock');
  fs.writeFileSync(stalePidDomain, JSON.stringify({ pid: 'abc', time: Date.now() - 11000 }), 'utf8');
  fs.utimesSync(stalePidDomain, old, old);
  const resPidDomain = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'mode-inherit.md', old_string: 'EPSILON', new_string: 'ZETA', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-lock-pid-domain-evicted', !resPidDomain.result?.isError && fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-')).length === 0);
  // K1/CRITICAL 回归载体（Red-Light 红灯用例）：本进程（MCP server）遗留锁 pid===server pid 且龄满
  //   → isStaleScopedLock 必须判 stale:true 并回收，杜绝 Windows 下 release 失败残留的永久孤儿锁与
  //   后续编辑 2000ms 永久超时。
  //   注：server 以子进程运行，其真实 pid 为 child.pid；本用例刻意预置 pid: child.pid 以模拟 server 自身
  //   遗留锁（计划原文写 process.pid 指 test runner 进程，与 server 不同进程，无法触发 self-pid 分支，
  //   故此处按 server 实际 pid 修正，确保 Red→Green 真实可验）。
  const selfPidTarget = path.join(ws, '.kilo', 'plans', 'selfpid.md');
  fs.writeFileSync(selfPidTarget, 'omega-pi-omega\n', 'utf8');
  const selfPidLock = path.join(ws, '.kilo', 'plans', '.tmp-lock-selfpid.md.lock');
  fs.writeFileSync(selfPidLock, JSON.stringify({ pid: child.pid, time: Date.now() - 11000 }), 'utf8');
  fs.utimesSync(selfPidLock, old, old);
  const resSelfPid = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'selfpid.md', old_string: 'pi', new_string: 'PI', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-lock-self-pid-evicted',
    !resSelfPid.result?.isError &&
    fs.readFileSync(selfPidTarget, 'utf8') === 'omega-PI-omega\n' &&
    fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-')).length === 0);
  // 清理本用例残留（red 态下锁可能未被回收而残留孤儿锁），避免污染后续 residue 断言。
  try { fs.unlinkSync(selfPidLock); } catch { /* 已被回收则忽略 ENOENT */ }
  try { fs.unlinkSync(selfPidTarget); } catch { /* 已不存在则忽略 */ }
  // E1 回归夹具（r1 仲裁回灌，回归覆盖非 Red 载体）：预置陈旧 scoped 锁 + 陈旧 reaper
  //   （pid:999999 失效 + time/mtime 龄满）→ edit_scoped_file 须成功回收且无锁/隔离件残留。
  const r1Target = path.join(ws, '.kilo', 'plans', 'r1regress.md');
  fs.writeFileSync(r1Target, 'X\n', 'utf8');
  const staleBoth = path.join(ws, '.kilo', 'plans', '.tmp-lock-r1regress.md.lock');
  fs.writeFileSync(staleBoth, JSON.stringify({ pid: 999999, time: Date.now() - 11000 }), 'utf8');
  fs.utimesSync(staleBoth, old, old);
  const staleReaper = staleBoth + '.reaper';
  fs.writeFileSync(staleReaper, JSON.stringify({ pid: 999999, time: Date.now() - 11000 }), 'utf8');
  fs.utimesSync(staleReaper, old, old);
  const resReaperOk = await rpc('tools/call', {
    name: 'edit_scoped_file',
    arguments: { filename: 'r1regress.md', old_string: 'X', new_string: 'Y', expected_count: 1 },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-reaper-stale-recovery-regression', !resReaperOk.result?.isError &&
    fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-') || f.includes('.reaper') || f.includes('.stale-')).length === 0);
  // write↔edit 混合并发互斥断言：预置锁 → write 须超时拒绝；正常 write 后无锁残留。
  const writeLockHold = path.join(ws, '.kilo', 'plans', '.tmp-lock-wtest.md.lock');
  fs.writeFileSync(writeLockHold, 'held', 'utf8');
  const resWriteLocked = await rpc('tools/call', {
    name: 'write_scoped_file',
    arguments: { filename: 'wtest.md', content: '# wtest' },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-write-lock-held-rejected', !!resWriteLocked.result?.isError && resWriteLocked.result.content[0].text.includes('scoped-write-lock-timeout'));
  fs.unlinkSync(writeLockHold);
  const resWriteOk = await rpc('tools/call', {
    name: 'write_scoped_file',
    arguments: { filename: 'wtest2.md', content: '# wtest2' },
    _meta: { runtime_scope: 'subagent' },
  });
  check('scoped-write-lock-released', !resWriteOk.result?.isError && fs.readdirSync(path.join(ws, '.kilo', 'plans')).filter((f) => f.startsWith('.tmp-lock-')).length === 0);
  // E1 回收失败有界性（PR 审查 r1 打回项）：陈旧锁可判龄但在 deadline 窗口内不可删除时，
  //   acquireScopedLock 须受 LOCK_TIMEOUT_MS 约束 fail-closed 超时拒绝，绝不无界忙轮询
  //   （stale 分支 continue 绕过 deadline 即单线程 server 永久挂死）。
  //   结构守卫全平台：acquireScopedLock 须含两处 deadline 检查（stale 回收分支 + 活锁等待分支）。
  check(
    'scoped-lock-stale-eviction-deadline-guard-present',
    (implText.match(/Date\.now\(\) - start >= LOCK_TIMEOUT_MS/g) || []).length >= 2,
    'stale 回收分支缺 deadline（无界忙轮询风险）',
  );
  // 动态夹具（win32）：以 PowerShell FileShare::Read 握住锁文件句柄 ~4 秒（允许 stat/read、按共享
  //   规则拒绝 DELETE——模拟 AV/索引器打开锁文件导致 libuv unlinkSync 报 EBUSY/EPERM），验证陈旧
  //   判定为真（mtime 龄满 + 内容不可解析）但删除受阻时仍须在 LOCK_TIMEOUT_MS 内超时拒绝。
  //   注：fs.chmodSync 0o444 只读夹具在 libuv 上无效（unlink 前自动清除 FILE_ATTRIBUTE_READONLY，
  //   实测编辑直接成功），故改用共享冲突夹具以保真实。
  if (isWin) {
    const shareLock = path.join(ws, '.kilo', 'plans', '.tmp-lock-mode-inherit.md.lock');
    const holderMarker = path.join(ws, 'holder-ready.marker');
    fs.writeFileSync(shareLock, 'held', 'utf8');
    fs.utimesSync(shareLock, old, old);
    // 就绪握手：句柄打开后先落 marker，测试轮询到 marker 才触发编辑——消除 spawn≠已握句柄
    //   的启动竞态（否则编辑会在持有者打开前抢先完成回收，夹具失效假绿）。
    const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$h=[System.IO.File]::Open($env:LOCK_PATH_SELFTEST,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read);[System.IO.File]::WriteAllText($env:MARKER_SELFTEST,'1');Start-Sleep -Seconds 4;$h.Dispose()`],
      { stdio: 'ignore', env: { ...process.env, LOCK_PATH_SELFTEST: shareLock, MARKER_SELFTEST: holderMarker } });
    const spawnErr = await new Promise((res) => { holder.once('error', res); holder.once('spawn', () => res(null)); });
    let holderReady = false;
    if (!spawnErr) {
      const markerDeadline = Date.now() + 8000;
      while (Date.now() < markerDeadline) {
        if (fs.existsSync(holderMarker)) { holderReady = true; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (spawnErr || !holderReady) {
      try { holder.kill(); } catch { /* 未启动或已退出 */ }
      check('scoped-lock-stale-share-blocked-bounded-timeout', true, spawnErr ? 'SKIP powershell.exe 不可用（无法构造 FileShare::Read 持有夹具）' : 'SKIP 持有者就绪握手超时');
    } else {
      try {
        const resRo = await rpc('tools/call', {
          name: 'edit_scoped_file',
          arguments: { filename: 'mode-inherit.md', old_string: 'ZETA', new_string: 'ETA', expected_count: 1 },
          _meta: { runtime_scope: 'subagent' },
        });
        check('scoped-lock-stale-share-blocked-bounded-timeout', !!resRo.result?.isError && resRo.result.content[0].text.includes('scoped-edit-lock-timeout'), String(resRo.result?.content?.[0]?.text || '').slice(0, 60));
      } finally {
        await new Promise((r) => setTimeout(r, 5000)); // 等待持有者释放句柄
        try { fs.unlinkSync(shareLock); } catch { /* 清理尽力而为 */ }
      }
    }
  } else {
    check('scoped-lock-stale-share-blocked-bounded-timeout', true, 'SKIP win32-only 夹具（POSIX 归属动态复现项见计划，本套件不重复）');
  }
  // 台账结构守卫（七类攻击面在实现文件中的拒绝面逐字在场）。
  check('scoped-edit-path-lock-guard-present', implText.includes('resolveScopedPlanTarget'));
  check('scoped-lock-path-domain-guard-present', implText.includes('scopedLockPath'));
  check('scoped-edit-count-guard-present', implText.includes('scoped-edit-count-guard'));
  check('scoped-edit-expected-count-domain-guard-present', implText.includes('scoped-edit-expected-count-domain'));
  check('scoped-lock-meta-domain-guard-present', implText.includes('isStaleScopedLock'));
  check('scoped-edit-symlink-guard-present', implText.includes('符号链接'));
  check('scoped-edit-trust-root-guard-present', implText.includes('主代理/未知调用方不得直接编辑计划文件'));
  // 锁原语结构守卫（零 CPU 退避 / 陈旧回收 / write↔edit 共用锁名）。
  check('scoped-lock-atomics-wait-guard-present', implText.includes('Atomics.wait') && !implText.includes('spinEnd'));
  check('scoped-lock-stale-eviction-guard-present', implText.includes('LOCK_STALE_MS') && implText.includes('isStaleScopedLock'));
  check('scoped-lock-write-shared-guard-present', implText.includes('scopedLockPath(target)') && implText.includes('scopedLockPath(g.target)'));
  // 无 SAB 兜底可观测守卫：期望值溯源＝行为契约 1「极端环境首次降级须一次性 stderr 警告」。
  check(
    'scoped-lock-sleep-fallback-warn-guard',
    implText.includes('scopedLockSleepFallbackWarned') &&
      implText.includes('[scopedLockSleep] SharedArrayBuffer 不可用，锁退避降级为有界忙等（同步上下文无零 CPU 睡眠原语）'),
    'scopedLockSleep 兜底缺一次性 stderr 警告',
  );
  // reaper 恢复失败可观测守卫：期望值溯源＝行为契约 2「linkSync 失败须记 stderr 且语义不变」。
  check(
    'scoped-reaper-restore-link-fail-log-guard',
    implText.includes('恢复 reaper 锁 linkSync 失败（隔离件保留）') &&
      /fs\.linkSync\(quarantine, reaperPath\);\s*\r?\n\s*\} catch \(e\) \{/.test(implText),
    'reaper 恢复 linkSync 失败缺 stderr 日志或未拆分 try',
  );
  // 释放状态传播守卫：期望值溯源＝行为契约 3「releaseScopedLock 返回 { released, error? } 且两处闭包向上传播」。
  check(
    'scoped-lock-release-status-guard',
    /return \{ released: true \}/.test(implText) &&
      /error: 'NOT_OWNER'/.test(implText) &&
      /['"]ENOENT_GONE['"]/.test(implText) &&
      /error: 'NO_FD'/.test(implText) &&
      /const result = releaseScopedLock\(lockPath, lockFd, lockMeta, lockMetaWritten\);[\s\S]*?appendAuditRecord\(\{[\s\S]*?releaseStatus: result,[\s\S]*?\}\);/.test(implText) &&
      /const releaseLock = \(\) => \{[\s\S]*?return result;[\s\S]*?\r?\n        \};/.test(implText),
    'releaseScopedLock 未返回释放状态或两处闭包未真实审计失败状态',
  );
  // write 路汇合点释放状态审计守卫：期望值溯源＝行为契约 W1「write 汇合点释放失败必须留审计痕迹，
  //   且 NO_FD（锁从未取得/成功路已释放的幂等落点）不得误记」——PR #7 review 5462744798
  //   comment 4224045096 核验成立部分（评审建议缺 NO_FD 排除，照抄会审计灌水）。
  check(
    'scoped-write-error-release-audit-guard',
    /\[受控写失败\] ' \+ err\.message[\s\S]{0,800}?const writeErrorRelease = releaseLock\(\);/.test(implText) &&
      /const writeErrorRelease = releaseLock\(\);[\s\S]{0,800}?writeErrorRelease\.error !== 'NO_FD'[\s\S]{0,800}?releaseStatus: writeErrorRelease,/.test(implText),
    'write 汇合点未捕获释放状态、未排除 NO_FD，或未锚定在错误汇合点之后',
  );
  // edit 路反过度审计守卫：期望值溯源＝行为契约 W2「edit 路闭包已内置 scoped_lock_release 单源审计，
  //   调用点不得重复捕获审计」——comment 4224045114/4224045126 核验不成立，防回灌误加。
  check(
    'scoped-edit-call-site-no-dup-audit-guard',
    !/const editRelease = releaseLock\(\);/.test(implText),
    'edit 路调用点出现重复审计捕获（应仅闭包内单源审计）',
  );
  // —— 评审 5466425829 全收敛守卫：期望值溯源＝行为契约 ①②③④⑤⑥⑦（详见计划） ——
  check(
    'scoped-comment-no-hardcoded-line-refs',
    !/:[0-9]{4}/.test(implText),
    '实现文件注释仍含硬编码行号引用（契约 ②：实测 3 处须全替换）',
  );
  check(
    'scoped-write-converge-audit-anchor-present',
    /\/\/ WRITE_CONVERGE_AUDIT:/.test(implText),
    'write 汇合点缺 WRITE_CONVERGE_AUDIT 机读锚（契约 ①：fall-through 有意性未声明）',
  );
  check(
    'scoped-audit-slice-fence-present',
    implText.includes('/* AUDIT-SLICE-BEGIN */') && implText.includes('/* AUDIT-SLICE-END */'),
    '审计块围栏标记缺失（契约 ⑧：切片无法标记锚定）',
  );
  check(
    'scoped-release-failure-aging-stamp-guard',
    /if \(e && e\.code !== 'ENOENT'\) \{[\s\S]{0,600}?const aged = new Date\(Date\.now\(\) - LOCK_STALE_MS - 1000\);[\s\S]{0,120}?fs\.utimesSync\(lockPath, aged, aged\);/.test(implText),
    'unlink 失败路缺即时 mtime 老化戳（契约 ④：孤儿锁须下轮 mtime 龄项即满，消灭 self-pid 10s 空窗）',
  );
  check(
    'scoped-reaper-stderr-catch-intentional-guard',
    implText.includes('DESIGN-NOT-BUG: stderr 诊断写') &&
      /try \{ process\.stderr\.write\(`\[acquireReaperLock\][^\n]*\); \} catch \{\}/.test(implText),
    'stderr 空 catch 隔离或其声明缺失（契约 ⑤：防回灌误拆，拆即击穿 stderr-failure-still-held 实弹回归）',
  );
  check(
    'scoped-missing-observation-failclosed-guard',
    implText.includes('DESIGN-NOT-BUG: 观测不可读') &&
      implText.includes("return { code: 'MISSING_OBSERVATION' };"),
    'MISSING_OBSERVATION fail-closed 声明缺失（契约 ⑥：防回灌"再读回收"重蹈 reaper-restore-no-clobber 修掉的 TOCTOU 误删）',
  );
  check(
    'scoped-verbatim-compare-anti-normalization-guard',
    implText.includes('DESIGN-NOT-BUG: 逐字比对是刻意设计') &&
      !/JSON\.stringify\(JSON\.parse/.test(implText),
    '逐字比对声明缺失或已引入语义比对回灌形态（契约 ⑦）',
  );
  check(
    'scoped-lock-sleep-fallback-design-guard',
    /while \(Date\.now\(\) < end\) \{ \/\* DESIGN-NOT-BUG: 有界忙等/.test(implText),
    '忙等兜底缺 DESIGN-NOT-BUG 声明（契约 ③：同步语义唯一兜底，防回灌异步化）',
  );

  // —— W3 动态行为验证（E4 采纳：切片注入，真实代码在 vm 沙箱执行；Oracle 全部由契约 W1 推导）——
  // 从真实实现切片 write 路汇合点审计块（含 if 闭合 `}`，切片为语法完整片段）；
  // 用受控 releaseLock stub 注入五态返回值，以 appendAuditRecord 捕获器验证行为契约
  // （NO_FD/released 不记；失败记且字段逐项正确）。实现未落盘（Red 阶段）时切片不存在 →
  // auditSlice 为 null → 动态断言以「行为未实现」真红。
  // 切片锚定口径（评审 5466425829 ⑧ 采纳）：以实现文件显式围栏标记 /* AUDIT-SLICE-BEGIN */ 与
  //   /* AUDIT-SLICE-END */ 逐字定位，消除语句形态匹配与 8 空格缩进依赖（格式化重排不碎）；
  //   任一标记缺失 → auditSlice 为 null → 动态断言以「行为未实现」真红（与边界漂移误截可区分：
  //   后者表现为语法错/零捕获，非 null）。严禁用裸 indexOf('}')（既有红线）。
  const BEGIN_MARK = '/* AUDIT-SLICE-BEGIN */';
  const END_MARK = '/* AUDIT-SLICE-END */';
  // 围栏唯一性守卫（防回灌·bot 审查 SUGGESTION 采纳）：BEGIN/END 在实现文件中各须恰好一次。
  //   触发域：标记被复制/编辑造成重复或缺失；不该触发域：常规 BEGIN=1/END=1。
  //   退化语义：indexOf 取首次出现，重复 END 早于重复 BEGIN 会令 sliceEnd<=sliceBegin 而静默 null，
  //     下游动态断言误报「行为未实现」；本守卫以机读不变式响亮命名真实根因（标记卫生），
  //     与既有 scoped-audit-slice-fence-present 同族（Green-on-add 静态守卫）。
  const countMarker = (text, mark) => text.split(mark).length - 1;
  check(
    'scoped-audit-slice-fence-unique',
    countMarker(implText, BEGIN_MARK) === 1 && countMarker(implText, END_MARK) === 1,
    `围栏标记重复或缺失（BEGIN=${countMarker(implText, BEGIN_MARK)} END=${countMarker(implText, END_MARK)}）：切片按首次出现定位，重复将误截或静默置 null`,
  );
  const sliceBegin = implText.indexOf(BEGIN_MARK);
  // END 锚定在 BEGIN 之后搜索：杜绝「首个 END 早于首个 BEGIN」误判 null；唯一性守卫已保证常规情形二者各唯一且首次。
  const sliceEnd = sliceBegin >= 0 ? implText.indexOf(END_MARK, sliceBegin + BEGIN_MARK.length) : -1;
  const auditSlice = (sliceBegin >= 0 && sliceEnd > sliceBegin)
    ? implText.slice(sliceBegin + BEGIN_MARK.length, sliceEnd)
    : null;
  const runAuditSlice = (releaseRet) => {
    const captured = [];
    if (!auditSlice) return { captured, missing: true };
    const sandbox = {
      releaseLock: () => releaseRet,
      appendAuditRecord: (r) => { captured.push(r); },
      ROLE: 'main',
      WORKSPACE: '/ws',
    };
    vm.runInNewContext(auditSlice, sandbox);
    return { captured, missing: false };
  };
  // 防假绿基线（r2 E7① 修正）：先以「必记」注入（EBUSY）证明捕获通路活着，
  // 再跑零记录用例——若实现退化为永不 appendAuditRecord，EBUSY 用例先行 FAIL，
  // 零记录用例的「绿」才有证据力（该记时记已被同批用例证明）。
  let auditPathAlive = false;
  try {
    const alive = runAuditSlice({ released: false, error: 'EBUSY' });
    auditPathAlive = !alive.missing && alive.captured.length === 1;
  } catch { auditPathAlive = false; }
  check('scoped-audit-slice-ebusy-records-once', auditPathAlive, 'write 汇合点审计块切片不存在（行为未实现）或捕获通路失效');
  const auditCases = [
    ['scoped-audit-slice-released-no-record', { released: true }, (r) => !r.missing && r.captured.length === 0],
    ['scoped-audit-slice-nofd-no-record', { released: false, error: 'NO_FD' }, (r) => !r.missing && r.captured.length === 0],
    ['scoped-audit-slice-not-owner-records-once', { released: false, error: 'NOT_OWNER' }, (r) => !r.missing && r.captured.length === 1 && r.captured[0].reason === 'NOT_OWNER'],
    ['scoped-audit-slice-enoent-gone-records-once', { released: false, error: 'ENOENT_GONE' }, (r) => !r.missing && r.captured.length === 1 && r.captured[0].reason === 'ENOENT_GONE'],
  ];
  for (const [name, ret, verdict] of auditCases) {
    let r;
    try { r = runAuditSlice(ret); } catch (e) { r = { captured: [], missing: true, err: e.message }; }
    check(name, verdict(r), r.missing ? 'write 汇合点审计块切片不存在（行为未实现）' : `captured=${r.captured.length}`);
  }
  // TOCTOU 逐字比对设计留痕守卫：期望值溯源＝行为契约 4「比对行前固化设计理由注释，行为不变」。
  check(
    'scoped-lock-quarantine-verbatim-compare-guard',
    implText.includes('TOCTOU 防误删闸') && implText.includes('if (currentRaw === observedRaw) {'),
    'quarantine 逐字比对缺设计理由注释',
  );
  // reaper 锁防 TOCTOU 结构守卫（finding 3）：陈旧 reaper 严禁盲删，须移入唯一隔离件回读比对；release 须 token 身份校验。
  check(
    'scoped-reaper-quarantine-verify-guard-present',
    implText.includes('function acquireReaperLock') &&
      /acquireReaperLock[\s\S]*?fs\.renameSync\(reaperPath,\s*quarantine\)/.test(implText) &&
      /acquireReaperLock[\s\S]*?readFileSync\(quarantine, 'utf8'\)[\s\S]*?!==\s*v\.raw/.test(implText),
  );
  check(
    'scoped-reaper-token-identity-guard-present',
    /function releaseReaperLock\(reaperPath, fd, token\)/.test(implText) &&
      implText.includes('cur.token === token'),
  );
  // —— reaper 恢复支路无覆盖契约 ——
  // Oracle：恢复支路不得覆盖目标；目标被占即失败并保留隔离件；正常回收支路不变。
  // 从真实实现切片在 vm 执行；真实 fs 原语，仅包装调用注入确定性交错。
  const reaperSrc = implText.slice(
    implText.indexOf('function acquireReaperLock('),
    implText.indexOf('function releaseReaperLock('),
  );
  check('scoped-reaper-slice-present', reaperSrc.includes('createFresh') && reaperSrc.includes('REAPER_HELD'));
  const runReaper = (opts) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-reaper-'));
    const p = path.join(dir, 'lock.reaper');
    fs.writeFileSync(p, opts.seed);
    const calls = { rename: 0, link: 0, unlink: 0, read: 0 };
    const api = Object.create(fs);
    api.openSync = (...args) => fs.openSync(...args);
    api.writeSync = (...args) => fs.writeSync(...args);
    api.renameSync = (a, b) => { calls.rename += 1; if (opts.onRename) opts.onRename(p); return fs.renameSync(a, b); };
    api.readFileSync = (q, e) => { calls.read += 1; if (opts.onRead) opts.onRead(p); return fs.readFileSync(q, e); };
    api.linkSync = (a, b) => { calls.link += 1; if (opts.linkError) throw Object.assign(new Error(opts.linkError), { code: opts.linkError }); return fs.linkSync(a, b); };
    api.unlinkSync = (q) => { calls.unlink += 1; if (opts.unlinkError) throw Object.assign(new Error(opts.unlinkError), { code: opts.unlinkError }); return fs.unlinkSync(q); };
    let result = null, error = null;
    try {
      result = vm.runInNewContext(reaperSrc + '\nacquireReaperLock(p)', {
        fs: api, crypto, process, isStaleScopedLock: () => opts.stale, p,
      });
    } catch (e) { error = e.message; }
    const snap = {
      result, error, calls,
      target: fs.readFileSync(p, 'utf8'),
      quarantine: fs.readdirSync(dir).filter((f) => f.includes('.stale-')),
    };
    if (result && typeof result.fd === 'number') { try { fs.closeSync(result.fd); } catch { /* 已关闭 */ } }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return snap;
  };
  const raceOpts = {
    seed: 'OLD-STALE',
    stale: { stale: true, raw: 'OLD-STALE' },
    onRename: (p) => { fs.writeFileSync(p, 'REPLACEMENT-LIVE'); },
    onRead: (p) => { try { fs.writeFileSync(p, 'COMPETITOR-LIVE', { flag: 'wx' }); } catch { /* 路径已被占则不重复创建 */ } },
  };
  const race = runReaper(raceOpts);
  check('scoped-reaper-race-no-clobber',
    race.target === 'COMPETITOR-LIVE' && race.quarantine.length === 1 && !!race.result && race.result.code === 'REAPER_HELD',
    `target=${race.target} error=${race.error} quarantine=${race.quarantine.length} code=${race.result && race.result.code}`);
  const free = runReaper({
    seed: 'OLD-STALE',
    stale: { stale: true, raw: 'OLD-STALE' },
    onRename: (p) => { fs.writeFileSync(p, 'REPLACEMENT-LIVE'); },
  });
  check('scoped-reaper-free-target-restored',
    free.target === 'REPLACEMENT-LIVE' && free.quarantine.length === 0 && free.calls.link === 1 &&
      !!free.result && free.result.code === 'REAPER_HELD',
    `target=${free.target} quarantine=${free.quarantine.length} link=${free.calls.link}`);
  const unsupported = runReaper({ ...raceOpts, linkError: 'EPERM' });
  check('scoped-reaper-link-unsupported-fail-closed',
    unsupported.target === 'COMPETITOR-LIVE' && unsupported.quarantine.length === 1 && unsupported.calls.link === 1 &&
      unsupported.calls.rename === 1 && !!unsupported.result && unsupported.result.code === 'REAPER_HELD',
    `target=${unsupported.target} rename=${unsupported.calls.rename} link=${unsupported.calls.link}`);
  const unlinkFail = runReaper({
    seed: 'OLD-STALE',
    stale: { stale: true, raw: 'OLD-STALE' },
    onRename: (p) => { fs.writeFileSync(p, 'REPLACEMENT-LIVE'); },
    unlinkError: 'EBUSY',
  });
  check('scoped-reaper-quarantine-unlink-failure-preserved',
    unlinkFail.target === 'REPLACEMENT-LIVE' && unlinkFail.quarantine.length === 1 && unlinkFail.calls.link === 1 &&
      unlinkFail.calls.unlink === 1 && !!unlinkFail.result && unlinkFail.result.code === 'REAPER_HELD',
    `target=${unlinkFail.target} quarantine=${unlinkFail.quarantine.length}`);
  const normal = runReaper({ seed: 'OLD-STALE', stale: { stale: true, raw: 'OLD-STALE' } });
  check('scoped-reaper-normal-recovery-unchanged',
    normal.quarantine.length === 0 && normal.calls.link === 0 && normal.calls.rename === 1 &&
      !!normal.result && typeof normal.result.fd === 'number' && JSON.parse(normal.target).pid === process.pid,
    `quarantine=${normal.quarantine.length} link=${normal.calls.link} pid=${JSON.parse(normal.target).pid}`);
  const emptyRawReplaced = runReaper({
    seed: '',
    stale: { stale: true, raw: '' },
    onRename: (p) => { fs.writeFileSync(p, 'REPLACEMENT-LIVE'); },
  });
  const nullRaw = runReaper({ seed: 'OLD-STALE', stale: { stale: true, raw: null } });
  check('scoped-reaper-empty-raw-distinct-from-null',
    emptyRawReplaced.target === 'REPLACEMENT-LIVE' && emptyRawReplaced.calls.link === 1 &&
      nullRaw.calls.rename === 0 && nullRaw.target === 'OLD-STALE' && !!nullRaw.result && nullRaw.result.code === 'REAPER_HELD',
    `emptyTarget=${emptyRawReplaced.target} nullRename=${nullRaw.calls.rename}`);
  // 恢复失败 stderr 动态验证：期望值溯源＝行为契约 7「linkSync 注入失败时 stderr 恒收到失败日志，
  //   link 成功路径不得误发」。stderr 捕获仅记录后转发，不阻断套件自身输出。
  const runReaperWithStderr = (opts) => {
    const lines = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { lines.push(String(chunk)); return origWrite(chunk); };
    try {
      return { snap: runReaper(opts), lines };
    } finally {
      process.stderr.write = origWrite;
    }
  };
  const linkFailStderr = runReaperWithStderr({ ...raceOpts, linkError: 'EPERM' });
  check('scoped-reaper-restore-link-fail-stderr-emitted',
    linkFailStderr.lines.some((l) => l.includes('恢复 reaper 锁 linkSync 失败')) &&
      linkFailStderr.snap.result && linkFailStderr.snap.result.code === 'REAPER_HELD',
    `lines=${linkFailStderr.lines.length}`);
  const origWriteThrow = process.stderr.write;
  let stderrThrowSnap;
  process.stderr.write = () => { throw new Error('injected stderr EPIPE'); };
  try {
    stderrThrowSnap = runReaper({ ...raceOpts, linkError: 'EPERM' });
  } finally {
    process.stderr.write = origWriteThrow;
  }
  check('scoped-reaper-restore-stderr-failure-still-held',
    !!stderrThrowSnap.result && stderrThrowSnap.result.code === 'REAPER_HELD' && stderrThrowSnap.error === null,
    `code=${stderrThrowSnap.result && stderrThrowSnap.result.code} error=${stderrThrowSnap.error}`);
  const freeStderr = runReaperWithStderr({
    seed: 'OLD-STALE',
    stale: { stale: true, raw: 'OLD-STALE' },
    onRename: (p) => { fs.writeFileSync(p, 'REPLACEMENT-LIVE'); },
  });
  check('scoped-reaper-restore-link-success-no-log',
    !freeStderr.lines.some((l) => l.includes('恢复 reaper 锁 linkSync 失败')) &&
      freeStderr.snap.calls.link === 1,
    `lines=${freeStderr.lines.length} link=${freeStderr.snap.calls.link}`);
  check('scoped-reaper-restore-no-clobber-primitive-present',
    /acquireReaperLock[\s\S]*?fs\.linkSync\(quarantine,\s*reaperPath\)/.test(implText) &&
      !/acquireReaperLock[\s\S]*?fs\.renameSync\(quarantine,\s*reaperPath\)/.test(implText));
} finally {
  // Windows 下子进程句柄未释放时 rmdir 会 EBUSY，先等其退出再清理
  if (child.exitCode === null) {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
      setTimeout(resolve, 3000);
    });
  }
  fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

process.exit(failures === 0 ? 0 : 1);
