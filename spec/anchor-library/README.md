# spec/anchor-library — 锚文本契约库

本目录存放平台文件的条款锚文本原稿，仅供人工查阅与条款溯源。

- 唯一执法事实源是 `checks/registry.mjs` 的 CLAUSES / DERIVED_CLAUSES 登记；本目录不参与产物装配（`checks/build-agents.mjs` 只读 `spec/blocks/`）。
- 修改锚文本必须同步 `checks/registry.mjs` 与三端平台文件，并运行 `node checks/run.mjs` 验证。
