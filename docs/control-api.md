# Folia Control API 二次开发说明

面向要在控制 API 上加工具、改实现、写测试的人。用户与 Agent 的使用文档在
[`control/README.md`](../control/README.md)，协议与实现契约在
[`control/PROTOCOL.md`](../control/PROTOCOL.md)，工具清单的唯一来源是
[`shared/controlCatalog.mjs`](../shared/controlCatalog.mjs)。

## 1. 三层实现

```
catalog（声明）
   │  工具名 / 分组 / 执行器 / summary / description / inputSchema / readOnly / destructive
   ├──────────────┬──────────────────────────┬──────────────────────────────┐
   ▼              ▼                          ▼                              ▼
renderer bridge  Electron main server       MCP（stdio / HTTP）            CLI
src/control/**   electron/controlServer.cjs control/mcp.mjs                control/cli.mjs
执行工具          传输 / 鉴权 / 转发 /       把 catalog 映射成 MCP tools；   把工具映射成子命令；
                 截图、退出两个主进程工具    调用 /invoke 或 CDP            一次一条命令
```

### 1.1 Renderer bridge（`src/control/`）

所有业务逻辑都在这里，运行在渲染进程（有 React、Zustand store、omni、命令面板上下文）。

- 挂载后安装 `window.__FOLIA_CONTROL__`（**始终安装**；server 是否启动是另一道开关）。
- `list()` 返回 catalog + 每个 palette 类工具的当前可用性。
- `state(args)` 一次取完整快照；`events(args)` 读事件环形缓冲（500 条，`seq` 从 1 单调递增）。
- `invoke(name, args)` 查 `handlers` 表执行工具，**永不抛异常**：成功
  `{ok:true,tool,data,durationMs,ts}`，失败 `{ok:false,tool,error:{code,message,details?},durationMs,ts}`。
- handler 按组放 `src/control/handlers/`，由 `src/control/registry.ts` 汇总成
  `Record<toolName, ControlHandler>`；handler 名必须与 catalog 完全一致。
- handler 需要的上下文来自 `ControlHost` 从 `App.tsx` 拿到的依赖
  （`src/control/controlHostDeps.ts`）：`CommandPaletteContext`、本地曲库、入队函数、播放本地歌函数。
  读 store 用 `useXStore.getState()`；写设置优先走 store action，不直接写 localStorage。
- palette 直通：查 `COMMAND_PALETTE_COMMANDS`，用 `isCommandPaletteCommandEnabled(command, context)`
  判断可用，再 `await command.execute(input ?? '', context)`；返回 false 映射为 `unavailable`。

### 1.2 Electron main server（`electron/controlServer.cjs`）

主进程只做四件事，不实现业务逻辑：

1. **传输**：HTTP 服务只监听 `127.0.0.1`，端口默认 `4567`（`FOLIA_CONTROL_PORT`），
   被占时依次 +1 到 +9。
2. **鉴权**：token 来自 `FOLIA_CONTROL_TOKEN` 或 `<userData>/control-token`
   （不存在则生成 32 字节 hex，权限 0600）。接受 `Authorization: Bearer`、
   `X-Folia-Token`、`?token=` 任一。
3. **转发**：`POST /invoke` → `win.webContents.executeJavaScript(...)` 调
   `window.__FOLIA_CONTROL__.invoke(name, args)`，30s 超时。
4. **两个主进程工具**：`folia_screenshot`（`webContents.capturePage()`）和
   `folia_quit`（`confirm:true` 后先回响应再退出）不转发。

启动时把 `{port, token, pid, startedAt, url}` 写入 `<userData>/control-server.json`（0600），
本机工具据此发现服务。`/health` 永远 200；视窗未就绪/销毁时 bridge 工具返回 503。
main 在 `will-quit` 调 `stop()`。

接入点在 `electron/main.cjs`：`app.whenReady()` 里首次 `createWindow()` 之后启动一次。
开关存在设置 store 里（「设置 → 连接与集成 → AI 控制」）；还没有存过时，由 `FOLIA_CONTROL=1`
或 `ELECTRON_DEV=true`（且 `FOLIA_CONTROL!=0`）决定初始值。preload 只新增三个控制开关的 IPC
（`control-get-status` / `control-set-enabled` / `control-regenerate-token`），不改动现有 IPC。

