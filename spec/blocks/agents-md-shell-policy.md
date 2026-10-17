---
id: agents-md-shell-policy
expects: auto
slots: []
---
## 终端命令执行硬性规范（CRITICAL: Shell Execution Policy）

Strict automated auditing is enabled here; any compound command triggers forced suspension and permission blocking. Obey exactly:

1. **No chained/compound commands**:
   - never join commands with logical operators (`&&`, `||`, `;`);
   - never pipe (`|`) — host native terminals ban all pipes; a pure read-only pipeline whose every segment independently hits the MCP allowlist is the single controlled exception;
   - never write files via redirection (`>`, `>>`) — use dedicated file-writing tools; `echo`/`cat` redirection in terminals is banned;
   - never background with `&`.

2. **One atomic command per call (One Command Per Call)**:
   - each terminal tool call must contain exactly one standalone atomic command;
   - wrong: `cd frontend && npm run build`; right: use path-argument forms (`npm --prefix frontend run build`) or split across separate tool rounds.
