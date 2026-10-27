---
name: control-folia
description: 用 CLI / MCP / HTTP 控制正在运行的 Folia（搜歌、播放、队列、音量、歌词、歌词动画与背景、主题、设置、截图、事件流），或在自动化里验证控制链路。适用于要求“帮我在 Folia 里搜/播一首歌”“切到某个歌词动画”“调音量/主题”“截图看看界面”“监听播放事件”这类任务，也用于排查 control server 连不上、token 401、bridge not_ready 等问题。
---

# Control Folia

Folia 的控制 API 把应用能力暴露成 46 个工具（catalog 在 `shared/controlCatalog.mjs`）。三条入口：

- **CLI**：`node control/cli.mjs <command>`，一次一条命令，适合 agent 分步执行。
- **MCP**：`node control/mcp.mjs`（stdio），或 Electron 内嵌 `POST /mcp`（stateless JSON-RPC）。
- **HTTP**：`POST /invoke`，body `{"name":"folia_volume","args":{"level":30}}`。

工具永远返回统一信封：失败也 resolve 成 `{ok:false,error:{code,message}}`，不抛异常；
CLI 以退出码 1 表示控制失败、2 表示连接失败。

完整命令表、MCP 配置 JSON、工具参考见 [`control/README.md`](../../control/README.md)；
协议与实现契约见 [`control/PROTOCOL.md`](../../control/PROTOCOL.md)。

## 触发条件

- 用户要求操作正在运行的 Folia：搜歌、播放/暂停、下一首、音量、队列、歌词偏移、
  切歌词动画/背景/主题、改设置、截图、监听事件。
- 需要把 Folia 接进 MCP 客户端（Claude Desktop/Claude Code/Cursor）。
- 要验证 control 链路：`node control/test/e2e.mjs`，或手动跑 CLI / `/health` / `/invoke`。
- 排查：连不上、401、`bridge not_ready`、`unknown_tool`、`disabled`、端口不是 4567。

不要用它做：仓库代码修改、发布流程、在线平台接入开发（那些有各自的 skill）。

## 启动与连接

控制 server **默认关闭**，且只监听 `127.0.0.1`。

```bash
# 开发模式（Vite + Electron），控制 server 随 ELECTRON_DEV 自动启动
FOLIA_CONTROL=1 npm run dev:electron
```

打包版默认关闭，推荐在「设置 → 连接与集成 → AI 控制」里打开（选择会持久化）。也可以在启动应用前注入环境变量，例如 macOS：

```bash
FOLIA_CONTROL=1 /Applications/Folia.app/Contents/MacOS/Folia
```

连接信息从 `<userData>/control-server.json` 读（含 `url`、`token`、`port`），
启动日志也有 `[Control] server ready url=... token-file=<path>`：

```bash
# macOS；目录名以日志为准（打包版通常是 Folia）
TOKEN_FILE="$HOME/Library/Application Support/Folia/control-token"
URL="http://127.0.0.1:4567"

folia() { node control/cli.mjs "$@" --url "$URL" --token-file "$TOKEN_FILE"; }
folia doctor    # /health + /tools + 环境自检；先跑这个
```

端口 4567 被占时 server 会自动 +1（最多 +9）。**不要写死端口**，以
`control-server.json` 或启动日志为准。

Web 版没有主进程，改用 CDP：

```bash
node control/cli.mjs status --transport cdp --cdp http://127.0.0.1:9222
```

（浏览器需以 `--remote-debugging-port=9222` 启动，且页面里已安装 bridge。）

## 工具速查

按组列出最常用工具；全部 46 个见 `control/README.md` 的工具参考表。

| 想做的事 | 工具 / CLI |
| --- | --- |
| 连接自检、看状态 | `folia status`、`folia state`、`folia tools`、`folia doctor` |
| 搜歌 | `folia search "<q>" --limit 5 --json` → `folia_search` |
| 播放 | `folia play "<q>"`；`folia play --provider <provider> --id <id>`；会话恢复用 `folia resume` |
| 传输 | `folia pause/resume/toggle/next/prev/stop` → `folia_transport` |
| 跳转/音量/静音 | `folia seek 90`、`folia seek 50%`、`folia volume 35`、`folia mute on` |
| 循环/随机/喜欢/定时关闭 | `folia loop one`、`folia shuffle`、`folia like`、`folia sleep 30` |
| 队列 | `folia queue`、`queue play <i>`、`queue add "<q>"`、`queue remove <i>`、`queue move <from> <to>`、`queue clear` |
| 歌词 | `folia lyrics --lines`、`lyrics offset 200`、`lyrics seek 12` |
| 歌词动画/背景 | `folia visual list`、`visual set fume`、`visual bg monet`、`visual tune monet '<json>'` |
| 主题/外观 | `folia theme`、`theme day/night/system/cover/static`、`theme ai` |
| 设置 | `folia settings audio volume --json`、`settings set audio.volume 40`、`settings open appearance` |
| 导航/侧栏/提示 | `folia nav player`、`folia panel queue`、`folia toast "..."` |
| 本地库/平台 | `folia library list`、`folia library search "<q>"`、`folia providers` |
| 窗口/截图 | `folia window fullscreen`、`folia screenshot --out /tmp/folia.png` |
| 事件 | `folia events --json`、`folia events --watch` |
| 任意工具/逃生口 | `folia call <tool> '<json>'`；`folia eval '<expr>' --allow-eval` |
| 退出 | `folia quit --yes` |

