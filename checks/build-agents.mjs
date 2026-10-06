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

// 纯函数：spec/profiles 内容哈希（契约 §4.4：确定性/敏感性）。
// canonical 序列化块按 id 排序（块库文件读取序不影响），sha256 前 12 位十六进制，零新依赖（node:crypto 为 Node 内置）。
// canonical-key-order-only 闸：profiles 递归按对象键排序后再序列化——manifest 的键序/排版属非语义视图，
//   不得进入哈希（否则重排键即误报全量 STALE，探针 probe-m1-keyorder 实测 hashA≠hashB）；
//   数组序（files/blocks/slots 值序）是 build 消费的语义序，绝不重排（触发域/不该触发域见行为契约）。
// canonical-null-proto-merge 闸：null-原型累加器（Object.create(null)）保证 __proto__ 等危险键按自有
//   数据键保留入哈希，而非触发原型 setter 被静默丢弃致哈希分叉（探针 probe-proto 已证伪"全局污染"、
//   改证"自有键丢失"，故护栏目标是键保留而非防污染）。
function canonicalizeValue(v) {
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
  const blockById = new Map((spec.blocks || []).map((b) => [b.id, b.text]));
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
      parts.push((f.blocks || []).map((id) => renderBlock(blockById.get(id), f.slots)).join('\n\n'));
      const text = parts.join('\n').trimEnd() + '\n';
      // build-no-anchor-swallow：渲染后逐条校验 expect 命中该路径的条款锚文本仍在（fail-closed）。
      for (const c of clauses) {
        if ((c.expect || []).some((re) => re.test(outPath)) && !text.includes(c.text)) {
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

function loadSpec(root) {
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
    if (!fs.existsSync(mf)) continue;
    profiles[platform] = JSON.parse(fs.readFileSync(mf, 'utf8'));
  }
  return { spec: { blocks }, profiles };
}

export function checkFreshness(root) {
  const { spec, profiles } = loadSpec(root);
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
//   两路，不读盘。返回 { stale: string[], specError: string|null }；抛错时 stale=[] 且 specError=消息。
//   spec-load-fault-family 谓词（r1 E2 回灌）：转译域仅限配置装载失效族——显式 fail-loud Error
//   （消息前缀 loadSpec:/build:，见 :113/:123/:60/:38/:42/:79）与 JSON.parse 的 SyntaxError（:132）；
//   TypeError/ReferenceError 等＝检查器自身编码缺陷，原样上抛保留堆栈诊断，严禁被翻译层吞没。
//   前缀谓词与消息文案的耦合是明示退化设计：文案变更致谓词失配时行为回落为原样上抛（= 修复前
//   形态，fail-noisy 不减损），不产生静默放行。
export function freshnessFailures(checkFreshnessFn, root) {
  try {
    return { stale: checkFreshnessFn(root), specError: null };
  } catch (err) {
    const isSpecLoadFault = (err instanceof SyntaxError)
      || (err instanceof Error && /^(loadSpec|build)/.test(err.message));
    if (!isSpecLoadFault) throw err;
    return { stale: [], specError: (err && err.message) ? String(err.message) : String(err) };
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..');
  const checkOnly = process.argv.includes('--check');
  const { spec, profiles } = loadSpec(root);
  // 版本戳：构建前计算 spec 内容哈希并注入生成标记（契约 4.4 ⑤；安装态用户可凭哈希对账 spec 版本）。
  const generatedMark = '<!-- GENERATED from spec@' + specHash(spec, profiles) + '; do not edit -->';
  const products = build(spec, profiles, CLAUSES, generatedMark);
  const stale = diffProducts(products, (p) => {
    const f = path.join(root, ...p.split('/'));
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  });
  if (checkOnly) {
    if (stale.length > 0) {
      console.log('STALE ' + stale.length + ' 件产物与 spec 不一致，运行 node checks/build-agents.mjs 重生成');
      for (const p of stale) console.log('STALE ' + p);
      process.exit(1);
    }
    console.log('BUILD-CHECK OK ' + products.length + ' 件产物与 spec 一致');
    process.exit(0);
  }
  for (const p of products) {
    const f = path.join(root, ...p.path.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, p.text);
    console.log('WROTE ' + p.path);
  }
  console.log('BUILD OK ' + products.length + ' 件产物已生成');
}
