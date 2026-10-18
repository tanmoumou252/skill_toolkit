<!-- GENERATED from spec@b90a8683df86; do not edit -->

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

1. **必须先物理落盘 `.kilo/plans/`**
2. **写完计划即进入审查流程**
3. **退出计划** 审查回报回灌结束只携带计划文件路径 + 一句话目标 + 分批摘要，并调用`plan_exit`。

## Act 模式执行与闭环四大铁律（CRITICAL: Execution & Closure Iron Laws）

These four laws bind every agent in Act mode unconditionally; they stack on the shell-command policy and plan-authorship discipline above, and are never waived by verbal user requests, permission-tier changes, or tool-permission clicks.

1. **Anti-Plan-Drift / Fact Supremacy / Clean Contract**:
   - Scope gate: during Act 模式, business-changed files ⊆ the plan's declared Files; no drive-by edits outside it;
   - Fact Supremacy: a Replacement block is a drafting-time baseline, not a fingerprint. Within Files, fix factual/path/interface misalignment in place against repo facts, logging the reason plus a read-only receipt (real `路径:行号` from host read tools);
   - Boundary: correction covers fact/path/wording only — never break interface contracts, safety hard gates, the Git read-only law, or the declared scope;
   - Anti-Degradation: verify review claims against the repo first; never revert factually-correct code to appease a report or dodge rework counters; rebut mismatched findings with evidence;
   - `*.tsbuildinfo`, `.cache/` and `.kilo/` internals are auto-exempt from scope-escape judgment;
   - Clean Contract: when PR-Reviewer rules NO-GO on a **wrong design direction** (report tag `REWORK=HUMAN_CLEAN`, vs local defect `REWORK=IN_PLACE`), never patch on the contaminated scene. Agent 必须立即终止执行 — print cleanup commands verbatim; the human runs them **in order, never skipping**:
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
   - Once business changes turn green and pass static checks, reporting completion to the user verbally is forbidden;
   - **轨道 A（有 `task` 工具）**：在当前响应轮次调用 `task` 分派 `pr-reviewer-sp` 发起审查，**逐字取用主计划步骤 N 已固化的完整派发串**——不得自行改写、不得残留任何待填形态；
   - **轨道 B（无 `task` 工具，降级通道）**：在受控终端运行只读 `git status --short -uall` 与 `git diff`、复跑测试自检，输出结构化报告后交人类处置；
   - Rework cap: at most 1 PR-repair round; a 2nd NO-GO halts the autonomous loop and escalates to the human. Rounds count within the **current in-flight chain** by changeset fingerprint: `.kilo/plans/pr-review/` variants `p1/p2/p3`, `r1a/r1b`, `-fixround`, `-adversarial` fold into one ordinal (renaming never resets; same-ordinal re-dispatch capped at 1; delivered plans auto-exit the chain, never contaminating a new task).

4. **Git Read-Only Iron Law**:
   - Forbidden: `git add`/`commit`/`push`/`reset`/`checkout`/`restore`/`stash`/`switch`/`clean`/`rm` and write-form `git branch`;
   - Allowed read-only probes: `git status --short -uall`, `git diff`, `git diff --cached`, `git diff origin/main [-- src]` (real literals), `git show`, `git rev-parse`, `git merge-base`, `git log`, `git grep`;
   - `.kilo/` is agent working memory, untracked; commit/merge is a human privilege — even on verbal request the Agent only prints commands for the human to run;
   - Precedence: these four laws outrank any skill clause (incl. commit-style skills running `git add`/`git commit`) and any older wording; the Git gate's executing subject is always the human.

---

## 补充规程（Execution Hygiene Supplements）

Five rules distilled from field incidents; they stack on the iron laws (precedence: below the laws, above ordinary skill clauses).

1. **Pre-Dispatch Workspace Hygiene**:
   - before dispatching `pr-reviewer-sp` via `task`, run `git status --short -uall`;
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
