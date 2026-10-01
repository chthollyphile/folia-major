# Folia Now Playing 发送

<!-- docs/now-playing-sender.md -->

Now Playing 发送是 Folia Electron 桌面端提供的本机广播服务。Folia 作为发布方，把当前曲目、歌词与播放进度推送给外部程序（歌词悬浮窗、OBS 页面源、now-playing-service 风格的客户端等），无需鉴权。

它与「舞台模式」是两件独立的事：舞台模式让 Folia 显示别的播放器在放什么；Now Playing 发送让 Folia 说出自己在放什么。开启发送不会接管播放，也不会改变可视化效果。

## 基本信息

| 项目 | 值 |
| --- | --- |
| 可用平台 | Folia Electron 桌面端 |
| 协议 | HTTP（查询）+ WebSocket（推送） |
| 监听地址 | `127.0.0.1` |
| 固定端口 | `9863` |
| API 版本 | `v2` |
| 鉴权 | 无 |
| 数据格式 | JSON，UTF-8 |
| 查询基础地址 | `http://127.0.0.1:9863` |
| WebSocket 地址 | `ws://127.0.0.1:9863/api/ws/lyric` |

服务只监听 IPv4 回环地址，不能从局域网或互联网访问。建议客户端使用文档中的完整 `127.0.0.1` 地址，不要依赖 `localhost` 的 IPv4/IPv6 解析结果。

端口固定为 `9863`，因为 now-playing-service 及其前端、PV Tool 都默认连这个端口，且同一时间只能有一个监听者。端口被占用时设置页会显示「未运行」及对应错误，此时需要先释放端口，再关闭并重新启用发送。

## 启用服务

在 Folia 桌面端打开：

```text
设置 → 连接与集成 → Now Playing 发送 → 启用
```

也可以从命令面板执行「Now Playing 发送」命令进行切换；进度发送间隔另有「Now Playing sender heartbeat」命令可以快速循环取值。设置会被持久化，启用后 Folia 下次启动时会自动尝试监听固定端口。

## 时间单位

除了进度字段本身，本服务对外的 `duration` 一律是**秒**。

这与 now-playing-service 的实际行为一致：它的 `Track.duration` / `Lyric.duration` 是秒，前端也直接把它们喂给以秒为单位的进度条。它的 `ServerAPI.md` 写的是毫秒，但那份文档描述的是 MusicBee 插件——另一个实现，不是这些客户端连接的实现。客户端接入时请以本页为准。

## 查询接口

所有查询都用 `GET`，无请求体。除 `OPTIONS` 外其他方法返回 `405`，未知路径返回 `404`。

| 路径 | 别名 | 响应 |
| --- | --- | --- |
| `/api/query` | `/api/query/now` | 玩家状态 + 曲目的完整快照 |
| `/api/query/player` | `/query/player` | 玩家状态 |
| `/api/query/track` | `/query/track` | 曲目对象本身（不包裹） |
| `/api/query/progress` | `/query/progress` | `{ progress: number }`，毫秒 |
| `/api/query/hasSong` | — | `{ data: boolean }` |
| `/api/query/isConnected` | — | `{ data: boolean }` |
| `/api/lyric` | — | 当前歌词记录（与 WS 的 `Lyric` 同一条） |

每个响应都带 `Access-Control-Allow-Origin: *`、`Cache-Control: no-store` 与 `X-Content-Type-Options: nosniff`。

### 玩家状态

没有曲目时返回一个「暂停在起点」的玩家，而不是上一次的进度：

```json
{
  "hasSong": true,
  "isPaused": false,
  "volumePercent": 50,
  "seekbarCurrentPosition": 37,
  "seekbarCurrentPositionHuman": "0:37",
  "statePercent": 0.1989247311827957,
  "likeStatus": "INDIFFERENT",
  "repeatType": "ALL"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hasSong` | `boolean` | 是否有可播报的曲目。发送被关闭时同样为 `false`。 |
