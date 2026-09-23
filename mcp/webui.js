#!/usr/bin/env node
/**
 * webui.js —— Plan-Governor WebUI 工作台（零 npm 依赖、零构建步骤；SPA 外置为 webui-client.html）
 *
 * 运行：node mcp/webui.js   （默认 http://127.0.0.1:3300，可用 MCP_WEBUI_PORT 改端口）
 *
 * 包含：
 *   1. Node 原生 HTTP 服务（127.0.0.1 绑定、Host 校验、Bearer Token 守卫、2-Step Challenge 放宽确认）
 *   2. 真实策略读写与 HMAC-SHA256 签名热重载（落盘 ~/.config/kilo/governor-policy.json）
 *   3. 真实裁决端点（调用生产 plan-governor.js 的 auditCommand）
 *   4. 真实 bash 审计流水（读 ~/.config/kilo/governor-audit.jsonl，事件全量记录，会话字段恒空）
 *   5. 真实回归实机执行（异步作业模型 spawn mcp/tests/plan-governor-regress.mjs）
 *   6. 外置 SPA（webui-client.html：5 套主题 × 41 CSS 变量、38 个 Lucide 矢量图标、4 大工作台）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// —— 启动序 1：环境守卫（阻断 AI 经受控 MCP 终端自举拉起本服务而提权）——
if (process.env.MCP_ROLE) {
  process.stderr.write('[webui] 拒绝启动：检测到受控 MCP 环境（MCP_ROLE）。请在普通终端启动。\n');
  process.exit(2);
}

// —— 启动序 2：工作区锚定（必须先 chdir 再 require，否则内核 WORKSPACE/MODE_DIR 会锚错 cwd）——
const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

// —— 启动序 3：引入生产内核 ——
const governor = require('./plan-governor.js');

const PORT = Number(process.env.MCP_WEBUI_PORT || process.env.ADMIN_PORT || 3300);

// —— 启动序 4：生成单枚 admin token，写入用户级 Kilo 配置目录（与审计流/密钥同源）——
const TOKEN_DIR = path.join(os.homedir(), '.config', 'kilo');
try { fs.mkdirSync(TOKEN_DIR, { recursive: true }); } catch (e) { /* 目录已存在 */ }
// —— 启动序 4a：Admin Token 复用优先（不再每次启动轮换；浏览器已存 token 跨重启有效）——
// 信任边界如实声明：本机信任模型下 AI 有宿主 shell，能读/改本文件与 webui.js 本身，
//   token 只防误用与无关本地进程，不防蓄意绕过（那需要不同的威胁模型）。
let ADMIN_TOKEN = '';
try { ADMIN_TOKEN = fs.readFileSync(path.join(TOKEN_DIR, 'webui-token.txt'), 'utf8').trim(); } catch (e) { /* 不存在则生成 */ }
if (!/^[0-9a-f]{64}$/.test(ADMIN_TOKEN)) {
  ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(path.join(TOKEN_DIR, 'webui-token.txt'), ADMIN_TOKEN, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    process.stderr.write('[webui] 警告: Admin Token 写入失败: ' + e.message + '\r\n');
  }
}
// —— 启动序 5：生成 Sandbox 专用窄权限凭证（仅允许调用 /api/sandbox/exec，AI 进程只读此文件）——
// 复用优先：文件已存在则沿用旧值，避免双 WebUI 实例竞态互踩导致 MCP 侧读到失效 Token。
const SANDBOX_TOKEN_FILE = path.join(TOKEN_DIR, 'webui-sandbox-token.txt');
let SANDBOX_TOKEN = '';
try {
  SANDBOX_TOKEN = fs.readFileSync(SANDBOX_TOKEN_FILE, 'utf8').trim();
} catch (e) { /* 文件不存在，下面生成 */ }
if (!/^[0-9a-f]{64}$/.test(SANDBOX_TOKEN)) {
  SANDBOX_TOKEN = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SANDBOX_TOKEN_FILE, SANDBOX_TOKEN, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    process.stderr.write('[webui] 警告: Sandbox Token 写入失败: ' + e.message + '\n');
  }
}

// 放宽确认挑战表：challengeId -> { payload, code, expiresAt, attempts }
const challenges = new Map();
// 放宽验证会话：一次成功验证后 60s 内的后续放宽操作免重复输码（单例）
let relaxSession = null;

