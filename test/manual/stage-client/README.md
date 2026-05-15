# Stage API Console

这个目录现在提供的是新版本地 Stage API 调试台。

运行方式：

```bash
npm run stage:client
```

页面能力：

- 检查 `GET /stage/health`
- 检查 `GET /stage/status`
- 触发 `DELETE /stage/state`
- 通过 `POST /stage/line` 推送一句歌词和可选翻译
- 通过 `POST /stage/session` 推送 URL 或上传文件形式的媒体会话
- 通过 `POST /stage/search` 搜索网易云歌曲
- 通过 `POST /stage/play` 从外部请求 Folia 主播放器点歌

说明：

- 除 `GET /stage/health` 之外，其余接口都需要 Bearer token
- `POST /stage/session` 仍支持 JSON 和 multipart 两种传输方式
- 上传音频文件时，Folia 会尝试读取内嵌歌词、封面和歌曲 metadata
- `POST /stage/play` 只负责触发 Folia 主播放器播放，不会写入当前 Stage 输入
