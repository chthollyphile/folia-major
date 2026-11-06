# Folia 风格 MCP

这是跨客户端的 Folia 风格制作 MCP，支持 stdio 和本机 Streamable HTTP。它把 [Folia 风格导演 skill](../skills/folia-style-art-direction/SKILL.md) 接入指导、源码查询和验证流程。服务端读取同一份内容；播放器渲染仍由 Style Studio / Folia 的 API 2 Worker 执行。

Windows 用户可使用[独立安装包](style-tools-installation.md)：包含运行时、MCP、离线 Studio 和本地源码打包工具，无需保留仓库。`npm run style:tools:build` 构建候选安装器，安装后用 `folia-style.cmd self-test` 测试全部七个工具、资源、提示与两种传输。下文的 npm/Node 命令适用于源码部署；独立安装的等价命令见安装指南。

## 架构与参考

参考本机 Android Studio 的 JetBrains MCP 插件：工具服务与客户端配置分开，同一服务提供多种接入方式；参考本机 Blender MCP 源码：MCP 进程与应用内部执行层分开，模型不直接取得渲染器进程权限。Folia 的 `service.mjs` 用官方 `@modelcontextprotocol/sdk` 注册统一 tools/resources/prompts；`server.mjs` 和 `http.mjs` 负责传输；`clientProfiles.mjs` 只序列化宿主配置。不会因为更换模型而换一套工具行为。

Blender 参考的是本机 Blender Authors 的 `blender_mcp`：其 README 描述 stdio MCP → TCP → Blender add-on，`mcp/blmcp/tools_helpers/connection.py` 实现连接与超时。它与社区 `ahujasid/mcp-for-blender` 是不同项目。本次没有修改 Android Studio / Blender 的安装或配置。Folia 当前 MCP 不转发任意代码到渲染器；实际调试继续使用已有 Studio。

