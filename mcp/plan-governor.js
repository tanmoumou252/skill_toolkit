#!/usr/bin/env node
/**
 * plan-governor.js（恒定最严档 + 写面蜜罐引导闸，零外部依赖）
 *
 * 机制 = 双实例能力绑定（capability binding），非 server 端 RBAC——
 * server 不解析调用者身份，身份由实例注册 env 在启动期静态绑定。
 *
 * 写面 = 蜜罐引导闸：三个写工具不再落盘，调用即 isError，回执灌"分派 plan-writer
 * 子代理、经受控写工具 write_scoped_file（zcode）／宿主原生写工具（kilocode、codebuddy）落盘"的引导话术；subagent 实例恒拒。
 * 每次命中记 stderr 一行 HONEYPOT-HIT（tool/role/mode/sid），供宿主日志审计。
 * 本 server 默认对文件系统零写入：不备份、不写产物。
 * 显式例外一（落工作区）：受控写工具 write_scoped_file 命中时写 .kilo/plans/ 下 .md，
 *   并按需创建其父目录骨架（仅该工具触发；是唯一落工作区的写面）。
 * 显式例外二（工作区之外）：宿主以 MCP_AUDIT_LOG=1 注册时，每次命令裁决与执行结果追加一行 JSON 至
 *   ~/.config/kilo/governor-audit.jsonl（用户级，与工作区 cwd 解耦；供本地 WebUI 监控真实审计流）；
 *   未开启时零副作用。
 * 边界如实声明：蜜罐只拦 MCP 通道——zcode 子代理写面走受控写工具 write_scoped_file（原生 Write/Edit 已下线），kilocode/codebuddy 子代理经宿主原生写工具直写 .kilo/plans/；它是引导，不是围栏。
 * 显式例外三（ensureVirtualDrive 写面）：沙箱就绪阶段创建 T 盘 README 及目录骨架，
 *   探针 sandbox-readme-auto-created 实证该写入；另 subst 挂载操作（subst T: /D 拆挂 + 重挂）
 *   属 OS 虚拟盘映射，不等同文件写入。密钥 token 写入归属 webui.js（:49 admin token / :64 sandbox token），不在本文件。
 *
 * 双实例（同一份代码，两份注册）：
 *   - plan-governor-main    : env { MCP_ROLE: "main" }
 *   - plan-governor-subagent: env { MCP_ROLE: "subagent" }
 *
 * 模式通道：本 server 不依赖会话模式信号——MCP 协议不向 server 注入模式状态，
 *   故 main 实例一律按最严档（plan）执法。密钥文件 policy-key 的唯一职责是策略文件 HMAC 签名与验签。
 *
 * main 实例执法（每次 tools/call，结构闸/黑名单/禁入恒先于模式，任何模式都拒）：
 *   - 恒 plan 最严档：只允许白名单只读/测试命令；灰区、写命令一律 deny 并引导走宿主原生交互。
 *   本 server 绝不弹 OS 窗。
 *
 * subagent 实例执法（恒定最严）：
 *   白名单只读/测试静默放行；灰区/禁入/黑名单/结构闸一律静默 deny（0 弹窗）；写工具恒拒（蜜罐）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { exec, execSync, spawnSync } = require('child_process');

const WORKSPACE = process.cwd();

// 身份 = 实例绑定（启动期 env 静态确定；未登记值按最严 subagent fail-closed）
const ROLE = process.env.MCP_ROLE === 'main' ? 'main' : 'subagent';

// ============ 统一路径布局（用户级 + 项目级两层）============
//   布局分两层，与宿主 .kilo 同族：
//     · 用户级：~/.config/kilo/   —— 密钥 / Token / 审计流水（全局唯一，与工作区解耦）
//     · 项目级：<工作区>/.kilo/   —— 策略与模式文件（随项目走，与宿主既有 .kilo 同族）
//   回退路径只读：主路径缺失时自动采用，无需手工迁移。
const KILO_USER_DIR = path.join(os.homedir(), '.config', 'kilo');

// 策略/模式目录：工作区 .kilo/（主）；.zcode/（回退）。
const MODE_DIR = fs.existsSync(path.resolve(WORKSPACE, '.kilo'))
  ? path.resolve(WORKSPACE, '.kilo')
  : path.resolve(WORKSPACE, '.zcode');

// 策略签名密钥：~/.config/kilo/policy-key（用户级，工作区之外），唯一职责是 governor-policy.json 的 HMAC 签名与验签。
//   解析序：policy-key 在场即主路径；否则从既有回退位（mode-key → .zcode/cli/mode-key）复制迁移；皆不存在时新生成。
//   主路径优先存在即胜出，防回退位陈旧密钥反向覆盖生效链。
//   迁移与生成共用同一落点 policy-key。
function resolvePolicyKeyFile() {
  const primary = path.join(KILO_USER_DIR, 'policy-key');
  const legacy = path.join(KILO_USER_DIR, 'mode-key');
  const legacyCli = path.join(os.homedir(), '.zcode', 'cli', 'mode-key');
  // 主路径存在即直接胜出：防回退位陈旧密钥覆盖生效链。
  if (fs.existsSync(primary)) return primary;
  for (const src of [legacy, legacyCli]) {
    if (fs.existsSync(src)) {
      try {
        if (!fs.existsSync(KILO_USER_DIR)) fs.mkdirSync(KILO_USER_DIR, { recursive: true });
        fs.copyFileSync(src, primary);
        fs.chmodSync(primary, 0o600); // 迁移与生成路径权限声明一致（Windows 上仅声明性）
        return primary;
      } catch (e) { return src; }
    }
  }
  try {
    if (!fs.existsSync(KILO_USER_DIR)) fs.mkdirSync(KILO_USER_DIR, { recursive: true });
    fs.writeFileSync(primary, crypto.randomBytes(16).toString('hex') + '\n', { mode: 0o600 });
  } catch (e) { /* 生成失败则 loadPolicy 按"密钥缺失"回退出厂基线 */ }
  return primary;
}
const POLICY_KEY_FILE = resolvePolicyKeyFile();

// =========================================================================
//          【 《命令边界总表》核心规则定义（已并入旧命令守卫键表全集） 】
// =========================================================================

// 允许清单 (ALLOW)：全角色只读取证与测试放行（含增量键 whoami* / diff*）
const ALLOW_KEYS = [
  // Git 只读
  'git status*', 'git log*', 'git diff*', 'git show*', 'git rev-parse*', 'git grep*',
  'git ls-files*', 'git ls-tree*', 'git rev-list*', 'git shortlog*', 'git blame*',
  'git cat-file*', 'git for-each-ref*', 'git describe*', 'git merge-base*',
  'git tag', 'git tag -l*', 'git tag --list*',
  'git branch', 'git branch -a*', 'git branch -r*', 'git branch -v*',
  'git branch --all*', 'git branch --list*', 'git branch --show-current*',
  // POSIX / 系统只读
  'ls*', 'cat*', 'grep*', 'head*', 'tail*', 'wc*', 'pwd*', 'date*', 'where.exe*', 'rg*',
  'whoami*', 'diff*',
  // PowerShell 7 Cmdlet 只读（与 pwsh-gnu-bridge skill 的 GNU→Cmdlet 对译面对齐；全部为纯查询语义，无写盘副作用）
  'get-childitem*', 'get-content*', 'get-date*', 'select-string*', 'test-path*', 'measure-object*', 'out-string*',
  'get-process*', 'get-service*', 'get-command*', 'get-member*', 'get-help*', 'get-item*', 'get-location*',
  'get-variable*', 'get-host*', 'get-history*', 'get-random*', 'get-psdrive*', 'get-itemproperty*',
  'get-acl*', 'get-authenticodesignature*', 'get-filehash*', 'get-computerinfo*', 'get-culture*', 'get-uiculture*',
    // 自动化测试套件（登记即等价于"可执行该文件"的入口，新增键前须自问：它是否等于任意代码执行？）
    //   'node --test*' / 'node --run*' 曾在此登记，二者把任意 .mjs/.js 当作测试文件执行，
    //   属任意 JS 执行入口，与「收紧模式下 exec 通道已封死」的信任环声明冲突，已移除。
    //   保留项的边界：仅登记"固定语义的测试运行器入口"（npm test / pytest / go test …），
    //   其执行对象由宿主工程自身决定；不登记任何"把指定文件当脚本执行"的入口。
  'pytest*', 'python -m pytest*', 'py -m pytest*', 'npm test*', 'pnpm test*',
  'cargo test*', 'go test*', 'mvn test*', 'vitest*', 'jest*', 'python -m unittest*'
];

// 拒绝清单 (DENY)：全角色全模式绝不执行（高危破坏/写通道/状态变更；含 Git Bash 现实补盲 25 键）
const DENY_KEYS = [
  'set-content*', 'add-content*', 'out-file*', 'new-item*', 'remove-item*',
  'clear-content*', 'move-item*', 'copy-item*', 'rename-item*',
  'cp*', 'xcopy*', 'robocopy*', 'rm*', 'del*', 'rd*', 'rmdir*',
  'git difftool*', 'git add*', 'git commit*', 'git push*', 'git reset*', 'git checkout*', 'git stash*',
  'npm install*', 'pip install*',
  // —— Git Bash 现实补盲（bash 原生写通道，段首前缀匹配，与旧守卫键序一致）——
  'mv *', 'mv', 'touch*', 'tee*', 'dd*', 'ln *', 'chmod*', 'chown*', 'truncate*', 'sed -i*',
  'node -e*', 'node --eval*', 'node -p*', 'node --print*', 'python -c*', 'python3 -c*', 'py -c*',
  'perl -e*', 'ruby -e*', 'php -r*',
  'npm ci*', 'git clean*', 'git restore*', 'git apply*', 'git switch*'
];

// 禁入清单 (FORBIDDEN)：隐式写操作或任意执行，全角色全模式一律 deny（main 实例不再弹窗代收）
const FORBIDDEN_KEYS = [
  'find*', 'awk*', 'sed*', 'sort*', 'uniq*', 'xargs*',
  'select-object*', 'where-object*', 'sort-object*', 'format-table*', 'format-list*'
];

const PWSH_CMDLET_PREFIXES = [
  // 必须与 ALLOW_KEYS（:106-109）的 PowerShell Cmdlet 子集逐一对齐：
  // 白名单放行的每个 cmdlet 都在此登记路由前缀，否则错路由到 Git Bash → exit 127。
  'get-childitem', 'get-content', 'get-date', 'select-string', 'test-path', 'measure-object', 'out-string',
  'get-process', 'get-service', 'get-command', 'get-member', 'get-help', 'get-item', 'get-location',
  'get-variable', 'get-host', 'get-history', 'get-random', 'get-psdrive', 'get-itemproperty',
  'get-acl', 'get-authenticodesignature', 'get-filehash', 'get-computerinfo', 'get-culture', 'get-uiculture'
];

// =========================================================================
//   【 外部策略文件（HMAC 验真 + mtime 热重载）与可选审计流（opt-in） 】
// =========================================================================

// 策略文件 = 黑白名单的唯一事实源，用户级全局唯一（~/.config/kilo/）。
//   为什么不放工作区：WebUI 是全局单实例（127.0.0.1 一台机器一个），其策略写面天然全局；
//   MCP 是每会话一实例，裁决读面锚在各自 WORKSPACE。全局写面 × 局部读面必然错位——
//   在工作区 B 的会话里经 WebUI 加的规则会落到源码仓库 A，B 永远读不到。
//   黑白名单语义本就是「这台机器上哪些命令危险」，全局一份才自洽；密钥 policy-key 亦在用户区，验签链不变。
//   迁移：工作区旧策略在场且用户区无策略时，启动搬迁一次（保留签名，原样复制）。
const POLICY_FILE = path.join(KILO_USER_DIR, 'governor-policy.json');
(() => {
  if (fs.existsSync(POLICY_FILE)) return;
  const legacy = path.resolve(WORKSPACE, '.kilo', 'governor-policy.json');
  const legacyZcode = path.resolve(WORKSPACE, '.zcode', 'governor-policy.json');
  for (const old of [legacy, legacyZcode]) {
    if (fs.existsSync(old)) {
      try {
        fs.copyFileSync(old, POLICY_FILE);
        process.stderr.write(`[plan-governor] POLICY-MIGRATED ${old} -> ${POLICY_FILE}\n`);
      } catch { /* 迁移失败按无策略处理（回退出厂基线） */ }
      return;
    }
  }
})();

// 审计流水：用户级，全局唯一（~/.config/kilo/）。
//   为什么不放工作区：server 的 WORKSPACE 锚在自身启动 cwd，若日志跟着工作区走，
//   宿主从别的项目根拉起本 server 时流水会散落到那个项目下，WebUI 将读不到（静默空态）。
//   放用户级后任何工作区起的实例都汇到同一处；每条记录带 workspace 字段标明来源。
const AUDIT_LOG_DIR = KILO_USER_DIR;
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'governor-audit.jsonl');

// 规范串带独立域前缀（governor-policy），与其他 HMAC 用途密码学隔离。
function canonicalPolicy(p) {
  return JSON.stringify([
    'governor-policy', 1,
    [...(Array.isArray(p.customAllow) ? p.customAllow : [])].sort(),
    [...(Array.isArray(p.customDeny) ? p.customDeny : [])].sort(),
  ]);
}

function signPolicy(p, keyHex) {
  return crypto.createHmac('sha256', keyHex).update(canonicalPolicy(p)).digest('hex');
}

// 缓存：mtimeMs 未变则复用；缺失 / 损坏 / 验签失败一律回退出厂基线并向 stderr 告警。
let policyCache = { mtimeMs: -1, allow: [], deny: [] };

