---
id: untracked-iron-law
expects: auto
slots: []
---
3. **未跟踪新文件铁律**：`git diff` 不显示未跟踪文件。凡 `git status --short -uall` 列出的未跟踪新增文件（尤其是新增测试文件），**严禁依赖 diff 断言**，必须用原生 `read` 打开全文通读并核查用例有效性。
