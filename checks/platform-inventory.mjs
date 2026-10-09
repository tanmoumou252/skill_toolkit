// 平台清点器（编译产物模型第一期）：对三平台代理规程文档做机械差异清点，产出结构化差异报告。
// 设计定位：清点观测工具，非执法闸——本文件不进 ENFORCEMENT_FILES（对账面收编属后续期生成器/陈旧性闸的义务）。
// 架构：纯函数核心（收文件集参数，可被 selftest 以合成文件集驱动，不读磁盘）+ CLI 薄壳（读真实磁盘、写报告）。
// 对齐语义：对齐单元 = registry 条款锚（CLAUSES/DERIVED_CLAUSES 的锚文本即条款身份）；
//   围栏掩蔽与 frontmatter 解析复用 invariants 既有导出（scanFences/parseFrontmatter），零新依赖。
import { CLAUSES, DERIVED_CLAUSES, PLATFORMS } from './registry.mjs';
import { scanFences, parseFrontmatter } from './invariants.mjs';
import { canonicalizeValue } from './build-agents.mjs';

// 规范化：行尾 trim、折叠连续空行——跨端正文块比对前的最小归一。
function normalizeLines(lines) {
  const out = [];
  let blankRun = false;
  for (const l of lines) {
    const t = l.replace(/[ \t]+$/, '');
    if (t === '') {
      if (blankRun) continue;
      blankRun = true;
    } else {
      blankRun = false;
    }
    out.push(t);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// frontmatter 之后、围栏掩蔽前的围栏外行。
// 退化输入：parseFrontmatter 返回 present=false 或 terminated=false 时，整文按无 frontmatter 正文处理
//（不使用 endLine 切片——规避 endLine=-1 触发 slice(-1) 把正文末行当 frontmatter 静默吞掉）。
export function sectionBody(text, fmEndLine) {
  const lines = text.split(/\r?\n/);
  const start = fmEndLine !== null && fmEndLine !== undefined && fmEndLine >= 0 ? fmEndLine : 0;
  return lines.slice(start);
}

// 锚切分：首个包含 clause.text 的行切段，块 id = clause.id；bodyLines 应已剔除围栏内行。
// 锚重复出现语义（最小意外）：取首处为块边界，同一锚文本的后续出现不再切分新块，
// 但每处后续出现各计一条 anchor-repeat 差异（由调用方依据返回的 repeats 生成）。
// lineNos 可选参数：body 下标 → 文件绝对行号 的平行数组（由调用方 inventory 传 outsideLineNos）；
// 缺省/长度不齐时逐下标回落掩蔽空间相对序号 i+1（第三方直调兼容面，语义显式降级非静默错位）。
export function splitByAnchors(bodyLines, clauses, lineNos = null) {
  const ln = (i) => (Array.isArray(lineNos) && lineNos[i] !== undefined && lineNos[i] !== null ? lineNos[i] : i + 1);
  const blocks = new Map(); // clauseId -> { startLine, lines }
  const repeats = []; // { clauseId, line }
  let current = null;
  const unanchored = []; // { startLine, lines }
  let pending = [];
  let pendingStart = null;
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const hit = clauses.find((c) => line.includes(c.text));
    if (hit) {
      // 冲刷上一段（tail 感知）：tail（重复锚后残留）归 unanchored 单段，绝不误清重复锚块 .lines；
      // 非 tail 归该块正文；无块归 unanchored。三路互斥，与 EOF 冲刷同构。
      if (current && current.tail) {
        if (pending.length) unanchored.push({ startLine: ln(pendingStart - 1), lines: pending });
      } else if (current) {
        // 冲刷＝块首锚行保留 + 锚后正文追加：块内容自锚首现行延伸至下一锚首现行（锚行属比对域，
        // 装饰差异可检出）；tail 语义不受影响（重复锚块的 lines 由 :62 push 路径维护）。
        blocks.get(current.id).lines.push(...pending);
      } else if (pending.length) {
        unanchored.push({ startLine: ln(pendingStart - 1), lines: pending });
      }
      if (blocks.has(hit.id)) {
        repeats.push({ clauseId: hit.id, line: ln(i) });
        // 后续出现不切分新块；其行并入既有块（保持「块内容自锚首现行延伸至下一锚首现行」）
        blocks.get(hit.id).lines.push(line);
        current = { id: hit.id, tail: true };
        pending = [];
        pendingStart = null;
      } else {
        blocks.set(hit.id, { startLine: ln(i), lines: [line] });
        current = { id: hit.id, tail: false };
        pending = [];
        pendingStart = null;
      }
      continue;
    }
    if (current && !current.tail) {
      pending.push(line);
    } else if (current && current.tail) {
      // tail-region-coalesce：重复锚之后的连续无锚行并入单一 pending 段（与 EOF 路径同构），
      // 不再逐行独立成段——杜绝 unanchored 计数放大与 inventory() 按段索引跨端配对错位。
      if (pendingStart === null) pendingStart = i + 1;
      pending.push(line);
    } else {
      if (pendingStart === null) pendingStart = i + 1;
      pending.push(line);
    }
  }
  if (current && current.tail) {
    if (pending.length) unanchored.push({ startLine: ln(pendingStart - 1), lines: pending });
  } else if (current && !current.tail) {
    // EOF 冲刷与锚命中冲刷同构：锚行保留 + 锚后正文追加（与上方冲刷语义一致）。
    blocks.get(current.id).lines.push(...pending);
  } else if (pending.length) {
    unanchored.push({ startLine: ln(pendingStart - 1), lines: pending });
  }
  return { blocks, repeats, unanchored };
}

// frontmatter 键级 diff：键集差 + 叶值不等，不做文本 diff。
// kind 以被比较文件（B）为视角：B 多出的键 = fm-key-extra；B 缺的键 = fm-key-missing；叶值不等 = fm-value。
export function diffFmTrees(treeA, treeB) {
  const diffs = [];
  const keys = new Set([...Object.keys(treeA || {}), ...Object.keys(treeB || {})]);
  for (const key of [...keys].sort()) {
    const inA = Object.prototype.hasOwnProperty.call(treeA || {}, key);
    const inB = Object.prototype.hasOwnProperty.call(treeB || {}, key);
    if (inB && !inA) diffs.push({ key, kind: 'fm-key-extra', values: [null, treeB[key]] });
    else if (inA && !inB) diffs.push({ key, kind: 'fm-key-missing', values: [treeA[key], null] });
    else if (JSON.stringify(canonicalizeValue(treeA[key])) !== JSON.stringify(canonicalizeValue(treeB[key]))) diffs.push({ key, kind: 'fm-value', values: [treeA[key], treeB[key]] });
  }
  return diffs;
}

function fencedSegments(text) {
  const lines = text.split(/\r?\n/);
  const { pairs, unclosed } = scanFences(text);
  const segs = [];
  for (const p of pairs) {
    segs.push(lines.slice(p.openLine, Math.min(p.closeLine - 1, lines.length)));
  }
  for (const u of unclosed) {
    segs.push(lines.slice(u));
  }
  return segs.map((s) => normalizeLines(s).join('\n'));
}

// 纯函数：files = [{ path, text }]，clauses 缺省 = CLAUSES ∪ DERIVED_CLAUSES（仅取 {id, text}）。
// 五差异面：anchorSet（锚集差 + 重复锚）/ frontmatter（键级）/ sections（同锚正文块跨端比对）/
// fences（围栏内内容，独立归面）/ unanchored（无锚残留段）。空差异面是合法输出（三端已一致）。
export function inventory(files, clauses) {
  const clauseList = (clauses || [...CLAUSES, ...DERIVED_CLAUSES]).map((c) => ({ id: c.id, text: c.text }));
  const anchorSet = { perFile: {}, diffs: [] };
  const frontmatter = { diffs: [] };
  const sections = { diffs: [] };
  const fences = { diffs: [] };
  const unanchored = { diffs: [] };

  const parsed = files.map((f) => {
    const fm = parseFrontmatter(f.text);
    const body = sectionBody(f.text, fm.present && fm.terminated ? fm.endLine : null);
    const { pairs, unclosed } = scanFences(f.text);
    const fenced = new Array(body.length).fill(false);
    const lineNo = (i) => (fm.present && fm.terminated ? fm.endLine : 0) + i + 1;
    for (const p of pairs) {
      for (let ln = p.openLine; ln <= Math.min(p.closeLine, p.openLine + body.length + 1); ln++) {
        const idx = ln - 1 - (fm.present && fm.terminated ? fm.endLine : 0);
        if (idx >= 0 && idx < body.length) fenced[idx] = true;
      }
    }
    for (const u of unclosed) {
      for (let ln = u; ln <= f.text.split(/\r?\n/).length; ln++) {
        const idx = ln - 1 - (fm.present && fm.terminated ? fm.endLine : 0);
        if (idx >= 0 && idx < body.length) fenced[idx] = true;
      }
    }
    const outside = body.filter((_, i) => !fenced[i]);
    const outsideLineNos = body.map((_, i) => lineNo(i)).filter((_, i) => !fenced[i]);
    return { path: f.path, fm, outside, outsideLineNos };
  });

  // roleOf：路径剥平台前缀；zcode 的 -subagent-sp 别名归一为 -sp（与 unanchored/fences 分组同一事实源，
  // 定义上移至首个消费点之前，原中部定义删除，避免双源）。
  const roleOf = (p) => p.replace(/^[^/]+\//, '').replace('-subagent-sp.md', '-sp.md');
  // frontmatter：按角色组内两两对照首个文件（分组口径与 sections/unanchored/fences 一致，跨角色不配对）。
  // 组参照无 frontmatter（present=false）时键级对照无意义：成员有 frontmatter → 每成员恰一条
  // fm-reference-absent 登记信号；成员亦无 → 零条目（合法静默：无对照物）。绝不产逐键 fm-key-extra 噪声。
  const fmRoleGroups = new Map();
  parsed.forEach((p, i) => {
    const role = roleOf(p.path);
    if (!fmRoleGroups.has(role)) fmRoleGroups.set(role, []);
    fmRoleGroups.get(role).push(i);
  });
  for (const idxs of fmRoleGroups.values()) {
    if (idxs.length < 2) continue;
    const ref = parsed[idxs[0]];
    for (const k of idxs.slice(1)) {
      const mem = parsed[k];
      if (!ref.fm.present) {
        if (mem.fm.present) frontmatter.diffs.push({ kind: 'fm-reference-absent', path: mem.path, key: null, values: [null, null], reference: ref.path });
        continue;
      }
      // 反向对称（M-1）：成员无 frontmatter → 恰一条 fm-member-absent 登记信号（非逐键
      // fm-key-missing 噪声）；语义与正向 fm-reference-absent 对称：登记非噪声、成员亦缺则静默。
      if (!mem.fm.present) {
        frontmatter.diffs.push({ kind: 'fm-member-absent', path: mem.path, key: null, values: [null, null], reference: ref.path });
        continue;
      }
      for (const d of diffFmTrees(ref.fm.tree, mem.fm.tree)) {
        frontmatter.diffs.push({ kind: d.kind, path: mem.path, key: d.key, values: d.values, reference: ref.path });
      }
    }
  }

  // 锚切分（每文件独立）。
  const splits = parsed.map((p) => splitByAnchors(p.outside, clauseList, p.outsideLineNos));

  // 锚集：perFile + 缺锚/多锚 + 重复锚。
  parsed.forEach((p, i) => {
    const ids = [...splits[i].blocks.keys()];
    anchorSet.perFile[p.path] = ids;
  });
  for (const c of clauseList) {
    const holders = parsed.filter((_, i) => splits[i].blocks.has(c.id));
    if (holders.length === 0 || holders.length === parsed.length) continue;
    const holderPaths = new Set(holders.map((h) => h.path));
    parsed.forEach((p) => {
      if (!holderPaths.has(p.path)) anchorSet.diffs.push({ kind: 'anchor-set', path: p.path, clauseId: c.id, side: 'missing' });
    });
    if (holders.length === 1) {
      anchorSet.diffs.push({ kind: 'anchor-set', path: holders[0].path, clauseId: c.id, side: 'extra' });
    }
  }
  splits.forEach((s, i) => {
    for (const r of s.repeats) {
      anchorSet.diffs.push({ kind: 'anchor-repeat', path: parsed[i].path, clauseId: r.clauseId, line: r.line });
    }
  });

  // sections：同 clauseId 的跨端正文块两两对照首个持有者；规范化（行尾 trim + 折叠空行）后比对。
  for (const c of clauseList) {
    const holders = parsed.map((p, i) => ({ p, i })).filter(({ i }) => splits[i].blocks.has(c.id));
    if (holders.length < 2) continue;
    const ref = holders[0];
    const refNorm = normalizeLines(splits[ref.i].blocks.get(c.id).lines);
    for (let k = 1; k < holders.length; k++) {
      const norm = normalizeLines(splits[holders[k].i].blocks.get(c.id).lines);
      if (norm.join('\n') !== refNorm.join('\n')) {
        const same = norm.filter((l) => refNorm.includes(l)).length;
        const similarity = refNorm.length + norm.length === 0 ? 1 : same / Math.max(refNorm.length, norm.length, 1);
        sections.diffs.push({ kind: 'section', clauseId: c.id, pathA: ref.p.path, pathB: holders[k].p.path, similarity });
      }
    }
  }

  // unanchored：无锚残留段按角色组内对照首个文件（跨角色不配对——AGENTS.md 与 agents/* 段落结构无对应关系；
  // 不静默丢弃，同位同文不报）。角色 = roleOf（定义见 frontmatter 段上方，单一事实源）。
  const roleGroups = new Map();
  parsed.forEach((p, i) => {
    const role = roleOf(p.path);
    if (!roleGroups.has(role)) roleGroups.set(role, []);
    roleGroups.get(role).push(i);
  });
  for (const idxs of roleGroups.values()) {
    if (idxs.length < 2) continue;
    const maxSegs = Math.max(...idxs.map((i) => splits[i].unanchored.length), 0);
    for (let s = 0; s < maxSegs; s++) {
      const ref = splits[idxs[0]].unanchored[s];
      const refNorm = ref ? normalizeLines(ref.lines).join('\n') : null;
      for (let k = 1; k < idxs.length; k++) {
        const seg = splits[idxs[k]].unanchored[s];
        const norm = seg ? normalizeLines(seg.lines).join('\n') : null;
        if ((refNorm || '') !== (norm || '')) {
          unanchored.diffs.push({ kind: 'unanchored', path: parsed[idxs[k]].path, line: seg ? seg.startLine : null, reference: parsed[idxs[0]].path });
        }
      }
    }
  }

  // fences：按角色组配对（组定义见上方 roleOf），组内对照首个文件。
  const groups = new Map();
  parsed.forEach((p, i) => {
    const role = roleOf(p.path);
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(i);
  });
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const refSegs = fencedSegments(files[idxs[0]].text);
    const minCount = Math.min(...idxs.map((i) => fencedSegments(files[i].text).length));
    // 围栏计数不等的语义（按计划夹具 112 的可执行契约）：每个计数 ≠ 参照端的文件各计一条差异
    //（不按缺失槽位逐条计——「三端围栏数不等」本身是一个组级信号，逐对展开会放大计数）。
    for (let k = 1; k < idxs.length; k++) {
      const segs = fencedSegments(files[idxs[k]].text);
      if (segs.length !== refSegs.length) {
        fences.diffs.push({ kind: 'fence', pathA: parsed[idxs[0]].path, pathB: parsed[idxs[k]].path, fenceIndex: segs.length, reason: 'fence-count' });
      }
      // 共位（< minCount）内容不等的语义（按计划夹具 109 的可执行契约）：逐文件各计一条。
      for (let fi = 0; fi < Math.min(minCount, segs.length); fi++) {
        if (refSegs[fi] !== segs[fi]) {
          fences.diffs.push({ kind: 'fence', pathA: parsed[idxs[0]].path, pathB: parsed[idxs[k]].path, fenceIndex: fi, reason: 'content' });
        }
      }
    }
  }

  return { files: parsed.map((p) => p.path), anchorSet, frontmatter, sections, fences, unanchored };
}

// —— CLI 薄壳：读真实磁盘、写报告；不做任何裁决逻辑 ——
// 写面函数化（参数化 + 可测）：collectPlatformFiles / runInventory / outBaseRejected 导出供
// selftest 以真实文件集与 tmpdir 驱动全链，CLI 块仅保留参数解析与打印薄壳。
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// --out 收容闸（纯函数）：拒绝绝对路径、盘符前缀与 .. 段（反斜杠先归一再判）；其余相对路径放行。
export function outBaseRejected(outArg) {
  const raw = String(outArg);
  const norm = path.posix.normalize(raw.replace(/\\/g, '/'));
  return path.posix.isAbsolute(norm) || /^[A-Za-z]:/.test(raw) || norm.split('/').includes('..');
}

// 三端文件集收集：任一已登记平台缺 AGENTS.md ⇒ 结构化抛错拒清点（fail-loud，拒绝静默跳过）；
// agents/ 子目录缺失保持既有容忍（只清点 AGENTS.md）。
export function collectPlatformFiles(root) {
  const files = [];
  for (const platform of PLATFORMS) {
    const gov = path.join(root, platform, 'AGENTS.md');
    if (!fs.existsSync(gov)) {
      throw new Error('PLATFORM-INVENTORY FAIL 缺少平台治理文件 ' + platform + '/AGENTS.md（三端清点要求三份治理文件齐备，拒绝静默跳过）');
    }
    const agentsDir = path.join(root, platform, 'agents');
    for (const name of ['AGENTS.md', ...(fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort().map((f) => 'agents/' + f) : [])]) {
      files.push({ path: platform + '/' + name, text: fs.readFileSync(path.join(root, platform, name), 'utf8') });
    }
  }
  return files;
}

// 清点 + 渲染 + 双报告写盘（路径全参数化，selftest 以 tmpdir 驱动；CLI 缺省仍落 .kilo/plans/）。
export function runInventory(root, outDir, base) {
  const files = collectPlatformFiles(root);
  const result = inventory(files);
  const jsonPath = path.join(outDir, base + '.json');
  const mdPath = path.join(outDir, base + '-report.md');
  // base 含路径段（如 reports/inv）时输出父目录可能不存在：写盘前按两份输出的共同父目录递归建目录
  // （json 与 md 同父目录，一次 mkdir 覆盖两份输出），端到端可写、拒绝 ENOENT 裸崩。
  // symlink 写逃逸守卫①（mkdir 前中间段预扫）：outBaseRejected 只挡字面绝对路径/盘符/.. 段，
  //   挡不住 outDir 内既有符号链接——从 outDir 起逐段拼接至输出父目录，对每个已存在的中间段
  //   lstat，任一为符号链接即拒（否则 recursive mkdir 会穿越链接在盘外递归建目录）；不存在的
  //   中间段放行，由 mkdir 正常建立（链上某段不存在则更深段亦无既有链接，直接交 mkdir）。
  const parentDir = path.dirname(jsonPath);
  let probe = outDir;
  for (const seg of path.relative(outDir, parentDir).split(path.sep)) {
    if (seg === '' || seg === '.') break;
    probe = path.join(probe, seg);
    let st = null;
    try { st = fs.lstatSync(probe); } catch { break; }
    if (st.isSymbolicLink()) {
      throw new Error('PLATFORM-INVENTORY FAIL 输出父目录中间段为既有符号链接（' + probe + '），拒绝经链接递归建目录');
    }
  }
  // 守卫①（写前，mkdir 之前，仓库根锚定）：写盘的一切副作用（递归建目录与报告写）都必须落在解析后的
  //   仓库根之内。先做词法收容（outDir 须在 root 之内），再自 root 起沿 outDir 的路径链逐段 lstat：
  //   任一既有段为符号链接即拒——root→outDir 的 .kilo/plans 被指向仓库外的链接劫持时，recursive mkdir
  //   会先在盘外建出目录、报告也会写到盘外；收容判定不得后置于 mkdir（mkdir 本身即写盘副作用）。
  //   不存在的段放行（链断即无既有链接可劫持），交下方 mkdir 正常建立。
  const rootReal = fs.realpathSync(root);
  const relOut = path.relative(root, outDir);
  if (path.isAbsolute(relOut) || relOut === '..' || relOut.startsWith('..' + path.sep)) {
    throw new Error('PLATFORM-INVENTORY FAIL 输出目录越出仓库根（' + outDir + '），拒绝建目录与写盘');
  }
  let linkProbe = root;
  for (const seg of relOut.split(path.sep)) {
    if (seg === '' || seg === '.') continue;
    linkProbe = path.join(linkProbe, seg);
    let stLink = null;
    try { stLink = fs.lstatSync(linkProbe); } catch { break; }
    if (stLink.isSymbolicLink()) {
      throw new Error('PLATFORM-INVENTORY FAIL 输出收容目录路径段为既有符号链接（' + linkProbe + '），拒绝经链接建目录与写盘');
    }
  }
  fs.mkdirSync(parentDir, { recursive: true });
  // 守卫②（mkdir 后收容域校验，收容根＝仓库根）：outDir 与输出父目录分别 realpath，解析结果必须落在
  //   解析后的仓库根之内（=== rootReal 或以 rootReal + path.sep 为前缀）。锚定仓库根而非 outDir：若
  //   root→outDir 段被链接劫持，outDir 的 realpath 会越出仓库根，此处直接拒绝（不以「可能被替换的
  //   outDir」当收容根，避免链接目标劫持后「自洽相等」误判放行）；亦不依赖 CLI 入口的
  //   cliOutDirSymlinkFree 预检——本函数被 selftest 与 CLI 双路调用，CLI 预检只覆盖其一。
  //   守卫③（写盘前）：json/md 任一既有条目（含悬空链接）为符号链接即拒写。
  for (const dir of [outDir, parentDir]) {
    const real = fs.realpathSync(dir);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error('PLATFORM-INVENTORY FAIL 输出目录符号链接逃逸仓库根（' + dir + ' -> ' + real + ' 越出收容域 ' + rootReal + '），拒绝写盘');
    }
  }
  for (const p of [jsonPath, mdPath]) {
    let st = null;
    try { st = fs.lstatSync(p); } catch { /* 不存在：首次写，放行 */ }
    if (st !== null && st.isSymbolicLink()) {
      throw new Error('PLATFORM-INVENTORY FAIL 输出路径为既有符号链接（' + p + '），拒绝写盘');
    }
  }
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(result));
  const total = result.anchorSet.diffs.length + result.frontmatter.diffs.length + result.sections.diffs.length + result.fences.diffs.length + result.unanchored.diffs.length;
  return { result, jsonPath, mdPath, total };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|');
}

