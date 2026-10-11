---
id: fixture-fidelity-audit
expects: auto
slots: []
---
9. 【夹具保真度对账（替身不得比生产更配合）】：对每个验证本次新增守卫/校验的用例，逐个替身（mock / stub / fake / 简化实现）产出保真度对账表：替身方法名 → 生产实现的 `路径:行号` → 逐条副作用差异（返回值、写入、抛出、异步时序）。受只读铁律约束无法把替身换成生产副作用复跑时，必须标注 `FIXTURE_RERUN=BLOCKED_READONLY` 并把该用例的保真度按未验证记账，按 Important 处置；严禁以「读着像真的」或「测试全绿」直接放行。
