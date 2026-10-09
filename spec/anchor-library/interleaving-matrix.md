---
id: interleaving-matrix
expects: auto
slots: []
---
### 三、事件交错矩阵（生命周期代码必画）

凡 diff 触及监听器 / 防抖 / 卸载 / 跨 Tab 同步 / ref 异步更新，强制画交错矩阵逐格判定（单场景测试与走查都发现不了）：

- 列并发轴：如 storage 事件到达 × 防抖未决 × ref 未同步 × pagehide 插入；
- 每格判定【已防御】（指出哪个 Replacement 涵盖）或【漏洞暴露】（判 Important，给触发序列）；
- canonical 教训：storage 处理器同步更新 `lastKnownValuesRef`，但 `termsDraftRef` 要等渲染后 effect 才同步；此窗口内 pagehide 触发 flush，比对通过后把过期本地 ref 值盖掉他 Tab 新值——唯构造交错序列才现形。
