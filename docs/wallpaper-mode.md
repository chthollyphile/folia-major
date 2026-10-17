# Folia 壁纸模式

Folia 渲染为桌面歌词壁纸，窗口常驻桌面最底层。三平台各成一条互不干扰的实现路径：Windows 经 Rust helper 把窗口 `SetParent` 挂入 WorkerW 层；Linux 经 `windowtolayer` 放进 `wlr-layer-shell` bottom 层或用 X11 桌面窗口；macOS 无边框窗口原地沉到 Finder 图标层之下、系统壁纸之上。

平台共享壁纸模式的设置键、渲染端门控与交互边界；窗口创建、尺寸处理与交互限制各自适配本平台窗口系统。代码位于 `electron/`（主进程接线）、`packaging/`（helper 构建）与渲染端设置卡。

## 一、三平台对照与共享约定

### 1. 机制对照

| 平台 | 承接方式 | 切换/启动方式 | 附加进程/二进制 |
| --- | --- | --- | --- |
| Windows | `SetParent` 挂入图标层之下的 WorkerW 层 | **不重启进程**，开关模式时重建窗口 | `folia-wallpaper-helper.exe`（Rust 常驻） |
| Linux | Wayland：`windowtolayer` → `wlr-layer-shell` bottom；X11：`_NET_WM_WINDOW_TYPE_DESKTOP` | **relaunch**：跳板进程经 `windowtolayer` 包装后重启 Folia | `windowtolayer`（随 Linux 包分发） |
| macOS | 无边框窗口原地沉到 `kCGDesktopIconWindowLevelKey - 1` | **原地切换**：不 relaunch、无 helper；通常不重建窗口，仅当窗口曾被 Electron `setAlwaysOnTop` 碰过时进入前重建一次 | 无（koffi FFI） |

### 2. 共享设置键与入口

store 中平台共享的持久化键：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `wallpaper_mode` | — | 壁纸模式开关；renderer 据此隐藏自绘标题栏等 |
| `wallpaper_forward_mouse` | 开 | 是否转发桌面鼠标输入（无 UI，变更即时生效） |
| `wallpaper_display` | `null` | 壁纸用哪一块显示器：`null`（或没有这个键）是自动，否则是 `{ id, bounds: { x, y, width, height }, label }`。Wayland 不读它 |

平台专属键见各自章节。启动开关入口三平台一致：托盘「Wallpaper Mode」、设置里「桌面」页的那一行（`src/components/modal/settings/pages/DesktopPage.tsx`）与命令面板 `settings-wallpaper-mode` / `desktop-toggle-wallpaper-mode`，统一由 `isWallpaperModeSupportedPlatform()` 门控（darwin / win32 / linux）。

**进入前确认**：用户主动的进入（设置卡片、命令面板、托盘）都会先弹一次确认（`useDesktopSettingsStore.handleToggleWallpaperMode` → `wallpaperEntryConfirmOpen` → `AppDialogs` 里的 `ConfirmDialog`），文案写明进入后的限制与托盘退出方式；托盘在主进程里，经 `wallpaper-entry-requested`（`electron/wallpaper/wallpaperEntryRequest.cjs`）请求渲染端弹同一个对话框，渲染端不可用时才直接进入。退出不确认。启动恢复、崩溃重载、降级等程序性路径不经过确认（渲染端走 `setDesktopPreferenceSnapshot`，主进程直接读 `wallpaper_mode`）。

**选显示器**（Windows、macOS、Linux X11；规则在 `electron/wallpaper/wallpaperDisplay.cjs`，纯函数，不引 Electron）：

- 存的是 `wallpaper_display`。找这块屏：先按 Electron 的 display id，id 找不到（或 id 不可用）再按 bounds 完全相同；找不到就当没选，各平台回到没有这个设置时的规则（「自动」）：Windows 跟主窗口所在的屏（见 Windows 节），macOS 和 X11 用主屏。
- 设置里「桌面」页壁纸模式开关下面那一行（`src/components/modal/settings/pages/desktop/`）：接了不止一块屏、且不是 Wayland 时才画。画的是各块屏的实际排布（编号按从左到右、从上到下，不是系统设置里的编号），外加「自动」。壁纸模式关着时也能选，下次进入时用。
- 页面和主进程之间三样（`preload.cjs` 里是 `getWallpaperDisplays` / `setWallpaperDisplay` / `onWallpaperDisplaysChanged`）：
  - `wallpaper-displays-get`（invoke）→ `{ displays: [{ id, label, bounds, scaleFactor, primary }], choice, chosenId, activeId }`。`chosenId` 是选中的那块在已接显示器里的 id（没选或没接着是 `null`），`activeId` 是壁纸现在在的那块、或者现在进入会去的那块。
  - `wallpaper-display-set`（invoke，参数是一个 display id 或 `null`）：主进程只认 id，bounds 和 label 取自己手里那块已接的屏；id 不在已接的屏里就什么都不改。存好之后立刻应用，返回同上的状态。
  - `wallpaper-displays-changed`（主进程 → 页面，内容同上）：显示器接上、拔掉、改了分辨率或排布，或者选的那一块变了。
