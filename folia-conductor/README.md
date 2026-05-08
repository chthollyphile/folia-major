# Folia Conductor

## 开发指南

### 目录说明

`folia-conductor` 提供一个最小化的 `Stage API controller demo`，用于验证以下链路：

- controller 与一个或多个 Folia Stage 终端建立连接
- controller 推送当前单曲会话
- Folia 回传 `stage_session`、`stage_state` 和 `control_request`
- controller 依据回传结果维护本地播放状态和控制流

当前目录中的主要文件：

- [index.html](/D:/coding/github-repo/folia-major/folia-conductor/index.html)
  页面入口
- [main.ts](/D:/coding/github-repo/folia-major/folia-conductor/main.ts)
  controller demo 的主逻辑
- [style.css](/D:/coding/github-repo/folia-major/folia-conductor/style.css)
  页面样式
- [types.ts](/D:/coding/github-repo/folia-major/folia-conductor/types.ts)
  页面内部类型

### 运行方式

1. 在 Electron 版 Folia 中开启 `Stage Mode`
2. 复制 Folia 设置页中的 `Bearer token`
3. 启动 demo：

```bash
npm run stage:conductor
```

4. 在页面中填写：

- `Stage address`
  默认值为 `http://127.0.0.1:32107`
- `Bearer token`
- `Controller ID`

5. 点击 `Add / Update`
6. 勾选目标客户端
7. 点击 `Connect`

### 页面能力

当前页面提供以下能力：

- 展示已接入 Folia 客户端数量和连接状态
- 上传多个音频文件并生成 controller 播放列表
- 选择当前曲目并推送为新的 `Stage session`
- 使用简化播放器区执行 `Prev / Play / Pause / Next / Seek`
- 显示 Folia 回传的当前曲目信息、时长、播放状态和封面

## Stage 控制模型

Stage 模式采用以下控制模型：

- Folia 作为单曲播放终端
- controller 维护播放列表、当前索引、循环模式和权威时间线
- Folia 通过 `control_request` 上报用户操作
- controller 根据上报结果决定下一步动作，并推送新的 `stage_state` 或新的 `stage/session`

在这一模型下：

- Folia 不维护本地 Stage 播放列表
- controller 切歌时需要重新调用 `POST /stage/session`
- Folia 本地的上一曲、下一曲、暂停、播放、拖动进度条等操作，都会转化为 controller 侧请求

## 典型场景：转发其他音源的歌曲 URL 和歌词文本

常见接入方式是由外部程序从其他音源服务获取：

- `audioUrl`
- `title`
- `artist`
- `album`
- `lyricsText`
- `lyricsFormat`

然后由 controller 将这些数据转发给 Folia。

推荐控制流如下：

1. controller 从自己的播放列表中选出当前曲目
2. 调用 Folia 的 `POST /stage/session`
3. 将 `audioUrl`、`lyricsText` 和元数据发送给 Folia
4. 接收 Folia 返回的 `stage_session`
5. 接收 Folia 返回的 `stage_state`
6. 以 Folia 返回的 `durationMs`、`playerState`、`currentTimeMs` 为准，启动或修正 controller 本地挂钟
7. 持续监听 Folia 发回的 `control_request`
8. 根据请求类型决定是否切歌、暂停、继续播放或更新当前时间

## HTTP 接入示例

### `POST /stage/session`

当外部程序已经拿到以下数据时：

- 歌曲 URL：`https://example.com/audio/song.mp3`
- 歌词文本：LRC / VTT / YRC 任一格式
- 标题、艺人、专辑

可以直接向 Folia 发送：

```http
POST /stage/session
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "title": "Example Song",
  "artist": "Example Artist",
  "album": "Example Album",
  "audioUrl": "https://example.com/audio/song.mp3",
  "lyricsText": "[00:00.00]Example lyric",
  "lyricsFormat": "lrc"
}
```

### JavaScript 示例

```ts
const pushStageSession = async (token: string) => {
  const response = await fetch("http://127.0.0.1:32107/stage/session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "Example Song",
      artist: "Example Artist",
      album: "Example Album",
      audioUrl: "https://example.com/audio/song.mp3",
      lyricsText: "[00:00.00]Example lyric",
      lyricsFormat: "lrc",
    }),
  });

  return response.json();
};
```

### 成功后的返回行为

推送成功后，Folia 会依次完成以下动作：

- 装载当前单曲 session
- 尝试自动播放
- 回传 `stage_session`
- 回传包含 `durationMs / playerState / currentTimeMs` 的 `stage_state`

controller 应以 Folia 回传的实时状态为准更新本地挂钟和 UI。

