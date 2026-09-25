// plan-governor-regress.mjs — MCP 双实例能力绑定 + 恒定最严档（plan）完整回归套件
// 模式感知钩子已移除：server 一律按最严档执法；本套件不再构造模式文件/模式密钥信任态，
// 隔离 HOME 仅预置策略签名密钥 policy-key（与 resolvePolicyKeyFile 的主路径一致）。
import { spawn, spawnSync, execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '..', 'plan-governor.js');
const KEY = 'a'.repeat(32);

let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail !== undefined ? ' ' + detail : '')); };

function cleanDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}

function isDenied(res, substr) {
  return res && res.isError && typeof res.content?.[0]?.text === 'string' && res.content[0].text.includes(substr);
}

// 顺序客户端：spawn 一个 server（隔离 HOME 含 policy-key + 工作目录 cwd），
// 逐条 action 执行：{ exec?: ..., tool?: ..., listTools?: true, id }。
// homePrep(home)：在 spawn 前向隔离 HOME 预置额外文件（如 governor-policy.json）。
// serverRequests：收集服务端主动发起的 JSON-RPC 请求帧（method+id 同现），用于
//   断言"主通道拒绝绝不自动发起沙盒调用/复制"的协议级不变量。
function runSession({ role, workdir, actions, envExtra = {}, timeoutMs = 8000, homePrep }) {
  return new Promise((resolve, reject) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.config', 'kilo'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'kilo', 'policy-key'), KEY);
    if (homePrep) homePrep(home);

    const hostEnv = {};
    for (const k of Object.keys(process.env)) if (!k.startsWith('MCP_')) hostEnv[k] = process.env[k];
    const env = { ...hostEnv, MCP_ROLE: role, USERPROFILE: home, HOME: home, ...envExtra };
    const child = spawn(process.execPath, [SERVER], { cwd: workdir, env, stdio: ['pipe', 'pipe', 'pipe'] });

    const pending = new Map();
    const serverRequests = [];
    let buf = '';
    let stderrBuf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg && msg.method !== undefined && msg.id !== undefined) serverRequests.push(msg);
        if (msg && pending.has(msg.id)) { const rj = pending.get(msg.id); pending.delete(msg.id); rj(msg); }
      }
    });
    child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
    const timer = setTimeout(() => reject(new Error('session timeout')), timeoutMs + 2000);

    const send = (obj) => new Promise((rj) => { pending.set(obj.id, rj); child.stdin.write(JSON.stringify(obj) + '\n'); });
    const execCall = (id, command, extra) => send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'exec_guarded_command', arguments: { command, ...extra } } });
    const toolCall = (id, name, args, meta) => send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {}, ...(meta ? { _meta: meta } : {}) } });
    const listToolsCall = (id) => send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });

    (async () => {
      const responses = {};
      await send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
      for (const a of actions) {
        let res;
        if (a.exec) res = await execCall(a.id, a.exec, a.extra || {});
        else if (a.tool) res = await toolCall(a.id, a.tool, a.args, a.meta);
        else if (a.listTools) res = await listToolsCall(a.id);
        else continue;
        responses[a.id] = res?.result ?? { __jsonrpcError: res?.error };
      }
      clearTimeout(timer);
      child.stdin.end(); child.kill();
      resolve({ responses, stderr: stderrBuf, home, serverRequests, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) });
    })().catch((e) => { clearTimeout(timer); child.kill(); reject(e); });
  });
}