- 壁纸模式开着时什么时候搬屏（`applyWallpaperDisplayChoice`）：
  - 设置里换了选择：按「现在进入壁纸模式会去哪块屏」算，和壁纸现在所在的屏不同就搬。选了一块屏就去那块；选「自动」：macOS 和 X11 回到主屏；Windows 的自动规则是跟主窗口，壁纸开着时没有主窗口可跟，壁纸留在原地，下次进入时再按主窗口所在的屏定。
  - 显示器接上、拔掉、改了：只有选了屏、而且选的那块被拔掉（壁纸正在它上面）或者接回来时才搬（`shouldMoveWallpaper`）。没有选屏时显示器变化不搬窗口，各平台和原来一样。
  - 怎么搬：Windows 走重建窗口那条路（`recreateMainWindowWithTransparencyMode`，新窗口先建在目标屏上，helper attach 时铺满窗口所在的屏；helper 没有改）；X11 走已有的 relaunch；macOS 重跑铺满那一步（`applyMacWallpaperFrame`）。
- Windows 和 X11 上搬一次屏，页面会重载一次（播放经 `requestWindowPlaybackHandoff` 交接），和开关壁纸模式一样。所以选的那块屏每断开一次、每接回一次，页面各重载一次。

### 3. 渲染端与命令门控

- 壁纸模式下自绘标题栏整体禁用：`usesCustomWindowChrome = isElectronWindow && !wallpaperMode`，窗口控制按钮、拖拽区、穿透开关都不渲染。
- 命令面板隐藏 `browser-fullscreen` 与 `desktop-toggle-main-window-always-on-top`（navigation 上下文 `isWallpaperMode` 门控）；主进程对应 IPC（minimize/maximize/fullscreen/close/always-on-top/overlay 预设）一律拒绝；壁纸窗口创建时带 `movable:false`。
- 三语文案（zh-CN / en / in）与本地存储契约快照（`storeContract.test.ts.snap`）随新键同步。
- Windows classic 桌面下透明背景窗口被拒绝并 toast（见 Windows 节）。

### 4. 交互边界

- **键盘/IME 不可达**：壁纸模式下键盘一律不转发，退出或控制走托盘等入口。
- **鼠标转发统一经主进程 `webContents.sendInputEvent` 注入**：主进程把系统事件换算成窗口相对坐标后注入渲染端。直接给 Chromium 窗口投递窗口消息（如 PostMessage）会让 TrackMouseEvent 因真实光标位于桌面图标层而立刻回发 WM_MOUSELEAVE，hover 在每两条 move 之间被清空。
- **桌面点过滤**：只转发落在「裸桌面」上的事件；点在应用自己的窗口、Dock/任务栏或其他浮层上时不转发。

### 5. 会话恢复与退出清理

- **渲染崩溃原地 reload**：窗口几何与在 WorkerW/桌面层中的位置随 BrowserWindow 存活，controller/helper/tap 不重启。
- **主动退出走优雅清理**：`before-quit` 同步还原系统状态（macOS 停 tap 并 `restoreDockSync()`；Windows 对 helper 走 `detach()` 而非 kill，避免桌面上残留最后一帧）。
- **连续失败自动降级**：启动/挂载失败达阈值后清除 `wallpaper_mode` 并还原为普通窗口，打断反复崩溃的循环；普通启动或稳定运行一段时间后清除失败计数。
- **区分主动退出与外部销毁**：`isAppQuitting` 区分关闭应用与被系统连带销毁，避免把外部销毁误判成关机直接退出整个应用。

## 二、Windows 壁纸模式

### 1. 架构

```
Electron 主进程 (main.cjs)，下面三个文件在 electron/wallpaper/
  ├─ windowsWallpaperTarget.cjs          目标显示器判定（设置里选的屏，没选就是主窗口所在屏）
  ├─ windowsWallpaperMouse.cjs           helper 物理坐标 → Chromium DIP → sendInputEvent
  └─ windowsWallpaperController.cjs      spawn/心跳看门狗/重挂调度/crash-loop breaker
       └─ folia-wallpaper-helper.exe     Rust 常驻进程（packaging/windows/wallpaper-helper/）
            ├─ attach.rs        WorkerW 双探测（classic + 24H2 raised）→ SetParent + 目标屏几何
            ├─ mouse_forward.rs Raw Input → JSONL 鼠标/滚轮事件（物理像素、前台过滤）
            └─ monitor.rs       WinEvent + TaskbarCreated → 自动重挂 / z 序守卫 / 心跳
```

不重启进程。开关模式时窗口被重建（进程不变），以套用壁纸模式专用窗口选项（`thickFrame:false` 等）；重建期间播放状态经 `requestWindowPlaybackHandoff` 交接。

### 2. helper 协议（`packaging/windows/wallpaper-helper/`）

