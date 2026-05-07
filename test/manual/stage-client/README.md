# Stage Controller Console

这个目录现在提供的是新版 Stage API 的手工调试台，而不再只是单次 `POST /stage/session` 示例页。

运行方式：

```bash
npm run stage:client
```

页面能力：

- 管理多个 Electron Folia Stage 实例
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
- `Auto-apply incoming control_request` 打开后，页面会把 Folia 发来的本地控制请求结算成新的 `stage_state`
- `Broadcast state to all selected instances` 打开后，单个实例收到的控制请求会同步广播到所有选中实例，适合测试多实例一致性