命令面板是能力最宽的一层（125+ 条）：`folia palette list --json` 找 id，
`folia palette run <id> [input]` 执行。catalog 没覆盖的动作优先在这里找。

## 常用工作流

### 搜歌 → 播放 → 调音量

```bash
folia status --json                    # 1. 确认连上，记下当前 provider
folia providers --json                 # 2. 看平台是否可用/已登录
folia search "周杰伦 晴天" --provider netease --limit 5 --json   # 3. 取结构化结果
folia play --provider netease --id 123456                 # 4. 播放（或 folia play "周杰伦 晴天"）
folia volume 35                        # 5. 调音量
folia volume --json                    # 6. 回读确认 level=35
```

### 切视觉与主题

```bash
folia visual list --json               # 可用动画/背景 id（含模组项）
folia visual set fume
folia visual bg monet
folia theme night
folia state --json                     # 回读 visualizer.mode / background / theme
```

### 截图自检

```bash
folia screenshot --out /tmp/folia-check.png
```

截完要看图；窗口最小化/隐藏时内容可能不是你想要的，先 `folia window status` 确认。

### 监听事件

```bash
folia events --json        # since 省略 = 从缓冲区末尾开始，拿 cursor
folia events --watch       # 持续跟随；Ctrl+C 结束
```

先取 cursor 再执行动作，避免漏事件。常见类型：`playback.songChanged`、
`playback.stateChanged`、`playback.volumeChanged`、`visualizer.modeChanged`、
`theme.changed`、`view.changed`、`palette.executed`。

### MCP 客户端接入

stdio（推荐）：

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

HTTP（Electron 内嵌）：

```json
{
  "mcpServers": {
    "folia-http": {
      "type": "http",
      "url": "http://127.0.0.1:4567/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### 链路验证

```bash
node control/test/e2e.mjs                              # 或 npm run control:e2e
FOLIA_E2E_SKIP_PLAYBACK=1 node control/test/e2e.mjs    # 跳过需要账号/网络的播放用例
```

会自起 Vite + Electron（隔离 profile）、等待控制端口、用 CLI 验证 status / palette /
search / volume / visualizer / settings / screenshot，再验 MCP initialize + tools/list +
tools/call，最后打印 PASS/FAIL 并清理进程。

## 注意

- **控制 API 等同本机用户权限**，只在可信机器开启；不要把 127.0.0.1 端口转发出去。
- **token 不要进 shell 历史**：用 `--token-file`，不要 `--token $(cat …)` 回显。
- `folia_eval` 默认禁用；门控分两处：HTTP 执行要求拉起 Folia 时设 `FOLIA_CONTROL_ALLOW_EVAL=1`，
  CLI 的 `eval` / MCP stdio 还要客户端侧 `--allow-eval`。CDP 模式绕过 server 检查，只建议本机调试。
- `folia_transport stop` = 暂停；非 FM 模式还会清空队列。`folia_seek` 走页面内 audio 元素，
  暂停时会恢复播放。
- `settings set audio.volume 40` 写入可用百分比，读回是 store 原始值 `0.4`（0-1）。
  全局歌词偏移会被应用钳到 ±2000ms。
- `folia_palette_run`、`folia_settings_write`、`folia_quit` 高权限：只在用户明确要求时调用；
  `folia_quit` 必须 `--yes`（工具层 `confirm:true`）。
- 在线歌曲搜索/播放需要对应平台网络与账号；搜索返回 `search_failed` 不代表控制链路坏了。
- `--json` 打印原始 data，适合脚本；失败时看退出码和 stderr 里的错误码。
- 不要改 `src/control/**`、`electron/controlServer.cjs`、`control/cli.mjs` 等实现来“让命令通过”；
  发现 bug 先报告，再按 `control/README.md` 的故障排查定位。
- 跑 e2e 会占用 :3000（Vite）与 :4567 起（控制 server），先关掉已有的 dev 实例；
  已有实例时脚本会复用 Vite 但使用自己的隔离 profile。
