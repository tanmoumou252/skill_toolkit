---
id: rework-human-clean
expects: auto
slots: []
---
   - **自洁契约**：PR-Reviewer 判定 NO-GO 且属**方案方向性错误**（报告标注 `REWORK=HUMAN_CLEAN`，以区别局部实现缺陷 `REWORK=IN_PLACE`）时，严禁在污染现场叠加补丁。Agent 必须立即终止执行，输出清理命令原文并提示人类在宿主终端**按序处置、不得跳步**：
     ① 先运行 `git status --short -uall` 通读，区分 `??`（未跟踪）／` M`（未暂存改动）／`M `（已暂存）三态，确认清理半径只覆盖本计划 Files 声明；
     ② 半径内若混有非本计划的在途改动，改用**可逆**通道 `git stash push -u -m "discarded-本计划标识"`（`本计划标识` 替换为当次计划文件名去 `.md` 后缀的实字符串）代替破坏性清理；
     ③ 仅在确认无保留价值时，才执行**限定路径**的破坏性清理：`git checkout -- <①中逐一核对过的本计划 Files 路径…>` 与 `git clean -fd -- <①中确认属本计划的未跟踪路径…>`；路径无法逐一确认时，指示人类对未确认项逐项手工处置。严禁整仓无参形态 `git checkout -- .` 与 `git clean -fd`；
     Agent 自身在任何情形下都不执行上述命令，只输出命令原文。