// 异步回归作业（单例）
let regressJob = null;

// =========================================================================
//         【 临时实验环境（T 盘沙箱）：内核原语已迁入 plan-governor.js 】
// =========================================================================
// ensureVirtualDrive / ensureVirtualDriveReadme / sandboxEscape / sandboxExec
// 全部由 plan-governor.js 进程内导出（与 MCP exec_sandboxed_command 共享同一套实现，
// 去重防漂移）；本文件仅经 governor.* 调用。
// webui.js 的 VIRTUAL_DRIVE_LETTER 旧死常量（无任何引用）随迁移一并删除。

// 14 族结构硬闸出厂元数据（只读展示，锁定不可禁用）
const STRUCTURE_GATES = [
  { id: 'gate-0.5', name: '展开构造硬闸 ($ / 反引号)', pattern: '$ 或 `', desc: 'bash 展开可改写命令 token 边界，一律拒绝', fatal: true },
  { id: 'gate-0.5b', name: '花括号 / 浪号 / 通配符展开硬闸 ({a,b} ~ * ?)', pattern: '展开族元字符', desc: '执行时刻展开令裁决视图与执行视图分叉，一律拒绝', fatal: true },
  { id: 'gate-0.5c', name: '前置环境变量赋值闸 (VAR=val)', pattern: '^VAR=val', desc: 'GIT_PAGER / PAGER / BASH_ENV 可绕过参数闸派生外部进程，一律拒绝', fatal: true },
  { id: 'gate-0.6', name: '命令包装前缀闸 (command/env/nohup/eval/sh/bash)', pattern: '包装前缀族', desc: '把真命令推到参数位使黑名单前缀匹配失效，一律拒绝', fatal: true },
  { id: 'gate-0', name: 'pwsh / powershell -c 包装闸', pattern: 'powershell -c', desc: '解释器内联执行即任意命令通道，逐段拦截', fatal: true },
  { id: 'gate-1', name: '黑名单绝对阻断闸 (' + governor.DENY_KEYS.length + ' 键)', pattern: 'DENY_KEYS (' + governor.DENY_KEYS.length + ')', desc: '破坏性与状态写操作严禁执行，全角色全模式死拦', fatal: true },
  { id: 'gate-1.5', name: 'Git 别名执行面写入闸 (git config 写形态)', pattern: 'git config 写形态', desc: '防止定义 !cmd 别名形成任意命令通道', fatal: true },
  { id: 'gate-2', name: '禁入清单绝对阻断闸 (' + governor.FORBIDDEN_KEYS.length + ' 键)', pattern: 'FORBIDDEN_KEYS (' + governor.FORBIDDEN_KEYS.length + ')', desc: '隐式写能力或管道任意执行风险，一律 deny', fatal: true },
  { id: 'gate-3.5', name: '--output 写逃逸参数闸', pattern: '--output', desc: '禁止只读命令携带输出重定向参数写盘', fatal: false },
  { id: 'gate-3.6', name: '外部进程派生参数闸 (--open* / --pre* / --textconv / --filters / --ext-diff / --paginate / -O / git -c)', pattern: '派生参数族 / 执行面键注入', desc: '只读命令不得派生外部进程', fatal: true },
  { id: 'gate-3.8', name: '跨工作区路径闸 (路径越界实解析)', pattern: '盘符绝对 / POSIX 绝对 / UNC / .. 上跳', desc: '命令字面量中的路径经 resolve 后超出工作区一律拦截', fatal: true },
  { id: 'gate-3.7', name: '时钟写入闸 (date -s / hwclock / timedatectl)', pattern: 'date 只读白名单（默认即写）+ 时钟设置写形态', desc: 'date 仅放行只读形态，其余参数一律按写拒（宁可误伤）；读时间允许，改系统/硬件时钟一律拒绝（防打穿模式新鲜度判定）', fatal: true },
  { id: 'gate-3', name: '复合 / 链式连接符硬闸 (; & && || 换行)', pattern: '[;&|\\n]', desc: '必须拆为单行单命令逐条执行', fatal: true },
  { id: 'gate-4', name: '非平铺字符硬闸 (< > $() 反引号)', pattern: '非平铺字符', desc: '写操作走宿主专用编辑工具', fatal: true }
];

