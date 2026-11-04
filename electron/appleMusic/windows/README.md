# Windows WebView2 companion（待实机验证）

已提供 Windows 源码与 Folia 开发接入，但尚未在 Windows 编译或验证 Apple Music 的 DRM 出声。
macOS 上通过的 WKWebView 测试不代表 WebView2 通过。默认 Windows 登录行保持停用并显示验证中，
仅开发者明确开启实验标志后允许试用。

## 依赖与构建

- Windows x64，.NET Framework 4.8。
- Visual Studio 2022 / Build Tools（含 .NET SDK）：安装「.NET 桌面生成工具」工作负载及 .NET 桌面开发、.NET Framework 4.8 targeting pack 与 MSBuild。
- Microsoft Edge WebView2 **Evergreen Runtime**。SDK 不包含浏览器运行时；不要用 Fixed Runtime
  的结果代替 Evergreen 验证，DRM 支持可能不同。
- `Microsoft.Web.WebView2` SDK 钉死为 `1.0.4314.35`，由 NuGet 还原。没有打包独立的 .NET/CoreCLR。

在仓库根目录 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File electron/appleMusic/windows/buildCompanion.ps1
$env:FOLIA_APPLE_MUSIC_WINDOWS_EXPERIMENTAL = '1'
npm run dev:electron
```

输出为 `build/apple-music-native/windows/FoliaAppleMusicCompanion.exe`，开发版发现后优先使用。
也可以通过 `FOLIA_APPLE_MUSIC_NATIVE` 指定可执行路径。构建输出与中间文件不进 Git。
正式安装包配套分发、安装运行时的引导及代码签名尚未接入。

## 结构与边界

`nativeCompanion.cs` 负责进程、私有 JSON 行控制、profile 锁和退出；`webViewHost.cs` 管 WebView2、
导航、登录弹窗与求值；`navigationPolicy.cs` 限制 Apple 域名；`jsonLineProtocol.cs` 限制消息体大小。
使用现有父进程请求白名单、串行队列、过期文档检查和超时恢复，macOS/Windows 共用 `nativeSpawn.cjs`。

默认窗口及任务栏入口隐藏，只有登录操作显示。每个 profile 的 WebView2 数据保存在其独立子目录，
不复制系统浏览器或 CastLabs 的凭据。退出登录先替换成空页，再清理该 WebView2 profile。
网页消息只能完成带 nonce 与文档代数的求值回报，不能执行 show/hide、导航、清理或文件操作。

## Windows 验收清单

- [ ] 构建成功，确认 WebView2 loader 与托管程序集在输出目录。
- [ ] Evergreen Runtime 缺失时能诊断，安装后可重试。
- [ ] 官方页登录、地区跟随、重启保留登录，退出登录清理。
- [ ] 超过 30 秒且整首有声播放；区分界面加载、队列就绪与 DRM 成功。
- [ ] 隐藏播放、暂停/恢复、seek、预备/手动/自动下一首及歌词。
- [ ] 登录弹窗初始化期间关闭登录面板，确认初始化完成后不重新弹出；再次打开面板可恢复弹窗。
- [ ] 登录弹窗、父进程退出、网络异常与 WebView2 崩溃恢复。
- [ ] 正式安装包、系统版本和架构范围。

Linux 不启动该宿主，Apple Music 登录行显示「Linux 暂未支援」。

## Windows 11 用户实测（2026-11-04）

用户确认安装 WebView2、使用实验开关后，官方登录、整首播放以及 TTML 逐词歌词正常，DRM 有声超过 30 秒。
首次打开登录窗口曾被其他窗口遮挡；当前代码在显示期间启用任务栏按钮，隐藏时关闭，仍需 Windows 实机复测。
构建脚本明确使用 NuGet.org；固定的宿主生命周期诊断经受限通道进入 Folia 日志，不转发网页或运行时原始输出。
