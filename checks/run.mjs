// 常驻不变式检查入口：遍历仓库文档 → 分类 → 跑检测器 → 打印 OK/FAIL 与汇总 → 置退出码。
// 退出码：0 = 全部通过；1 = 存在违反。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allInvariantIds, classify, runAll } from './invariants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SCAN_ROOTS = ['kilocode', 'codebuddy', 'zcode', 'skills'];

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

const files = abs
  .map((p) => ({
    path: path.relative(root, p).split(path.sep).join('/'),
    text: fs.readFileSync(p, 'utf8'),
  }))
  .filter((f) => classify(f.path) !== null)
  .sort((x, y) => (x.path < y.path ? -1 : 1));

const violations = runAll(files);
let failures = 0;
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

console.log(`scanned=${files.length} invariants=${allInvariantIds().length} violations=${violations.length}`);
console.log(failures === 0 ? 'TOOLKIT-INVARIANTS ALL OK' : 'TOOLKIT-INVARIANTS FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
