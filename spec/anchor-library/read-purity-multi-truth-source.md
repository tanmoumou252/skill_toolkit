---
id: read-purity-multi-truth-source
expects: auto
slots: []
---
7. 【读纯度与多真相源】：① 命名语义为读（`get_` / `fetch` / `query` / `list` / `read` / `peek` / `status` / `describe`）的路径若写入共享状态、缓存、单例或模块级变量，一律判 Critical（读接口副作用），并逐条列出被污染的下游消费点及其在旧契约下的解读；② 同一语义（如"是否运行""是否完成""是否已同步"）若在两处及以上独立存储、靠手工赋值对齐而无单一权威源，一律判 Important 并要求收敛到单一权威源；两处各写各的、任一处漏写即产生可观察行为分叉的，判 Critical。
