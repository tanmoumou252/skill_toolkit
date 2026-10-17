---
id: agents-md-hygiene-supplements
expects: auto
slots: [pr_reviewer_type]
---
---

## 补充规程（Execution Hygiene Supplements）

Four rules distilled from field incidents; they stack on the iron laws (precedence: below the laws, above ordinary skill clauses).

1. **Pre-Dispatch Workspace Hygiene**:
   - before dispatching `{{pr_reviewer_type}}` via `task`, run `git status --short -uall`;
   - any uncommitted change (`??` / ` M` / `M `) outside the plan's declared `Files` must be listed item by item in the evidence log and reported to the human as contamination risk;
   - never clean up yourself (`git stash`, `git checkout` are barred by the Git read-only law) — print the commands verbatim for the human to run in the host terminal;
   - while contamination is not isolated, dispatching the Reviewer is forbidden: pause, report the blocker, re-dispatch after the human isolates it.

2. **Evidence Log Read-Before-Append**:
   - before appending rework records to an existing test-evidence file, read it with the host's built-in read tool and confirm the current tail;
   - edit old-string/match content must come verbatim from actual file content, never from memory; file writes route by instance capability — instances with host-native edit/write tools use them, agents bound to a controlled-write channel use only that channel (the single source of truth is the instance's own platform registry; never borrow another platform's channel names); universal ban: no terminal redirection (`echo`/`cat` with output redirect) for file writes;
   - if read-back differs from expectation, rebuild edit parameters from the actual content.

3. **Plan-vs-Review Conflict Resolution**: when a PR-Reviewer suggestion directly contradicts a plan Replacement block, decide by:
   ① repo objective facts (interface signatures, tool baselines, platform capabilities) as the supreme standard — apply Fact Supremacy self-correction (Iron Law 1);
   ② reviewer suggestions carrying verifiable evidence (real `路径:行号`): verify first — evidence sound ⇒ adopt and record; evidence refuted ⇒ keep the plan's intent and write the rebuttal into the evidence log;
   ③ preference-only suggestions without evidence (doc taste, wording style): never obey unconditionally — judge by technical grounds and project constraints (length caps, no-Emoji etc.), recording the reasoning in the evidence log;
   ④ genuinely balanced conflicts with no technical verdict: escalate to the human, never settle unilaterally;
   - verdicts and reasons must appear in the evidence log's Rework section.

4. **Test Fidelity & Anti-Green-Wash Audit**:
   - axiom: tests passing (Exit 0) ≠ tests correct — cases/fixtures may carry shape drift, wrong placement, over-broad assertions or shallow mocks, and still go green while the code under test stays broken;
   - reverse-review duty: every reviewer (Plan and PR) verifying a passing test must audit the fidelity of the test and its fixtures themselves — confirm they simulate the deepest, most dangerous real defect shape; never rubber-stamp on Exit Code 0 alone.
