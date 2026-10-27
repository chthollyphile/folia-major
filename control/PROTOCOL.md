# Folia Control API — 协议与实现契约（v1）

本文是本次二次开发的**唯一契约**。能力清单在 [`shared/controlCatalog.mjs`](../shared/controlCatalog.mjs)，
协议形状在本文；四个实现部分必须按本文对齐，改动契约先改本文与 catalog。

目标：让外部 AI Agent（MCP / CLI / 直接 HTTP）能完整控制 Folia：搜歌、放歌、传输控制、音量、队列、
歌词、歌词动画与背景、主题外观、设置、本地库、窗口、截图、事件流。

---

## 1. 总体架构

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

设计原则：

1. **一个执行器**：所有业务逻辑在 renderer 的 bridge 里，main 只做传输、鉴权、转发和两个
   必须主进程完成的工具（`folia_screenshot` / `folia_quit`）。
2. **复用现有能力**：命令面板 registry、Zustand store 的 action、omni、Folium host actions。
   不新增第二套播放/设置逻辑。
3. **默认关闭、按需开启**：开关持久化在设置 store（「设置 → 连接与集成 → AI 控制」）。还没有
   存过时，`FOLIA_CONTROL=1` 或开发模式（且未被 `FOLIA_CONTROL=0` 关闭）决定初始值。
4. **能力可枚举**：catalog 是工具的唯一来源，CLI、MCP、bridge 都从它生成，测试保证 handler
   与 catalog 一致。

---

## 2. In-app bridge 契约

bridge 在 renderer 挂载后安装为 `window.__FOLIA_CONTROL__`（**始终安装**；server 是否启动是另一道开关）。

```ts
type ControlBridge = {
    version: 1;
    app: { name: 'Folia'; version: string; platform: string; isElectron: boolean; installedAt: number };
    ready: true;
    /** catalog 原样 + 每个工具的当前可用性（palette 类工具） */
    list(): ControlToolMeta[];
    /** 一次取完整状态快照，参数见 folia_state */
    state(args?: { includeQueue?: boolean; includeLyrics?: boolean; includeProviders?: boolean }): ControlStateSnapshot;
    /** 执行一个工具，永不抛异常：失败也 resolve 成 ok:false 信封 */
    invoke(name: string, args?: Record<string, unknown>): Promise<ControlResult>;
    /** 事件分页读取（since 省略 = 从当前末尾开始） */
    events(args?: { since?: number; limit?: number; waitMs?: number }): Promise<{ cursor: number; events: ControlEvent[] }>;
    /** 内部诊断 */
    info(): { installedAt: number; toolCount: number; versions: { app: string; catalog: 1 } };
};
```

### 2.1 统一信封

```jsonc
// 成功
{ "ok": true, "tool": "folia_volume", "data": { "level": 0.35, "muted": false },
  "durationMs": 3, "ts": 1720000000000 }

// 失败（不抛异常，HTTP 仍为 200；CLI 以退出码 1 结束）
{ "ok": false, "tool": "folia_play", 
  "error": { "code": "no_song", "message": "…", "details": { } },
  "durationMs": 2, "ts": 1720000000000 }
```

错误码见 `CONTROL_ERROR_CODES`。`bad_request` 用于参数校验失败（handler 必须校验，不依赖调用方）。

### 2.2 状态快照（`folia_state` / `/state`）

