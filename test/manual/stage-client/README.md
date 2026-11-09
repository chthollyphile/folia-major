# Stage API 示例

## Bili Live Song Demo
您可以在 `test/manual/bili-livesong/main.py` 中找到一个使用 Stage 搜索和点播接口的[示例程序](https://github.com/chthollyphile/folia-major/tree/main/test/manual/bili-livesong)，展示了如何监听 B 站直播间的弹幕，并将符合条件的点歌请求发送到本地播放器接口。

## Stage 联调客户端

如果你已经在桌面端开启了 Stage Mode，可以使用仓库内置的本地 Stage API 文档页向 Folia 推送完整歌词对象、推送媒体会话，或者从外部程序触发搜索与点歌。

1. 在 Folia 设置中开启 Stage Mode，并复制 Bearer token
2. 运行：

```bash
npm run stage:client
```

3. 页面打开后填写：

- Stage 地址，默认 `http://127.0.0.1:32107`
- Bearer token
- 需要推送的歌词、媒体或搜索关键词

当前页面采用“文档优先”的信息架构：

- 左侧目录按 endpoint 导航
- 每个接口同时展示用途、鉴权、字段说明、cURL 示例
- 右侧同屏显示最终请求预览和实际响应
- `POST /stage/player/play` 通过搜索结果按钮联动触发，便于模拟真实对接流程

需要对接外部程序时，请参考 [Stage API 请求与响应 Schema](./API_SCHEMA.md)，其中按接口列出了请求参数、响应参数、字段类型和主要错误条件。

Stage API 当前接口清单：

- `GET /stage/health`
- `GET /stage/status`
- `POST /stage/lyrics`
- `POST /stage/lyrics/clock`
- `POST /stage/session`
- `POST /stage/player/search`
- `POST /stage/player/play`
- `GET /stage/player/status`
- `GET /stage/player/time`
- `POST /stage/player/control`
- `GET /stage/player/queue`
- `POST /stage/player/queue`
- `WS /stage/player/ws`
- `DELETE /stage/state`

如果上传的是音频文件，Folia 还会尝试直接读取文件内嵌歌词、封面和歌曲 metadata。歌词仍然是可选的；如果提供了歌词，Stage 会复用 Folia 自己的解析链来尝试解析，失败时会降级成无歌词播放。
`Lyrics format` 可以保持 `auto-detect`，或者显式指定 `lrc`、`enhanced-lrc`、`vtt`、`yrc`。
`POST /stage/player/play` 默认会立即播放指定歌曲；如果传入 `appendToQueue: true`，则会把歌曲追加到 Folia 主播放器队列，而不会打断当前播放。旧 `/stage/play` 暂时保留兼容。

## 接口说明

- `GET /stage/health`
  用于返回 Stage 服务自身是否可用，适合做最轻量的连通性探测，不依赖播放器当前状态。

- `GET /stage/status`
  用于返回当前 Stage 输入状态，也就是外部推送到 Folia 的歌词或媒体 session。响应会带 `domain: "stage-input"` 和 `direction: "outside-in"`。

- `POST /stage/lyrics`
  用于写入一份 parser-compatible 的歌词载荷，让 Folia 按自身歌词解析链接管并更新当前 Stage 歌词状态。

  注意这个接口的功能相当于直接播放一个无音频的歌词文件，而不是在当前媒体上下文中附加歌词；如果需要后者，请使用 `POST /stage/session` 上传一个包含内嵌歌词的媒体会话。

  也用来显示另一个播放器正在放的歌：可以不带歌词（只给曲目），带上长度、封面和那个播放器现在的位置（`positionMs`、`paused`），舞台就按那个播放器的时间走。见 [API_SCHEMA.md](./API_SCHEMA.md) 的「接入外部播放器」。

- `POST /stage/lyrics/clock`
  移动当前歌词会话的时钟（外部播放器播放、暂停、拖动、纠正漂移），不重新载入会话。

- `POST /stage/session`
  用于写入媒体会话数据，可以是 JSON 形式的媒体描述，也可以是 multipart 形式的实际文件上传。

- `POST /stage/player/search`
  用于把外部搜索请求转交给 Folia 当前接入的搜索通道，返回可供后续播放器点播接口消费的候选结果。旧 `/stage/search` 仍可用，但响应会标记 `deprecated: true`。

- `POST /stage/player/play`
  用于请求 Folia 主播放器播放一首歌，支持直接播放，也支持通过 `appendToQueue: true` 仅追加到主队列。当进行追加操作时，响应中会额外包含 `changed`、`deduplicated`、`affectedCount` 和可选 `diff` 字段，以表明本次插入是否被完全或部分去重，并帮助外部客户端同步队列；若 `diff.requiresReload` 为 `true`，应调用 `GET /stage/player/queue` 重拉队列。（注：Folia 存在严格的队列去重机制，同一歌曲不会在队列中出现两次。若追加的歌曲已存在于队列中，它会被直接移动到目标位置而不会产生副本。）
  旧 `/stage/play` 仍可用，但响应会标记 `deprecated: true`。

- `GET /stage/player/status`
  用于读取 Folia 播放器状态，响应会带 `domain: "player-playback"` 和 `direction: "inside-out"`，并返回当前曲目、播放上下文、控制能力和队列摘要。这里的 `queue` 不包含完整 `items`，只包含 `currentIndex`、`length` 和 `revision`。

- `GET /stage/player/time`
  用于主动校准播放时间，返回 `positionMs`、`durationMs`、`sampledAtMs` 和当前播放状态。

- `POST /stage/player/control`
  用于发送播放器控制指令，支持 `next`、`prev`、`pause`、`resume`、`seek`。`seek` 指令需要合法的非负整数 `positionMs`，否则会返回 `400 INVALID_STAGE_PLAYER_SEEK_POSITION`。不支持当前播放上下文时返回 `409`。

- `GET /stage/player/queue` / `POST /stage/player/queue`
  用于读取和编辑正常播放器队列。`GET` 默认返回最多 100 条 `items`，支持 `offset`、`limit` 和 `around=current` 查询参数，`limit` 最大 500。编辑 action 支持 `append`、`insert-next`、`remove`、`move`、`select`、`clear`；`select` 可通过 `index` 或 `queueItemId` 切到指定队列项播放（通过 `queueItemId` 操作时，会严格校验 `source` 和 `id` 是否与当前队列项匹配）。当使用 `append` 或 `insert-next` 追加歌曲时，由于队列存在同源歌曲排重逻辑，同一首歌曲不会在队列中出现两次，若歌曲已存在则会被直接移动到目标位置。编辑响应只返回队列摘要，并包含 `changed`、`deduplicated`、`affectedCount` 和可选 `diff`；若 `diff.requiresReload` 为 `true`，外部客户端应调用 `GET /stage/player/queue` 重拉队列。Stage 外部推送 session 和外部播放源接入下的舞台模式为只读。

- `WS /stage/player/ws`
  用于订阅播放器状态事件，鉴权复用 Bearer token，也支持 `?token=`。连接后会收到一次 `STATUS` 当前状态，之后仅在曲目、播放语义或队列发生变化时按 `TRACK_CHANGED`、`PLAYBACK_UPDATED`、`QUEUE_UPDATED` 推送。`TRACK_CHANGED` 不携带 `positionMs` / `durationMs`，`PLAYBACK_UPDATED` 只携带播放时间和状态，`QUEUE_UPDATED` 携带当前曲目、变化前后队列摘要和队列能力，但不携带完整 `items`；需要队列详情时请调用分页版 `GET /stage/player/queue`。

- `DELETE /stage/state`
  用于清空当前 Stage 持有的会话状态，通常会移除已注入的歌词、媒体上下文和相关临时数据。

补充约束：

- 除 `GET /stage/health` 之外，其余接口都需要 Bearer token；本机程序可以从连接文件读到地址和 token（见 [API_SCHEMA.md](./API_SCHEMA.md) 的「连接文件」）
- `POST /stage/session` 支持 JSON 和 multipart 两种传输方式
- 上传音频文件时，Folia 会尝试读取内嵌歌词、封面和歌曲 metadata
- `/stage/status` 只表示外部推送输入状态；播放器真实状态请使用 `/stage/player/status`
- `/stage/player/play` 只触发 Folia 主播放器，不负责回写当前 Stage 输入状态
