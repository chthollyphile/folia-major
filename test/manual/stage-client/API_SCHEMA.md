# Stage API 请求与响应 Schema

本文档描述桌面端本地 Stage API 的 HTTP / WebSocket 契约。默认服务地址为 `http://127.0.0.1:32107`，实际端口以 Folia 设置中的 Stage 端口为准。

## 通用约定

- 除 `GET /stage/health` 外，所有 HTTP 接口都需要 `Authorization: Bearer <token>`。会话封面（`GET /stage/media/session/<id>/cover` 等媒体地址）也不需要，页面直接用 `<img>` 读。
- 本机程序不必让用户复制 token：Stage API 开着时，Folia 把地址和 token 写进连接文件（见下面「连接文件」），关掉、退出时删掉，重新生成 token 时改写。
- `WS /stage/player/ws` 支持 `Authorization: Bearer <token>`，也支持 `?token=<token>`。
- HTTP JSON 请求请使用 `Content-Type: application/json`。
- `POST /stage/session` 支持 `application/json` 和 `multipart/form-data`。
- 时间字段如 `positionMs`、`durationMs`、`sampledAtMs`、`updatedAt` 均为毫秒；其中 `sampledAtMs`、`updatedAt` 是 Unix epoch 毫秒。
- HTTP 错误通常返回 `ErrorPayload`。少数基础拒绝路径只返回 `{ "error": string }`，例如未授权、Stage 未启用或路由不存在。

```ts
type StageSource = 'stage-api' | 'now-playing';
type StageActiveEntryKind = 'lyrics' | 'media';
type PlayerState = 'IDLE' | 'PLAYING' | 'PAUSED';
type StagePlayerPlaybackContext =
  | 'normal-playback'
  | 'stage-session'
  | 'external-playback-source';

interface ErrorPayload {
  error: string;
  code?: string;
  details?: Record<string, unknown> | null;
}

interface StageInputMetadata {
  domain: 'stage-input';
  direction: 'outside-in';
}

interface StagePlayerInsideOutMetadata {
  domain: 'player-playback';
  direction: 'inside-out';
}

interface StagePlayerOutsideInMetadata {
  domain: 'player-playback';
  direction: 'outside-in';
}
```

## 公共对象

### StageStatus

`GET /stage/status`、`POST /stage/lyrics`、`POST /stage/session`、`DELETE /stage/state` 都返回该对象。

```ts
interface StageStatus extends StageInputMetadata {
  enabled: boolean;
  modeEnabled: boolean;
  source: StageSource | null;
  port: number;
  token: string | null;
  activeEntryKind: StageActiveEntryKind | null;
  lyricsSession: StageLyricsSession | null;
  mediaSession: StageMediaSession | null;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | `boolean` | Stage API 服务是否启用。 |
| `modeEnabled` | `boolean` | Folia 舞台模式是否启用。 |
| `source` | `StageSource \| null` | 当前舞台输入来源；未启用舞台模式时为 `null`。 |
| `port` | `number` | 当前 Stage API 端口。 |
| `token` | `string \| null` | 当前 Bearer token。 |
| `activeEntryKind` | `'lyrics' \| 'media' \| null` | 当前外部注入的是歌词、媒体会话，还是空状态。 |
| `lyricsSession` | `StageLyricsSession \| null` | 当前歌词会话。 |
| `mediaSession` | `StageMediaSession \| null` | 当前媒体会话。 |

### StageLyricsSession

```ts
interface StageLyricsSession {
  title?: string;
  artist?: string;
  album?: string;
  lyricSource?: StageLyricSource;
  durationMs?: number;
  coverUrl?: string;
  clock?: StageLyricsClock;
  updatedAt: number;
}