### 1.3 CLI / MCP 客户端（`control/`）

- `control/cli.mjs`：参数解析 + 子命令映射 + 人类可读输出（`--json` 输出原始 `data`），
  退出码 `0/1/2`。
- `control/mcp.mjs`：stdio MCP server，逐行 JSON-RPC 2.0；`tools/list` 从 catalog 生成，
  `tools/call` 走 HTTP `/invoke` 或 CDP。
- `control/lib/**`：HTTP 客户端、CDP 客户端、token/URL 解析、输出格式化等共用部分。
- 传输选择：默认 `auto`（先 HTTP，连不上退 CDP）；`--transport cdp` 时通过
  `GET <cdp>/json/list` 找页面目标，再 WebSocket `Runtime.evaluate` 调 bridge。

## 2. 请求生命周期

```
CLI/MCP 客户端
  │  1. 读取 --url / --token-file（或 --transport cdp）
  ▼
controlServer.cjs
  │  2. 校验 token → 404/405/400/401/503
  │  3. POST /invoke {name,args}
  │  4. 主进程工具？→ 直接执行并返回信封
  │     否则 executeJavaScript → window.__FOLIA_CONTROL__.invoke(name,args)
  ▼
renderer ControlHost
  │  5. 查 handlers[name]，校验参数（bad_request），执行
  │  6. 把 data / ControlError 包成信封，带 durationMs、ts
  ▼
客户端
  │  7. 收到信封（HTTP 始终 200）；CLI 按 ok 决定退出码，MCP 映射 content/isError
```

要点：

- **HTTP 状态码只表达传输层**：工具业务失败仍然是 `200` + `{ok:false}`；
  `503` 只表示窗口/bridge 不可用，`401` 鉴权失败，`400` JSON 解析失败，`404/405` 路由问题。
- **统一错误码**在 catalog 的 `CONTROL_ERROR_CODES`：`bad_request`、`unknown_tool`、
  `unavailable`、`not_ready`、`no_song`、`no_results`、`search_failed`、`playback_failed`、
  `unsupported`、`disabled`、`timeout`、`internal`。新增错误码先改 catalog 并跑测试。
- **参数校验在 handler 内**，不依赖调用方；schema 只是文档与 MCP 提示。
- 事件用环形缓冲 + 单调 `seq`；`folia_events` 的 `waitMs` 在 renderer 内 long-poll（上限 10s），
  HTTP 转发超时 30s 足够。

## 3. 如何新增一个工具

以新增 `folia_volume_boost`（在当前音量上叠加）为例。加一个工具是一个 **catalog → handler →
测试** 的闭环；CLI 的 `call`、MCP 的 `tools/list`、HTTP `/invoke` 会自动可见，只有“专属 CLI
子命令”需要额外改 `control/cli.mjs`。

### 第一步：在 catalog 里声明

`shared/controlCatalog.mjs` 是唯一来源。按现有工具的写法放进对应 group（没有合适 group 就新增，
并同步 `test/unit/control/catalog.test.ts` 的 `EXPECTED_GROUPS`）：

```js
{
    name: 'folia_volume_boost',
    title: 'Boost volume',
    group: 'playback',
    executor: 'bridge',
    summary: 'Raise the volume by a relative amount, clamped to 0-100.',
    description:
        'Adds `delta` to the current volume using the same setter as folia_volume. '
        + 'Returns the resulting level. Prefer folia_volume with `delta` when possible.',
    inputSchema: obj({
        delta: num('Relative volume change (-100..100).', { minimum: -100, maximum: 100 }),
    }, ['delta']),
},
```

约束（`catalog.test.ts` 会检查）：

- 名字 `folia_` 前缀、小写、下划线分段；全局唯一。
- `summary` 一句话；`description` 比 summary 长，写清楚何时用、和相邻工具的区别。
- `inputSchema` 必须是封闭对象：`type:'object'`、`additionalProperties:false`；`required` 的字段
  必须在 `properties` 里。
- `executor` 只可以是 `bridge` 或 `main`；只有确实必须主进程完成的才用 `main`。
- 只读工具标 `readOnly:true`；会不可逆地改数据/退出应用的标 `destructive:true`
  （`folia_queue_clear`、`folia_quit` 已标记，新增破坏性工具同样处理）。

### 第二步：在 renderer 写 handler

