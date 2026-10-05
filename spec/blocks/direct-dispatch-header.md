---
id: direct-dispatch-header
expects: auto
slots: []
---
## 直连派发参数头铁律（CRITICAL: Direct Dispatch Header）

ZCode 平台不存在可自定义的主代理人格——主会话拿不到可编辑的提示词层，"派发参数必须带某个头"这类规则不会被平台自动注入。因此凡分派 `pr-reviewer-subagent-sp`（无论有无主计划），主会话必须在分派 prompt 首行**自行构造**机读参数头：

```text
MODE=single; BASE_REF=origin/main; SCOPE_DIRS=zcode skills checks; PLAN_PATH=本计划真实路径; EVIDENCE_LOG=本计划真实证据日志路径; 报告路径：.kilo/plans/pr-review/本计划真实 PR 审查报告路径
```

上行为**形态示范**（键位与取值口径），沿用平台既有派发串惯例（`zcode/agents/plan-writer-subagent-sp.md:73-74`）；其中中文描述位必须在发出前按当次实跑结果替换为真实字面量，全串零尖括号、零花括号。禁止把上行原样当作参数头发出，也禁止把任一位置换成尖括号或花括号待填形态后发出。

1. **有主计划时**：逐字取用主计划步骤 N 已固化的派发串（见上文轨道 A），本条不另造第二套。
2. **无主计划时**（快通道产物、分支级全量审查等直连场景）：由主会话按下述口径现构，参数一律真实字面量，严禁残留待填形态：
   - `MODE` 默认 `single`（审未提交变更集）；审查已提交区间必须传 `cumulative`；
   - `BASE_REF` 由 `git rev-parse origin/main` → `git rev-parse main` → `git rev-parse origin/master` → `git rev-parse master` 探测链取首个成功解析者，严禁猜写；
   - `SCOPE_DIRS` 取变更集实际涉及的一级业务目录；`PLAN_PATH` 无主计划时传 `.`，并在本参数头同处声明"本分支下范围逃逸以 SCOPE_DIRS 为唯一判据"，消除接收端按字面比对 Files 集合产生的歧义；
   - `EVIDENCE_LOG` 必须在派发前实跑基线验证命令并落盘 `.kilo/plans/test-evidence/<时间戳>-<英文主题>-test-evidence.md`，把该真实路径写入参数头，无豁免通道。
3. **顺序恒定**：先运行 `git status --short -uall` 完成工作区卫生检查 → 实跑基线并落盘 → 构造参数头 → 派发。三步缺一即视为派发未完成。
4. **缺头的后果**（接收端缺省规则，见 `zcode/agents/pr-reviewer-subagent-sp.md`）：缺 `MODE` 按 `single` 处理（工作区干净时会得出"无待审 diff"）；`cumulative` 缺 `BASE_REF` 判"参数缺失，退回调度者"；缺 `PLAN_PATH` 时范围逃逸判定记"不可判"；缺 `EVIDENCE_LOG` 直接按证据日志节判 Critical。故缺头派发会产出被污染的判定，父会话自查发现缺头即撤回重派。
