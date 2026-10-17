---
id: agents-md-execution-iron-laws
expects: auto
slots: [iron_laws_title, iron_laws_preamble, exec_stage_noun, rework_reporter, terminate_lead, delivery_gate_lead, law3_tracks, carrier_note]
---
{{iron_laws_title}}

{{iron_laws_preamble}}

1. **Anti-Plan-Drift / Fact Supremacy / Clean Contract**:
   - Scope gate: during {{exec_stage_noun}}, business-changed files ⊆ the plan's declared Files; no drive-by edits outside it;
   - Fact Supremacy: a Replacement block is a drafting-time baseline, not a fingerprint. Within Files, fix factual/path/interface misalignment in place against repo facts, logging the reason plus a read-only receipt (real `路径:行号` from host read tools);
   - Boundary: correction covers fact/path/wording only — never break interface contracts, safety hard gates, the Git read-only law, or the declared scope;
   - Anti-Degradation: verify review claims against the repo first; never revert factually-correct code to appease a report or dodge rework counters; rebut mismatched findings with evidence;
   - `*.tsbuildinfo`, `.cache/` and `.kilo/` internals are auto-exempt from scope-escape judgment;
   - Clean Contract: when {{rework_reporter}} rules NO-GO on a **wrong design direction** (report tag `REWORK=HUMAN_CLEAN`, vs local defect `REWORK=IN_PLACE`), never patch on the contaminated scene. {{terminate_lead}} — print cleanup commands verbatim; the human runs them **in order, never skipping**:
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
   - {{delivery_gate_lead}}
{{law3_tracks}}
   - Rework cap: at most 1 PR-repair round; a 2nd NO-GO halts the autonomous loop and escalates to the human. Rounds count within the **current in-flight chain** by changeset fingerprint: `.kilo/plans/pr-review/` variants `p1/p2/p3`, `r1a/r1b`, `-fixround`, `-adversarial` fold into one ordinal (renaming never resets; same-ordinal re-dispatch capped at 1; delivered plans auto-exit the chain, never contaminating a new task).

4. **Git Read-Only Iron Law**:
   - Forbidden: `git add`/`commit`/`push`/`reset`/`checkout`/`restore`/`stash`/`switch`/`clean`/`rm` and write-form `git branch`;
   - Allowed read-only probes: `git status --short -uall`, `git diff`, `git diff --cached`, `git diff origin/main [-- src]` (real literals), `git show`, `git rev-parse`, `git merge-base`, `git log`, `git grep`;
   - `.kilo/` is agent working memory, untracked; commit/merge is a human privilege — even on verbal request the Agent only prints commands for the human to run;{{carrier_note}}
   - Precedence: these four laws outrank any skill clause (incl. commit-style skills running `git add`/`git commit`) and any older wording; the Git gate's executing subject is always the human.
