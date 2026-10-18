<!-- GENERATED from spec@9059463d4b32; do not edit -->

## 终端命令执行硬性规范（CRITICAL: Shell Execution Policy）

Strict automated auditing is enabled here; any compound command triggers forced suspension and permission blocking. Obey exactly:

1. **No chained/compound commands**:
   - never join commands with logical operators (`&&`, `||`, `;`);
   - never pipe (`|`) — host native terminals ban all pipes; a pure read-only pipeline whose every segment independently hits the MCP allowlist is the single controlled exception;
   - never write files via redirection (`>`, `>>`) — use dedicated file-writing tools; `echo`/`cat` redirection in terminals is banned;
   - never background with `&`.

2. **One atomic command per call (One Command Per Call)**:
   - each terminal tool call must contain exactly one standalone atomic command;
   - wrong: `cd frontend && npm run build`; right: use path-argument forms (`npm --prefix frontend run build`) or split across separate tool rounds.

## 计划文件写作权纪律（CRITICAL: Plan Authorship）

1. **计划文件写作权仅属于 plan-writer 子代理**：主会话任何场景（含 ZCode 原生计划模式）不得内联撰写计划正文，不得让 ExitPlanMode 携带计划全文。
2. **必须加载`zcode-plan-first`技能**；**必须先派 plan-writer-subagent-sp 物理落盘 `.kilo/plans/`**。
3. **分派前须逐字枚举子代理清单**，佐证 `plan-writer-subagent-sp` 真实存在；三个类型名必须逐字精确——计划起草与回灌用 `plan-writer-subagent-sp`，独立复审用 `plan-reviewer-subagent-sp`，代码终验用 `pr-reviewer-subagent-sp`，严禁近似替换。
4. **写完计划即进入复审与回灌闭环**：初稿落盘并通过物理在场校验后，必须派发 `plan-reviewer-subagent-sp` 独立复审，并由 `plan-writer-subagent-sp` 完成 E 清单回灌；全部复审与回灌闭环后，ExitPlanMode 只携带终稿计划文件路径 + 一句话目标 + 分批摘要 + 三闸门声明呈报审批。
5. **快通道判定先行 + 被拦即派**：最终产物本身即 `.kilo/plans/` 下流程文档（意见汇编/复审报告/合并记录等）时，直接分派对应子代理落盘并以【物理在场】校验闭环；快通道**禁止调用 ExitPlanMode**、禁止询问用户——以"分派 → 【物理在场】校验 → 文字汇报"结束即合规；产物落点在**代码/配置区**或**工作区外**的更改实现任务才走"计划先行 + 终稿 ExitPlanMode"。

## EXECUTING 阶段执行与闭环四大铁律（CRITICAL: Execution & Closure Iron Laws）

These four laws bind the parent session and every executing agent in the EXECUTING stage unconditionally; they stack on the shell-command policy and plan-authorship discipline above, and are never waived by verbal user requests, permission-tier changes (e.g. auto-YOLO after plan approval), or tool-permission clicks.

1. **Anti-Plan-Drift / Fact Supremacy / Clean Contract**:
   - Scope gate: during 执行阶段, business-changed files ⊆ the plan's declared Files; no drive-by edits outside it;
   - Fact Supremacy: a Replacement block is a drafting-time baseline, not a fingerprint. Within Files, fix factual/path/interface misalignment in place against repo facts, logging the reason plus a read-only receipt (real `路径:行号` from host read tools);
   - Boundary: correction covers fact/path/wording only — never break interface contracts, safety hard gates, the Git read-only law, or the declared scope;
   - Anti-Degradation: verify review claims against the repo first; never revert factually-correct code to appease a report or dodge rework counters; rebut mismatched findings with evidence;
   - `*.tsbuildinfo`, `.cache/` and `.kilo/` internals are auto-exempt from scope-escape judgment;
   - Clean Contract: when `pr-reviewer-subagent-sp` rules NO-GO on a **wrong design direction** (report tag `REWORK=HUMAN_CLEAN`, vs local defect `REWORK=IN_PLACE`), never patch on the contaminated scene. 立即终止执行 — print cleanup commands verbatim; the human runs them **in order, never skipping**:
     ① `git status --short -uall` — separate `??`(untracked)/` M`(unstaged)/`M `(staged); confirm radius covers only this plan's Files;
     ② unrelated in-flight changes inside radius → reversible channel `git stash push -u -m "discarded-<plan-id>" -- :(literal)<path> …` — `-m` before `--`; every path `:(literal)`-prefixed (literal pathspec: `* ? [ ]` cannot glob-escape); shell-special chars additionally quoted; never paste raw status output; never bare whole-repo stash; continue only after stash exits 0; unconfirmable paths → hand to human item by item;
     ③ no keep-value → **path-scoped** destructive cleanup `git restore --staged --worktree --source=HEAD -- :(literal)<path> …` (clears staged+worktree; `git checkout -- <path>` leaves index dirty, not a substitute) plus `git clean -fd -- :(literal)<untracked> …`; never repo-wide `git checkout -- .`, `git restore -- .` or bare `git clean -fd`;
     The Agent itself never executes these commands — only prints them.