function loadPolicy() {
  let st;
  try { st = fs.statSync(POLICY_FILE); }
  catch { if (policyCache.mtimeMs !== -1) policyCache = { mtimeMs: -1, allow: [], deny: [] }; return policyCache; }
  if (st.mtimeMs === policyCache.mtimeMs) return policyCache;

  const fail = (why) => {
    process.stderr.write(`[plan-governor] POLICY-FAIL ${why}；已回退出厂基线\n`);
    policyCache = { mtimeMs: st.mtimeMs, allow: [], deny: [] };
    return policyCache;
  };

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')); }
  catch { return fail('策略文件 JSON 损坏'); }

  let key;
  try { key = fs.readFileSync(POLICY_KEY_FILE, 'utf8').trim(); }
  catch { return fail('密钥缺失，无法验签策略'); }

  const sig = typeof parsed.sig === 'string' ? parsed.sig.toLowerCase() : '';
  const expect = signPolicy(parsed, key);
  if (!/^[0-9a-f]{64}$/i.test(sig) || !crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expect, 'hex'))) {
    return fail('策略签名校验失败（疑似篡改）');
  }

  policyCache = {
    mtimeMs: st.mtimeMs,
    allow: Array.isArray(parsed.customAllow) ? parsed.customAllow : [],
    deny: Array.isArray(parsed.customDeny) ? parsed.customDeny : [],
  };
  return policyCache;
}

// 生效键表：出厂基线 ∪ 策略自定义。customDeny 只会更严；customAllow 仅在全部结构硬闸与黑名单之后被消费。
function effectiveDenyKeys() { const p = loadPolicy(); return p.deny.length ? DENY_KEYS.concat(p.deny) : DENY_KEYS; }
function effectiveAllowKeys() { const p = loadPolicy(); return p.allow.length ? ALLOW_KEYS.concat(p.allow) : ALLOW_KEYS; }

// 裁决分类：auditCommand 只返回 { ok, reason }，此处按回执前缀派生稳定枚举供 UI 展示与统计。
function deriveGateType(reason) {
  const r = String(reason || '');
  if (r.startsWith('[黑名单拒绝]')) return 'blacklist';
  if (r.startsWith('[禁入清单拒绝]')) return 'forbidden';
  if (r.startsWith('[子代理越权阻断]')) return 'rbac';
  if (r.startsWith('[模式闸拦截')) return 'mode';
  if (r.startsWith('当前权限模式下未登记命令一律拒绝')) return 'mode';
  if (r.startsWith('[跨区闸拦截]')) return 'path_domain';
  if (r.startsWith('[时钟闸拦截]')) return 'clock_write';
  if (r.startsWith('[结构闸拦截]')) return 'structure';
  return 'unknown';
}

// 可选真实审计流：默认关闭（守住零写入不变式）；MCP_AUDIT_LOG=1 时每次裁决/执行追加一行 JSON。
function appendAuditRecord(record) {
  if (process.env.MCP_AUDIT_LOG !== '1') return;
  try {
    if (!fs.existsSync(AUDIT_LOG_DIR)) fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* 审计写入失败绝不中断主命令通道 */ }
}

// =========================================================================
//                   【 引号感知掩码（对齐旧命令守卫） 】
// =========================================================================

// 单引号内：`; | & < >` 掩成空格（死分隔符），`` ` `` 与 `$` 掩成占位符 `_`；双引号内只掩 ; | & < >，保留 $ 与反引号
// （bash 双引号内 $(...) 与反引号是活命令替换，掩掉会把 deny 的命令变为放行）。
// 为什么单引号内的 $ / 反引号用 `_` 而不用空格：空格是 token 分隔符，会把一个实参凭空切两段——
//   实测 `git grep -F '-s$/.test(a)'` 被切成 `-s` + `/.test`，`/.test` 被闸 3.8 判成区外绝对路径（误伤）。
//   单引号内 bash 不做任何展开，故只需让这两个字符对闸 0.5（判 base 含 `$`/反引号）隐身，
//   不必制造边界；`_` 非 PD_SPLIT 成员、亦不被任何键表匹配，属中性占位符（与 maskQuotedRegions 同风格）。
// 转义：引号外与双引号内 \X 逐字复制不参与开闭/掩码；单引号内 bash 不处理转义。
// 引号不闭合返回 null，调用方回退原始小写（保守基线，不更松不更严）。
function quoteMask(low) {
  let out = '', quote = null;
  for (let i = 0; i < low.length; i++) {
    const c = low[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      out += ';|&<>'.includes(c) ? ' ' : ('`$'.includes(c) ? '_' : c);
    } else if (quote === '"') {
      if (c === '\\' && i + 1 < low.length) { out += c + low[i + 1]; i++; continue; }
      if (c === '"') quote = null;
      out += ';|&<>'.includes(c) ? ' ' : c;
    } else {
      if (c === '\\' && i + 1 < low.length) { out += c + low[i + 1]; i++; continue; }
      if (c === '"' || c === "'") quote = c;
      out += c;
    }
  }
  return quote === null ? out : null;
}

// 去引号基底：把 quoteMask 输出里的引号字符删掉、把 \X 解析为 X，逼近 bash 执行视图
// （bash 执行前会做 quote removal 与转义解析）。
// 为什么必须在 quoteMask 之后做：quoteMask 已把引号内的 ;|&<> 掩成空格，再删引号不会
//   让它们复活；若顺序颠倒（先去引号再掩码），git log --format="%h; %s" 的引号内 ; 会
//   变成活分隔符，被误判为复合命令，破坏既有 struct-quotemask-allow 用例。
// 为什么不会制造新放行：quoteMask 只会把危险字符替换为空格或逐字复制，dequote 只做
//   删除与解析、不新增任何字符 ⇒ 去引号后不可能凭空出现 ; & | > <。
// 偏严说明：bash 在单引号内不处理 \，此处统一解析为 X，属 fail-closed 方向的偏差。
function dequote(masked) {
  let out = '';
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '\\' && i + 1 < masked.length) { out += masked[i + 1]; i++; continue; }
    if (c === "'" || c === '"') continue; // 引号仅是语法标记，bash 执行视图不保留
    out += c;
  }
  return out;
}

const COMPOUND_RE = /[;&]|\|\||\n/;
const NONFLAT_RE = /[<>]|\$\(|`/;

// —— 结构硬闸正则集中定义（模块级常量）——
// 为什么提到模块级：原先这些正则是 auditCommand 内的 const，每次调用都要重建一次正则对象；
//   集中到模块级与 COMPOUND_RE / NONFLAT_RE 同风格，也让"键表 + 闸面"能在同一处对账。
const WRAPPER_RE = /^\s*(?:command|env|nohup|eval|exec|builtin|time)\s+\S/;
// 为什么允许路径前缀：壳可以带绝对路径/相对路径调用（/bin/bash、/usr/bin/sh、./bash、
//   C:/…/bash.exe），只认裸 `bash` 会让整族绕过——实测 `/bin/bash -c "rm -rf x"` 曾 ALLOW。
//   路径段字符类须含 `:` 与空格：Windows 盘符/含空格目录（`C:/…`、`C:/Program Files/…`）
//   的段首带 `:` 与空格，缺任一字符则路径段吞不下 ⇒ 整族漏网（起草期实测两轮 MISS，已补）。
//   路径段限定为 [\w.:\\\/\s-]* 后紧跟 / 或 \，避免把 `git show`、`git status` 这类含 sh
//   但不以 sh 收尾的合法命令误判为壳（负向基准见用例 shellpath-status-s/show-stat/ls-o）。
const SHELL_C_RE = /^\s*(?:[\w.:\\\/\s-]*[\/\\])?(?:ba|z|k|da)?sh(?:\.exe)?\s+(?:-[a-z]*[ce][a-z]*\b|-[a-z]+\s+-[a-z]*[ce][a-z]*\b|--\S+(?:\s+-\S+)*\s+-c\b)/;
// —— 壳的非 -c 任意执行 ——
// 为什么必须有第二条：SHELL_C_RE 只认"壳 + -c 系参数"，而 `sh script.sh`、`bash script.sh`、
//   `/bin/bash script.sh`、`sh < script.sh` 同样是把任意脚本交给壳执行——与 `-c` 同性质。
//   脚本本体可含任意命令，黑名单前缀匹配对它整体失效。
// 形态：壳名（可带路径前缀）+ 至少一个参数（脚本路径 / `<` 重定向 / 任意其它参数）。
//   只要"壳 + 参数"即拒——壳本身在只读取证里没有合法用途。
const SHELL_ANY_RE = /^\s*(?:[\w.:\\\/\s-]*[\/\\])?(?:ba|z|k|da)?sh(?:\.exe)?\s+\S/;
const EXEC_DERIVE_RE = /(?:^|\s)(?:--op(?:e(?:n(?:-(?:f(?:i(?:l(?:e(?:s(?:-(?:i(?:n(?:-(?:p(?:a(?:g(?:e(?:r)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?|--ext-diff|--paginate|--config-env|--pre(?:-command|-glob)?|--textc(?:onv)?|--filters)(?:=|\s|$)/i;
// 为什么 -c 后从 \s+ 放宽为 \s*：git 支持紧贴式 `-c<key>=<value>`，强求空白会让
//   `git -ccore.pager=sh log` 整族绕过。放宽不会误伤良性键——执行面键列表外的键
//   （如 core.quotepath）本就不在匹配集合内，见用例 exec-derive-tight-c-benign-allow。
const GIT_EXEC_CONFIG_RE = /^\s*git\s+-c\s*(?:core\.pager|core\.editor|core\.sshcommand|core\.hookspath|core\.fsmonitor|diff\.external|interactive\.difffilter)\s*=/i;

// —— git -c 异形键名 ——
// 为什么改用"键名前缀族"而非精确键名：实测 `git -ccore.pagerX=sh log`、`git -c core.pager2=sh log`
//   均 ALLOW。逐个登记异形键名不收敛（后缀可任意变形），故按执行面键名的**前缀**收口——
//   凡以 core.pager / core.editor / core.sshcommand / core.hookspath / core.fsmonitor /
//   diff.external / interactive.difffilter 打头的键一律拦（含任意后缀）。
// 为什么不误伤良性键：core.quotepath 等良性键不以任何执行面键名为前缀，
//   见负向基准 gitkey-quotepath-allow-kept。
const GIT_EXEC_KEY_PREFIX_RE = /^\s*git\s+-c\s*(?:core\.pager|core\.editor|core\.sshcommand|core\.hookspath|core\.fsmonitor|diff\.external|interactive\.difffilter)/i;

// —— git 别名执行面 ——
// 为什么必须拦：`git config alias.x '!cmd'` 可写入别名，之后 `git x` 即为**任意命令通道**
//   （段首是 `git x`，不命中任何拒绝键；真命令藏在别名定义里）。别名定义属配置写操作，
//   按黑名单同级别处理。
// 为什么放行明确只读标志：`git config --list` / `--get` 是常用只读取证手段，
//   全拦会引入不必要的假拒绝。读标志必须**紧跟** `git config`，
//   故 `git config --global --list` 仍会被拦（登记为已知假拒绝）。
const GIT_CONFIG_RE = /^\s*git\s+config(?:\s|$)/;
const GIT_CONFIG_READ_RE = /^\s*git\s+config\s+(?:-l|--list|--get|--get-all|--get-regexp)(?:\s|$)/;

// —— 环境变量注入面 ——
// 为什么必须拦前置赋值：`GIT_PAGER=sh git log`、`PAGER=sh git log`、
//   `GIT_EXTERNAL_DIFF=sh git diff`、`BASH_ENV=x sh -c true` 这类形态可静默派生外部进程。
//   参数面闸（3.6）只查 `-c` 与 `--*`，对"命令前的前置 VAR=VAL 赋值"完全无效，
//   而这些变量恰能派生外部进程。段首形如 `IDENT=值` 且后跟命令 ⇒ 一律硬拒。
// 判 base（去引号视图）：`GIT_PAGER='sh' git log` 之类引号变形同样须拦。
// 偏严取舍：`FOO=bar ls -o` 这类良性前置赋值也会被拒，属 fail-closed 方向的可接受代价。
const ENV_ASSIGN_RE = /^\s*[A-Za-z_][A-Za-z0-9_]*=/;

// —— 花括号 / 浪号 / glob 展开族 ——
// 为什么必须拦：已实跑证实 shell 会真实展开这三族——`echo {echo,BRACEWORKS}` 输出
//   `echo BRACEWORKS`（**命令位**可被花括号构造）、`echo ~` 展开为 home 绝对路径、
//   `echo zebra*` 展开为真实文件名。闸 0.5 只拒 `$` 与反引号，对这三族无效。
// 偏严取舍：`grep -c 'a{2}'` 这类把花括号当字面量的合法正则也会被拒。
//   取舍理由：花括号在只读取证命令中极少作字面量，而命令位可构造属高危，按 fail-closed 拒。
const BRACE_EXPAND_RE = /\{[^{}]*,[^{}]*\}|\{[^{}]*\.\.[^{}]*\}/; // 逗号序列 {a,b} 或范围 {1..5}
const TILDE_EXPAND_RE = /(?:^|\s)~[A-Za-z0-9_.\/-]*(?=\s|$)/;
//   关键：判"引号外视图"（maskQuotedRegions）。`find . -name "*.md"` 的 `*` 在引号内，
//   shell 不展开 ⇒ 被屏蔽，不命中。若误对 base 判 `*`，会把既有用例
//   subagent-forbidden-deny 的回执从"禁入清单拒绝"改成"展开构造"（实测复现的回归破坏）。
const GLOB_WILDCARD_RE = /[*?]/; // 引号外残留的字面量 * 或 ? = shell 会展开 ⇒ 拒

function matchKey(segLower, key) {
  const kLower = key.toLowerCase();
  if (kLower.endsWith('*')) return segLower.startsWith(kLower.slice(0, -1));
  return segLower === kLower;
}

// 隐式 diff 派生防御：.gitattributes 可声明 diff=xxx / textconv 驱动，使白名单内普通的
//   git diff/log/show 在执行时隐式调起外部程序——EXEC_DERIVE_RE 只拦显式旗标，拦不住
//   这类仓库侧配置派生。故对放行的 git diff/log/show 在 exec 前自动追加
//   --no-ext-diff --no-textconv（已显式携带的旗标不重复追加）；对 git grep 追加
//   --no-textconv --no-open-files-in-pager（grep 不识别 --no-ext-diff，勿误加）。
//   旗标插在子命令词之后、参数区之前，绝不落进带引号参数内部；分段按 "|" 切，
//   仅改写 git diff/log/show/grep 段。不加新黑名单键、不改白名单匹配面、不动 EXEC_DERIVE_RE。
function hardenGitDiffCommand(cmd) {
  return String(cmd || '').split('|').map((seg) => {
    const m = /^(\s*git\s+)(diff|log|show|grep)\b/i.exec(seg);
    if (!m) return seg;
    const sub = (m[2] || '').toLowerCase();
    return seg.replace(/^(\s*git\s+)(diff|log|show|grep)\b/i, (m0) => {
      let h = m0;
      if (sub === 'grep') {
        if (!/(?:^|\s)--no-textconv(?:\s|$)/i.test(seg)) h += ' --no-textconv';
        if (!/(?:^|\s)--no-open-files-in-pager(?:\s|$)/i.test(seg)) h += ' --no-open-files-in-pager';
      } else {
        if (!/(?:^|\s)--no-ext-diff(?:\s|$)/i.test(seg)) h += ' --no-ext-diff';
        if (!/(?:^|\s)--no-textconv(?:\s|$)/i.test(seg)) h += ' --no-textconv';
      }
      return h;
    });
  }).join('|');
}

// 视图一致性判定：与 auditCommand 同一基底管线（quoteMask → dequote → fd 重定向掩码 → 分段），
//   判定按 "|" 逐段进行，与 hardenGitDiffCommand 的分段口径同构；任一段"去引号命中而原始形未命中"即整体拒绝
//   成立即意味着命令名词被引号包裹（'git' diff、git "diff"）：白名单在去引号视图上放行，
//   而 hardenGitDiffCommand 的原始串锚定失配、旗标无处可插 ⇒ 隐式派生防御被整体旁路。
//   返回 true 时调用方必须拒绝，不得尝试回填旗标——把旗标塞进引号内会改变语义。
function hardenViewDiverges(cmd) {
  const segs = String(cmd || '').split('|');
  for (const seg of segs) {
    const low = seg.toLowerCase();
    const masked = quoteMask(low);
    const base = dequote(masked === null ? low : masked).replace(/\s*\d?>&\d/g, ' ').trim();
    if (!/^git\s+(diff|log|show|grep)\b/i.test(base)) continue;
    if (!/^(\s*git\s+)(diff|log|show|grep)\b/i.test(seg)) return true;
  }
  return false;
}

// 只在【引号外】查找字符：引号内的 `*`、`?`、`~` 是字面量，shell 不展开，不应触发展开闸。
// 为什么需要它：quoteMask 只掩 `; | & < > ` 与 $`，**不掩** `*` 与 `?`；
//   dequote 又会把引号字符删掉但保留内部内容 ⇒ base 里仍有 `"*.md"` 的 `*`。
//   若直接对 base 判 `*`，会把既有用例 `find . -name "*.md"` 误判为 glob 展开，
//   把回执从"禁入清单拒绝"改成"展开构造"——属回归破坏（实测复现）。
// 转义引号处理（完全对齐 quoteMask 状态机）：
//   - 引号外 `\X`：逐字复制两个字符，跳过后续解析——`\"` 属字面引号，**不**开启引用区；
//   - 双引号内 `\X`：逐字复制两个字符——双引号内 `\"` 属字面引号，**不**闭合引用区；
//   - 单引号内：`\` 属字面量（bash 单引号内无转义），逐字替换为占位符 `_`。
// 返回：把引号内区域整体替换为占位符后的字符串（长度不变，便于后续定位）。
function maskQuotedRegions(s) {
  let out = '', quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === "'") {
      if (c === "'") { quote = null; out += c; continue; }
      out += '_'; continue;
    } else if (quote === '"') {
      if (c === '\\' && i + 1 < s.length) { out += '__'; i++; continue; } // 转义字符连同反斜杠整体占位
      if (c === '"') { quote = null; out += c; continue; }
      out += '_'; continue;
    } else {
      if (c === '\\' && i + 1 < s.length) { out += c + s[i + 1]; i++; continue; } // 引号外转义：保留原样（\" 不开启引用）
      if (c === '"' || c === "'") { quote = c; out += c; continue; }
      out += c;
    }
  }
  return out;
}