interface StageLyricsClock {
  positionMs: number;
  paused: boolean;
  sampledAtMs: number;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` 可选 | 歌名。 |
| `artist` | `string` 可选 | 艺术家。 |
| `album` | `string` 可选 | 专辑。 |
| `lyricSource` | `StageLyricSource` 可选 | parser-compatible 歌词来源对象。没有时只显示曲目（歌名、歌手、封面、进度），不显示歌词。 |
| `durationMs` | `number` 可选 | 曲目长度。 |
| `coverUrl` | `string` 可选 | 封面地址：请求里给的 http(s) 地址，或上传的封面由本服务发出的地址。 |
| `clock` | `StageLyricsClock` 可选 | 外部播放器的时钟：`positionMs` 是它报的位置，`sampledAtMs` 是服务端收到的时刻；没暂停时 Folia 从这一刻往前推。 |
| `updatedAt` | `number` | 服务端写入时间，也是这个会话的标识（`POST /stage/lyrics/clock` 的 `sessionUpdatedAt`）。 |

有 `clock` 的会话按外部播放器的时间走：从 0 起算到 `durationMs`（没给长度时不设上限），播完停在末尾，不按 Folia 的循环模式重放；没有 `clock` 的会话照旧从第一句歌词放到最后一句。

### StageLyricSource

```ts
type StageLyricSource =
  | StageLocalLyricSource
  | StageEmbeddedLyricSource
  | StageNavidromeLyricSource
  | StageNeteaseLyricSource
  | StageQrcLyricSource;

interface StageLocalLyricSource {
  type: 'local';
  lrcContent: string;
  tLrcContent?: string;
  formatHint?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | 'qrc';
}

interface StageEmbeddedLyricSource {
  type: 'embedded';
  textContent?: string;
  translationContent?: string;
  usltTags?: StageEmbeddedUsltTag[];
}

interface StageEmbeddedUsltTag {
  language?: string;
  descriptor?: string;
  text: string;
}

interface StageNavidromeLyricSource {
  type: 'navidrome';
  structuredLyrics?: StageNavidromeStructuredLyricLine[];
  plainLyrics?: string;
}

interface StageNavidromeStructuredLyricLine {
  start?: number;
  value?: string;
}

interface StageNeteaseLyricSource {
  type: 'netease';
  lrc?: StageNeteaseLyricBranch & {
    yrc?: StageNeteaseLyricBranch;
    ytlrc?: StageNeteaseLyricBranch;
  };
  yrc?: StageNeteaseLyricBranch;
  ytlrc?: StageNeteaseLyricBranch;
  tlyric?: StageNeteaseLyricBranch;
  pureMusic?: boolean;
}

interface StageNeteaseLyricBranch {
  lyric?: string;
  pureMusic?: boolean;
}

interface StageQrcLyricSource {
  type: 'qrc';
  qrcContent: string;
  translationContent?: string;
}
```

| 变体 | 必填内容 | 说明 |
| --- | --- | --- |
| `local` | `lrcContent: string` | 本地 LRC / enhanced LRC / VTT / YRC / QRC 文本。 |
| `embedded` | `textContent`、`translationContent`、`usltTags` 至少一个有内容 | 音频标签中提取的歌词形态。 |
| `navidrome` | `plainLyrics` 或 `structuredLyrics` 至少一个有内容 | Navidrome 歌词形态。 |
| `netease` | 任一歌词分支或 `pureMusic` | 网易云歌词响应形态。 |
| `qrc` | `qrcContent: string` | QRC 歌词文本。 |

> 目前联调页的输入校验只开放 `embedded`、`local`、`navidrome`、`netease`，服务端 schema 还支持 `qrc`。

### StageMediaSession

```ts
interface StageMediaSession {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number | null;
  coverUrl?: string | null;
  coverArtUrl?: string | null;
  audioUrl?: string | null;
  audioSrc: string;
  audioMimeType?: string;
  coverMimeType?: string;
  lyricsText?: string | null;
  lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | null;
  updatedAt: number;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 服务端生成的会话 ID。 |
| `title` | `string` | 歌名；未提供且无法从文件读取时为 `Stage Session`。 |
| `artist` | `string` | 艺术家；未提供且无法从文件读取时为 `Stage`。 |
| `album` | `string` 可选 | 专辑；默认空字符串。 |
| `durationMs` | `number \| null` 可选 | 上传音频文件时从 metadata 读取的时长；URL 模式通常为 `null`。 |
| `coverUrl` / `coverArtUrl` | `string \| null` 可选 | 封面地址。上传封面或读取到内嵌封面时为本地 Stage media URL。 |
| `audioUrl` | `string \| null` 可选 | 请求中传入的外部音频 URL；上传文件时为 `null`。 |
| `audioSrc` | `string` | Folia 实际播放地址；URL 模式等于 `audioUrl`，文件模式为本地 Stage media URL。 |
| `audioMimeType` | `string` 可选 | 上传音频文件的 MIME 类型。 |
| `coverMimeType` | `string` 可选 | 上传或内嵌封面的 MIME 类型。 |
| `lyricsText` | `string \| null` 可选 | 歌词文本；可来自请求、歌词文件或音频内嵌歌词。 |
| `lyricsFormat` | `'lrc' \| 'enhanced-lrc' \| 'vtt' \| 'yrc' \| null` 可选 | 歌词格式；未传时会尝试从文本检测。 |
| `updatedAt` | `number` | 服务端写入时间。 |

### 播放器公共对象

```ts
interface StagePlayerCurrent {
  id: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
}

interface StagePlayerControlCapabilities {
  play: boolean;
  pause: boolean;
  resume: boolean;
  seek: boolean;
  previous: boolean;
  next: boolean;
}

interface StagePlayerQueueCapabilities {
  append: boolean;
  insertNext: boolean;
  remove: boolean;
  move: boolean;
  select: boolean;
  clear: boolean;
}

interface StagePlayerQueueItem extends StagePlayerCurrent {
  queueItemId: string;
}

interface StagePlayerQueueSummary {
  currentIndex: number;
  length: number;
  revision?: string;
}

interface StagePlayerQueueWindow extends StagePlayerQueueSummary {
  items: StagePlayerQueueItem[];
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
}

type StagePlayerQueueDiffOp =
  | { op: 'insert'; index: number; item: StagePlayerQueueItem }
  | { op: 'remove'; index: number }
  | { op: 'move'; from: number; to: number }
  | { op: 'clear' }
  | { op: 'select'; index: number };

interface StagePlayerQueueDiff {
  baseRevision: string;
  revision: string;
  ops: StagePlayerQueueDiffOp[];
  requiresReload?: true;
}

interface StagePlayerSnapshot extends StagePlayerInsideOutMetadata {
  playbackContext: StagePlayerPlaybackContext;
  current: StagePlayerCurrent | null;
  playerState: PlayerState;
  positionMs: number;
  durationMs: number;
  sampledAtMs: number;
  updatedAt: number;
  controlCapabilities: StagePlayerControlCapabilities;
  queueCapabilities: StagePlayerQueueCapabilities;
  queue: StagePlayerQueueSummary;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `playbackContext` | `StagePlayerPlaybackContext` | 当前播放器上下文。`normal-playback` 支持正常队列编辑；`stage-session` / `external-playback-source` 可能只读或限制控制。 |
| `current` | `StagePlayerCurrent \| null` | 当前曲目。 |
| `playerState` | `'IDLE' \| 'PLAYING' \| 'PAUSED'` | 播放状态。 |
| `positionMs` | `number` | 当前播放位置。播放中会根据 `sampledAtMs` 补偿。 |
| `durationMs` | `number` | 当前曲目时长。 |
| `sampledAtMs` | `number` | 该时间采样的本机时间。 |
| `updatedAt` | `number` | 播放快照更新时间。 |
| `controlCapabilities` | `StagePlayerControlCapabilities` | 当前上下文允许的播放控制。 |
| `queueCapabilities` | `StagePlayerQueueCapabilities` | 当前上下文允许的队列操作。 |
| `queue` | `StagePlayerQueueSummary` | 队列摘要；`GET /stage/player/status` 不返回完整 `items`。 |
| `StagePlayerQueueDiff.baseRevision` | `string` | 本次编辑前的队列 revision。客户端本地 revision 不一致时应重新拉取队列。 |
| `StagePlayerQueueDiff.revision` | `string` | 本次编辑后的队列 revision。 |
| `StagePlayerQueueDiff.ops` | `StagePlayerQueueDiffOp[]` | 可顺序应用到 `baseRevision` 队列上的紧凑操作。 |
| `StagePlayerQueueDiff.requiresReload` | `true` 可选 | 当前变化无法用紧凑 diff 安全表达；客户端应忽略 `ops` 并调用 `GET /stage/player/queue` 重拉。 |

## `GET /stage/health`

用于最轻量的连通性探测。该接口不需要鉴权；即使 Stage 未启用，也会返回当前配置状态。

### 请求

无请求体、无查询参数。

### 响应 `200`

```ts
interface StageHealthResponse {
  enabled: boolean;
  modeEnabled: boolean;
  source: StageSource | null;
  port: number;
  activeEntryKind: StageActiveEntryKind | null;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | `boolean` | Stage API 服务是否启用。 |
| `modeEnabled` | `boolean` | Folia 舞台模式是否启用。 |
| `source` | `StageSource \| null` | 当前舞台输入来源。 |
| `port` | `number` | 当前端口。 |
| `activeEntryKind` | `'lyrics' \| 'media' \| null` | 当前外部注入状态。 |

## `GET /stage/status`

读取当前外部 Stage 输入状态。

### 请求

无请求体、无查询参数。

### 响应 `200`

返回 `StageStatus`。

## `POST /stage/lyrics`

写入 parser-compatible 歌词载荷，或者一个外部播放器正在放的曲目。该接口会把当前 Stage 输入切换为 `activeEntryKind: "lyrics"`，并清空媒体会话。每次请求都是一个新会话（新的 `updatedAt`），舞台会重新载入；只是进度变了请用 `POST /stage/lyrics/clock`。

### 请求

```ts
interface StageLyricsRequest {
  title?: string;
  artist?: string;
  album?: string;
  lyricSource?: StageLyricSource;
  durationMs?: number;
  coverUrl?: string;
  cover?: { mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string };
  positionMs?: number;
  paused?: boolean;
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 没有 `lyricSource` 时必填 | 歌名。空字符串会被忽略。 |
| `artist` | `string` | 否 | 艺术家。空字符串会被忽略。 |
| `album` | `string` | 否 | 专辑。空字符串会被忽略。 |
| `lyricSource` | `StageLyricSource` | 否 | 歌词来源对象，见公共 schema。外部播放器的歌词还没找到、找不到时不传，只显示曲目。 |
| `durationMs` | `number` | 否 | 曲目长度，正数。 |
| `coverUrl` | `string` | 否 | http(s) 封面地址。不能和 `cover` 同时给。 |
| `cover` | `object` | 否 | 封面图片字节：`data` 是标准 base64（不含换行），`mimeType` 是 png、jpeg、webp 或 gif 之一。外部播放器的封面常是 `file://`，页面读不到，读出来传这个；Folia 存下后在 `coverUrl` 里给出本服务的地址（只在这个地址上，`/stage/media/current/cover` 不发它）。受 2 MiB 请求体限制。 |
| `positionMs` | `number` | 否 | 外部播放器现在的位置。给了就成为会话的 `clock`，按外部播放器的时间走。 |
| `paused` | `boolean` | 否 | 和 `positionMs` 一起给：外部播放器停着没有，缺省为在放。 |

### 响应 `200`

返回 `StageStatus`，其中：

- `activeEntryKind` 为 `'lyrics'`
- `lyricsSession` 为本次标准化后的歌词会话
- `mediaSession` 为 `null`

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_LYRICS_JSON` | JSON 无法解析。 |
| `400` | `INVALID_STAGE_LYRICS` | 既没有 `lyricSource` 也没有 `title`，或 `lyricSource` 的 `type` 不合法、对应变体缺少必要内容。 |
| `400` | `INVALID_STAGE_COVER` | `coverUrl` 不是 http(s) 地址，`cover` 的类型或数据不对，或两者同时给。 |
| `400` | `INVALID_STAGE_DURATION` | `durationMs` 不是正数。 |
| `400` | `INVALID_STAGE_LYRICS_CLOCK` | `positionMs` 是负数或不是数字，或 `paused` 不是布尔值。 |
| `409` | `STAGE_INPUT_SUPERSEDED` | 上传封面期间又来了新的推送或清空，这次推送作废（按顺序发请求就不会遇到）。 |
| `413` | `STAGE_BODY_TOO_LARGE` | JSON 请求体超过 2 MiB。 |

## `POST /stage/lyrics/clock`

移动当前歌词会话的时钟，不重新载入会话：外部播放器开始放、暂停、拖动进度时各发一次，平时隔几秒发一次纠正漂移即可，不必每秒都发。只对推送时带了 `positionMs` 的歌词会话有效。在 Folia 里按播放、暂停、拖动只动舞台上的时钟，不会传给外部播放器，下一次时钟推送会把它拉回来。

### 请求

```ts
interface StageLyricsClockRequest {
  positionMs: number;
  paused?: boolean;
  durationMs?: number;
  sessionUpdatedAt?: number;
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `positionMs` | `number` | 是 | 外部播放器现在的位置，非负。 |
| `paused` | `boolean` | 否 | 停着没有；不传时沿用上一次的。 |
| `durationMs` | `number` | 否 | 曲目长度变了（有的播放器开播后才报长度）时给。 |
| `sessionUpdatedAt` | `number` | 否 | 这个时钟属于哪个会话（`POST /stage/lyrics` 返回的 `lyricsSession.updatedAt`）。给了而会话已经换了，返回 `409`，不会把上一首的进度用到下一首上。 |

### 响应 `200`

```ts
interface StageLyricsClockResponse extends StageInputMetadata {
  sessionUpdatedAt: number;
  clock: StageLyricsClock;
  durationMs?: number;
}
```

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_LYRICS_CLOCK` | JSON 无法解析、`positionMs` 缺失或为负、`paused` 不是布尔值。 |
| `400` | `INVALID_STAGE_DURATION` | `durationMs` 不是正数。 |
| `409` | `STAGE_LYRICS_SESSION_INACTIVE` | 当前没有歌词会话。 |
| `409` | `STAGE_LYRICS_SESSION_UNCLOCKED` | 当前歌词会话推送时没带 `positionMs`，按 Folia 自己的时钟走，不接受外部时钟。 |
| `409` | `STAGE_LYRICS_SESSION_CHANGED` | `sessionUpdatedAt` 和当前会话不符；`details.sessionUpdatedAt` 是当前会话的。 |

## 连接文件

Stage API 开着时，Folia 把连接信息写进一个只有当前用户能读的 JSON 文件；本机的外部程序读它就能连上，不用让用户去设置里复制 token。

- Linux：`$XDG_RUNTIME_DIR/folia/stage.json`；没有 `XDG_RUNTIME_DIR` 时同下。
- 其他系统：Folia 用户数据目录下的 `stage/connection.json`（Windows 一般是 `%APPDATA%/<应用名>/stage/connection.json`）。

```ts
interface StageConnectionFile {
  version: 1;
  pid: number;      // 写它的 Folia 进程；进程不在了说明文件是残留的
  port: number;
  baseUrl: string;  // 'http://127.0.0.1:<port>'
  token: string;
}
```

关闭 Stage API、Folia 退出时删除；重新生成 token 时改写。文件不存在就是 Stage API 没开。

## 接入外部播放器

把另一个播放器正在放的歌显示在 Folia 的舞台上（Folia 只显示，播放仍由那个播放器负责），用 `stage-api` 来源：

1. 读连接文件，拿到 `baseUrl` 和 `token`。
2. 换歌时 `POST /stage/lyrics`：`title`、`artist`、`album`、`durationMs`、封面（`coverUrl` 或 `cover`）、`positionMs` 和 `paused`；歌词已经有了就放进 `lyricSource`（逐字歌词可以用 `{ type: 'local', lrcContent, formatHint: 'qrc' }`），还没有就先不传，拿到后再带上 `lyricSource` 和当前位置重发一次。记下返回的 `lyricsSession.updatedAt`。
3. 播放、暂停、拖动时 `POST /stage/lyrics/clock`，带上 `sessionUpdatedAt`；平时每隔几秒发一次纠正漂移。
4. 播放器没了（关掉、没有在放的）时 `DELETE /stage/state`，舞台回到等待状态。

## `POST /stage/session`

写入媒体会话。可以传 JSON 描述，也可以用 multipart 上传音频、歌词、封面文件。该接口会把当前 Stage 输入切换为 `activeEntryKind: "media"`，并清空歌词会话。

### JSON 请求

```ts
interface StageSessionJsonRequest {
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  audioUrl: string;
  lyricsText?: string;
  lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc';
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | 否 | 歌名。 |
| `artist` | `string` | 否 | 艺术家。 |
| `album` | `string` | 否 | 专辑。 |
| `coverUrl` | `string` | 否 | 外部封面 URL。 |
| `audioUrl` | `string` | 是 | 外部音频 URL。JSON 模式不能上传 `audioFile`。 |
| `lyricsText` | `string` | 否 | 歌词文本。 |
| `lyricsFormat` | `'lrc' \| 'enhanced-lrc' \| 'vtt' \| 'yrc'` | 否 | 歌词格式。不传时会尝试自动检测。 |

### Multipart 请求

```ts
interface StageSessionMultipartFields {
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  audioUrl?: string;
  lyricsText?: string;
  lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc';
}

interface StageSessionMultipartFiles {
  audioFile?: File;
  lyricsFile?: File;
  coverFile?: File;
}
```

| 字段 / 文件 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | form field `string` | 否 | 歌名。 |
| `artist` | form field `string` | 否 | 艺术家。 |
| `album` | form field `string` | 否 | 专辑。 |
| `coverUrl` | form field `string` | 否 | 外部封面 URL。 |
| `audioUrl` | form field `string` | 条件必填 | 与 `audioFile` 二选一，不能同时提供。 |
| `lyricsText` | form field `string` | 否 | 与 `lyricsFile` 不能同时提供。 |
| `lyricsFormat` | form field enum | 否 | `lrc`、`enhanced-lrc`、`vtt`、`yrc`。 |
| `audioFile` | file | 条件必填 | 与 `audioUrl` 二选一。上传后服务端会尝试读取内嵌歌词、封面和 metadata。 |
| `lyricsFile` | file | 否 | 独立歌词文件，按 UTF-8 读取。 |
| `coverFile` | file | 否 | 独立封面文件。 |

限制：

- JSON 请求体上限：2 MiB
- 单个 multipart field 上限：2 MiB
- 单个文件上限：1 GiB
- 最多 3 个文件、10 个 field、10 个 part

### 响应 `200`

返回 `StageStatus`，其中：

- `activeEntryKind` 为 `'media'`
- `mediaSession` 为本次标准化后的媒体会话
- `lyricsSession` 为 `null`

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_JSON` | JSON 无法解析。 |
| `400` | `INVALID_LYRICS_FORMAT` | `lyricsFormat` 不在允许枚举中。 |
| `400` | `INVALID_AUDIO_SOURCE` | 没有提供音频来源，或同时提供 `audioUrl` 与 `audioFile`。 |
| `400` | `INVALID_LYRICS_SOURCE` | 同时提供 `lyricsText` 与 `lyricsFile`。 |
| `413` | `STAGE_BODY_TOO_LARGE` | JSON 请求体超过 2 MiB。 |
| `413` | `STAGE_FILE_TOO_LARGE` | multipart 文件超过 1 GiB。 |
| `422` | `AUDIO_METADATA_PARSE_FAILED` | 上传音频 metadata 解析失败。 |
| `500` | `SESSION_COMMIT_FAILED` | multipart 文件写入或提交失败。 |

## `POST /stage/player/search`

把搜索请求转交给 Folia 的搜索通道，返回可供点播接口消费的候选结果。不传 `provider` 时走本机网易云服务（与加入 `provider` 之前完全一致）；传了就经 omni 在那个平台搜索，用的是 Folia 里那个平台的登录状态。

### 请求

```ts
interface StagePlayerSearchRequest {
  query: string;
  limit?: number;
  provider?: string;
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | `string` | 是 | 搜索关键词。空字符串不合法。 |
| `limit` | `number` | 否 | 返回数量。服务端会归一化到 `1..50`，默认 `10`。 |
| `provider` | `string` | 否 | omni 平台 id，如 `qq`、`kugou`、`netease`，模组的平台是 `folium.<modid>.<name>`。字母开头，只含字母、数字、`_`、`.`、`-`，最长 64 个字符。 |

### 响应 `200`

```ts
interface StageSearchResult {
  songId: number | string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number | null;
  coverUrl: string | null;
  provider: string;
  songRef: string;
}

interface StagePlayerSearchResponse extends StagePlayerOutsideInMetadata {
  query: string;
  provider: string;
  songs: StageSearchResult[];
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | `string` | 标准化后的搜索关键词。 |
| `provider` | `string` | 本次实际搜索的平台；不传 `provider` 时是 `netease`。 |
| `songs` | `StageSearchResult[]` | 搜索结果列表。 |
| `songs[].songId` | `number \| string` | 歌曲在它平台上的 ID，与用 `songRef` 点播时响应里的 `songId` 相同：网易云的歌是正整数（可以照旧直接传给点播接口），其他平台是字符串。 |
| `songs[].provider` | `string` | 歌曲所在的平台。 |
| `songs[].songRef` | `string` | `<provider>:<songId>`，如 `qq:97773`。传给 `/stage/player/play` 或队列追加接口的 `songId`，任何平台的歌都能这样点。 |
| `songs[].title` | `string` | 歌名。 |
| `songs[].artists` | `string[]` | 艺术家列表。 |
| `songs[].album` | `string` | 专辑。 |
| `songs[].durationMs` | `number \| null` | 时长。 |
| `songs[].coverUrl` | `string \| null` | 封面 URL。 |

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_PLAYER_SEARCH_JSON` | JSON 无法解析。 |
| `400` | `INVALID_STAGE_PLAYER_SEARCH_QUERY` | `query` 为空。 |
| `400` | `INVALID_STAGE_PLAYER_SEARCH_PROVIDER` | `provider` 不是合法的平台 id。 |
| `503` | `NETEASE_API_UNAVAILABLE` | 不传 `provider` 时，默认网易云本地 API 不可用。 |
| `502` | `NETEASE_SEARCH_FAILED` | 不传 `provider` 时，默认网易云搜索请求失败。 |
| `503` | `STAGE_PLAYER_SEARCH_UNAVAILABLE` | 传了 `provider`，Folia 主窗口不可用。 |
| `502` | `STAGE_SEARCH_REJECTED` | 传了 `provider`，平台搜索失败，例如 Folia 里没有这个平台。 |
| `504` | `STAGE_PLAYER_REQUEST_TIMEOUT` | 传了 `provider`，10 秒内没有搜索结果。 |

## `POST /stage/player/play`

请求 Folia 主播放器播放或追加一首歌。

### 请求

```ts
interface StagePlayerPlayRequest {
  songId: number | string;
  appendToQueue?: boolean;
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `songId` | `number \| string` | 是 | 正整数（或纯数字字符串）是本机网易云的歌曲 ID；`<provider>:<songId>`（搜索结果的 `songRef`，如 `qq:97773`）是那个平台的歌。`netease:<id>` 与 `<id>` 等价。 |
| `appendToQueue` | `boolean` | 否 | `true` 时追加到主播放器队列，不打断当前播放；默认 `false`。 |

### 响应 `200`

```ts
interface StagePlayerPlayResponse extends StagePlayerOutsideInMetadata {
  ok: true;
  songId: number | string;
  provider: string;
  songRef: string;
  appendToQueue: boolean;
  changed?: boolean;
  deduplicated?: boolean;
  affectedCount?: number;
  diff?: StagePlayerQueueDiff;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | `true` | 请求已被播放器接受。 |
| `songId` | `number \| string` | 本次请求的歌曲在它平台上的 ID；本机网易云的歌是数字。 |
| `provider` | `string` | 歌曲所在的平台。 |
| `songRef` | `string` | `<provider>:<songId>`。 |
| `appendToQueue` | `boolean` | 是否为队列追加模式。 |
| `changed` | `boolean` 可选 | 队列追加时，队列是否发生变化。 |
| `deduplicated` | `boolean` 可选 | 队列追加时，是否发生同源歌曲去重或移动。 |
| `affectedCount` | `number` 可选 | 队列追加时，实际影响的歌曲数量。 |
| `diff` | `StagePlayerQueueDiff` 可选 | 队列追加时的队列差异。若 `requiresReload: true`，客户端应重新调用 `GET /stage/player/queue` 校准本地队列。 |

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_PLAYER_PLAY_JSON` | JSON 无法解析。 |
| `400` | `INVALID_STAGE_PLAYER_PLAY_SONG_ID` | `songId` 既不是正整数，也不是 `<provider>:<songId>`。 |
| `503` | `STAGE_PLAY_UNAVAILABLE` | Folia 主窗口不可用。 |
| `503` | `STAGE_PLAY_CANCELED` | 请求被取消，例如 Stage 状态被清空。 |
| `504` | `STAGE_PLAY_TIMEOUT` | 播放器 15 秒内未完成响应。 |
| `502` | `STAGE_PLAY_REJECTED` | 渲染进程拒绝播放请求，例如找不到这首歌或 Folia 里没有这个平台。 |

## `GET /stage/player/status`

读取 Folia 播放器状态。该接口返回队列摘要，不返回完整队列 `items`。

### 请求

无请求体、无查询参数。

### 响应 `200`

返回 `StagePlayerSnapshot`。

## `GET /stage/player/time`

主动校准播放时间。相比完整播放器状态，该接口只返回时间和状态字段。

### 请求

无请求体、无查询参数。

### 响应 `200`

```ts
interface StagePlayerTimeResponse extends StagePlayerInsideOutMetadata {
  playbackContext: StagePlayerPlaybackContext;
  playerState: PlayerState;
  positionMs: number;
  durationMs: number;
  sampledAtMs: number;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `playbackContext` | `StagePlayerPlaybackContext` | 当前播放上下文。 |
| `playerState` | `PlayerState` | 当前播放状态。 |
| `positionMs` | `number` | 当前播放位置。播放中会进行时间补偿并限制在 `durationMs` 内。 |
| `durationMs` | `number` | 当前曲目时长。 |
| `sampledAtMs` | `number` | 采样时间。 |

## `POST /stage/player/control`

发送播放器控制指令。

### 请求

```ts
interface StagePlayerControlRequest {
  action: 'next' | 'prev' | 'pause' | 'resume' | 'seek';
  positionMs?: number;
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 是 | 控制动作。 |
| `positionMs` | `number` | `action: "seek"` 时必填 | 跳转到指定毫秒位置，必须为非负整数；服务端会向下取整。 |

### 响应 `200`

```ts
interface StagePlayerControlResponse extends StagePlayerOutsideInMetadata {
  accepted: true;
  action: 'next' | 'prev' | 'pause' | 'resume' | 'seek';
  playbackContext: StagePlayerPlaybackContext;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `accepted` | `true` | 指令已被当前播放器上下文接受。 |
| `action` | enum | 本次动作。 |
| `playbackContext` | `StagePlayerPlaybackContext` | 接受指令时的播放上下文。 |

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_PLAYER_CONTROL_JSON` | JSON 无法解析。 |
| `400` | `INVALID_STAGE_PLAYER_CONTROL_ACTION` | `action` 不在允许枚举中。 |
| `400` | `INVALID_STAGE_PLAYER_SEEK_POSITION` | `seek` 未提供合法非负 `positionMs`。 |
| `409` | `STAGE_PLAYER_CONTROL_UNSUPPORTED` | 当前播放上下文不支持该动作。 |
| `503` | `STAGE_PLAYER_CONTROL_UNAVAILABLE` | Folia 主窗口不可用或 Stage 服务停止。 |
| `504` | `STAGE_PLAYER_REQUEST_TIMEOUT` | 播放器 10 秒内未完成响应。 |
| `502` | `STAGE_PLAYER_REQUEST_REJECTED` | 渲染进程拒绝控制请求。 |

## `GET /stage/player/queue`

分页读取主播放器队列详情。

### 请求查询参数

```ts
interface StagePlayerQueueQuery {
  offset?: number;
  limit?: number;
  around?: 'current';
}
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `offset` | `number` | `0` | 起始下标。负数会按 `0` 处理，超过长度会返回空窗口。 |
| `limit` | `number` | `100` | 返回数量，范围 `1..500`。 |
| `around` | `'current'` | 无 | 传 `current` 时忽略直接窗口语义，围绕当前队列项计算 `offset`。 |

### 响应 `200`

```ts
interface StagePlayerQueueGetResponse extends StagePlayerInsideOutMetadata {
  playbackContext: StagePlayerPlaybackContext;
  queueCapabilities: StagePlayerQueueCapabilities;
  queue: StagePlayerQueueWindow;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `playbackContext` | `StagePlayerPlaybackContext` | 当前播放上下文。 |
| `queueCapabilities` | `StagePlayerQueueCapabilities` | 当前队列操作能力。 |
| `queue.currentIndex` | `number` | 当前播放项下标；无当前项时为 `-1`。 |
| `queue.length` | `number` | 队列总长度。 |
| `queue.revision` | `string` 可选 | 队列内容摘要。 |
| `queue.items` | `StagePlayerQueueItem[]` | 当前页队列项。 |
| `queue.offset` | `number` | 实际返回窗口起点。 |
| `queue.limit` | `number` | 实际使用的 limit。 |
| `queue.returned` | `number` | 本页返回数量。 |
| `queue.hasMore` | `boolean` | 后面是否还有更多队列项。 |
| `queue.nextOffset` | `number \| null` | 下一页 offset；没有更多时为 `null`。 |

## `POST /stage/player/queue`

编辑主播放器队列。Stage 外部推送 session 和外部播放源接入下的舞台模式可能为只读；具体以 `queueCapabilities` 为准。

### 请求

```ts
interface StagePlayerQueueRequest {
  action: 'append' | 'insert-next' | 'remove' | 'move' | 'select' | 'clear';
  songId?: number | string;
  songIds?: Array<number | string>;
  queueItemId?: string;
  fromQueueItemId?: string;
  fromIndex?: number;
  toIndex?: number;
  index?: number;
}
```

| 字段 | 类型 | 适用 action | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 全部 | 队列动作。 |
| `songId` | `number \| string` | `append`、`insert-next` | 追加或插到下一首的单首歌：正整数（本机网易云）或 `<provider>:<songId>`，同 `/stage/player/play`。 |
| `songIds` | `Array<number \| string>` | `append`、`insert-next` | 批量追加或插到下一首的歌，每项同 `songId`，可以混着不同平台。服务端会过滤读不出来的项；有可用的项时忽略 `songId`。找不到的歌不加入，全部找不到时请求失败。 |
| `queueItemId` | `string` | `remove`、`select` | 按队列项 ID 删除或选择。 |
| `fromQueueItemId` | `string` | `move` | 按队列项 ID 指定移动来源。 |
| `fromIndex` | `number` | `move` | 按下标指定移动来源。 |
| `toIndex` | `number` | `move` | 移动目标下标。 |
| `index` | `number` | `remove`、`select` | 按下标删除或选择。 |

动作要求：

- `append` / `insert-next`：至少提供 `songId` 或非空 `songIds`。
- `remove`：至少提供 `queueItemId` 或 `index`。
- `move`：至少提供 `fromQueueItemId` 或 `fromIndex`，并且必须提供 `toIndex`。
- `select`：至少提供 `queueItemId` 或 `index`。
- `clear`：不需要额外字段。

### 响应 `200`

```ts
interface StagePlayerQueuePostResponse extends StagePlayerOutsideInMetadata {
  accepted: true;
  action: 'append' | 'insert-next' | 'remove' | 'move' | 'select' | 'clear';
  playbackContext: StagePlayerPlaybackContext;
  changed?: boolean;
  deduplicated?: boolean;
  affectedCount?: number;
  diff?: StagePlayerQueueDiff;
  queue: StagePlayerQueueSummary;
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `accepted` | `true` | 队列指令已被当前播放器上下文接受。 |
| `action` | enum | 本次队列动作。 |
| `playbackContext` | `StagePlayerPlaybackContext` | 接受指令时的播放上下文。 |
| `changed` | `boolean` 可选 | 队列是否发生变化。 |
| `deduplicated` | `boolean` 可选 | 插入歌曲时是否发生同源歌曲去重或移动。 |
| `affectedCount` | `number` 可选 | 实际影响的队列项数量。 |
| `diff` | `StagePlayerQueueDiff` 可选 | 操作前后队列差异。若 `requiresReload: true`，客户端应重新调用 `GET /stage/player/queue` 校准本地队列。 |
| `queue` | `StagePlayerQueueSummary` | 操作后的队列摘要，不包含完整 `items`。 |

### 主要错误

| HTTP | `code` | 条件 |
| --- | --- | --- |
| `400` | `INVALID_STAGE_PLAYER_QUEUE_JSON` | JSON 无法解析。 |
| `400` | `INVALID_STAGE_PLAYER_QUEUE_ACTION` | `action` 不在允许枚举中。 |
| `409` | `STAGE_PLAYER_QUEUE_UNSUPPORTED` | 当前播放上下文不支持该队列动作。 |
| `503` | `STAGE_PLAYER_QUEUE_UNAVAILABLE` | Folia 主窗口不可用或 Stage 服务停止。 |
| `504` | `STAGE_PLAYER_REQUEST_TIMEOUT` | 播放器 10 秒内未完成响应。 |
| `502` | `STAGE_PLAYER_REQUEST_REJECTED` | 渲染进程拒绝队列请求。 |

## `WS /stage/player/ws`

订阅播放器状态事件。

### 连接

```text
ws://127.0.0.1:32107/stage/player/ws?token=<token>
```

或通过 Header：

```http
Authorization: Bearer <token>
```

### 鉴权 / 连接错误

| HTTP | 条件 |
| --- | --- |
| `401 Unauthorized` | token 缺失或不匹配。 |
| `503 Service Unavailable` | Stage 未启用。 |
| `404 Not Found` | WebSocket path 不是 `/stage/player/ws`。 |

### 事件

连接成功后会立刻收到一次 `STATUS`。之后只有在曲目、播放语义或队列发生变化时推送增量事件。

```ts
type StagePlayerWebSocketMessage =
  | StagePlayerWebSocketStatusMessage
  | StagePlayerWebSocketTrackChangedMessage
  | StagePlayerWebSocketPlaybackUpdatedMessage
  | StagePlayerWebSocketQueueUpdatedMessage;

interface StagePlayerWebSocketStatusMessage extends StagePlayerSnapshot {
  event: 'STATUS';
}

interface StagePlayerWebSocketTrackChangedMessage
  extends StagePlayerInsideOutMetadata {
  event: 'TRACK_CHANGED';
  playbackContext: StagePlayerPlaybackContext;
  current: StagePlayerCurrent | null;
  playerState: PlayerState;
  sampledAtMs: number;
  updatedAt: number;
  controlCapabilities: StagePlayerControlCapabilities;
  queueCapabilities: StagePlayerQueueCapabilities;
  queue: StagePlayerQueueSummary;
}

interface StagePlayerWebSocketPlaybackUpdatedMessage
  extends StagePlayerInsideOutMetadata {
  event: 'PLAYBACK_UPDATED';
  playbackContext: StagePlayerPlaybackContext;
  playerState: PlayerState;
  positionMs: number;
  durationMs: number;
  sampledAtMs: number;
}

interface StagePlayerWebSocketQueueUpdatedMessage
  extends StagePlayerInsideOutMetadata {
  event: 'QUEUE_UPDATED';
  playbackContext: StagePlayerPlaybackContext;
  current: StagePlayerCurrent | null;
  queueCapabilities: StagePlayerQueueCapabilities;
  previousQueue?: StagePlayerQueueSummary;
  queue: StagePlayerQueueSummary;
}
```

| 事件 | 返回内容 |
| --- | --- |
| `STATUS` | 完整 `StagePlayerSnapshot`，但 `queue` 仍是摘要，不含完整 `items`。 |
| `TRACK_CHANGED` | 当前曲目、播放状态、能力和队列摘要；不包含 `positionMs` / `durationMs`。 |
| `PLAYBACK_UPDATED` | 播放时间和播放状态；不包含当前曲目、能力、队列。 |
| `QUEUE_UPDATED` | 当前曲目、队列能力、变化前后队列摘要；不包含完整 `items`。 |

需要完整队列详情时，调用 `GET /stage/player/queue`。

## `DELETE /stage/state`

清空当前 Stage 持有的外部输入状态。

### 请求

无请求体、无查询参数。

### 响应 `200`

返回 `StageStatus`，其中：

- `activeEntryKind` 为 `null`
- `lyricsSession` 为 `null`
- `mediaSession` 为 `null`

## 兼容旧接口

以下旧接口仍可用，但响应会额外标记 `deprecated: true` 和 `replacement`。

| 旧接口 | 替代接口 | 响应差异 |
| --- | --- | --- |
| `POST /stage/search` | `POST /stage/player/search` | `StagePlayerSearchResponse & { deprecated: true; replacement: '/stage/player/search' }` |
| `POST /stage/play` | `POST /stage/player/play` | `StagePlayerPlayResponse & { deprecated: true; replacement: '/stage/player/play' }` |