function renderMarkdown(result) {
  const lines = [];
  lines.push('# 三端平台差异清点报告（机械清点，未裁决）');
  lines.push('');
  lines.push(`- 覆盖文件：${result.files.length} 份`);
  lines.push(`- 差异计数：anchorSet=${result.anchorSet.diffs.length} / frontmatter=${result.frontmatter.diffs.length} / sections=${result.sections.diffs.length} / fences=${result.fences.diffs.length} / unanchored=${result.unanchored.diffs.length}`);
  lines.push('');
  const face = (name, diffs, cols, render) => {
    lines.push(`## ${name}（${diffs.length} 条）`);
    lines.push('');
    if (diffs.length === 0) {
      lines.push('（零差异——合法语义：本面对齐。）');
      lines.push('');
      return;
    }
    lines.push('| ' + cols.join(' | ') + ' |');
    lines.push('|' + cols.map(() => '---').join('|') + '|');
    for (const d of diffs) lines.push('| ' + render(d).map(mdEscape).join(' | ') + ' |');
    lines.push('');
  };
  face('锚集差异', result.anchorSet.diffs, ['kind', 'path', 'clauseId', 'side/line'], (d) => [d.kind, d.path, d.clauseId, d.side || ('L' + d.line)]);
  face('frontmatter 键级差异', result.frontmatter.diffs, ['kind', 'path', 'key'], (d) => [d.kind, d.path, d.key]);
  face('正文块差异', result.sections.diffs, ['clauseId', 'pathA', 'pathB', 'similarity'], (d) => [d.clauseId, d.pathA, d.pathB, d.similarity.toFixed(2)]);
  face('围栏内差异', result.fences.diffs, ['pathA', 'pathB', 'fenceIndex'], (d) => [d.pathA, d.pathB, d.fenceIndex]);
  face('无锚残留段差异', result.unanchored.diffs, ['path', 'line', 'reference'], (d) => [d.path, d.line, d.reference]);
  return lines.join('\n');
}