// =========================================================================
//                 【 模式读取（硬编码最严档） 】
// =========================================================================

// 本 server 不依赖会话模式信号，一律按最严档（plan）执法。
//   主通道白名单（只读与测试命令）不受影响；灰区/写命令一律拒绝并引导走宿主原生交互。
//   本函数为策略校验的唯一入口，供各消费点稳定调用。
function readVerifiedMode() {
  return { mode: 'plan', note: null };
}

// =========================================================================
//          【 能力绑定执法引擎 (全角色恒定最严档) 】
// =========================================================================

// 跨区路径闸（3.8）判定用：把两个视图各切成 token，识别路径形态后逐个实解析判定。
// 视图取并集：low 保留反斜杠（抓 C:\…），base 保留去引号/转义后的真实执行视图（抓 r'm'-类混淆与转义路径）。
const PD_EXEMPT = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/fd/1', '/dev/fd/2', 'nul']);
const PD_SPLIT = /[\s'"`;<>(){}[\],;|&]+/;
const PD_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// 剥掉选项前缀，取出可能被 `--k=v` 粘连的路径本体。
function pdNormalize(tok) {
  let t = tok;
  const eq = t.indexOf('=');
  if (/^-/.test(t) && eq > 0) t = t.slice(eq + 1);
  t = t.replace(/^-+/, '');
  t = t.replace(/[\\]+$/, '');
  return t;
}

// 紧贴式选项实参：`-fC:\…` / `-CC:/…` / `-o/etc/x` 把区外绝对路径藏在 token 中段。
//   pdNormalize 只剥前导横线，pdIsPathShape 又锚定 token 首字符，二者叠加使整类形态漏判。
//   本函数在剥掉前导横线后于 token 中段再取一次路径候选（优先盘符绝对路径，其次 POSIX 绝对路径）。
function pdEmbedded(tok) {
  if (!tok || PD_SCHEME.test(tok)) return null; // 带 scheme 的 URL 不是路径，先排除（否则 http:// 的 "p:/" 会误命中）
  const t = String(tok).replace(/^-+/, '');
  if (!t) return null;
  const drv = t.match(/[a-z]:[\\/][^\s'"`|;&]*/i);
  if (drv) return drv[0].replace(/[\\]+$/, '');
  // POSIX 形态只在「选项值本身以 / 开头」时取：token 须形如 `-f/etc/x`（1~2 个短旗标字母紧跟 `/`）。
  //   语义依据：POSIX 绝对路径必以 `/` 起头，故真绕过的形态就是"旗标字母 + /"。
  //   这样一并挡掉两类误伤（旧判据"从首个 / 起取候选"都会打死）：
  //     `-s$/.test(a)` → `-s` 后是 `$`，值不是路径（实测撞到的只读 git grep）；
  //     `-Ffoo/bar`    → 值是相对路径，其 `..` 上跳本就由 pdNormalize + pdIsPathShape 那条通路负责。
  //   不放过计划内样本 `-f/etc/x`；`-oC:/…` 一类盘符形态由上方 drv 分支先取。
  if (/^-{1,2}[A-Za-z]\//.test(String(tok))) {
    const posix = t.match(/\/[^\s'"`|;&]*/);
    if (posix) return posix[0].replace(/[\\]+$/, '');
  }
  return null;
}

// 路径形态判据：裸盘符 token、带分隔符的盘符绝对路径、POSIX 绝对路径、UNC、`..` 上跳。
function pdIsPathShape(p) {
  if (!p) return false;
  if (/^[a-z]:$/i.test(p)) return true;
  if (/^[a-z]:[\\/]/i.test(p)) return true;
  // 驱动器相对路径（C:foo / C:Windows）：以盘符的"当前目录"为起点，仍锚定物理盘，同属跨区面
  if (/^[a-z]:[^\\/]/i.test(p)) return true;
  if (p.startsWith('/') || p.startsWith('\\\\')) return true;
  if (p === '..' || /^\.\.[\\/]/.test(p) || /[\\/]\.\.([\\/]|$)/.test(p)) return true;
  return false;
}

function pdHarvest(view) {
  const out = [];
  for (const raw of view.split(PD_SPLIT)) {
    if (!raw) continue;
    const n = pdNormalize(raw);
    if (pdIsPathShape(n)) out.push(n);
    const e = pdEmbedded(raw);
    if (e && pdIsPathShape(e)) out.push(e);
  }
  return out;
}

function pathDomainHits(lowView, baseView) {
  const cand = new Set([...pdHarvest(lowView), ...pdHarvest(baseView)]);
  const hits = [];
  for (const p of cand) {
    if (!p || PD_EXEMPT.has(p)) continue;
    if (PD_SCHEME.test(p)) continue;
    // 裸盘符（`ls C:`）在 Windows 上是"该盘当前目录"的相对语义，resolve 可能恰好落回工作区，
    //   故不解析、直接判为区外引用。
    if (/^[a-z]:$/i.test(p)) { hits.push(p); continue; }
    // 驱动器相对路径（`C:Windows`）同理：以该盘"当前目录"为起点解析，WORKSPACE 恰在同盘时会落回区内，
    //   与裸盘符同源，须不解析、直接判区外引用。
    if (/^[a-z]:[^\\/]/i.test(p)) { hits.push(p); continue; }
    const rel = path.relative(WORKSPACE, path.resolve(WORKSPACE, p));
    if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) hits.push(p);
  }
  return [...new Set(hits)];
}

function auditCommand(rawCmd) {
  const cmd = String(rawCmd || '').trim();
  if (!cmd) return { ok: false, reason: '[结构闸拦截] 空命令：无可执行内容。' };
  const low = cmd.toLowerCase();

  // 判定基底：引号掩码 → 去引号，逼近 bash 实际执行视图。
  // 为什么必须去引号：quoteMask 保留引号字符本身，会让 r'm' -rf / 这类"引号插入命令名"
//   的段首变成 r'm'，使 DENY_KEYS 的 startsWith 前缀匹配失配，引号插入的黑名单命令
//   因此逃出段首前缀匹配面。去引号后段首还原为 rm，前缀匹配恢复。
  // 引号不闭合（quoteMask 返回 null）：对原始 low 同样做去引号（dequote 无引号状态依赖，
  //   纯删除/解析），避免"引号不闭合 + 反斜杠"组合退回未解析形态而漏判。
  // fd 复制重定向（2>&1、>&2 等）在拆段前掩码：其中的 & 不是命令分隔符。
  const masked = quoteMask(low);
  const base = dequote(masked === null ? low : masked).replace(/\s*\d?>&\d/g, ' ');
  const stages = base.split(/[;&|\n]+/).map((s) => s.trim()).filter(Boolean);
  if (stages.length === 0) return { ok: false, reason: '[结构闸拦截] 空命令：无可执行内容。' };

  // 结构硬闸 0.5（展开构造闸）：判定基底中出现 `$` 或反引号一律硬拒，全角色全模式不豁免。
  // 为什么用"拒绝"而非"建模"：bash 的展开语义（ANSI-C 引号 $'…'、$IFS 词分割、$(…) 命令替换、
  //   参数展开 ${VAR}）都能改写命令的 token 边界，使判定视图与执行视图分叉。逐一建模这些
  //   语义不收敛——每补一族就会暴露出新一族。拒绝不需要理解载荷，
  //   因此改为结构性 fail-closed：凡是能改写 token 边界的构造，一律不进入白名单快路径。
  // 为什么判 base 而非原始 cmd：base 是 quoteMask→dequote 后的视图，单引号内的 `$` 已被
  //   quoteMask 掩为空格（bash 单引号内 `$` 确为字面量），故此判定与 bash 语义一致，
  //   不会误伤 `cat '$HOME'` 这类合法只读命令。
  // 既有用例的命令串均不含字面 `$` 或反引号，本闸不改红既有断言面。
  if (/\$|`/.test(base)) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 含展开构造（$ 或反引号）。展开可改写命令 token 边界，使裁决视图与执行视图分叉，故一律拒绝。请改写为不含变量/命令替换/ANSI-C 引号的平铺命令。` };
  }

  // 结构硬闸 0.5b（花括号 / 浪号 / glob 展开族）：与 0.5 同一 fail-closed 思路。
  //   0.5 只覆盖 `$` 与反引号，这三族同样能改写 token 边界却完全漏网——已实跑证实：
  //   `echo {echo,BRACEWORKS}` 输出 `echo BRACEWORKS`（命令位可被花括号构造，等同任意命令通道）；
  //   `echo ~` 展开为 home 绝对路径（可把路径指向判定视图看不到的位置）；
  //   `echo zebra*` 展开为真实文件名（可把黑名单命令名藏在 glob 结果里）。
  // 为什么按族整体拒绝而非建模展开结果：展开结果依赖执行时刻的文件系统状态与 shell 选项
  //   （nullglob / failglob / braceexpand 等），判定视图无法静态复现 ⇒ 建模不收敛。
  // 引号外视图：引号内的 * ? ~ { } 是字面量（shell 不展开），必须排除，否则会误伤
  //   `find . -name "*.md"`、`grep -c 'a{2}'` 这类把元字符当字面量的合法命令。
  const unquoted = maskQuotedRegions(low);
  if (BRACE_EXPAND_RE.test(unquoted) || TILDE_EXPAND_RE.test(unquoted) || GLOB_WILDCARD_RE.test(unquoted)) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 含花括号/浪号/通配符展开构造。展开由 shell 在执行时刻完成，可改写命令 token 与路径，使裁决视图与执行视图分叉，故一律拒绝。请改写为不含 {a,b}、~、* ? 的平铺命令。` };
  }

  // 结构硬闸 0.5c（环境变量注入面）：**任一段**段首前置 `VAR=值` 赋值一律硬拒。
//   参数面闸（3.6）只查 `-c`/`--*`，对 `GIT_PAGER=sh git log`、`PAGER=sh git log`、
//   `GIT_EXTERNAL_DIFF=sh git diff`、`BASH_ENV=x sh -c true` 这类前置赋值形态完全无效。
  //   这些变量可在不触碰任何参数的情况下派生外部进程，使只读白名单整体失效。
  //   逐段判定：段锚（stages 每段）替代整串段首锚，
  //   `git status | PAGER=sh git log` 的管道第二段不再漏网——与 0.6/黑名单闸同一形态。
  if (stages.some((seg) => ENV_ASSIGN_RE.test(seg))) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 含前置环境变量赋值。GIT_PAGER / PAGER / GIT_EXTERNAL_DIFF / BASH_ENV 等变量可绕过参数面闸派生外部进程，故一律拒绝。请把命令写为不含前置赋值的平铺形式。` };
  }

  // 结构硬闸 0.6（命令包装前缀闸）：段首出现 command / env / nohup / eval / bash -c / sh -c
  //   等包装前缀一律硬拒，全角色全模式不豁免。
  // 为什么必须拦：这些前缀把真命令推到参数位，使 DENY_KEYS 的段首 startsWith 前缀匹配整体失效——
  //   `command rm -rf x` 段首是 `command`（不命中 `rm*`）；`bash -c "rm -rf x"` / `sh -c …` 更是
  //   完整的任意命令通道（与既有的 pwsh -c 闸同一性质）。
  // 为什么判 base（去引号视图）：`comm'and' rm -rf x` 之类的引号插入同样会把段首改成 `comm'and'`，
  //   沿用与黑名单同一视图可复用已证闭环的 dequote 防线。
  // 为何不并入 DENY_KEYS：DENY_KEYS 只在段首精确前缀匹配，而 `bash -c` 需要"前缀 + -c 参数"的
  //   组合判定，且本闸须先于 allow 快路径触发，故独立成闸（与 3.5/3.6 同）。
  // 壳 -c 的簇形态（必须覆盖，否则整族绕过）：`-c` 常与其它短选项并成一个簇（`-lc` `-ec` `-xc`
  //   `-eux`），也可能前有长选项（`--login -c`）或紧贴参数（`-c"…"`）。只认裸 `-c` 的正则会把
  //   这些形态全部放过（实测 `bash -lc "rm -rf x"` 曾 ALLOW 且目录真被删除）。这里用两段判定：
  //   ① 含 `-c`/`-e` 的短选项簇（不限位置，只要簇内出现 c 或 e）；② 显式长选项形态。
  //   偏严取舍：`bash -e script.sh`（非 -c）也会被拒，属 fail-closed 方向的可接受代价。
  // 说明：正则本体已移至模块级（见模块级定义），此处仅保留调用点。
  for (const seg of stages) {
    // SHELL_ANY_RE 覆盖"壳 + 任意参数"，SHELL_C_RE 保留为显式 -c 语义档；
    //   前者是后者的超集，二者并列仅为让回执与调试可区分实际命中形态。
    if (WRAPPER_RE.test(seg) || SHELL_ANY_RE.test(seg)) {
      return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 含命令包装前缀（command/env/nohup/eval/exec/builtin/time 或 sh/bash 类壳调用；xargs 由禁入清单承担）。包装会把真命令推到参数位使黑名单前缀匹配失效，且壳（含 \`sh script.sh\` 这类非 -c 形态）属任意命令通道；请平铺单行直调。` };
    }
  }

  // 结构硬闸 0：pwsh/powershell -c|-Command 包装执行——逐段段首判定（管道中段同样拦截）。
  for (const seg of stages) {
    if (/^(?:&\s*)?(?:pwsh|powershell)(?:\.exe)?(?:\s|$)/.test(seg) && /(^|\s)-(?:c|command)(?:\s|$)/.test(seg)) {
      return { ok: false, reason: `[结构闸拦截] 严禁 pwsh/powershell -c 包装执行（任意命令通道）。请平铺单行直调: '${cmd.slice(0, 40)}'` };
    }
  }

  // 结构硬闸 1：任一段命中黑名单（全角色全模式死拦，模式不豁免）。
  const denyHit = stages.find((s) => effectiveDenyKeys().some((k) => matchKey(s, k)));
  if (denyHit) {
    return { ok: false, reason: `[黑名单拒绝] 命令段落 '${denyHit.slice(0, 40)}' 命中绝不执行清单（主工作区保护）。写操作走宿主原生编辑工具。如需破坏性测试/脚本验证/高危命令推演：可调用沙箱工具 \`exec_sandboxed_command\`，它会先把所需文件复制到虚拟 T: 盘（物理 ~/.config/kilo/virtual-t/）再在盘内执行，切勿在主工作区操作。` };
  }

  // 结构硬闸 1.5（git 别名执行面）：**任一段**的 `git config` 写入形态
  //   可定义 `!cmd` 别名，之后 `git x` 即任意命令通道。仅放行紧跟的显式只读标志（--list/--get 等）。
  //   逐段判定：段锚（stages 每段）替代整串段首锚，`git status | git config alias.x '!id'`
  //   的第二段不再漏网。段级判定须同时满足"该段是 git config 且非只读标志"；
  //   只要存在任一写形态段即拒——同一命令里混只读段不豁免。
  const hasConfigWrite = stages.some((seg) => GIT_CONFIG_RE.test(seg) && !GIT_CONFIG_READ_RE.test(seg));
  if (hasConfigWrite) {
    return { ok: false, reason: `[黑名单拒绝] 命令 '${cmd.slice(0, 40)}' 命中 git 配置写操作（可定义 \`!cmd\` 别名）。只读查询请用 git config --list / --get。如需测试别名或脚本，可调用沙箱工具 \`exec_sandboxed_command\`：把相关文件复制到虚拟 T: 盘后在盘内验证。` };
  }

  // 结构硬闸 2：禁入清单（隐式写/任意执行；全角色全模式一律 deny，main 不再弹窗代收）。
  const forbHit = stages.find((s) => FORBIDDEN_KEYS.some((k) => matchKey(s, k)));
  if (forbHit) {
    return { ok: false, reason: `[禁入清单拒绝] 命令段落 '${forbHit.slice(0, 40)}' 命中禁入清单。如需管道推演或测试，可调用沙箱工具 \`exec_sandboxed_command\`：将所需文件复制到虚拟 T: 盘后在盘内独立执行。` };
  }

  // 结构硬闸 3.5：--output 写逃逸参数——git diff/log/show 等只读命令可借
  //   `--output=<path>` / `--output <path>` 向磁盘任意路径写盘，白名单前缀对其整体失效。
  //   在任何 allow 判定（含纯白名单管道）之前拦截，命中即 deny，模式不豁免。
  //   判定对象改为 base（去引号 + 转义解析视图）：原判原始 cmd 时，--out'put'=x /
  //   --out\put=x / "--output" x / \-\-output=x 等变体因引号或反斜杠打断字面量而漏判。
  //   末尾补 (?:=|\s|$)：覆盖 `... --output` 无值结尾形态。
  if (/(?:^|\s)--output(?:=|\s|$)/i.test(base)) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 含 --output 参数，禁止写盘。只读命令不得携带输出重定向参数。` };
  }

  // 结构硬闸 3.6（扩展加固）：外部进程派生参数闸。
  //   白名单只读命令可借特定参数派生外部进程，使前缀白名单整体失效：
  //   ① `git grep --open-files-in-pager=<cmd>` 直接执行 <cmd>；
  //   ② `git diff/log --ext-diff` 调用 diff.external 配置的外部程序；
  //   ③ `git log/diff/show --paginate` 启动 pager；
  //   ④ `git -c core.pager=<cmd>` / `--config-env` 注入上述执行面配置。
  //   命中即 deny，全角色全模式不豁免（与黑名单同级不变量）。
  //   刻意不拦裸 `-c <普通键>`（如 core.quotepath=false）——只拦确会派生外部进程的键，
  //   避免把合法只读命令大面积误拒。
  //   逐段判定：段锚（stages 每段）替代整串段首锚，`git status | git -c core.pager=sh log` 的第二段不再漏网。
  //   两正则随之保持段锚形态（去掉整串行首锚定即可复用，`seg` 已是单段trim视图）。
  // -O 短旗标：仅在 git grep 有 pager 义（--open-files-in-pager）；git log/diff -O<orderfile> 为良性，
  // 故逐段判 git grep 段（大小写敏感，左边界锚定；`--grep=x` 内的 grep 前有 `-` 不命中）。dequote(seg) 剥引号但保留大小写，引号内 -O 仍命中。
  // git 全局选项前缀形态（git -C <dir> grep -O）同样命中：段锚允许 git 与 grep 之间的选项段。
  // cat-file 的 --t/--te/--tex/--text 缩写 = --textconv 派生（全局缩写链止于 --textc，此四形由命令感知分支收口，大小写敏感）。
  // stages 为小写视图（源自 low），而 -O 判定须大小写敏感 ⇒ 另取原始 cmd 的分段视图（同分隔符、同 trim 口径）。
  const rawStages = cmd.split(/[;&|\n]+/).map((s) => s.trim()).filter(Boolean);
  const grepOpenShortHit = rawStages.some((seg) => {
    const d = dequote(seg);
    return /^\s*git\b(?:[^;\n]*\s)?grep\b/i.test(d) && /(?:^|\s)-O/.test(d);
  });
  const catFileTextAbbrevHit = stages.some((seg) => {
    const d = dequote(seg);
    return /^\s*git\s+cat-file\b/i.test(d) && /(?:^|\s)--t(?:e(?:x(?:t)?)?)?(?==|\s|$)/.test(d);
  });
  const deriveHit = stages.some((seg) =>
    EXEC_DERIVE_RE.test(seg) || GIT_EXEC_CONFIG_RE.test(seg) || GIT_EXEC_KEY_PREFIX_RE.test(seg)) || grepOpenShortHit || catFileTextAbbrevHit;
  if (deriveHit) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 携带外部进程派生参数（--open-files-in-pager / --ext-diff / --paginate / --config-env / --pre / --textconv / --filters / -O / 缩写族 / 执行面配置注入），只读命令不得派生外部进程。` };
  }

  // 结构硬闸 3.8（跨工作区路径闸）：命令字面量中出现的任何路径形态，解析后必须仍落在工作区内。
  // 拦四类：Windows 盘符绝对路径（含反斜杠与裸盘符）、POSIX 绝对路径（含 Git Bash 的 msys 盘根 `/`）、
  //   UNC、`..` 上跳。放行相对路径、`.`、解析后确在工作区内的绝对路径；豁免 `/dev/null` 类无写语义黑洞
  //   与 `http(s)://` 等带 scheme 的 URL（否则 `curl http://x/y` 被误拒）。
  // 判定视图取 low ∪ base 并集：单用 base 会因 dequote 吃掉反斜杠而整体漏拦（实测已证）。
  // 闸位排在 3.6 之后、白名单快路径之前：既有各闸的拒绝理由串因此逐字不变（防回归），
  //   而 `ls C:/`、`cat "C:\…\id_rsa"` 这类"白名单命令 + 越界路径"从此不再直通。
  // 定性：只管命令字面量里的路径，管不住脚本内部构造或下载后再引用的路径；属 policy 级
  //   越界面收口，不是内核围栏（与其余各族同一定位，详见 §8.10）。
  // 时钟写入候选集与判据（date 已改为【只读白名单】判据，见下注释）
  const CLOCK_WRITERS = ['date', 'hwclock', 'timedatectl', 'set-date', 'w32tm'];
  const clockWriteHit = (stage) => {
    const t = String(stage).trim();
    const head = (t.split(/\s+/)[0] || '').replace(/\.exe$/, '');
    if (!CLOCK_WRITERS.includes(head)) return false;
    // date 的只读白名单状态位：上一 token 是取值型读旗标（-d/--date、-r/--reference）时，本 token 落其值位。
    let dateArgIsValue = false;
    for (const raw of t.split(/\s+/).slice(1)) {
      const a = raw.replace(/^["']+|["']+$/g, '');
      if (!a) continue;
      if (head === 'date') {
        // date 判据反向写成【默认即写】：凡不能确指为只读形态的参数，一律按时钟写入拦（宁可误伤）。
        //   为什么必须反着写：`date*` 在 ALLOW_KEYS 内，白名单直通会把命令交给真实 exec；
        //   而 date 的设值入口是开放集合（-s / --set / 紧贴实参 / 位置实参 / cmd.exe 的 MMDDYYYY…），
        //   正向枚举写形态必然漏——本仓已实测漏过一次 `-s<紧贴>`，并真的改动了本机时钟。
        //   视图为小写（low→quoteMask→dequote 派生），故短旗标按小写匹配；
        //   小写下 `-r` 兼指 --reference(取值) 与 -R(rfc-2822,布尔)，二者皆读，按取值消费不影响安全性。
        if (dateArgIsValue) { dateArgIsValue = false; continue; }
        if (/^\+/.test(a)) continue;                                                        // +FORMAT 输出格式
        if (/^--(?:utc|universal|iso-?8601|rfc-?2822|resolution|help|version)(?:=.*)?$/.test(a)) continue;
        if (/^--(?:date|reference)=/.test(a)) continue;                                     // 值已内联
        if (/^--(?:date|reference)$/.test(a)) { dateArgIsValue = true; continue; }
        if (/^-[uibhv]$/.test(a) || /^-i=/.test(a)) continue;                               // 布尔读旗标
        if (/^-[dr]$/.test(a)) { dateArgIsValue = true; continue; }                         // 取值读旗标
        return true;                                                                        // 其余一切形态 → 按写拦
      }
      if (head === 'hwclock') {
        if (/^(?:-w|-s|-a)$/.test(a) || /^--(?:systohc|hctosys|set|adjust)/.test(a)) return true;
        continue;
      }
      if (head === 'timedatectl') {
        if (/^set[-_]?(?:time|timezone|local-rtc|ntp|ntp-servers)$/.test(a) || a === 'set') return true;
        continue;
      }
      if (head === 'set-date') return true;
      if (head === 'w32tm') {
        if (/^\/(?:config|resync|register|unregister|monitor)(?::|\/|$)/i.test(a)) return true;
        continue;
      }
    }
    return false;
  };

  const clockHits = stages.filter(clockWriteHit);
  if (clockHits.length > 0) {
    return { ok: false, reason: `[时钟闸拦截] 命令 '${cmd.slice(0, 40)}' 试图设置系统时钟/硬件时钟（读时间允许，改系统时间一律拒绝：它会连带打穿模式文件的新鲜度判定）。` };
  }

  const pdHits = pathDomainHits(low, base);
  if (pdHits.length > 0) {
    return { ok: false, reason: `[跨区闸拦截] 命令 '${cmd.slice(0, 40)}' 包含工作区之外的路径（${pdHits.slice(0, 3).join('、')}）。主通道严禁触碰区外路径；若要读写这些文件做实验，可调用沙箱工具 \`exec_sandboxed_command\`：先把文件复制到虚拟 T: 盘再在盘内执行。` };
  }

  const allAllow = stages.every((s) => effectiveAllowKeys().some((k) => matchKey(s, k)));

  // 尾随分隔符：以 ; & || 结尾同判复合（全模式 deny）；以单个 | 结尾形态不完整 → 落灰区，不得直通 allow。
  const tailCompound = /[;&]$/.test(base) || base.endsWith('||');
  const tailPipe = base.endsWith('|') && !base.endsWith('||');

  // 纯白名单管道（唯一结构例外）：多段、无链式连接符、无非平铺字符、无尾随管道、每段命中 ALLOW。
  if (stages.length > 1 && !COMPOUND_RE.test(base) && !NONFLAT_RE.test(base) && !tailPipe && allAllow) {
    return { ok: true, isPwshCmdlet: hasPwshStage(stages) };
  }

  // 结构硬闸 3：复合/链式（多段含 ; & && || 换行，或尾随连接符）全模式 deny。
  if ((stages.length > 1 && COMPOUND_RE.test(base)) || tailCompound) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 包含复合/链式连接符 (; & && || 换行)。必须拆为单行单命令逐条执行！` };
  }

  // 结构硬闸 4：非平铺（单段含 < > $( `）。豁免无写语义空黑洞重定向（>/dev/null 类）后再测。
  if (stages.length === 1 && !tailPipe && effectiveAllowKeys().some((k) => matchKey(stages[0], k))) {
    const stripped = stages[0].replace(/\s*(?:&|\d*)>{1,2}\s*\/dev\/null/g, ' ').trim();
    if (!NONFLAT_RE.test(stripped)) {
      return { ok: true, isPwshCmdlet: hasPwshStage(stages) };
    }
  }
  if (stages.length === 1 && NONFLAT_RE.test(base)) {
    return { ok: false, reason: `[结构闸拦截] 命令 '${cmd.slice(0, 40)}' 包含非平铺字符 (< > $() 反引号)。写操作走宿主专用编辑工具！` };
  }

  // 单段命中 ALLOW（无尾随管道）→ 白名单直通。
  if (stages.length === 1 && !tailPipe && allAllow) {
    return { ok: true, isPwshCmdlet: hasPwshStage(stages) };
  }

  // —— 灰区（未登记命令 / 非白名单管道 / 尾随管道）：subagent 恒拒，main 按 plan 档拒绝 ——
  if (ROLE === 'subagent') {
    return { ok: false, reason: `[子代理越权阻断] 命令 '${cmd.slice(0, 40)}' 未在子代理允许清单中。子代理只允许执行只读探测与测试命令！` };
  }
  const { mode, note } = readVerifiedMode();
  if (mode === 'yolo' || mode === 'build') {
    // 不可达分支：mode 恒为 'plan'；保留以固化裁决面形状。
    return { ok: true, isPwshCmdlet: hasPwshStage(stages) };
  }
  if (mode === 'plan') {
    const prefix = note ? `[模式闸拦截·可信验证失败→按plan最严档：${note}] ` : '[模式闸拦截] ';
    return { ok: false, reason: `${prefix}计划模式仅允许只读与测试命令。未登记命令 '${cmd.slice(0, 40)}' 一律拒绝。` };
  }
  return { ok: false, reason: `当前权限模式下未登记命令一律拒绝，请改用宿主原生 Bash 按宿主交互流程执行 ['${cmd.slice(0, 40)}']` };
}

function hasPwshStage(stages) {
  return stages.some((s) => PWSH_CMDLET_PREFIXES.some((p) => s.startsWith(p)));
}

// =========================================================================
//                   【 终端环境探测与双轨分流器 】
// =========================================================================

// PATH 反查：where.exe 取首行且必须实际存在（找不到/被拒 → null，静默续链）。
// 系统 where.exe 绝对路径：不经 cmd.exe 解析 PATH，消除模块加载期被 PATH 劫持的初始化面。
const SYSTEM_WHERE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');

function firstWhereLine(exe) {
  try {
    const r = spawnSync(SYSTEM_WHERE, [exe], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const out = r.stdout || '';
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

// %WINDIR% 内判定：System32\bash.exe 是 WSL 启动器（文件系统视图与 Git Bash 完全不同），必须排除。
function isUnderWindir(p) {
  const windir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const rel = path.relative(path.resolve(windir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Git Bash 发现链（按序，命中即返；全空返 null → 调用方回退 COMSPEC 并标注降级）：
//   a 显式 env 钉路径 → b 标准安装 5 候选 → c where git 反推兄弟 bin/usr\bin → d where bash（排除 %WINDIR%）
function findGitBash() {
  if (process.platform !== 'win32') return null;

  const pinned = process.env.MCP_GIT_BASH;
  if (pinned && fs.existsSync(pinned)) return pinned;

  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'bash.exe')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }

  const gitExe = firstWhereLine('git.exe');
  if (gitExe) {
    const gitDir = path.dirname(gitExe);
    const derived = [
      path.resolve(gitDir, '..', 'bin', 'bash.exe'),
      path.resolve(gitDir, '..', 'usr', 'bin', 'bash.exe'),
      path.resolve(gitDir, 'bash.exe')
    ];
    for (const p of derived) {
      if (fs.existsSync(p)) return p;
    }
  }

  const bashExe = firstWhereLine('bash.exe');
  if (bashExe && !isUnderWindir(bashExe)) return bashExe;

  return null;
}

function findPwsh() {
  if (process.platform !== 'win32') return null;
  try {
    const r = spawnSync(SYSTEM_WHERE, ['pwsh.exe'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const firstLine = (r.stdout || '').split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}
  return 'powershell.exe';
}

const GIT_BASH_PATH = findGitBash();
const PWSH_PATH = findPwsh();

// 返回 { shell, displayShell }：shell 供 child_process 使用，displayShell 供回报行展示
// （COMSPEC 降级时 displayShell 附带 ⚠ 标注，把静默降级变为可见降级；显式 MCP_FORCE_SHELL 不标注）。
function resolveShellForCommand(isPwshCmdlet) {
  if (process.env.MCP_FORCE_SHELL) {
    return { shell: process.env.MCP_FORCE_SHELL, displayShell: process.env.MCP_FORCE_SHELL };
  }
  if (process.platform !== 'win32') {
    const sh = process.env.SHELL || '/bin/bash' || '/bin/sh';
    return { shell: sh, displayShell: sh };
  }
  if (isPwshCmdlet) {
    const pwsh = PWSH_PATH || 'powershell.exe';
    return { shell: pwsh, displayShell: pwsh };
  }
  if (GIT_BASH_PATH) {
    return { shell: GIT_BASH_PATH, displayShell: GIT_BASH_PATH };
  }
  const fallback = process.env.COMSPEC || 'cmd.exe';
  return {
    shell: fallback,
    displayShell: `${fallback}（⚠ 未检出 Git Bash，已降级 COMSPEC；可在 MCP 注册 env 设 MCP_GIT_BASH 固定）`
  };
}

// =========================================================================
//                   【 文件沙箱与备份辅助函数 】
// =========================================================================

// =========================================================================
//                   【 写面蜜罐引导闸（不落盘） 】
// =========================================================================

// 进程内命中计数：每次写工具被调用即递增，供 stderr 留痕审计（宿主收 stderr 入日志，零文件副作用）。
let honeypotHits = 0;

// 写工具统一回执：恒 isError，绝不落盘。main 实例一律按最严档（plan）引导；
// subagent 实例恒拒。
function honeypotReply(toolName) {
  honeypotHits += 1;

  if (ROLE === 'subagent') {
    process.stderr.write(`[plan-governor] HONEYPOT-HIT #${honeypotHits} tool=${toolName} role=subagent mode=n/a sid=n/a\n`);
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `[引导闸·蜜罐] subagent 实例不可调用写工具（${toolName}）。产物落盘唯一通道 = 受控写工具 write_scoped_file（zcode 子代理；kilocode/codebuddy 子代理仍用宿主原生写工具）：Writer/Reviewer 子代理直接写入 .kilo/plans/（review/ 与 pr-review/ 各自目录），父会话以 Read/Glob 做物理在场校验。`
      }]
    };
  }

  process.stderr.write(`[plan-governor] HONEYPOT-HIT #${honeypotHits} tool=${toolName} role=main mode=plan sid=unknown\n`);

  return {
    isError: true,
    content: [{
      type: 'text',
      text: `[引导闸·蜜罐] 主会话不得经本通道落盘产物（${toolName}）。正确路径：分派 plan-writer 子代理，由子代理经【受控写工具 write_scoped_file】（zcode；kilocode/codebuddy 用宿主原生写工具）物理写入 .kilo/plans/（主会话只发分派 prompt：目标/路径/证据指针，不当撰稿人）；落盘后父会话以 Read/Glob 做物理在场校验。`
    }]
  };
}

// workdir 锁回工作区：path.relative 判定，越权即拒（全角色同口径）。
function safeWorkdir(rawWorkdir) {
  if (!rawWorkdir) return { ok: true, cwd: WORKSPACE };
  const r = resolveInsideWorkspace(String(rawWorkdir));
  if (!r.ok) {
    return { ok: false, reason: `[工作区越权] workdir '${rawWorkdir}' 解析到工作区之外，拒绝执行。` };
  }
  // 词法判定不解析符号链接：工作区内指向区外的链接会把 exec 的 cwd 带出去，
  //   而跨区闸只扫命令字面量、不扫 cwd。此处与 sandboxCopyInto 的源闸同口径补一次 realpath 二次判定。
  try {
    const real = stripDeviceNamespace(fs.realpathSync(r.abs));
    const rel2 = path.relative(WORKSPACE, real);
    if (rel2 !== '' && (rel2.startsWith('..') || path.isAbsolute(rel2))) {
      return { ok: false, reason: `[工作区越权] workdir '${rawWorkdir}' 经链接解析到工作区之外，拒绝执行。` };
    }
    return { ok: true, cwd: real === WORKSPACE ? WORKSPACE : real };
  } catch (e) {
    return { ok: false, reason: `[工作区越权] workdir '${rawWorkdir}' 不存在或无法解析，拒绝执行。` };
  }
}

// Windows 设备命名空间前缀清洗（fail-safe）：\\?\C:\… 与 \\?\T:\… 形归一回盘符形，
//   保证 path.relative 同命名空间比较；仅处理盘符 ns 形，UNC 扩展形不在此面。
function stripDeviceNamespace(p) {
  return String(p || '').replace(/^\\\\\?\\([A-Za-z]:\\)/, '$1');
}

// 共享工作区锁回判定原语（safeWorkdir 与沙箱复制源闸共用同一实现，去重防漂移）：
//   逐字执行既有判定序列 path.resolve → path.relative → rel==='' 放行 / 越权拒绝。
function resolveInsideWorkspace(rawPath) {
  const target = path.resolve(WORKSPACE, String(rawPath));
  const rel = path.relative(WORKSPACE, target);
  if (rel === '') return { ok: true, abs: WORKSPACE, rel };
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, abs: target, rel };
  }
  return { ok: true, abs: target, rel };
}

// Windows 保留名与段尾点判定（dest 三步闸第 3 步）：任一段命中 con/prn/aux/nul/com\d/lpt\d
//   （不区分大小写）或以 '.' 结尾一律拒绝（尾点目录在 Windows 下创建即出错）。
function isReservedOrTrailingDotDest(destSubdir) {
  const segs = String(destSubdir || '').split(/[\\/]/).filter((s) => s !== '');
  return segs.some((s) => /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) || /\.$/.test(s));
}

// 沙箱受控复制内核：把主工作区内的文件/目录复制进虚拟 T: 盘。
//   动机：沙箱路径护栏禁止命令字面量引用 T: 以外的绝对路径 ⇒ cp -r 无法跨盘搬运；
//   本通道在 MCP 进程内完成复制，源经工作区锁回判定（越权即拒），目标恒在 T 盘内。
//   已知限制（同步 API）：复制超大目录（如 node_modules）会阻塞 MCP stdio 事件循环
//   甚至触发客户端 -32001 超时；体量与条数由调用方自律，本版本不设上限、不改为异步。
// 返回 { ok, copied[], errors[], destRoot }；ok = errors.length === 0（部分失败即整体判失败）。
function sandboxCopyInto(paths, destSubdir) {
  // 入口防御（先于任何校验）
  const list = Array.isArray(paths) ? paths.map(String) : [];

  // 目标路径闸（三步闸，缺一不可）+ 兜底 path.relative 回判
  const dest = String(destSubdir || '');
  let destReject = null;
  if (dest.includes('..')) {
    destReject = 'dest 含 .. 上跳，拒绝';
  } else if (dest !== '' && !/^(?!\.)[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)*$/.test(dest)) {
    destReject = 'dest 含非法字符/绝对路径/盘符形态，拒绝';
  } else if (isReservedOrTrailingDotDest(dest)) {
    destReject = 'dest 含 Windows 保留名或段尾点，拒绝';
  }
  const destRoot = path.join(VIRTUAL_DRIVE_DIR, dest);
  const destRel = path.relative(VIRTUAL_DRIVE_DIR, destRoot);
  if (!destReject && (destRel === '' ? false : (destRel.startsWith('..') || path.isAbsolute(destRel)))) {
    destReject = 'dest 解析后越出 T 盘，拒绝';
  }

  const errors = [];
  if (destReject) {
    appendAuditRecord({
      event: 'sandbox_copy',
      role: 'webui-sandbox',
      command: 'copy_into_sandbox ' + JSON.stringify(list).slice(0, 500),
      workspace: WORKSPACE,
      sessionId: null,
      allowed: false,
      gateType: 'path_guard',
      reason: destReject,
      timestamp: new Date().toISOString(),
    });
    return { ok: false, copied: [], errors: [{ path: dest, reason: destReject }], destRoot: VIRTUAL_DRIVE_DIR };
  }

  // 源路径闸（强制，先于任何 IO）：共享原语 → realpath 归一 → 二次过闸 → 存在性
  const resolved = [];
  for (const p of list) {
    const r = resolveInsideWorkspace(p);
    if (!r.ok) { errors.push({ path: p, reason: '越权' }); continue; }
    let abs = r.abs;
    try {
      abs = stripDeviceNamespace(fs.realpathSync(abs));
      const rel2 = path.relative(WORKSPACE, abs);
      if (rel2 !== '' && (rel2.startsWith('..') || path.isAbsolute(rel2))) {
        errors.push({ path: p, reason: '越权' }); continue;
      }
    } catch (e) {
      errors.push({ path: p, reason: '不存在' }); continue;
    }
    if (!fs.existsSync(abs)) { errors.push({ path: p, reason: '不存在' }); continue; }
    resolved.push({ raw: p, abs });
  }

  if (resolved.length === 0 && errors.length === 0) {
    // 空 paths：不进行任何 IO
    return { ok: true, copied: [], errors, destRoot };
  }

  let outRoot = destRoot;
  if (resolved.length > 0) {
    const driveInfo = ensureVirtualDrive();
    if (driveInfo.mounted) outRoot = 'T:\\' + path.relative(VIRTUAL_DRIVE_DIR, destRoot).split(path.sep).join('\\');
    try { fs.mkdirSync(destRoot, { recursive: true }); } catch (e) { /* 逐条复制时再收敛 */ }
  }

  const copied = [];
  for (const { raw, abs } of resolved) {
    // dst 语义钉死：恒为 destRoot + basename（fs.cpSync 对已存在目录的"复制进内部"不对称行为由此规避）
    const dst = path.join(destRoot, path.basename(abs));
    const outDst = outRoot === destRoot ? dst : path.join(outRoot, path.basename(abs));
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        fs.cpSync(abs, dst, { recursive: true, overwrite: true });
      } else {
        fs.copyFileSync(abs, dst);
      }
      copied.push(outDst);
    } catch (err) {
      // Windows 下源占用会同步抛 EBUSY/EPERM；逐条收敛，不炸穿 tools/call 主循环
      errors.push({ path: raw, reason: err.message });
    }
  }

  const ok = errors.length === 0;
  appendAuditRecord({
    event: 'sandbox_copy',
    role: 'webui-sandbox',
    command: 'copy_into_sandbox ' + JSON.stringify(list).slice(0, 500),
    workspace: WORKSPACE,
    sessionId: null,
    allowed: ok,
    gateType: ok ? 'allow' : 'path_guard',
    copied: copied.length,
    destRoot,
    ...(ok ? {} : { reason: errors.map((e) => e.path + ': ' + e.reason).join('; ') }),
    timestamp: new Date().toISOString(),
  });

  return { ok, copied, errors, destRoot: outRoot };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// =========================================================================
