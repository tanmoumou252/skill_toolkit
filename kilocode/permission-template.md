
# Kilo Code Plan 权限模板与托管配置指南（kilo.jsonc / Kilocode 面板为中心）

本模板提供可直接并入 `kilo.jsonc` 的标准权限配置块，用于解决 Kilo 官方原生 `plan` 模式下 **“无法执行测试用例”** 与 **“Windows/pwsh 原生指令被拦截”** 的问题。经宿主权限探针与受控通道定案：`edit` 的路径级 map 托管在 `kilo.jsonc`（或 Kilocode 权限面板）；三份 `-sp` 代理（`plan-writer-sp` / `plan-reviewer-sp` / `pr-reviewer-sp`）的终端命令全面收口至受控 MCP 双实例（`mcp__plan-governor-*`），采用职责分离双通道架构：主代理 `plan-writer-sp` 放开子代所需通道（`main: allow`、`subagent: ask`/`allow`），两份 Reviewer 子代理对 main 全部键 `deny`、仅 `allow` subagent——各司其职依公理 M8（每工具跨三层取最严、任一 `deny` 即不注入）。命令黑白名单与结构硬闸由 `mcp/plan-governor.js` 单源统一执法。

---

## 适用场景与文档定位

1. **本模板给谁用**：所有需要给代理做"先关死、再逐条放行"收敛配置的用户。§一给出的是经过实测验证的完整 `agent` 节样例；只跑原生 `plan` 模式的用户可按同样形式在自己 `kilo.jsonc` 的 `"plan"` 节点并入 `"permission"` 块。
2. **已安装 `plan-writer-sp` / `plan-reviewer-sp` / `pr-reviewer-sp` 的用户注意**：
    - 三个代理 `.md` frontmatter 的 `permission` 声明按职责分离双通道配置（公理 M8：每工具跨三层取最严、任一 `deny` 即不注入）：
      - **主编排器（`plan-writer-sp`）**：`mode: all`；声明 `read`/`glob`/`grep`/`plan_exit`/`task`/`question`/`skill`/`webfetch: allow`；`bash` 兜底 `"*": "ask"`；MCP 通道 `plan-governor-main_exec_guarded_command: allow`，且**不得对 `plan-governor-subagent_exec_guarded_command` 设 `deny`**（取 `ask` 或 `allow`；非自用，纯为子代保留注入通道）。
      - **独立复审（`plan-reviewer-sp` / `pr-reviewer-sp`）**：`mode: subagent`；无 `plan_exit`，`task`/`question`/`webfetch` 设 `deny`，额外 `board_post`/`board_read: deny`；`skill: allow`（规程已内嵌、能力保留不视为缺陷）；`bash` 兜底 `"*": "deny"`；对 main 实例全部 7 键 `deny`（`plan-governor-main_exec_guarded_command`、`plan-governor-main_exec_sandboxed_command`、`plan-governor-main_copy_into_sandbox`、`plan-governor-main_write_scoped_file`、`plan-governor-main_write_plan`、`plan-governor-main_write_review_report`、`plan-governor-main_write_pr_review_report`），仅 `plan-governor-subagent_exec_guarded_command: allow`。
      - `edit` 权限三者一律不在 MD 内声明（公理 M2，路径白名单托管于 `kilo.jsonc`）。所有取证与测试命令均调用 `mcp__plan-governor-*` 受控通道。
   - **`edit` 严禁在 agent `.md` 中写成 map/对象**——宿主存在"MD 中 `edit` 值为任意 map 即在启动期整体裁掉 `edit`/`write` 工具"的实测故障（公理 M2，与 map 内容方向无关）。
   - **命令治理单源化**：`-sp` 三代理彻底移除 70+ 行命令正则表，由 `mcp/plan-governor.js`（`ALLOW_KEYS` / `DENY_KEYS` / `FORBIDDEN_KEYS`）作为全局命令边界与结构硬闸的唯一单源权威。`kilo.jsonc` 基础配置仅服务于内置 agent（如 `code`、原生 `plan` 等）。
   - 三家完整托管块范例见 §一。