- CLI：`attach --hwnd <n> [--forward-mouse] [--zguard]`（常驻）、`move --hwnd <n>`、`detach --hwnd <n>`、`refresh`（一次性，重应用当前壁纸）。stdin 收到 `detach`（或 EOF，防孤儿壁纸）先还原窗口再退出。未知选项直接报错退出，避免主进程拼错参数被静默忽略。
- stdout JSONL 事件（主进程 `parseHelperEventLine` 解析）：`attached{mode:"classic"|"raised"}` / `heartbeat`(5s) / `workerw-destroyed` / `explorer-restarted` / `reasserted` / `moved` / `detached` / `error{message, kind?}`。`kind:"window-destroyed"` 是结构化契约（Folia 窗口随 WorkerW 一并销毁、主进程必须重建），`message` 只给人读、主进程不得解析其文本。鼠标事件坐标为**物理屏幕像素**（helper 进程级 per-monitor DPI 感知，无坐标虚拟化）：`mousemove{x,y}`（16ms 合并 ~60Hz）/ `mousedown` / `mouseup` / `mousewheel{x,y,deltaX,deltaY}`。
- 实现约束（来自上游踩坑）：
  - **`EnumWindows` 的 windows-rs `Result` 语义是反的**——回调返回 0 提前停止枚举会让 raw API 返回 FALSE、映射为 `Err`；探测结果必须以回调写入的指针为准，不得用 `is_ok()` 判定成败。Win10 classic 路径曾因此永远探测失败，且每次失败多发一次 0x052C，在桌面上堆积废弃 WorkerW。
  - **0x052C 只在 WorkerW 缺失时发送**——对已存在的 raised WorkerW 重发会让 Explorer 重建整个层级并连带销毁已挂入窗口（Seelen UI 陷阱修复）。classic 重探带 10×100ms 重试：WorkerW 创建在 Explorer 侧是异步的，单次立即重探在全新桌面上会竞态失败。
  - **鼠标注入必须走主进程 `sendInputEvent`**（见「交互边界」）；前台过滤（Lively `IsDesktop()`）：仅当 `GetForegroundWindow()` 是 Progman、持有 `SHELLDLL_DefView` 的图标层 WorkerW（classic 桌面点击落点）或壁纸 WorkerW 才上报；按住左键拖拽期间（含补发的 mouseup）豁免，避免渲染端卡在按下状态。
  - **`SetParent` 不改变子窗口的父客户区坐标**——重挂后窗口的屏幕位置会平移到宿主 WorkerW 的原点，所以「窗口现在在哪块屏」在重挂后失去意义。目标屏必须在 `SetParent` 之前取，宿主也按该屏挑选（见主进程接入节）；这是多屏下壁纸只铺一块屏的根因。
  - **explorer 重启** = `TaskbarCreated` 广播 + `Shell_TrayWnd` PID 变化（DPI 变化也广播该消息，只有 PID 变化才算重启）。
  - **z 序守卫**：WinEvent `EVENT_OBJECT_REORDER` + 10s 低频重申，可关。
  - **滚轮转发为 Folia 自研**——上游三家均未实现（Lively 该路径被注释、electron-as-wallpaper 吞掉 HWHEEL）。delta ±120/notch，垂直轴直传。
- 许可：AGPL-3.0（Seelen UI 部分）、GPL-3.0（Lively 译码部分）、MIT（electron-as-wallpaper 骨架）；模块级归属见各文件头与 helper README。

### 3. 主进程接入（`electron/main.cjs` + `electron/wallpaper/windowsWallpaperController.cjs`）