//                   【 stdio JSON-RPC 主通信循环 】
// =========================================================================

function startServer() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on('line', (line) => {
    if (!line.trim()) return;
  let msgId = null;
  try {
    const msg = JSON.parse(line);
    const { id, method, params } = msg;
    if (id !== undefined) msgId = id;

    // 1. 初始化握手
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'plan-governor', version: '6.2.0' }
        }
      });
      return;
    }

    if (method === 'notifications/initialized') return;

    // 2. 暴露受控治理工具（exec 为唯一实执行工具；三写工具保留为蜜罐引导闸；产物读工具已移除）
    if (method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'exec_guarded_command',
              description: `【统一受控终端执行通道】在《命令边界总表》与本实例角色（env MCP_ROLE=${ROLE}）约束下安全执行终端命令。main 实例一律按最严档（plan）执法；结构闸/黑名单/禁入恒先于模式；subagent 实例恒定最严（灰区静默 deny）。绝不弹窗。Windows 下自动分流 Git Bash / pwsh（含 PortableGit 自动探测与降级可见化）。`,
              inputSchema: {
                type: 'object',
                properties: {
                  command: {
                    type: 'string',
                    description: '单行平铺的待执行命令。例如: "git diff HEAD~1", "pytest tests/ -v"'
                  },
                  workdir: {
                    type: 'string',
                    description: '执行目标目录，可选。默认为工作区根目录；path.relative 判定锁回工作区，越权拒绝。'
                  },
                  timeout_seconds: {
                    type: 'number',
                    description: '最大等待超时秒数，默认 60 秒，clamp [1, 600]。'
                  }
                },
                required: ['command']
              }
            },
            {
              name: 'exec_sandboxed_command',
              description: ROLE === 'subagent'
                ? '【临时实验环境·不可用】subagent 实例不得调用沙箱执行通道。'
                : '【临时实验环境执行通道（T 盘沙箱）】在独立的虚拟 T: 盘（物理路径 ~/.config/kilo/virtual-t/）中真实执行高危命令（支持 node -e、rm、mv、npm install 等在主通道被禁的操作）。目的=工作区防误伤，不承诺对抗性内核隔离。共三道护栏：路径护栏（拦跨出 T 盘的路径与 .. 上跳）、展开构造结构闸（命令含 $ 或反引号即整体拒绝，故盘内实验不得使用变量展开与命令替换）、销毁护栏（subst <盘符>、diskpart、format <盘符>:、盘根递归删除即拒）。执行前自动确保 T: 盘映射与使用说明就绪。',
              inputSchema: {
                type: 'object',
                properties: {
                  command: {
                    type: 'string',
                    description: '待在 T: 盘中真实执行的命令（支持复合命令与高危写操作；不得含 $ 或反引号——展开构造会被结构闸整体拒绝）。'
                  },
                  timeout_seconds: {
                    type: 'number',
                    description: '最大等待超时秒数，默认 60 秒，clamp [1, 600]。'
                  }
                },
                required: ['command']
              }
            },
            {
              name: 'copy_into_sandbox',
              description: ROLE === 'subagent'
                ? '【临时实验环境·不可用】subagent 实例不得调用沙箱复制通道。'
                : '【临时实验环境·受控复制通道】把主工作区内的指定文件/目录复制到虚拟 T: 盘（物理 ~/.config/kilo/virtual-t/）后再在盘内用 exec_sandboxed_command 操作。为什么需要它：沙箱路径护栏禁止命令字面量引用 T: 以外的绝对路径，故 cp -r 无法直接跨盘复制；本通道在 MCP 进程内完成复制，源路径先经"工作区锁回"判定（越权即拒），目标恒在 T 盘内。同步复制，大目录会阻塞 MCP 通道，请按需复制。',
              inputSchema: {
                type: 'object',
                properties: {
                  paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '待复制的文件/目录路径数组，相对工作区根目录；目录递归复制。'
                  },
                  dest: {
                    type: 'string',
                    description: 'T 盘内目标子目录名，可选。非法值含 ..、绝对路径、盘符、Windows 保留名、段尾点一律拒绝。'
                  }
                },
                required: ['paths']
              }
            },
            {
              name: 'write_plan',
              description: ROLE === 'subagent'
                ? '【引导闸·蜜罐】subagent 实例不得经本通道落盘产物，调用即被拒；zcode 子代理落盘通道 = 受控写工具 write_scoped_file（kilocode/codebuddy 子代理用宿主原生写工具；你经其写入 .kilo/plans/ 对应目录）。'
                : '【引导闸·蜜罐】主会话不得经本通道落盘主计划，调用将被拒绝并引导分派子代理。zcode 子代理落盘通道 = 受控写工具 write_scoped_file；kilocode/codebuddy 子代理用宿主原生写工具。',
              inputSchema: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: '主计划文件名，如 20260914-auth-refactor.md' },
                  content: { type: 'string', description: '计划 Markdown 正文 (含目标、步骤、取证与三闸门声明)' }
                },
                required: ['filename', 'content']
              }
            },
            {
              name: 'write_review_report',
              description: ROLE === 'subagent'
                ? '【引导闸·蜜罐】subagent 实例不得经本通道落盘产物，调用即被拒；zcode 子代理复审报告落盘通道 = 受控写工具 write_scoped_file（kilocode/codebuddy 子代理用宿主原生写工具；Reviewer 子代理经其写入 .kilo/plans/review/）。'
                : '【引导闸·蜜罐】主会话不得经本通道落盘复审报告，调用将被拒绝并引导分派子代理。zcode 子代理复审报告落盘通道 = 受控写工具 write_scoped_file；kilocode/codebuddy 子代理用宿主原生写工具。',
              inputSchema: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: '复审报告文件名，如 20260914-auth-refactor-review.md' },
                  content: { type: 'string', description: '复审报告正文' }
                },
                required: ['filename', 'content']
              }
            },
            {
              name: 'write_pr_review_report',
              description: ROLE === 'subagent'
                ? '【引导闸·蜜罐】subagent 实例不得经本通道落盘产物，调用即被拒；zcode 子代理 PR 审查报告落盘通道 = 受控写工具 write_scoped_file（kilocode/codebuddy 子代理用宿主原生写工具；PR-Reviewer 子代理经其写入 .kilo/plans/pr-review/）。'
                : '【引导闸·蜜罐】主会话不得经本通道落盘 PR 审查报告，调用将被拒绝并引导分派子代理。zcode 子代理 PR 审查报告落盘通道 = 受控写工具 write_scoped_file；kilocode/codebuddy 子代理用宿主原生写工具。',
              inputSchema: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: 'PR 审查报告文件名，如 auth-refactor-pr-review.md' },
                  content: { type: 'string', description: 'PR 审查报告正文' }
                },
                required: ['filename', 'content']
              }
            },
            {
              name: 'write_scoped_file',
              description: ROLE === 'subagent'
                ? '【受控写·不可用】subagent 实例不得经本通道写计划文件，调用即被拒。'
                : '【受控写·zcode 子代理专用】仅在 .kilo/plans/ 下写 .md 产物（计划/复审报告/取证）。仅 runtime_scope=subagent 且服务端实例角色为 main 放行；路径锁 `.kilo/plans/`（含 `review/`、`test-evidence/`、`pr-review/` 子目录），拒 `..`、绝对路径、盘符、非 `.md`，≤256KB。主代理与未知调用方一律拒绝。',
              inputSchema: {
                type: 'object',
                properties: {
                  filename: { type: 'string', description: '.kilo/plans/ 下的相对 .md 路径，如 20260920-auth-refactor.md 或 review/xxx-review.md' },
                  content: { type: 'string', description: 'Markdown 正文' }
                },
                required: ['filename', 'content']
              }
            }
          ]
        }
      });
      return;
    }

    // 3. 执行工具分发
    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      // 工具 1: 受控终端执行
      if (toolName === 'exec_guarded_command') {
        const rawCmd = (args.command || '').trim();

        const wd = safeWorkdir(args.workdir);
        if (!wd.ok) {
          send({
            jsonrpc: '2.0',
            id,
            result: { isError: true, content: [{ type: 'text', text: wd.reason }] }
          });
          return;
        }

        const auditStartedAt = Date.now();
        const audit = auditCommand(rawCmd);
        if (!audit.ok) {
          appendAuditRecord({
            event: 'audit_verdict',
            command: rawCmd,
            role: ROLE,
            workspace: WORKSPACE,
            sessionId: null,
            allowed: false,
            gateType: deriveGateType(audit.reason),
            reason: audit.reason || null,
            timestamp: new Date(auditStartedAt).toISOString(),
            durationMs: Date.now() - auditStartedAt,
          });
          send({
            jsonrpc: '2.0',
            id,
            result: { isError: true, content: [{ type: 'text', text: audit.reason }] }
          });
          return;
        }

        const secs = Number(args.timeout_seconds) || 60;
        const timeoutMs = Math.min(600, Math.max(1, secs)) * 1000;
        const shellInfo = resolveShellForCommand(audit.isPwshCmdlet);
        const selectedShell = shellInfo.shell;
        const displayShell = shellInfo.displayShell;

        // 白名单放行的 git diff/log/show 追加 --no-ext-diff --no-textconv，封死
        //   .gitattributes diff=xxx / textconv 驱动的隐式派生通道；裁决仍对原始命令进行。
        const guardedCmd = hardenGitDiffCommand(rawCmd);

        // 视图一致性闸（fail-closed）：按段独立判定。不以"整串是否被加固过"为前提——
        //   混合管道中一段加固成功，不能成为另一引号段裸奔的豁免理由。
        if (hardenViewDiverges(rawCmd)) {
          const divergeReason = '[结构闸拦截] 命令 \'' + rawCmd.slice(0, 40) + '\' 的命令名词被引号包裹（如 \'git\' diff / git "diff"）：白名单在去引号视图上放行，而 --no-ext-diff --no-textconv 无处回填，.gitattributes 的 diff=/textconv 隐式派生通道会因此重开，故拒绝执行。请去掉命令名词上的引号后重试。';
          appendAuditRecord({
            event: 'audit_verdict',
            command: rawCmd,
            role: ROLE,
            workspace: WORKSPACE,
            sessionId: null,
            allowed: false,
            gateType: 'git_derive_guard',
            reason: divergeReason,
            timestamp: new Date(auditStartedAt).toISOString(),
            durationMs: Date.now() - auditStartedAt,
          });
          send({
            jsonrpc: '2.0',
            id,
            result: { isError: true, content: [{ type: 'text', text: divergeReason }] }
          });
          return;
        }

        exec(guardedCmd, { cwd: wd.cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4, shell: selectedShell }, (error, stdout, stderr) => {
          const exitCode = error ? (error.code !== undefined ? error.code : 1) : 0;
          appendAuditRecord({
            event: 'exec_result',
            command: guardedCmd,
            role: ROLE,
            workspace: WORKSPACE,
            sessionId: null,
            allowed: true,
            gateType: 'allow',
            isPwshCmdlet: !!audit.isPwshCmdlet,
            dispatchedShell: displayShell,
            exitCode,
            durationMs: Date.now() - auditStartedAt,
            stdoutBytes: stdout.length,
            stderrBytes: stderr.length,
            stdoutHead: stdout.slice(0, 400),
            timestamp: new Date(auditStartedAt).toISOString(),
          });
          const maxChars = 10000;
          const cleanStdout = stdout.length > maxChars
            ? stdout.slice(0, 3000) + `\n\n...[截断 ${stdout.length - 6000} 字符]...\n\n` + stdout.slice(-3000)
            : stdout;

          const report = [
            `【受控终端执行回报】`,
            `执行命令: ${guardedCmd}`,
            `实例角色: ${ROLE}`,
            `调度 Shell: ${displayShell}`,
            `退出代码: ${exitCode} (${exitCode === 0 ? 'SUCCESS' : 'FAILED'})`,
            `--- [STDOUT] ---`,
            cleanStdout || '(无输出)',
            stderr ? `--- [STDERR] ---\n${stderr}` : ''
          ].filter(Boolean).join('\n');

          send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: report }] }
          });
        });
        return;
      }

      // 临时实验环境旁路: 仅 main 实例；进程内直调沙箱内核原语（零 HTTP 依赖，WebUI 离线亦可用）
      if (toolName === 'exec_sandboxed_command') {
        if (ROLE !== 'main') {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[临时环境·不可用] subagent 实例不得经本通道执行高危命令。' }] } });
          return;
        }
        if (!sandboxCallerAllowed(args)) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[临时环境·调用方未授权] 本实例要求显式声明调用方身份（args.caller），未声明或非白名单调用方一律拒绝。' }] } });
          return;
        }
        sandboxExec(String(args.command || ''), { timeout_seconds: args.timeout_seconds }).then((data) => {
          if (!data.ok) {
            send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `[临时环境·执行拦截] ${data.error || '护栏拦截'}` }] } });
            return;
          }
          const head = [
            `【T:\\ 虚拟盘沙箱执行回报】`,
            `执行命令: ${args.command}`,
            `执行位置: ${data.targetCwd || 'T:\\'}`,
            `退出代码: ${data.exitCode} (${data.exitCode === 0 ? 'SUCCESS' : 'FAILED'})`,
            `耗时: ${data.durationMs}ms`,
            `--- [STDOUT] ---`,
            String(data.stdout || '(无输出)').slice(0, 10000),
            data.stderr ? `--- [STDERR] ---\n${String(data.stderr).slice(0, 4000)}` : ''
          ].filter(Boolean).join('\n');
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: head }] } });
        }).catch((err) => {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `[临时环境·执行失败] ${err.message}` }] } });
        });
        return;
      }

      // 沙箱受控复制通道: 仅 main 实例；门禁先于任何 IO 与参数解析
      if (toolName === 'copy_into_sandbox') {
        if (ROLE !== 'main') {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[临时环境·不可用] subagent 实例不得经本通道复制文件。' }] } });
          return;
        }
        if (!sandboxCallerAllowed(args)) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[临时环境·调用方未授权] 本实例要求显式声明调用方身份（args.caller），未声明或非白名单调用方一律拒绝。' }] } });
          return;
        }
        const r = sandboxCopyInto(args.paths, args.dest);
        if (r.ok) {
          const lines = [
            '【T:\\ 受控复制回报】',
            `目标根: ${r.destRoot}`,
            ...r.copied.map((c) => `已复制: ${c}`),
            '（提示：exec_sandboxed_command 可直接引用上述路径或相对路径。）'
          ].join('\n');
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: lines }] } });
        } else {
          const lines = [
            '【T:\\ 受控复制失败】',
            ...r.errors.map((e) => `- ${e.path}: ${e.reason}`)
          ].join('\n');
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: lines }] } });
        }
        return;
      }

      // 受控写工具: 仅 zcode 子代理（runtime_scope=subagent）可写 .kilo/plans/ 下 .md
      if (toolName === 'write_scoped_file') {
        // 双锚 fail-closed：服务端实例角色 ROLE 须为 main（该工具仅由 main 实例承担），
        // 且调用方身份信号 runtime_scope 须为 subagent（宿主注入，位于 params._meta）。
        const _m = params?._meta || {};
        const scope = _m.runtime_scope || (_m['com.zcode/request-context'] && _m['com.zcode/request-context'].runtime_scope) || null;
        if (ROLE !== 'main' || scope !== 'subagent') {
          process.stderr.write(`[write_scoped_file] REJECTED role=${ROLE} scope=${JSON.stringify(scope)}\n`);
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '主代理/未知调用方不得直接写计划文件，请派 plan-writer 子代理。' }] } });
          return;
        }
        // 信任边界：scope 信号来自 params._meta.runtime_scope，由 ZCode 宿主注入
        // （宿主注入 main/subagent 两态实测在场）；ROLE 为服务端启动期
        // 模块变量、客户端不可伪造。若未来宿主把客户端可控 _meta 原样透传，scope 锚
        // 可被伪造——届时须在宿主侧收紧，server 侧双锚仅为纵深。
        const rel = String(args.filename || '').replace(/\\/g, '/');
        if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..') || !rel.endsWith('.md')) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[受控写拦截] filename 必须为 .kilo/plans/ 下相对 .md 路径。' }] } });
          return;
        }
        const root = path.resolve(WORKSPACE, '.kilo', 'plans');
        const target = path.resolve(root, rel);
        if (target !== root && !target.startsWith(root + path.sep)) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[受控写拦截] 目标越出 .kilo/plans/。' }] } });
          return;
        }
        // 符号链接二次判定：.kilo/plans/ 下若存在指向区外的链接，词法 resolve 拦不住，
        // 与 safeWorkdir / sandboxCopyInto 同口径补 realpath 复核（父目录不存在时跳过，由后续 mkdir 创建）。
        let realParent = null;
        let realRoot = null;
        try { realParent = fs.realpathSync(path.dirname(target)); } catch { realParent = null; }
        try { realRoot = fs.realpathSync(root); } catch { realRoot = null; }
        if (realParent && realRoot && realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[受控写拦截] 目标经符号链接越出 .kilo/plans/。' }] } });
          return;
        }
        const content = String(args.content || '');
        if (Buffer.byteLength(content, 'utf8') > 262144) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[受控写拦截] 内容超 256KB。' }] } });
          return;
        }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, 'utf8');
          appendAuditRecord({
            event: 'scoped_write',
            command: null,
            role: ROLE,
            workspace: WORKSPACE,
            sessionId: null,
            allowed: true,
            gateType: 'scoped-write',
            reason: path.relative(WORKSPACE, target),
            bytes: Buffer.byteLength(content, 'utf8'),
            timestamp: new Date().toISOString(),
            durationMs: 0,
          });
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '已写入 ' + path.relative(WORKSPACE, target) + '（' + Buffer.byteLength(content, 'utf8') + ' 字节）' }] } });
        } catch (err) {
          appendAuditRecord({
            event: 'scoped_write',
            command: null,
            role: ROLE,
            workspace: WORKSPACE,
            sessionId: null,
            allowed: false,
            gateType: 'scoped-write',
            reason: err.message,
            timestamp: new Date().toISOString(),
            durationMs: 0,
          });
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: '[受控写失败] ' + err.message }] } });
        }
        return;
      }

      // 蜜罐引导闸: 三写工具拦截（绝不落盘；恒按最严档灌子代理引导回执；留痕审计）
      if (toolName === 'write_plan' || toolName === 'write_review_report' || toolName === 'write_pr_review_report') {
        send({ jsonrpc: '2.0', id, result: honeypotReply(toolName) });
        return;
      }

      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool '${toolName}' not found` } });
      return;
    }

    if (id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method '${method}' not implemented` } });
    }
    } catch (err) {
      send({ jsonrpc: '2.0', id: (typeof msgId !== 'undefined' ? msgId : null), error: { code: -32000, message: err.message } });
    }
  });
}

