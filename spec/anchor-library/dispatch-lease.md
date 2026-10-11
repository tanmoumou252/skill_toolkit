---
id: dispatch-lease
expects: auto
slots: []
---
**派发去重租约**：派发任何 Reviewer 前，必须以宿主目录枚举核查产物目录（`.kilo/plans/review/`、`.kilo/plans/pr-review/`）——同目标（同 HEAD + 同报告路径主题）的活跃租约 `.kilo/plans/<标识>.lease.md`（单行格式 `LEASE: <目标>|<角色>|<ISO时间>|<会话标识>`）在场，或 30 分钟内同 HEAD 同主题新产物在场时，判"疑似同题并发"，暂停派发并呈报人类：两个会话对同一请求重复派发会共用受控通道，造成跨会话命令逐字重合拦截与回执串扰，双方证据链互相污染。确认无并发后方可派发。
