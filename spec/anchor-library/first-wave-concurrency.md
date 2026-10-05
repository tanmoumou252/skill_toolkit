---
id: first-wave-concurrency
expects: auto
slots: [task_param]
---
   - **首波并发数收敛为 1（首波并发 Reviewer 恒为 1 个）**：无论任务复杂度，首波恒定只调度 1 个独立 `task({{task_param}}="plan-reviewer-sp")` 执行背靠背独立解题，严禁在首波并发调度多个同质化 Reviewer 走过场与互相背书（边际收益为零且制造虚假安全感）。