if (require.main === module) {
  startServer();
}

// =========================================================================
//   【 临时实验环境（T 盘沙箱）内核原语（进程内自足，零 HTTP 依赖） 】
//   原自 mcp/webui.js 整体迁入：webui 端点与 MCP exec_sandboxed_command
//   共享同一套实现；沙箱执行不再绑定 WebUI 进程存活。
// =========================================================================

// 物理目录锚定在用户级目录，不污染任何工作区
const VIRTUAL_DRIVE_DIR = path.join(KILO_USER_DIR, 'virtual-t');
const VIRTUAL_DRIVE_TMP = path.join(VIRTUAL_DRIVE_DIR, 'tmp');

// 确保 README.md 自动落盘
function ensureVirtualDriveReadme() {
  const readmePath = path.join(VIRTUAL_DRIVE_DIR, 'README.md');
  if (!fs.existsSync(readmePath)) {
    const content = [
      '# 虚拟 T: 盘临时实验环境 (Scratch Sandbox)',
      '',
      '> 这是一个由 Plan-Governor 自动挂载的临时实验盘符，用于执行高危命令推演、脚本测试与构建验证。',
      '',
      '## 1. 物理位置与特性',
      '- **物理真实路径**：\`' + VIRTUAL_DRIVE_DIR + '\`',
      '- **工作区防误伤**：在此盘内执行 \`rm -rf\`、\`node -e\`、\`npm install\` 不会影响主项目仓库；',
      '- **环境变量重定向**：\`HOME\`、\`USERPROFILE\`、\`TEMP\`、\`TMP\` 均已重定向至本盘符内的 \`tmp/\` 目录。',
      '',
      '## 2. 诚实安全声明（不承诺隔离）',
      '- 本通道为**防误操作的工作目录替代品**，不是安全隔离边界；',
      '- 进程以当前用户权限运行，\`PATH\` 环境变量保留；环境内脚本**依然有权以绝对路径读取当前用户的所有文件**；',
      '- 如需对恶意代码进行对抗性安全隔离，请使用 Windows Sandbox 或容器技术。',
      '',
      '## 3. 卸载盘符命令',
      '如需手动解除挂载，在终端运行：',
      '\`\`\`cmd',
      'subst T: /D',
      '\`\`\`',
      '（卸载后盘符消失，但物理文件依然保留在用户目录中，可手动清理）。',
      ''
    ].join('\n');
    fs.writeFileSync(readmePath, content, 'utf8');
  }
}

