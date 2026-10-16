---
id: rework-human-clean
expects: auto
slots: []
---
   - **自洁契约**：PR-Reviewer 判定 NO-GO 且属**方案方向性错误**（报告标注 `REWORK=HUMAN_CLEAN`，以区别局部实现缺陷 `REWORK=IN_PLACE`）时，严禁在污染现场叠加补丁。Agent 必须立即终止执行，输出清理命令原文并提示人类在宿主终端**按序处置、不得跳步**：
     ① 先运行 `git status --short -uall` 通读，区分 `??`（未跟踪）／` M`（未暂存改动）／`M `（已暂存）三态，确认清理半径只覆盖本计划 Files 声明；
     ② 半径内若混有非本计划的在途改动，改用**可逆**通道 `git stash push -u -m "discarded-本计划标识" -- :(literal)<路径1> :(literal)<路径2> …`——`-m` 及消息参数必须置于 `--` 之前，`--` 之后仅逐一列出①中已核对、确认属于本计划的文件路径，每个路径**必须带 `:(literal)` 前缀**（Git 字面量 pathspec：路径中的 `*`、`?`、`[`、`]` 等特殊字符按字面匹配，不会作为 glob 展开到指定路径之外）；路径含 shell 特殊字符时另按目标 shell 的引用规则安全引用（两层防护：shell 层引用防 shell 展开，`:(literal)` 防 Git pathspec glob 展开），**严禁**把 `git status` 的原始输出未经引用处理直接拼入可执行命令，严禁无 pathspec 的整仓 stash（会把不在本计划半径内的他方在途改动一并收起）；stash 命令**确认成功退出后方可**继续后续步骤；路径无法逐一确认时，不对该部分执行 stash，交人类逐项手工处置（`本计划标识` 替换为当次计划文件名去 `.md` 后缀的实字符串）；
     ③ 仅在确认无保留价值时，才执行**限定路径**的破坏性清理：`git restore --staged --worktree --source=HEAD -- :(literal)<路径1> :(literal)<路径2> …`（路径逐一带 `:(literal)` 前缀，防 pathspec glob 逃逸；同时从暂存区与工作树清除，确保已暂存与未暂存改动一并消除；仅恢复工作树的 `git checkout -- <路径>` 不清 index，不得替代）与 `git clean -fd -- :(literal)<未跟踪路径1> :(literal)<未跟踪路径2> …`（逐一带 `:(literal)` 前缀）；路径无法逐一确认时，指示人类对未确认项逐项手工处置。严禁整仓无参形态 `git checkout -- .`、`git restore -- .` 与 `git clean -fd`；
     Agent 自身在任何情形下都不执行上述命令，只输出命令原文。