- `resolveWallpaperHelperPath()`：`FOLIA_WALLPAPER_HELPER_PATH` 覆盖 → `resources/folia-wallpaper-helper.exe`；缺失时禁用壁纸模式并通知渲染端。
- 控制器状态机：spawn → 心跳看门狗（5s/15s 超时）→ 异常退出重挂（2s 退避）→ 连续 3 次失败降级（清 `wallpaper_mode`、原位还原普通窗口，不重启进程）。要点：**主动 detach 后的 helper 退出不得触发重挂**（否则关闭模式后新窗口被僵尸重挂拖回 WorkerW 层）；迟到 exit 事件以 `helperProcess === child` 判定归属（否则 kill+attach 竞态会在同一 hwnd 上挂两个 helper、鼠标双份注入）；`attach()` 在 `wallpaper_mode=false` 时拒绝启动；**从未 attached 的早夭/心跳挂死会话同样计入降级**（否则损坏的 helper 秒退会无限 2s respawn）；失败计数持久化 `wallpaper_windows_failure_count`，健康 60s 清零。
- `error.kind === "window-destroyed"` → 走窗口重建而非普通重挂；renderer 崩溃 → 原地 reload；窗口随 WorkerW 连带销毁时 `window-all-closed` 同样触发重建（`isAppQuitting` 区分）。helper 的鼠标转发注册失败是致命契约（发 error 后立即退出——其下方图标层使壁纸页收不到任何真实系统输入，无鼠标的壁纸页不可交互），反复失败由降级闩锁关闭壁纸模式。
- `display-metrics-changed` 按平台（win32）注册、回调内判模式——不能挂在启动时的 `isWindowsWallpaperMode()` 分支：Windows 开关模式不重启进程，运行时开启后监听必须仍在。
- **目标显示器（多屏）**：设置里选了一块屏、而且它接着，壁纸窗口就铺在那块屏上；没有选（自动）时铺在**主窗口所在的那块屏**上。判定顺序（`electron/wallpaper/windowsWallpaperTarget.cjs`）：① 设置里选的屏（`wallpaper_display`，接着才算；见一、2「选显示器」）→ ② 仍在的普通主窗口所在屏（覆盖「窗口最大化在副屏」——最大化不更新 `WINDOW_BOUNDS`）→ ③ 本会话已解析的目标屏（会话内粘性）→ ④ `WINDOW_BOUNDS`（壁纸几何从不写入它，见 `saveWindowState`，即「上次普通窗口位置」）→ ⑤ 主屏（无可用原点，或窗口几何与任何屏都不相交）。关闭壁纸模式时清空会话目标，下次开启重新推导。壁纸所在的屏被拔掉时分两种：选了屏的，主进程在显示器变化时重跑判定，把窗口重建到回落的那块屏上（壁纸窗口不算普通窗口，所以落在 ④ 或 ⑤），选的屏接回来再重建回去；没有选屏的，显示器变化只让 helper `move`（helper 铺满窗口此刻所在的、或离它最近的那块屏），会话目标要到下一次重建窗口时才重新推导。自动规则本身不需要 store 键：`WINDOW_BOUNDS` 就是记忆。
- **helper 选宿主 WorkerW（多屏关键）**：`SetParent` **保留子窗口的父客户区坐标**，所以窗口一旦被塞进某块屏的 WorkerW，就会视觉跳到那块屏上——之后任何「窗口在哪块屏」的查询都只会回答宿主屏，壁纸于是永远只铺那一块屏（初版单主屏时正好蒙对；24H2+ raised 桌面每块屏一个 WorkerW，选错宿主必然铺错屏）。因此 `attach_window` 在 `SetParent` **之前**取窗口所在显示器作为目标，并优先选择**覆盖该显示器的那个 WorkerW**（`EnumWindows` + Progman 子窗口枚举，排除承载 `SHELLDLL_DefView` 的图标层，按矩形覆盖率 ≥80% 匹配）；找不到匹配候选（例如 classic 桌面只有一个跨虚拟屏的 WorkerW）就回退原有的「classic sibling → raised Progman child」探测，此时一个宿主服务所有屏，几何换算照旧。几何重申一律以该目标屏的 `rcMonitor` 为准（`ScreenToClient(实际父窗口)` 换算）。
- 几何重申（`move` / attach 后）用 `GetAncestor(GA_PARENT)` 取父窗口（WorkerW）做 `ScreenToClient` 换算 monitor 原点——对 Folia 窗口自身换算只在「窗口位于父客户区 (0,0)」时碰巧正确，多屏虚拟屏原点非 (0,0) 时会挂错显示器。**因此已挂载窗口的几何只由 helper 负责**：显示器变化时主进程不 `setBounds`（对 WorkerW 的子窗口 setBounds 会被 Windows 按父客户区解释，等于把壁纸搬到宿主屏），只 spawn `move`；壁纸要换一块屏时（设置里换了选择，或者选的屏被拔掉、接回）不是挪窗口，而是整个重建窗口再 attach，让 helper 重新挑宿主。
- 开关路径：`scheduleWallpaperModeRelaunch`（300ms 合并）→ win32 分支**重建窗口**（含 handoff）；显示器变化（200ms 合并）→ 选的屏被拔掉或接回时重建窗口并重新 attach（含 handoff），其余只 spawn helper `move` 重设物理几何（`move` 不带显示器参数，helper 按窗口所在的屏铺）。
- 壁纸窗口创建约束：目标屏 bounds（全屏，含任务栏区域）、`thickFrame:false`、`resizable:false`、不可 click-through。
- 设置键：`wallpaper_mode`、`wallpaper_forward_mouse`（默认开）、`wallpaper_zguard`（默认开）。后两者无 UI，变更会 kill + 重 attach helper（窗口全程不脱层）。
- **透明背景 × 壁纸模式**：透明窗口（`WS_EX_LAYERED`）只有在 raised（Win11 24H2+）桌面能活过 `SetParent` 持续呈现；classic（Win10/早期 Win11）下重挂即黑屏。主进程持久化 `attached.mode`（`wallpaper_windows_attach_mode`，classic 为默认）：classic 下壁纸窗口一律按不透明构建、`setMainWindowTransparentMode(true)` 直接拒绝（`wallpaper-transparent-refused` 事件 + 渲染端 toast）。
- **退出清理**：`before-quit` 与窗口重建路径对 helper 走 `detach()` 而非 `killHelper()`——挂载状态下销毁窗口会在桌面残留最后一帧。helper detach 时 `InvalidateRect` WorkerW 兜底，最后一步 `refresh_desktop_wallpaper` 重刷壁纸：classic 的 0x052C WorkerW 层在窗口离开后不再绘制壁纸、只剩灰色空表面，必须显式触发 Explorer 重绘（个别 MSIX 环境可能让 Explorer 重建层级，此时已无挂载窗口、重建无害，故放清理顺序最后）。退出壁纸模式路径等 helper 的 `detached` 事件（500ms 兜底超时）再销毁旧 hwnd。降级闩锁等无优雅 detach 可走的路径由主进程 best-effort spawn 一次性 `refresh` 子命令兜底。
- 鼠标注入（`electron/wallpaper/windowsWallpaperMouse.cjs`）：helper 坐标是物理屏幕像素，主进程先用 `screen.screenToDipPoint` 转成 Chromium 的 DIP 空间再减窗口内容原点——两端都出自 Chromium 自己的映射，混合 DPI 下不再依赖「helper 虚拟化空间 == Electron DIP 空间」这个在异缩放多屏下不成立的假设。move/wheel 越界丢弃；mousedown 同样越界丢弃（壁纸只覆盖一块屏，点其它屏的桌面不该注入点击），mouseup 一律放行以免按住态卡死；clickCount 由主进程按 DIP 合成；拖拽期间为 move 附加 `leftbuttondown` modifier；滚轮 ~100px/notch，垂直轴直传。DPI：壁纸窗口必须 `thickFrame:false`（WS_THICKFRAME 会把客户区内缩一个边框宽）；helper 进程级 PMv2（`main.rs`），`reassert_geometry` 另有一次线程级重申。

### 4. 渲染端 / 构建

