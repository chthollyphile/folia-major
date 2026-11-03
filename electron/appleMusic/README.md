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

Windows 已提供 .NET Framework 4.8 / WebView2 Evergreen 宿主源码，未编译或验证 DRM，默认停用。
仅开发实验开关允许启用；[构建与验收说明](windows/README.md)。正式包不分发 Windows 宿主。
Linux 入口显示「Linux 暂未支援」，不保留备用浏览器运行时。

## 模块

- `companionClient.cjs`：请求关联、超时和启动/退出；只启动原生宿主。
- `nativePaths.cjs`：开发输出、正式资源与平台启用策略。
- `nativeSpawn.cjs`：私有管道适配、文档代数、退出登录清理与超时换页恢复。
- `macos/`、`windows/`：各自系统 WebView、导航白名单和登录窗口管理。
- `companionRequests.cjs`：操作白名单、参数验证、串行调度与注入页面的受限读取函数。
- `companionQueue.cjs`：最多两首后继的队列预备和复用。
- `companionFavorites.cjs`、`companionPlaylist.cjs`：喜爱与歌单写入，不自动重试可能已成功的追加。
- `companionStorefront.cjs`：将页面地区跟随账号，避免跨区目录导致队列就绪却无法播放。

网页不能调用本地控制接口或文件操作；导航仅允许 Apple 音乐与登录主机。退出登录先销毁旧页面再清空宿主会话。
原生 named store 与旧浏览器资料分开，不复制或删除用户旧凭据。
收藏/歌单写入参数兼容已修正，真实写入仍由用户手动验收；单测替身通过不代表上游接口始终可用。