在 `src/control/handlers/` 对应组文件里实现，并在 `src/control/registry.ts` 注册
（键必须与 catalog 名一致）。handler 返回 `data`；参数不合法抛 `bad_request`：

```ts
// src/control/handlers/playback.ts
import { useAudioSettingsStore } from '../../stores/...';
import { ControlError } from '../errors';
import type { ControlHandler } from '../types';

export const volumeBoost: ControlHandler = (args) => {
    const delta = args?.delta;
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta < -100 || delta > 100) {
        throw new ControlError('bad_request', 'delta must be a number in -100..100');
    }
    const store = useAudioSettingsStore.getState();
    const next = Math.min(100, Math.max(0, store.volume + delta));
    store.setVolume(next); // 用 UI 同一个 action，保证持久化与副作用一致
    return { level: next, muted: useAudioSettingsStore.getState().muted };
};
```

```ts
// src/control/registry.ts（片段）
export const handlers: Record<string, ControlHandler> = {
    // ...
    folia_volume_boost: volumeBoost,
};
```

约定：

- 不新增第二套播放/设置逻辑：优先复用 store action、omni、命令面板命令。
- 需要“当前上下文”（视图、面板、provider）时从 `deps.context` 取，别在 handler 里重新推导。
- 失败用 `ControlError(code, message, details?)`；不要让异常逃出 `invoke`。
- 如果工具实际执行在 main（截图类），在 `electron/controlServer.cjs` 的 main 工具分支实现，
  不要伪造 bridge 工具。

### 第三步：加测试

1. `test/unit/control/catalog.test.ts` 自动覆盖新 catalog 条目的形状（名字、schema、required）。
2. 在 `test/unit/control/` 给 handler 加单测：正常路径、`bad_request`、依赖不可用时的
   `unavailable/not_ready`。handler 与 catalog 的一致性由测试断言（遍历 `CONTROL_TOOLS`
   检查每个名字都有 handler），新增工具不注册会失败。
3. 真实链路：`node control/test/e2e.mjs`（需要 Electron），或按 `control/PROTOCOL.md` §7 的
   手动命令跑一遍。

### 第四步：CLI / MCP 可见性

- **自动**：`folia call folia_volume_boost '{"delta":10}'`、MCP `tools/list` + `tools/call`、
  HTTP `POST /invoke` 立即支持。
- **专属子命令（可选）**：想让用户用 `folia boost 10`，在 `control/cli.mjs` 的命令表里加映射，
  并在 `control/README.md` 的命令表和 `control/test/e2e.mjs` 里补一条。MCP 描述直接来自
  catalog，不需要另写。

### 第五步：更新文档

- `control/README.md` 工具参考表（按 group 补一行）。
- `docs/control-api.md`（只有机制变化时才改）。
- 用户可见行为变化写进 README/skill；内部实现细节留在本文件。

## 4. 鉴权、端口与发现

| 项 | 规则 |
| --- | --- |
| 监听地址 | 只 `127.0.0.1`，不监听 `0.0.0.0` |
| 端口 | `FOLIA_CONTROL_PORT`，默认 `4567`；占用时 +1 到 +9；仍失败则警告并放弃 |
| token | `FOLIA_CONTROL_TOKEN` 或 `<userData>/control-token`；生成 32 字节 hex，0600 |
| 发现文件 | `<userData>/control-server.json`：`{port,token,pid,startedAt,url}`，0600 |
| 鉴权头 | `Authorization: Bearer <t>` / `X-Folia-Token` / `?token=` |

`<userData>` 是 `app.getPath('userData')`：macOS `~/Library/Application Support/Folia`，
Windows `%APPDATA%\Folia`，Linux `~/.config/Folia`（以实际启动日志为准）。

HTTP 路由（详见 `PROTOCOL.md` §3.1）：

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 否 | 存活探测，永远 200 |
| GET | `/tools` | 是 | catalog |
| GET | `/state?includeQueue=1&includeLyrics=1` | 是 | 状态快照 |
| GET | `/events?since=N&limit=N&waitMs=N` | 是 | 事件分页 |
| POST | `/invoke` | 是 | 执行工具 |
| POST | `/mcp` | 是 | MCP JSON-RPC（stateless） |
| GET | `/` | 否 | 纯文本用法 |

