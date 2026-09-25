Folia Linux 便携版说明
======================

此压缩包包含以下内容：

- `folia-major`：启动脚本（先抬高文件描述符上限，再启动下面的程序本体）
- `folia-major-app`：程序本体（Electron 可执行文件）
- `resources/linux/icon.png`：应用图标
- `resources/linux/folia-major.desktop`：桌面启动项模板

启动请用 `folia-major`，直接运行 `folia-major-app`而绕过启动脚本，会导致连续播放半小时上下画面卡死。

如何创建桌面启动项：

1. 将桌面模板复制到：
   `~/.local/share/applications/folia-major.desktop`

2. 修改复制后的文件，将以下占位符替换为实际路径：
   `__APP_PATH__`  -> `folia-major` 启动脚本的绝对路径
   `__ICON_PATH__` -> `resources/linux/icon.png` 的绝对路径

示例：
`Exec=/home/yourname/Apps/Folia/folia-major`
`Icon=/home/yourname/Apps/Folia/resources/linux/icon.png`

3. 如果您的桌面环境有要求，请将该 `.desktop` 文件标记为可信或可执行。

Linux 图形兼容性：

- `electron/main.cjs` 默认关闭 Vulkan；AppImage 默认使用 `swiftshader`，普通运行默认使用系统图形路径。
- 如果启动后出现黑屏、透明度/模糊异常或 GPU 崩溃，可尝试：
  `FOLIA_LINUX_GRAPHICS_MODE=swiftshader ./folia-major`
- 如果仍不稳定，可使用最保守的软件渲染：
  `FOLIA_LINUX_GRAPHICS_MODE=software ./folia-major`
- `FOLIA_LINUX_GRAPHICS_MODE=system` 恢复系统路径。调试非标准 AppImage 运行时可设置 `ELECTRON_LINUX_PACKAGED_GRAPHICS=true`。

这些变量只影响 Electron Linux 启动参数，不改变 Web 端或同步服务配置。排查时先确认可执行文件和 `resources/` 位于同一便携包目录。

壁纸模式（桌面歌词壁纸）：

- 在“选项 → 桌面端”中开启“壁纸模式”，将整个窗口沉到所有正常窗口之下，作为桌面歌词壁纸。
- 需要 Wayland 合成器支持 `wlr-layer-shell` 协议（GNOME 不支持）。切换开关后应用会自动重启。
- Wayland（如 niri、KWin、Hyprland）下通过 `resources/windowtolayer` 将窗口包装为 `wlr-layer-shell` 的 bottom 层表面；X11 下主窗口变成桌面窗口（`_NET_WM_WINDOW_TYPE_DESKTOP`）。