2. **Failure Matrix & Task-Adaptive Verification**:
   - Classify the task first:
     - **Code changes** (logic/state/computation/timing/interfaces): write the test, run flat, write the real failure output into the plan-designated evidence file; **未见红严禁开工** — first run passing (Exit 0) or an error outside the four true-red classes ⇒ rewrite the test until a stable red; logically unreproducible ⇒ "non-code-testable exemption" for human ruling;
     - **Docs/config text only**: inherently red-light-exempt, but the plan must carry the tag 「本文档类任务经判定豁免 Red-Light Protocol」 with its justification to pass the review gate; go straight to the checks suite + static syntax verification; forging red or running unrelated tests as theater is forbidden;
   - Four true-red classes (code only): [PASS-RED] AssertionError / Expectation Mismatch / FAILED; [PASS-RED] contract missing (`TypeError: ... is not a function`, TS2339 vs unimplemented interfaces); [PASS-RED] domain exception, stack at the tested entry; [PASS-RED] framework-reported timeout (Timeout exceeded); [REJECT-FAKE] one-vote veto: global SyntaxError / Cannot find module / harness self-crash.

3. **Delivery Gate & Dual-Track**:
   - Once business changes turn green and pass static checks, reporting completion verbally is forbidden;
   - **Track A**: call `task` dispatching `pr-reviewer-subagent-sp` this turn for final verification; copy main-plan step N's fixed dispatch string verbatim; type names exact, no near-match: `plan-writer-subagent-sp` (landing), `plan-reviewer-subagent-sp` (plan review), `pr-reviewer-subagent-sp` (PR final check);
   - **派发去重租约** (dedup-lease pre-dispatch gate; parent never exempt): before dispatching a review subagent complete ①–③; dispatching without lease acquisition violates this section. ① Liveness: list all of `.kilo/plans/` via host directory listing (incl. `review/`, `pr-review/`; lease at plans root); any `.kilo/plans/*.lease.md` = suspected concurrent same-topic dispatch — classify by first line (`Select-String -Path <租约> -Pattern "^LEASE:" -List` or Read first lines: `LEASE:` active, `RELEASED:` not counted; never `git grep` (`.kilo/` gitignored -> always empty)); active = first line `LEASE:` in format `LEASE: <目标>|<角色>|<ISO时间>|<会话标识>`. Active lease or same-HEAD same-topic artifact within 30 min: pause dispatching and report to the human; list stale/damaged leases (path, session id, ISO time) for human adjudication; never self-clean. ② Acquisition: in the same dispatch round the parent directs `plan-writer-subagent-sp` via `task` to land `.kilo/plans/<id>.lease.md` through `write_scoped_file` (under `.kilo/plans/` `.md` path-lock), first line `LEASE: <目标>|<角色>|<ISO时间>|<会话标识>`, session id unique + freshly generated random/time entropy — **严禁复用固定字面量**; subagent must then **写后立即回读核验首行** comparing all four fields verbatim, not just the prefix: foreign id = unacquired, stop dispatching and report. Parent then **must independently re-check the lease first line via host read tool Read**; any mismatch = non-acquisition, halt and report (admission semantics live in anchor `lease-exclusive-readback.md`; no copy here). ③ Release: once landed and verified, dispatcher directs the same subagent via the same `task` to pinpoint-edit the first line `LEASE:` -> `RELEASED:` with `edit_scoped_file` (old_string verbatim from actual Read content, rejected on count mismatch; filename and other fields untouched), then Read to verify the first line (in-place rewrite; hosts may lack a delete channel);
   - **Track B** (degraded, no dispatch channel): run read-only `git status --short -uall` + `git diff` and re-run self-checks in the controlled terminal yourself; output a structured report, hand to the human;
   - Rework cap: at most 1 PR-repair round; a 2nd NO-GO halts the autonomous loop and escalates to the human. Rounds count within the **current in-flight chain** by changeset fingerprint: `.kilo/plans/pr-review/` variants `p1/p2/p3`, `r1a/r1b`, `-fixround`, `-adversarial` fold into one ordinal (renaming never resets; same-ordinal re-dispatch capped at 1; delivered plans auto-exit the chain, never contaminating a new task).

