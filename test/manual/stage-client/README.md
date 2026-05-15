# Stage API Console

这个目录现在提供的是新版本地 Stage API 调试台。

## Stage 联调客户端

如果你已经在桌面端开启了 Stage Mode，可以使用仓库内置的本地 Stage API 调试台向 Folia 推送完整歌词对象、推送媒体会话，或者从外部程序触发搜索与点歌。

1. 在 Folia 设置中开启 Stage Mode，并复制 Bearer token
2. 运行：

```bash
npm run stage:client
```

3. 页面打开后填写：

- Stage 地址，默认 `http://127.0.0.1:32107`
- Bearer token
- 需要推送的歌词、媒体或搜索关键词

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

## 说明

页面能力：

- 检查 `GET /stage/health`
- 检查 `GET /stage/status`
- 触发 `DELETE /stage/state`
- 通过 `POST /stage/lyrics` 推送一份 parser-compatible 完整歌词对象
- 通过 `POST /stage/session` 推送 URL 或上传文件形式的媒体会话
- 通过 `POST /stage/search` 搜索网易云歌曲
- 通过 `POST /stage/play` 从外部请求 Folia 主播放器点歌

说明：

- 除 `GET /stage/health` 之外，其余接口都需要 Bearer token
- `POST /stage/session` 仍支持 JSON 和 multipart 两种传输方式
- 上传音频文件时，Folia 会尝试读取内嵌歌词、封面和歌曲 metadata
- `POST /stage/play` 只负责触发 Folia 主播放器播放，不会写入当前 Stage 输入
- 搜索结果既可以直接播放，也可以通过 `appendToQueue: true` 追加到主播放队列
