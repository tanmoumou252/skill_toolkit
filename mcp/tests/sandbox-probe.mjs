// sandbox-probe.mjs —— 临时实验环境（T 盘沙箱）独立探针套件
// 网络依赖声明：D 组的 URL 豁免断言（git clone / npm view）仅验词法护栏放行（escaped === false），与网络可达性无关，故无网不转红；
//   但无网时该组耗时趋近各处超时上限（npm view 最坏可挂满 60s），断言不红而墙钟增加。
//
// 定位声明：本套件 spawn **真实 WebUI 服务进程**（127.0.0.1 随机空闲端口）与
//   **真实 plan-governor MCP server 进程**，取得"新进程证据"：
//     - A 组：挂载与使用说明（README 落盘 / subst 重定向 / 物理目录用户级）
//     - B 组：高危命令真放行（node -e / 文件写删 / HOME 重定向 / npm 放行）
//     - C 组：默认护栏拦截面（盘符三形态 / POSIX 根 / .. 上跳 / UNC）
//     - D 组：护栏豁免（/dev/null / URL / T: 自身）
//     - E 组：凭证与审计（Token 复用 / 双凭证分离 / MCP 无 admin token 泄漏 / 审计流水）
//     - F 组：MCP 侧代理（subagent 拒绝 / WebUI 离线时 MCP 进程内直调沙箱仍执行成功 + 护栏同样生效）
//     - G 组：受控复制通道（工作区锁回 / dest 合法性与无副作用 / 空与非数组拒 / subagent 拒 / 回执形状与返回路径可执行）
//     - H 组：销毁护栏（该拦形态表 / 该放防误伤表 / 端到端拦截与盘内清理放行 / 导出完整性）
//     - I 组：沙箱物理根豁免边界、stripDeviceNamespace fail-safe、copy 回执闭环
//
// 用法：npm run probe:sandbox --prefix mcp
//   退出码 0 = 期望全部达成；非 0 = 有探针未达期望。

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEBUI = path.resolve(here, '..', 'webui.js');
const GOVERNOR = path.resolve(here, '..', 'plan-governor.js');

let fail = 0;
let pass = 0;
const check = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail !== undefined && detail !== '' ? ' ' + String(detail).slice(0, 300) : ''));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 派生隔离 HOME：探针全部写入临时目录，绝不触碰真实用户目录与工作区 ——
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sbxprobe-'));
const isoHome = path.join(root, 'home');
fs.mkdirSync(isoHome, { recursive: true });
const TOKEN_DIR = path.join(isoHome, '.config', 'kilo');

const findFreePort = () => new Promise((resolve, reject) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});

