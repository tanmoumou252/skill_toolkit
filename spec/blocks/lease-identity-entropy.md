---
id: lease-identity-entropy
expects: auto
slots: []
---
会话标识必须为本会话专属且含当次生成的随机或时间熵，严禁复用固定字面量，使覆盖式写入必被逐字回读检出。
