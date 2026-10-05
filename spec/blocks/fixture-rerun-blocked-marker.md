---
id: fixture-rerun-blocked-marker
expects: auto
slots: []
---
受只读铁律约束无法把替身换成生产副作用复跑时，必须标注 `FIXTURE_RERUN=BLOCKED_READONLY` 并把该用例的保真度按未验证记账，按 Important 处置；严禁以「读着像真的」或「测试全绿」直接放行。