```ts
type ControlStateSnapshot = {
    app: { version: string; platform: string; isElectron: boolean; controlVersion: 1 };
    view: { view: 'home' | 'player' | 'lattice'; panelOpen: boolean; panelTab: string | null;
            settingsOpen: boolean; paletteOpen: boolean };
    playback: {
        state: 'playing' | 'paused' | 'idle';
        isLoadingToPlay: boolean;
        isFmMode: boolean;
        song: ControlSongSummary | null;
        positionSeconds: number;      // 来自 motionSignals.currentTime
        durationSeconds: number;
        queueLength: number;
        currentQueueIndex: number;    // -1 = 不在队列中
        replayGainMode: 'off' | 'track' | 'album';
        lyricOffsetMs: number;
        liked: boolean | null;        // null = 当前平台不支持/未登录
    };
    volume: { level: number; percent: number; muted: boolean; loopMode: 'off' | 'all' | 'one' };
    visualizer: { mode: string; background: string | null; randomPerSong: boolean;
                  smartBeatEnabled: boolean; glowBlurQuantize: boolean; frameRate: string | number };
    theme: { daylight: boolean; followSystemTheme: boolean; coverColorBg: boolean;
             staticMode: boolean; disableHomeDynamicBackground: boolean };
    lyrics: {
        available: boolean; format: string | null; lineCount: number;
        currentLineIndex: number; offsetMs: number; globalOffsetMs: number;
        currentLine: { index: number; startTime: number; endTime: number; text: string } | null;
        lines?: Array<{ index: number; startTime: number; endTime: number; text: string }>; // includeLyrics
    };
    providers: Array<{ id: string; displayName: string; status: string; requiresAccount: boolean }>;
    queue?: { items: Array<{ index: number; song: ControlSongSummary }>; total: number }; // includeQueue
};

type ControlSongSummary = {
    id: string | null; title: string; artist: string; artists: string[];
    album: string | null; durationMs: number;
    providerId: string | null; mediaId: string | null; isLocal: boolean;
};
```

### 2.3 事件

环形缓冲 500 条，`seq` 单调递增，从 1 开始。

```ts
type ControlEvent = { seq: number; ts: number; type: ControlEventType; data: Record<string, unknown> };
// type 取值见 shared/controlCatalog.mjs 的 CONTROL_EVENT_TYPES
```

`folia_events` 的 `waitMs` 在 renderer 内 long-poll（最多 10s），有新事件或超时返回。
`since` 省略时返回 `cursor = 当前 seq`、`events = []`。

### 2.4 handler 约定

- 全部放 `src/control/handlers/`，按组拆文件，并由 `src/control/registry.ts` 汇总为
  `Record<toolName, ControlHandler>`。
- `ControlHandler = (args, deps) => Promise<unknown> | unknown`，返回 `data`；抛
  `ControlError(code, message, details)` 映射为失败信封。
- handler 名必须与 catalog 完全一致（测试断言）。
- 取上下文：`deps.context` 为最近一次渲染的 `CommandPaletteContext`（host 用 ref 保活）。
- 直接读 store 用 `useXStore.getState()`；写设置优先走 store action，不直接写 localStorage。

`ControlHost` 需要从 App 拿到的依赖（`src/control/controlHostDeps.ts`）：

```ts
type ControlHostDeps = {
    context: CommandPaletteContext;       // useCommandPaletteContext() 的产物
    localSongs: LocalSong[];              // App 的本地库
    enqueue: (songs: SongResult[]) => void;        // App 的 addOnlineSongsToQueue
    playLocalSong: (song: LocalSong) => Promise<void>; // App 的 onPlayLocalSong
};
```

### 2.5 palette 直通

`folia_palette_run` 直接查 `COMMAND_PALETTE_COMMANDS`，用
`isCommandPaletteCommandEnabled(command, context)` 判可用，然后
`await command.execute(input ?? '', context)`。**不要**用 `commandPalette.invokeCommandById`：
它会给 surface 命令打开 UI 且不接受 input。结果 `{ ok: boolean }`；返回 false 视为 `unavailable`。

---

## 3. Electron control server 契约

文件：`electron/controlServer.cjs`（CommonJS，无新依赖）。导出：

```ts
startControlServer(opts: {
    app: Electron.App;
    getWindow: () => Electron.BrowserWindow | null;
    dataDir?: string;              // 默认 app.getPath('userData')
}): { url: string; port: number; token: string; stop: () => Promise<void> };
```

