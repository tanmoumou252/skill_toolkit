---
id: agents-md-execution-iron-laws
expects: auto
slots: [iron_laws_title, iron_laws_preamble, exec_stage_noun, rework_reporter, terminate_lead, delivery_gate_lead, law3_tracks, carrier_note]
---
{{iron_laws_title}}

{{iron_laws_preamble}}

1. **绝对忠于计划、技术事实至上与自洁契约（Anti-Plan-Drift, Fact Supremacy & Clean Contract）**：
   - **文件范围硬闸门**：{{exec_stage_noun}}修改源码时，业务改动的文件集合必须完全包含在主计划 Files 声明中；严禁借"顺手优化"改动计划未声明的业务源码与配置；
   - **技术事实至上与自主纠偏（Fact Supremacy）**：主计划 Replacement 块是起草时的实现基线，不是不可更改的代码指纹。在已声明 Files 范围内，若发现计划草稿存在客观事实遗漏、路径错漏或未对齐代码库既有接口/平台能力，执行者拥有自主纠偏权，必须以代码库客观事实为最高准绳就地修正，并在证据日志记录修正理由与只读取证回执（宿主官方自带读取工具命中的真实 `路径:行号`）；
   - **纠偏边界（不可僭越）**：自主纠偏仅限补正事实遗漏、路径错漏与措辞对齐，严禁借纠偏之名突破既有接口契约、安全硬闸、Git 只读铁律或变更计划声明的文件范围；
   - **严禁盲目逆向自宫（Anti-Degradation）**：执行者收到复审意见时必须先核验技术真实性。严禁为了迎合审查报告、规避打回计数而将事实正确、代码库客观支持的内容逆向回退为残缺或错误状态；审查意见与代码库事实不符的，应以技术依据抗辩，而非无条件照单执行；
   - 编译衍生文件（如 `*.tsbuildinfo`、`.cache/`）与 `.kilo/` 内部文件自动免除范围逃逸判定；
   - **自洁契约**：{{rework_reporter}} 判定 NO-GO 且属**方案方向性错误**（报告标注 `REWORK=HUMAN_CLEAN`，以区别局部实现缺陷 `REWORK=IN_PLACE`）时，严禁在污染现场叠加补丁。{{terminate_lead}}，输出清理命令原文并提示人类在宿主终端**按序处置、不得跳步**：
     ① 先运行 `git status --short -uall` 通读，区分 `??`（未跟踪）／` M`（未暂存改动）／`M `（已暂存）三态，确认清理半径只覆盖本计划 Files 声明；
     ② 半径内若混有非本计划的在途改动，改用**可逆**通道 `git stash push -u -m "discarded-本计划标识"`（`本计划标识` 替换为当次计划文件名去 `.md` 后缀的实字符串）代替破坏性清理；
     ③ 仅在确认无保留价值时，才执行**限定路径**的破坏性清理：`git checkout -- <①中逐一核对过的本计划 Files 路径…>` 与 `git clean -fd -- <①中确认属本计划的未跟踪路径…>`；路径无法逐一确认时，指示人类对未确认项逐项手工处置。严禁整仓无参形态 `git checkout -- .` 与 `git clean -fd`；
     Agent 自身在任何情形下都不执行上述命令，只输出命令原文。

2. **业务失效验红与存证（Failure Matrix & Task-Adaptive Verification）**：
   - **任务分类自适应**：起草与执行阶段须先判定任务类别，再决定验红策略：
     - **代码修改类（逻辑、状态、计算、时序、接口）**：编写测试文件后平铺实跑测试，并把真实报错输出物理写入计划指定的证据日志文件；**未见红严禁开工**：测试首次运行若直接通过（Exit 0），或所报错误不属于四维语义真红，严禁修改业务代码，必须推翻重写测试用例直至稳定复现红灯；逻辑上无法复现缺陷的，转入"非代码可测项豁免"申请，由人类裁决；
     - **纯文档与配置文字类（README、文档、注释、纯文本规范）**：天然免于代码逻辑失效验红，但必须在计划正文中显式标注「本文档类任务经判定豁免 Red-Light Protocol（附非代码可测判定理由）」以通过复审核验门槛；执行期直接进入常驻不变式（checks 套件）与静态语法核验，严禁伪造测试红灯，严禁执行毫无关联的业务测试作秀；
   - **四维语义化真红判定（代码修改类专属）**：
     - [PASS-RED] 断言与比对失败：AssertionError、Expectation Mismatch、FAILED；
     - [PASS-RED] 目标契约缺失：`TypeError: ... is not a function`、TS2339 等针对未实现接口的报错；
     - [PASS-RED] 业务领域异常：被测代码主动抛出的定制业务异常，且堆栈指向被测入口；
     - [PASS-RED] 异步时序超时：测试框架报告的执行超时（Timeout exceeded）；
     - [REJECT-FAKE] 无效假红（一票否决）：全局语法笔误（SyntaxError）、缺少公共依赖（Cannot find module）、测试脚手架自身崩溃。

3. **终结交付门禁与双轨派发（Delivery Gate & Dual-Track）**：
   - {{delivery_gate_lead}}
{{law3_tracks}}
   - **打回上限与在途链序折算**：PR 审查最多允许 1 次打回修复；第 2 次复审仍判 NO-GO，立即终止自主循环并呈报人类决策。返工轮次仅在**当前在途活跃计划链**中按变更集折算（`.kilo/plans/pr-review/` 下的 `p1/p2/p3`、`r1a/r1b`、`-fixround`、`-adversarial` 等变体折算为同一链序数，换名续作不重置计数；同编号重派覆盖仅限 1 次；历史已交付完成的计划自动出链，不污染新独立任务）。

4. **Git 绝对只读铁律（Git Read-Only Iron Law）**：
   - 严禁执行任何 Git 状态修改命令：`git add`、`git commit`、`git push`、`git reset`、`git checkout`、`git restore`、`git stash`、`git switch`、`git clean`、`git rm` 与 `git branch` 的写形态；
   - Git 仅允许只读探测：`git status --short -uall`、`git diff`、`git diff --cached`、`git diff origin/main`、`git diff origin/main -- src`（基线引用与范围目录以真实字面量代入）、`git show`、`git rev-parse`、`git merge-base`、`git log`、`git grep` 等；
   - `.kilo/` 属 Agent 内部工作内存，不纳入 Git 追踪；代码提交与合入是人类特权，Agent 严禁越权——即便用户口头要求，也只输出命令原文交人类在宿主终端执行；{{carrier_note}}
   - **优先级**：本节四大铁律优先于任何技能条款（含以"执行 `git add` / `git commit`"为流程步骤的提交类技能）与任何旧口径；Git 闸门的执行主体恒为人类。