## 5. MCP 协议细节

### 5.1 stdio（`control/mcp.mjs`）

- 传输：stdin/stdout，UTF-8，**每行一个 JSON-RPC 消息**（不要 pretty print 到 stdout；
  日志走 stderr）。
- 实现方法：`initialize`、`notifications/initialized`（无响应）、`ping`、`tools/list`、
  `tools/call`、`resources/list`、`resources/read`（`folia://state`）、`logging/setLevel`（no-op）。
- `initialize`：接受客户端协议版本，回复 `2025-06-18`；
  `serverInfo: {name:'folia-control', version:'1.0.0'}`。
- `tools/list`：从 catalog 生成；`inputSchema` 原样传；附
  `annotations: {readOnlyHint, destructiveHint}`，catalog 里的每个工具都会出现。
- `tools/call` 结果映射：
  - 普通：`{content:[{type:'text',text: JSON.stringify(data,null,2)}], isError:false}`
  - 错误：`{content:[{type:'text',text:'<code>: <message>'}], isError:true}`
  - 截图：`{content:[{type:'image',data:<base64>,mimeType:'image/png'},
    {type:'text',text:'{"width":...,"height":...,"path":"..."}'}]}`
- 未知工具/方法返回 JSON-RPC error（`-32602` / `-32601`），进程不崩。

### 5.2 HTTP（Electron 内嵌 `/mcp`）

同一套方法，`POST` 单个 JSON-RPC 对象，`Content-Type: application/json` 回复；
`notifications/*` 返回 `202` 空 body；`GET /mcp` 返回 `405 + Allow: POST`；
stateless，不强制 `Mcp-Session-Id`，**不实现 SSE 流**。要求严格 streamable HTTP 的客户端
请改用 stdio。HTTP 端点额外提供 `folia://tools` 资源（catalog 快照）；stdio 只有 `folia://state`。

手写验证见 `control/README.md` 的 MCP 接入一节。

### 5.3 两个传输的差异

| 项 | stdio | HTTP |
| --- | --- | --- |
| 启动 | 客户端 spawn `node control/mcp.mjs` | Electron 内置，随 server 启动 |
| 鉴权 | 进程参数 `--url` + `--token-file` | 与 `/invoke` 相同（Bearer 等） |
| 会话 | 长驻进程 | stateless，每个请求独立 |
| SSE | 不需要 | 不实现 |
| 适用 | Claude Desktop/Code、本地 Agent | 简单脚本、无 stdio 的客户端 |

## 6. CDP 传输

Web 版或不想开控制 server 时，直接走 Chromium DevTools Protocol：

- `GET <cdp>/json/list`，选 `type === 'page'` 且 URL 含 `localhost:3000` / `127.0.0.1` / `file:`
  的目标；Electron 还会开 devtools 目标，必须过滤；`--target <url子串>` 可覆盖。
- Node 24 内置全局 `WebSocket`，连目标后调
  `Runtime.evaluate {expression, awaitPromise:true, returnByValue:true}`。
- 表达式：`window.__FOLIA_CONTROL__.invoke(<name>, <argsJson>)`。
- `list/state/events` 分别调 bridge 的 `list()`/`state(args)`/`events(args)`。
- 注意：CDP 模式绕过了 token 的服务端限制，仅用于本机调试与自动化。

## 7. 测试

```bash
npm run typecheck                       # 类型
npm run test:unit -- test/unit/control  # catalog / bridge / server 单测
node control/test/e2e.mjs               # 真实 Electron 端到端（自起 Vite + Electron）
```

`control/test/e2e.mjs` 的覆盖与约定：

- 隔离 profile：`test-results/control-e2e/userdata`（每次清空），启动 Electron 时带
  `FOLIA_CONTROL=1`、`ELECTRON_DEV=true`；自起 Vite（:3000 已被占用则复用）。
- 环境清理：从子进程 env 里删掉 `ELECTRON_RUN_AS_NODE`（agent/CI shell 可能带这个变量，
  会让 Electron 退化成 Node 并拒绝 Chromium 开关），并给测试实例加 `--no-sandbox`
  与 `--use-mock-keychain`（部分受限沙箱不允许 Chromium sandbox 初始化；mock keychain 避免
  与已在运行的同名 Folia 实例争用 macOS Keychain 而卡在系统弹窗；只影响这个隔离实例）。
  启动失败会重试一次，仍然失败时打印 `main.log` 尾部。