- 监听 **127.0.0.1**，不监听 0.0.0.0。
- 端口：`FOLIA_CONTROL_PORT`，默认 `4567`；被占用时依次尝试 +1 直到 +9，仍失败则打印警告并返回 null。
- token：`FOLIA_CONTROL_TOKEN` 或 `<userData>/control-token`（不存在则生成 32 字节 hex，mode 0600）。
- 同时在 `<userData>/control-server.json` 写入 `{ port, token, pid, startedAt, url }`（0600），便于本机工具发现。
- 启动日志（仅本地）：`[Control] server ready url=http://127.0.0.1:4567 token-file=<path>`。
- 关闭：`stop()` 关 server；main 在 `will-quit` 调用。
- 视窗未就绪/已销毁：bridge 工具返回 `not_ready`/`unavailable`，HTTP 503；`/health` 永远 200。
- 转发实现：

```js
const code = `(async () => {
  const bridge = window.__FOLIA_CONTROL__;
  if (!bridge || bridge.version !== 1) throw new Error('bridge not installed');
  return await bridge.invoke(${JSON.stringify(name)}, ${JSON.stringify(args ?? {})});
})()`;
const result = await win.webContents.executeJavaScript(code, true);
```

带 30s 超时；`folia_events` 的 waitMs 上限 10s，所以 15s 足够。`folia_screenshot` /
`folia_quit` 由 main 自己处理，不转发。

### 3.1 HTTP 路由

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 否 | `{ ok:true, app:'folia', version, controlApiVersion:1, pid, port }` |
| GET | `/tools` | 是 | `{ ok:true, tools:<catalog> }` |
| GET | `/state?includeQueue=1&includeLyrics=1` | 是 | `{ ok:true, data:<snapshot> }` |
| GET | `/events?since=N&limit=N&waitMs=N` | 是 | `{ ok:true, data:{cursor,events} }` |
| POST | `/invoke` | 是 | body `{ "name": "...", "args": {...} }` → 统一信封 |
| POST | `/mcp` | 是 | MCP JSON-RPC（见 §4） |
| GET | `/` | 否 | 纯文本用法说明 |

鉴权：`Authorization: Bearer <token>`、`X-Folia-Token: <token>` 或 `?token=` 任一。
失败：`401 { ok:false, error:{ code:'unauthorized', message:'...' } }`。
未知路由 404，方法不对 405。请求体上限 1MB，JSON 解析失败 400。

### 3.2 主进程工具

- `folia_screenshot` `{ save?: boolean=true, path?: string }` →
  `{ base64, mimeType:'image/png', width, height, path?: string }`。
  默认保存到 `<userData>/control-screenshots/<ISO时间>.png`，并把绝对路径放进 `path`。
  用 `win.webContents.capturePage()`。
- `folia_quit` `{ confirm: true }` → `{ quitting: true }`，先回响应再 `app.quit()`（100ms）。
  `confirm !== true` → `bad_request`。

### 3.3 main.cjs 接入点

在 `app.whenReady()` 里 **首次 `createWindow()` 之后** 启动一次：

```js
let controlServer = null;
const controlServerSettings = require('./controlServer.cjs');
if (controlServerSettings.isControlServerEnabled(store)) {
    controlServer = await startControlServerInstance();
}
app.on('will-quit', () => { void controlServer?.stop?.(); });
```

`isControlServerEnabled(store)` 先读持久化开关；没有存过时回退到
`FOLIA_CONTROL=1` 或 `ELECTRON_DEV=true`（且 `FOLIA_CONTROL!=0`）。设置页通过
`control-set-enabled` 写开关并即时启停，`control-regenerate-token` 换令牌后重启实例。

不改 preload（转发走 `executeJavaScript`），不动现有 IPC。`controlServer` 为 null 时
`controlServer?.stop?.()` 安全。

---

## 4. MCP 契约

### 4.1 stdio（`control/mcp.mjs`）

- 逐行 JSON-RPC 2.0（stdin/stdout，UTF-8，每行一个消息）。
- 实现：`initialize`、`notifications/initialized`（无响应）、`ping`、`tools/list`、`tools/call`、
  `resources/list`、`resources/read`（`folia://state`）、`logging/setLevel`（no-op）。
