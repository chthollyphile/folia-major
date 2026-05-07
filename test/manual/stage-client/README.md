# Stage Client Demo

这个目录提供一个 Stage API 联调页面。

运行方式：

```bash
npm run stage:client
```

然后在浏览器打开的页面中：

页面能力：

- 查看 `GET /stage/health`、`POST /stage/session`、`DELETE /stage/session` 三个接口的用途
- 实时预览页面当前会组装出的请求
- 直接点击按钮发送请求
- 在每个按钮附近查看 Folia 后端的原始返回结果

说明：

- 可以只发送音频，不带歌词
- 如果上传 `audioFile`，Folia 会尝试读取内嵌歌词、封面、标题、艺人和专辑 metadata
- `Lyrics format` 可以留在 `auto-detect`，或者显式指定 `lrc`、`enhanced-lrc`、`vtt`、`yrc`
