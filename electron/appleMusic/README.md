# Apple Music companion

Folia 的主 Electron 不变。独立系统 WebView 加载 `music.apple.com`，由 Apple 官方页面完成登录和 DRM 播放。
Folia 通过私有 stdin/stdout 管道请求搜索、资料库、歌词与播放控制；凭据保留在独立 profile，不返回渲染进程。

## macOS 14+

```sh
sh electron/appleMusic/macos/buildCompanion.sh
npm run dev:electron
```

开发与生产只使用原生 WKWebView，不再支持 CastLabs 或旧的 Electron 运行时环境变量。
开发输出为 `build/apple-music-native/FoliaAppleMusicCompanion.app`，可用 `FOLIA_APPLE_MUSIC_NATIVE`
指定绝对可执行文件路径。未编译时返回运行时不可用，不回退到其他浏览器。

正式打包的 `beforePack` 按目标架构编译独立宿主，复制到 Resources/apple-music；`afterPack` 检查文件完整性。
支持 x64/arm64 分开构建，不复用当前机器架构的产物。`nativePaths.cjs` 在安装包中只解析 Resources 路径，
忽略开发环境覆盖。宿主默认隐藏、无 Dock 图标；仅登录时显示，登录结束后隐藏全部所属窗口。

真实 macOS 开发版已验证登录、隐藏播放、会话恢复、暂停/跳转/切歌与歌词结构，用户确认 Folia 播放与切歌正常。
正式安装包的安装、签名/公证、Intel 和系统版本兼容性仍须验收；系统 WebView 不需要 EVS，
这不免除应用分发本身的签名/公证工作。
[macOS 验证说明](../../test/manual/appleMusic/macos/README.md)。

## Windows 与 Linux

Windows 使用 .NET Framework 4.8 / WebView2 Evergreen 宿主，2026-11-04 起在 Windows 11 实测登录与整首播放，
从 0.7.26 起默认启用：打包时 `build/beforePack.cjs` 用 MSBuild 编译（只支持 x64），随安装包放进
`resources/apple-music/windows/`，`build/afterPack.cjs` 核对文件齐全。[构建与验收说明](windows/README.md)。
Linux 入口显示「Linux 暂未支援」，不保留备用浏览器运行时。

## 模块

- `companionClient.cjs`：请求关联、超时和启动/退出；只启动原生宿主。
- `nativePaths.cjs`：开发输出、正式资源与平台启用策略。
- `nativeSpawn.cjs`：私有管道适配、文档代数、退出登录清理与超时换页恢复。
- `macos/`、`windows/`：各自系统 WebView、导航白名单和登录窗口管理。
- `companionRequests.cjs`：操作白名单、参数验证、串行调度与注入页面的受限读取函数。音量（`setVolume`，0–1 线性）也在这里写进页面的 MusicKit，和播放命令同一条串行链。
- `companionQueue.cjs`：最多两首后继的队列预备和复用。
- `companionFavorites.cjs`、`companionPlaylist.cjs`：喜爱与歌单写入，不自动重试可能已成功的追加。
- `companionStorefront.cjs`：将页面地区跟随账号，避免跨区目录导致队列就绪却无法播放。

网页不能调用本地控制接口或文件操作；导航仅允许 Apple 音乐与登录主机。退出登录先销毁旧页面再清空宿主会话。
原生 named store 与旧浏览器资料分开，不复制或删除用户旧凭据。
收藏/歌单写入参数兼容已修正，真实写入仍由用户手动验收；单测替身通过不代表上游接口始终可用。

## 搜寻与电台

搜寻使用当前选取的平台；播放 Apple Music 歌曲不会改变目前的搜寻来源。
选择 Apple Music 后，搜寻经 Omni → Apple Music provider → companion → Apple 目录搜寻。

Apple Music 的电台页提供个人 FM 与当前地区可用的直播电台卡片。个人 FM 读取账号自己的 personal station，
通过 Apple MusicKit 使用的固定 `stations/next-tracks` POST 取得每批两首，沿用 Folia 补歌与歌曲队列；
读取推荐不会调用 setQueue 或中断当前播放。直播卡片先进入只有一个直播项目的集合，播放时使用 MusicKit station 参数，
持续跟随该台，不将节目歌曲变化当成 Folia 换歌。直播无歌曲长度、逐词歌词与拖动时间轴，暂停/继续仍走原生播放器。

2026-11-03：真实 macOS 中国大陆会话验证 Apple Music 搜寻返回 3 项、个人 FM 返回 2 首，
实际播放首首后 isPlaying=true、位置推进到 2 秒，再暂停。该地区 featured live radio 返回空数组，
因此直播的真实出声、节目切换与地区覆盖仍须在 Apple 提供直播电台的账号地区验收；不硬编码或切换地区绕过结果。

## 慢网络下的启动与列表

歌曲佇列准备完成后，起播请求不等待 `play()` 的缓冲完成；延后拒绝经播放状态查询报告。
暂停、恢复与手动跳转会更新当前起播尝试，旧回调不能覆盖较新的操作。
数据读取复用当前页面的 storefront；账号状态检查强制刷新，页面替换或退出登录后不沿用旧缓存。
歌单默认先返回列表，不等待逐张歌曲数量请求。未知数量保持未设置；显式数量读取仍可启用，
目前没有后台数量补齐的界面通知机制。

中文地区的拉丁字母歌曲，在原名称没有可靠的自动歌词匹配时，可按目录 ID 只读查询日本目录的日文曲名与歌手，
并以这一对名称重试；已有原生逐词歌词时不查询。结果（包括未找到）在当前网页会话中按目录 ID 缓存；暂时请求错误不缓存，播放地区不变。
中国大陆真实账号已验证歌曲 1588262504 的日本目录返回所需原文；匹配结果仍取决于歌词来源及曲库。