## WebSocket 接入示例

### 连接地址

controller 需要连接：

```text
ws://127.0.0.1:32107/stage/ws?token=<TOKEN>
```

### 首条消息

连接建立后，controller 应首先发送：

```json
{
  "type": "hello",
  "payload": {
    "role": "controller",
    "controllerId": "my-stage-controller"
  }
}
```

### 浏览器示例

```ts
const ws = new WebSocket(`ws://127.0.0.1:32107/stage/ws?token=${token}`);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    type: "hello",
    payload: {
      role: "controller",
      controllerId: "my-stage-controller",
    },
  }));
});

ws.addEventListener("message", async (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "control_request") {
    const request = message.payload;

    if (request.type === "next") {
      await pushNextSongFromMyQueue();
      return;
    }

    if (request.type === "prev") {
      await pushPrevSongFromMyQueue();
      return;
    }

    if (request.type === "pause") {
      broadcastPausedState(request.payload?.timeMs ?? 0);
      return;
    }

    if (request.type === "play") {
      broadcastPlayingState();
      return;
    }

    if (request.type === "seek") {
      broadcastSeekedState(request.payload?.timeMs ?? 0);
    }
  }
});
```

## `control_request` 处理规范

`control_request` 表示 Folia 终端上的用户操作请求。controller 需要根据请求类型决定后续行为。

### `next`

- 从 controller 自己维护的播放列表中计算下一首
- 调用新的 `POST /stage/session`

### `prev`

- 从 controller 自己维护的播放列表中计算上一首
- 调用新的 `POST /stage/session`

### `pause`

- 将 controller 当前状态更新为 `PAUSED`
- 以 Folia 回传的 `timeMs` 为准
- 广播新的 `stage_state`

### `play`

- 将 controller 当前状态更新为 `PLAYING`
- 启动 controller 本地挂钟
- 广播新的 `stage_state`

### `seek`

- 将 controller 当前时间更新为 `timeMs`
- 广播新的 `stage_state`

## `stage_state` 字段建议

`stage_state` 是 controller 的权威播放态快照。建议至少维护以下字段：

- `revision`
- `sessionId`
- `currentTrackId`
- `playerState`
- `currentTimeMs`
- `durationMs`
- `loopMode`

`tracks` 可以作为 controller 自己的播放列表元数据保留。Folia 在 Stage 模式下不会将其作为本地播放队列使用。

## 歌词格式支持

Folia 会复用自身的歌词解析链。controller 提供的 `lyricsText` 或 `lyricsFile` 支持：

- `lrc`
- `enhanced-lrc`
- `vtt`
- `yrc`

如果歌词解析失败：

- 音乐播放会继续进行
- 当前 session 会按无歌词模式处理

## 推荐的 controller 结构

对于“外部音源转发器”类型的项目，建议按以下模块拆分：

### 1. Source Adapter

负责从其他音源获取：

- `audioUrl`
- `title`
- `artist`
- `album`
- `lyricsText`
- `lyricsFormat`

### 2. Queue Store

负责维护 controller 自己的播放列表和当前索引：

- `tracks[]`
- `currentIndex`
- `loopMode`

### 3. Folia Transport

负责与 Folia 通信：

- `POST /stage/session`
- `WS /stage/ws`
- `stage_session`
- `stage_state`
- `control_request`

### 4. Clock

负责 controller 本地挂钟：

- `PLAYING` 时推进时间
- `PAUSED` 时冻结时间
- `seek` 时修正时间

## 与当前 demo 的对应关系

当前 `folia-conductor` 目录提供的是最小接入样例，重点用于验证以下能力：

- 多个 Folia 客户端的接入状态
- 当前单曲 session 的推送
- Folia 回传的 metadata、时长和控制请求
- controller 本地的播放控制闭环

如果你准备实现自己的第三方音源转发器，可以复用相同的通信协议：

- 保留 `POST /stage/session`
- 保留 WebSocket `hello / control_request / stage_state`
- 将本地上传播放列表替换为自己的在线音源列表
- 将歌词输入替换为自己的歌词服务

## 快速总结

将外部音源 URL 和歌词文本接入 Folia 的标准流程如下：

1. controller 选出当前曲目
2. 调用 `POST /stage/session`，发送 `audioUrl + lyricsText`
3. 保持 `/stage/ws` 连接
4. 接收 Folia 回传的 `stage_session` 和 `stage_state`
5. 依据实时状态启动或修正 controller 挂钟
6. 接收 `next / prev / seek / play / pause` 的 `control_request`
7. 由 controller 决定切歌或状态更新，并继续向 Folia 推送结果
