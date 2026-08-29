# folia-wallpaper-helper

Windows 桌面壁纸模式的辅助进程。由 Electron 主进程（`electron/windowsWallpaperController.cjs`）
spawn，负责把 Folia 主窗口挂入桌面图标层之下的 WorkerW 层、转发桌面鼠标输入，并在 explorer
重启 / WorkerW 重建时自行重挂。

协议（详见 `src/cli.rs` 与 `src/events.rs`）：

- 命令行：`attach --hwnd <n> [--forward-mouse] [--zguard]`（常驻）、`move --hwnd <n>`、
  `detach --hwnd <n>`（一次性）。
- stdin：`detach`（常驻进程退出前先还原窗口）。stdin EOF 同样触发还原。
- stdout：JSONL 事件
  `{"event": "attached"|"heartbeat"|"workerw-destroyed"|"explorer-restarted"|"reasserted"|"moved"|"detached"|"mousemove"|"mousedown"|"mouseup"|"mousewheel"|"error", ...}`。
  鼠标事件（`--forward-mouse` 时，96-DPI 虚拟化屏幕坐标，与 Electron DIP 空间一致）由主进程
  用 `webContents.sendInputEvent` 注入渲染端；不能直接 PostMessage 给 Chromium 窗口——
  TrackMouseEvent 会因真实光标位于图标层而立刻回发 WM_MOUSELEAVE，导致 hover 在每两条 move
  之间被清空。

构建：Windows 上 `cargo build --release`（由 `packaging/windows/build-wallpaper-helper.mjs`
驱动）；纯逻辑单测（CLI 解析、JSONL 事件）可在任意平台 `cargo test`，Windows 相关模块
被 `#[cfg(windows)]` 门控。

## 代码来源与许可

本 crate 随 Folia 以 **AGPL-3.0** 发布。取用的上游实现：

| 模块 | 来源 | 许可证 |
| --- | --- | --- |
| `attach.rs` | Seelen UI `wallpaper_manager/{mod,handlers}.rs` | AGPL-3.0 |
| `attach.rs` | Lively Wallpaper `DesktopUtil.cs` | GPL-3.0 |
| `mouse_forward.rs` | 行为基准 Lively 机械骨架 electron-as-wallpaper  | GPL-3.0 + MIT |
| `monitor.rs` | TaskbarCreated + PID 比对逻辑译自 Lively `WinDesktopCore.cs`| GPL-3.0 |

上游版权声明已保留在对应文件头中。