- 设置卡片 Linux/Windows 同样式（单开关）；命令面板 `desktop-toggle-wallpaper-mode`（platform `'win'`）；三语文案。
- `npm run build:wallpaper-helper` → `build/folia-wallpaper-helper.exe`（非 Windows no-op）；electron-builder `win.extraResources` 单独打包；CI windows-latest 装 Rust + cargo 缓存。
- 前端构建必须在 `ELECTRON=true` 下运行（base 变 `./`），否则 file:// 加载 404。

### 5. 已知局限

1. 键盘/IME、右/中/侧键不转发。
2. z 序只能「最后调整者在上」，与 WE 的竞争靠低频守卫兜底。
3. 只创建一块壁纸窗口：壁纸只铺在目标屏上，其它显示器保持系统壁纸，点它们的桌面不转发给 Folia（属预期）。
4. 换屏在设置「桌面」页里选（见一、2「选显示器」），壁纸模式开着也能换，换的时候窗口重建一次。选「自动」时目标屏仍只在**进入壁纸模式时**确定（壁纸窗口 `movable:false`，不可拖动）：要换屏需先退出壁纸模式、把窗口拖到目标屏再重新开启。
5. 目标屏判定依赖 Electron 的显示器几何，落地依赖 helper 选中该屏的 WorkerW 宿主；宿主匹配失败时回退到「唯一的 WorkerW + 窗口所在屏」，多屏异缩放布局下可能落到相邻屏（壁纸与窗口实际所在屏一致，属可接受偏差）。
6. 安全桌面/RDP 会话切换期间壁纸不可见属预期。

### 6. 参考来源

- **Seelen UI**（AGPL-3.0）@`b4708a1c1f`：attach 双探测、0x052C 陷阱修复、样式规范化。
- **Lively Wallpaper**（GPL-3.0）@`c1036feb`：前台过滤、输入转发行为基准、TaskbarCreated+PID 恢复。
- **electron-as-wallpaper**（MIT）@`4d76f1bf`：Raw Input Rust 骨架（已裁剪键盘/中侧键；滚轮转发为 Folia 自研补充）。

## 三、Linux 壁纸模式

- **显示层**：Wayland 经 `windowtolayer` 进程把 Electron 窗口放到 `wlr-layer-shell` bottom 层；X11 用 `_NET_WM_WINDOW_TYPE_DESKTOP` 桌面窗口覆盖一块显示器：设置里选的那块，没选或者它没接着就是主显示器。Wayland 不读 `wallpaper_display`，放在哪块屏由 `windowtolayer` 和合成器决定，设置页也不画选显示器那一行。Folia 本身只负责渲染内容与处理设置；两套共享壁纸模式设置，窗口创建/尺寸/交互限制各自适配。
- **启动与切换**：启动先读壁纸模式与会话类型再决定是否起包装进程；跳板进程只在包装进程成功创建后才退出。包装缺失或启动失败时清除壁纸模式、以普通窗口启动。运行中切换写入持久化配置、短暂合并连续操作，等渲染端返回播放快照后 relaunch（环境标记 + 清理一次性 Wayland socket 与包装标记）；快照以短 TTL 临时持久化，重启后恢复歌曲、队列、进度与播放状态。
- **故障恢复**（`electron/wallpaper/wallpaperWatchdog.cjs`）：包装状态下监视父进程存活，同时处理窗口创建失败与 renderer 崩溃；以固定父进程身份 + 存在性检查识别包装退出，恢复幂等、避免多故障事件重复拉起。连续启动失败达阈值自动关闭壁纸模式；正常启动或稳定运行后清计数。Wayland 进程模型：跳板 spawn `windowtolayer`（wtl），wtl 再 spawn 真正的包装 Folia（`WAYLAND_SOCKET=<fd>`）；包装子进程的父进程是 wtl，wtl 一死 socketpair EOF、Chromium 通常毫秒级崩溃、watchdog 来不及响应——watchdog 的价值在于 wtl 非致命退出时的恢复与崩溃循环 breaker。计数键 `wallpaper_wrapped_crash_count`。
- **X11 特殊处理**：桌面窗口取目标显示器（设置里选的，否则主显示器）完整 bounds 且在首次映射前完成尺寸设置（防显示缩放导致的工作区裁剪）；设置里换了选择，或者选的那块屏被拔掉、接回来时，走和开关壁纸模式一样的 relaunch；没有选屏时显示器变化不处理（和原来一样）；不参与普通窗口尺寸记忆（防止退出壁纸模式后把全屏桌面尺寸带回普通窗口）；无背景合成层、透明区域显示为黑；不用 watchdog，异常靠下次启动自愈。
- **打包**：`windowtolayer` 用固定上游提交 + 仓库补丁构建（`packaging/linux/build-windowtolayer.mjs` + `packaging/linux/patches/`），补丁无法应用直接失败；产物及许可证随 Linux 包放 `resources`。联调：`npm run build:windowtolayer` → `build/windowtolayer`（或 `npm run dev:electron:wallpaper`，`dev:electron*` 注入 `FOLIA_WINDOWTOLAYER_PATH=build/windowtolayer`）；二进制缺失时开关自动回退关闭。

## 四、macOS 壁纸模式

