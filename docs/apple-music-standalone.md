<!-- docs/apple-music-standalone.md -->

# Apple Music 独立播放（开发预览）

Apple Music 接入现有账号菜单。用户点击连接后直接进入一个 Apple 官方授权窗口，不需要选择播放后端或填写开发者 token。隔离 MusicKit 窗口负责订阅检查、DRM 播放及 Apple 数据请求；其他界面沿用 Omni、Folia 队列、歌词解析器和播放控制。

## 发布维护者配置

在 `electron/appleMusic/config.cjs` 配置自己的 HTTPS `developerTokenEndpoint`，返回 JSON `{ "token": "已签名的 MusicKit developer JWT" }`。也可用 `FOLIA_APPLE_MUSIC_TOKEN_URL` 在构建/运行环境中覆盖服务地址。本地开发可通过 `FOLIA_APPLE_MUSIC_DEVELOPER_TOKEN` 提供临时 token，但不能作为要求普通用户填写的设置。

签发服务由维护者运营，Apple 私钥保留在服务端。客户端获取的是已签名 token，不向该服务发送 Apple 用户 token。此 PR 不提供签名私钥、第三方 token 或第三方签发服务。具体签发规则参见 [Apple developer token 文档](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)。

只有桌面运行时具备组件 API 且维护者配置了 token 来源，账号菜单才启用连接。真正登录前还会通过 Apple `/v1/test` 校验 token，再等待 Widevine 就绪。

签发响应在主进程中缓存，有效期不足五分钟时重新请求；短暂故障只在旧 token 仍有效时继续使用。每次播放器操作都会检查缓存的 token 来源；若 token 已更新，则重新配置 SDK，恢复 Folia 当前曲目、进度、音量及暂停状态。此恢复流程已有单测，真实续期仍需自有开发者身份验收。

## 运行时与边界

- CastLabs Electron 43.5.0+wvcus 提供 Widevine，`electronDist` 确保打包使用同一运行时。替换会影响所有桌面平台；发布说明和生产 VMP 要求参见 [CastLabs 文档](https://github.com/castlabs/electron-releases)。
- MusicKit 使用固定回环来源 `http://127.0.0.1:10768`，本机 HTTP 仅返回静态文件，不返回任何凭证或账号信息。
- 隔离会话为 `persist:folia-apple-music`；启用 sandbox/contextIsolation，禁用 Node，原生 IPC 只接受主窗口主 frame 的受限操作。
- 不关闭 webSecurity，不改写 Apple 的 Origin/Referer 或 CORS 响应，也不修改 Apple SDK；开发者身份必须允许实际应用来源。
- Apple 用户授权与应用 token 分离，退出登录通过 MusicKit `unauthorize()` 清除授权。
- 歌词请求严格匹配数字 catalog 歌曲 ID，由隔离会话访问固定 `amp-api.music.apple.com` HTTPS 主机并禁止重定向；404 可回退到逐行歌词，网络/权限故障不作为无歌词成功。该网页歌词接口并未确认属于公开 MusicKit API 合同，需要单独评估稳定性及自有身份可用性。

## 能力范围

已实现搜索、个人歌单、专辑／歌手详情、资料库专辑及全部歌曲，以及 catalog/library 播放、订阅检查、暂停/恢复、音量、定位、播放时钟与自动续播。数据通过 `appleMusicProvider.ts` 和 `appleMusic/transport.ts` 归一化后进入 Omni；播放通过 `remotePlayback.ts`，不存在音频下载 URL。

- 临近结束时预排下一首，后端已切到目标曲目时继续播放，避免重新加载；音质偏好映射为 MusicKit 的 64/256 kbps 两档。
- 远程播放时钟驱动系统媒体会话与桌面控制。轮询造成的小幅时间回退会暂时停在已显示的位置，等待后端追上，避免歌词跨行后又退回；手动定位、切歌和明显的进度跳变仍立即生效。
- Apple TTML 逐字时序优先保留，跨来源匹配只补充翻译。本地文件的 ISRC 可通过 Omni 精确匹配 Apple 曲目，元数据保留 provider 身份。
- 推荐集合整合个性化推荐、常听内容与榜单；每日推荐使用个人 mix 或最近播放，FM 使用推荐歌单的打乱片段，并非 Apple 电台流。
- 喜欢映射为 Apple 评分；喜欢列表扫描最近加入资料库的最多 1000 首歌曲。可向有编辑权限的资料库歌单追加歌曲，可将专辑／歌单加入资料库；暂不支持移除歌单曲目或取消资料库收藏。

下载、音频缓存、均衡器、音频分析/转发与 Automix 暂不支持 Apple Music。新增账户写入及推荐功能已有 mock 测试，仍需使用维护者身份进行实际验收。

## 验收状态与发布阻塞

此前本机 Linux 原型已实际验证授权、订阅、个人曲库、完整音轨访问、超过试听时长的持续播放、定位、暂停/恢复、歌词和自动切歌。该验证使用第三方开发者 token 与仅本机的来源兼容；这些兼容和桥接代码已从本贡献分支移除。因此原型成功不能作为当前分支在自有身份下的正式验收。

正式合入前需要完成：

- 用维护者自己的 token、真实应用来源验证授权、播放、歌词及运行中续期。
- 全新 profile 下的 Widevine 获取；原型测试使用了本机已有 CDM，尚未完成新机器安装验收。
- Windows/macOS 构建、运行和发布签名验证，以及原有账号、播放和桌面功能回归。
- Linux 壁纸模式：原型在 windowtolayer 启动后发生 Chromium zygote SIGTRAP，持久化模式导致下次启动也失败；尚未确定是否为更换 Electron 引入。恢复普通窗口只需在应用退出后将用户配置中的 `wallpaper_mode` 改为 false，但这不是根因修复。

当前实现应以 Draft 讨论。无需 Apple 订阅的测试包含 provider/IPC 边界、token 获取/更新、授权生命周期、播放器控制和 UI mock；这些测试不能替代上述真实验收。