function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [id, c] of challenges.entries()) {
    if (c.expiresAt <= now) challenges.delete(id);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (d) => {
      buf += d;
      if (buf.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('请求体过大（上限 1MB）'));
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function sendJson(res, code, data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    // 不下发 ACAO：本服务自带同源 SPA，通配 CORS 会让本机任意网页跨源读取策略与审计流水。
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  });
  res.end(payload);
}

// Token 校验：定长比较，失败不回显任何细节
function verifyToken(req) {
  const auth = String(req.headers['authorization'] || '');
  const m = auth.match(/^Bearer\s+([0-9a-fA-F]{64})$/);
  if (!m) return false;
  try {
    const a = Buffer.from(m[1].toLowerCase(), 'hex');
    const b = Buffer.from(ADMIN_TOKEN.toLowerCase(), 'hex');
    if (a.length !== 32 || b.length !== 32) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// 校验 Sandbox 专用凭证（或 Admin 凭证均可执行）
function verifySandboxToken(req) {
  const auth = String(req.headers['authorization'] || '');
  const m = auth.match(/^Bearer\s+([0-9a-fA-F]{64})$/);
  if (!m) return false;
  try {
    const tok = Buffer.from(m[1].toLowerCase(), 'hex');
    if (tok.length !== 32) return false;
    const isSb = crypto.timingSafeEqual(tok, Buffer.from(SANDBOX_TOKEN.toLowerCase(), 'hex'));
    const isAdm = crypto.timingSafeEqual(tok, Buffer.from(ADMIN_TOKEN.toLowerCase(), 'hex'));
    return isSb || isAdm;
  } catch (e) {
    return false;
  }
}

// 原子落盘：先写 .tmp 再 rename，避免半写状态被内核热重载读到
function persistPolicyFile(payload) {
  const key = fs.readFileSync(governor.POLICY_KEY_FILE, 'utf8').trim();
  const sig = governor.signPolicy(payload, key);
  const toWrite = {
    version: 1,
    updatedAt: new Date().toISOString(),
    customAllow: Array.isArray(payload.customAllow) ? payload.customAllow : [],
    customDeny: Array.isArray(payload.customDeny) ? payload.customDeny : [],
    sig
  };
  const modeDir = path.dirname(governor.POLICY_FILE);
  if (!fs.existsSync(modeDir)) fs.mkdirSync(modeDir, { recursive: true });
  const tmpFile = governor.POLICY_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(toWrite, null, 2), 'utf8');
  fs.renameSync(tmpFile, governor.POLICY_FILE);
  return { persisted: true, signatureValid: true, policyPath: governor.POLICY_FILE, sig };
}

const server = http.createServer(async (req, res) => {
  // Host 校验（防 DNS 重绑定 / 局域网旁路）
  const host = String(req.headers['host'] || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: 仅允许本地访问 (127.0.0.1 / localhost)');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      // 同上：OPTIONS 预检亦不下发 ACAO（本服务不接受跨源调用，SPA 为同源）。
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
    });
    res.end();
    return;
  }

  const pathname = new URL(req.url, 'http://' + host).pathname;

  try {
    // —— 单页入口 ——
    if (req.method === 'GET' && pathname === '/') {
      const body = Buffer.from(CLIENT_HTML, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
      });
      res.end(body);
      return;
    }

    // —— 状态：workspace / modeDir 一律取自内核导出，不用 process.cwd() 重算 ——
    if (req.method === 'GET' && pathname === '/api/status') {
      let auditRecordCount = null;
      let auditFileExists = false;
      try {
        const rawAudit = fs.readFileSync(governor.AUDIT_LOG_FILE, 'utf8');
        auditFileExists = true;
        auditRecordCount = rawAudit.split(/\r?\n/).filter(function (l) { return l.trim(); }).length;
      } catch (e) { auditRecordCount = null; }
      sendJson(res, 200, {
        workspace: governor.WORKSPACE,
        modeDir: governor.MODE_DIR,
        policyPath: governor.POLICY_FILE,
        auditPath: governor.AUDIT_LOG_FILE,
        auditEnabled: process.env.MCP_AUDIT_LOG === '1',
        auditFileExists: auditFileExists,
        auditRecordCount: auditRecordCount,
        port: PORT
      });
      return;
    }

    // —— 策略读取 ——
    if (req.method === 'GET' && pathname === '/api/policy') {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。策略全表（含签名串）属敏感读取面，需与写入面同等鉴权。' });
        return;
      }
      const p = governor.loadPolicy();
      let key = '';
      try { key = fs.readFileSync(governor.POLICY_KEY_FILE, 'utf8').trim(); } catch (e) { /* 密钥缺失 */ }
      let disk = null;
      try { disk = JSON.parse(fs.readFileSync(governor.POLICY_FILE, 'utf8')); } catch (e) { /* 未落盘 */ }
      const sig = disk && typeof disk.sig === 'string' ? disk.sig : '';
      const expect = disk && key ? governor.signPolicy(disk, key) : '';
      const signatureValid = !!(sig && expect && sig.toLowerCase() === expect.toLowerCase());

      sendJson(res, 200, {
        allow: governor.ALLOW_KEYS,
        deny: governor.DENY_KEYS,
        forbidden: governor.FORBIDDEN_KEYS,
        customAllow: p.allow,
        customDeny: p.deny,
        structureGates: STRUCTURE_GATES,
        signatureValid,
        policyPath: governor.POLICY_FILE,
        sig: sig,
        sigPersisted: !!sig
      });
      return;
    }

    // —— 策略写入（需 Token；放宽类走 2-Step Challenge）——
    if (req.method === 'PUT' && pathname === '/api/policy') {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。请在「策略配置」页录入终端输出的 Admin Token。' });
        return;
      }
      cleanExpiredChallenges();
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (e) {
        sendJson(res, 400, { error: '请求体非合规 JSON' });
        return;
      }

      const nextAllow = Array.isArray(payload.customAllow) ? payload.customAllow.map(String) : [];
      const nextDeny = Array.isArray(payload.customDeny) ? payload.customDeny.map(String) : [];
      const cur = governor.loadPolicy();

      // 放宽判定：新增 customAllow 项 或 删除 customDeny 项
      const isRelaxing = nextAllow.some((a) => cur.allow.indexOf(a) === -1)
        || cur.deny.some((d) => nextDeny.indexOf(d) === -1);

      if (isRelaxing) {
        // 验证会话：60 秒内已用同一动态码成功验证过一次放宽操作，则后续放宽直接放行
        //   （码未变 = 人仍在场盯终端；过期或码轮换后需重新确认）。
        if (relaxSession && relaxSession.expiresAt > Date.now()) {
          sendJson(res, 200, persistPolicyFile({ customAllow: nextAllow, customDeny: nextDeny }));
          return;
        }
        const code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
        const challengeId = crypto.randomBytes(16).toString('hex');
        challenges.set(challengeId, {
          payload: { customAllow: nextAllow, customDeny: nextDeny },
          code,
          expiresAt: Date.now() + 60000,
          attempts: 0
        });
        process.stdout.write('\n=========================================================\n');
        process.stdout.write('  [Plan-Governor 策略放宽确认码]  ==>  ' + code + '  <==\n');
        process.stdout.write('  （60 秒内有效，请在 WebUI 弹窗中输入此验证码以确认放宽）\n');
        process.stdout.write('=========================================================\n\n');
        sendJson(res, 202, {
          status: 'require_confirmation',
          challengeId,
          message: '检测到权限放宽类变更（新增白名单或删减黑名单）。已在启动本服务的终端输出 6 位动态验证码，请在 60 秒内核实输入。'
        });
        return;
      }

      sendJson(res, 200, persistPolicyFile({ customAllow: nextAllow, customDeny: nextDeny }));
      return;
    }

    // —— 放宽确认 ——
    if (req.method === 'POST' && pathname === '/api/policy/confirm') {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。' });
        return;
      }
      cleanExpiredChallenges();
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        sendJson(res, 400, { error: '请求体非合规 JSON' });
        return;
      }
      const ch = challenges.get(body.challengeId);
      if (!ch) {
        sendJson(res, 400, { error: '挑战已过期或不存在，请重新发起策略修改。' });
        return;
      }
      ch.attempts += 1;
      if (ch.attempts > 5) {
        challenges.delete(body.challengeId);
        sendJson(res, 400, { error: '尝试次数超限（上限 5 次），该挑战已作废，请重新发起。' });
        return;
      }
      if (String(body.code || '').trim().toUpperCase() !== ch.code) {
        sendJson(res, 400, { error: '验证码不正确，请重新输入（剩余 ' + (5 - ch.attempts) + ' 次机会）。' });
        return;
      }
      challenges.delete(body.challengeId);
      relaxSession = { code: ch.code, expiresAt: Date.now() + 60000 };
      sendJson(res, 200, persistPolicyFile(ch.payload));
      return;
    }

    // —— 真实裁决（只读演练；仍需 Token：可枚举闸门归因面，且被探针当就绪探针使用，敞口无必要）——
    if (req.method === 'POST' && pathname === '/api/audit') {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。' });
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        sendJson(res, 400, { error: '请求体非合规 JSON' });
        return;
      }
      const command = String(body.command || '');
      const t0 = Date.now();
      const result = governor.auditCommand(command);
      const durationMs = Date.now() - t0;
      sendJson(res, 200, {
        ok: result.ok,
        reason: result.reason || (result.ok ? '规则匹配放行' : '被拦截'),
        gateType: governor.deriveGateType(result.reason),
        isPwshCmdlet: !!result.isPwshCmdlet,
        durationMs
      });
      return;
    }

    // —— 临时实验环境：挂载检查与 README 生成（需凭证，防任意本地进程触发挂载）——
    if (req.method === 'POST' && pathname === '/api/sandbox/ensure') {
      if (!verifySandboxToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。' });
        return;
      }
      const status = governor.ensureVirtualDrive();
      sendJson(res, 200, Object.assign({ ok: true }, status));
      return;
    }

    // —— 临时实验环境：命令执行（受控放行高危操作）——
    if (req.method === 'POST' && pathname === '/api/sandbox/exec') {
      if (!verifySandboxToken(req)) {
        sendJson(res, 401, { error: '未授权：Sandbox Token 无效或缺失。' });
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        sendJson(res, 400, { error: '请求体非合规 JSON' });
        return;
      }

      const command = String(body.command || '').trim();
      if (!command) {
        sendJson(res, 400, { error: '命令不能为空' });
        return;
      }

      const result = await governor.sandboxExec(command, { timeout_seconds: body.timeout_seconds });
      sendJson(res, 200, result);
      return;
    }

    // —— 真实 bash 审计流水（事件全量记录，会话字段恒空）——
    if (req.method === 'GET' && pathname === '/api/audit-logs') {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。审计流水含真实命令输出，不得匿名读取。' });
        return;
      }
      let content = '';
      let exists = false;
      try {
        content = fs.readFileSync(governor.AUDIT_LOG_FILE, 'utf8');
        exists = true;
      } catch (e) { /* 未开启审计或文件尚未生成 */ }

      const logs = [];
      for (const line of content.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try { logs.push(JSON.parse(t)); } catch (e) { /* 跳过坏行 */ }
      }

      const sessionMap = new Map();
      for (const entry of logs) {
        const sid = entry.sessionId === undefined ? null : entry.sessionId;
        const key = sid === null ? '__unattributed__' : String(sid);
        let s = sessionMap.get(key);
        if (!s) {
          s = { sessionId: sid, count: 0, allowed: 0, denied: 0, firstAt: entry.timestamp, lastAt: entry.timestamp };
          sessionMap.set(key, s);
        }
        s.count += 1;
        if (entry.allowed) s.allowed += 1;
        else s.denied += 1;
        s.lastAt = entry.timestamp;
      }

      sendJson(res, 200, {
        logs: logs.slice(-200).reverse(),
        sessions: Array.from(sessionMap.values()).sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || ''))),
        path: governor.AUDIT_LOG_FILE,
        exists
      });
      return;
    }

    // —— 回归实机执行（异步作业模型，需 Token）——
    if (req.method === 'POST' && pathname === '/api/run-regress') {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。' });
        return;
      }
      if (regressJob && regressJob.status === 'running') {
        sendJson(res, 409, { error: '回归作业进行中，请等待完成', jobId: regressJob.jobId });
        return;
      }

      const jobId = 'job-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      const scriptPath = path.join(REPO_ROOT, 'mcp', 'tests', 'plan-governor-regress.mjs');
      const MAX_OUTPUT = 2 * 1024 * 1024;
      let stdout = '';
      let stderr = '';
      const startedAt = Date.now();

      regressJob = { jobId, status: 'running', exitCode: null, stdout: '', stderr: '', startedAt, durationMs: 0, truncated: false };

      let child;
      try {
        // 显式置空审计/强制壳/钉 Git Bash 三 env，防子进程继承宿主 MCP 执行上下文
        // （regress harness 已全量剥离 MCP_* 前缀，此处为 webui 侧防御纵深）。
        child = spawn(process.execPath, [scriptPath], { cwd: REPO_ROOT, env: Object.assign({}, process.env, { MCP_ROLE: 'main', MCP_AUDIT_LOG: '', MCP_FORCE_SHELL: '', MCP_GIT_BASH: '' }) });
      } catch (e) {
        regressJob.status = 'error';
        regressJob.stderr = e.message;
        sendJson(res, 500, { error: '回归进程派生失败: ' + e.message });
        return;
      }

      child.stdout.on('data', (d) => {
        if (stdout.length < MAX_OUTPUT) { stdout += d.toString(); } else { regressJob.truncated = true; }
        regressJob.stdout = stdout;
      });
      child.stderr.on('data', (d) => {
        if (stderr.length < MAX_OUTPUT) { stderr += d.toString(); } else { regressJob.truncated = true; }
        regressJob.stderr = stderr;
      });

      // 锁释放：close 与 error 双回调统一收敛，任何分支都不得永久锁死
      const finish = (exitCode, err) => {
        if (!regressJob || regressJob.jobId !== jobId) return;
        regressJob.status = err ? 'error' : 'done';
        regressJob.exitCode = err ? 1 : exitCode;
        regressJob.durationMs = Date.now() - startedAt;
        regressJob.stdout = stdout;
        regressJob.stderr = stderr + (err ? '\n' + err.message : '');
      };
      child.on('close', (code) => finish(code, null));
      child.on('error', (err) => finish(1, err));

      sendJson(res, 202, { jobId, status: 'running' });
      return;
    }

    // —— 回归作业快照 ——
    if (req.method === 'GET' && pathname.indexOf('/api/run-regress/') === 0) {
      if (!verifyToken(req)) {
        sendJson(res, 401, { error: '未授权：Token 无效或缺失。回归快照含真实 stdout/stderr，需鉴权。' });
        return;
      }
      const jobId = pathname.slice('/api/run-regress/'.length);
      if (!regressJob || regressJob.jobId !== jobId) {
        sendJson(res, 404, { error: '未找到指定回归作业' });
        return;
      }
      sendJson(res, 200, regressJob);
      return;
    }

    sendJson(res, 404, { error: '端点不存在: ' + pathname });
  } catch (err) {
    sendJson(res, 500, { error: '服务器内部错误: ' + err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('\n');
  process.stdout.write('===============================================================\n');
  process.stdout.write('  Plan-Governor WebUI 工作台已启动\n');
  process.stdout.write('  地址       : http://127.0.0.1:' + PORT + '\n');
  process.stdout.write('  工作区     : ' + governor.WORKSPACE + '\n');
  process.stdout.write('  策略文件   : ' + governor.POLICY_FILE + '\n');
  process.stdout.write('  审计文件   : ' + governor.AUDIT_LOG_FILE + '\n');
  process.stdout.write('  管理凭证   : 复用 ~/.config/kilo/webui-token.txt（跨启动有效）\n');
  process.stdout.write('===============================================================\n\n');
});

// EADDRINUSE 等监听错误：干净退出，不覆盖任何磁盘状态（Token 复用优先策略的配套保障）
server.on('error', (err) => {
  process.stderr.write('[webui] 监听失败 (端口 ' + PORT + '): ' + (err && err.code === 'EADDRINUSE'
    ? 'EADDRINUSE —— 端口已被占用，检测到另一实例在运行，本实例退出。'
    : (err && err.message) || String(err)) + '\n');
  process.exit(3);
});

// =========================================================================
//      【 前端：外置单页应用 HTML = mcp/webui-client.html（含 38 图标字典、5 主题 CSS、4 工作台） 】
// =========================================================================

// —— 启动序 6：SPA 客户端自外置 webui-client.html 读入（源码多行、可直接编辑；缺失即退出）——
const CLIENT_HTML_FILE = path.join(__dirname, 'webui-client.html');
let CLIENT_HTML;
try {
  CLIENT_HTML = fs.readFileSync(CLIENT_HTML_FILE, 'utf8');
} catch (e) {
  process.stderr.write('[webui] 无法读取 ' + CLIENT_HTML_FILE + ': ' + e.message + '\n');
  process.exit(4);
}