- `protocolVersion` 接受客户端值，回复 `2025-06-18`；`serverInfo: { name:'folia-control', version:'1.0.0' }`。
- `tools/list` 从 catalog 生成（`folia_eval` 仅在 `--allow-eval` 时出现），schema 原样传
  `inputSchema`，并附 `annotations: { readOnlyHint, destructiveHint }`。
- `tools/call` → 通过 transport 调 `/invoke`（或 CDP evaluate）→ MCP 结果：
  - 普通：`{ content:[{ type:'text', text: JSON.stringify(data, null, 2) }], isError:false }`
  - 错误：`{ content:[{ type:'text', text: "<code>: <message>" }], isError:true }`
  - 截图：`{ content:[{ type:'image', data:<base64>, mimeType:'image/png' },
    { type:'text', text:'{"width":...,"height":...,"path":"..."}' }] }`
- 未知工具/方法返回 JSON-RPC error（-32602 / -32601），不崩进程。

### 4.2 HTTP（Electron 内嵌 `/mcp`）

同一套方法，POST 单个 JSON-RPC 对象，`Content-Type: application/json` 回复。
`notifications/*` 返回 202 空 body。stateless，不强制 `Mcp-Session-Id`。
`GET /mcp` 返回 405 + `Allow: POST`（不实现 SSE 流）。

---

## 5. CLI 契约（`control/`）

```
folia <command> [args] [options]

连接：
  --url <http://127.0.0.1:4567>   --token <t>   --token-file <path>
  --transport http|cdp|auto（默认 auto：先 HTTP，失败后 CDP）
  --cdp <http://127.0.0.1:9222>   --json   --timeout <ms>   --allow-eval
```

命令映射（全部最终调用 catalog 工具）：

| 命令 | 工具 |
|---|---|
| `folia status` / `state` / `tools` | folia_status / folia_state / folia_tools |
| `folia search <q>` | folia_search（--provider/--source/--limit/--offset） |
| `folia play <q>` / `folia play --provider <provider> --id <id>` | folia_play_search / folia_play |
| `folia pause` `resume` `toggle` `next` `prev` `stop` | folia_transport |
| `folia seek <sec|%>` | folia_seek |
| `folia volume [level]` `mute [on|off]` | folia_volume |
| `folia loop [off|all|one]` `shuffle` `like` | folia_loop / folia_shuffle / folia_like |
| `folia sleep [minutes]` `--cancel` `--status` | folia_sleep_timer |
| `folia queue [list]` `queue play <i>` `queue add <q>` `queue remove <i...>` `queue move <from> <to>` `queue clear` | folia_queue* |
| `folia lyrics [--lines]` `lyrics offset <ms>` `lyrics seek <line>` | folia_lyrics / folia_lyric_offset / folia_lyric_seek |
| `folia visual list` / `visual set <mode>` / `visual bg <mode>` / `visual tune <target> <json>` | folia_visualizer_list / folia_visualizer_set / folia_background_set / folia_visual_tuning |
| `folia smartbeat [on|off]` `visual video [on|off]` | folia_smart_beat / folia_video_layer |
| `folia theme` `theme day|night|system|cover|static` `theme ai` | folia_appearance |
| `folia settings [store] [key]` / `settings set <key> <value>` / `settings open [subview]` | folia_settings_read/write/open |
| `folia nav <home|player|lattice>` `panel <tab>` `palette` | folia_navigate / folia_panel / folia_palette_ui |
| `folia library list|search <q>|play <id>` | folia_library |
| `folia providers` | folia_providers |
| `folia screenshot [--out f]` | folia_screenshot |
| `folia window status|minimize|maximize|fullscreen|on-top [on|off]|click-through [on|off]|close` | folia_window |
| `folia events [--watch] [--since N]` | folia_events |
| `folia toast <text>` | folia_toast |
| `folia palette list [--all]` / `palette run <id> [input]` | folia_palette_list / folia_palette_run |
| `folia call <tool> '<json>'` | 任意工具 |
| `folia eval '<expr>'` | folia_eval（需 --allow-eval） |
| `folia quit --yes` | folia_quit |
| `folia mcp` | stdio MCP server |
| `folia doctor` | /health + /tools + 环境自检 |

