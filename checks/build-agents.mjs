// checks/build-agents.mjs — 三端产物生成器与新鲜度闸（编译产物模型第二期）。
// 分层：build/diffProducts/unknownPlatformDirs/specHash 纯函数不读盘（selftest 合成 golden 驱动）；loadSpec/checkFreshness/CLI 读盘。
// 红线（build-output-path-locked）：输出路径锁死 PLATFORMS 三平台目录内相对路径，manifest 文件名映射不得逃逸；
//   反斜杠分隔符先归一为正斜杠再判定，杜绝 Windows fs 层按反斜杠解析逃逸平台目录。
// 红线（build-no-anchor-swallow）：插槽替换后逐条校验 expect 命中该路径的条款锚文本仍在，吞锚即抛错拒产。
//   校验域仅 CLAUSES；GATES（无 text 字段，registry.mjs:318-329）由 run.mjs 既有 gate 闸承担，
//   DERIVED_CLAUSES（无 expect，registry.mjs:306-310）由 run.mjs F8b 派生载体闸承担第二网，
//   build 不重复计数、不重复推导，避免生成器复制闸门/派生逻辑形成第二事实源。
//   clauses 形参（默认 CLAUSES）供 selftest 注入合成条款，测试夹具不与 registry expect 域碰撞。
// 红线（build-freshness-check）：spec 变更而产物未重生成 ⇒ run.mjs 判 generated-product-stale；比对前行尾 CRLF 归一防 autocrlf 假红。
// 版本戳（GENERATED from spec@<hash>）：生成标记含 spec 内容哈希，由 CLI/checkFreshness 构建前经
//   specHash 计算注入（语义见计划 §4.4：确定性/敏感性/纯度/新鲜度自洽/安装态对账）；安装态用户报问题
//   可凭哈希对账 spec 版本（重放 git 历史中 spec 提交并重算哈希即可定位），不引入任何遥测/网络。
// 红线（未知平台目录 fail-loud）：spec/platform/ 下非 PLATFORMS 目录含 manifest.json 即拒产，不静默忽略。
// 严禁 import child_process 等执行面；spec/manifest 内容仅作文本渲染。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLAUSES, PLATFORMS } from './registry.mjs';
import { parseFrontmatter } from './invariants.mjs';

// 版本戳模板：hash 由 CLI 层传入；build 保持纯函数（不读盘、不依赖环境），selftest 注入固定 mark 断言 golden 确定性。
export const GENERATED_MARK = '<!-- GENERATED from spec@<hash>; do not edit -->';
// 残留插槽扫描正则（词法域并集）：键＝字母/数字/下划线开头、内部允许标识字符与空白——renderBlock
// （build-agents.mjs 的 renderBlock 定义处）的替换域为 manifest slots 的任意字符串键（split/join 精确匹配），
// 任意形态键缺替换即残留可出货，故数字首键与空白键均在检测域（两套旧检测域各漏一半，并集闭合）；
// 排除 {{}} 与纯空白 {{ }}（无键可提）、单层 {y}、非 ASCII {{中文键}}。
export const SLOT_RESIDUE_RE = /\{\{\s*[A-Za-z0-9_][A-Za-z0-9_\s]*\}\}/g;

