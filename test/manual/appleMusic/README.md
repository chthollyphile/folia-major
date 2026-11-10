# Apple Music 原生逐词歌词探针

这个手动探针用于验证 Apple Music 网页会话的 `syllable-lyrics` 接口是否返回带逐词时间的 TTML。它只打印状态、带时间的元素数量和 XML 解析状态，不输出歌词正文或账号凭据。这个接口没有确认属于 Apple 的公开契约；探针不是 companion 的正式实现。

在本机隔离的测试资料目录中启动已准备好的 Sidra 参考环境，并只在测试期间开启本机调试端口。例如在 Sidra 仓库运行：

```bash
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --user-data-dir=/绝对路径/隔离测试资料 --remote-debugging-address=127.0.0.1 --remote-debugging-port=19225
```

用户自行在 Apple 官方窗口登录，并播放一首已确认 Apple Music 提供逐词歌词的歌曲；然后在 Folia 仓库运行：

```bash
node test/manual/appleMusic/checkLyrics.cjs
```

默认查询已登录账号的 storefront；它可能与网页当前显示的地区不同。需要对比指定地区时，可传入两位小写地区代码，例如 `node test/manual/appleMusic/checkLyrics.cjs cn`；这是诊断用途，不表示正式产品应擅自切换地区。

- `no-current-track`：网页尚未提供当前歌曲或 MusicKit 尚未就绪。
- `lyrics-api-unavailable`：当前网页的 MusicKit 没有探针认识的请求方法。
- `storefront-unavailable`：没有指定地区且无法读取已登录账号的 storefront。
- `request-failed`：网页歌词请求失败，若可用则显示 HTTP 状态；不要据此判断歌曲没有歌词或推断具体失败原因。
- `no-ttml`：请求返回的数据没有 TTML；不能据此断言歌曲没有歌词。
- `ok`：成功取得 TTML。`timedLineCount` 是带起止时间的段落数量；`timedSpanCount` 大于零表示存在带起止时间的 span，仍需人工确认这些 span 对应词、时间正确且歌曲来源正确。
- `evaluation-failed` 或进程报错：检查测试窗口和本机调试端口。

测试结束后关闭该调试实例；不要让调试端口在日常使用时保持开放。使用独立测试资料目录，不提交会话文件或将账号信息写入测试记录。