function httpJson(port, method, p, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, path: p, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Length': data.length } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) {}
        resolve({ status: res.statusCode, json: j, raw: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// —— 启动被测 WebUI（隔离 HOME + 随机端口 + MCP_AUDIT_LOG 可选）——
const PORT = await findFreePort();
const execProbeHost = {};
for (const k of Object.keys(process.env)) if (!k.startsWith('MCP_')) execProbeHost[k] = process.env[k];
const auditOn = process.env.SBX_AUDIT === '1';
const webui = spawn(process.execPath, [WEBUI], {
  env: { ...execProbeHost, USERPROFILE: isoHome, HOME: isoHome, MCP_WEBUI_PORT: String(PORT), MCP_AUDIT_LOG: auditOn ? '1' : '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let webuiErr = '';
webui.stderr.on('data', (d) => { webuiErr += d.toString(); });
webui.stdout.on('data', () => {});

// 等就绪
let ready = false;
// 就绪探测改用不依赖鉴权的轻量面：HTTP 层能连上且路由有响应即视为就绪
//   （/api/audit 已加 Bearer 校验，且本处在读取 token 之前，无法自举）。
//   注意 httpJson(port, method, p, token, body) 的 body 传 undefined 才不发请求体，勿传 null。
for (let i = 0; i < 60 && !ready; i++) {
  try {
    const r = await httpJson(PORT, 'GET', '/api/policy');
    ready = r.status === 401 || r.status === 200;
  } catch (e) { await sleep(150); }
}
check('webui-ready', ready, webuiErr.slice(0, 200));

// 读取双凭证（从隔离 HOME）
const adminTok = fs.readFileSync(path.join(TOKEN_DIR, 'webui-token.txt'), 'utf8').trim();
let sbTok = '';
try { sbTok = fs.readFileSync(path.join(TOKEN_DIR, 'webui-sandbox-token.txt'), 'utf8').trim(); } catch (e) {}
check('tokens-generated', /^[0-9a-f]{64}$/.test(adminTok) && /^[0-9a-f]{64}$/.test(sbTok));

const VDIR = path.join(TOKEN_DIR, 'virtual-t');

// —— T: 映射副作用治理：全程追踪与自清理（可重复运行、无残留后 CI 化）——
// 启动前快照 subst 中 T: 状态：string=既有映射目标（绝不触碰）、null=无映射、
//   undefined=subst 不可用（降级）。运行结束后仅当「启动前无映射、结束时出现的映射
//   指向 kilo 管理的 virtual-t 目录（隔离 HOME 内或真实用户区）」时卸载——
//   探针只回收自己创建的映射，避免临时目录清理后残留悬空 subst 映射。
const substQuery = () => {
  try {
    const out = execSync('subst', { encoding: 'utf8' }) || '';
    const m = out.match(/^T:\\: => (.+)$/m);
    return m ? m[1].trim() : null;
  } catch (e) { return undefined; }
};
const tMappingAtStart = process.platform === 'win32' ? substQuery() : undefined;

try {
  // ============================== A 组 ==============================
  // A1: README 自动落盘
  const ens = await httpJson(PORT, 'POST', '/api/sandbox/ensure', sbTok, {});
  check('sandbox-ensure-ok', ens.status === 200 && ens.json?.ok === true, ens.raw?.slice(0, 120));
  const readmePath = path.join(VDIR, 'README.md');
  const readmeOk = fs.existsSync(readmePath);
  check('sandbox-readme-auto-created', readmeOk && (() => {
    if (!readmeOk) return false;
    const c = fs.readFileSync(readmePath, 'utf8');
    return ['subst T: /D', 'virtual-t', '防误操作'].every((s) => c.includes(s));
  })());

  // A2: ensureVirtualDrive 直调断言（仅 win32；不再制造错误挂载→拆盘场景，探针绝不拆 T: 盘）
  // 覆盖损失披露：原「错误挂载 → 被纠正重挂」分支不再被覆盖（拆盘属全局共享资源销毁，探针无权执行）。
  let remountOk = true, remountNote = '';
  if (process.platform === 'win32') {
    try {
      // 探针全程 T: 映射自检基准：复用顶层 substQuery（与副作用治理共用同一事实源）
      const tAtStart = tMappingAtStart;
      // 直调 ensureVirtualDrive（经 WebUI /api/sandbox/ensure 委派），断言返回字段
      const ens2 = await httpJson(PORT, 'POST', '/api/sandbox/ensure', sbTok, {});
      const canon = VDIR.toLowerCase();
      const tAfter = substQuery();
      remountOk = ens2.status === 200 && ens2.json?.ok === true && tAfter !== null &&
        path.resolve(tAfter).toLowerCase() === canon;
      remountNote = tAfter || (tAfter === null ? 'no T: mapping' : 'subst unavailable');
      // 三态显式化：subst 不可用 → SKIP（不再 `? true` 静默假绿）；
      //   探针前无 T:（tAtStart===null）→ 只要探针自身未移除即 OK，不因“起点为空”假红。
      const tAvail = tAtStart !== undefined && tAfter !== undefined;
      if (tAvail) {
        check('sandbox-t-mapping-never-removed',
          tAtStart === null ? tAfter !== null : (tAtStart !== null && tAfter !== null),
          'start=' + String(tAtStart) + ' after=' + String(tAfter));
      } else {
        console.log('SKIP sandbox-t-mapping-never-removed (subst 不可用，无法判定映射存续)');
      }
    } catch (e) {
      remountOk = false;
      remountNote = 'subst unavailable: ' + e.message.slice(0, 60);
    }
  }
  check('sandbox-subst-remount-correct', remountOk, remountNote);

  // A3: 物理目录在用户级 .config/kilo 下，且不在当前工作区内
  const cwd = process.cwd();
  const inKilo = VDIR.toLowerCase().startsWith(TOKEN_DIR.toLowerCase());
  const notInWorkspace = !VDIR.toLowerCase().startsWith(cwd.toLowerCase());
  check('sandbox-dir-user-level', inKilo && notInWorkspace, VDIR);

  // ============================== B 组 ==============================
  const execSb = async (command, token = sbTok) => httpJson(PORT, 'POST', '/api/sandbox/exec', token, { command, timeout_seconds: 60 });

  const b1 = await execSb('node -e "console.log(6*7)"');
  check('sandbox-high-risk-allowed', b1.status === 200 && b1.json?.ok === true && b1.json?.exitCode === 0 && b1.json?.stdout?.includes('42'), b1.json?.error || b1.json?.stdout);

  const b2 = await execSb('node -e "require(\'fs\').writeFileSync(\'probe-w.txt\',\'ok\')"');
  check('sandbox-file-write-inside', b2.json?.ok === true && b2.json?.exitCode === 0 && fs.existsSync(path.join(VDIR, 'probe-w.txt')), b2.json?.stderr?.slice(0, 100));

  const b3 = await execSb('node -e "require(\'fs\').rmSync(\'probe-w.txt\')"');
  check('sandbox-file-rm-inside', b3.json?.ok === true && b3.json?.exitCode === 0 && !fs.existsSync(path.join(VDIR, 'probe-w.txt')), b3.json?.stderr?.slice(0, 100));

  const b4 = await execSb('node -e "console.log(process.env.HOME)"');
  const homeOut = String(b4.json?.stdout || '').trim().toLowerCase();
  const redirected = b4.json?.ok === true && (homeOut === 't:\\' || homeOut.includes('virtual-t'));
  check('sandbox-home-redirected', redirected, homeOut);

  const b5 = await execSb('npm --version');
  check('sandbox-npm-install-allowed', b5.json?.ok === true && b5.json?.exitCode === 0 && /^\d+\./.test(String(b5.json?.stdout || '').trim()), b5.json?.stdout || b5.json?.error);

  // ============================== C 组 ==============================
  const guardCases = [
    ['sandbox-guard-blocks-c-drive', 'cat C:/Windows/win.ini'],
    ['sandbox-guard-blocks-instring-drive', `node -e "console.log(require('fs').readFileSync('D:/x'))"`],
    ['sandbox-guard-blocks-drive-relative', 'type C:Windows\\win.ini'],
    ['sandbox-guard-blocks-bare-drive', 'cd C:'],
    ['sandbox-guard-blocks-etc', 'ls /etc'],
    ['sandbox-guard-blocks-dotdot', 'cat ../package.json'],
    ['sandbox-guard-blocks-unc', 'ls \\\\server\\share'],
    // T: 前缀不得吞掉 .. 上跳（virtual-t 的物理父目录就是治理信任根）
    ['sandbox-guard-blocks-t-dotdot-root', 'cat T:/../mode-key'],
    ['sandbox-guard-blocks-t-dotdot-backslash', 'type T:\\..\\governor-policy.json'],
    // 整 token 引号包裹的写逃逸参数
    ['sandbox-guard-blocks-quoted-prefix-root', 'echo "--prefix=/"'],
    ['sandbox-guard-blocks-quoted-output-dotdot', 'echo "--output=../../x"'],
  ];
  for (const [name, cmd] of guardCases) {
    const r = await execSb(cmd);
    check(name, r.status === 200 && r.json?.ok === false && r.json?.escaped === true, r.json?.error?.slice(0, 100));
  }

  // ============================== D 组 ==============================
  const d1 = await execSb('echo x > /dev/null');
  check('sandbox-guard-allows-devnull', d1.json?.ok === true && d1.json?.escaped === false, d1.json?.error?.slice(0, 80));

  const d2 = await execSb('git clone https://host.invalid/x.git');
  check('sandbox-guard-allows-url-clone', d2.json?.escaped === false, d2.json?.error?.slice(0, 80));
  const d2b = await execSb('npm view lodash');
  check('sandbox-guard-allows-npm-view', d2b.json?.escaped === false, d2b.json?.error?.slice(0, 80));

  const d3 = await execSb('cat T:/README.md');
  check('sandbox-guard-allows-t-drive', d3.json?.ok === true && d3.json?.escaped === false, d3.json?.error?.slice(0, 80));

  // ============================== E 组 ==============================
  // Token 复用不互踩 —— 第二实例用同端口必然 EADDRINUSE 干净退出，磁盘 token 不变
  const dup = spawn(process.execPath, [WEBUI], {
    env: { ...execProbeHost, USERPROFILE: isoHome, HOME: isoHome, MCP_WEBUI_PORT: String(PORT), MCP_AUDIT_LOG: '' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let dupExit = null;
  dup.stderr.on('data', () => {});
  dup.on('exit', (c) => { dupExit = c; });
  await sleep(1500);
  const tokOnDisk = fs.readFileSync(path.join(TOKEN_DIR, 'webui-sandbox-token.txt'), 'utf8').trim();
  check('sandbox-dup-exits-clean', dupExit !== null && dupExit !== 0, 'exit=' + dupExit);
  check('sandbox-token-file-unchanged', tokOnDisk === sbTok && /^[0-9a-f]{64}$/.test(tokOnDisk));
  try { dup.kill(); } catch (e) {}

  // 双凭证分离 —— sandbox token 不能调 admin 专属 PUT /api/policy；admin token 可调 sandbox exec
  const p1 = await httpJson(PORT, 'PUT', '/api/policy', sbTok, { customAllow: [], customDeny: [] });
  check('sandbox-dual-token-separation-deny', p1.status === 401, p1.status);
  const p2 = await execSb('echo adm-ok', adminTok);
  check('sandbox-dual-token-separation-admin-ok', p2.json?.ok === true, p2.status);

  // plan-governor.js 全文不出现 webui-token.txt
  const govSrc = fs.readFileSync(GOVERNOR, 'utf8');
  check('sandbox-mcp-no-admin-token-read', !govSrc.includes('webui-token.txt'));

  // 审计流水（需 SBX_AUDIT=1 派生；否则降级为记录不生成亦视为跳过说明）
  if (auditOn) {
    const auditFile = path.join(TOKEN_DIR, 'governor-audit.jsonl');
    await execSb('echo audit-marker');
    await sleep(300);
    let found = false;
    try {
      const lines = fs.readFileSync(auditFile, 'utf8').split(/\r?\n/);
      for (const l of lines) {
        if (!l.trim()) continue;
        let j; try { j = JSON.parse(l); } catch (e) { continue; }
        if (j.event === 'sandbox_exec' && j.role === 'webui-sandbox' && 'workspace' in j) { found = true; break; }
      }
    } catch (e) { /* file missing */ }
    check('sandbox-audit-trail-recorded', found);
  } else {
    console.log('SKIP sandbox-audit-trail-recorded (SBX_AUDIT=1 未开启，审计为 opt-in)');
  }

  // ============================== F 组 ==============================
  // F1: subagent 角色调用 exec_sandboxed_command 被拒
  const subHome = path.join(root, 'home-sub');
  fs.mkdirSync(subHome, { recursive: true });
  const sub = spawn(process.execPath, [GOVERNOR], {
    cwd: root,
    env: { ...execProbeHost, MCP_ROLE: 'subagent', USERPROFILE: subHome, HOME: subHome },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let subBuf = '';
  sub.stdout.on('data', (d) => { subBuf += d.toString(); });
  sub.stderr.on('data', () => {});
  await sleep(900);
  sub.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'exec_sandboxed_command', arguments: { command: 'echo hi' } } }) + '\n');
  await sleep(900);
  let subReply = null;
  for (const l of subBuf.split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (j.id === 1) { subReply = j; break; } } catch (e) {}
  }
  const subText = String(subReply?.result?.content?.[0]?.text || '');
  check('sandbox-mcp-subagent-denied', subReply?.result?.isError === true && subText.includes('不可用'), subText.slice(0, 80));
  try { sub.kill(); } catch (e) {}

  // F2: WebUI 离线时 MCP main 实例直调沙箱内核仍执行成功（进程内自足，零 HTTP 依赖）
  //     不设置 MCP_WEBUI_PORT（等价默认 3300 无服务），MCP 进程应自行完成 T 盘挂载与命令执行。
  //     沙箱通道仅校验角色（main 恒可用），无需预置模式信任态。
  const mainHome = path.join(root, 'home-main');
  fs.mkdirSync(mainHome, { recursive: true });
  const main2 = spawn(process.execPath, [GOVERNOR], {
    cwd: root,
    env: { ...execProbeHost, MCP_ROLE: 'main', USERPROFILE: mainHome, HOME: mainHome },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let m2Buf = '';
  main2.stdout.on('data', (d) => { m2Buf += d.toString(); });
  main2.stderr.on('data', () => {});
  await sleep(900);
  main2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'exec_sandboxed_command', arguments: { command: 'echo offline-ok' } } }) + '\n');
  await sleep(3000);
  let m2Reply = null;
  for (const l of m2Buf.split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (j.id === 1) { m2Reply = j; break; } } catch (e) {}
  }
  const m2Text = String(m2Reply?.result?.content?.[0]?.text || '');
  check('sandbox-mcp-offline-inprocess-exec',
    m2Reply?.result && !m2Reply.result.isError === true && m2Text.includes('SUCCESS') && m2Text.includes('offline-ok'),
    m2Text.slice(0, 120));
  // F2b: 护栏在 MCP 直调路径同样生效
  main2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'exec_sandboxed_command', arguments: { command: 'cat /etc/hosts' } } }) + '\n');
  await sleep(1500);
  let m2Reply2 = null;
  for (const l of m2Buf.split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (j.id === 2) { m2Reply2 = j; break; } } catch (e) {}
  }
  const m2Text2 = String(m2Reply2?.result?.content?.[0]?.text || '');
  check('sandbox-mcp-offline-path-guard', m2Reply2?.result?.isError === true && m2Text2.includes('执行拦截'), m2Text2.slice(0, 120));
  try { main2.kill(); } catch (e) {}

  // ============================== G 组 ==============================
  // copy_into_sandbox 受控复制通道探针。
  // 调用机制：G1/G2/G3/G5/G6 走进程内 import（createRequire 引入 plan-governor.js）——
  //   被测内核 WORKSPACE = process.cwd()，进程内 import 时 cwd = 探针进程 cwd，
  //   相对源 mcp/package.json 才能经工作区锁回判定解析成立；沿用 F 组 spawn 模式会因
  //   cwd 为临时目录而必然假红。G4（角色门禁）沿用 F 组 spawn + stdin JSON-RPC 模式。
  // HOME 隔离：进程内加载前将 HOME/USERPROFILE 重定向到 isoHome 并剥离 MCP_* 前缀键，
  //   使 gov 的沙箱路径绑定到隔离树，杜绝 G 组写入真实用户级目录（对齐文件头声明；
  //   spawn 各组经 env 覆盖已有同款隔离）。内核在 require 期一次性绑定路径，
  //   本进程后续无 HOME 依赖方（后续 spawn 均用预构 execProbeHost），故不回滚 env。
  for (const gk of Object.keys(process.env)) { if (gk.startsWith('MCP_')) delete process.env[gk]; }
  process.env.HOME = isoHome;
  process.env.USERPROFILE = isoHome;
  const { createRequire } = await import('module');
  const gov = createRequire(GOVERNOR)(GOVERNOR);

  check('g-inprocess-home-isolated',
    path.resolve(gov.VIRTUAL_DRIVE_DIR).toLowerCase().startsWith(isoHome.toLowerCase()),
    String(gov.VIRTUAL_DRIVE_DIR));

  // 探针前置自检：进程内 WORKSPACE 必须包含 mcp/package.json，否则相对源解析会假红
  const govWorkspace = path.resolve(gov.WORKSPACE);
  const relSrc = path.relative(govWorkspace, path.join(here, '..', 'package.json'));
  const probeSrcRel = relSrc.split(path.sep).join('/');
  const gSrcExists = fs.existsSync(path.join(govWorkspace, probeSrcRel));
  check('g-precondition-src-in-workspace', !relSrc.startsWith('..') && gSrcExists, probeSrcRel);

  const gVdir = gov.VIRTUAL_DRIVE_DIR;
  const gDestRoot = path.join(gVdir, 'probe-g');
  // 未导出时保持结构化 Red（而非整轮崩溃），便于先 Red 后 Green 的 TDD 观察
  const hasCopy = typeof gov.sandboxCopyInto === 'function';

  // G1: 复制工作区内既有文件（mcp/package.json，dest: 'probe-g'）
  const g1 = hasCopy ? gov.sandboxCopyInto([probeSrcRel], 'probe-g') : null;
  const g1File = path.join(gDestRoot, 'package.json');
  check('g-copy-basic-file', g1 && g1.ok === true && Array.isArray(g1.copied) && g1.copied.length === 1 && fs.existsSync(g1File), JSON.stringify(g1).slice(0, 160));

  // G5（闭合 copy→exec 链路）：复制成功后沙箱内可直接操作该文件
  const g5 = await gov.sandboxExec('cat probe-g/package.json');
  check('g-copy-then-sandbox-exec', g5 && g5.ok === true && g5.exitCode === 0 && String(g5.stdout || '').includes('plan-governor-regress'), String(g5?.stdout || g5?.error || '').slice(0, 120));

  // G2: 越权源——绝对盘符形态与 .. 形态各一条（均真实存在），断言记入 errors[] 且 T 盘无产物
  const g2Tmp = path.join(os.tmpdir(), 'mcp-sbx-g2-' + process.pid + '.txt');
  fs.writeFileSync(g2Tmp, 'g2-marker', 'utf8');
  const g2AbsFwd = g2Tmp.replace(/\\/g, '/');
  const g2RelFromParent = path.relative(path.dirname(govWorkspace), g2Tmp);
  const g2Dotdot = '..' + path.sep + g2RelFromParent;
  const g2 = hasCopy ? gov.sandboxCopyInto([g2AbsFwd, g2Dotdot], 'probe-g2') : null;
  check('g-copy-outside-workspace-denied',
    hasCopy && g2 && g2.ok === false && g2.copied.length === 0 && g2.errors.length === 2 &&
    g2.errors.every((e) => String(e.reason || '').includes('越权')) &&
    !fs.existsSync(path.join(gVdir, 'probe-g2', 'mcp-sbx-g2-' + process.pid + '.txt')),
    JSON.stringify((hasCopy && g2) ? g2.errors : 'sandboxCopyInto not exported').slice(0, 200));
  try { fs.rmSync(g2Tmp, { force: true }); } catch (e) {}

  // G3: 非法 dest——..、绝对盘符、POSIX 根、中段 ..、Windows 保留名，全部拒绝
  const g3Dests = ['../evil', 'C:/x', '/etc', 'a/../..', 'con'];
  let g3AllRejected = true;
  for (const d of g3Dests) {
    const r = hasCopy ? gov.sandboxCopyInto([probeSrcRel], d) : null;
    if (!(r && r.ok === false && r.errors.length === 1 && r.copied.length === 0)) {
      g3AllRejected = false;
      console.log('    dest=' + d + ' → ' + JSON.stringify(r).slice(0, 160));
    }
  }
  check('g-copy-invalid-dest-rejected', g3AllRejected);
  check('g-copy-invalid-dest-no-side-effects',
    !fs.existsSync(path.join(gVdir, 'x')) && !fs.existsSync(path.join(gVdir, 'etc')) &&
    !fs.existsSync(path.join(gVdir, 'evil')) && !fs.existsSync(path.join(gVdir, 'a')));

  // G6: 空 paths / 非数组 paths → 结构化空结果，不抛异常
  let g6Ok = hasCopy;
  if (hasCopy) {
    try {
      const g6a = gov.sandboxCopyInto([], 'probe-g6');
      const g6b = gov.sandboxCopyInto('not-an-array', 'probe-g6');
      g6Ok = g6a && g6a.ok === true && g6a.copied.length === 0 && g6a.errors.length === 0 &&
             g6b && g6b.ok === true && g6b.copied.length === 0 && g6b.errors.length === 0 &&
             !fs.existsSync(path.join(gVdir, 'probe-g6'));
    } catch (e) { g6Ok = false; }
  }
  check('g-copy-empty-and-nonarray-paths', g6Ok);

  // G4: subagent 角色调用 copy_into_sandbox 被拒（spawn + stdin JSON-RPC，同 F1 模式）
  const g4Home = path.join(root, 'home-g4');
  fs.mkdirSync(g4Home, { recursive: true });
  const g4 = spawn(process.execPath, [GOVERNOR], {
    cwd: root,
    env: { ...execProbeHost, MCP_ROLE: 'subagent', USERPROFILE: g4Home, HOME: g4Home },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let g4Buf = '';
  g4.stdout.on('data', (d) => { g4Buf += d.toString(); });
  g4.stderr.on('data', () => {});
  await sleep(900);
  g4.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'copy_into_sandbox', arguments: { paths: ['package.json'] } } }) + '\n');
  await sleep(900);
  let g4Reply = null;
  for (const l of g4Buf.split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (j.id === 1) { g4Reply = j; break; } } catch (e) {}
  }
  const g4Text = String(g4Reply?.result?.content?.[0]?.text || '');
  check('g-copy-subagent-denied', g4Reply?.result?.isError === true && g4Text.includes('不可用'), g4Text.slice(0, 80));
  try { g4.kill(); } catch (e) {}

  // G 组清理已下移至 I 组之后（见文件内 "G 组清理下移至此" 标记）：
  //   I3 需在 probe-g 夹具存活时消费 g1.copied[0]，原位清理会使该断言恒红。

  // ============================== H 组 ==============================
  // 沙盒销毁护栏探针（TDD：先 Red 后 Green）。
  // 调用机制：进程内 import，沿用 G 组既有 gov 句柄，断言 gov.sandboxDestroyHit 返回值——
  //   断言函数语义而非复刻正则，避免双重真相漂移。
  const hasDestroy = typeof gov.sandboxDestroyHit === 'function';

  // H1（该拦，11 条）：均须命中（返回非 null）
  const h1Cases = [
    'subst T: /D',
    'echo a && subst T: /D',
    'subst T: "/D"',
    'subst X: C:\\tools',
    'echo x | diskpart',
    'format T:',
    'rmdir /s T:\\',
    'rmdir /s T:',
    'rd /s T:\\',
    'rm -rf T:\\',
    'Remove-Item -Recurse T:\\',
  ];
  for (const cmd of h1Cases) {
    const hit = hasDestroy ? gov.sandboxDestroyHit(cmd) : null;
    check('h-destroy-blocks: ' + cmd, hit !== null, JSON.stringify(hit));
  }

  // H2（该放，防误伤，10 条）：均不命中（返回 null）
  const h2Cases = [
    'rm -rf live-check',
    'rm -rf probe-g',
    'rm -f x.txt',
    'rmdir empty-subdir',
    'ls -la',
    'cat T:/README.md',
    'echo subst',
    'Remove-Item -Recurse T:/subdir',
    'node -e "fs.rmSync(\'x\',{recursive:true})"',
    'cp -r T:/a T:/b',
  ];
  for (const cmd of h2Cases) {
    const hit = hasDestroy ? gov.sandboxDestroyHit(cmd) : null;
    check('h-destroy-allows: ' + cmd, hit === null, JSON.stringify(hit));
  }

  // H3a（端到端）：sandboxExec('subst T: /D') → 拦截，gateType: 'destroy_guard'
  const h3a = hasDestroy ? await gov.sandboxExec('subst T: /D') : null;
  check('h-destroy-exec-blocks-subst',
    h3a && h3a.ok === false && h3a.gateType === 'destroy_guard' && String(h3a.error || '').includes('沙盒销毁护栏拦截'),
    JSON.stringify(h3a).slice(0, 160));
  // H3b（端到端）：盘内清理放行
  const h3bDir = path.join(gVdir, 'h-probe-tmp');
  let h3bOk = false;
  try {
    fs.mkdirSync(h3bDir, { recursive: true });
    const h3b = hasDestroy ? await gov.sandboxExec('rm -rf h-probe-tmp') : null;
    h3bOk = !!(h3b && h3b.ok === true && !fs.existsSync(h3bDir));
  } catch (e) { h3bOk = false; }
  check('h-destroy-exec-allows-inside-cleanup', h3bOk);

  // H3c（端到端）：展开构造族 → 结构闸拦截，gateType: 'sandbox_expand_guard'（先于挂载，零副作用）
  const h3c = await gov.sandboxExec("subst T: $'\\057D'");
  check('h-destroy-exec-blocks-expand-ansi-c',
    h3c && h3c.ok === false && h3c.gateType === 'sandbox_expand_guard',
    JSON.stringify(h3c).slice(0, 160));

  // H4（导出完整性）
  check('h-destroy-exports',
    typeof gov.sandboxDestroyHit === 'function' && Array.isArray(gov.SANDBOX_DESTROY_PATTERNS),
    'typeof=' + typeof gov.sandboxDestroyHit + ' isArray=' + Array.isArray(gov.SANDBOX_DESTROY_PATTERNS));

  // ============================== I 组 ==============================
  // 新增断言：沙箱物理根豁免、stripDeviceNamespace fail-safe、copy 回执闭环。
  //   全部置于 A–H 组之后，共享前序声明的 gov/g1/hasCopy 等文件级作用域常量。

  // I1：沙箱物理根（VIRTUAL_DRIVE_DIR）豁免的边界负控
  {
    const v = gov.VIRTUAL_DRIVE_DIR;
    const s = String.fromCharCode(47), b = String.fromCharCode(92);
    const fwd = v.split(b).join(s);
    check('sandbox-guard-exempts-vdir-bare', gov.sandboxEscape('cat ' + v).length === 0);
    check('sandbox-guard-exempts-vdir-fwd-form', gov.sandboxEscape('cat ' + fwd + s + 'x.txt').length === 0);
    check('sandbox-guard-exempts-vdir-back-form', gov.sandboxEscape('cat ' + v + b + 'sub' + b + 'x.txt').length === 0);
    // 关键正控：整串兜底扫描的二次命中面——`node -e "cat('C:/…/virtual-t/x')"` 以代码开头，token 锚定不达，
    //   只有锚点 B 的整串剥离能救它；改前（无剥离）必红
    check('sandbox-guard-exempts-vdir-instring', gov.sandboxEscape('node -e ' + String.fromCharCode(39) + 'fs.readFileSync(' + String.fromCharCode(39) + fwd + s + 'x.txt' + String.fromCharCode(39) + ')' + String.fromCharCode(39)).length === 0);
    check('sandbox-guard-blocks-vdir-dotdot', gov.sandboxEscape('cat ' + v + b + '..' + b + 'policy-key').length > 0);
    check('sandbox-guard-blocks-vdir-sibling', gov.sandboxEscape('cat ' + v + '2' + b + 'x.txt').length > 0);
    check('sandbox-guard-blocks-userdir-parent', gov.sandboxEscape('cat ' + v.split(b).slice(0, -1).join(b) + b + 'policy-key').length > 0);
  }

  // I2：Windows 设备命名空间前缀清洗（fail-safe 纯函数）
  check('ns-strip-drive-form', gov.stripDeviceNamespace('\\\\?\\C:\\x\\y') === 'C:\\x\\y', String(gov.stripDeviceNamespace('\\\\?\\C:\\x\\y')));
  check('ns-strip-passthrough', gov.stripDeviceNamespace('C:\\x') === 'C:\\x' && gov.stripDeviceNamespace('/home/u') === '/home/u' && gov.stripDeviceNamespace('\\\\?\\UNC\\srv\\sh') === '\\\\?\\UNC\\srv\\sh');

  // I3：copy 回执形状 + 返回路径直接执行的闭环（copy→回执→exec 无死锁）
  if (hasCopy && g1 && g1.ok) {
    const di = gov.ensureVirtualDrive();
    const shapeOk = di.mounted
      ? /^T:[\\/]/.test(g1.destRoot) && g1.copied.every((c) => /^T:[\\/]/.test(c))
      : g1.destRoot === path.join(gov.VIRTUAL_DRIVE_DIR, 'probe-g') && g1.copied.every((c) => c.startsWith(gov.VIRTUAL_DRIVE_DIR));
    check('g-copy-receipt-shape-consistent', shapeOk, JSON.stringify({ mounted: di.mounted, destRoot: g1.destRoot, copied: g1.copied }).slice(0, 160));
    const g5b = await gov.sandboxExec('cat "' + g1.copied[0] + '"');
    check('g-copy-returned-path-executable', g5b && g5b.ok === true && g5b.exitCode === 0 && String(g5b.stdout || '').includes('plan-governor-regress'), String(g5b?.stdout || g5b?.error || '').slice(0, 100));
  } else {
    check('g-copy-receipt-shape-consistent', false, 'hasCopy/g1 missing');
    check('g-copy-returned-path-executable', false, 'hasCopy/g1 missing');
  }
  // G 组清理下移至此：仅移除本次探针在 T 盘内创建的 probe-g 子树
  try { fs.rmSync(gDestRoot, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
} finally {
  try { webui.kill(); } catch (e) {}
  // T: 映射副作用治理：回收本探针造成的映射变动，杜绝悬空映射残留。
  //   事实依据（实测）：隔离 HOME 的 WebUI ensure 会把 T: 重挂到隔离 VDIR（顶掉既有映射），
  //   进程内 gov 实例又可能把 T: 重挂回真实用户 VDIR——终态不可依赖"恰好被恢复"。
  //   回收语义：①终态映射指向本探针隔离 HOME → 卸载；启动前存在既有映射（被顶掉）则原样恢复；
  //   ②启动前无映射、终态出现 kilo virtual-t 映射（进程内 gov 创建）→ 卸载还原"无映射"基线；
  //   ③终态与启动快照一致或指向 kilo 之外 → 不动。
  if (process.platform === 'win32') {
    const now = substQuery();
    const nowNorm = typeof now === 'string' ? path.resolve(now).toLowerCase() : null;
    const nowUnderIso = nowNorm !== null && nowNorm.startsWith(isoHome.toLowerCase());
    const kiloVdirSuffix = /[\\\/]\.config[\\\/]kilo[\\\/]virtual-t$/i;
    if (nowUnderIso) {
      try { execSync('subst T: /D', { stdio: 'ignore' }); console.log('T-MOUNT-CLEANUP unmounted probe-remounted T: mapping -> ' + now); } catch (e) { console.log('T-MOUNT-CLEANUP-FAILED ' + String(e.message || e).slice(0, 120)); }
      if (typeof tMappingAtStart === 'string') {
        try { execSync('subst T: ' + tMappingAtStart, { stdio: 'ignore' }); console.log('T-MOUNT-CLEANUP restored pre-existing mapping -> ' + tMappingAtStart); } catch (e) { console.log('T-MOUNT-RESTORE-FAILED ' + String(e.message || e).slice(0, 120)); }
      }
    } else if (tMappingAtStart === null && typeof now === 'string' && kiloVdirSuffix.test(path.resolve(now))) {
      try { execSync('subst T: /D', { stdio: 'ignore' }); console.log('T-MOUNT-CLEANUP unmounted probe-created T: mapping -> ' + now); } catch (e) { console.log('T-MOUNT-CLEANUP-FAILED ' + String(e.message || e).slice(0, 120)); }
    }
  }
  // 清理沙箱探针目录（隔离 HOME 内）；探针自身绝不无条件拆 T: 挂载（见上方回收语义）
  await sleep(300);
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
}

console.log('');
console.log(`==== SANDBOX-PROBE: ${pass} passed, ${fail} failed ====`);
if (fail === 0) {
  console.log('SANDBOX-PROBE ALL OK');
  process.exit(0);
} else {
  process.exit(1);
}
