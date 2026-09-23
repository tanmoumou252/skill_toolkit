// live-probe.mjs —— 步骤 11.5 / 8.4 探针表的脚本化版本
//
// 定位声明（务必读完再用）：本脚本 spawn **新的 MCP server 进程**执行探针，
//   取得的是"新进程证据"，**不是**宿主常驻 MCP 实例的 live 证据。
//   二者不可互相顶替：
//     - 本脚本：可进 CI 回归，每次跑的都是当前磁盘上的代码；
//     - live 证据：宿主常驻进程可能仍运行旧代码，必须重启宿主后经受控通道人工实跑。
//   若宿主未重启，本脚本全绿**不等于** live 通道已生效。
//
// 用法：npm run probe --prefix mcp
//   退出码 0 = 期望全部达成；非 0 = 有探针未达期望（输出会打印实际裁决）。

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '..', 'plan-governor.js');
const KEY = 'a'.repeat(32);

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail !== undefined ? ' ' + detail : ''));
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-liveprobe-'));
const home = path.join(root, 'home');
fs.mkdirSync(path.join(home, '.config', 'kilo'), { recursive: true });
fs.writeFileSync(path.join(home, '.config', 'kilo', 'policy-key'), KEY);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-liveprobe-sbx-'));
const canary = path.join(sandbox, 'canary_dir');
fs.mkdirSync(canary, { recursive: true });
fs.writeFileSync(path.join(canary, 'seed.txt'), 'seed\n');
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-liveprobe-work-'));
// outDir 必须建在 workdir 内：server 以 cwd=workdir 启动（见下方 spawn），
//   该进程的 WORKSPACE 即 workdir，而跨区路径闸（3.8）要求命令里的路径解析后仍落在工作区内。
//   原实现在另一个 mkdtemp（sandbox）下，会使用例 9（`ls -o ${O}` 预期 ALLOW）被新闸拒绝。
const outDir = path.join(workdir, 'out');
fs.mkdirSync(outDir, { recursive: true });
const C = canary.replace(/\\/g, '/');
const O = outDir.replace(/\\/g, '/');

const execProbeHost = {};
for (const k of Object.keys(process.env)) if (!k.startsWith('MCP_')) execProbeHost[k] = process.env[k];
const child = spawn(process.execPath, [SERVER], {
  cwd: workdir,
  env: { ...execProbeHost, MCP_ROLE: 'main', USERPROFILE: home, HOME: home },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  const L = buf.split('\n'); buf = L.pop();
  for (const l of L) {
    if (!l.trim()) continue;
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', () => {});
const send = (o) => new Promise((r) => { pending.set(o.id, r); child.stdin.write(JSON.stringify(o) + '\n'); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deniedWith = (r, kw) => !!(r?.result?.isError) && String(r?.result?.content?.[0]?.text ?? '').includes(kw);
const allowed = (r) => !(r?.result?.isError);

// [id, 命令, 期望, 关键词]
const PROBES = [
  [1, `git diff --output=${O}/p1`, 'DENY', '--output'],
  [2, `git diff "--output=${O}/p2"`, 'DENY', '--output'],
  [3, `git diff '--output=${O}/p3'`, 'DENY', '--output'],
  [4, `git diff --output\\=${O}/p4`, 'DENY', '--output'],
  [5, `git diff "--output" "${O}/p5"`, 'DENY', '--output'],
  [6, `rm -rf ${C}`, 'DENY', '黑名单'],
  [7, 'git grep --open-files-in-pager=sh pattern', 'DENY', '外部进程派生参数'],
  [8, 'git log --ext-diff', 'DENY', '外部进程派生参数'],
  [9, `ls -o ${O}`, 'ALLOW', null],
  // 新增
  [10, `/bin/bash -c "rm -rf ${C}"`, 'DENY', '命令包装前缀'],
  [11, 'git -ccore.pager=sh log', 'DENY', '外部进程派生参数'],
  // 展开族边界补测
  [12, 'echo {a,b}', 'DENY', '展开构造'],
  [13, 'echo ~', 'DENY', '展开构造'],
  [14, 'sh script.sh', 'DENY', '命令包装前缀'],
  [15, 'git -ccore.pagerX=sh log', 'DENY', '外部进程派生参数'],
  [16, 'GIT_PAGER=sh git log', 'DENY', '前置环境变量赋值'],
  [17, 'git config alias.x', 'DENY', 'git 配置写'],
  [18, `ls -o ${C}`, 'DENY', '跨区闸'],
  // 紧贴式选项实参（getopt 合法形态）：绝对路径藏在 token 中段
  [19, 'grep -fC:/Windows/win.ini /dev/null', 'DENY', '跨区闸'],
  [20, 'git -CC:/Users/1 status', 'DENY', '跨区闸'],
];

console.log('===== live 探针（新进程证据，非宿主常驻实例）=====');
await sleep(900);
let id = 1;
for (const [pid, cmd, expect, kw] of PROBES) {
  const r = await send({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'exec_guarded_command', arguments: { command: cmd } } });
  const ok = expect === 'ALLOW' ? allowed(r) : deniedWith(r, kw);
  check(`probe-${pid}-${expect}`, ok, ok ? '' : `cmd=${cmd}`);
}

// 副作用核对
const files = fs.readdirSync(outDir);
check('probe-zero-write', files.length === 0, files.length ? 'written: ' + files.join(',') : '');
check('probe-canary-survived', fs.existsSync(canary), 'canary_dir must not be deleted');

child.kill();
for (const d of [root, sandbox, workdir]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
console.log(fail === 0 ? 'LIVE-PROBE ALL OK' : `LIVE-PROBE FAILURES=${fail}`);
process.exit(fail === 0 ? 0 : 1);
