// 平台清点器（编译产物模型第一期）：对三平台代理规程文档做机械差异清点，产出结构化差异报告。
// 设计定位：清点观测工具，非执法闸——本文件不进 ENFORCEMENT_FILES（对账面收编属后续期生成器/陈旧性闸的义务）。
// 架构：纯函数核心（收文件集参数，可被 selftest 以合成文件集驱动，不读磁盘）+ CLI 薄壳（读真实磁盘、写报告）。
// 对齐语义：对齐单元 = registry 条款锚（CLAUSES/DERIVED_CLAUSES 的锚文本即条款身份）；
//   围栏掩蔽与 frontmatter 解析复用 invariants 既有导出（scanFences/parseFrontmatter），零新依赖。
import { CLAUSES, DERIVED_CLAUSES, PLATFORMS } from './registry.mjs';
import { scanFences, parseFrontmatter } from './invariants.mjs';

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
export function splitByAnchors(bodyLines, clauses) {
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
        if (pending.length) unanchored.push({ startLine: pendingStart, lines: pending });
      } else if (current) {
        blocks.get(current.id).lines = pending;
      } else if (pending.length) {
        unanchored.push({ startLine: pendingStart, lines: pending });
      }
      if (blocks.has(hit.id)) {
        repeats.push({ clauseId: hit.id, line: i + 1 });
        // 后续出现不切分新块；其行并入既有块（保持「块内容自锚首现行延伸至下一锚首现行」）
        blocks.get(hit.id).lines.push(line);
        current = { id: hit.id, tail: true };
        pending = [];
        pendingStart = null;
      } else {
        blocks.set(hit.id, { startLine: i + 1, lines: [line] });
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
    if (pending.length) unanchored.push({ startLine: pendingStart, lines: pending });
  } else if (current && !current.tail) {
    blocks.get(current.id).lines = pending;
  } else if (pending.length) {
    unanchored.push({ startLine: pendingStart, lines: pending });
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
    else if (JSON.stringify(treeA[key]) !== JSON.stringify(treeB[key])) diffs.push({ key, kind: 'fm-value', values: [treeA[key], treeB[key]] });
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

  // frontmatter：按平台序两两对照首个文件（同组角色由调用方保证；组内逐对照首个）。
  for (let i = 1; i < parsed.length; i++) {
    for (const d of diffFmTrees(parsed[0].fm.tree, parsed[i].fm.tree)) {
      frontmatter.diffs.push({ kind: d.kind, path: parsed[i].path, key: d.key, values: d.values, reference: parsed[0].path });
    }
  }

  // 锚切分（每文件独立）。
  const splits = parsed.map((p) => splitByAnchors(p.outside, clauseList));

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
  // 不静默丢弃，同位同文不报）。角色 = 路径剥平台前缀；zcode 的 -subagent-sp 别名归一为 -sp。
  const roleOf = (p) => p.replace(/^[^/]+\//, '').replace('-subagent-sp.md', '-sp.md');
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
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const files = [];
  for (const platform of PLATFORMS) {
    const agentsDir = path.join(root, platform, 'agents');
    for (const name of ['AGENTS.md', ...(fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort().map((f) => 'agents/' + f) : [])]) {
      const full = path.join(root, platform, name);
      files.push({ path: `${platform}/${name}`, text: fs.readFileSync(full, 'utf8') });
    }
  }
  const result = inventory(files);
  const outDir = path.join(root, '.kilo', 'plans');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, '20261005-tri-platform-inventory.json');
  const mdPath = path.join(outDir, '20261005-tri-platform-inventory-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(result));
  const total = result.anchorSet.diffs.length + result.frontmatter.diffs.length + result.sections.diffs.length + result.fences.diffs.length + result.unanchored.diffs.length;
  console.log(`PLATFORM-INVENTORY files=${result.files.length} diffs=${total} json=${jsonPath} md=${mdPath}`);
}