// 纯函数：spec/profiles 内容哈希（契约 §4.4：确定性/敏感性）。
// canonical 序列化块按 id 排序（块库文件读取序不影响），sha256 前 12 位十六进制，零新依赖（node:crypto 为 Node 内置）。
// canonical-key-order-only 闸：profiles 递归按对象键排序后再序列化——manifest 的键序/排版属非语义视图，
//   不得进入哈希（否则重排键即误报全量 STALE，探针 probe-m1-keyorder 实测 hashA≠hashB）；
//   数组序（files/blocks/slots 值序）是 build 消费的语义序，绝不重排（触发域/不该触发域见行为契约）。
// canonical-null-proto-merge 闸：null-原型累加器（Object.create(null)）保证 __proto__ 等危险键按自有
//   数据键保留入哈希，而非触发原型 setter 被静默丢弃致哈希分叉（探针 probe-proto 已证伪"全局污染"、
//   改证"自有键丢失"，故护栏目标是键保留而非防污染）。
export function canonicalizeValue(v) {
  if (Array.isArray(v)) return v.map(canonicalizeValue);
  if (v && typeof v === 'object') {
    const out = Object.create(null);
    for (const k of Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = canonicalizeValue(v[k]);
    return out;
  }
  return v;
}
export function specHash(spec, profiles) {
  const canonical = JSON.stringify({
    blocks: [...((spec || {}).blocks || [])].map(({ id, text }) => ({ id, text })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    profiles: canonicalizeValue(profiles),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function resolveOutputPath(platform, output) {
  if (typeof output !== 'string' || output.length === 0) {
    throw new Error('build-output-path-locked: output 必须为非空字符串: ' + String(output));
  }
  const norm = path.posix.normalize(output.replace(/\\/g, '/'));
  if (path.posix.isAbsolute(norm) || norm.split('/').includes('..')) {
    throw new Error('build-output-path-locked: 输出路径逃逸平台目录: ' + output);
  }
  return platform + '/' + norm;
}

function renderBlock(text, slots) {
  let out = text;
  for (const [k, v] of Object.entries(slots || {})) out = out.split('{{' + k + '}}').join(String(v));
  return out;
}

// 纯函数：spec = { blocks: [{ id, text }] }；profiles = { [platform]: { files: [{ output, frontmatter?, blocks, slots? }] } }；
// clauses = 吞锚校验域（默认 CLAUSES，selftest 可注入合成条款）；generatedMark = 生成标记
//（默认 GENERATED_MARK 模板形态，CLI/checkFreshness 经 specHash 注入真实哈希后传入）。
// 返回 [{ path, text }]；frontmatter 为 null/缺省的输出不得以 --- 开头（AGENTS.md 形态）。
export function build(spec, profiles, clauses = CLAUSES, generatedMark = GENERATED_MARK) {
  const platformSet = new Set(PLATFORMS);
  for (const key of Object.keys(profiles || {})) {
    if (!platformSet.has(key)) throw new Error('build: 未知平台 profile: ' + key);
  }
  // build-duplicate-block-id：重复块 id 拒绝装配（fail-closed）。触发域：spec.blocks 任意两块 id 相同
  //   ——映射后写覆盖前写且磁盘枚举序非跨平台契约，重复 id 使装配结果随枚举序漂移。
  //   不该触发域：id 全唯一；空 blocks（编译未启用域）。命中即抛错报出重复 id，严禁静默覆盖；
  //   错误前缀 build: 由 freshnessFailures 翻译闸承接为结构化 FAIL。
  const blockById = new Map();
  for (const b of spec.blocks || []) {
    if (blockById.has(b.id)) {
      throw new Error('build: 重复块 id ' + String(b.id) + '（build-duplicate-block-id）：后写将覆盖前写，拒绝装配');
    }
    blockById.set(b.id, b.text);
  }
  const products = [];
  for (const platform of PLATFORMS) {
    const profile = (profiles || {})[platform];
    if (!profile) continue;
    for (const f of profile.files || []) {
      const outPath = resolveOutputPath(platform, f.output);
      const missing = (f.blocks || []).filter((id) => !blockById.has(id));
      if (missing.length > 0) throw new Error('build: manifest 引用缺失块: ' + missing.join(','));
      const parts = [];
      if (f.frontmatter) parts.push('---\n' + String(f.frontmatter).trimEnd() + '\n---\n');
      parts.push(generatedMark, '');
      const rendered = (f.blocks || []).map((id) => renderBlock(blockById.get(id), f.slots)).join('\n\n');
      parts.push(rendered);
      const text = parts.join('\n').trimEnd() + '\n';
      // build-unrendered-slot：渲染后残留插槽扫描（fail-closed）。触发域：产物文本含插槽形态（词法域
      //   并集——字母/数字/下划线首、内部允许标识字符与空白；数字首键与空白键均在检测域）；判定不看
      //   键是否已声明——slots 少写/错写键、槽值内嵌未解析占位符同判残留。不该触发域：slots 齐备零
      //   残留、空串槽值（split/join 已消解）、无键可提形（{{}}、{{ }}）、单层与非 ASCII 形。退化语义：
      //   命中即抛错拒产（键集 Set 归一、消息含产物路径），「全 slot 命中」与「残留」可区分；错误前缀
      //   build: 由翻译闸结构化承接。
      // 报错保真：仅剥包裹花括号并 trim 首尾空白，键内空白原样保留——`{{my key}}` 残留仍报 `{{my key}}`，
      // 报错键必须能逐字对回 manifest slots 的真实键名（PR#5 评审 4218735255）。
      const residueKeys = [...new Set([...text.matchAll(SLOT_RESIDUE_RE)].map((m) => m[0].replace(/[{}]/g, '').trim()))];
      if (residueKeys.length > 0) {
        throw new Error('build: 产物残留未渲染插槽 ' + residueKeys.map((k) => '{{' + k + '}}').join(', ') + '（build-unrendered-slot）: ' + outPath);
      }
      // build-no-anchor-swallow：渲染后逐条校验 expect 命中该路径的条款锚文本仍在（fail-closed）。
      // 判定域＝渲染块正文（rendered），不含 frontmatter 与 GENERATED 标记——锚文本恰在 frontmatter/
      // 标记中出现而正文缺席时同样判丢失（PR#5 评审 4218735277）。
      for (const c of clauses) {
        if ((c.expect || []).some((re) => re.test(outPath)) && !rendered.includes(c.text)) {
          throw new Error('build-no-anchor-swallow: ' + outPath + ' 丢失锚文本 [' + c.id + ']: ' + c.text);
        }
      }
      products.push({ path: outPath, text });
    }
  }
  return products;
}

// 纯函数：期望产物 vs 磁盘读取函数；磁盘缺失（null）计 stale，与「内容恰等」可区分；
// 两侧比对前各行尾归一 replace(/\r\n/g, '\n')，autocrlf checkout 的行尾漂移不判 stale（语义差异仍判 stale）。
export function diffProducts(expected, diskGet) {
  const norm = (s) => (s === null ? null : String(s).replace(/\r\n/g, '\n'));
  const stale = [];
  for (const p of expected) {
    if (norm(diskGet(p.path)) !== norm(p.text)) stale.push(p.path);
  }
  return stale;
}

// 纯函数：spec/platform/ 下非 PLATFORMS 的目录名清单；loadSpec 对其中含 manifest.json 者报错拒产（fail-loud）。
export function unknownPlatformDirs(dirNames) {
  const set = new Set(PLATFORMS);
  return (dirNames || []).filter((n) => !set.has(n));
}

export function loadSpec(root) {
  const platformRoot = path.join(root, 'spec', 'platform');
  if (fs.existsSync(platformRoot)) {
    const unknown = unknownPlatformDirs(
      fs.readdirSync(platformRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
    );
    const offenders = unknown.filter((n) => fs.existsSync(path.join(platformRoot, n, 'manifest.json')));
    if (offenders.length > 0) {
      throw new Error('loadSpec: spec/platform/ 下存在未登记平台的 manifest，拒绝静默忽略（fail-loud）: '
        + offenders.map((n) => 'spec/platform/' + n + '/manifest.json').join(', '));
    }
  }
  const blocksDir = path.join(root, 'spec', 'blocks');
  if (!fs.existsSync(blocksDir)) return { spec: { blocks: [] }, profiles: {} };
  const blocks = fs.readdirSync(blocksDir).filter((f) => f.endsWith('.md')).map((f) => {
    const raw = fs.readFileSync(path.join(blocksDir, f), 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm.present || !fm.terminated || !fm.tree.id) {
      throw new Error('loadSpec: 块文件缺 frontmatter id: spec/blocks/' + f);
    }
    const bodyLines = raw.split(/\r?\n/).slice(fm.endLine);
    return { id: String(fm.tree.id), text: bodyLines.join('\n').replace(/^\r?\n/, '').trimEnd() };
  });
  const profiles = {};
  for (const platform of PLATFORMS) {
    const mf = path.join(root, 'spec', 'platform', platform, 'manifest.json');
    // fail-loud 选型理由：与"未登记配置在场即拒产"（上方 unknownPlatformDirs 闸）对称——已登记配置
    // 缺席更须响；`loadSpec:` 前缀错误被 freshnessFailures 翻译闸承接为结构化 specError（run.mjs 统一
    // FAIL 行），不裸栈。"编译未启用"豁免域收窄为 spec/blocks 整树不存在（:133），单平台 manifest 缺失
    // 与"未启用"自此可区分（前者红、后者绿）。
    if (!fs.existsSync(mf)) {
      throw new Error('loadSpec: 已登记平台缺 manifest.json，拒绝静默降级（manifest-missing-fail-loud）: spec/platform/' + platform + '/manifest.json');
    }
    profiles[platform] = JSON.parse(fs.readFileSync(mf, 'utf8'));
  }
  return { spec: { blocks }, profiles };
}

export function checkFreshness(root, preloaded) {
  const { spec, profiles } = preloaded || loadSpec(root);
  // 版本戳自洽（契约 4.4 ④）：期望产物标记与 CLI 写盘标记由同一 spec 重算哈希生成，
  // 哈希随 spec 变化 ⇒ 旧产物立即 stale；两侧同构注入，无假红、无漏报。
  const generatedMark = '<!-- GENERATED from spec@' + specHash(spec, profiles) + '; do not edit -->';
  const expected = build(spec, profiles, CLAUSES, generatedMark);
  return diffProducts(expected, (p) => {
    const f = path.join(root, ...p.split('/'));
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  });
}

// freshness-gate-error-translated 闸：把 checkFreshness 的 loadSpec fail-loud 抛错翻译为结构化结果，
//   供 run.mjs 以统一 FAIL 行报告——坏配置不再以裸堆栈击穿常驻不变式检查（报错风格归一，探针
//   probe-m2-config-throw 实测裸抛）。纯函数（checkFreshnessFn 作参注入），selftest 可驱动抛错/正常
//   两路，不读盘。返回 { payload: 回调原样返回值, specError: string|null }；抛错时 payload=[] 且 specError=消息。
//   spec-load-fault-family 谓词：转译域仅限配置装载失效族——显式 fail-loud Error（消息前缀
//   loadSpec:/build:；throw 站点以符号锚计＝resolveOutputPath 两处、build 的未知平台 profile 与
//   manifest 引用缺失块、build-no-anchor-swallow 拒产、loadSpec 的未登记平台 manifest、块文件缺
//   frontmatter id、已登记平台缺 manifest；JSON.parse 位于 loadSpec 读 manifest 处。行号锚随
//   插入漂移，故以符号锚为准）；
//   TypeError/ReferenceError 等＝检查器自身编码缺陷，原样上抛保留堆栈诊断，严禁被翻译层吞没。
//   specError≠null（装载失败族）由 run.mjs 以独立 id `generated-product-spec-error` 报告（与产物陈旧
//   `generated-product-stale` 可区分，登记见 invariants.mjs FRESHNESS_GATE_IDS）——双失效模式经独立 id 分流。
//   前缀谓词与消息文案的耦合是明示退化设计：文案变更致谓词失配时行为回落为原样上抛（= 修复前
//   形态，fail-noisy 不减损），不产生静默放行。
export function freshnessFailures(checkFreshnessFn, root) {
  try {
    return { payload: checkFreshnessFn(root), specError: null };
  } catch (err) {
    const isSpecLoadFault = (err instanceof SyntaxError)
      || (err instanceof Error && /^(loadSpec|build)/.test(err.message));
    if (!isSpecLoadFault) throw err;
    return { payload: [], specError: (err && err.message) ? String(err.message) : String(err) };
  }
}

// CLI 装载 Outcome（M-2 归一）：checkFreshness + loadSpec + build 整体经 freshnessFailures 翻译闸，
// 装载失效族（loadSpec:/build: 前缀与 JSON SyntaxError）不再以裸堆栈击穿 --check/写盘路径；
// isMain 分支消费本函数：specError 非 null → 结构化 FAIL 行 + exit 1（fail-closed 不变，报错形态归一）。
export function cliLoadOutcome(root) {
  return freshnessFailures((r) => {
    const { spec, profiles } = loadSpec(r);
    const stale = checkFreshness(r, { spec, profiles });
    const generatedMark = '<!-- GENERATED from spec@' + specHash(spec, profiles) + '; do not edit -->';
    const products = build(spec, profiles, CLAUSES, generatedMark);
    return { stale, spec, profiles, generatedMark, products };
  }, root);
}

// 产物写盘 symlink 逃逸守卫（写盘前逐段 lstat）：outBaseRejected 式字面路径闸挡不住既有符号链接段——
//   recursive mkdir 会穿越链接把产物写到仓库根之外。从 root 起逐段拼接相对路径（正斜杠切段），对每个
//   **已存在**段 lstat，任一为符号链接即 fail-closed 拒写（不存在段 break，链断即深段无既有链接，交 mkdir）。
//   检查覆盖目标文件自身及其所有父目录（末段即文件名）。闸门标识 output-symlink-segment-guard。
export function assertSafeProductOutput(root, rel) {
  const abs = path.join(root, ...rel.split('/'));
  let cur = root;
  for (const seg of path.relative(root, abs).split(path.sep)) {
    if (seg === '' || seg === '.') continue;
    cur = path.join(cur, seg);
    let st = null;
    try { st = fs.lstatSync(cur); } catch { break; }
    if (st.isSymbolicLink()) {
      throw new Error('BUILD output-symlink-segment-guard 拒绝：输出路径段为既有符号链接（' + cur + '），拒绝经链接写盘');
    }
  }
  return abs;
}

// 收容域校验（mkdir 之后 realpath）：输出父目录 realpath 必须落在解析后的仓库根之内（=== rootReal 或以
//   rootReal + path.sep 为前缀），否则即为经链接逃逸。须在 mkdirSync 之后调用（新建父目录否则 realpath ENOENT）。
//   闸门标识 output-realpath-root-containment。
export function assertProductDirWithinRoot(root, dir) {
  const rootReal = fs.realpathSync(root);
  const real = fs.realpathSync(dir);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error('BUILD output-realpath-root-containment 拒绝：输出父目录 realpath 越出仓库根（' + dir + ' -> ' + real + '），拒绝写盘');
  }
}

// 原子打开写盘（最终组件软链原子拒 + 先验证后截断 + 完整写入）：以 O_NOFOLLOW 打开目标文件（**不带
//   O_TRUNC**），目标在打开瞬间为符号链接时由内核原子拒绝（ELOOP）；打开后再复核父目录收容与「路径
//   当前是否仍为符号链接」，**通过之后**才 ftruncate 并写入——校验失败时既有内容保持原样（先验证后毁，
//   不以 O_TRUNC 在校验前破坏旧内容）。写盘以 Buffer 循环补写并检测零进展（writeSync 返回 0 即抛错，
//   不死循环）。平台无 O_NOFOLLOW 常量（本工作区 win32 实测 undefined）时走回退分支：写前复核父目录
//   收容并做最终组件 lstat 拒绝（由 O_NOFOLLOW_AVAIL 常量显式判定，非静默降级）。已知平台限制：
//   回退分支 lstat 复核与 writeFileSync 之间存在 TOCTOU 残窗（目标可在两步间被替换为符号链接），
//   写前复核仅收窄而不消除；用户态可进一步收窄（先开后验 fd-first 形态），
//   本计划按零行为变更收尾不引入该重构，留待专项；主分支（内核原子 ELOOP 拒绝）不受限。
//   退出语义：主流程异常
//   优先上抛；无主异常时 close 失败也上抛（不吞）。打开模式取 0o666（与 writeFileSync 默认一致、由
//   umask 收敛）。闸门标识 output-atomic-open-nofollow。
// 路径当前是否为符号链接：仅 ENOENT（确实不存在）视为「否」；其它元数据错误（如 EACCES）fail-closed 上抛。
function isSymlinkNow(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw e;
  }
}
const O_NOFOLLOW_AVAIL = typeof fs.constants.O_NOFOLLOW === 'number';
function writeFileAtomicNoFollow(root, p, text) {
  const dir = path.dirname(p);
  if (!O_NOFOLLOW_AVAIL) {
    assertProductDirWithinRoot(root, dir);           // 回退分支同样不得省略父目录收容复核
    if (isSymlinkNow(p)) {
      throw new Error('BUILD output-atomic-open-nofollow 拒绝：目标为既有符号链接（' + p + '），本平台无 O_NOFOLLOW，按写前 lstat 拒绝');
    }
    fs.writeFileSync(p, text);
    return;
  }
  // 不带 O_TRUNC：截断推迟到「打开后复核通过」之后，避免校验失败时旧内容已被破坏。
  const fd = fs.openSync(p, fs.constants.O_NOFOLLOW | fs.constants.O_CREAT | fs.constants.O_WRONLY, 0o666);
  let primary = null;
  try {
    // 打开后复核：父目录仍须在仓库根内、路径当前不得为符号链接；任一不成立即关闭 fd 抛错，写入零字节。
    assertProductDirWithinRoot(root, dir);
    if (isSymlinkNow(p)) {
      throw new Error('BUILD output-atomic-open-nofollow 拒绝：打开后路径为符号链接（' + p + '），拒绝写入');
    }
    fs.ftruncateSync(fd, 0);
    const buf = Buffer.from(text, 'utf8');
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(fd, buf, off, buf.length - off);
      if (n <= 0) throw new Error('BUILD output-atomic-open-nofollow 写入零进展（writeSync 返回 ' + n + '），拒绝死循环并以失败退出');
      off += n;
    }
  } catch (e) {
    primary = e;
  } finally {
    try { fs.closeSync(fd); } catch (e) { if (primary === null) primary = e; }
  }
  if (primary !== null) throw primary;
}

// 产物批量写盘入口（导出，供 selftest 以隔离根端到端驱动真实写链；CLI 与此函数共用同一入口，消除
//   helper 单测绿而写盘循环漏接守卫的接线空洞）：逐件 assertSafeProductOutput 逐段 lstat 预检 →
//   mkdirSync → assertProductDirWithinRoot realpath 收容 → writeFileAtomicNoFollow（O_NOFOLLOW 原子打开 +
//   打开后复核 + 完整写入）。WROTE 输出行为逐字不变。
export function writeProducts(root, products) {
  for (const p of products) {
    const f = assertSafeProductOutput(root, p.path);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    assertProductDirWithinRoot(root, path.dirname(f));
    writeFileAtomicNoFollow(root, f, p.text);
    console.log('WROTE ' + p.path);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const checkOnly = process.argv.includes('--check');
  // stale 判定单一真相源 = checkFreshness（与 run.mjs 消费同一函数，杜绝 --check 绿而 run.mjs 红的双口径）；
  // 装载与构建整体经 cliLoadOutcome 翻译闸（M-2）：坏配置归一为结构化 FAIL 行，不再裸栈击穿；
  // loadSpec 单次读盘，同一 {spec, profiles} 注入 checkFreshness 与构建路径（读盘去重，结果同源一致）。
  const outcome = cliLoadOutcome(root);
  if (outcome.specError !== null) {
    console.log('FAIL ' + outcome.specError);
    process.exit(1);
  }
  // 键名注记：payload = freshnessFailures 回调原样返回值（CLI 路径下为
  // { stale: 路径数组, spec, profiles, generatedMark, products } 载荷整体）；失败路径仅
  // specError 非 null（此时 payload=[]，不消费载荷键）。
  const { stale, spec, profiles, generatedMark, products } = outcome.payload;
  if (checkOnly) {
    if (stale.length > 0) {
      console.log('STALE ' + stale.length + ' 件产物与 spec 不一致，运行 node checks/build-agents.mjs 重生成');
      for (const p of stale) console.log('STALE ' + p);
      process.exit(1);
    }
    console.log('BUILD-CHECK OK ' + products.length + ' 件产物与 spec 一致');
    process.exit(0);
  }
  writeProducts(root, products);
  console.log('BUILD OK ' + products.length + ' 件产物已生成');
}
