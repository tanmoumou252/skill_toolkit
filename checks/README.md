# checks

三端代理规程与 skills 文档的常驻不变式对账器，兼计划/审查报告的机械质检器（零依赖，仅用 Node 内置模块）。

## 职责边界

- 负责：扫描 `kilocode`/`codebuddy`/`zcode`/`skills` 下的 `.md`，校验 frontmatter 键集、必含条款、逐字闸门与配对等式；对账计划侧攻击面台账与报告侧格式行。
- 不负责：mcp 运行时代码逻辑（归 `mcp/tests/`）；文档语义与文风判断——只报"违反即无歧义缺陷"的事实。

## 核心入口

- 文档不变式扫描: `checks/run.mjs`
- 攻击面/报告对账: `checks/attack-ledger.mjs`
- 产物生成与新鲜度闸: `checks/build-agents.mjs`（`node checks/build-agents.mjs --check` 只读校验 12 件产物与 spec 一致；缺省不带 --check 时重生成产物）
- 三端差异清点（观测器，非执法闸）: `checks/platform-inventory.mjs`（可选 `--out <基础路径>` 定制报告名，仅接受工作区内相对路径）

## 消费/调用约定

```bash
npm test --prefix checks          # 文档不变式 + 检测器自测（合成夹具驱动，不读磁盘）
npm test --prefix checks/ledger   # 自动对账最新时间戳计划与其影子报告
node checks/build-agents.mjs --check   # 12 件编译产物与 spec 一致性校验（只读）
node checks/platform-inventory.mjs     # 三端差异清点，报告写 .kilo/plans/（观测面，非执法闸）
```

退出码 `0` = 全部通过，`1` = 存在违反。

## 注意事项与暗坑

- 扫描面由 `SCAN_ROOTS` 路径模式驱动（run.mjs:10），新增文档自动纳入，不硬编码文件清单。
- 新增一条不变量：判据登记在 `registry.mjs` 或 `invariants.mjs` 的 id 登记常量（结构/入口/新鲜度闸分别为 STRUCTURAL_IDS/ENTRY_GATE_IDS/FRESHNESS_GATE_IDS）、检测器实现在 `invariants.mjs` 或入口装配、并在 `selftest.mjs` 补正/负控制用例；`run.mjs` 会把"加了检测器却忘登记 id"显式判红，登记在册的 id 以 `OK <id>` 行出现在实跑输出中，杜绝静默失效。
- 设计红线：禁含/互斥断言只准落在 frontmatter 结构化面（散文面禁含已被实测证伪，见 registry.mjs:5-8）；散文面只做必含与配对等式，不锁措辞、不锁出现次数。
- 计数不复刻：不变式条数与用例数以实跑输出的 `invariants=`/`scanned=` 为准，本文件不写死数字，防文案与事实漂移。
- `attack-ledger.mjs` 的 `ENFORCEMENT_FILES` 现含 `mcp/plan-governor.js`、`mcp/webui.js`、`checks/attack-ledger.mjs`、`checks/build-agents.mjs` 四项——对 mcp 两项属开发期对账耦合，非 mcp 运行期依赖；checks 两项使对账器与生成器自身同受台账执法约束。