// 确保 T: 盘映射与目录就绪
// 挂载重定向：若 T: 已挂在别的目录（如遗留的 C:\Users\1\virtual-t），先拆除再挂到规范目录，
//   防止 ensureVirtualDrive 因检测到既有映射而沿用错误挂载点。
function ensureVirtualDrive() {
  if (!fs.existsSync(VIRTUAL_DRIVE_DIR)) fs.mkdirSync(VIRTUAL_DRIVE_DIR, { recursive: true });
  if (!fs.existsSync(VIRTUAL_DRIVE_TMP)) fs.mkdirSync(VIRTUAL_DRIVE_TMP, { recursive: true });
  ensureVirtualDriveReadme();

  let mounted = false;
  if (process.platform === 'win32') {
    try {
      let out = '';
      try { out = execSync('subst', { encoding: 'utf8' }) || ''; } catch (e) { out = ''; }
      // 解析既有 T: 映射目标；形如 "T:\\: => C:\\some\\path"
      const tm = out.match(/^T:\\: => (.+)$/m);
      if (tm) {
        const existing = path.resolve(tm[1].trim());
        if (existing.toLowerCase() !== VIRTUAL_DRIVE_DIR.toLowerCase()) {
          try { execSync('subst T: /D'); } catch (e) { /* 拆除失败则保持现状走降级 */ }
          try { execSync('subst T: "' + VIRTUAL_DRIVE_DIR + '"'); } catch (e) { /* 重挂失败走降级 */ }
        }
      } else {
        try { execSync('subst T: "' + VIRTUAL_DRIVE_DIR + '"'); } catch (e) { /* 挂载失败走降级 */ }
      }
      // 最终确认：T: 是否已指向规范目录
      let final = '';
      try { final = execSync('subst', { encoding: 'utf8' }) || ''; } catch (e) { final = ''; }
      const fm = final.match(/^T:\\: => (.+)$/m);
      mounted = !!fm && path.resolve(fm[1].trim()).toLowerCase() === VIRTUAL_DRIVE_DIR.toLowerCase();
    } catch (e) {
      // subst 整体不可用（如权限不足），降级为直接使用物理目录
      mounted = false;
    }
  }
  return {
    mounted,
    drive: mounted ? 'T:' : VIRTUAL_DRIVE_DIR,
    physicalPath: VIRTUAL_DRIVE_DIR,
    readmePath: path.join(VIRTUAL_DRIVE_DIR, 'README.md'),
  };
}