> 无边框 Electron 主窗口原地沉到「Finder 图标层之下、系统壁纸之上」，视觉上充当壁纸；桌面图标保持可见。交互通过 **worker 线程中的 active CGEventTap 拦截裸桌面按钮手势 + 主线程 listen-only tap 监听移动/滚轮 + 桌面点过滤 + `webContents.sendInputEvent` 注入** 实现。active tap 吞掉原始点击，避免 Finder / 台前调度在 Folia 处理完后又把这次点击当成桌面点击；它运行在自己的 CFRunLoop，不能挂在 Electron 主线程上（主线程启动繁忙时实测事件排队 5.2 秒并触发 tap watchdog）。壁纸窗口矩形与 Dock 几何通过 SharedArrayBuffer 同步给 worker，显示器变化后仍使用最新命中范围。不新建 helper 子进程、不 relaunch（与 Windows/Linux 的既有路径并列，互不干扰）；通常不重建窗口，仅当窗口曾被 Electron `setAlwaysOnTop` 碰过（见 §2 开关路径「开」）时，进入前重建一次。

### 1. 依赖与模块

- 设计对照 Mineradio-macOS 上游（`macupstream/main`）`desktop/` 三文件：`mac-window-level.js`（`CGWindowLevelForKey(kCGDesktopIconWindowLevelKey) - 1` 沉/浮 level、`setCollectionBehavior`、occlusion、全程 fail-soft）、`mac-event-tap.js`（listen-only session tap、`isDesktopPoint()`、move 节流、tap-disabled 重武装、Input Monitoring 权限流）、`main.js`（Dock 自动隐藏/恢复、simple-fullscreen 满幅、交互默认开启等语义来源）。
- `package.json` 新增 `koffi`（^3.2.0，仅 darwin 运行时使用；N-API 预编译，无需 electron-rebuild）。原生 `.node` 经 OS 门控可选包 `@koromix/koffi-<platform>-<arch>` 分发，`build.asarUnpack` 已含 `node_modules/@koromix/koffi-*/**/*.node`。
- 新增 `electron/wallpaper/macWallpaperController.cjs`（darwin-only、依赖注入、无 Electron 硬依赖），与 Windows 控制器同为「纯逻辑 + `main.cjs` 接线」结构；`main.cjs` 顶部无条件 require（模块自身按 darwin 门控 FFI，非 darwin 不加载原生依赖）。职责：
  - **level**：`isAvailable()/desktopLevel()/normalLevel()/setLevel(win,level)/setCollectionBehavior(win,mask)/getLevel(win)/getOcclusionState(win)`；FFI 失败一律 no-op 返回；`objc_msgSend` 按具体签名声明多个原型（arm64 要求）。collection behavior 优先走 Electron `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`，不用裸 `setCollectionBehavior(81)`（会丢掉 FullScreenAuxiliary 位）。
  - **presentation**：`clearAutoHidePresentationOptions()`——经 `objc_getClass('NSApplication')`/`sharedApplication` 清除 NSApp **应用级** AutoHideDock|AutoHideMenuBar 位。背景：Electron simple-FS 进入时以 `[NSApp setPresentationOptions:]` 设置这两位、退出时恢复「进入时捕获的值」；若窗口在 simple-FS 中被直接销毁（窗口关闭/透明切换重建），无退出恢复，位会残留并被下一次进入捕获为脏值，之后每次退出「恢复」的仍是脏值——表现为聚焦本应用即隐藏菜单栏/Dock（实测）。**只清 AutoHide 两位，绝不碰 FullScreen 位**（原生全屏过渡期由系统持有；旧修复连 FullScreen 一起清导致死循环，已移除）。仅在壁纸会话完全拆除后调用。
  - **tap**：`hasListenPermission()/hasAccessibilityPermission()/hasPermission()/requestPermission()/start(forward)/stop()/isRunning()`。active/default tap 在 `macWallpaperTapWorker.cjs` 的独立 worker 线程/CFRunLoop 中订阅 left/right down/up/dragged，只在裸桌面 + 壁纸窗口范围内返回 `NULL`，验证后的按钮事件通过 `worker_threads` 回传主进程；主线程 listen-only tap 只订阅 mouseMoved/scroll。`CGEventType` 必须按 `uint32` 声明（tap-disabled 哨兵 0xFFFFFFFE/0xFFFFFFFF 若按 int 会变 -2/-1 而失配）。listen-only tap 被系统禁用后自动重武装；active tap 只有在 Accessibility 仍有效时重武装，撤销后停止交互并提示。worker 通过 SharedArrayBuffer 停止标志退出 CFRunLoop。权限探测分别使用 `CGPreflightListenEventAccess()` 与 `AXIsProcessTrusted()`。
  - **桌面点过滤** `isDesktopPoint(x,y)`：枚举 `CGWindowListCopyWindowInfo(onScreenOnly)`，只读 `kCGWindowLayer`/`kCGWindowBounds`/`kCGWindowOwnerPID`（不读 window name，避免触发屏幕录制权限）。除「任何层高于 Finder 桌面层且覆盖该点的窗口 → 非桌面」外，还排除两类会把整屏盖住的系统表面：本进程的全屏呈现窗口（simple-fullscreen 下 WindowServer 按 layer≥101 报告，尽管 NSWindow 逻辑 level 是桌面层，按 `ownerPID === process.pid && layer >= 101` 跳过）与 Finder/Dock 的全屏追踪表面。Dock 通过 `layer > 0 && layer <= 20` 且 bounds 铺满当前显示器识别，不在 active tap 回调里执行 `pgrep`；旧实现同步查 Dock pid 时实测单次回调可达 2.19 秒，会触发系统 tap watchdog，表现为壁纸间歇性无法点击。另在 tap 启动时读取 Dock orientation / tile size / autohide，直接保留 Dock 所在边缘条带给系统（自动隐藏时只保留 12px reveal strip）；运行中的 2 秒权限/位置看门狗异步刷新这组值，并通过 SharedArrayBuffer 同步给 worker，Dock 从左侧切到底部后不会继续吞掉左上角点击。Stage Manager 会暴露明显超出显示器尺寸的不可截图辅助表面（实测 772×1815 / 1470×956），这类异常浮层不计作有效遮挡，避免让壁纸空白区和右下角控件误判为被其他应用覆盖。
  - **Finder 桌面内容过滤**：macOS 27 的 Finder 桌面背景、图标、标签和小组件都位于同一个全屏窗口，仅靠 `CGWindowList` 无法区分。worker 在按钮 down 时调用 `AXUIElementCopyElementAtPosition`：只有命中的是覆盖整个壁纸区域的 `AXGroup` 桌面根元素时才转发给 Folia；`AXImage` 图标、图标文字、小组件及其他 Finder 子元素都保留给 Finder。Accessibility 查询失败时 fail-open 到壁纸点击，避免临时 AX 故障让整个桌面失效。
  - **Dock 自动隐藏**：`setDockAutohide(on)/restoreDock()/restoreDockSync()/recoverStrandedDock()/configureDockRecovery()`，配合 marker 文件 `.wallpaper-dock-autohidden` 做崩溃恢复。
