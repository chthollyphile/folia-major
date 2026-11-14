# 假平台网络（`test/manual/fakeSourceNetwork/`）

桌面实测时把一家音源的网络换成假应答，模组本身原样跑。Folium 2.0 S5 迁波点时做的，后面八家照着加一张路由表就能用。

**它证明的是管道**（模组注册、`folium.rpc`、`api.legacy.store` / `api.seal`、`api.net`、`api.media` 的跨域规则、登录窗口、曲库、播放器），**证明不了真实接口的兼容性**：假应答的形状照上游库读的字段拼，上游或平台变了它照样通过。真实接口仍要在能直连平台的网络下实测。

| 文件 | 是什么 |
| --- | --- |
| `fakeSourceNetwork.mjs` | 入口：本机 HTTP 代理（只接路由表里的域名，在本机终止 TLS）、PAC、控制接口、请求日志，写出 `install.js` / `uninstall.js` |
| `fakeMedia.mjs` | 路由表共用的媒体：单色 PNG、自己生成的 WAV 音调、按 Range 分段 |
| `bodian.mjs` | 波点的路由表（依据见文件头） |

## 用法

1. 起假网络（后台）。证书用 openssl 现做（Git Bash 自带），产物默认在系统临时目录 `folia-fake-<平台>/`：

   ```bash
   node test/manual/fakeSourceNetwork/fakeSourceNetwork.mjs bodian --port 39871 --out <scratchpad>/fake-bodian
   ```

2. 起桌面（`skills/run-desktop`，**带 `--keep-profile`**，不带会删 `test-results/run-desktop/userdata`）：

   ```bash
   node skills/run-desktop/driver.mjs serve --keep-profile
   ```

3. 装到默认会话上（回答里 `proxy` 应是 `PROXY 127.0.0.1:<端口>`，`direct` 是 `DIRECT`）：

   ```bash
   node skills/run-desktop/driver.mjs main-eval "$(cat <scratchpad>/fake-bodian/install.js)"
   ```

4. 测。每个到了假服务的请求都在 `<out>/requests.jsonl` 里（含 `uid` / `token` 请求头），用它确认请求真的换过来了。控制：`curl http://127.0.0.1:<端口>/__control/scan`（波点：手机扫码并确认）、`/__control/state`（波点：红心与自建歌单的当前内容）。
5. 收尾：`main-eval "$(cat <out>/uninstall.js)"`，`driver.mjs quit`，停掉假网络的 node 进程。

## 注意

- 只换 **Electron 默认会话**（`session.defaultSession` 的 PAC 和证书校验）：主进程里 `api.net.fetch` / `api.net.request` 不带 `session`、窗口里的 fetch 与 `<audio>` 都在默认会话上。音源用 `api.net.session(name)` 的命名分区时，要在 `install.js` 里对那个分区再装一遍（还没做，ytm、spotify 迁的时候加）。
- 证书校验只对路由表里的域名、并且签发者是这张证书（CN `folia-fake-source-network`）时放行，别的一律照 Chromium 自己的结果；这会**替换**默认会话已有的 `setCertificateVerifyProc`（主进程现在没有设，酷狗那条证书例外走的是 `app.on('certificate-error')`，不受影响）。
- `install.js` 之前发出的请求走的是真网络（例如启动时的账号读取）。要从一开始就假，先 `main-eval` 装好再 `reload`。
- 不改任何启动参数；绝不要给 Electron 加 `--ignore-gpu-blocklist`。
- 这个目录不在单测的收集范围（`test/unit/**`）里，也不进打包。

## 加一家

写 `<平台>.mjs`，默认导出 `{ hosts, createState(), handle({ host, url, method, headers, body, state }), control? }`：`handle` 回 `{ status?, headers?, body }`（`body` 是对象就按 JSON 回，`Buffer` 原样回），不认的回 `null`（404）。形状的依据写在文件头（上游库读哪些路径和字段、单测里的样本），不凭空编。