// 默认路径防误伤护栏（拦截命令字面量中跨出 T 盘的路径形态，防误伤工作区与家目录）
// 拦五类：① Windows 盘符（含绝对、驱动器相对 C:foo、裸盘符 C:）② POSIX 根 / ③ .. 上跳 ④ UNC ⑤ 写逃逸标志
// 豁免：T:/t: 自身引用、/dev/null、http(s):// 等 URL（避免误伤 git clone / npm view）
// 诚实边界：本护栏为纯词法扫描，只拦"命令字面量中的路径形态"；
//   解释器运行时动态构造的路径（node -e 内拼接/解码、powershell 变量展开）不在防线内，
//   该限制已写入 README 与工具 description，属公开披露的固有属性而非缺陷。
const DEVNULL_RE = /(?:\d*>{1,2}|<)\s*\/dev\/null/g;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
// 沙箱物理根的归一比较形（豁免专用；大小写与分隔符不敏感，以路径分隔符为界）
const SANDBOX_ROOT_NORM = VIRTUAL_DRIVE_DIR.replace(/[\\/]/g, '/').toLowerCase();

// 沙箱调用方身份闸（纵深防御，默认关闭）：
//   仅在 MCP_SANDBOX_REQUIRE_CALLER=1 时生效，要求调用方显式声明 args.caller，
//   且该 caller 命中 MCP_SANDBOX_ALLOW_CALLERS（逗号分隔，默认 primary）。
//   关闭时恒放行——用于按平台注入能力后仍能区分「主编排」与「只读复审角色」。
function sandboxCallerAllowed(args) {
  if (String(process.env.MCP_SANDBOX_REQUIRE_CALLER || '') !== '1') return true;
  const allow = String(process.env.MCP_SANDBOX_ALLOW_CALLERS || 'primary')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return allow.includes(String((args && args.caller) || '').trim());
}