3. **下面列的命令只是常见示例，不是全量清单。** 无论走哪条路，只要你项目的测试器没被列到（如 `cargo test`、`go test`、`mvn test`、`dotnet test`、`yarn test`），都要自己补上——统一补进 `kilo.jsonc` 对应 `agent.<ID>.permission.bash` 的 map（或经 Kilocode 面板配置出等价结构）。

---

## 一、配置模板 (`kilo.jsonc`)

打开本地配置文件：
- **Windows**: `%USERPROFILE%\.config\kilo\kilo.jsonc`
- **Linux / macOS**: `~/.config/kilo/kilo.jsonc`

定位到 `"agent"` 节点，以下为实测通过的全量托管结构（可将你的各 agent 块并入同构节点，或在 Kilocode 权限面板配出等价内容，保存后由宿主自动后置写入本文件）：

自动审批 需要关闭 且`bash": {"*": "ask"}`是**agent ask 行为的唯一来源，勿删勿改**
之所以这么设计选择有二，一是设为allow就没有闸门效果，二是设为deny就直接不注入edit工具使得子代理无法从合法途径编辑任何文件--哪怕是处于deny例外区的文件也碰不了，因为edit在抓包里可以看到根本没被注入

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "permission": {
    "edit": {
      "*": "ask",
      ".kilo/plans/*.md": "allow"
    },
    // `~/.config/kilo/` 同时存放 HMAC 策略签名密钥 `policy-key`、策略文件 `governor-policy.json` 与 WebUI token。
    // 此处只放行沙箱物理根 `virtual-t/**`，其余一律回落到 `ask`——预授权整个信任根会让「模型无法读取密钥」的假设失效。
    "external_directory": { "*": "ask", "~/.config/kilo/virtual-t/**": "allow" },
    // bash 兜底为 `"*": "ask"`：未显式列出的命令一律弹窗询问，由人工放行/拒绝（设计理由见下文）。
    // 下面只给「框架样例」——allow 放几条常用只读/测试命令、deny 硬拦几条写类与高危命令，
    // 不是全量清单。完整命令边界以 `mcp/plan-governor.js`（ALLOW_KEYS / DENY_KEYS / FORBIDDEN_KEYS）单源为准，
    // 你自己常用的测试器（cargo/go/mvn/dotnet/yarn…）按需增补进 allow 即可。
    "bash": {
      "*": "ask",

      // —— allow：常用只读取证与测试命令（仅示例，按需增补）——
      "git status*": "allow", "git log*": "allow", "git diff*": "allow",
      "git show*": "allow", "git rev-parse*": "allow", "git grep*": "allow",
      "ls*": "allow", "cat*": "allow", "grep*": "allow", "head*": "allow",
      "tail*": "allow", "pwd*": "allow", "rg*": "allow",
      "Get-ChildItem*": "allow", "Get-Content*": "allow", "Select-String*": "allow",
      "npm test*": "allow", "pnpm test*": "allow", "pytest*": "allow",
      "go test*": "allow", "cargo test*": "allow",

      // —— deny：写类与高危命令硬拦截（仅示例，完整边界以 mcp/plan-governor.js 单源为准）——
      "git add*": "deny", "git commit*": "deny", "git push*": "deny",
      "git reset*": "deny", "git checkout*": "deny", "git stash*": "deny",
      "git clean*": "deny", "git restore*": "deny", "git switch*": "deny",
      "rm*": "deny", "del*": "deny", "mv*": "deny", "cp*": "deny",
      "Set-Content*": "deny", "Add-Content*": "deny", "Out-File*": "deny",
      "New-Item*": "deny", "Remove-Item*": "deny", "Move-Item*": "deny",
      "Copy-Item*": "deny", "npm install*": "deny", "npm ci*": "deny",
      "node -e*": "deny", "python -c*": "deny", "sed -i*": "deny"
    }
  }
}
```

agent手动设置部分--目前还未完全弄清 Kilocode 权限生效的情况 它的权限并不是直接拒绝或者放行那么简单，而是连工具都无法注入。唯一已知的是 agent***.md 中只要配置过某项权限 kilocode设置页修改会无效，表现就是把某项允许改为拒绝或者询问，点击保存之后会立刻恢复回允许。内置 agent 兼容副本；变更须与 `mcp/plan-governor.js` 键表同步。  

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "agent": {    
    "code": {
      "permission": {
        "edit": { "*": "allow" },
        // `~/.config/kilo/` 同时存放 HMAC 策略签名密钥 `policy-key`、策略文件 `governor-policy.json` 与 WebUI token。
        // 此处只放行沙箱物理根 `virtual-t/**`，其余一律回落到 `ask`——预授权整个信任根会让「模型无法读取密钥」的假设失效。
        "external_directory": { "*": "ask", "~/.config/kilo/virtual-t/**": "allow" },
        "bash": {
          "*": "allow","Remove-Item*": "ask", "Move-Item*": "ask",
          "Copy-Item*": "ask", "rm*": "ask", "del*": "ask", "rd*": "ask",
          "rmdir*": "ask", "xcopy*": "ask", "robocopy*": "ask","git*": "ask"
        }
      }
    },
    "plan-writer-sp": {
      "permission": {
        "edit": { ".kilo/plans/*.md": "allow" }
      }
    },
    "plan-reviewer-sp": {
      "permission": {
        "edit": { ".kilo/plans/review/*.md": "allow" }
      }
    },
    "pr-reviewer-sp": {
      "permission": {
        "edit": { ".kilo/plans/pr-review/*.md": "allow" }
      }
    }
  }  
}
```

关于权限分工 配置其实是三个独立权限世界在并行：

- **code agent**：jsonc 内联 + 逐键覆盖自动审批。例如，自动审批设置某个命令权限是 ask，code 可以直接覆盖为 allow。
- **plan-writer-sp 等三个 sp**：终端命令全面收口至受控 MCP 双实例通道（Writer 主用 main 实例、并按公理 M8 对子代所需通道不得 `deny`；Reviewer 只 `allow` subagent 实例），原生 edit 维持路径隔离。
- **explore / general / debug / ask**：没有配置单独的自定义受控通道，纯靠全局与自动审批配置的权限运作。

---

## 二、编写规范与防踩坑说明

1. **闭世界模式下的显式白名单与纯增量原则边界**：
   - 当采用 `"*": "deny"` 闭世界兜底时，所有需要的命令**必须在 allow 列表中显式枚举**（包括常用的 `ls`、`git status`、`cat` 等与 Windows cmdlet），否则全部落入通配 deny 被拦截。
   - 上述模板已并入跨平台 POSIX 只读命令镜像（`cat*`、`grep*`、`head*`、`tail*`、`ls*`、`pwd*`、`wc*`、`date*`）与 pwsh cmdlet，直接使用即可。注意 `find*` 因 `-delete`/`-exec` 写能力属禁入清单，**不在**只读镜像中，亦不得加入 allow。
   - git 只读取证集含 `git status/log/diff/show/rev-parse/grep/ls-files/ls-tree/rev-list/shortlog/blame/cat-file/for-each-ref/describe/branch/merge-base`；写类 `git add/commit/push/reset/checkout/stash` 一律 deny。
   - **切勿**放行任何带写文件能力的命令（`Set-Content*`、`New-Item*`、`Out-File*`、`Add-Content*`、`Remove-Item*` 从源头不加入 allow，策略 C 支柱 2），从源头掐死 bash 写文件通路。
2. **切勿加通配符空格**：
   - 规则必须写为 `"pnpm test*"` 而不是 `"pnpm test *"`。
   - 如果包含空格，当模型执行不带任何参数的裸命令（如 `pnpm test`）时，通配符将匹配失败导致被系统拦截。
3. **闭世界兜底与单源层级铁律（实测定案）**：
   - **核心定案：权限 map 一律在 `kilo.jsonc`（或 Kilocode 面板）配置**。实测证明：
     - `kilo.jsonc` 内联 edit map（含 `"*": "deny"` + 路径 allow）**不杀工具且运行期逐路径硬拦截有效**（公理 ②）；allow glob 是工作区锚定的，盘外绝对路径会被 `*:deny` 拦截（公理 ④）；
     - `kilo.jsonc` 内联 bash map（含 `"*": "deny"` + 命令 allow）**运行期双向有效**（白名单命令放行、未列命令落 deny 拦截，公理 ③）；
     - 若采用标量 `"bash": "deny"` 则会触发工具整体裁剪（公理 M7，如需保留只读取证与测试能力必须写成 map）；
     - agent `.md` frontmatter 中 **严禁将 `edit` 声明为 map/对象**（无论首行是 deny 还是 allow，宿主在启动期一律裁掉 `edit`/`write` 工具，公理 M2）；MD 中仅声明标量权限。
   - **单源收口防漂移**：权限**解析优先级**为 `agent MD > agent jsonc 内联 > 全局基座`（公理 M1，决定同一作用域内取哪一层声明值）；而工具**是否被注入**按公理 M8 跨主 md / 子 md / jsonc 基座三层**取最严值**（`deny` < `ask` < `allow`，任一 `deny` 即不注入）——M1 管"读到哪一层的值"，M8 管"该工具进不进能力集"，二者作用面不同、不冲突。随着终端命令全面收口至受控 MCP 工具，三份 `-sp` 代理已剔除全部 70+ 行命令正则，Frontmatter 仅保留 `bash` 兜底（Writer 设 `ask`，Reviewer 设 `deny` 自律；子代所需通道由主代理放行、不得 `deny`，公理 M8）。命令边界统一由 `mcp/plan-governor.js` 单源治理，彻底解除了双源漂移与五处对账负担。
4. **匹配语义与判定机制（整串通配）**：白名单键编译为 `^...$` 锚定的整串通配正则——`*` 匹配任意字符（含空格与 `/`），Windows 下大小写不敏感，规则尾部 `" *"` 特判为 `( .*)?` 以兼容裸命令；书写顺序 last-match-wins，全部未命中默认 ask。管道与复合命令按语法树拆段、每段独立匹配、任一段命中 deny 即整体拒绝。
5. **语法树归属随会话 shell 而定（判别探针定稿）**：pwsh 会话使用内嵌 tree-sitter-powershell——`script_block` 内层命令是独立 `command` 节点、会被逐段拆检，脚本块借道不成立；Git Bash 会话使用 bash 语法树——花括号不拆检，`Where-Object { Remove-Item x }` 类借道成立。重定向降级（`redirected_statement`/`file_redirect` 判定）仅在 bash 语法树下有效：pwsh 会话下 `git status > out.txt` 类命令可能整体按 allow 放行并落盘（宿主上游缺口，非本模板引入；规范层禁 `>` 与判别探针持续兜底）。另：命令参数中出现的仓库外部路径仅产生 advisory 警告，`external_directory` 仅由 bash 工具的 `workdir` 参数触发（此子句待判别探针最终确认，措辞以实测为准）。
6. **禁加清单（负向边界，以下键严禁写入 allow）**：
   - 五个脚本块尾段 `Select-Object*`、`Where-Object*`、`Sort-Object*`、`Format-Table*`、`Format-List*` 维持 ask：Git Bash 会话下 bash 语法树不拆检花括号，`Where-Object { Remove-Item x }` 将整条按首命令命中 allow 放行；pwsh 会话虽会拆检拦截，亦不得依赖该差异（稳健性优先）。
   - `awk*`、`sed*`、`sort*`、`uniq*`、`xargs*`：`xargs` 可执行任意后续命令（如 `xargs rm`）、`sed -i` 原地改写文件、`sort -o` 写出文件、`awk` 可经 `print | "cmd"` 管道间接执行外部命令，均非真只读。
   - `git stash list`：被既有 deny 键 `git stash*` 一票否决（deny 优先于一切 allow），单独加 allow 永不生效，维持 deny 现状。
   - `git -C * log*` 类通配：可匹配 `git -C <repo> reset --hard log`、`git -C <repo> push origin log`（deny `git reset*`/`git push*` 均不命中），高危绕过，严禁配置。
7. **命令治理单源权威（解耦五处同步）**：终端命令的黑白名单与语法树治理已全面收口至 `mcp/plan-governor.js` 单源权威。三份 `-sp` 代理采用职责分离双通道，配合公理 M8（每工具跨三层取最严、任一 `deny` 即不注入），不再内嵌 70+ 行命令表。旧有的“五处同步义务”正式废止，新增或调整命令只需在 `mcp/plan-governor.js` 的 `ALLOW_KEYS` / `DENY_KEYS` / `FORBIDDEN_KEYS` 统一维护，多端（ZCode 与 Kilo Code）同步受益。
8. **禁改默认键闭世界**：bash 默认键 `"*": "deny"` 闭世界方案**作废、禁再提案**——用户定性："它是会造成工具注入丢失的元凶之一"。机理与本模板在案证据同源：:28-29 记录 edit 默认键设 deny 会直接不注入 edit/write 工具（公理 M2），:45 记录"它的权限并不是直接拒绝或者放行那么简单，而是连工具都无法注入"——默认键闭世界改变的是工具注入面，代价是工具注入丢失而非单纯拦截。结构级 deny 亦不可达：:105 拆段机制（"管道与复合命令按语法树拆段、每段独立匹配、任一段命中 deny 即整体拒绝"）意味着运算符被切分器消费，`"*;*"` 类结构键拆段后语义无效——无任何静态键能表达"含 `&&` 即拒"。Kilo 结构约束的正解 = 工作区根 `AGENTS.md` 单条铁律 + 技能总表结构面警示；全模板与全局 kilo.jsonc 的既有键（含 `"*": "ask"`）一律勿动。
9. **子代理权限继承与注入裁剪（公理 M8）**：对任一工具，宿主跨三层——主代理 md、子代理 md、`kilo.jsonc` 基座——**取最严值生效（`deny` < `ask` < `allow`）；有效值为 `deny` 即不注入该工具**（工具直接不在能力集，非运行期才拒）。据此：
   - **任一层 `deny` 即裁剪注入**：主代理 `deny` → 子代理即使自身 `allow` 也拿不到（父级门控）；子代理自身 `deny` 同样独立裁剪、不被父代理 `allow` 复活。故"子代理声明形同虚设"之说并不成立——本仓 Reviewer 对 main 实例各键 `deny`，其注入清单里 main 系工具即缺席，即为此证。
   - **主代未声明或 `ask` → 由子代声明决定**：凡子代需显式 `allow` 的通道（如 `plan-governor-subagent_exec_guarded_command`），主代侧**不得 `deny`**（`ask`、`allow` 或不写皆可放行注入）。注入判定为二元——有效值 `deny` → 不注入，`ask`/`allow` → 注入；两者的差异只体现在运行期是否弹窗，不影响是否注入。
   - **配置现状（双通道正交）**：
     - 主代理 `plan-writer-sp`（`mode: all`）：`plan-governor-main_exec_guarded_command: allow` + `plan-governor-subagent_exec_guarded_command: ask`（或 `allow`；非自用，纯为子代保留注入通道）+ `bash: "*": ask`。
      - 子代理 `plan-reviewer-sp` / `pr-reviewer-sp`（`mode: subagent`）：main 实例全部键 `deny`（`plan-governor-main_exec_guarded_command` / `plan-governor-main_exec_sandboxed_command` / `plan-governor-main_copy_into_sandbox` / `plan-governor-main_write_scoped_file` / `plan-governor-main_write_plan` / `plan-governor-main_write_review_report` / `plan-governor-main_write_pr_review_report` 共 7 键），`plan-governor-subagent_exec_guarded_command: allow`，`task`/`question`/`webfetch`/`board_post`/`board_read: deny`，`bash: "*": deny`。
   - **注入门控 ≠ 运行期裁决**：`deny` 挡在注入层（工具直接不进能力集）；工具一旦进入，MCP 实例仍按 `MCP_ROLE` 运行期执法（subagent 实例灰区恒拒）。两层叠加构成双通道隔离。
   - **与公理 M2/M7 同源**：冲突性闭世界 `deny` 在启动期即裁掉 `edit`/`write` 注入——这正是历史上"子代理配 `deny` 丢 `edit` 工具"的机理，也印证主代对子代所需通道应采 `ask`/`allow` 而非 `deny`。
10. **已知未完全收口项（如实声明）**：`plan-writer-sp` frontmatter 的 `bash` 兜底保持 `"*": ask`（不得改为标量 `deny` 或闭世界 `deny`——标量 deny 与冲突性闭世界会触发工具整体裁剪，连带丢掉 `edit` 注入），宿主原生 Bash 因此仍会注入该代理，终端命令面未 100% 收口至受控 MCP 通道。该残余通道受三重缓解：`kilo.jsonc` 写类 deny 键、`kilocode/AGENTS.md` 结构铁律、ask 需人工批准；`plan-writer-sp` 代理正文已同步如实声明此边界。

---