4. **Git Read-Only Iron Law**:
   - Forbidden: `git add`/`commit`/`push`/`reset`/`checkout`/`restore`/`stash`/`switch`/`clean`/`rm` and write-form `git branch`;
   - Allowed read-only probes: `git status --short -uall`, `git diff`, `git diff --cached`, `git diff origin/main [-- src]` (real literals), `git show`, `git rev-parse`, `git merge-base`, `git log`, `git grep`;
   - `.kilo/` is agent working memory, untracked; commit/merge is a human privilege — even on verbal request the Agent only prints commands for the human to run;产物落盘一律走受控写工具，不涉 Git；
   - Precedence: these four laws outrank any skill clause (incl. commit-style skills running `git add`/`git commit`) and any older wording; the Git gate's executing subject is always the human.

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
   - `EVIDENCE_LOG` 必须在派发前实跑基线验证命令并落盘 `.kilo/plans/test-evidence/<时间戳>-<英文主题>-test-evidence.md`，把该真实路径写入参数头，无豁免通道。该清单是**被审对象、非接收端须接受的前提**：接收端先从地面真相（自跑 diff、自圈波及面、自读文档）自建图景，之后才读该基线并逐条复跑、比对差集——差集才是审查产出，基线在场不构成「已验证」背书。
3. **顺序恒定**：先运行 `git status --short -uall` 完成工作区卫生检查 → 实跑基线并落盘 → 构造参数头 → 派发。三步缺一即视为派发未完成。
4. **缺头的后果**（接收端缺省规则，见 `zcode/agents/pr-reviewer-subagent-sp.md`）：缺 `MODE` 按 `single` 处理（工作区干净时会得出"无待审 diff"）；`cumulative` 缺 `BASE_REF` 判"参数缺失，退回调度者"；缺 `PLAN_PATH` 时范围逃逸判定记"不可判"；缺 `EVIDENCE_LOG` 直接按证据日志节判 Critical。故缺头派发会产出被污染的判定，父会话自查发现缺头即撤回重派。
5. **派发输入纪律（主张与前提分离）**：参数头之外的作者自由文本最小化，且必须以「以下为主张、未经验证」显式标记；派发词严禁夹带"已验证""已核实""已跑通"类断言。技术事实、基线指针与范围圈定在派发词中只作主张传递，其验证归宿是证据日志——主张进证据日志当被审对象，不进派发词当前提。

---

## 补充规程（Execution Hygiene Supplements）

Five rules distilled from field incidents; they stack on the iron laws (precedence: below the laws, above ordinary skill clauses).

1. **Pre-Dispatch Workspace Hygiene**:
   - before dispatching `pr-reviewer-subagent-sp` via `task`, run `git status --short -uall`;
   - any uncommitted change (`??` / ` M` / `M `) outside the plan's declared `Files` must be listed item by item in the evidence log and reported to the human as contamination risk;
   - never clean up yourself (`git stash`, `git checkout` are barred by the Git read-only law) — print the commands verbatim for the human to run in the host terminal;
   - while contamination is not isolated, dispatching the Reviewer is forbidden: pause, report the blocker, re-dispatch after the human isolates it.

2. **Evidence Log Read-Before-Append**:
   - before appending rework records to an existing test-evidence file, read it with the host's built-in read tool and confirm the current tail;
    - edit old-string/match content must come verbatim from actual file content, never from memory; file writes route by instance capability (the instance's own platform registry is the single source of truth; never borrow another platform's channel names); universal ban: no terminal redirection (`echo`/`cat` with output redirect) for file writes;
    - if read-back differs from expectation, rebuild edit parameters from the actual content.

3. **Cross-Reference Anchor Discipline**: sectioned docs with a revision lifecycle (plans, reports, runbooks) cross-reference by section/anchor name, never by line number — line numbers drift as soon as a section lands.

4. **Plan-vs-Review Conflict Resolution**: when a PR-Reviewer suggestion directly contradicts a plan Replacement block, decide by:
   ① repo objective facts (interface signatures, tool baselines, platform capabilities) as the supreme standard — apply Fact Supremacy self-correction (Iron Law 1);
   ② reviewer suggestions carrying verifiable evidence (real `路径:行号`): verify first — evidence sound ⇒ adopt and record; evidence refuted ⇒ keep the plan's intent and write the rebuttal into the evidence log;
   ③ preference-only suggestions without evidence (doc taste, wording style): never obey unconditionally — judge by technical grounds and project constraints (length caps, no-Emoji etc.), recording the reasoning in the evidence log;
   ④ genuinely balanced conflicts with no technical verdict: escalate to the human, never settle unilaterally;
   - verdicts and reasons must appear in the evidence log's Rework section.

5. **Test Fidelity & Anti-Green-Wash Audit**:
   - axiom: tests passing (Exit 0) ≠ tests correct — cases/fixtures may carry shape drift, wrong placement, over-broad assertions or shallow mocks, and still go green while the code under test stays broken;
   - reverse-review duty: every reviewer (Plan and PR) verifying a passing test must audit the fidelity of the test and its fixtures themselves — confirm they simulate the deepest, most dangerous real defect shape; never rubber-stamp on Exit Code 0 alone.