- 单元测试 `test/unit/electron/macWallpaperController.test.ts`：覆盖纯逻辑（事件 kind 归一化、level 换算、test-mode 判定）与 Dock 状态机（注入 `defaults`/`killall`/fs 假件），FFI 层留真机验证。

### 2. 主进程接入（`electron/main.cjs`）

- **平台门**：`isWallpaperModeSupportedPlatform()` 已含 `darwin`，托盘「Wallpaper Mode」项、设置卡片与命令面板随之出现。
- **开关路径**：`relaunchForWallpaperModeChange()`/`scheduleWallpaperModeRelaunch()` 增加 darwin 分支——与 Windows 重建窗口、Linux relaunch 不同，**原地切换**：
  - 开（`enterMacWallpaperMode`，姿态收在 `applyMacWallpaperPosture`）：
    - 记录 bounds/resizable/movable/maximizable/native-blur → `isMacWallpaperActive = true`、click-through 复位、always-on-top 只翻存储状态位（**不调** Electron `setAlwaysOnTop`——它会毒化本窗口后续的 simple-FS 呈现，实测内容被呈现为下移菜单栏高度、顶部空条露出系统壁纸，且对窗口生命周期粘性）；
    - 若窗口带 `__macAlwaysOnTopElectronTouched` 标记（曾被 Electron `setAlwaysOnTop` 碰过，含托盘开启路径的历史调用）→ 先重建窗口（`windowPlaybackHandoff` 保音频）再进入，保证壁纸永远跑在「从未被毒化」的新窗口上（启动路径天然满足）；
    - 若在原生/simple 全屏中：**推迟整个姿态**到退出动画落地（`leave-full-screen` 一次性触发 + 有界轮询兜底，超时回滚模式而非强行下沉；旧实现「边退边铺 + 事后重断言」会在竞态下把窗口卡在 visibleFrame，顶部菜单栏条外露）；
    - 铺满：**先** `setSimpleFullScreen(true)`（Electron 一步动画到全屏 frame）→ **后** ambient（`setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` → `setLevel(desktopLevel)` → `setIgnoreMouseEvents(true,{forward:true})`）。**不再**先 `setBounds(display.bounds)`——macOS 会把它钳制到 workArea（y=菜单栏高、高度不变、底部出屏），随后的上移 origin 动画会让内容视图残留 33pt 偏移；ambient 后置同理（aux/全空间位在 simple-FS 中生效会触发同样的内容下移）。铺完做有界 settle 校验（帧不符幂等重铺，定时器驱动、绝不挂 resize 事件——曾因此死循环）。铺到哪一块屏：`applyMacWallpaperFrame` 和 settle 校验用同一个目标帧，`getChosenOrPrimaryWallpaperDisplay().bounds`——设置里选的屏接着就是它，否则主屏（没有这个设置时一直是主屏）。窗口不在目标屏上时，靠进了 simple-FS 之后那一步 `setBounds(target)` 把它搬过去（进入前的帧和目标帧不同就会跑这一步；窗口在副屏上进入、要回主屏时走的也是它）。选了副屏的情形只读过代码，没有在 Mac 上跑过；
    - 按开关隐藏 Dock → 默认开启交互（tap）→ `store.set('wallpaper_mode', true)` → 推送 `wallpaper-mode-changed`。
  - 关（`exitMacWallpaperMode`）：恢复帧在退出 simple-FS **之前**先 `setBounds` 到目标帧（Electron 的退出动画飞向「进入时记录的帧」——钳制帧而非用户窗口帧，事后 setBounds 会输给动画）→ `setSimpleFullScreen(false)` → 逆序还原 level/几何/ignoreMouseEvents/all-workspaces、恢复 resizable/movable/maximizable 与 vibrancy → 收尾 `clearMacWallpaperAutoHideLeftovers()`（窗口已销毁/非活跃早退/正常恢复三路都清，见 §1 presentation）。
