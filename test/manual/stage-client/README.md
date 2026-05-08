# Stage Controller Console

这个目录现在提供的是新版 Stage API 的播放器控制 demo。它保留底层 HTTP / WS 调试能力，但主界面已经改成围绕“播放列表 + 当前曲目 + 进度条 + 多实例同步”的控制台。

运行方式：

```bash
npm run stage:client
```

页面能力：

- 管理多个 Electron Folia Stage 实例
- 导入多首音频文件，直接建立 controller 播放列表
- 把当前表单草稿追加成一个 playlist track
- 显示从 Folia 回读的当前曲目、播放状态、当前时间和总时长
- 通过进度条直接发起 `seek`
- 用 `Prev / Play / Pause / Next / Cycle Loop` 模拟外部 controller 控制流
- 对选中实例执行 `GET /stage/health`
- 对选中实例执行 `POST /stage/session`
- 对选中实例执行 `DELETE /stage/session`
- 通过浏览器 `WebSocket` 连接 `/stage/ws?token=...`
- 自动发送 controller `hello`
- 查看 `server_hello`、`hello_ack`、`stage_session`、`stage_session_cleared`、`control_request`、`error`
- 编辑并广播权威 `stage_state`
- 在页面内直接执行 `play / pause / seek / next / prev / cycle loop`
- 把同一份状态广播给多个已连接实例

说明：

- 浏览器端不能给 `WebSocket` 带自定义 `Authorization` header，所以这里使用查询参数 `?token=...`
- `Tracks JSON` 用于构造多曲目 queue；如果留空，会用上面的单曲字段生成一首歌
- 播放列表存在时，播放器 demo 会优先用 playlist tracks 来生成 `stage_state.tracks`
- `Auto-apply incoming control_request` 打开后，页面会把 Folia 发来的本地控制请求结算成新的 `stage_state`
- `Broadcast state to all selected instances` 打开后，单个实例收到的控制请求会同步广播到所有选中实例，适合测试多实例一致性
