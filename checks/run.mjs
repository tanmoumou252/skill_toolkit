// 常驻不变式检查入口：遍历仓库文档 → 分类 → 跑检测器 → 打印 OK/FAIL 与汇总 → 置退出码。
// 退出码：0 = 全部通过；1 = 存在违反。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allInvariantIds,
  classify,
  runAll,
  SCAN_ROOTS,
  scanEntryDirNames,
  unclassifiedPlatformFiles,
  unscannedRoots,
} from './invariants.mjs';
// 新鲜度闸以命名空间导入存取：生成器空桩阶段零导出，命名导入会在 ESM 链接期抛 SyntaxError；
// 命名空间 + 守卫把缺失降级为「闸不触发」，实现落盘后直取真函数。
import * as buildNs from './build-agents.mjs';
const checkFreshness = typeof buildNs.checkFreshness === 'function' ? buildNs.checkFreshness : () => [];

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

const abs = [];
for (const r of SCAN_ROOTS) {
  const d = path.join(root, r);
  if (fs.existsSync(d)) walk(d, abs);
}

let failures = 0;
const violations = [];
const pushGate = (id, p, msg) => violations.push({ id, path: p, msg });
// 闸 A：扫描根差集 fail-loud——SCAN_ROOTS 硬编码意味着新顶层平台目录从不被 walk，其下文件
// 对全部闸门不可达；未登记顶层目录必须在此大声报错，严禁静默跳过。点目录、显式登记的
// 非平台工具根（NON_PLATFORM_ROOTS）与本地构建产物根（BUILD_ARTIFACT_ROOTS，如 node_modules）
// 不触发；新增平台须显式登记 SCAN_ROOTS 与 CLASSES/键集。
const entryDirNames = scanEntryDirNames(
  fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
);
for (const r of unscannedRoots(entryDirNames, SCAN_ROOTS)) {
  pushGate('unscanned-root-directory', r, '顶层目录未登记扫描根或非平台根（SCAN_ROOTS/NON_PLATFORM_ROOTS），其下文件全部闸门不可达——新平台须显式登记 SCAN_ROOTS 与 CLASSES/键集，非平台工具目录须显式登记 NON_PLATFORM_ROOTS，本地构建产物根须显式登记 BUILD_ARTIFACT_ROOTS');
}
const allFiles = abs
  .map((p) => ({
    path: path.relative(root, p).split(path.sep).join('/'),
    text: fs.readFileSync(p, 'utf8'),
  }));
// 闸 B：未登记平台 fail-loud——已扫描根内平台治理/代理形态文件未被 CLASSES 登记即在此大声
// 报错，严禁随 classify 过滤静默丢弃。新增平台须显式登记 CLASSES 与逐平台键集
// （AGENT_KEYS/PRIVATE_AGENT_KEYS，键集不可自动推导）。
for (const p of unclassifiedPlatformFiles(allFiles)) {
  pushGate('unclassified-platform-file', p, '平台治理/代理文件未登记扫描分类（CLASSES 未含该平台），闸门对其静默失效——新增平台须显式登记 CLASSES 与键集');
}
const files = allFiles
  .filter((f) => classify(f.path) !== null)
  .sort((x, y) => (x.path < y.path ? -1 : 1));

violations.push(...runAll(files));
for (const id of allInvariantIds()) {
  const group = violations.filter((v) => v.id === id);
  if (group.length === 0) {
    console.log(`OK   ${id}`);
    continue;
  }
  for (const g of group) {
    failures += 1;
    console.log(`FAIL ${id} ${g.path} :: ${g.msg}`);
  }
}

// 未登记在册的 id 也要暴露，避免"加了断言却忘了登记"导致静默失效
for (const v of violations) {
  if (!allInvariantIds().includes(v.id)) {
    failures += 1;
    console.log(`FAIL ${v.id} ${v.path} :: ${v.msg}`);
  }
}

// 新鲜度闸（build-freshness-check）：manifest 声明的产物与 spec 重算不一致或缺失即红；
// spec 树不存在 / files 为空 = 编译未启用，空真不触发（不该触发域）。
// 口径声明：generated-product-stale 为新鲜度违规，独立累加 failures 并逐条打印，
// 不计入 violations= 汇总行（该行语义 = 不变量违规数，两者口径独立、不互相吞并）。
for (const stalePath of checkFreshness(root)) {
  failures += 1;
  console.log(`FAIL generated-product-stale ${stalePath} :: spec 已变更而三端产物未重生成，运行 node checks/build-agents.mjs 重生成`);
}
console.log(`scanned=${files.length} invariants=${allInvariantIds().length} violations=${violations.length}`);
console.log(failures === 0 ? 'TOOLKIT-INVARIANTS ALL OK' : 'TOOLKIT-INVARIANTS FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
