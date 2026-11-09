# macOS WKWebView 验证

使用与 macOS companion 相同的 Swift 宿主，只在 `--probe` 模式显示验证窗口及每秒播放读数。
需要 macOS 14+ 与 Xcode Command Line Tools；目前实际验证设备为 macOS 15.0.1 / Apple Silicon。
不需要 CastLabs 或 EVS。Swift/系统链接器的本机签名与正式发行签名、公证是不同事项。

## 独立验证窗口

```sh
sh test/manual/appleMusic/macos/buildProbe.sh
./test-results/apple-music-wk-probe/FoliaWKProbe.app/Contents/MacOS/FoliaAppleMusicCompanion --probe
```

终端应保持 stdin 开启。原型使用独立应用标识和 WebKit named store，不读取 Safari 或
CastLabs 的 Cookie。只在 Apple 官方页面输入凭据。不要提交 WebKit 存储、应用包或日志中的个人信息。
诊断输出只保留状态、时间、时长及功能探测结果，不输出歌曲内容、原始错误或令牌。

可写入固定的 JSON 行：

```json
{"operation":"hide"}
{"operation":"show"}
{"operation":"status"}
{"operation":"quit"}
```

## 接回 Folia 开发版

```sh
sh electron/appleMusic/macos/buildCompanion.sh
npm run dev:electron
```

macOS 开发版使用生成的 `build/apple-music-native/FoliaAppleMusicCompanion.app`。
也可用 `FOLIA_APPLE_MUSIC_NATIVE` 指定完整可执行文件路径。未编译时返回运行时不可用。
正式打包已接入按架构编译与资源分发，实际安装包仍待验收。正常模式窗口默认隐藏，只有登录操作显示；无 Dock 图标。
原生首次使用需要重新登入：每个 Folia profile 对应独立的 named store，不迁移旧凭据。

普通进程直接与 Electron 通过私有 stdin/stdout 通讯，网页没有原生 IPC 消息入口。
父进程只发送白名单验证后构造的 JS 表达式，共用现有串行队列、过期文档检查和超时恢复。
控制输入与回复有大小上限，EOF 使宿主退出；profile 文件锁阻止同一 profile 重复启动。

## 导航策略检查

```sh
swiftc -parse-as-library -module-cache-path test-results/apple-music-wk-probe/module-cache \
  electron/appleMusic/macos/navigationPolicy.swift \
  test/manual/appleMusic/macos/navigationPolicyCheck.swift \
  -o test-results/apple-music-wk-probe/navigation-check
./test-results/apple-music-wk-probe/navigation-check
```

## 已验证与待验收

2026-11-03：用户确认官方页面登入后有声音并超过 30 秒；读数曾持续超过 200 秒。
窗口隐藏期间读数从约 5 秒持续前进至 80 秒；重启保留登入。
隔离验证会话中，真实原生控制桥完成账号、搜索、播放推进、暂停、跳到 15 秒、继续、
TTML 读取、后继预备与复用队列切歌（下一首读数继续推进）。

正式原生 profile 已由用户登录，并通过同样的控制测试与重启登入保留检查。
用户已确认 Folia 主界面播放与切歌。长时间/曲末播放、完整歌词视觉效果、退出登录清理、
断网恢复、Intel macOS、旧系统以及实际安装包仍需分别验收。