输出：默认人类可读（表格/一行结论）；`--json` 输出原始 `data`。
退出码：0 成功；1 控制失败；2 连接失败/用法错误。

MCP stdio 启动方式：`node control/mcp.mjs --url ... --token-file ...`，或 `folia mcp ...`。
也可 `--transport cdp` 直连 `--remote-debugging-port=9222` 的 Electron/Chrome。

### 5.1 CDP 传输

- `GET <cdp>/json/list` 找 `type==='page'` 且 url 含 `localhost:3000` / `127.0.0.1` / `file:` 的目标；
  Electron 还会开 devtools 目标，必须过滤。可 `--target <url-substring>` 覆盖。
- WebSocket（Node 24 内置全局 `WebSocket`）→ `Runtime.evaluate`
  `{ expression, awaitPromise:true, returnByValue:true }`。
- 表达式：`window.__FOLIA_CONTROL__.invoke(<name>, <argsJson>)`。
- CDP 模式下 `list/state/events` 分别调 bridge 的 `list()/state(args)/events(args)`。

---

## 6. 文件归属与写入边界（团队协作）

| 归属 | 写入范围 |
|---|---|
| Lead | `shared/controlCatalog.mjs`、`control/PROTOCOL.md`、`src/App.tsx`、`electron/main.cjs` 集成、最终修复 |
| bridge | `src/control/**`、`test/unit/control/bridge*.test.ts` |
| server | `electron/controlServer.cjs`、`electron/main.cjs`、`test/unit/control/controlServer.test.mjs` |
| cli-mcp | `control/cli.mjs`、`control/mcp.mjs`、`control/lib/**`、`control/package.json` |
| qa-docs | `control/README.md`、`control/test/**`、`skills/control-folia/**`、`docs/control-api.md`、`README.md`、`AGENTS.md` |

（`electron/main.cjs` 由 server 队友改，Lead 审查；`src/App.tsx` 只由 Lead 改。）

---

## 7. 验证

```bash
# 1) 静态
npm run typecheck
npm run test:unit -- test/unit/control

# 2) 真实 Electron（driver 用隔离 profile）
FOLIA_CONTROL=1 node skills/run-desktop/driver.mjs serve          # 后台
node control/cli.mjs status --url http://127.0.0.1:4567 \
  --token-file test-results/run-desktop/userdata/control-token
node control/cli.mjs palette list --json | head
node control/cli.mjs volume 30
node control/cli.mjs visual set fume
node control/cli.mjs screenshot --out /tmp/folia.png

# 3) MCP
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  | node control/mcp.mjs --url http://127.0.0.1:4567 --token-file test-results/run-desktop/userdata/control-token
```

E2E 脚本：`control/test/e2e.mjs`（qa-docs 负责），必须覆盖：
status、palette list、search(可跳过网络断言但必须返回结构化结果)、volume 写入回读、
visualizer set 回读、settings read/write、screenshot 落盘、MCP initialize + tools/list + tools/call。

---

## 8. 安全

- server 只绑 127.0.0.1；token 随机 0600；不把 token 写进 renderer 日志。
- `folia_eval`、`folia_palette_run`、`folia_settings_write`、`folia_quit` 视为高权限；
  `folia_eval` 必须服务端 `--allow-eval` / `FOLIA_CONTROL_ALLOW_EVAL=1` 才可用（bridge 返回 `disabled` 由 server 判定）。
- `folia_quit` 必须 `confirm:true`。
- 文档明确：控制 server 等同于本机用户权限，勿在不可信机器开启。

## Search metadata and recording versions

`folia_search.items[]` adds `recordingVersion: "unknown"`. Current normalized provider contracts have no verified original/cover field. This status is not inferred from title, artist, album, aliases or cover art. The human CLI shows unknown for older servers too; raw JSON is unchanged. Online `play --id` requires a nonempty explicit `--provider` before configuration or transport work. Local IDs use `library play`.
