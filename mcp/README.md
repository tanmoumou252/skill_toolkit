# plan-governor MCP

双实例能力绑定与恒定最严档执法的受控终端及写面蜜罐引导闸，专为 Windows 工作站打造。

## 快速起步

```bash
npm test --prefix mcp
node mcp/webui.js
```

## 架构导航

- plan-governor.js: 核心 MCP 服务，包含命令边界总表、双实例绑定与蜜罐引导闸
- webui.js / webui-client.html: 零构建单页 WebUI 管理工作台（默认 127.0.0.1:3300）
- tests/: 回归测试（plan-governor-regress.mjs）与沙箱探针

## 核心入口

- 服务入口: `mcp/plan-governor.js`
- WebUI 入口: `mcp/webui.js`
- 回归测试: `mcp/tests/plan-governor-regress.mjs`

## 生效方式

在宿主配置中注册双实例，以 `MCP_ROLE` 区分主/子身份。

**通用配置**（Claude Desktop / Cline / CodeBuddy / ZCode）：
```json
{
  "plan-governor-main": { "command": "node", "args": ["<repo>/mcp/plan-governor.js"], "env": { "MCP_ROLE": "main" } },
  "plan-governor-subagent": { "command": "node", "args": ["<repo>/mcp/plan-governor.js"], "env": { "MCP_ROLE": "subagent" } }
}
```

**Kilo Code 专用配置**（写入 `kilo.jsonc`，注意语法差异：顶级键为 `mcp`、须声明 `type: "local"`、命令与参数合并为单个数组、环境变量键名为 `environment`）：
```json
{
  "mcp": {
    "plan-governor-main": { "type": "local", "command": ["node", "<repo>/mcp/plan-governor.js"], "environment": { "MCP_ROLE": "main" } },
    "plan-governor-subagent": { "type": "local", "command": ["node", "<repo>/mcp/plan-governor.js"], "environment": { "MCP_ROLE": "subagent" } }
  }
}
```

## 注意事项与暗坑

- 恒定最严档执法：服务不解析宿主模式信号，恒按最严档执行；仅白名单只读与测试命令静默放行，灰区与写命令一律拒绝。
- 写蜜罐通道：`write_plan` 等写工具恒 isError 拦截，引导 zcode 走受控写 `write_scoped_file`、kilocode/codebuddy 走原生写工具。
- 终端分流与加固：自动探测 PortableGit 并强制排除 WSL 下的 bash.exe；引号包裹命令名词（如 `'git' diff`）会被加固闸拦截。
- 真实审计与隐私：需注入 `"MCP_AUDIT_LOG": "1"` 并重启宿主客户端；流水落 `~/.config/kilo/governor-audit.jsonl`，记录 stdout 前 400 字符。
- WebUI 安全边界：仅绑定 127.0.0.1 并强制校验 Host；受控终端【模拟执行】为纯前端模拟，不产生实际审计流水。
- T 盘沙箱：通过 `subst T:` 提供临时实验环境，仅为防工作区误伤的工作目录，非对抗性内核隔离；命令含展开构造或销毁指令时整体拦截。