官方接入依据：[JetBrains MCP](https://www.jetbrains.com/help/idea/mcp-server.html)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)、[DeepSeek Harness MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[WorkBuddy Connector](https://open.workbuddy.cn/en/docs/connector)。

## 生成各客户端配置

先安装仓库依赖（例如 `npm ci --ignore-scripts`）。Node.js 使用 24.15 或更高的 24.x；入口依赖原生 TypeScript stripping 与已钉版本的 MCP SDK。保留源码和 node_modules，不要只把 server.mjs 单独拷走。

```powershell
npm run style:mcp:config
npm run style:mcp:doctor
```

配置生成到 `dist-style-mcp-clients/`，带当前机器 Node/入口的绝对路径；换机器、移动源码后重新生成。只导出片段，不覆写现有宿主配置。自定义输出与端口：`npm run style:mcp:config -- <输出目录> http://127.0.0.1:43198/mcp`。

| 客户端 | stdio 文件及接入位置 | HTTP 配置差异 |
| --- | --- | --- |
| Codex | `codex.stdio.toml`，合并到 Codex 配置或用 CLI 添加 | `codex.http.toml`，`bearer_token_env_var` |
| Claude Code | `claude-code.stdio.json`，合并到项目 `.mcp.json`，或用 CLI 添加 | `claude-code.http.json`，`type: http`，headers 引用环境变量 |
| Claude Desktop | `claude-desktop.stdio.json`，合并到桌面端本地 MCP 配置 | 不生成桌面/网页远程连接器配置；不能将本机 URL 当作云端可访问地址 |
| DeepSeek Harness | `deepseek-harness.stdio.yaml`，把该项并入部署 profile 的插件列表 | `deepseek-harness.http.yaml`，`transport: streamable-http` |
| WorkBuddy | `workbuddy.stdio.json`，通过 MCP 自定义配置入口导入 | `workbuddy.http.json`，`type: streamableHttp` |
| 其他 stdio 客户端 | `generic.stdio.json`，按宿主配置位置合并 | 未宣称所有宿主有统一 HTTP 配置格式 |

DeepSeek Harness 指官方 `@deepseek-ai/dsh-mcp-client` 插件，不能把 YAML 插件项直接塞进 mcpServers JSON；无需为 DeepSeek 模型另写 tool-calling 桥接。它的 prompt 模板入口不可用时，直接调用 `folia_style_brief` 和 `folia_style_read_guide`，制作规范不会丢失。WorkBuddy 文件是本地 MCP 配置，不是已发布的 Connector Marketplace 包。

## 接入本机 Codex

下列命令中的路径替换为本机真实绝对路径。

```powershell
codex mcp add folia-style -- node "C:\path\to\folia-major\dev\stylePacks\mcp\server.mjs"
codex mcp get folia-style
```

应直接运行 Node 入口，不用 `npm run` 作为 stdio command（npm 的启动说明会污染协议 stdout）。仓库内 `npm run style:mcp` 供手动启动排查。迁移或删除仓库后要更新配置。Codex 已打开的会话不保证热加载新 MCP；在新会话中检查工具可用性，必要时重启客户端。

可选：将仓库 `skills/folia-style-art-direction` 整目录复制到 `$CODEX_HOME/skills/folia-style-art-direction`（未设 CODEX_HOME 时为 `~/.codex/skills/`），让主机也能发现 `$folia-style-art-direction`。这份本地复制在更新 skill 后应重新同步；MCP 始终读取仓库原文件。MCP 不依赖这份复制，不支持 skills 的客户端也可通过工具获得同样指导。

其他支持 stdio 的客户端使用如下配置，名称/位置以客户端约定为准：

```json
{
  "mcpServers": {
    "folia-style": {
      "command": "node",
      "args": ["/absolute/path/folia-major/dev/stylePacks/mcp/server.mjs"]
    }
  }
}
```

Claude Code 的 CLI 接入：`claude mcp add --transport stdio --scope local folia-style -- node <绝对入口路径>`。用 `claude mcp get folia-style` 检查选中服务，不必运行模型或提供新 API Key。默认 local 作用域只关联当前项目。

## 多客户端共享的 HTTP

默认 stdio 每个客户端有自己的进程。需要同机共享服务时，在终端设置一个随机令牌（不要打印令牌值），再启动：

```powershell
$env:FOLIA_MCP_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
node dev/stylePacks/mcp/server.mjs --http 43197
```

客户端与 `style:mcp:doctor -- --http http://127.0.0.1:43197/mcp` 必须获得同一 `FOLIA_MCP_TOKEN`；生成的 HTTP 配置只有环境变量引用，不包含实际凭据。已运行的 GUI 不会自动继承后来设置的终端环境。Claude Code 按其 `${VAR}` 规则展开；WorkBuddy 按客户端变量配置展开；DeepSeek profile 使用 `!!js` 读取进程环境。若不方便共享环境，使用 stdio 即可。

HTTP 绑定 `127.0.0.1`，验证 Bearer、Host，拒绝浏览器 Origin；不提供 CORS、外网服务或旧 `/sse` 端点。无状态 JSON 响应不维持共享 session，关闭某个客户端不影响其他客户端。GET/DELETE 返回 405（没有独立通知流和可删除会话）。请求体有 2 MiB 限制，单机最多同时处理 32 个请求。这里只提供本机适配，没有云端 OAuth/公网部署。

## 分类目录

`folia_style_catalog({kind?})` 返回六种个性和十一种样式；kind 可为 personality 或 lyric-template。`folia_style_reference` 支持目录中全部 17 种内置实现，保留已有文件索引。brief 接受 kind 与 lyricTemplate，并自动加载 taxonomy 指导。check_pack 返回有效类别与 kindDeclared，旧包兼容显示不等于质量认证。随机与风格包入口不当成模板。

## 调用顺序

1. `folia_style_brief({task, source, kind?, lyricTemplate?})`：source 为 original / wallpaper / video / revision。返回 skill 正文、分类、内置设计原则、动态验收；参考/修改任务附重建经验。还有项目路径、契约资源 URI 和制作命令。
2. `folia_style_reference({style, file?, startLine?, lineCount?})`：支持目录中的全部 17 种内置风格。返回当前源码和行号，files 列出可读取的文件；单次至多 160 行。包含雾笺笔画描显、花火文字动画、绘光点亮/聚拢源码；只读白名单内的相关源码，不是任意文件浏览器。
3. Agent 写设计方案和 renderer，在 Studio 观看连续输出。`folia_style_review_motion({source, phrases})` 可比较实际轨迹，提示机械重复；source 是 `{kind: "rendered" | "planned", artifact: "证据路径"}`。具体采样格式见 skill 的动态验收参考；artifact 仅用于追溯，工具不打开视频、也不验证真实性。
4. `folia_style_check_pack({file})`：读取本地 JSON，使用播放器相同 validator；最大 4 MiB，不执行任何 renderer，不能代替运行或视觉验收。相对路径从仓库根目录算，绝对路径可指向用户的本地交付包。
5. `folia_style_read_guide({topic})`：通过普通工具读取 skill、taxonomy、builtins、lyric-release、reconstruction、motion、renderer-api 或 specification 全文，供不支持 resources/prompts 的客户端使用。lyric-release 规定按素材艺术风格选择逐字、逐句或字词浮现组句，并约束节奏调速、间奏闲游、真实发射点与阅读停留；brief 自动包含这份规范。
6. `folia_style_status({})`：检查服务环境、项目位置与可用指导，不启动播放器。
7. `folia_style_catalog({kind?})`：按类别查询内置实现及源码文件；用于选取参考与歌词模板。

所有工具均只读，无 shell 执行、文件写入或远程上传。它提供指导和诊断，不自动生成成品、不运行媒体分析模型、不强制其他 Agent 遵守美术判断。格式有效和“没有诊断警告”都不是审美合格，报告始终保留 `accepted: false`。

还提供：

- Prompt `folia_style_director`，参数 task / source / kind / lyricTemplate，与 brief 工具读取同一来源。
- Resources `folia-style://skill`、`taxonomy`、`builtins`、`lyric-release`、`reconstruction`、`motion`、`renderer-api`、`specification`（后七个同样使用 `folia-style://` 前缀）。
- 初始化 instructions 提醒 Agent 先加载制作指导。即使客户端不展示 prompts/resources，也可通过 tools 使用主要流程。

## 验证与兼容性

```powershell
npm run typecheck
npm run test:unit -- test/unit/stylePacks/mcp.test.ts
npm run test:unit -- test/unit/stylePacks/mcpCompatibility.test.ts
npm run style:mcp:doctor
npm run style:build
```

测试会启动真实 stdio 进程与独立 SDK 客户端，检查发现/调用、资源/提示、各 JSON 配置的启动、tools-only 读取完整契约；还测试 HTTP 并发隔离、鉴权、Origin/Host、体积边界和断开恢复。数值测试覆盖轨迹诊断。`doctor` 的成功表示协议与工具工作，不表示每个宿主的模型回合或视觉质量均经过验证。未安装的客户端只能报告配置依据与 SDK 互通，不能声称 UI 实测。

协议协商由钉定的 SDK 1.32.2 负责，提供 2025-11-25 及其支持的旧版本；不宣称实现 2026 新协议能力。能回退旧协议的现代客户端可连接。stdout 仅用于 stdio JSON-RPC，启动/错误信息到 stderr。依据：[生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

`style:build` 将 skill、本说明、`mcp-clients/` 配置一并放入离线 Studio；该命令导出的配置依赖本机源码。`style:tools:build` 另外构建自带运行时的独立安装包，客户端配置在安装后根据实际路径生成。视频参考 ZIP 附 skill 正文和参考，无 MCP 也能执行同样的设计与验收流程。skill 不包含原壁纸的第三方艺术素材。