| `isPaused` | `boolean` | 是否处于暂停状态。 |
| `volumePercent` | `number` | `0`–`100`，静音时为 `0`。 |
| `seekbarCurrentPosition` | `number` | 当前播放位置，单位为**秒**。 |
| `seekbarCurrentPositionHuman` | `string` | 上述位置的 `m:ss` / `h:mm:ss` 形式。 |
| `statePercent` | `number` | `0`–`1` 的进度比例，时长未知时为 `0`。 |
| `likeStatus` | `string` | 目前恒为 `INDIFFERENT`。 |
| `repeatType` | `string` | `NONE` / `ONE` / `ALL`，取自 Folia 的循环模式。 |

清空曲目（停止播放，或从舞台模式切回普通播放）会同时清掉进度与暂停位，因此不会出现 `hasSong: false` 却带着上一首歌进度的组合。

### 曲目对象

即使没有曲目，该对象也会返回，字段为空——客户端通常在检查 `hasSong` 之前就先读 `track.title`：

```json
{
  "id": "1",
  "title": "Song",
  "author": "Artist",
  "album": "Album",
  "cover": "https://.../cover.jpg",
  "duration": 186,
  "durationHuman": "3:06",
  "url": "",
  "isVideo": false,
  "isAdvertisement": false,
  "inLibrary": false
}
```

`duration` 为秒；未知时长时为 `0`。`url`、`isVideo`、`isAdvertisement`、`inLibrary` 目前是 now-playing-service 的字段占位，Folia 还没有对应概念。

### 歌词记录

没有曲目时也返回对象，而不是 `null`：

```json
{
  "source": "folia",
  "title": "Song",
  "author": "Artist",
  "duration": 0,
  "hasLyric": true,
  "hasTranslatedLyric": false,
  "hasKaraokeLyric": true,
  "lrc": "[00:01.00]line\n",
  "translatedLyric": "",
  "karaokeLyric": "[0]line(1000,1000)\n"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source` | `string` | 固定为 `folia`。 |
| `lrc` | `string` | 逐行时间轴，标准 LRC 文本。 |
| `karaokeLyric` | `string` | 逐字时间轴，LYS（Lyricify Syllable）格式：每行以 `[0]` 开头，后接 `word(startMs,durationMs)` 序列。仅在歌词确实是逐字时提供。 |
| `translatedLyric` | `string` | 翻译，带 LRC 时间标签——客户端按时间戳与主行配对，裸文本会解析成零行。 |

`duration` 恒为 `0`，Folia 侧暂未填充该字段。

## 推送接口

连接 `ws://127.0.0.1:9863/api/ws/lyric`。连接建立时会先补齐当前完整状态，让中途接入的客户端不会残留上一首：

1. `Track` — 当前曲目，没有曲目时 `data` 为 `null`
2. `Lyric` — 当前歌词，没有歌词时 `data` 为 `null`
3. `PlayerPauseState` — 玩家状态快照
4. `PlayerProgress` — `{ progress: number }`，毫秒

之后每条消息都是 `{ "event": string, "data": object | null }`：

| `event` | 触发时机 |
| --- | --- |
| `Track` | 曲目身份变化（标题、艺术家、专辑、封面、时长）。清空曲目时 `data` 为 `null`。 |
| `Lyric` | 解析出的歌词内容变化。清空时 `data` 为 `null`。 |
| `PlayerPauseState` | 播放/暂停位翻转，或发生跳转。 |
| `PlayerProgress` | 每次进度上报。 |
| `PlayerProgressReplay` | 观察到一次回退（`isReplay`），提示客户端重置自己的播放头。 |

`Track` 与 `Lyric` 只在归一化后的记录真正变化时才会发出，并在服务重启后重新播发——因此外部客户端不需要自己判断「这条和上一条是否相同」。

发送被关闭后，端口关闭，客户端连接会失败；重新启用时 Folia 会重新推一遍当前曲目与歌词，无需等切歌。

## 进度发送间隔

「进度发送间隔」控制主动上报的频率，取值范围 `0`–`10` 秒，精度一位小数：

- `0` 表示不按时间上报，只在播放、暂停、切歌或调整进度时立即发送。
- 间隔越大，客户端需要自行推算的时间越长。

无论间隔取多少，切歌、暂停恢复和跳转都会立刻在总线上放一个新的进度锚点。

## 相关文档

- [歌词接口](lyric-api.md) — 只读 HTTP API，用于读取 Folia 当前加载的原始歌词数据。
- [技术与开发说明](technical.md)