- 等待 `<userData>/control-server.json` 或 `/health`，从 json 读实际 `url`/`token`
  （端口可能不是 4567），再轮询 `/invoke` 直到 renderer bridge 就绪。
- 用 `node control/cli.mjs ... --url ... --token-file ...` 验证：`status`、`palette list`
  （命令数 >100）、`search`（结构化结果或结构化错误都算链路通过）、`volume 30` 回读、
  `visual set fume` 回读、`settings read` / `settings set audio.volume 40` 回读
  （写入 40，读回 store 原始值 0.4，按百分比比较）、`screenshot --out <临时文件>` 落盘、
  MCP `initialize` + `tools/list` + `tools/call`（HTTP 与 stdio 各一遍）。
- `FOLIA_E2E_SKIP_PLAYBACK=1` 跳过需要账号/网络的播放用例；失败也会清理 Electron/Vite。
- Playwright 的 `app.close()` 在主进程退出路径慢时可能挂住，脚本限时后直接结束自己启动的
  Electron 进程；不要依赖它判断应用是否干净退出。

## 8. 实现备注（bridge 已知行为）

这些是实现现状，写文档或加测试时按此对齐；改实现时同步更新本节与 `control/README.md`。

- **seek 走页面内的 `<audio>` 元素**：`folia_seek` / `folia_lyric_seek` 找到当前播放的 audio
  deck 后设 `currentTime`，并把 `motionSignals.currentTime` 同步到新位置；deck 暂停时会调用
  `play()` 恢复播放。没有挂载 audio deck 时返回 `unavailable`。
- **`folia_transport` 的 `stop`**：播放中先暂停；非 FM 模式再清空队列（FM 队列保留）。
  返回 `{action, playerState, queueCleared}`。
- **`folia_queue_move` 的任意 `to`**：命令面板上下文没有任意下标移动，handler 用
  `utils/queueReorder` 的纯变换重写队列并 `setPlayQueue`，不触发 App 队列操作的持久化副作用；
  `toNext` / `toEnd` 走 context 的现有 action。
- **歌词偏移**：`folia_lyric_offset` handler 允许 `ms` / `deltaMs` 在 ±60000ms 内；`scope:"global"`
  写入设置 store 后会被钳到 ±2000ms（设备级延迟补偿范围），读回以 store 值为准；`scope:"song"`
  调整当前曲目偏移。
- **`audio.volume` 的两套单位**：`folia_settings_write` 接受 0-1 或 0-100（>1 按百分比换算），
  `folia_settings_read` 返回 store 原始值（0-1）；`folia_volume` 的写入参数 `level` 用 0-100，
  读回 `{level: 0-1, percent: 0-100, muted}`。
- **命令面板 UI 状态**：`state.view.paletteOpen` 依赖 DOM 探测（没有专用 store）；断言面板是否
  真的执行了某条命令，用 `palette.executed` 事件或后续状态，而不是这个字段。
- **没有 eval 逃生口**：catalog 里不存在「执行任意 JS」的工具，`/invoke` 只调度 handler 表；
  需要新能力就加工具（catalog + handler + 测试），不要绕过。
- **搜索/播放的失败是结构化信封**：网络或账号问题返回 `search_failed` / `playback_failed`，
  stdout 仍可能为空，CLI 把错误写到 stderr（退出码 1）；脚本判断链路是否通不能只看退出码 0。

## 9. 约束清单（改实现前先看）

- catalog 是唯一来源；不要在 CLI/MCP 里手工复制工具列表。
- handler 名必须与 catalog 完全一致；测试会断言，不一致时先改实现而不是改测试。
- 工具永远 resolve 成信封，不抛异常；HTTP 业务失败保持 200。
- 新增 `/invoke` 之外的写入口等于新增攻击面：控制 API 等同本机用户权限，默认关闭、只绑
  回环、token 0600 这三条不能退。
- 主进程不新增业务逻辑；能转发到 renderer 的就转发。
- 不改 `electron/preload.cjs` 暴露面（转发走 `executeJavaScript`）。
- 文档里的命令必须能直接跑；改 CLI 参数时同步 `control/README.md` 和
  `skills/control-folia/SKILL.md`。