// CLI 入口根相对 symlink 预检（纯函数，可 selftest tmpdir 直调）：runInventory 的收容根为 realpathSync(outDir)，
//   不校验 root→outDir 之间的 .kilo / plans 段——若其为指向仓库外的符号链接，收容根被链接目标劫持，写盘可逃逸
//   仓库根。故仅在 CLI 入口、调用 runInventory 之前，从 root 起对 .kilo、plans 逐段 lstat，任一既有段为符号链接
//   即判不安全。不存在段（首次写）放行交 runInventory 的 mkdir 正常建立。返回 true=安全可写。
export function cliOutDirSymlinkFree(root) {
  let cur = root;
  for (const seg of ['.kilo', 'plans']) {
    cur = path.join(cur, seg);
    let st = null;
    try { st = fs.lstatSync(cur); } catch { return true; }
    if (st.isSymbolicLink()) return false;
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
  const outArg = arg('--out');
  let outBase = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-tri-platform-inventory';
  if (outArg !== null) {
    if (outBaseRejected(outArg)) {
      console.log('PLATFORM-INVENTORY FAIL --out 拒绝（仅接受工作区内相对路径，禁止绝对路径/盘符/..段）: ' + outArg);
      process.exit(2);
    }
    outBase = String(outArg).replace(/\\/g, '/').replace(/\.json$/, '');
  }
  const outDir = path.join(root, '.kilo', 'plans');
  if (!cliOutDirSymlinkFree(root)) {
    console.log('PLATFORM-INVENTORY FAIL 输出收容目录 root→.kilo→plans 路径含既有符号链接，拒绝写盘（仓库根→outDir 段被链接劫持，越出收容域）');
    process.exit(2);
  }
  const r = runInventory(root, outDir, outBase);
  console.log(`PLATFORM-INVENTORY files=${r.result.files.length} diffs=${r.total} json=${r.jsonPath} md=${r.mdPath}`);
}
