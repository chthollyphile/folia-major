# Folia Control API

让外部程序——CLI、MCP 客户端（Claude Desktop / Claude Code / Cursor 等）、或直接 HTTP——完整控制 Folia：
搜歌、播放、传输控制、音量、队列、歌词、歌词动画与背景、外观主题、设置、本地库、窗口、截图、
事件流。

控制服务默认**关闭**。开启后只监听 `127.0.0.1`，所有请求都要带 token，等同于本机用户权限。

- 能力清单（唯一来源）：[`shared/controlCatalog.mjs`](../shared/controlCatalog.mjs)，共 46 个工具。
- 协议形状与实现契约：[`control/PROTOCOL.md`](PROTOCOL.md)。
- 二次开发（加工具、改实现）：[`docs/control-api.md`](../docs/control-api.md)。
- 给 Agent 用的精简工作流：skill [`skills/control-folia`](../skills/control-folia/SKILL.md)。

---

## 能做什么

按工具组划分，完整参数见下文[工具参考](#工具参考)。

| 组 | 工具数 | 能力 |
| --- | --- | --- |
| `system` | 4 | 状态摘要、完整状态快照、工具目录、渲染进程求值（需显式开启） |
| `palette` | 2 | 列出并执行命令面板里的全部命令（125+ 条，最宽的能力面） |
| `search` | 1 | 在线平台 / 本地库搜索，返回可直接播放的歌曲对象 |
| `playback` | 10 | 播放、搜索即播、播放/暂停/上一首/下一首、跳转、音量与静音、循环、随机、喜欢、定时关闭、ReplayGain |
| `queue` | 6 | 读队列、跳到某项、加歌、删歌、移动、清空 |
| `lyrics` | 3 | 当前歌词（可含逐行）、时间轴偏移、跳到某一行 |
| `visualizer` | 7 | 列出/切换歌词动画、切换背景、背景调参、智能节拍、视频层、日夜/跟随系统/封面取色/静态模式/AI 主题 |
| `settings` | 3 | 读设置、写白名单设置、打开设置对话框 |
| `navigation` | 4 | 切换主视图、开合侧栏、开合命令面板、应用内 toast |
| `library` | 2 | 本地曲库 list/search/play、在线平台与登录态 |
| `window` | 3 | 窗口状态与最小化/最大化/全屏/置顶/鼠标穿透/关闭、截图、退出 |
| `events` | 1 | 轮询事件流（切歌、播放状态、队列、音量、动画、背景、主题、视图、命令执行） |

---

## 架构

```
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│ CLI  control/cli.mjs         │        │ MCP client (Claude Desktop 等)  │
│ MCP stdio  control/mcp.mjs   │        └───────────────┬─────────────────┘
└──────────────┬───────────────┘                        │ stdio / HTTP
               │ HTTP(127.0.0.1) 或 CDP                  │
               ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Electron main: electron/controlServer.cjs                               │
│  GET /health /tools /state /events   POST /invoke   POST /mcp (MCP)     │
│  鉴权 token · 主进程工具（截图/退出）· webContents.executeJavaScript 转发 │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ window.__FOLIA_CONTROL__.invoke(name, args)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Renderer: src/control/                                                  │
│  ControlHost (React) 从 App.tsx 拿到 CommandPaletteContext               │
│  handlers/ 工具栏 → stores + omni + context（播放/队列/视觉/设置/导航）    │
│  events 环形缓冲 · state 快照 · palette 直通（125+ 命令）                 │
└─────────────────────────────────────────────────────────────────────────┘
```

要点：

1. **一个执行器**：业务逻辑全在渲染进程的 bridge（`src/control/`），主进程只负责传输、鉴权、
   转发，以及只有主进程能做的 `folia_screenshot`、`folia_quit`。
2. **能力可枚举**：所有工具来自 catalog；CLI、MCP、HTTP、bridge 都从它生成，测试保证 handler
   与 catalog 一致。
3. **默认关闭**：首次运行时由 `FOLIA_CONTROL=1`，或开发模式（`ELECTRON_DEV=true` 且未被
   `FOLIA_CONTROL=0` 关闭）决定；此后以「设置 → 连接与集成 → AI 控制」里的开关为准并持久化。

---

## 快速开始

要求 Node.js 24+（仓库 `.nvmrc` 是 24），依赖已 `npm ci` 安装。

### 1. 开发模式（推荐先跑这个）

```bash
# 终端 1：Vite + Electron，同时开启控制 server
FOLIA_CONTROL=1 npm run dev:electron
```

`dev:electron` 本身带 `ELECTRON_DEV=true`，开发模式下控制 server 默认会启动；显式写
`FOLIA_CONTROL=1` 只是让意图更清楚。启动日志里会出现：

```
[Control] server ready url=http://127.0.0.1:4567 token-file=<userData>/control-token
```

### 2. 打包版

打包版默认不启动控制 server。打开「设置 → 连接与集成 → AI 控制」并拨开开关即可，选择会持久化
（页面里也能复制现成的 MCP 配置、AI 提示词和令牌）。

需要在启动时就开启（自动化、无人值守）时，也可以在**启动应用前**注入环境变量：

```bash
# macOS：从终端启动（Finder 双击不会继承 shell 环境变量）
FOLIA_CONTROL=1 /Applications/Folia.app/Contents/MacOS/Folia

# Windows PowerShell
$env:FOLIA_CONTROL=1; & "C:\Program Files\Folia\Folia.exe"

# Windows cmd
set FOLIA_CONTROL=1 && "C:\Program Files\Folia\Folia.exe"

# Linux AppImage / deb
FOLIA_CONTROL=1 ./Folia-*.AppImage
```

环境变量只在还没有存过开关时决定初始值；一旦在设置里拨过，以设置里的选择为准。

### 3. Web / CDP 模式

Web 版没有 Electron 主进程，起不了控制 server；但渲染进程的 bridge 始终安装，可以用
Chromium DevTools Protocol（CDP）直接驱动：

```bash
# 终端 1：Web 开发版
npm run dev

# 终端 2：带调试端口的 Chromium 打开 http://localhost:3000
#   macOS 示例
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 http://localhost:3000

# 终端 3：CLI 直连 CDP
node control/cli.mjs status --transport cdp --cdp http://127.0.0.1:9222
```

也可以对 Electron 用 CDP（React DevTools/自动化工具常见做法）：

```bash
ELECTRON_DEV=true FOLIA_CONTROL=0 npx electron . --remote-debugging-port=9222
node control/cli.mjs status --transport cdp --cdp http://127.0.0.1:9222
```

### 4. 找到 url 与 token

server 启动时会把连接信息写入 `<userData>/control-server.json`（权限 0600）：

```json
{ "port": 4567, "token": "…", "pid": 12345, "startedAt": 1720000000000, "url": "http://127.0.0.1:4567" }
```

```bash
# macOS 默认 userData 目录（打包版 productName 是 Folia；开发版同样以 Folia 命名）
cat "$HOME/Library/Application Support/Folia/control-server.json"
# Windows: %APPDATA%\Folia\control-server.json
# Linux:   ~/.config/Folia/control-server.json
```

如果目录名不是 `Folia`，以启动日志里的 `token-file=<path>` 为准。也可以直接用 token 文件：

```bash
TOKEN_FILE="$HOME/Library/Application Support/Folia/control-token"
```

端口默认 `4567`，被占用时自动尝试 `4568`…`4576`。**以 `control-server.json` 或日志里的 url 为准**，
不要假设一定是 4567。

### 5. 第一条命令

```bash
export FOLIA_URL="http://127.0.0.1:4567"
export FOLIA_TOKEN_FILE="$HOME/Library/Application Support/Folia/control-token"

node control/cli.mjs doctor  --url "$FOLIA_URL" --token-file "$FOLIA_TOKEN_FILE"
node control/cli.mjs status  --url "$FOLIA_URL" --token-file "$FOLIA_TOKEN_FILE"
node control/cli.mjs volume 30 --url "$FOLIA_URL" --token-file "$FOLIA_TOKEN_FILE"
node control/cli.mjs screenshot --out /tmp/folia.png \
  --url "$FOLIA_URL" --token-file "$FOLIA_TOKEN_FILE"
```

---

## CLI

入口：`node control/cli.mjs <command> [args] [options]`。所有命令最终都调用 catalog 工具。
`control/package.json` 定义了 `bin`，想直接敲 `folia` 可以：

```bash
cd control && npm link    # 之后可以直接用 folia / folia-mcp
```

### 连接与通用选项

| 选项 | 说明 |
| --- | --- |
| `--url <http://127.0.0.1:4567>` | 控制 server 地址（env `FOLIA_CONTROL_URL`） |
| `--token <t>` | 直接给 token（env `FOLIA_CONTROL_TOKEN`） |
| `--token-file <path>` | 从文件读 token（推荐，避免进 shell 历史；env `FOLIA_CONTROL_TOKEN_FILE`） |
| `--transport http\|cdp\|auto` | 默认 `auto`：先试 HTTP，失败后退到 CDP（env `FOLIA_CONTROL_TRANSPORT`） |
| `--cdp <http://127.0.0.1:9222>` | CDP 调试端口地址（env `FOLIA_CONTROL_CDP`） |
| `--target <url子串>` | CDP 模式下按 URL 子串选目标页面 |
| `--json` | 成功时输出原始 `data`；失败时错误仍写到 stderr（退出码 1） |
| `--timeout <ms>` | 单次请求超时（默认 30000；env `FOLIA_CONTROL_TIMEOUT`） |
| `--allow-eval` | 允许 CLI 的 `eval` 子命令 / MCP stdio 暴露 `folia_eval`；HTTP 转发还要 app 侧设 `FOLIA_CONTROL_ALLOW_EVAL=1` |
| `--verbose` | 在 stderr 打诊断信息（不会打印 token） |

退出码：`0` 成功；`1` 控制失败（工具返回 `ok:false`，stderr 带 `error (<code>)`）；
`2` 连接失败或用法错误。

`node control/cli.mjs doctor` 会检查 Node 版本、URL、transport、token、`/health`、`/tools`
与 catalog 是否一致；没显式给连接参数时它会尝试从常见的 `<userData>` 目录自动发现
`control-server.json`。

### 全命令表

| 命令 | 说明 | 对应工具 |
| --- | --- | --- |
| `status` | 一行式状态摘要 | `folia_status` |
| `state [--lyrics]` | 完整状态快照（`--lyrics` 带上逐行歌词） | `folia_state` |
| `tools [--group <g>]` | 列出控制工具（可只看一组） | `folia_tools` |
| `doctor` | `/health` + `/tools` + 环境自检 | `/health`、`/tools` |
| `search <q>` | 搜索；`--provider`、`--source`、`--limit`、`--offset` | `folia_search` |
| `play <q>` | 搜索并播放第一条 | `folia_play_search` |
| `play --provider <provider> --id <id>` | 按在线歌曲 id 播放，--provider 必填；本地用 `library play <id>` | `folia_play` |
| `pause` / `resume` / `toggle` / `next` / `prev` / `stop` | 传输控制（`stop` 会暂停；非 FM 模式还会清空队列） | `folia_transport` |
| `seek <sec\|%\|mm:ss>` | 按秒、百分比或 `mm:ss` 跳转；暂停时会恢复播放 | `folia_seek` |
| `volume [level]` | 读/设音量 0-100；`--delta <n>` 相对调整 | `folia_volume` |
| `mute [on\|off]` | 静音开关 | `folia_volume` |
| `loop [off\|all\|one]` | 循环模式 | `folia_loop` |
| `shuffle` | 打乱队列 | `folia_shuffle` |
| `like [on\|off]` | 喜欢/取消喜欢当前歌曲 | `folia_like` |
| `replaygain [off\|track\|album]` | 设置 ReplayGain 模式 | `folia_replaygain` |
| `sleep [minutes]` / `sleep --hours <h>` / `sleep --cancel` / `sleep --status` | 定时关闭 | `folia_sleep_timer` |
| `queue [list]` | 读队列 | `folia_queue` |
| `queue play <i>` | 播放队列第 i 项 | `folia_queue_play` |
| `queue add <q>` | 搜索并加入队列 | `folia_queue_add` |
| `queue remove <i...>` | 删除队列项 | `folia_queue_remove` |
| `queue move <from> <to\|next\|end>` | 移动队列项 | `folia_queue_move` |
| `queue clear` | 清空队列 | `folia_queue_clear` |
| `lyrics [--lines]` | 当前歌词 | `folia_lyrics` |
| `lyrics offset <ms> [--delta] [--global]` | 歌词时间轴偏移 | `folia_lyric_offset` |
| `lyrics seek <line>` | 跳到歌词行 | `folia_lyric_seek` |
| `visual list` | 列出歌词动画与背景 | `folia_visualizer_list` |
| `visual set <mode>` | 切换歌词动画（如 `fume`） | `folia_visualizer_set` |
| `visual bg <mode>` | 切换背景（如 `monet`、`sora`） | `folia_background_set` |
| `visual tune <target> <json>` | 背景调参（`monet` / `latent`） | `folia_visual_tuning` |
| `smartbeat [on\|off]` | 智能节拍 | `folia_smart_beat` |
| `visual video [on\|off]` | 视频层开关 | `folia_video_layer` |
| `theme` | 读外观状态 | `folia_appearance` |
| `theme day\|night\|system\|cover\|static` | 切换外观 | `folia_appearance` |
| `theme ai` | 生成 AI 主题（需已配置 AI 凭据） | `folia_appearance` |
| `settings [store] [key]` | 读设置 | `folia_settings_read` |
| `settings set <key> <value>` | 写白名单设置 | `folia_settings_write` |
| `settings open [subview]` | 打开设置对话框 | `folia_settings_open` |
| `nav <home\|player\|lattice>` | 切换主视图 | `folia_navigate` |
| `panel <tab>` | 打开/关闭侧栏 | `folia_panel` |
| `palette` | 打开/关闭命令面板 UI | `folia_palette_ui` |
| `palette list [--all]` | 列出命令面板命令 | `folia_palette_list` |
| `palette run <id> [input]` | 执行命令面板命令 | `folia_palette_run` |
| `library list\|search <q>\|play <id>` | 本地曲库 | `folia_library` |
| `providers` | 在线平台与登录态 | `folia_providers` |
| `screenshot [--out <file>] [--no-save]` | 截图到文件（`--no-save` 不落盘，只回 base64） | `folia_screenshot` |
| `window status\|minimize\|maximize\|fullscreen\|on-top [on\|off]\|click-through [on\|off]\|close` | 窗口控制 | `folia_window` |
| `events [--watch] [--since N] [--limit N]` | 事件流（`--watch` 持续跟随） | `folia_events` |
| `toast <text>` | 应用内 toast | `folia_toast` |
| `call <tool> '<json>'` | 直接调用任意工具；`'-'` 从 stdin 读 JSON | 任意工具 |
| `eval '<expr>'` | 渲染进程求值（CLI 需 `--allow-eval`，HTTP 需 app 侧 `FOLIA_CONTROL_ALLOW_EVAL=1`） | `folia_eval` |
| `quit --yes` | 退出应用 | `folia_quit` |
| `mcp` | 以 stdio MCP server 运行 | `control/mcp.mjs` |

### 常用示例

```bash
CLI=(node control/cli.mjs)
CONN=(--url "$FOLIA_URL" --token-file "$FOLIA_TOKEN_FILE")

# 搜索并播放
"${CLI[@]}" search "周杰伦 晴天" --limit 5 --json "${CONN[@]}"
"${CLI[@]}" play "周杰伦 晴天" "${CONN[@]}"

# 读状态、调音量、切动画与背景
"${CLI[@]}" state --json "${CONN[@]}"
"${CLI[@]}" volume 35 "${CONN[@]}"
"${CLI[@]}" visual list --json "${CONN[@]}"
"${CLI[@]}" visual set fume "${CONN[@]}"
"${CLI[@]}" visual bg monet "${CONN[@]}"

# 写设置并回读（audio.volume 写入可用 0-100，读回是 0-1 的原始值，0.4 = 40%）
"${CLI[@]}" settings set audio.volume 40 "${CONN[@]}"
"${CLI[@]}" settings audio volume --json "${CONN[@]}"

# 事件流：先取当前游标，再持续跟随
"${CLI[@]}" events --json "${CONN[@]}"
"${CLI[@]}" events --watch "${CONN[@]}"

# 任意工具与逃生口
"${CLI[@]}" call folia_lyrics '{"includeLines":true}' --json "${CONN[@]}"
"${CLI[@]}" eval 'window.__FOLIA_CONTROL__.version' --allow-eval "${CONN[@]}"

# 结束
"${CLI[@]}" quit --yes "${CONN[@]}"
```

---

## MCP 接入

两种传输方式：**stdio**（推荐，兼容性最好）和 **HTTP**（Electron 内嵌 `POST /mcp`）。

### 方式一：stdio（`control/mcp.mjs`）

MCP 客户端自己 spawn `node control/mcp.mjs`，逐行 JSON-RPC 2.0 走 stdin/stdout。

Claude Desktop（macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "folia": {
      "command": "node",
      "args": [
        "/absolute/path/to/folia/control/mcp.mjs",
        "--url", "http://127.0.0.1:4567",
        "--token-file", "/Users/you/Library/Application Support/Folia/control-token"
      ]
    }
  }
}
```

Claude Desktop（Windows：`%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "folia": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\folia\\control\\mcp.mjs",
        "--url", "http://127.0.0.1:4567",
        "--token-file", "C:\\Users\\you\\AppData\\Roaming\\Folia\\control-token"
      ]
    }
  }
}
```

通用 `mcpServers` 写法（Cursor、Windsurf、Cline 等，文件名和位置看各客户端文档）：

```json
{
  "mcpServers": {
    "folia": {
      "command": "node",
      "args": [
        "/absolute/path/to/folia/control/mcp.mjs",
        "--url", "http://127.0.0.1:4567",
        "--token-file", "/absolute/path/to/control-token"
      ],
      "env": {}
    }
  }
}
```

需要 `folia_eval` 时，两处都要开：MCP stdio 进程加 `--allow-eval` 才会在 `tools/list` 里暴露该工具；
真正的执行还要求拉起 Folia 时设 `FOLIA_CONTROL_ALLOW_EVAL=1`（HTTP `/mcp` 与 `/invoke` 的
`disabled` 判断在 server 侧）。示例：

```json
{
  "mcpServers": {
    "folia": {
      "command": "node",
      "args": [
        "/absolute/path/to/folia/control/mcp.mjs",
        "--url", "http://127.0.0.1:4567",
        "--token-file", "/absolute/path/to/control-token",
        "--allow-eval"
      ]
    }
  }
}
```

Claude Code 一条命令注册：

```bash
claude mcp add folia -- node /absolute/path/to/folia/control/mcp.mjs \
  --url http://127.0.0.1:4567 \
  --token-file "$HOME/Library/Application Support/Folia/control-token"
