---
id: review-mode-dual
expects: auto
slots: []
---
**审查模式口径（实测约束）**：步骤 N 默认传 `MODE=single`——Agent 受 Git 只读约束，全部改动恒为未提交态，`git status --short -uall` + `git diff` + `git diff --cached` 即等于累积全貌。仅当人类已提交中间产物、需审查跨提交区间时，才改传 `MODE=cumulative` 并给 `BASE_REF` 赋第 1 条探明的真实基线。