function sandboxEscape(rawCmd) {
  const cmd = String(rawCmd || '').replace(DEVNULL_RE, ' ');
  const hits = new Set();
  for (const rawTok of cmd.split(/\s+/)) {
    if (!rawTok) continue;
    // 剥掉 --k=v 的选项前缀，取路径本体再判
    let tok = rawTok;
    const eq = tok.indexOf('=');
    if (/^-/.test(tok) && eq > 0) tok = tok.slice(eq + 1);
    // 引号剥离须先于一切 ^ 锚定判定：整 token 被引号包裹时（`"--prefix=/"`）^ 会失配
    tok = tok.replace(/^["']+|["']+$/g, '');
    if (!tok) continue;
    // 豁免：URL（http:// https:// 等）
    if (URL_RE.test(tok)) continue;
    // ③ .. 上跳（相对路径中任一层）——必须前置于 T: 豁免：
    //    先判 T: 会让 `T:/../..` 整 token 跳过后续全部规则，而 virtual-t 的物理父目录
    //    恰是 KILO_USER_DIR（policy-key / governor-policy.json / WebUI 管理令牌所在）。
    //    注：此处刻意不写出该令牌的文件名字面量——探针套件的源码字面量断言以「源码不含该文件名字面量」
    //    证明 governor 从不读取管理令牌；注释里出现字面量会让该断言假红（本处只解释，不读取）。
    if (/(^|[\\/])\.\.([\\/]|$)/.test(tok)) { hits.add(rawTok); continue; }
    // 豁免：指向 T: 自身（T:\、T:/、T:），且不含 .. 段（.. 已在上方拦截）
    if (/^[Tt]:[\\/]?/i.test(tok)) continue;
    // 豁免：沙箱物理根 VIRTUAL_DRIVE_DIR 及其内（分隔符归一 + 小写比较；须以路径分隔符为界——
    //   virtual-t2、virtual-tb 等同前缀兄弟目录不豁免）。降级模式（subst 不可用）下 exec cwd 即此目录，
    //   不豁免则复制回执/绝对自引用全被死拦；挂载模式下同样放行（T: 形与物理形指向同一区域，无新增攻击面：
    //   .. 前置规则已封死借物理前缀上跳信任根，父目录本体不在豁免内）。
    const tokNorm = tok.replace(/[\\/]/g, '/').toLowerCase();
    if (tokNorm === SANDBOX_ROOT_NORM || tokNorm.startsWith(SANDBOX_ROOT_NORM + '/')) continue;
    // ① Windows 盘符三形态：绝对 C:\x 或 C:/x、驱动器相对 C:foo、裸盘符 C:
    //    （T: 豁免已在上方先行处理；任何以盘符前缀开头的 token 均视为越界）
    if (/^[A-Za-z]:/.test(tok)) { hits.add(rawTok); continue; }
    // ④ UNC
    if (tok.startsWith('\\\\')) { hits.add(rawTok); continue; }
    // ② POSIX 绝对路径（含 /etc /proc /sys 与 msys 盘根 /）
    if (tok.startsWith('/')) { hits.add(rawTok); continue; }
    // ⑤ 写逃逸参数显式指向根（判剥离引号后的视图，与上方同源，避免 rawTok 的 ^ 失配）
    if (/^(?:-C|--directory|--root|--prefix|--output)(?:=\/|=\.\.|[= ]$)/.test(tok)) { hits.add(rawTok); continue; }
  }
  // 整串兜底扫描：补 token 锚定的盲区——`node -e "…readFileSync('D:/x')"` 剥引号后整 token
  //   以代码开头，token 开头锚定（^[A-Za-z]:）对串内盘符漏判。先剥 URL 字面量
  //   （http(s):// 的 "s:/" 会假命中，沿用 URL_RE 的 scheme 语义），再抓串内任意位置的
  //   越界盘符；要求盘符后紧跟路径分隔符，避免扩大 `a:b` 类盘符相对形态的既有命中面；T: 豁免与既有规则不动。
  const noUrl = cmd.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ');
  // 沙箱物理根豁免（与 token 循环同一口径）：本扫描只负向排除 T:，会对其余盘符域的 VDIR 绝对
  //   路径再命中一次、抵消 token 层豁免。故在 matchAll 前从待扫串剥离 VDIR 两分隔形态字面量（段尾以路径分隔符
  //   或串尾收口，故 virtual-t2 等兄弟目录与其父目录 KILO_USER_DIR 均不在剥离面内）。
  //   注：VDIR_LIT 用 SANDBOX_ROOT_NORM（正斜杠归一形）为基，对 noUrl 做 `[\\/]→/` 预归一，
  //   以保证正斜杠形与反斜杠形均被剥离（此前只剥离反斜杠形导致 fwd/instring 两正控恒红——r6-E1 修正）。
  const noFwd = noUrl.replace(/[\\/]/g, '/');
  const ESC_NORM = SANDBOX_ROOT_NORM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const noVdir = noFwd.replace(new RegExp(ESC_NORM + '(?=[/]|$)', 'gi'), ' ');
  for (const m of noVdir.matchAll(/\b(?![Tt]:)[A-Za-z]:[\\/]/g)) hits.add(m[0]);
  return [...hits];
}

// —— 沙盒销毁护栏 ——
// 范围裁定（唯一目标：盘消失，不拦盘内清理）：
//   拦：subst <盘符>: /D（拆盘符）、format <盘符>:（格式化盘符）、
//       rmdir|rd /s 命中盘根、递归/强制删除直指盘根（rm -rf T:\ 等）。
//   不拦：盘内一切文件级清理（rm -rf <子目录> / rm -f <文件> / rmdir <子目录> /
//       Remove-Item -Recurse <子目录> / node -e 删文件等）——清理方案无穷尽，
//       词法黑名单拦不住，强行罗列只制造误伤与假安全感（用户既定裁定）。
// 盘根唯一口径：T:\ / T:/ / virtual-t 三种字面形态之一，且紧邻递归/强制删除语义。
// 注意：尾部不得用 \b —— `T:\` 与 `T:` 以反斜杠/冒号结尾（非词字符），\b 永不成立会整条漏拦；
//   改用 (?:$|[\s|;&]) 收尾，允许串尾或跟随分隔符/命令连接符；中段用非贪婪 [^\n]*? 收紧跨度。
const SANDBOX_DESTROY_PATTERNS = [
  // 顺序即口径：`/d` 专形排首位，保证 `subst T: /D` 的归因串不因新增泛形而漂移
  //   （既有断言 h-destroy-blocks 与 sandbox-guard-both-armed-subst-d 都按该署名核对）。
  /\bsubst\s+[A-Za-z]:\s*\/d\b/i,
  // 泛形：任何"subst + 盘符"都属盘符域变更（建挂/拆挂同为机器全局副作用），
  //   不再要求 `/D` 字面量——`subst T: "/D"`、`subst T: D:\somewhere` 同族必须落网。
  /\bsubst\s+[A-Za-z]:/i,
  /\bdiskpart\b/i,
  /\bformat\s+[A-Za-z]:/i,
  /\b(?:rmdir|rd)\s+\/s\b[^\n]*?(?:T:[\\/]?|virtual-t)\s*(?:$|[\s|;&])/i,
  /\b(?:rm|rmdir|rd|del|erase|remove-item)\s+(?:-[a-z]*\s+)*(?:-[a-z]*[rf][a-z]*|-[a-z]*[rf][a-z]*\s+)*(?:\/[sq]\s+)*[^\n]*?(?:T:[\\/]?|virtual-t)\s*(?:$|[\s|;&])/i,
];

function sandboxDestroyHit(rawCmd) {
  const cmd = String(rawCmd || '');
  for (const re of SANDBOX_DESTROY_PATTERNS) {
    if (re.test(cmd)) return re.source;
  }
  return null;
}

// 沙箱执行内核（进程内自足）：护栏 → 审计 → child_process.exec。
//   返回 Promise，成功形态 { ok, escaped:false, exitCode, stdout, stderr, durationMs, targetCwd, shell }，
//   拦截形态 { ok:false, escaped:true, gateType:'path_guard', hits, error }——
//   响应字段与 webui /api/sandbox/exec 契约一致。
//   审计字段口径：event:'sandbox_exec'、role:'webui-sandbox'。
function sandboxExec(command, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    // 结构硬闸（沙箱通道，先于两道词法护栏与任何挂载）：命令含 `$` 或反引号一律拒。
    //   销毁护栏与路径护栏都是词法判定，而 ANSI-C 引号（$'\057D'）、参数展开（$D）、
    //   命令替换与前置赋值（D=/D subst T: $D）都在 bash 执行期才改写 token 边界——
    //   判定视图看到的是字面量，执行视图看到的却是 /D，两闸同时失明。
    //   与主通道结构硬闸 0.5 同一 fail-closed 哲学：拒绝不需要理解载荷，逐一建模不收敛。
    if (/\$|`/.test(command)) {
      resolve({
        ok: false,
        escaped: true,
        gateType: 'sandbox_expand_guard',
        hits: [],
        error: '沙箱结构闸拦截：命令含展开构造（$ 或反引号）。展开在执行期改写命令 token 边界，会使销毁护栏与路径护栏的词法判定整体失效，故一律拒绝；请改写为不含变量、命令替换与 ANSI-C 引号的平铺命令。'
      });
      return;
    }
    // 销毁护栏：置于 ensureVirtualDrive() 之前——拦截路径必须零副作用，
    //   否则拦截 subst T: /D 的过程本身会先让内核跑一次拆挂-重挂（自相矛盾）。
    //   置于 sandboxEscape 之前是为了归因准确：sandboxEscape 对 T: 有显式豁免，
    //   subst T: /D 会命中其中的 POSIX 根规则（/D），应归因 destroy_guard 而非 path_guard。
    const destroyHit = sandboxDestroyHit(command);
    if (destroyHit) {
      appendAuditRecord({
        event: 'sandbox_exec',
        command,
        role: 'webui-sandbox',
        workspace: WORKSPACE,
        sessionId: null,
        allowed: false,
        gateType: 'destroy_guard',
        reason: '沙盒销毁护栏拦截：禁止拆盘/删盘根/格式化盘符（' + destroyHit + '）',
        hits: [destroyHit],
        timestamp: new Date().toISOString(),
      });
      resolve({
        ok: false,
        escaped: true,
        gateType: 'destroy_guard',
        hits: [destroyHit],
        error: '沙盒销毁护栏拦截：虚拟 T: 盘为机器全局共享资源，禁止经沙箱通道拆盘符、删除盘根或格式化盘符；盘内文件清理不受限制。销毁（subst T: /D）请由用户在宿主终端手工执行。'
      });
      return;
    }
    const driveInfo = ensureVirtualDrive();
    const hits = sandboxEscape(command);
    if (hits.length > 0) {
      // 护栏命中：拦截并记审计（受 MCP_AUDIT_LOG=1 门控，未开启时静默跳过——预期行为）
      appendAuditRecord({
        event: 'sandbox_exec',
        command,
        role: 'webui-sandbox',
        workspace: WORKSPACE,
        sessionId: null,
        allowed: false,
        gateType: 'path_guard',
        reason: '默认路径护栏拦截：命令包含跨出沙箱的路径 (' + hits.join(', ') + ')',
        hits,
        timestamp: new Date().toISOString(),
      });
      resolve({
        ok: false,
        escaped: true,
        gateType: 'path_guard',
        hits,
        error: '默认路径护栏拦截：禁止引用除 T: 以外的绝对路径或 .. 上跳以保护主工作区。命中: ' + hits.join('、')
      });
      return;
    }

    const t0 = Date.now();
    const targetCwd = driveInfo.mounted ? 'T:\\' : driveInfo.physicalPath;
    const timeoutSecs = Math.min(600, Math.max(1, Number(o.timeout_seconds) || 60));

    // 重定向 HOME / USERPROFILE / TEMP
    const sbEnv = Object.assign({}, process.env, {
      HOME: targetCwd,
      USERPROFILE: targetCwd,
      TEMP: VIRTUAL_DRIVE_TMP,
      TMP: VIRTUAL_DRIVE_TMP,
      VIRTUAL_DRIVE: 'T:'
    });

    // 显式分发 Git Bash（与主通道 resolveShellForCommand 同族逻辑），
    //   保证 rm/cat/管道等 POSIX 语义在 Windows 下可用；探测失败降级 COMSPEC 并标注。
    const shellInfo = resolveShellForCommand(false);
    const sandboxShell = shellInfo.shell;
    const sandboxShellDisplay = shellInfo.displayShell;

    exec(command, {
      cwd: targetCwd,
      timeout: timeoutSecs * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: sbEnv,
      shell: sandboxShell
    }, (error, stdout, stderr) => {
      const exitCode = error ? (error.code !== undefined ? error.code : 1) : 0;
      const durationMs = Date.now() - t0;
      appendAuditRecord({
        event: 'sandbox_exec',
        command,
        role: 'webui-sandbox',
        workspace: WORKSPACE,
        sessionId: null,
        allowed: true,
        gateType: 'allow',
        exitCode,
        durationMs,
        dispatchedShell: sandboxShellDisplay,
        stdoutBytes: (stdout || '').length,
        stderrBytes: (stderr || '').length,
        timestamp: new Date(t0).toISOString(),
      });
      resolve({
        ok: true,
        escaped: false,
        exitCode,
        stdout: stdout || '',
        stderr: stderr || '',
        durationMs,
        targetCwd,
        shell: sandboxShellDisplay
      });
    });
  });
}

module.exports = {
  auditCommand,
  deriveGateType,
  hardenGitDiffCommand,
  loadPolicy,
  signPolicy,
  canonicalPolicy,
  effectiveAllowKeys,
  effectiveDenyKeys,
  appendAuditRecord,
  honeypotReply,
  readVerifiedMode,
  resolveShellForCommand,
  ensureVirtualDrive,
  ensureVirtualDriveReadme,
  sandboxEscape,
  sandboxExec,
  sandboxCopyInto,
  resolveInsideWorkspace,
  sandboxDestroyHit,
  SANDBOX_DESTROY_PATTERNS,
  safeWorkdir,
  quoteMask,
  dequote,
  maskQuotedRegions,
  matchKey,
  hasPwshStage,
  ALLOW_KEYS,
  DENY_KEYS,
  FORBIDDEN_KEYS,
  PWSH_CMDLET_PREFIXES,
  WORKSPACE,
  MODE_DIR,
  POLICY_KEY_FILE,
  POLICY_FILE,
  AUDIT_LOG_FILE,
  AUDIT_LOG_DIR,
  KILO_USER_DIR,
stripDeviceNamespace,
  VIRTUAL_DRIVE_DIR,
  VIRTUAL_DRIVE_TMP,
};