- **会话生命周期**：renderer crash 原地 reload（mac 的 level/几何在 BrowserWindow 上，不会随页面崩溃丢失，无需重挂 tap）；窗口被销毁时 `closed` 处理退出会话（停 tap、还原 Dock、清 `wallpaper_mode`）；`activate`/启动重建窗口后按需重进。
- **残留清理**：启动时 `wallpaper_mode=true` 且本次无法进入 mac 壁纸会话（FFI 不可用/权限未生效）→ 清掉该标志，避免 renderer 误关自绘标题栏、窗口控制 IPC 全被拒。
- **退出清理**：`before-quit` 同步停 tap、`restoreDockSync()`（Dock/图标属系统状态，进程可能在异步链中途退出）。
- **显示屏热插拔/分辨率变化**：mac 分支监听 display 事件，壁纸会话存活时延迟重断言满幅 frame 与 level。目标帧每次现算，所以选的屏被拔掉时这一步把窗口搬到主屏，接回来时再搬回去；设置里换了选择时跑的也是这两步（不重建窗口，页面不重载）。
- **设置热更**：mac 会话中改 `wallpaper_forward_mouse` 即时 start/stop tap；改 `wallpaper_mac_autohide_dock` 即时隐藏/还原 Dock。

### 3. 交互接入

- **授权**：开启壁纸模式前置检查 `hasPermission()`（Input Monitoring + Accessibility）；macOS 27 的用户界面把 Accessibility 显示为「设备控制和数据访问」。未授权时分别弹出输入监控与该授权，renderer toast + 设置页文案指引两个「系统设置 → 隐私与安全性」面板，并保持模式关闭。macOS 对已勾选但未重启的进程仍可能报未授权，需完全退出重开生效。
- **转发 `forwardMacWallpaperMouse(evt)`**：仅转发 `isDesktopPoint` 判定的裸桌面事件（点在 App/Dock/小组件上不转发）；down 记忆起点、期间 drag 持续、up 结束（含右键）；`mouseMoved` 时间节流 ~40ms；scroll 读 `ScrollWheelEventDeltaAxis1/2`。
- **注入 `sendMacWallpaperMouseEvent(evt)`**：屏幕点换算为窗口内容点后 `webContents.sendInputEvent`；down/up → `mouseDown/mouseUp`（clickCount 500ms/8px 双击合成），drag/move → `mouseMove`（拖拽时带 `leftbuttondown` modifier 维持 buttons=1），scroll → `mouseWheel`（增量 ×16，轴向/倍率需真机校准）。drag 事件合并到最新位置后 ~16ms flush。
- **tap 生命周期**：进壁纸默认开（`wallpaper_forward_mouse !== false`），`start/stop` 同时管理 worker active tap 与主线程 listen-only tap；任一无法启动则视为交互不可用。启动失败计数达到阈值 → 降级为非交互壁纸并提示。active tap 被撤销权限或系统禁用时立即停止交互，不能无条件重装；worker 的 ready/error/exit 信息都会回传主进程。
- **键盘不转发**：与 Windows 交互边界一致，壁纸模式下键盘不可达；退出/控制走托盘等入口。
- **Dock**：`wallpaper_mac_autohide_dock`（mac 专属，**默认开**）。位置感知：仅在 Dock 位于屏幕底部时，壁纸会话期间自动隐藏 Dock、置 `autohide-delay=0`（贴边立即唤出）；左/右侧 Dock 不动。开关是显式覆盖：关闭后即使 Dock 在底部也不隐藏。退出壁纸/退出应用恢复用户原值；marker 防崩溃残留，下次启动对账恢复。

### 4. 渲染与文案

- `src/components/modal/settings/pages/DesktopPage.tsx`：`HAS_WALLPAPER_MODE` 判定放开 Wallpaper Mode 那一行；mac 下（`IS_MAC`）它下面多一行「自动隐藏 Dock 栏」开关（默认开，实际仅在 Dock 位于底部时生效），这一行下方显示输入监控 + 设备控制和数据访问指引。
- 命令面板 `settingsCommands.ts`：`settings-wallpaper-mode` 与 `desktop-toggle-wallpaper-mode` 的 `platform` 含 `'mac'`；`browser-fullscreen`、always-on-top 等隐藏项已由 `isWallpaperMode` 门控，无需改动。
- 三语文案（zh-CN / en / in）：`options.wallpaperModeMacPermissionHint`、`options.wallpaperMacAutohideDock(Desc)`、`notifications.macWallpaperAutohideDockOn/Off`、`notifications.macWallpaperPermissionsNeeded`。mac 下 toggle 与 Windows/Linux 走同一 `handleToggleWallpaperMode` 路径。
- 本地存储契约快照（`storeContract.test.ts.snap`）新增 `wallpaper_mac_autohide_dock`。

### 5. 打包

- mac 打包无需 helper 二进制；`koffi` 的 `@koromix/koffi-*` 可选依赖按构建主机的 CPU 安装。`beforePack` 按目标架构取得与锁文件一致的原生包，校验完整性与 Mach-O CPU 类型，再通过 mac `extraResources` 放入 Koffi 支持的 `resources/koffi/darwin_<arch>/koffi.node` 查找路径；`afterPack` 检查实际产物，缺失或架构/版本错误时终止打包。实现入口为 [`prepareBundledKoffi` / `verifyBundledKoffi`](../packaging/macos/prepare-koffi.mjs)。
