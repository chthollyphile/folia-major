# Stage API Docs Console

这个目录现在提供的是新版本地 Stage API 文档式联调台。

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
- `POST /stage/play` 通过搜索结果按钮联动触发，便于模拟真实对接流程

调试台当前覆盖这些接口：

- `GET /stage/health`
- `GET /stage/status`
- `POST /stage/lyrics`
- `POST /stage/session`
- `POST /stage/search`
- `POST /stage/play`
- `DELETE /stage/state`

如果上传的是音频文件，Folia 还会尝试直接读取文件内嵌歌词、封面和歌曲 metadata。歌词仍然是可选的；如果提供了歌词，Stage 会复用 Folia 自己的解析链来尝试解析，失败时会降级成无歌词播放。
`Lyrics format` 可以保持 `auto-detect`，或者显式指定 `lrc`、`enhanced-lrc`、`vtt`、`yrc`。
`POST /stage/play` 默认会立即播放指定歌曲；如果传入 `appendToQueue: true`，则会把歌曲追加到 Folia 主播放器队列，而不会打断当前播放。

## 接口说明

- `GET /stage/health`
  用于返回 Stage 服务自身是否可用，适合做最轻量的连通性探测，不依赖播放器当前状态。

- `GET /stage/status`
  用于返回当前 Stage 会话状态，通常包括最近一次写入的歌词、媒体、搜索上下文或运行态摘要。

- `POST /stage/lyrics`
  用于写入一份 parser-compatible 的歌词载荷，让 Folia 按自身歌词解析链接管并更新当前 Stage 歌词状态。

  注意这个接口的功能相当于直接播放一个无音频的歌词文件，而不是在当前媒体上下文中附加歌词；如果需要后者，请使用 `POST /stage/session` 上传一个包含内嵌歌词的媒体会话。

- `POST /stage/session`
  用于写入媒体会话数据，可以是 JSON 形式的媒体描述，也可以是 multipart 形式的实际文件上传。

- `POST /stage/search`
  用于把外部搜索请求转交给 Folia 当前接入的搜索通道，返回可供后续播放接口消费的候选结果。

- `POST /stage/play`
  用于请求 Folia 主播放器播放一首歌，支持直接播放，也支持通过 `appendToQueue: true` 仅追加到主队列。

- `DELETE /stage/state`
  用于清空当前 Stage 持有的会话状态，通常会移除已注入的歌词、媒体上下文和相关临时数据。

补充约束：

- 除 `GET /stage/health` 之外，其余接口都需要 Bearer token
- `POST /stage/session` 支持 JSON 和 multipart 两种传输方式
- 上传音频文件时，Folia 会尝试读取内嵌歌词、封面和歌曲 metadata
- `POST /stage/play` 只触发 Folia 主播放器，不负责回写当前 Stage 输入状态

# Stage API 示例

## Bili Live Song Demo
您可以在 `test/manual/bili-livesong/main.py` 中找到一个使用 `POST /stage/search` 和 `POST /stage/play` 的示例程序，展示了如何监听 B 站直播间的弹幕，并将符合条件的点歌请求发送到本地播放器接口。