async function main() {
  console.log('==== 开始 MCP 双实例回归测试（恒定最严档） ====');

  // —— main 恒 plan——白名单放行 / 灰区拒 / 黑名单恒拒 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-plan-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: 'git status' },
      { id: 2, exec: 'echo hello' },
      { id: 3, exec: 'rm -rf foo' },
    ] });
    check('main-plan-allow', responses[1] && !responses[1].isError);
    check('main-plan-gray-deny', isDenied(responses[2], '计划模式仅允许只读与测试命令'));
    check('main-plan-rm-deny', isDenied(responses[3], '黑名单拒绝'));
    cleanup(); cleanDir(tmp);
  }

  // —— 黑名单恒拒不依赖任何模式档位 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-edit-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 2, exec: 'rm -rf foo' },
    ] });
    check('main-edit-rm-deny', isDenied(responses[2], '黑名单拒绝'));
    cleanup(); cleanDir(tmp);
  }

  // —— 键表并表回归（whoami/diff 放行，Git Bash 写段 deny）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-keys-'));
    const keys = [
      ['whoami', true], ['diff a.txt b.txt', true], ['mv a b', false], ['touch x', false],
      ['tee x', false], ['node -e "1"', false], ['python -c "1"', false], ['git clean -fd', false],
    ];
    const actions = [];
    keys.forEach(([cmd], i) => actions.push({ id: i + 1, exec: cmd }));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions });
    keys.forEach(([cmd, allow], i) => {
      const resp = responses[i + 1];
      if (allow) check('key-allow-' + cmd.split(' ')[0], resp && !resp.isError);
      else check('key-deny-' + cmd.split(' ')[0], isDenied(resp, '黑名单拒绝'));
    });
    cleanup(); cleanDir(tmp);
  }

  // —— node 键回归（node --test/--run 已从白名单移除：二者等于任意 JS 文件执行入口）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nodekeys-'));
    fs.writeFileSync(path.join(tmp, 'foo.mjs'), 'console.log(1)\n');
    const actions = [
      { id: 1, exec: 'node --test tests/' },
      { id: 2, exec: 'node --run build' },
      { id: 3, exec: 'node -e "1"' },
      { id: 4, exec: 'node tests/foo.mjs' },
    ];
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions });
    check('nodekey-node-test-deny', isDenied(responses[1], '未登记命令'));
    check('nodekey-node-run-deny', isDenied(responses[2], '未登记命令'));
    check('nodekey-node-e-deny', isDenied(responses[3], '黑名单拒绝'));
    check('nodekey-bare-node-deny', isDenied(responses[4], '未登记命令'));
    cleanup(); cleanDir(tmp);
  }

  // —— subagent 恒定最严 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sub-'));
    const { responses, cleanup } = await runSession({ role: 'subagent', workdir: tmp, actions: [
      { id: 1, exec: 'git status' },
      { id: 2, exec: 'echo hello' },
      { id: 3, exec: 'find . -name "*.md"' },
    ] });
    check('subagent-allow', responses[1] && !responses[1].isError);
    check('subagent-gray-deny', isDenied(responses[2], '子代理越权阻断'));
    check('subagent-forbidden-deny', isDenied(responses[3], '禁入清单拒绝'));
    cleanup(); cleanDir(tmp);
  }

  // —— 结构闸 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-struct-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: 'git status 2>&1' },
      { id: 2, exec: 'git status ; git log' },
      { id: 3, exec: 'grep x f | pwsh -c "rm -rf /"' },
      { id: 4, exec: 'git log --format="%h; %s"' },
    ] });
    check('struct-fddup-allow', responses[1] && !responses[1].isError);
    check('struct-compound-deny', isDenied(responses[2], '结构闸拦截'));
    check('struct-pwshwrap-deny', isDenied(responses[3], 'pwsh/powershell -c'));
    check('struct-quotemask-allow', responses[4] && !responses[4].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 只读白名单命令不得携带 --output 写盘逃逸参数（结构闸拦截） ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-output-'));
    // 在真实 git 仓库内取证，使"文件未落盘"与"闸门生效"形成因果绑定
    //   （裸 mkdtemp 目录非 Git 仓库时 git 会先行退出，断言近乎恒真）。
    try { execSync('git init -q', { cwd: tmp, stdio: 'ignore' }); } catch {}
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\n');
    const probe = path.join(tmp, 'probe.txt').replace(/\\/g, '/');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: `git diff --output=${probe}` },
      { id: 2, exec: 'git log --output probe.txt' },
    ] });
    check('struct-output-write-deny', isDenied(responses[1], '--output'));
    check('struct-output-write-no-file', !fs.existsSync(path.join(tmp, 'probe.txt')));
    check('struct-output-space-deny', isDenied(responses[2], '--output'));
    cleanup(); cleanDir(tmp);
  }

  // —— 引号/转义变体不得绕过 --output 闸（判定视图必须逼近 bash 执行视图）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-quote-bypass-'));
    // 同源教训：裸 mkdtemp 目录非 Git 仓库时 git 会先行退出，故 "no-file" 断言近乎恒真。
    //   此处同样在真实 git 仓库内取证，使"文件未落盘"与"闸门生效"形成因果绑定。
    try { execSync('git init -q', { cwd: tmp, stdio: 'ignore' }); } catch {}
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\n');
    // canary 预置：六个目标文件先落盘、内容互不相同且可区分
    const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt'];
    const sentinel = (n) => `SENTINEL-${n}-unmodified\n`;
    for (const n of names) fs.writeFileSync(path.join(tmp, n), sentinel(n));
    // 正控输入文件名刻意避开与 canary 名（a.txt…f.txt）大小写折叠冲突：
    //   Windows 文件系统大小写不敏感，若输入命名为 A.txt/B.txt，铺开的 shell 会把它解析为
    //   a.txt/b.txt —— 正控一旦失败退出，git 会把输入内容写入目标 ⇒ 反而污染 canary
    //   （起草期实测 a.txt 被写成 "A1\nA2\n"）。改用 pc-in-1/2 彻底隔离。
    fs.writeFileSync(path.join(tmp, 'pc-in-1.txt'), 'A1\nA2\n');
    fs.writeFileSync(path.join(tmp, 'pc-in-2.txt'), 'B1\nB2\n');
    // 正控（positive control）：不经 MCP，由测试进程直接在 shell 中跑同一形态命令，
    //   证明该命令串确实具备写盘能力。正控不写 ⇒ 本块 canary 断言同样无区分力，
    //   必须停下排查（换用能确证写盘的命令串），不得静默降级回恒真断言。
    // 多形态 fallback：`git diff --no-index --output=<p>` 的写盘行为
    //   依赖 git 版本与退出码处理，单一形态在别的平台可能恒不写 ⇒ 会把"平台差异"
    //   误报成"闸门失效"。故依次尝试多种写盘形态，任一成功即证明区分力成立；
    //   全部失败才判 FAIL，并显式区分「平台不支持」与「canary 无区分力」两类原因。
    const pcPath = path.join(tmp, 'poscontrol.txt');
    const pcSentinel = 'SENTINEL-poscontrol-unmodified\n';
    const pcForms = [
      `git diff --no-index --output=${pcPath.replace(/\\/g, '/')} pc-in-1.txt pc-in-2.txt`,
      `git diff --no-index pc-in-1.txt pc-in-2.txt > ${pcPath.replace(/\\/g, '/')}`,
    ];
    let pcWritten = false, pcFormUsed = '';
    for (const form of pcForms) {
      fs.writeFileSync(pcPath, pcSentinel);
      try { spawnSync(form, { shell: true, cwd: tmp, stdio: 'ignore' }); } catch {}
      if (fs.readFileSync(pcPath, 'utf8') !== pcSentinel) { pcWritten = true; pcFormUsed = form; break; }
    }
    check('quote-bypass-positive-control-writes', pcWritten,
      pcWritten ? 'form: ' + pcFormUsed.slice(0, 50) : 'ALL forms failed: 平台不支持该写盘形态，本块 canary 断言无区分力，须换命令串');
    const p = (n) => path.join(tmp, n).replace(/\\/g, '/');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: `git diff "--output=${p('a.txt')}"` },
      { id: 2, exec: `git diff '--output=${p('b.txt')}'` },
      { id: 3, exec: `git diff --output\\=${p('c.txt')}` },
      { id: 4, exec: `git diff --out'put'=${p('d.txt')}` },
      { id: 5, exec: `git diff "--output" "${p('e.txt')}"` },
      { id: 6, exec: `git diff \\-\\-output=${p('f.txt')}` },
    ] });
    check('quote-bypass-dq-output-deny', isDenied(responses[1], '--output'));
    check('quote-bypass-sq-output-deny', isDenied(responses[2], '--output'));
    check('quote-bypass-esc-output-deny', isDenied(responses[3], '--output'));
    check('quote-bypass-split-output-deny', isDenied(responses[4], '--output'));
    check('quote-bypass-space-output-deny', isDenied(responses[5], '--output'));
    check('quote-bypass-dashes-esc-deny', isDenied(responses[6], '--output'));
    // canary 存活式断言，替代"文件不存在"恒真断言。
    //   目标文件在探针执行前【已存在】且内容可区分（sentinel）；若闸失效、变体真被执行，
    //   git diff 会把 diff 内容写进目标文件 ⇒ sentinel 必被改写 ⇒ 断言 FAIL。
    //   这样"断言成立"与"闸门生效"形成因果绑定，不再依赖"文件本就不存在"。
    for (const n of names) {
      check('quote-bypass-canary-untouched-' + n,
        fs.existsSync(path.join(tmp, n)) && fs.readFileSync(path.join(tmp, n), 'utf8') === sentinel(n));
    }
    cleanup(); cleanDir(tmp);
  }

  // —— 引号/转义插入命令名不得绕过黑名单前缀匹配（DENY 全模式不豁免）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-deny-bypass-'));
    fs.writeFileSync(path.join(tmp, 'should_not_exist'), '');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: "r'm' -rf should_not_exist" },
      { id: 2, exec: 'r\\m -rf should_not_exist' },
      { id: 3, exec: "r''m -rf should_not_exist" },
      { id: 4, exec: "git a'dd' ." },
      { id: 5, exec: "m'v' should_not_exist should_not_exist2" },
      { id: 6, exec: "to'u'ch should_not_exist" },
      { id: 7, exec: "git st'ash' list" },
    ] });
    check('deny-bypass-rm-quote', isDenied(responses[1], '黑名单拒绝'));
    check('deny-bypass-rm-backslash', isDenied(responses[2], '黑名单拒绝'));
    check('deny-bypass-rm-emptyquote', isDenied(responses[3], '黑名单拒绝'));
    check('deny-bypass-gitadd-quote', isDenied(responses[4], '黑名单拒绝'));
    check('deny-bypass-mv-quote', isDenied(responses[5], '黑名单拒绝'));
    check('deny-bypass-touch-quote', isDenied(responses[6], '黑名单拒绝'));
    check('deny-bypass-gitstash-quote', isDenied(responses[7], '黑名单拒绝'));
    check('deny-bypass-no-artifact', fs.existsSync(path.join(tmp, 'should_not_exist')));
    cleanup(); cleanDir(tmp);
  }

  // —— 引号插入命令名在任意档位均被黑名单拦截（灰区逃逸危害实证）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-blacklist-quote-'));
    // timeoutMs 必须放宽：本块会真实执行 rm -rf，实测单次 action 约 9.4s，超过 runSession 默认预算
    //   （8000 + 2000ms），否则套件会以 session timeout 中断，用例根本不产出裁决（实测复现）。
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: "r'm' -rf should_not_exist" },
      { id: 2, exec: "m'v' should_not_exist should_not_exist2" },
    ] });
    check('blacklist-quote-rm-deny', isDenied(responses[1], '黑名单拒绝'));
    check('blacklist-quote-mv-deny', isDenied(responses[2], '黑名单拒绝'));
    cleanup(); cleanDir(tmp);
  }

  // —— 外部进程派生参数闸（--open-files-in-pager / --ext-diff / --paginate / 配置注入）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exec-derive-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'git grep --open-files-in-pager=sh pattern' },
      { id: 2, exec: 'git log --ext-diff' },
      { id: 3, exec: 'git log --paginate' },
      { id: 4, exec: 'git -c core.pager=sh log' },
      { id: 5, exec: 'git log --config-env=core.pager=EVIL' },
      { id: 6, exec: 'git log --format="%h; %s"' },
      { id: 7, exec: 'git status 2>&1' },
      // 紧贴式 -c<执行面键>=（原正则 -c 后强求 \s+，整族漏网）
      { id: 8, exec: 'git -ccore.pager=sh log' },
      // 派生参数族回归：rg --pre、git grep -O 短格式、--textconv、--open 缩写、cat-file --filters
      { id: 9, exec: 'rg --pre=true ZCODEPROBE' },
      { id: 10, exec: 'git grep -Otrue pattern' },
      { id: 11, exec: 'git grep --textconv pattern' },
      { id: 12, exec: 'git grep --open=pager pattern' },
      { id: 13, exec: 'git cat-file --filters HEAD' },
      // --open-files-in-pager 的无歧义前缀缩写族（git parse-options 接受 --op / --open-f 等）
      { id: 14, exec: 'git grep --op=pager pattern' },
      { id: 15, exec: 'git grep --open-f=true pattern' },
      // 反向守卫：--o 与 --only-matching 歧义（git 自身报错），扩面后不得误杀
      { id: 16, exec: 'git grep --o pattern' },
      // --ope（--open 与 --open-f 之间的中间前缀）同样须拒
      { id: 17, exec: 'git grep --ope=pager pattern' },
      // --textconv 的缩写链：--textc 是最短无歧义前缀（--te/--t 在 git grep 歧义拒）
      { id: 18, exec: 'git grep --textc probe pattern' },
      // 反向守卫：git grep --text 是良性 -a 别名（非 --textconv），必须放行不误杀
      { id: 19, exec: 'git grep --text probe pattern' },
      // --textc 缩写在 cat-file 同样派生（全局派生参数正则拒）
      { id: 20, exec: 'git cat-file --textc HEAD' },
      // 管道第二段 -O（fd dup 掩码后纯白名单管道，seg2 派生拒）
      { id: 21, exec: 'git status 2>&1 | git grep -Otrue pattern' },
      // git 全局选项前缀形态（git -C <dir> grep -O）
      { id: 22, exec: 'git -C . grep -Otrue pattern' },
      // cat-file 的 --t/--text 缩写：仅命令感知分支命中（全局正则不覆盖）——分支隔离取证
      { id: 23, exec: 'git cat-file --t HEAD' },
      { id: 24, exec: 'git cat-file --text HEAD' },
      // 反向守卫：git log -O<orderfile> 是良性 orderfile，不得因 -O 误杀（分段判定的正控）
      { id: 25, exec: 'git log -Oorder.txt -3' },
    ] });
    check('exec-derive-pager-deny', isDenied(responses[1], '外部进程派生参数'));
    check('exec-derive-extdiff-deny', isDenied(responses[2], '外部进程派生参数'));
    check('exec-derive-paginate-deny', isDenied(responses[3], '外部进程派生参数'));
    check('exec-derive-config-pager-deny', isDenied(responses[4], '外部进程派生参数'));
    check('exec-derive-configenv-deny', isDenied(responses[5], '外部进程派生参数'));
    check('exec-derive-quotemask-allow-kept', responses[6] && !responses[6].isError);
    check('exec-derive-fddup-allow-kept', responses[7] && !responses[7].isError);
    check('exec-derive-tight-c-deny', isDenied(responses[8], '外部进程派生参数'));
    check('exec-derive-rg-pre-deny', isDenied(responses[9], '外部进程派生参数'));
    check('exec-derive-gitgrep-O-deny', isDenied(responses[10], '外部进程派生参数'));
    check('exec-derive-textconv-deny', isDenied(responses[11], '外部进程派生参数'));
    check('exec-derive-gitgrep-open-deny', isDenied(responses[12], '外部进程派生参数'));
    check('exec-derive-catfile-filters-deny', isDenied(responses[13], '外部进程派生参数'));
    check('exec-derive-open-abbrev-op-deny', isDenied(responses[14], '外部进程派生参数'));
    check('exec-derive-open-abbrev-openf-deny', isDenied(responses[15], '外部进程派生参数'));
    check('exec-derive-open-ambiguous-o-allow-kept', responses[16] && !responses[16].isError);
    check('exec-derive-open-abbrev-ope-deny', isDenied(responses[17], '外部进程派生参数'));
    check('exec-derive-textc-abbrev-deny', isDenied(responses[18], '外部进程派生参数'));
    check('exec-derive-text-benign-allow-kept', responses[19] && !responses[19].isError);
    check('exec-derive-catfile-textc-deny', isDenied(responses[20], '外部进程派生参数'));
    check('exec-derive-pipe-o-deny', isDenied(responses[21], '外部进程派生参数'));
    check('exec-derive-gitc-o-deny', isDenied(responses[22], '外部进程派生参数'));
    check('exec-derive-catfile-t-abbrev-deny', isDenied(responses[23], '外部进程派生参数'));
    check('exec-derive-catfile-text-abbrev-deny', isDenied(responses[24], '外部进程派生参数'));
    check('exec-derive-log-orderfile-allow-kept', responses[25] && !responses[25].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 展开构造闸（$ / 反引号）——subagent 恒定最严档 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-expand-deny-'));
    // 同 7c：在真实 git 仓库内取证，避免 "no-file" 断言因 git 先行退出而恒真。
    try { execSync('git init -q', { cwd: tmp, stdio: 'ignore' }); } catch {}
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\n');
    // canary 预置（同 7c）：五个目标文件先落盘、内容可区分
    const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'];
    const sentinel = (n) => `SENTINEL-${n}-unmodified\n`;
    for (const n of names) fs.writeFileSync(path.join(tmp, n), sentinel(n));
    // 正控输入名同样避开与 canary 名（a.txt…e.txt）大小写折叠冲突，理由同 7c。
    fs.writeFileSync(path.join(tmp, 'pc-in-1.txt'), 'A1\nA2\n');
    fs.writeFileSync(path.join(tmp, 'pc-in-2.txt'), 'B1\nB2\n');
    // 正控（同 7c，多形态 fallback，见 7c 处说明）
    const pcPath = path.join(tmp, 'poscontrol.txt');
    const pcSentinel = 'SENTINEL-poscontrol-unmodified\n';
    const pcForms = [
      `git diff --no-index --output=${pcPath.replace(/\\/g, '/')} pc-in-1.txt pc-in-2.txt`,
      `git diff --no-index pc-in-1.txt pc-in-2.txt > ${pcPath.replace(/\\/g, '/')}`,
    ];
    let pcWritten = false, pcFormUsed = '';
    for (const form of pcForms) {
      fs.writeFileSync(pcPath, pcSentinel);
      try { spawnSync(form, { shell: true, cwd: tmp, stdio: 'ignore' }); } catch {}
      if (fs.readFileSync(pcPath, 'utf8') !== pcSentinel) { pcWritten = true; pcFormUsed = form; break; }
    }
    check('expand-positive-control-writes', pcWritten,
      pcWritten ? 'form: ' + pcFormUsed.slice(0, 50) : 'ALL forms failed: 平台不支持该写盘形态');
    const p = (n) => path.join(tmp, n).replace(/\\/g, '/');
    const { responses, cleanup } = await runSession({ role: 'subagent', workdir: tmp, actions: [
      { id: 1, exec: `git diff --outpu$'t'=${p('a.txt')}` },
      { id: 2, exec: `git diff --out$'put'=${p('b.txt')}` },
      { id: 3, exec: `git diff --$'\\x6f'utput=${p('c.txt')}` },
      { id: 4, exec: `git diff$IFS--output=${p('d.txt')}` },
      { id: 5, exec: `git$IFS diff$IFS--output$IFS${p('e.txt')}` },
      { id: 6, exec: 'git$IFS add .' },
      { id: 7, exec: 'node$IFS-e$IFS"1"' },
      { id: 8, exec: `git log | git diff $(printf -- '--outp%st=%s' u x.txt)` },
      { id: 9, exec: `git diff --output=$HOME/x.txt` },
    ] });
    check('expand-ansi-c-sq-deny', isDenied(responses[1], '展开构造'));
    check('expand-ansi-c-mid-deny', isDenied(responses[2], '展开构造'));
    check('expand-ansi-c-hex-deny', isDenied(responses[3], '展开构造'));
    check('expand-ifs-split-deny', isDenied(responses[4], '展开构造'));
    check('expand-ifs-multi-deny', isDenied(responses[5], '展开构造'));
    check('expand-ifs-gitadd-deny', isDenied(responses[6], '展开构造'));
    check('expand-ifs-node-e-deny', isDenied(responses[7], '展开构造'));
    check('expand-cmdsubst-pipe-deny', isDenied(responses[8], '展开构造'));
    check('expand-var-home-deny', isDenied(responses[9], '展开构造'));
    for (const n of names) {
      check('expand-canary-untouched-' + n,
        fs.existsSync(path.join(tmp, n)) && fs.readFileSync(path.join(tmp, n), 'utf8') === sentinel(n));
    }
    cleanup(); cleanDir(tmp);
  }

  // —— 展开构造闸对 main 实例同样生效 ——
  //   防"仅 subagent 档被拒"的假闭环。展开构造由结构硬闸拦截，与实例角色/档位无关。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-expand-main-'));
    fs.writeFileSync(path.join(tmp, 'should_not_exist'), '');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: "r$'m' -rf should_not_exist" },
      { id: 2, exec: 'git$IFS add .' },
      { id: 3, exec: 'node$IFS-e$IFS"1"' },
    ] });
    check('expand-main-ansi-c-rm-deny', isDenied(responses[1], '展开构造'));
    check('expand-main-ifs-gitadd-deny', isDenied(responses[2], '展开构造'));
    check('expand-main-ifs-node-deny', isDenied(responses[3], '展开构造'));
    check('expand-main-no-artifact', fs.existsSync(path.join(tmp, 'should_not_exist')));
    cleanup(); cleanDir(tmp);
  }

  // —— 命令包装前缀闸（command / env / nohup / eval / bash -c / sh -c）——
  //   这些前缀把真命令推到参数位，使段首前缀匹配（DENY_KEYS 的 startsWith）整体失效：
  //   `command rm -rf x` 的段首是 `command`，不命中 `rm*`；`bash -c "rm -rf x"` 更是任意命令通道。
  //   本块在真实存在的 canary 目录上取证，使"目录未被删"与"闸门生效"形成因果绑定
  //   （若 canary 不存在，no-artifact 断言会因目标本就缺席而恒真）。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wrap-bypass-'));
    const canary = path.join(tmp, 'canary_dir');
    fs.mkdirSync(canary, { recursive: true });
    fs.writeFileSync(path.join(canary, 'seed.txt'), 'seed\n');
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\nseed2\n');
    const C = canary.replace(/\\/g, '/');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: `command rm -rf ${C}` },
      { id: 2, exec: `env rm -rf ${C}` },
      { id: 3, exec: `nohup rm -rf ${C}` },
      { id: 4, exec: `eval 'git add .'` },
      { id: 5, exec: `bash -c "rm -rf ${C}"` },
      { id: 6, exec: `sh -c "rm -rf ${C}"` },
      // 组合短选项形态：`-c` 与其它短选项并成一个簇（-lc / -ec / -xc / -eux），
      //   以及长选项 + -c（--login -c）。只认裸 `-c` 的正则会把这些整族放过。
      { id: 7, exec: `bash -lc "rm -rf ${C}"` },
      { id: 8, exec: `sh -ec "rm -rf ${C}"` },
      { id: 9, exec: `bash -xc "rm -rf ${C}"` },
      { id: 10, exec: `bash --login -c "rm -rf ${C}"` },
      // 负向基准：非包装前缀的合法命令必须仍放行（防 0.6 闸过度拒）。
      //   注意 `command git status` 不能作为负向基准——`command` 前缀同样会把段首改写成
      //   `command`，使黑名单前缀匹配整体失效，按 fail-closed 应与其恶意形态一并拒绝。
      { id: 12, exec: 'git log --format="%h; %s"' },
      { id: 13, exec: 'grep -c seed seed.txt' },
    ] });
    check('wrap-command-rm-deny', isDenied(responses[1], '命令包装前缀'));
    check('wrap-env-rm-deny', isDenied(responses[2], '命令包装前缀'));
    check('wrap-nohup-rm-deny', isDenied(responses[3], '命令包装前缀'));
    check('wrap-eval-gitadd-deny', isDenied(responses[4], '命令包装前缀'));
    check('wrap-bash-c-deny', isDenied(responses[5], '命令包装前缀'));
    check('wrap-sh-c-deny', isDenied(responses[6], '命令包装前缀'));
    check('wrap-bash-lc-deny', isDenied(responses[7], '命令包装前缀'));
    check('wrap-sh-ec-deny', isDenied(responses[8], '命令包装前缀'));
    check('wrap-bash-xc-deny', isDenied(responses[9], '命令包装前缀'));
    check('wrap-bash-loginc-deny', isDenied(responses[10], '命令包装前缀'));
    check('wrap-canary-survived', fs.existsSync(canary), 'canary_dir must not be deleted');
    check('wrap-fmt-semicolon-allow-kept', responses[12] && !responses[12].isError);
    check('wrap-grep-c-allow-kept', responses[13] && !responses[13].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 命令包装前缀闸在 subagent 档同样生效（双档取证，防单档假闭环）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wrap-sub-'));
    const { responses, cleanup } = await runSession({ role: 'subagent', workdir: tmp, actions: [
      { id: 1, exec: 'command rm -rf should_not_exist' },
      { id: 2, exec: 'bash -c "rm -rf should_not_exist"' },
    ] });
    check('wrap-sub-command-deny', isDenied(responses[1], '命令包装前缀'));
    check('wrap-sub-bash-c-deny', isDenied(responses[2], '命令包装前缀'));
    cleanup(); cleanDir(tmp);
  }

  // —— 带路径前缀的壳 -c 包装 ——
  //   SHELL_C_RE 原锚定 ^\s*，/bin/bash -c、/usr/bin/sh -c、./bash -c、C:/…/bash.exe -c 均不命中，
  //   实测 ALLOW 且 canary 真被删。本块在真实 canary 目录上取证，
  //   使"canary 未被删"与"闸门生效"形成因果绑定（canary 预先存在，非空目录断言才有意义）。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-shellpath-'));
    const canary = path.join(tmp, 'canary_dir');
    fs.mkdirSync(canary, { recursive: true });
    fs.writeFileSync(path.join(canary, 'seed.txt'), 'seed\n');
    const C = canary.replace(/\\/g, '/');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: `/bin/bash -c "rm -rf ${C}"` },
      { id: 2, exec: `/usr/bin/sh -c "rm -rf ${C}"` },
      { id: 3, exec: `./bash -c "rm -rf ${C}"` },
      { id: 4, exec: `C:/git/bin/bash.exe -c "rm -rf ${C}"` },
      // 负向基准：收紧锚点后不得误伤合法命令（防过度拒）
      { id: 5, exec: 'git status -s' },
      { id: 6, exec: 'git show --stat' },
      { id: 7, exec: 'ls -o' },
    ] });
    check('shellpath-bin-bash-deny', isDenied(responses[1], '命令包装前缀'));
    check('shellpath-usrbin-sh-deny', isDenied(responses[2], '命令包装前缀'));
    check('shellpath-dot-bash-deny', isDenied(responses[3], '命令包装前缀'));
    check('shellpath-win-bash-deny', isDenied(responses[4], '命令包装前缀'));
    check('shellpath-canary-survived', fs.existsSync(canary), 'canary_dir must not be deleted');
    check('shellpath-status-s-allow-kept', responses[5] && !responses[5].isError);
    check('shellpath-show-stat-allow-kept', responses[6] && !responses[6].isError);
    check('shellpath-ls-o-allow-kept', responses[7] && !responses[7].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 带路径前缀的壳 -c 与紧贴式 -c 在 subagent 档同样生效（双档取证，防单档假闭环）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-shellpath-sub-'));
    const { responses, cleanup } = await runSession({ role: 'subagent', workdir: tmp, actions: [
      { id: 1, exec: '/bin/bash -c "rm -rf should_not_exist"' },
      { id: 2, exec: '/usr/bin/sh -c "rm -rf should_not_exist"' },
      { id: 3, exec: 'git -ccore.pager=sh log' },
    ] });
    check('shellpath-sub-bin-bash-deny', isDenied(responses[1], '命令包装前缀'));
    check('shellpath-sub-usrbin-sh-deny', isDenied(responses[2], '命令包装前缀'));
    check('exec-derive-sub-tight-c-deny', isDenied(responses[3], '外部进程派生参数'));
    cleanup(); cleanDir(tmp);
  }

  // —— xargs 不变量（由禁入清单拦下）——
  //   xargs 直命中 FORBIDDEN_KEYS 'xargs*'（mcp/plan-governor.js:135），
  //   回执恒为"禁入清单拒绝"。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-xargs-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: 'xargs rm -rf should_not_exist' },
    ] });
    check('xargs-forbidden-deny-kept', isDenied(responses[1], '禁入清单拒绝'));
    cleanup(); cleanDir(tmp);
  }

  // —— 花括号/浪号/glob 展开族 ——
  //   已实跑证实：shell 会真实展开这三族——`echo {echo,BRACEWORKS}` 输出 `echo BRACEWORKS`
  //   （命令位可被花括号构造）、`~` 展开为 home 绝对路径、`zebra*` 展开为真实文件名。
  //   闸 0.5 只拒 `$` 与反引号，对这三族无效。本块锁死"三族一律硬拒"的不变量。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-brace-'));
    fs.writeFileSync(path.join(tmp, 'zebra1.txt'), 'z1\n');
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'echo {a,b}' },
      { id: 2, exec: '{echo,BRACEWORKS}' },
      { id: 3, exec: 'echo ~' },
      { id: 4, exec: 'echo zebra*' },
      // 负向基准：不含展开构造的合法命令必须仍放行
      { id: 5, exec: 'git status -s' },
      { id: 6, exec: 'ls -o' },
    ] });
    check('brace-expand-deny', isDenied(responses[1], '展开构造'));
    check('brace-cmdpos-deny', isDenied(responses[2], '展开构造'));
    check('tilde-expand-deny', isDenied(responses[3], '展开构造'));
    check('glob-expand-deny', isDenied(responses[4], '展开构造'));
    check('brace-status-s-allow-kept', responses[5] && !responses[5].isError);
    check('brace-ls-o-allow-kept', responses[6] && !responses[6].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 壳的非 -c 任意执行 ——
  //   已实跑：`sh script.sh` / `bash script.sh` / `/bin/bash script.sh` / `sh -s` / `bash -i`
  //   全属任意脚本执行。脚本本体即任意命令通道，与 `-c` 同性质。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-shellscript-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'sh script.sh' },
      { id: 2, exec: 'bash script.sh' },
      { id: 3, exec: '/bin/bash script.sh' },
      // `sh -s` / `bash -i` 在缺 stdin 时会真实挂起等待输入（套件实测 session timeout），
      //   故改用 `< script` 重定向形态取证——同样属"非 -c 的壳脚本执行"这一族，
      //   且不会阻塞。挂起形态登记为"未覆盖"。
      { id: 4, exec: 'sh < script.sh' },
      { id: 5, exec: 'bash ./s.sh' },
      // 负向基准
      { id: 6, exec: 'git status -s' },
    ] });
    check('shellscript-sh-deny', isDenied(responses[1], '命令包装前缀'));
    check('shellscript-bash-deny', isDenied(responses[2], '命令包装前缀'));
    check('shellscript-abs-bash-deny', isDenied(responses[3], '命令包装前缀'));
    check('shellscript-sh-redirect-deny', isDenied(responses[4], '命令包装前缀'));
    check('shellscript-bash-path-deny', isDenied(responses[5], '命令包装前缀'));
    check('shellscript-status-s-allow-kept', responses[6] && !responses[6].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— git -c 异形键名 ——
  //   已实跑：`core.pagerX=sh` / `core.pager2=sh` 均 ALLOW。执行面键按"前缀族"收口：
  //   凡以 core.pager / core.editor 等执行面键名打头的键（含后缀变形）一律拦。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gitkey-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'git -ccore.pagerX=sh log' },
      { id: 2, exec: 'git -c core.pager2=sh log' },
    ] });
    check('gitkey-pagerx-deny', isDenied(responses[1], '外部进程派生参数'));
    check('gitkey-pager2-deny', isDenied(responses[2], '外部进程派生参数'));
    cleanup(); cleanDir(tmp);
  }

  // —— 前置环境变量赋值面 ——
  //   已实跑：`GIT_PAGER=sh git log` / `PAGER=sh git log` / `GIT_EXTERNAL_DIFF=sh git diff`
  //   / `BASH_ENV=x sh -c true` 全属闸前逃逸形态。前置 VAR=VAL 赋值可绕过参数面闸。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-envinject-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'GIT_PAGER=sh git log' },
      { id: 2, exec: 'PAGER=sh git log' },
      { id: 3, exec: 'GIT_EXTERNAL_DIFF=sh git diff' },
      { id: 4, exec: 'BASH_ENV=x sh -c true' },
      // 负向基准
      { id: 5, exec: 'git status -s' },
    ] });
    check('envinject-gitpager-deny', isDenied(responses[1], '前置环境变量赋值'));
    check('envinject-pager-deny', isDenied(responses[2], '前置环境变量赋值'));
    check('envinject-extdiff-deny', isDenied(responses[3], '前置环境变量赋值'));
    check('envinvoke-bashenv-deny', isDenied(responses[4], '前置环境变量赋值'));
    check('envinject-status-s-allow-kept', responses[5] && !responses[5].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— git 别名执行面 ——
  //   已实跑：`git config alias.x` 可写入 `!cmd` 别名，之后 `git x`
  //   即任意命令通道。alias 子命令属配置写操作，须拦。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gitalias-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'git config alias.x' },
      { id: 2, exec: 'git config --global alias.evil' },
      // 负向基准
      { id: 3, exec: 'git status -s' },
    ] });
    check('gitalias-config-alias-deny', isDenied(responses[1], '黑名单拒绝'));
    check('gitalias-config-global-deny', isDenied(responses[2], '黑名单拒绝'));
    check('gitalias-status-s-allow-kept', responses[3] && !responses[3].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 假拒绝普查（新闸的负向基准护栏）——
  //   为什么需要整块：多个闸放宽了判定面，只给逐个闸配 1~2 条负向基准，
  //   挡不住跨闸的组合误伤。故把"常用合法只读取证与测试命令"整批固化，
  //   任何一条被拒即代表引入假拒绝——这是防"为封漏洞而把工具变成不可用"的总闸。
  //   灰区样本（git config 只读族 / 紧贴式 -c 良性键）在恒 plan 档下本就会被模式闸拒，
  //   不纳入本块（其"非假拒绝"属性由白名单语义保证，不属本块取证范围）。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-falsereject-'));
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\nseed2\n');
    const legal = [
      'git status', 'git status -s', 'git status --short', 'git log --oneline -5', 'git log -n 3',
      'git diff', 'git diff --stat', 'git show HEAD', 'git show --stat', 'git branch -a',
      'git tag', 'git tag -l', 'git rev-parse HEAD', 'git ls-files', 'git blame README.md',
      'ls', 'ls -o', 'ls -la', 'cat README.md', 'cat seed.txt', 'head -5 seed.txt', 'tail -3 seed.txt',
      'wc -l seed.txt', 'pwd', 'date', 'whoami', 'grep -c seed seed.txt', 'grep seed seed.txt',
      'git grep -n seed', 'npm test', 'npm test --prefix mcp', 'python -m pytest', 'pytest tests/',
      'git log --format="%h; %s"',
      'where.exe git', 'rg -n pattern', 'git shortlog', 'git describe', 'git merge-base a b',
    ];
    const actions = [];
    legal.forEach((c, i) => actions.push({ id: i + 1, exec: c }));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 180000, actions });
    const blocked = [];
    legal.forEach((c, i) => { if (responses[i + 1] && responses[i + 1].isError) blocked.push(c); });
    check('falsereject-legal-all-allow', blocked.length === 0, blocked.length ? 'blocked: ' + blocked.join(' | ') : '');
    cleanup(); cleanDir(tmp);
  }

  // —— PR#1 整改：git branch 精确白名单 + pwsh 子表达式/脚本块/包裹构造闸（离线裁决，零派生进程）——
  //   应拦样本一律走 gov.auditCommand 纯函数（与闸 3.8 块「铁律·与设钟族同条」同口径）：
  //   `get-content "abc\" (remove-item x)` 类载荷判据回归时绝不允许被真实派发。
  {
    const { createRequire } = await import('module');
    const gov = createRequire(SERVER)(SERVER);
    const branchWrite = ['git branch -v probe-created', 'git branch -vv probe-created', 'git branch newbranch', 'git branch -d old', 'git branch -m a b', 'git branch --list -v'];
    const branchRead = ['git branch', 'git branch -a', 'git branch -r', 'git branch -v', 'git branch -vv', 'git branch -a -v', 'git branch --all', 'git branch --list', 'git branch --show-current'];
    const bLeaks = branchWrite.filter((c) => gov.auditCommand(c).ok !== false);
    check('gitbranch-exact-write-all-deny', bLeaks.length === 0, bLeaks.length ? 'leaked: ' + bLeaks.join(' | ') : '');
    const bFalse = branchRead.filter((c) => gov.auditCommand(c).ok !== true);
    check('gitbranch-exact-read-all-allow', bFalse.length === 0, bFalse.length ? 'blocked: ' + bFalse.join(' | ') : '');
    const pwshPayloads = [
      'get-childitem (remove-item -Recurse -Force src)',
      'get-childitem | get-content -Path { remove-item x }',
      'get-itemproperty @{ Expression = { remove-item x } } file',
      'get-content (new-item -ItemType File oops.txt)',
      'get-content "abc\\" (remove-item x)',
      'get-childitem @(\'x\')',
    ];
    const pLeaks = pwshPayloads.filter((c) => gov.auditCommand(c).ok !== false);
    check('pwsh-subexpr-scriptblock-deny', pLeaks.length === 0, pLeaks.length ? 'leaked: ' + pLeaks.join(' | ') : '');
    // 智能引号视图-执行分叉：pwsh 词法把 U+2018/2019/201A/201B（单引号族）与 U+201C/201D/201E
    //   （双引号族）视为与 ASCII 引号互换、可混合开闭的定界符（lang spec ch.02/15；
    //   CharTraits.cs::IsSingleQuote/IsDoubleQuote），而 maskPwshQuotedRegions 只建模 ASCII
    //   ⇒ 引号视图与执行视图分叉，( ) 在掩码视图隐身却在 pwsh 成活子表达式。一律 \u 转义构造，源码零裸贴。
    const SQ = { s18: '\u2018', s19: '\u2019', s1A: '\u201A', s1B: '\u201B', d1C: '\u201C', d1D: '\u201D', d1E: '\u201E' };
    const smartQuotePayloads = [
      'get-childitem "safe' + SQ.d1D + ' (remove-item -Recurse -Force src)' + SQ.d1C + '"',
      'get-childitem ' + SQ.d1E + 'safe" (remove-item x)',
      "get-childitem 'safe" + SQ.s19 + ' (remove-item x)' + SQ.s18 + "'",
      'get-childitem ' + SQ.s1B + "safe' (remove-item x)",
      "get-childitem 'safe" + SQ.s1A + " (remove-item x)'",
      'get-content "a' + SQ.d1D + ' (new-item oops) ' + SQ.d1C + 'b"',
    ];
    const sqLeaks = smartQuotePayloads.filter((c) => gov.auditCommand(c).ok !== false);
    check('pwsh-smartquote-deny', sqLeaks.length === 0, sqLeaks.length ? 'leaked: ' + sqLeaks.map((c) => JSON.stringify(c)).join(' | ') : '');
    const attrVerdict = gov.auditCommand('get-childitem (remove-item x)');
    check('pwsh-gate-attribution',
      attrVerdict.ok === false && String(attrVerdict.reason).includes('结构闸拦截') && String(attrVerdict.reason).includes('pwsh'),
      'reason=' + String(attrVerdict.reason).slice(0, 60));
    const pwshKept = [
      'get-childitem',
      'test-path seed.txt',
      'get-childitem seed.txt | measure-object',
      "select-string 'a(b' seed.txt",
      'get-content "file(1).txt"',
      'get-childitem ".\\sub\\"',
    ];
    const pFalse = pwshKept.filter((c) => gov.auditCommand(c).ok !== true);
    check('pwsh-plain-cmdlet-allow-kept', pFalse.length === 0, pFalse.length ? 'blocked: ' + pFalse.join(' | ') : '');
  }

  // —— 放行命令的落地退出码断言（isError 单维会掩盖"放行但落地 127/128"）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exitcode-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git -c user.name=p -c user.email=p@x commit -q --allow-empty -m init', { cwd: tmp });
    const sess = await runSession({ role: 'main', workdir: tmp, envExtra: { MCP_AUDIT_LOG: '1' }, actions: [
      { id: 1, exec: 'git status' },
      { id: 2, exec: 'git log --oneline -1' },
    ] });
    const auditFile = path.join(sess.home, '.config', 'kilo', 'governor-audit.jsonl');
    const recs = fs.existsSync(auditFile)
      ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
    const landed0 = recs.filter((r) => r.event === 'exec_result' && r.allowed === true && r.exitCode === 0);
    check('exitcode-allowed-lands-zero', landed0.length === 2, 'got=' + landed0.length);
    sess.cleanup(); cleanDir(tmp);
  }

  // —— 闸 3.8 回归——跨工作区路径判定 ——
  // 【铁律·与设钟族同条】"应拦"样本一律走离线裁决，绝不经 runSession 派发。
  //   本组样本里有 `cat "C:\Users\1\.ssh\id_rsa"` 与读 policy-key 的 node -e：
  //   判据一旦回归，"证明它该被拦"的用例自己就会把私钥/密钥读进测试输出（曾
  //   实测证伪过这条通路——紧贴式实参当时整组漏判并真实执行）。
  //   auditCommand() 是派发所调用的同一纯函数，离线调用不派生进程：漏判的最坏后果
  //   被压回"断言变红"。"应放"样本仍走活体派发，取真实协议证据（均为区内只读命令）。
  {
    const canaryOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pathdomain-canary-'));
    fs.writeFileSync(path.join(canaryOutside, 'sentinel.txt'), 'keep\n');
    // 必须全部 DENY（允许由 3.8 或更靠前的既有闸短路拦截——后者是既定语义，不是缺陷）
    const denyCases = [
      'ls C:/', 'ls C:', 'cat C:/Windows/win.ini', 'ls C:\\Users\\1\\.ssh',
      'cat "C:\\Users\\1\\.ssh\\id_rsa"', "cat 'C:\\Users\\1\\.ssh\\id_rsa'",
      'cat C:\\x', 'head -5 D:/x.txt', 'ls /etc', 'cat /etc/passwd', 'ls /',
      'find / -name x', 'cat ../../package.json', 'cat ..\\package.json',
      'cd .. && cat package.json', 'cd .. && cd .. && cd .. && cd .. && cat package.json',
      'tar -C / -xz', 'cat //server/share/x',
      `node -e "require('fs').readFileSync('C:/Users/1/.config/kilo/policy-key')"`,
      'cat <C:/Windows/win.ini', 'echo hi > ../../oops.txt', 'cd ..',
      'more +100 /etc/passwd', 'ls -la ../', 'grep x ../f',
      // 紧贴式选项实参：绝对路径藏在 token 中段（getopt 合法形态）
      'grep -fC:/Windows/win.ini /dev/null', 'git -CC:/Users/1 status', 'ls -oC:/Windows',
      'tar -f/etc/x', 'head -n1 /etc/passwd',
      // 钉住 quoteMask 的 `$`→`_` 占位符改动没有开出旁路：单引号包裹的区外绝对路径、
      //   以及"旗标紧贴引号内的绝对路径"仍须被拦（引号经 dequote 后与裸形态同视图）。
      "cat '/etc/passwd'", "grep -f'/etc/x' seed.txt",
    ];
    // 其中这三条只可能由 3.8 拦（前一版断言错在拿整张 denyCases 去要"跨区闸"理由，
    //   而 `find /` 命中禁入清单、`node -e` 命中黑名单，均被更靠前的闸短路 —— 属既定语义）
    const attributionCases = ['ls C:/', 'cat ..\\package.json', 'cd ..'];
    const { createRequire } = await import('module');
    const gov = createRequire(SERVER)(SERVER);
    const verdicts = denyCases.map((c) => gov.auditCommand(c));
    const leaked = denyCases.filter((c, i) => !(verdicts[i] && verdicts[i].ok === false));
    check('pathdomain-deny-all-blocked', leaked.length === 0, leaked.length ? 'leaked: ' + leaked.join(' | ') : '');
    const misattr = attributionCases.filter((c) => {
      const i = denyCases.indexOf(c);
      return !String(verdicts[i]?.reason || '').includes('跨区闸拦截');
    });
    check('pathdomain-gate-attribution', misattr.length === 0, misattr.length ? 'wrong gate: ' + misattr.join(' | ') : '');
    check('pathdomain-canary-untouched', fs.readFileSync(path.join(canaryOutside, 'sentinel.txt'), 'utf8') === 'keep\n');
    cleanDir(canaryOutside);
  }

  // 应放矩阵：区内只读命令不得被 3.8 误拒（活体派发，取真实协议证据；归因只看 3.8 闸署名）
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pathdomain-'));
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\n');
    const allowCases = [
      'ls', 'ls -o', 'ls .', 'cat seed.txt', 'echo x > /dev/null',
      'git status 2>&1', 'curl http://x/y', 'date +%s', 'date',
      'git show HEAD:README.md', 'echo 12:30', 'pytest tests/',
      // 误伤对照组（实跑撞到的形态）：单引号内 `-s$/.test(a)` 经 PD_SPLIT 剥引号后成 token
      //   `-s$/.test`，pdEmbedded 从首个 `/` 起取候选即误判区外路径 `/.test`。
      //   含 `/` 但非路径的载荷、以及含引号区段的 `-c "a/b"`，均不得被 3.8 拒。
      "git grep -n -F '-s$/.test(a)' -- mcp/plan-governor.js", 'grep -c "a/b" seed.txt',
      'grep -Ffoo/bar seed.txt', 'git grep -eHEAD:README.md',
      // 反向记录：单引号内的 `$` 改成占位符后不再造边界，`a$/.test/etc/passwd` 是【单个相对路径】
      //   （bash 单引号内不展开，实参原样传给 cat），不属区外引用。旧掩码把它切成
      //   `a$` + `/etc/passwd` 而"恰好拦对"，是依赖 bug 的假阳性，不得当防线固化。
      "cat 'a$/.test/etc/passwd'",
    ];
    const actions = [];
    allowCases.forEach((c, i) => actions.push({ id: i + 1, exec: c }));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 60000, actions });
    const falselyBlocked = allowCases.filter((c, i) => {
      const r = responses[i + 1];
      return r && r.isError && String(r.content?.[0]?.text || '').includes('跨区闸拦截');
    });
    check('pathdomain-allow-not-gated', falselyBlocked.length === 0, falselyBlocked.length ? 'blocked: ' + falselyBlocked.map((c) => c + ' ⟸ ' + String(responses[allowCases.indexOf(c) + 1]?.content?.[0]?.text || '').slice(0, 160)).join(' || ') : '');
    cleanup(); cleanDir(tmp);
  }

  // —— 闸 3.8 回归——驱动器相对路径（C:foo / C:Windows）——
  //   pdIsPathShape 此前只判 ^[a-z]:$ 与 ^[a-z]:[\\/]，C:Windows 形态（盘符后紧跟非分隔符）
  //   漏判。新增分支后这两条应转绿。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pathdomain-drive-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 30000, actions: [
      { id: 1, exec: 'ls C:Windows' },
      { id: 2, exec: 'ls C:Windows\\System32' },
    ] });
    check('pathdomain-drive-relative-deny', isDenied(responses[1], '跨区闸拦截'));
    check('pathdomain-drive-relative-nested-deny', isDenied(responses[2], '跨区闸拦截'));
    cleanup(); cleanDir(tmp);
  }

  // —— 闸 3.7 回归——时钟写入判定（读放行，设死拦） ——
  // 【铁律·不得放宽】设钟形态一律走【离线裁决】断言，绝不经 runSession 派发执行。
  //   `date -s…` 一类命令属"改写世界"动作：ALLOW_KEYS 含 `date*`，白名单直通道会把它
  //   送到 plan-governor.js 的 exec() 真实执行（实测已证：本机时钟被打到 2020-01-01、
  //   网络栈随之崩解）。判据一旦回归，"本该证明它被拦"的用例自己就是执行者。
  //   auditCommand() 正是派发所调用的同一个纯函数，离线调用不派生进程，
  //   因此不存在"漏判即执行"路径——这是本族用例的唯一合法形态。
  {
    const { createRequire } = await import('module');
    const gov = createRequire(SERVER)(SERVER);
    // 应拦：任意段出现设时钟形态即拒（管道/链式的任意段同样命中），且须由时钟闸署名
    const setterForms = [
      'date -s "2020-01-01"', 'date --set="2020-01-01"', 'date --set 2020-01-01',
      'date -s 2020', 'date 091707162026', 'date --se 2020', 'date -f /tmp/dates',
      // 紧贴实参形态（getopt 合法）；离线裁决覆盖
      'date -s2020-01-01', 'date -f/tmp/dates',
      'hwclock --set --date "12:00"', 'hwclock -w', 'hwclock --systohc', 'hwclock --hctosys',
      'timedatectl set-time 2020-01-01', 'timedatectl set-timezone Asia/Shanghai',
      'w32tm /config /manualpeer:x', 'w32tm /resync',
      'git status && date -s 2020', 'ls | date -s 2020',
      // 【只读白名单】默认即写：位置实参设值、缩写旗标等此前不在写清单上的形态，须一并按写拦。
      //   其中 `date --da` 是 GNU 合法唯一前缀缩写（= --date），按写拦属【刻意接受的误伤】。
      'date 2020-01-01', 'date 01/01/2020', 'date "2020-01-01 12:00"', 'date -s=2020',
      'date --da 2020', 'date --set', 'date -f -', 'date +%%F -s 2020',
    ];
    const verdicts = setterForms.map((c) => gov.auditCommand(c));
    const leaked = setterForms.filter((c, i) => !(verdicts[i] && verdicts[i].ok === false));
    check('clock-deny-all-blocked', leaked.length === 0, leaked.length ? 'leaked: ' + leaked.join(' | ') : '');
    // 归因：这三条不含任何其他闸的形态，只可能由时钟闸署名
    const attributionCases = ['date -s "2020-01-01"', 'hwclock --systohc', 'timedatectl set-time 2020-01-01'];
    const misattr = attributionCases.filter((c) => {
      const i = setterForms.indexOf(c);
      return !String(verdicts[i]?.reason || '').includes('时钟闸拦截');
    });
    check('clock-gate-attribution', misattr.length === 0, misattr.length ? 'wrong gate: ' + misattr.join(' | ') : '');
    // 只读白名单的正面样本：这些读形态不得被本闸拒（同样离线裁决，零派发）
    const readerForms = [
      'date', 'date -u', 'date --utc', 'date +%s', 'date +%Y-%m-%d', 'date -I', 'date -R',
      'date --iso-8601', 'date --version', 'date --help', 'date -d "2020-01-01" +%s',
      'date --date="2020-01-01" +%s', 'date -r package.json', 'hwclock --show', 'hwclock -r',
      'timedatectl status', 'w32tm /query /status',
    ];
    const misfired = readerForms.filter((c) => String(gov.auditCommand(c).reason || '').includes('时钟闸拦截'));
    check('clock-static-reader-not-gated', misfired.length === 0, misfired.length ? 'falsely gated: ' + misfired.join(' | ') : '');
  }

  // 读形态与其他无关命令不得被本闸误拒——这些命令无改写世界能力，仍走活体派发取真实协议证据
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-clock-'));
    const allowCases = [
      'date', 'date -u', 'date +%s', 'date +%Y-%m-%d', 'date -d "2020-01-01" +%s',
      'hwclock --show', 'hwclock -r', 'timedatectl status', 'w32tm /query /status',
      'git status', 'ls -o', 'Get-Date', 'date +%s | head -1',
    ];
    const actions = [];
    allowCases.forEach((c, i) => actions.push({ id: i + 1, exec: c }));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 60000, actions });
    const falselyBlocked = allowCases.filter((c, i) => {
      const r = responses[i + 1];
      return r && r.isError && String(r.content?.[0]?.text || '').includes('时钟闸拦截');
    });
    check('clock-allow-not-gated', falselyBlocked.length === 0, falselyBlocked.length ? 'blocked: ' + falselyBlocked.join(' | ') : '');
    cleanup(); cleanDir(tmp);
  }

  // —— 管道第二段命中新闸必须仍 DENY ——
  //   修复前：闸 0.5c/1.5/3.6 的正则以 ^\s* 锚 base 整串段首，管道第二段可绕过。
  //   修复后：三闸改逐段判定。本块锁死"管道任意段命中新闸即 deny"。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pipe-gap-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 30000, actions: [
      { id: 1, exec: 'git status | PAGER=sh git log' },
      { id: 2, exec: "git status | git config alias.x '!id'" },
      { id: 3, exec: 'git status | git -c core.pagerX=sh log' },
      // 既有正控：纯白名单管道必须仍放行（修复不得破坏唯一结构例外）
      { id: 4, exec: 'git log --oneline -5 | head -3' },
    ] });
    check('pipe-second-env-assign-deny', isDenied(responses[1], '前置环境变量赋值'));
    check('pipe-second-gitconfig-deny', isDenied(responses[2], 'git 配置写'));
    check('pipe-second-gitkey-deny', isDenied(responses[3], '外部进程派生参数'));
    check('pipe-whitelist-still-allow', responses[4] && !responses[4].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 转义引号不开启引用区 ——
  //   修复前：maskQuotedRegions 把引号外的 \" 当引用开边界，其间通配符被屏蔽，
  //   `echo \"*\"` 绕过闸 0.5b（bash 执行视图该 * 是未引用的，会真实展开）。
  //   修复后：引号外 \X 逐字复制（与 quoteMask 状态机对齐），* 落在引号外视图 ⇒ 拒。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-escquote-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'echo \\\"*\\\"' },
      // 双引号内 \" 不闭合引用：其后 * 仍属引用区 ⇒ 不触发展开闸（bash 语义一致）
      { id: 2, exec: 'find . -name "x\\"y*"' },
      // 负向基准：普通引号内通配符仍放行路径（find 本身在禁入清单，用 grep 替代取证展开豁免）
      { id: 3, exec: 'grep -c "s*d" seed.txt' },
    ] });
    check('escquote-outside-deny', isDenied(responses[1], '展开构造'));
    check('escquote-inside-kept-nonexpand', responses[2] && !isDenied(responses[2], '展开构造'));
    check('escquote-normal-quoted-allow', responses[3] && !responses[3].isError);
    cleanup(); cleanDir(tmp);
  }

  // —— 沙箱路径护栏——串内盘符兜底扫描（离线纯函数，零派生）——
  {
    const { createRequire } = await import('module');
    const gov = createRequire(SERVER)(SERVER);
    const esc = gov.sandboxEscape;
    // 串内盘符：剥引号后 token 以代码开头，token 锚定漏判，须由整串扫描兜底
    const inString = esc(`node -e "console.log(require('fs').readFileSync('D:/x'))"`);
    check('sandbox-esc-instring-drive-blocked', inString.length > 0 && inString.some((h) => h.includes('D:/')), JSON.stringify(inString));
    // T: 豁免在整串扫描中同样生效
    const inStringT = esc(`node -e "console.log(require('fs').readFileSync('T:/x'))"`);
    check('sandbox-esc-instring-t-allowed', inStringT.length === 0, JSON.stringify(inStringT));
    // URL 字面量含盘符字样须豁免（先剥 URL 再扫描，http(s) 的 "s:/" 不假命中）
    const urlCase = esc('git clone https://host.example/C:/repo.git');
    check('sandbox-esc-url-drive-allowed', urlCase.length === 0, JSON.stringify(urlCase));
    // 既有形态零回归：token 开头盘符仍拦、`a:b` 类文本不误伤
    const tokenStart = esc('cat D:/x.txt');
    check('sandbox-esc-token-start-kept', tokenStart.length > 0);
    const plainText = esc('echo a:b');
    // 现状锁定：既有 token 锚定（^[A-Za-z]: 无分隔符要求）本就把盘符相对形态 a:b 判为命中；
    //   整串兜底扫描要求盘符后跟分隔符，不得额外扩大该命中面（hits 仅含既有 token 命中 a:b）
    check('sandbox-esc-plain-text-kept-existing', plainText.length === 1 && plainText[0] === 'a:b', JSON.stringify(plainText));

    // 护栏归因（零副作用，两层各锁一件事）：
    //   (1) 武装面：`subst T: /D` 同时命中销毁护栏正则与路径护栏根规则，故"两道都该拦"；
    //   (2) 顺序面：sandboxExec 内销毁护栏必须先于挂载与路径护栏判定。顺序若被对调，
    //       该命令会先经 ensureVirtualDrive 真实挂载 T: 再被 path_guard 抢先归因——
    //       拦截过程即产生机器全局副作用，且归因从 destroy_guard 漂移为 path_guard。
    //   端到端复核由 sandbox-probe 的 h-destroy-exec-blocks-subst 承担。
    const ambiguous = 'subst T: /D';
    check('sandbox-guard-both-armed-subst-d',
      !!gov.sandboxDestroyHit(ambiguous) && gov.sandboxEscape(ambiguous).length > 0,
      'destroyHit=' + !!gov.sandboxDestroyHit(ambiguous) + ' escape=' + JSON.stringify(gov.sandboxEscape(ambiguous)));
    // 顺序面以源码位置序断言：本用例不执行 sandboxExec，故零 IO、零挂载。
    const srcText = fs.readFileSync(SERVER, 'utf8');
    const execStart = srcText.indexOf('function sandboxExec(');
    const iDestroy = srcText.indexOf('sandboxDestroyHit(command)', execStart);
    const iMount = srcText.indexOf('= ensureVirtualDrive()', execStart);
    const iEscape = srcText.indexOf('sandboxEscape(command)', execStart);
    check('sandbox-guard-attribution-destroy-first',
      execStart > 0 && iDestroy > execStart && iDestroy < iMount && iMount < iEscape,
      'fn=' + execStart + ' destroy=' + iDestroy + ' mount=' + iMount + ' escape=' + iEscape);
    // 展开构造闸：销毁护栏与路径护栏都是词法判定，对 ANSI-C 引号与参数展开形态同时失明。
    //   新闸置于挂载之前，故本用例走的是纯拒答路径（零 IO、零 T: 挂载）。
    const expandAnsiC = await gov.sandboxExec("subst T: $'\\057D'");
    check('sandbox-expand-guard-ansi-c-deny',
      expandAnsiC && expandAnsiC.ok === false && expandAnsiC.gateType === 'sandbox_expand_guard',
      JSON.stringify(expandAnsiC).slice(0, 120));
    const expandAssign = await gov.sandboxExec('D=/D subst T: $D');
    check('sandbox-expand-guard-env-assign-deny',
      expandAssign && expandAssign.ok === false && expandAssign.gateType === 'sandbox_expand_guard',
      JSON.stringify(expandAssign).slice(0, 120));
    // 泛化销毁形：不再依赖 /d 字面量；同时锁定"引号包裹的 /D"与"建挂"两族落网。
    check('sandbox-destroy-broad-subst-quoted-slash-d',
      !!gov.sandboxDestroyHit('subst T: "/D"'), String(gov.sandboxDestroyHit('subst T: "/D"')));
    check('sandbox-destroy-broad-subst-remount-other-drive',
      !!gov.sandboxDestroyHit('subst X: C:\\tools'), String(gov.sandboxDestroyHit('subst X: C:\\tools')));
    // 销毁正则表规模与首位专形锁定：长度或顺序漂移即转红（此前仅锁 isArray，扩条不红）。
    //   `[0]` 必须是 `/d` 专形：sandboxDestroyHit 按数组顺序取首个命中，专形居首是
    //   `subst T: /D` 归因串不因泛形而漂移这一口径的前提。新增正则须同步该期望值。
    const dp = gov.SANDBOX_DESTROY_PATTERNS;
    check('sandbox-destroy-patterns-length', dp.length === 6, 'len=' + dp.length);
    check('sandbox-destroy-patterns-first-is-slash-d',
      /\/d/.test(String(dp[0] && dp[0].source)), 'first=' + String(dp && dp[0] && dp[0].source));

    // —— git 隐式 diff 派生防御——exec 前自动追加 --no-ext-diff --no-textconv（离线纯函数）——
    const harden = gov.hardenGitDiffCommand;
    const h1 = harden('git diff --stat');
    check('githarden-diff-appends-both', h1 === 'git diff --no-ext-diff --no-textconv --stat', h1);
    const h2 = harden('git diff --no-ext-diff --stat');
    check('githarden-dedup-extdiff', h2 === 'git diff --no-textconv --no-ext-diff --stat', h2);
    const h3 = harden('git status');
    check('githarden-status-untouched', h3 === 'git status', h3);
    const h4 = harden('git log -5');
    check('githarden-log-appends-both', h4 === 'git log --no-ext-diff --no-textconv -5', h4);
    const h5 = harden('git show HEAD');
    check('githarden-show-appends-both', h5 === 'git show --no-ext-diff --no-textconv HEAD', h5);
    const h6 = harden('git diff --stat | head -5');
    check('githarden-pipe-first-segment-only', h6 === 'git diff --no-ext-diff --no-textconv --stat | head -5', h6);
    const h7 = harden('git log --grep="a|b"');
    check('githarden-quoted-pipe-safe', h7 === 'git log --no-ext-diff --no-textconv --grep="a|b"', h7);
    const h8 = harden('git grep xyzzy-probe');
    check('githarden-grep-appends-both', h8 === 'git grep --no-textconv --no-open-files-in-pager xyzzy-probe', h8);
    const h9 = harden('git grep --no-textconv xyzzy');
    check('githarden-grep-dedup-textconv', h9 === 'git grep --no-open-files-in-pager --no-textconv xyzzy', h9);
    const h10 = harden('git grep xyzzy | head -5');
    check('githarden-grep-pipe-second-kept', h10 === 'git grep --no-textconv --no-open-files-in-pager xyzzy | head -5', h10);
    const h11 = harden('git status');
    check('githarden-grep-status-untouched', h11 === 'git status', h11);
  }

  // —— 沙箱双工具角色门禁（协议层；替代不宜常规化的 probe:sandbox 门禁回归）——
  //   门禁先于任何 IO 与参数解析：subagent 调用沙箱执行/复制通道一律拒绝。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sbxrole-'));
    const sess = await runSession({ role: 'subagent', workdir: tmp, actions: [
      { id: 1, tool: 'exec_sandboxed_command', args: { command: 'echo hi' } },
      { id: 2, tool: 'copy_into_sandbox', args: { paths: ['seed.txt'] } },
    ] });
    check('sandbox-role-subagent-exec-deny', isDenied(sess.responses[1], 'subagent 实例不得经本通道执行高危命令'), String(sess.responses[1]?.content?.[0]?.text || '').slice(0, 80));
    check('sandbox-role-subagent-copy-deny', isDenied(sess.responses[2], 'subagent 实例不得经本通道复制文件'), String(sess.responses[2]?.content?.[0]?.text || '').slice(0, 80));
    // 协议级不变量：subagent 被拒会话中服务端未主动发起任何请求（无自动沙盒升级）
    check('sandbox-role-subagent-no-server-requests', sess.serverRequests.length === 0, JSON.stringify(sess.serverRequests.map((m) => m.method)));
    sess.cleanup(); cleanDir(tmp);
  }

  // —— 拒绝回执与角色分流话术断言（回执文本逐字锁定；收缩版不改任何执法逻辑）——
  //   含沙箱引导四类：黑名单(裸 rm / git 配置写)、禁入清单、跨区闸——回执须含 exec_sandboxed_command 引导；
  //   结构闸与时钟闸回执分别以 [结构闸拦截] / [时钟闸拦截] 署名（无沙箱引导，收缩版不新增）。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-receipt-'));
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\n');
    const sess = await runSession({ role: 'main', workdir: tmp, timeoutMs: 20000, actions: [
      { id: 1, exec: 'rm -rf foo' },
      { id: 2, exec: 'git config alias.x "!id"' },
      { id: 3, exec: 'sort seed.txt' },
      { id: 4, exec: 'ls C:/' },
      { id: 5, exec: 'date -s "2020-01-01 00:00:00"' },
      { id: 6, exec: 'git status; ls' },
    ] });
    const t = (i) => String(sess.responses[i]?.content?.[0]?.text || '');
    const hasSbx = (i) => t(i).includes('exec_sandboxed_command');
    check('receipt-blacklist-rm', t(1).startsWith('[黑名单拒绝]') && hasSbx(1), t(1).slice(0, 100));
    check('receipt-blacklist-gitconfig', t(2).startsWith('[黑名单拒绝]') && hasSbx(2), t(2).slice(0, 100));
    check('receipt-forbidden', t(3).startsWith('[禁入清单拒绝]') && hasSbx(3), t(3).slice(0, 100));
    check('receipt-pathdomain', t(4).startsWith('[跨区闸拦截]') && hasSbx(4), t(4).slice(0, 100));
    check('receipt-clock', t(5).startsWith('[时钟闸拦截]'), t(5).slice(0, 100));
    check('receipt-structure', t(6).startsWith('[结构闸拦截]'), t(6).slice(0, 100));
    // 协议级不变量：主通道拒绝会话中服务端零主动请求——拒绝不自动升级到沙盒调用/复制
    check('receipt-rejection-no-server-requests', sess.serverRequests.length === 0, JSON.stringify(sess.serverRequests.map((m) => m.method)));
    sess.cleanup(); cleanDir(tmp);
  }

  //   灰区分叉互斥：main 收 [模式闸拦截]，subagent 收 [子代理越权阻断]；两话术均不含沙箱引导。
  {
    const tmpM = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gray-main-'));
    const m = await runSession({ role: 'main', workdir: tmpM, actions: [{ id: 1, exec: 'echo hello' }] });
    const mt = String(m.responses[1]?.content?.[0]?.text || '');
    check('receipt-gray-main-modegate', mt.includes('[模式闸拦截') && !mt.includes('子代理越权阻断') && !mt.includes('exec_sandboxed_command'), mt.slice(0, 100));
    m.cleanup(); cleanDir(tmpM);

    const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gray-sub-'));
    const s = await runSession({ role: 'subagent', workdir: tmpS, actions: [{ id: 1, exec: 'echo hello' }] });
    const st = String(s.responses[1]?.content?.[0]?.text || '');
    check('receipt-gray-subagent-rbac', st.includes('[子代理越权阻断]') && !st.includes('模式闸拦截') && !st.includes('exec_sandboxed_command'), st.slice(0, 100));
    s.cleanup(); cleanDir(tmpS);
  }

  // —— 策略文件 HMAC 验签与键合并（回退出厂基线取证）——
  //   规范串 = ['governor-policy',1,sortedAllow,sortedDeny]；验签失败/损坏一律回退基线并 stderr 告警。
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-policy-'));
    const polSig = (allow, deny) => crypto.createHmac('sha256', KEY)
      .update(JSON.stringify(['governor-policy', 1, [...allow].sort(), [...deny].sort()])).digest('hex');
    // ① 有效签名：customAllow 释放灰区（node --version 不在出厂白名单）；customDeny 覆盖出厂 allow 键
    const sessPolicy = await runSession({
      role: 'main', workdir: tmp,
      homePrep: (home) => fs.writeFileSync(path.join(home, '.config', 'kilo', 'governor-policy.json'),
        JSON.stringify({ customAllow: ['node --version*'], customDeny: ['git status*'], sig: polSig(['node --version*'], ['git status*']) })),
      actions: [
        { id: 1, exec: 'node --version' },
        { id: 2, exec: 'git status' },
      ],
    });
    check('policy-customallow-gray-release', sessPolicy.responses[1] && !sessPolicy.responses[1].isError, String(sessPolicy.responses[1]?.content?.[0]?.text || '').slice(0, 100));
    check('policy-customdeny-overrides-factory', isDenied(sessPolicy.responses[2], '黑名单拒绝'), String(sessPolicy.responses[2]?.content?.[0]?.text || '').slice(0, 100));
    sessPolicy.cleanup();

    // ② 篡改必拒：内容与签名不对应 → 整份策略作废回退出厂基线（灰区恢复拒绝、被覆盖键恢复放行）+ stderr 告警
    const sessTamper = await runSession({
      role: 'main', workdir: tmp,
      homePrep: (home) => fs.writeFileSync(path.join(home, '.config', 'kilo', 'governor-policy.json'),
        JSON.stringify({ customAllow: ['node --version*'], customDeny: [], sig: polSig(['node --version*'], ['evil*']) })),
      actions: [
        { id: 1, exec: 'node --version' },
        { id: 2, exec: 'git status' },
      ],
    });
    check('policy-tamper-gray-back-to-deny', isDenied(sessTamper.responses[1], '模式闸拦截'), String(sessTamper.responses[1]?.content?.[0]?.text || '').slice(0, 100));
    check('policy-tamper-factory-allow-restored', sessTamper.responses[2] && !sessTamper.responses[2].isError);
    check('policy-tamper-stderr-alert', sessTamper.stderr.includes('POLICY-FAIL') && sessTamper.stderr.includes('签名校验失败'));
    sessTamper.cleanup();
    cleanDir(tmp);
  }

  // —— 审计流 opt-in 冒烟（MCP_AUDIT_LOG=1；默认关闭守住零写入不变式）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-'));
    const sess = await runSession({ role: 'main', workdir: tmp, envExtra: { MCP_AUDIT_LOG: '1' }, actions: [
      { id: 1, exec: 'pwd' },
      { id: 2, exec: 'echo denied' },
    ] });
    const auditFile = path.join(sess.home, '.config', 'kilo', 'governor-audit.jsonl');
    const auditExists = fs.existsSync(auditFile);
    check('audit-optin-file-exists', auditExists);
    if (auditExists) {
      const records = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      check('audit-optin-verdict-deny', records.some((r) => r.event === 'audit_verdict' && r.allowed === false));
      check('audit-optin-exec-allow', records.some((r) => r.event === 'exec_result' && r.allowed === true && r.exitCode === 0));
    }
    sess.cleanup(); cleanDir(tmp);

    const tmpOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-audit-off-'));
    const sessOff = await runSession({ role: 'main', workdir: tmpOff, actions: [{ id: 1, exec: 'git status' }] });
    check('audit-default-off-no-file', !fs.existsSync(path.join(sessOff.home, '.config', 'kilo', 'governor-audit.jsonl')));
    sessOff.cleanup(); cleanDir(tmpOff);
  }

  // —— 安全沙箱越权拦截 + 写工具蜜罐引导闸与受控写面、零文件系统写入 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-safe-'));
    // main 调用 write_plan → 引导话术（含子代理与 write_scoped_file）+ stderr 留痕
    const sessPlan = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, exec: 'git status', extra: { workdir: '../outside' } },
      { id: 2, tool: 'write_plan', args: { filename: 'test-plan.md', content: 'plan v1' } },
    ] });
    check('safe-workdir-escape-deny', isDenied(sessPlan.responses[1], '工作区越权'));
    check('honeypot-main-plan-deny', isDenied(sessPlan.responses[2], '引导闸·蜜罐') &&
      sessPlan.responses[2].content[0].text.includes('plan-writer 子代理') &&
      sessPlan.responses[2].content[0].text.includes('write_scoped_file'));
    check('honeypot-main-plan-stderr', sessPlan.stderr.includes('HONEYPOT-HIT') && sessPlan.stderr.includes('tool=write_plan'));
    sessPlan.cleanup(); cleanDir(tmp);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-honeypot-stderr-'));
    // main 调用 write_review_report → 恒定 plan 引导回执 + stderr 留痕
    const sessMain = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, tool: 'write_review_report', args: { filename: 'rev.md', content: 'c' } }
    ] });
    check('honeypot-main-stderr-trace', sessMain.stderr.includes('HONEYPOT-HIT') && sessMain.stderr.includes('tool=write_review_report'));
    sessMain.cleanup(); cleanDir(tmp);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-honeypot-sub-'));
    // subagent 角色调用 write_pr_review_report → subagent 恒拒
    const sessSub = await runSession({ role: 'subagent', workdir: tmp, actions: [
      { id: 1, tool: 'write_pr_review_report', args: { filename: 'pr.md', content: 'c' } }
    ] });
    check('honeypot-subagent-deny', isDenied(sessSub.responses[1], 'subagent 实例不可调用写工具'));
    check('honeypot-subagent-stderr', sessSub.stderr.includes('HONEYPOT-HIT') && sessSub.stderr.includes('role=subagent'));
    sessSub.cleanup(); cleanDir(tmp);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-honeypot-missing-'));
    // main 角色调用 write_plan → 恒按 plan 走引导话术（本用例锁定话术形态）
    const sessMissing = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, tool: 'write_plan', args: { filename: 'test.md', content: 'c' } }
    ] });
    check('honeypot-missing-failclosed-deny', isDenied(sessMissing.responses[1], '引导闸·蜜罐') &&
      sessMissing.responses[1].content[0].text.includes('plan-writer 子代理'));
    sessMissing.cleanup(); cleanDir(tmp);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-honeypot-list-'));
    // tools/list 形状：无 read_plan_artifact / list_plan_artifacts，三写工具在场
    // 零文件系统写入：调用后 tmp 目录下绝不存在 .kilo 目录
    const sessList = await runSession({ role: 'main', workdir: tmp, actions: [
      { listTools: true, id: 1 },
      { id: 2, tool: 'write_plan', args: { filename: 'p.md', content: 'c' } }
    ] });
    const tools = sessList.responses[1]?.tools || [];
    const toolNames = tools.map((t) => t.name);
    check('honeypot-tools-list-shape',
      toolNames.includes('exec_guarded_command') &&
      toolNames.includes('write_plan') &&
      toolNames.includes('write_review_report') &&
      toolNames.includes('write_pr_review_report') &&
      !toolNames.includes('read_plan_artifact') &&
      !toolNames.includes('list_plan_artifacts'));
    // 工具总数须锁定：README 曾长期写「4 个」而实注册 6 个，缺少总数断言使计数漂移无告警。
    check('honeypot-tools-list-count', toolNames.length === 7 && toolNames.includes('write_scoped_file'), 'got=' + toolNames.length);
    check('honeypot-tools-sandbox-present',
      toolNames.includes('exec_sandboxed_command') && toolNames.includes('copy_into_sandbox'));
    // 作用域：本 session 仅 tools/list 与蜜罐 write_plan（恒拒不落盘），断言不涉及真实写面；server 非全量零写入（见 mcp/README「零写入」节与 write_scoped_file）。
    check('honeypot-zero-filesystem-write', !fs.existsSync(path.join(tmp, '.kilo')));
    sessList.cleanup(); cleanDir(tmp);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-write-'));
    // write_scoped_file 的 fail-closed 路——JS harness 不注入 params._meta.runtime_scope，
    // 故任何调用都应被拒（放行路需 ZCode 宿主注入 subagent 信号，端到端冒烟另验）。
    const sessScoped = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, tool: 'write_scoped_file', args: { filename: 'probe-scoped.md', content: '# probe' } },
    ] });
    check('write-scoped-file-no-meta-deny', isDenied(sessScoped.responses[1], '主代理/未知调用方不得直接写计划文件'));
    check('write-scoped-file-no-meta-no-artifact', !fs.existsSync(path.join(tmp, '.kilo')));
    sessScoped.cleanup(); cleanDir(tmp);
  }

  // —— write_scoped_file 成功路 + 5 类逃逸变体（注入 _meta.runtime_scope=subagent）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-success-'));
    const meta = { runtime_scope: 'subagent' };
    const sess = await runSession({ role: 'main', workdir: tmp, envExtra: { MCP_AUDIT_LOG: '1' }, actions: [
      { id: 1, tool: 'write_scoped_file', args: { filename: 'probe-ok.md', content: '# ok' }, meta },
      { id: 2, tool: 'write_scoped_file', args: { filename: '../escape.md', content: 'x' }, meta },
      { id: 3, tool: 'write_scoped_file', args: { filename: 'C:/abs.md', content: 'x' }, meta },
      { id: 4, tool: 'write_scoped_file', args: { filename: 'bad.txt', content: 'x' }, meta },
      { id: 5, tool: 'write_scoped_file', args: { filename: 'big.md', content: 'x'.repeat(262145) }, meta },
      { id: 6, tool: 'write_scoped_file', args: { filename: 'sub/dir/nested.md', content: '# n' }, meta },
    ] });
    check('write-scoped-success-writes', !sess.responses[1].isError && fs.existsSync(path.join(tmp, '.kilo', 'plans', 'probe-ok.md')));
    check('write-scoped-escape-deny', sess.responses[2] && sess.responses[2].isError);
    check('write-scoped-drive-deny', sess.responses[3] && sess.responses[3].isError);
    check('write-scoped-nonext-deny', sess.responses[4] && sess.responses[4].isError);
    check('write-scoped-oversize-deny', sess.responses[5] && sess.responses[5].isError);
    check('write-scoped-nested-ok', !sess.responses[6].isError && fs.existsSync(path.join(tmp, '.kilo', 'plans', 'sub', 'dir', 'nested.md')));
    const scopedAuditFile = path.join(sess.home, '.config', 'kilo', 'governor-audit.jsonl');
    const scopedRecs = fs.existsSync(scopedAuditFile) ? fs.readFileSync(scopedAuditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    check('write-scoped-audit-recorded', scopedRecs.some((r) => r.event === 'scoped_write' && r.allowed === true));
    sess.cleanup(); cleanDir(tmp);
  }

  // —— write_scoped_file 符号链接逃逸拒（realpath 二次判定）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-out-'));
    const plansDir = path.join(tmp, '.kilo', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    let linked = false;
    try { fs.symlinkSync(outside, path.join(plansDir, 'link'), 'junction'); linked = true; } catch { /* 无权限环境降级跳过 */ }
    if (linked) {
      const sess = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, tool: 'write_scoped_file', args: { filename: 'link/x.md', content: 'x' }, meta: { runtime_scope: 'subagent' } },
      ] });
      check('write-scoped-symlink-escape-deny', sess.responses[1] && sess.responses[1].isError);
      sess.cleanup();
    } else {
      console.log('SKIP write-scoped-symlink-escape-deny (junction unavailable)');
    }
    cleanDir(tmp); cleanDir(outside);
  }

  // —— write_scoped_file 目标文件自身为符号链接时阻断 ——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-filelink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-fileout-'));
    const plansDir = path.join(tmp, '.kilo', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    const targetFile = path.join(plansDir, 'target.md');
    const outsideFile = path.join(outside, 'secret.txt');
    fs.writeFileSync(outsideFile, 'original', 'utf8');
    let linked = false;
    try { fs.symlinkSync(outsideFile, targetFile, 'file'); linked = true; } catch { /* 无权限环境降级跳过 */ }
    if (linked) {
      const sess = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, tool: 'write_scoped_file', args: { filename: 'target.md', content: 'hacked' }, meta: { runtime_scope: 'subagent' } },
      ] });
      check('write-scoped-file-symlink-deny', sess.responses[1] && sess.responses[1].isError);
      check('write-scoped-file-symlink-unmodified', fs.readFileSync(outsideFile, 'utf8') === 'original');
      sess.cleanup();
    } else {
      console.log('SKIP write-scoped-file-symlink-deny (file symlink unavailable)');
    }
    cleanDir(tmp); cleanDir(outside);
  }

  // —— write_scoped_file 链接盲区①：.kilo 整体区外 junction 且区外 plans 未建（realRoot=null 整体跳过形态）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-kilojct-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-kiloout-'));
    let linked = false;
    try { fs.symlinkSync(outside, path.join(tmp, '.kilo'), 'junction'); linked = true; } catch { /* 无权限环境降级跳过 */ }
    if (linked) {
      const sess = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, tool: 'write_scoped_file', args: { filename: 'a.md', content: 'x' }, meta: { runtime_scope: 'subagent' } },
      ] });
      check('write-scoped-kilo-junction-deny', sess.responses[1] && sess.responses[1].isError);
      check('write-scoped-kilo-junction-no-outside', !fs.existsSync(path.join(outside, 'plans')));
      sess.cleanup();
    } else {
      console.log('SKIP write-scoped-kilo-junction-deny (junction unavailable)');
    }
    cleanDir(tmp); cleanDir(outside);
  }

  // —— write_scoped_file 链接盲区②：.kilo 整体区外 junction 且区外 plans 预建（判等放行形态）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-kilojct2-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-kiloout2-'));
    fs.mkdirSync(path.join(outside, 'plans'), { recursive: true });
    let linked = false;
    try { fs.symlinkSync(outside, path.join(tmp, '.kilo'), 'junction'); linked = true; } catch { /* 无权限环境降级跳过 */ }
    if (linked) {
      const sess = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, tool: 'write_scoped_file', args: { filename: 'b.md', content: 'x' }, meta: { runtime_scope: 'subagent' } },
      ] });
      check('write-scoped-kilo-junction-exists-deny', sess.responses[1] && sess.responses[1].isError);
      check('write-scoped-kilo-junction-exists-no-outside', !fs.existsSync(path.join(outside, 'plans', 'b.md')));
      sess.cleanup();
    } else {
      console.log('SKIP write-scoped-kilo-junction-exists-deny (junction unavailable)');
    }
    cleanDir(tmp); cleanDir(outside);
  }

  // —— write_scoped_file 链接盲区③：中段 link 指区外且末级子目录未创建（mkdir recursive 区外落盘形态）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-midlink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-scoped-midout-'));
    const plansDir = path.join(tmp, '.kilo', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    let linked = false;
    try { fs.symlinkSync(outside, path.join(plansDir, 'link'), 'junction'); linked = true; } catch { /* 无权限环境降级跳过 */ }
    if (linked) {
      const sess = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, tool: 'write_scoped_file', args: { filename: 'link/sub/x.md', content: 'x' }, meta: { runtime_scope: 'subagent' } },
      ] });
      check('write-scoped-missing-sub-under-link-deny', sess.responses[1] && sess.responses[1].isError);
      check('write-scoped-missing-sub-no-outside', !fs.existsSync(path.join(outside, 'sub')));
      sess.cleanup();
    } else {
      console.log('SKIP write-scoped-missing-sub-under-link-deny (junction unavailable)');
    }
    cleanDir(tmp); cleanDir(outside);
  }

  // —— Windows 终端分流器回归 ——
  if (process.platform === 'win32') {
    // 默认环境无 env 覆盖时，反查发现真实 bash.exe（PortableGit），回报行以 bash.exe 结尾且不包含 cmd.exe
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-dispatch-s4-'));
      const { responses, cleanup } = await runSession({
        role: 'main',
        workdir: tmp,
        actions: [{ id: 1, exec: 'git status' }]
      });
      const rep = responses[1]?.content?.[0]?.text || '';
      const match = rep.match(/调度 Shell:\s*([^\r\n]+)/);
      const dispatched = match ? match[1].trim() : '';
      check('dispatch-find-gitbash', dispatched.toLowerCase().endsWith('bash.exe') && !dispatched.toLowerCase().includes('cmd.exe'), dispatched);
      cleanup(); cleanDir(tmp);
    }
  } else {
    // 非 win32 平台跳过：以 SKIP 标记输出，不得计入 OK（否则跳过被伪装为通过）
    console.log('SKIP dispatch-find-gitbash (non-win32 skipped)');
  }

  // —— PWSH cmdlet 路由回归（前缀表与 ALLOW 子集一致 + 实际分流走 pwsh）——
  {
    const src = fs.readFileSync(SERVER, 'utf8');
    const blk = (src.match(/const PWSH_CMDLET_PREFIXES = \[([\s\S]*?)\];/) || [])[1] || '';
    const prefixes = [...blk.matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]);
    check('pwsh-prefixes-count-26', prefixes.length === 26, 'got=' + prefixes.length);
    if (process.platform === 'win32') {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pwsh-route-'));
      const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, exec: 'get-culture' },
      ] });
      const rep = responses[1]?.content?.[0]?.text || '';
      const sm = rep.match(/调度 Shell:\s*([^\r\n]+)/);
      const shell = sm ? sm[1].trim().toLowerCase() : '';
      check('pwsh-route-cmdlet-via-pwsh', shell.includes('pwsh') || shell.includes('powershell'), shell || rep.slice(0, 80));
      cleanup(); cleanDir(tmp);
    } else {
      console.log('SKIP pwsh-route-cmdlet-via-pwsh (non-win32 skipped)');
    }
  }

  // —— 沙箱调用方身份闸（默认关闭，MCP_SANDBOX_REQUIRE_CALLER=1 才生效）——
  {
    // 用例 1：开启闸、不传 caller → 被调用方闸拦截
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-caller-'));
      const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, envExtra: { MCP_SANDBOX_REQUIRE_CALLER: '1' }, actions: [
        { id: 1, tool: 'exec_sandboxed_command', args: { command: 'cat C:/x' } },
      ] });
      check('sandbox-caller-gate-unstated-deny', isDenied(responses[1], '调用方未授权'));
      cleanup(); cleanDir(tmp);
    }
    // 用例 2：开启闸、传 caller='primary' → 过调用方闸，被销毁护栏拦截
    //   命令选用 subst T: /D：命中 sandboxDestroyHit 即返回，早于 ensureVirtualDrive 挂载点，零挂载副作用。
    //   断言以「回执含沙盒销毁护栏署名」为正向前提：护栏正则若回归，回执将改由路径护栏署名，断言转红（归因不可漂移）。
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-caller-allow-'));
      const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, envExtra: { MCP_SANDBOX_REQUIRE_CALLER: '1' }, actions: [
        { id: 1, tool: 'exec_sandboxed_command', args: { command: 'subst T: /D', caller: 'primary' } },
      ] });
      check('sandbox-caller-gate-primary-allow', isDenied(responses[1], '沙盒销毁护栏拦截'), String(responses[1]?.content?.[0]?.text || '').slice(0, 120));
      cleanup(); cleanDir(tmp);
    }
    // 用例 3：不设 env、不传 caller → 不被调用方闸拦截（默认零回归）
    //   同理用 subst T: /D 避免 ensureVirtualDrive 挂载副作用
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-caller-off-'));
      const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
        { id: 1, tool: 'exec_sandboxed_command', args: { command: 'subst T: /D' } },
      ] });
      check('sandbox-caller-gate-default-off', isDenied(responses[1], '沙盒销毁护栏拦截'), String(responses[1]?.content?.[0]?.text || '').slice(0, 120));
      cleanup(); cleanDir(tmp);
    }
    // 用例 4：复制通道同样受调用方闸约束——闸位先于任何 IO 与参数解析，
    //   故拒答路径零 T 盘副作用（不挂载、不复制）；源文件无需真实存在。
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-caller-copy-'));
      const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, envExtra: { MCP_SANDBOX_REQUIRE_CALLER: '1' }, actions: [
        { id: 1, tool: 'copy_into_sandbox', args: { paths: ['seed.txt'], dest: 'probe-caller' } },
      ] });
      check('sandbox-caller-gate-copy-unstated-deny', isDenied(responses[1], '调用方未授权'), String(responses[1]?.content?.[0]?.text || '').slice(0, 120));
      cleanup(); cleanDir(tmp);
    }
  }

  // —— git 隐式派生防御的视图一致性闸（白名单走 base 视图，加固走原始视图）——
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-harden-diverge-'));
    const { responses, cleanup } = await runSession({ role: 'main', workdir: tmp, actions: [
      { id: 1, tool: 'exec_guarded_command', args: { command: "'git' diff --stat" } },
      { id: 2, tool: 'exec_guarded_command', args: { command: 'git "diff" --stat' } },
      { id: 3, tool: 'exec_guarded_command', args: { command: 'git diff --stat' } },
      { id: 4, tool: 'exec_guarded_command', args: { command: 'git diff --stat | git "log" -1 --oneline' } },
      { id: 5, tool: 'exec_guarded_command', args: { command: 'git diff --stat | \'git\' log -1 --oneline' } },
      { id: 6, tool: 'exec_guarded_command', args: { command: 'git diff --stat | head -5' } },
      { id: 7, tool: 'exec_guarded_command', args: { command: 'git log --grep="a|b" --oneline' } },
    ] });
    check('githarden-view-diverge-quoted-git-deny', isDenied(responses[1], '引号包裹'), String(responses[1]?.content?.[0]?.text || '').slice(0, 120));
    check('githarden-view-diverge-quoted-subcmd-deny', isDenied(responses[2], '引号包裹'), String(responses[2]?.content?.[0]?.text || '').slice(0, 120));
    // 正控：不带引号的同义命令必须仍被放行且完成加固，否则上面两条属误伤、本闸失去区分力。
    check('githarden-view-baseline-plain-allow-kept', !responses[3]?.isError && String(responses[3]?.content?.[0]?.text || '').includes('--no-ext-diff'), String(responses[3]?.content?.[0]?.text || '').slice(0, 120));
    // 混合管道：另一段被成功加固不构成"本段可裸奔"的理由——引号段同样必须被拒。
    check('githarden-view-diverge-mixed-pipe-subcmd-deny', isDenied(responses[4], '引号包裹'), String(responses[4]?.content?.[0]?.text || '').slice(0, 120));
    check('githarden-view-diverge-mixed-pipe-quoted-git-deny', isDenied(responses[5], '引号包裹'), String(responses[5]?.content?.[0]?.text || '').slice(0, 120));
    // 误伤正控（两条）：合法只读管道必须放行，且加固必须照旧落在被加固段上。
    check('githarden-view-mixed-pipe-allow-kept', !responses[6]?.isError && String(responses[6]?.content?.[0]?.text || '').includes('--no-ext-diff'), String(responses[6]?.content?.[0]?.text || '').slice(0, 120));
    check('githarden-view-quoted-arg-pipe-allow-kept', !responses[7]?.isError, String(responses[7]?.content?.[0]?.text || '').slice(0, 120));
    cleanup(); cleanDir(tmp);
  }

  // —— WebUI 前端样式不变量（浅色主题可读性防复发）——
  //   SPA 源码已自 webui.js 的内联单行常量外置为 webui-client.html（真实多行、可直接读），
  //   故本块直接扫描该文件。背景：浅色主题刻意保留深色代码/终端容器；若容器不自带前景，
  //   其文字会继承 --text-main 而与深色底同色（实测 1.00:1）。此类缺陷肉眼不可见，必须机器盯着。
  {
    const client = fs.readFileSync(path.resolve(here, '..', 'webui-client.html'), 'utf8');
    const BQ = String.fromCharCode(34);               // 真实双引号（外置后不再是 \" 转义形态）
    const NL = String.fromCharCode(10);               // 真实换行（不再是 \n 两字符转义）

    // 不变量 1：凡使用「深色专用底色」的容器，其 class 属性内必须自带前景色声明。
    const darkTokens = ['bg-[var(--bg-code-block)]', 'bg-[var(--bg-terminal)]', 'bg-[var(--bg-file-viewer)]'];
    const noForeground = [];
    let darkTotal = 0;
    for (const tok of darkTokens) {
      let i = -1;
      while ((i = client.indexOf(tok, i + 1)) >= 0) {
        darkTotal++;
        const a = client.lastIndexOf('class=' + BQ, i);
        const b = client.indexOf(BQ, i);
        const cls = (a >= 0 && b > i) ? client.slice(a, b) : '';
        if (cls.indexOf('text-[var(') < 0) noForeground.push(tok + '@' + i);
      }
    }
    check('webui-dark-surface-declares-foreground', darkTotal > 0 && noForeground.length === 0,
      'dark=' + darkTotal + ' offending=' + (noForeground.join(' | ') || 'none'));

    // 不变量 2：主题块齐备且变量集一致（防止新增主题只写一半、或某主题漏改）。
    const themeIds = [];
    const parts = client.split('data-theme=' + BQ).slice(1);
    for (const seg of parts) {
      const m = seg.match(/^([a-z][a-z0-9-]*)/);
      if (!m) continue;
      const id = m[1];
      if (client.indexOf('data-theme=' + BQ + id + BQ + ']') < 0) continue;   // 只要 CSS 选择器形态，排除 <html data-theme=…>
      if (themeIds.indexOf(id) < 0) themeIds.push(id);
    }
    const sets = {};
    const absent = [];
    for (const t of themeIds) {
      const st = client.indexOf('data-theme=' + BQ + t + BQ + ']');
      const blk = st >= 0 ? client.slice(st, st + 2600) : '';
      const e = blk.indexOf(NL + '  }');
      const body = e > 0 ? blk.slice(0, e) : blk;
      const names = [];
      const re = /(--[a-z0-9-]+)[ ]*:/g;
      let m2;
      while ((m2 = re.exec(body))) names.push(m2[1]);
      sets[t] = names;
      if (names.length === 0) absent.push(t);
    }
    const base = sets[themeIds[0]] || [];
    const drift = [];
    for (const t of themeIds) {
      const cur = sets[t] || [];
      const miss = base.filter((v) => cur.indexOf(v) < 0);
      const extra = cur.filter((v) => base.indexOf(v) < 0);
      if (miss.length || extra.length) drift.push(t + '{miss:' + miss.join(',') + ';extra:' + extra.join(',') + '}');
    }
    check('webui-theme-blocks-complete', themeIds.length === 5 && absent.length === 0 && base.length >= 40 && drift.length === 0,
      'themes=' + themeIds.join(',') + ' absent=' + (absent.join(',') || 'none') + ' base-n=' + base.length + ' drift=' + (drift.join(' ') || 'none'));

    // 不变量 3：凡被引用的 var(--x) 必须有定义（:root 或任一主题块），杜绝拼错变量名导致静默失色。
    const defined = {};
    for (const t of themeIds) for (const v of (sets[t] || [])) defined[v] = 1;
    const rootIdx = client.indexOf(':root {');
    if (rootIdx >= 0) {
      const reRoot = /(--[a-z0-9-]+)[ ]*:/g;
      let m3;
      const rootBody = client.slice(rootIdx, rootIdx + 400);
      while ((m3 = reRoot.exec(rootBody))) defined[m3[1]] = 1;
    }
    const undefinedVars = [];
    const reRef = /var[(]([a-z0-9-]+)[)]/g;
    let m4;
    while ((m4 = reRef.exec(client))) if (!defined[m4[1]] && undefinedVars.indexOf(m4[1]) < 0) undefinedVars.push(m4[1]);
    check('webui-vars-all-defined', undefinedVars.length === 0, 'undefined=' + (undefinedVars.join(',') || 'none'));

    // 主题色点的形态（渐变 / 实色 / 边框）与配色方案不设断言：SPA 已外置为 webui-client.html，
    //   视觉方案的调整不应导致套件转红；形态与互异性由维护者在浏览器目视确认。
  }

  // —— WebUI 真实启动冒烟（MCP_* 剥离规避拒启守卫；隔离 HOME 防宿主 token 污染）——
  {
    const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-webui-home-'));
    const port = 13490 + Math.floor(Math.random() * 500);
    const env = {};
    for (const k of Object.keys(process.env)) if (!k.startsWith('MCP_')) env[k] = process.env[k];
    env.USERPROFILE = isoHome; env.HOME = isoHome; env.MCP_WEBUI_PORT = String(port);
    const webui = spawn(process.execPath, [path.resolve(here, '..', 'webui.js')], { cwd: path.resolve(here, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ok = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch('http://127.0.0.1:' + port + '/api/status'); ok = r.status === 200; if (ok) break; } catch { /* 未就绪，重试 */ }
      await new Promise((res) => setTimeout(res, 250));
    }
    let servedHtml = null;
    if (ok) {
      try {
        const r = await fetch('http://127.0.0.1:' + port + '/');
        servedHtml = r.status === 200 ? await r.text() : null;
      } catch { servedHtml = null; }
    }
    webui.kill();
    check('webui-smoke-status-200', ok);
    // 外置重构的核心保证：服务端实际吐出的 SPA 必须与磁盘上的 webui-client.html 逐字符一致。
    //   行尾差异按 CRLF→LF 归一后比较，避免 Git 换行策略造成假红（故用字符码构造，不落字面转义）。
    let onDiskHtml = null;
    try { onDiskHtml = fs.readFileSync(path.resolve(here, '..', 'webui-client.html'), 'utf8'); } catch { onDiskHtml = null; }
    const normEol = (s) => (s === null ? null : s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)));
    check('webui-served-html-matches-file',
      servedHtml !== null && onDiskHtml !== null && normEol(servedHtml) === normEol(onDiskHtml),
      'served=' + (servedHtml === null ? 'null' : servedHtml.length) + ' onDisk=' + (onDiskHtml === null ? 'null' : onDiskHtml.length));
    cleanDir(isoHome);
  }

  // —— 代码质量不变量：消除 POSIX 壳解析中的不可达死回退 ——
  {
    const serverSrc = fs.readFileSync(SERVER, 'utf8');
    check('resolve-shell-no-dead-fallback', !serverSrc.includes("'/bin/bash' || '/bin/sh'"));
  }

  // —— 代码质量不变量：空审计提示判据必须基于审计文件存在性，而非 WebUI 进程自身 env ——
  {
    const clientSrc = fs.readFileSync(path.resolve(here, '..', 'webui-client.html'), 'utf8');
    check('webui-audit-empty-no-self-env-predicate', !clientSrc.includes('state.status.auditEnabled'));
    check('webui-audit-empty-uses-file-exists', clientSrc.includes('html += (state.status && state.status.auditFileExists)'));
  }

  // —— 代码质量不变量：SKILL.md 白名单镜像的 git branch 键族禁止回漂为通配形态 ——
  //   镜像义务由本不变量机器化（resolve-shell-no-dead-fallback 同族先例）：
  //   文档镜像任何一条 git branch * 后缀键，即与「精确键 = 只读登记面」的执法语义冲突。
  {
    const mirrorDocs = [
      ['plan-file-first', path.resolve(here, '..', '..', 'skills', 'plan-file-first', 'SKILL.md')],
      ['pwsh-gnu-bridge', path.resolve(here, '..', '..', 'skills', 'pwsh-gnu-bridge', 'SKILL.md')],
    ];
    const wildcardKeys = ['git branch -a*', 'git branch -r*', 'git branch -v*', 'git branch --all*', 'git branch --list*', 'git branch --show-current*'];
    for (const [label, docPath] of mirrorDocs) {
      let src = '';
      try { src = fs.readFileSync(docPath, 'utf8'); } catch { src = ''; }
      const drifted = wildcardKeys.filter((k) => src.includes(k));
      check('skilldoc-gitbranch-mirror-' + label, drifted.length === 0 && src.includes('git branch -vv'), drifted.length ? 'wildcard: ' + drifted.join(',') : (src.includes('git branch -vv') ? '' : 'missing exact -vv'));
    }
  }

  // —— webui 静态化与 env 卫生不变量（CodeRabbit #7 + S1 收尾）——
  //   1) 远程脚本：本页脚本全为内联，故口径取"任何 <script> 标签都不得带 src"（含跨行形态；
  //      未来新增本地脚本须显式改断言）；`(?<![\w-])` 防 `data-src` 类误伤；
  //   2) env 全量剥离：源级双条件（过滤循环 + spawn 实际使用其输出），防"循环在场但未用"假绿；
  //   3) 工具类子集 presence-only（只保规则在场，不保 @media 包裹语义）：
  //      单 token JS 串分支 + 实测噪声白名单；选择器只在**已知伪类/伪元素集**处截断（防 `sm:text-lg` 类变体被误截）；
  //   4) 生成区禁空/禁无声明规则（最小护栏，非视觉等价性证明）。
  {
    const htmlSrc = fs.readFileSync(path.resolve(here, '..', 'webui-client.html'), 'utf8');
    const webuiSrc = fs.readFileSync(path.resolve(here, '..', 'webui.js'), 'utf8');
    check('webui-no-remote-script', !/<script\b(?:(?!>)[\s\S])*(?<![\w-])src\s*=/i.test(htmlSrc));
    check('webui-env-mcp-stripped',
      /if\s*\(\s*!\/\^MCP_\/\.test\(\s*k\s*\)\s*\)\s*_childEnv\[k\]\s*=\s*process\.env\[k\]/.test(webuiSrc) &&
      /env:\s*Object\.assign\(\s*_childEnv\s*,\s*\{\s*MCP_ROLE:\s*'main'\s*\}\s*\)/.test(webuiSrc));
    const CLASS_SHAPE = /^[a-z][a-z0-9:._/-]*(?:\[[^\]]+\])?$/i;
    const MARK = /[-:\[]/;
    // 噪声白名单（沙箱全量实测，见证据日志；新增项须附证据）：
    //   单 token 引号串分支实测 5 项非类串；class 属性/多 token 分支实测 3 项
    //   （`cls`/`auditTone` 系 `class="' + var + '"` 拼接碎片，`C:/Windows/win.ini` 系命令字面量）。
    //   三路提取共用同一白名单：任一分支漏挂都会让存在性断言恒红（不可达）。
    const TOKEN_PHANTOM = new Set(['Content-Type', 'data-theme', 'drwxr-xr-x', 'governor-policy.json', 'zh-CN', 'cls', 'auditTone', 'C:/Windows/win.ini']);
    const tokens = new Set();
    for (const m of htmlSrc.matchAll(/class="([^"]*)"/g)) {
      for (const raw of m[1].split(/\s+/)) {
        const t = raw.trim();
        if (t && CLASS_SHAPE.test(t) && t !== 'group' && t !== 'peer' && !TOKEN_PHANTOM.has(t)) tokens.add(t);
      }
    }
    for (const m of htmlSrc.matchAll(/'([a-z][a-z0-9:._/-]*(?:\[[^\]]+\])?(?:[ \t]+[a-z][a-z0-9:._/-]*(?:\[[^\]]+\])?)+)'/gi)) {
      for (const raw of m[1].split(/\s+/)) {
        const t = raw.trim();
        if (t && CLASS_SHAPE.test(t) && MARK.test(t) && !TOKEN_PHANTOM.has(t)) tokens.add(t);
      }
    }
    // 单 token 引号串分支（覆盖 'animate-spin' 类三元回退）。
    const Q = String.fromCharCode(39);
    const singleRe = new RegExp(Q + '([a-z][a-z0-9:._/-]*(?:\\[[^\\]]+\\])?)' + Q, 'gi');
    for (const m of htmlSrc.matchAll(singleRe)) {
      const t = m[1];
      if (CLASS_SHAPE.test(t) && MARK.test(t) && !TOKEN_PHANTOM.has(t)) tokens.add(t);
    }
    const styles = [...htmlSrc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    // 选择器归一：去转义后仅剥离**已知伪类/伪元素集**（防把 `sm:text-lg` 的变体冒号当伪类截成 `sm`）。
    const PSEUDO_TAIL = /(?:::(?:-webkit-|-moz-|-ms-)?[a-z-]+|:(?:hover|focus|focus-visible|focus-within|active|disabled|visited|checked|first-child|last-child|only-child|empty|before|after|placeholder|selection|target|required|invalid|valid|read-only|not\([^)]*\)|nth-child\([^)]*\)))+\s*$/i;
    const selectors = new Set();
    for (const m of styles.matchAll(/\.((?:[^\s{},>+~]|\\.)+)/g)) {
      selectors.add(m[1].replace(/\\(.)/g, '$1').replace(PSEUDO_TAIL, ''));
    }
    const missing = [...tokens].filter((t) => !selectors.has(t));
    check('webui-utility-subset-presence', missing.length === 0,
      missing.length ? 'missing=' + missing.slice(0, 15).join(' ') + (missing.length > 15 ? ' …+' + (missing.length - 15) : '') : '');
    const genRegion = (styles.match(/\/\* --- 生成区开始 --- \*\/([\s\S]*?)\/\* --- 生成区结束 --- \*\//) || [])[1] || '';
    const badRules = [...genRegion.matchAll(/\{([^{}]*)\}/g)].filter((m) => m[1].replace(/[;\s]/g, '') === '' || !m[1].includes(':'));
    check('webui-utility-rules-nonempty', genRegion.length > 0 && badRules.length === 0, 'bad=' + badRules.length);
  }

  // —— 显示闸清单 ↔ 执法闸数量对账不变量（PR r1 E1 / r2 E3 防再漂）——
  //   STRUCTURE_GATES 数组条目数必须为 15（与 plan-governor.js 实际执法结构闸一一对应）；
  //   webui-client.html 静态文案必须含「15 族」且不得残留「14 族」。
  //   缺此断言时，显示层与执法层计数漂移只能靠人眼发现——本 PR r1 漏扫 gate-0.7、
  //   r2 返工又漏扫前端 3 处「14 族」，两次实证此为机械缺口，故钉死。
  {
    const gateSrc = fs.readFileSync(path.resolve(here, '..', 'webui.js'), 'utf8');
    const clientGateSrc = fs.readFileSync(path.resolve(here, '..', 'webui-client.html'), 'utf8');
    const gatesArr = gateSrc.match(/const STRUCTURE_GATES\s*=\s*\[([\s\S]*?)\n\];/);
    const gateCount = gatesArr ? (gatesArr[1].match(/\{\s*id:\s*'gate-/g) || []).length : -1;
    check('webui-structure-gates-count-15', gateCount === 15, 'got=' + gateCount);
    check('webui-client-no-stale-gate-count', !clientGateSrc.includes('14 族'), 'stale14=' + (clientGateSrc.match(/14 族/g) || []).length);
    check('webui-client-says-15-gates', clientGateSrc.includes('15 族'), 'says15=' + (clientGateSrc.match(/15 族/g) || []).length);
  }

  console.log(fail === 0 ? 'PLAN-GOVERNOR ALL OK' : 'PLAN-GOVERNOR FAILURES=' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