```

### 方式二：HTTP（Electron 内嵌 `/mcp`）

控制 server 自带 stateless 的 MCP JSON-RPC 端点：`POST http://127.0.0.1:4567/mcp`，
`Content-Type: application/json`，鉴权与 `/invoke` 相同（`Authorization: Bearer <token>`）。

```json
{
  "mcpServers": {
    "folia-http": {
      "type": "http",
      "url": "http://127.0.0.1:4567/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

不同客户端对 HTTP transport 的 `type` 叫法不同（有的写 `"streamableHttp"`、有的只给 `url`），
按客户端文档填即可；这个端点本身是 stateless JSON-RPC，不实现 SSE。

手写 curl 验证：

```bash
TOKEN="$(cat "$HOME/Library/Application Support/Folia/control-token")"
URL="http://127.0.0.1:4567"

# initialize
curl -sS "$URL/mcp" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-06-18", "capabilities": {},
              "clientInfo": { "name": "curl", "version": "0" } }
}'

# tools/list
curl -sS "$URL/mcp" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
}'

# tools/call
curl -sS "$URL/mcp" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "folia_volume", "arguments": { "level": 30 } }
}'
```

细节：

- 协议版本 `2025-06-18`，服务名 `folia-control`。
- `tools/call` 普通结果是一段 `text`（`JSON.stringify(data, null, 2)`）；错误时
  `isError: true` 且 text 为 `<code>: <message>`。
- `folia_screenshot` 返回 `image`（base64 PNG）+ 一段 text（尺寸与落盘路径）。
- `notifications/*` 返回 `202` 空 body；`GET /mcp` 返回 `405`。**没有 SSE 流**，
  严格要求 streamable HTTP/SSE 的客户端请改用 stdio 方式。
- 直接调 `tools/call` 不强制先 `initialize`（stateless），但兼容客户端仍会先握手。

---

## 工具参考

完整 schema 以 [`shared/controlCatalog.mjs`](../shared/controlCatalog.mjs) 为准；下表的「关键参数」
只列最常用的，省略号表示还有其它可选参数。危险工具（`folia_eval`、`folia_queue_clear`、
`folia_quit`）需要额外谨慎。

### system

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_status` | 一行式摘要：版本、窗口、provider、正在播放、音量、视图 | — | 是 | 否 |
| `folia_state` | 完整状态快照（播放/队列/音量/视觉/主题/provider/设置） | `includeQueue`、`includeLyrics`、`includeProviders` | 是 | 否 |
| `folia_tools` | 列出全部工具及分组、执行器、危险标记 | `group` | 是 | 否 |
| `folia_eval` | 在渲染进程求值任意 JS（逃生口，需显式开启） | `expression`（必填） | 否 | **是** |

### palette

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_palette_list` | 列出命令面板全部命令（id/组/标题/可用性） | `query`、`includeUnavailable`、`includeHidden` | 是 | 否 |
| `folia_palette_run` | 按 id 执行任意应用命令，可带输入 | `id`（必填）、`input` | 否 | 否 |

### search

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_search` | 搜索在线平台或本地库，返回带 `index` 的可播放歌曲对象 | `query`（必填）、`source`、`provider`、`limit`、`offset` | 是 | 否 |

### playback

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_play_search` | 搜索并立即播放第 `index` 条 | `query`（必填）、`index`、`provider`、`source` | 否 | 否 |
| `folia_play` | 播放歌曲对象 / `provider`+`id` / 本地 id / 查询词 | `song`、`localId`、`query`、`provider`、`id`、`index`、`queue` | 否 | 否 |
| `folia_transport` | `play` 恢复播放 / `pause` / `toggle` / `next` / `prev` / `stop`（暂停，非 FM 时清空队列） | `action`（必填） | 否 | 否 |
| `folia_seek` | 按绝对秒数或百分比跳转（通过页面内 audio 元素；暂停时恢复播放） | `seconds`、`percent` | 否 | 否 |
| `folia_volume` | 读/设音量与静音：写入 `level` 用 0-100，读回 `level` 是 0-1、`percent` 是 0-100 | `level`、`delta`、`mute`、`status` | 否 | 否 |
| `folia_loop` | 循环模式 off/all/one，或轮换 | `mode`、`cycle` | 否 | 否 |
| `folia_shuffle` | 打乱当前队列 | — | 否 | 否 |
| `folia_like` | 喜欢/取消喜欢当前歌曲 | `liked` | 否 | 否 |
| `folia_sleep_timer` | 设置/取消/读取定时关闭 | `minutes`、`hours`、`cancel`、`status` | 否 | 否 |
| `folia_replaygain` | 设置 ReplayGain 模式 | `mode`（必填，off/track/album） | 否 | 否 |

### queue

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_queue` | 分页读队列、当前索引、FM 模式 | `offset`、`limit` | 是 | 否 |
| `folia_queue_play` | 跳到队列第 `index` 项 | `index`（必填） | 否 | 否 |
| `folia_queue_add` | 加歌到队列（对象/数组/查询词/本地 id） | `song`、`songs`、`query`、`provider`、`index`、`localId`、`position` | 否 | 否 |
| `folia_queue_remove` | 按索引删除队列项 | `index`、`indices` | 否 | 否 |
| `folia_queue_move` | 移动到指定索引 / 下一首 / 末尾 | `from`（必填）、`to`、`toNext`、`toEnd` | 否 | 否 |
| `folia_queue_clear` | 清空队列（FM 队列会被拒绝） | — | 否 | **是** |

### lyrics

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_lyrics` | 当前歌词格式、行、当前行、偏移 | `includeLines`、`limit` | 是 | 否 |
| `folia_lyric_offset` | 读/改歌词时间轴偏移（单曲或全局；全局会被应用钳到 ±2000ms） | `ms`、`deltaMs`、`scope` | 否 | 否 |
| `folia_lyric_seek` | 跳到歌词行或绝对秒数 | `lineIndex`、`seconds` | 否 | 否 |

### visualizer

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_visualizer_list` | 列出歌词动画与背景（含模组贡献项） | — | 是 | 否 |
| `folia_visualizer_set` | 切换歌词动画（如 fume/classic/monet/diorama） | `mode`（必填） | 否 | 否 |
| `folia_background_set` | 切换背景（common/latent/monet/nomand/sora/url） | `mode`（必填） | 否 | 否 |
| `folia_visual_tuning` | 合并调整 Monet / Latent 背景参数 | `target`（必填）、`patch`（必填） | 否 | 否 |
| `folia_smart_beat` | 开关智能节拍效果 | `enabled` | 否 | 否 |
| `folia_video_layer` | 开关歌词后的视频层或打开文件选择器 | `enabled`、`pickFile` | 否 | 否 |
| `folia_appearance` | 日夜/跟随系统/封面取色/静态模式/AI 主题/主题编辑器 | `daylight`、`followSystemTheme`、`coverColorBg`、`staticMode`、`disableHomeDynamicBackground`、`generateAITheme`、`openThemeEditor` | 否 | 否 |

### settings

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_settings_read` | 读精选设置（audio/visualizer/theme/lyrics/playback/sleepTimer/view/appearance/main）；返回 store 原始值 | `store`、`key` | 是 | 否 |
| `folia_settings_write` | 按点路径写白名单设置（如 `audio.volume`、`theme.daylight`） | `key`（必填）、`value`（必填） | 否 | 否 |
| `folia_settings_open` | 打开设置对话框到指定子页 | `tab`、`subview`、`anchor` | 否 | 否 |

`folia_settings_write` 的白名单路径：

`audio.volume`、`audio.muted`、`audio.loopMode`、`audio.audioQuality`、`audio.playbackFade`、
`visualizer.mode`、`visualizer.background`、`visualizer.opacity`、`visualizer.randomPerSong`、
`visualizer.glowBlurQuantize`、`theme.daylight`、`theme.followSystemTheme`、`theme.coverColorBg`、
`theme.staticMode`、`theme.disableHomeDynamicBackground`、`lyrics.globalOffsetMs`、`lyrics.autoUseBest`、
`playback.replayGainMode`、`sleepTimer.hours`、`sleepTimer.minutes`。

其他开关用 `folia_palette_run`。

两条容易踩的语义：

- `audio.volume` 写入接受 0-100 或 0-1 两种写法（>1 按百分比换算），但 `folia_settings_read`
  返回 store 的原始值（0-1）。所以 `settings set audio.volume 40` 之后读回是 `0.4`，即 40%。
- `lyrics.globalOffsetMs` 在 handler 允许 ±60000ms，但应用 store 会把全局偏移钳到 ±2000ms；
  单曲偏移（`folia_lyric_offset` 的 `scope:"song"`）按当前曲目调整。

### navigation

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_navigate` | 切换主视图 home/player/lattice | `view`（必填） | 否 | 否 |
| `folia_panel` | 打开/关闭统一侧栏并选 tab | `tab`、`open` | 否 | 否 |
| `folia_palette_ui` | 显示/隐藏命令面板 | `action`（必填） | 否 | 否 |
| `folia_toast` | 在应用里显示提示 | `text`（必填）、`type`、`durationMs` | 否 | 否 |

### library

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_library` | 本地曲库 list/search/play | `action`（必填）、`query`、`id`、`offset`、`limit` | 否 | 否 |
| `folia_providers` | 在线平台、能力与登录态 | — | 是 | 否 |

### window

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_window` | 窗口状态/最小化/最大化/全屏/置顶/鼠标穿透/关闭 | `action`（必填）、`value` | 否 | 否 |
| `folia_screenshot` | 截主窗口 PNG（base64 + 可选落盘），主进程执行 | `save`、`path` | 是 | 否 |
| `folia_quit` | 退出应用（必须 `confirm:true`），主进程执行 | `confirm`（必填） | 否 | **是** |

### events

| 工具 | 作用 | 关键参数 | 只读 | 危险 |
| --- | --- | --- | --- | --- |
| `folia_events` | 轮询事件流，`waitMs` 可长轮询最多 10s | `since`、`limit`、`waitMs` | 是 | 否 |

事件类型：`playback.songChanged`、`playback.stateChanged`、`playback.queueChanged`、
`playback.volumeChanged`、`playback.loopModeChanged`、`visualizer.modeChanged`、
`visualizer.backgroundChanged`、`theme.changed`、`view.changed`、`palette.executed`。

---

## Agent 工作流示例

把连接信息收进一个 shell 函数，后续命令都可复制执行：

```bash
export FOLIA_URL="http://127.0.0.1:4567"
export FOLIA_TOKEN_FILE="$HOME/Library/Application Support/Folia/control-token"
folia() { node control/cli.mjs "$@" --url "$FOLIA_URL" --token-file "$FOLIA_TOKEN_FILE"; }
```

### 搜歌 → 播放 → 调音量

```bash
folia status --json                 # 1. 先确认连上、当前 provider 和播放状态
folia providers --json              # 2. 看哪个平台可用/已登录
folia search "周杰伦 晴天" --provider netease --limit 5 --json   # 3. 取结构化结果，挑第 index 条
folia play --provider netease --id 123456              # 4. 按平台 id 播放；或 folia play "周杰伦 晴天"
folia volume 35                     # 5. 调音量
folia volume --json                 # 6. 回读，确认 percent=35（level=0.35）
```

### 切歌词动画 / 背景 / 主题

```bash
folia visual list --json            # 当前构建可用的动画与背景 id
folia visual set fume               # 切歌词动画
folia visual bg monet               # 切背景
folia visual tune monet '{"backgroundLayout":"full-overlay"}'   # 背景调参
folia theme night                   # 或 day / system / cover / static
folia theme --json                  # 回读外观状态
```

### 截图自检

```bash
folia screenshot --out /tmp/folia-check.png
```

截图默认同时保存到 `<userData>/control-screenshots/`；`--out` 指定精确路径。
主窗口被最小化/隐藏时画面可能不是用户所见，必要时先 `folia window status`、
`folia window maximize`。

### 监听事件

```bash
# 取当前游标（since 省略 = 从缓冲区末尾开始）
folia events --json

# 持续跟随（内部循环 waitMs 长轮询）；Ctrl+C 结束
folia events --watch --since 0
```

典型用途：播放歌单后等 `playback.songChanged`，切主题后等 `theme.changed`，
命令执行后等 `palette.executed`，据此做“动作 → 生效”断言。

### 直接使用工具（不经过 CLI 子命令）

```bash
folia call folia_state '{"includeQueue":true,"includeLyrics":true}' --json
folia call folia_settings_write '{"key":"theme.daylight","value":false}'
folia call folia_library '{"action":"list","limit":10}' --json
```

---

## 安全

- 控制 server **只绑 `127.0.0.1`**；token 随机生成、文件权限 0600，可用
  `FOLIA_CONTROL_TOKEN` 覆盖。
- **控制 API 等同本机用户权限**：能改设置、操作队列、截图、退出应用。不要在不可信机器
  上开启，也不要把端口转发到局域网。
- `folia_eval` 是逃生口，默认不可用，门控分两处：HTTP 执行要求拉起 Folia 时设
  `FOLIA_CONTROL_ALLOW_EVAL=1`；CLI 的 `eval` 命令 / MCP stdio 的 `tools/list` 还需要客户端侧
  `--allow-eval`。CDP 模式直接调 bridge，绕过 server 检查，只建议本机调试用。
- `folia_palette_run`、`folia_settings_write`、`folia_queue_clear`、`folia_quit` 是高权限操作；
  Agent 应在用户明确要求时才调用，`folia_quit` 必须 `confirm:true`。
- token 不要写进日志、提交到仓库或放进会回显的命令行；脚本里优先 `--token-file`。
- 截图内容可能包含用户界面上的隐私信息（歌单、账号名、封面），外发前先确认。

---

## 故障排查

| 现象 | 排查 |
| --- | --- |
| CLI 退出码 2，`ECONNREFUSED` | server 没启动：开发模式确认 `ELECTRON_DEV=true` 且 `FOLIA_CONTROL != 0`；打包版到「设置 → 连接与集成 → AI 控制」打开开关（或启动前设置 `FOLIA_CONTROL=1`）。 |
| 连上了但不是预期的实例 | 端口可能被别的实例占用后自动 +1。读**当前实例**的 `<userData>/control-server.json` 或日志里的 `url=`，不要写死 4567。 |
| 401 `unauthorized` | token 不对：确认 `--token-file` 指向当前实例的 `<userData>/control-token`；换过 profile、或用 `FOLIA_CONTROL_TOKEN` 启动时需要对应 token。 |
| `/health` 正常，`/invoke` 返回 503 `not_ready` | 渲染进程 bridge 还没安装：页面还在加载或 renderer 崩溃。等界面出来再试；看应用内日志。 |
| `unknown_tool` | 工具名拼错，或该版本 catalog 没有这个工具；用 `folia tools --json` / MCP `tools/list` 核对。 |
| `disabled`（尤其 `folia_eval`） | 服务端未允许：拉起 Folia 时设 `FOLIA_CONTROL_ALLOW_EVAL=1`；CLI/MCP 侧再加 `--allow-eval` 才能暴露/执行 eval 命令。 |
| `search_failed` / `no_results` | provider 网络失败、未登录或被限流。`folia providers` 看登录态；换 provider 或稍后重试。搜索链路本身是通的。 |
| 播放失败 `playback_failed` | 在线歌曲需要对应平台账号；在应用内登录该平台后重试。 |
| 截图空白/黑屏 | 窗口最小化、隐藏到托盘或被锁屏；恢复窗口后重截。 |
| CDP 模式找不到目标 | 启动时没带 `--remote-debugging-port=9222`；Electron 还会开 devtools 目标，CLI 会过滤，可用 `--target <url子串>` 指定。 |
| 启动 Electron 时提示 `bad option: --remote-debugging-port` | 当前 shell 带了 `ELECTRON_RUN_AS_NODE=1`（常见于 Electron 应用内置终端），Electron 会退化成 Node。先 `unset ELECTRON_RUN_AS_NODE` 再启动。 |
| MCP 客户端连 HTTP `/mcp` 失败 | 该端点是 stateless JSON-RPC，不支持 SSE；客户端强依赖 streamable HTTP 时改用 stdio 的 `control/mcp.mjs`。 |
| 端口 4567 被占且 4568-4576 也失败 | server 会打印警告并放弃启动；用 `FOLIA_CONTROL_PORT` 指定一个空闲端口，再重启 Folia。 |
| 开发模式改了 bridge 代码但行为没变 | Vite 热更新可能没覆盖到 bridge 初始化；重载窗口（命令面板或开发者工具 Ctrl+R）后再试。 |

---

## 验证

真实 Electron 端到端脚本会自起 Vite（:3000 已占用则复用）、用隔离 profile 启动 Electron、
等待控制 server，然后用 CLI 与 MCP 验证整条链路：

```bash
node control/test/e2e.mjs        # 或 npm run control:e2e
FOLIA_E2E_SKIP_PLAYBACK=1 node control/test/e2e.mjs   # 跳过需要账号/网络的播放用例
```

输出 `PASS / SKIP / FAIL` 清单，失败也清理 Electron/Vite；主进程与 Vite 日志在
`test-results/control-e2e/`。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| [`control/PROTOCOL.md`](PROTOCOL.md) | 协议与实现契约（唯一契约） |
| [`shared/controlCatalog.mjs`](../shared/controlCatalog.mjs) | 全部工具定义（唯一来源） |
| [`control/cli.mjs`](cli.mjs) | CLI |
| [`control/mcp.mjs`](mcp.mjs) | stdio MCP server |
| `control/test/e2e.mjs` | 真实 Electron 端到端验证：`node control/test/e2e.mjs` |
| [`src/control/`](../src/control/) | 渲染进程 bridge 与工具 handler |
| [`electron/controlServer.cjs`](../electron/controlServer.cjs) | Electron 主进程 HTTP / MCP server |
| [`docs/control-api.md`](../docs/control-api.md) | 二次开发说明 |
| [`skills/control-folia`](../skills/control-folia/SKILL.md) | 给 Agent 的精简操作手册 |

搜索结果的 VERSION 当前明确显示 unknown：现有 provider 规范没有可靠的原唱/翻唱字段，不根据标题或歌手猜测。新 bridge 的每个搜索结果带 `recordingVersion: "unknown"`；`--json` 保留服务端原始返回。
