---
name: run-desktop
description: Use when asked to run, start, launch, drive, or screenshot the Folia Electron desktop app, or to verify a change in the real desktop build (main process, preload IPC, desktop-only settings) instead of only the web preview or unit tests.
---

# Run Desktop

Folia 桌面版是 Electron 应用，开发模式下主窗口加载 Vite（`http://localhost:3000`）。
agent 通过 `skills/run-desktop/driver.mjs` 驱动它：`serve` 在后台拉起 Vite（已有就复用）、
用隔离的 profile 启动 Electron，然后在 `127.0.0.1:9230` 收命令；之后每条命令都是
`node skills/run-desktop/driver.mjs <command>`，一次一条，返回结果后退出。不需要 tmux，Windows 可用。

下文路径都相对仓库根目录。只在 Windows 11 上验证过；Linux 无头环境没跑过。

## 前置

装依赖：

```bash
npm ci --ignore-scripts
```

`--ignore-scripts` 跳过了 Electron 的 postinstall，`node_modules/electron/dist` 是空的；
`electron@43` 会在第一次 `require('electron')` 时自己下载二进制，所以装完后第一次 `serve`
会先打印 `Downloading Electron binary...`，多等一会儿。想提前下好可以单独跑：

```bash
node node_modules/electron/install.js
```

## 运行（agent 路径）

后台启动驱动（Bash 用 `run_in_background`），等输出出现 `driver ready on 127.0.0.1:9230`，
本机实测约 15 秒（刚装完依赖时 Vite 预构建和 Electron 下载会更久）：

```bash
node skills/run-desktop/driver.mjs serve
```

可选参数：`--lang en`（界面切英文，按文字点击更稳定）、`--keep-profile`（沿用上次的 profile，
默认每次清空）。

然后逐条发命令：

```bash
node skills/run-desktop/driver.mjs status
```

```bash
node skills/run-desktop/driver.mjs ss 01-home
```

```bash
node skills/run-desktop/driver.mjs palette desktop
```

```bash
node skills/run-desktop/driver.mjs click-text 其他兼容接口
```

```bash
node skills/run-desktop/driver.mjs fill 'input[type=password]' sk-driver-demo
```

```bash
node skills/run-desktop/driver.mjs eval "window.electron.getSettings().then(s => s.AI_API_KEYS_CONFIGURED)"
```

```bash
node skills/run-desktop/driver.mjs quit
```

截图落在 `test-results/run-desktop/shots/<name>.png`，**截完要打开看**。
主进程输出同时写进 `test-results/run-desktop/main.log`，Vite 日志在 `test-results/run-desktop/vite.log`（仅当驱动自己起了 Vite）。

| 命令 | 作用 |
|---|---|
| `status` | profile 路径、当前页面、所有窗口 |
| `ss [name]` | 截当前页面 |
| `eval <js>` | 在页面里求值（Promise 会 await）；`window.electron.*` 就是 preload 暴露的 IPC |
| `main-eval <js>` | 在主进程求值，作用域里有 `electron`（如 `electron.app.getPath('userData')`） |
| `click <selector>` / `click-text <text>` | Playwright 点击；`click-text` 先按按钮可访问名精确匹配，再按文字 |
| `fill <selector> <value>` | 填输入框 |
| `type <text>` / `press <key>` | 键盘；`press` 用 Playwright 键名：`Control+k`、`Escape`、`Enter` |
| `text [selector]` | 读 innerText，默认 body |
| `wait <selector> [ms]` | 等元素可见，默认 10 秒 |
| `palette <query>` | Ctrl+K → 输入 → 回车，执行命令面板第一条结果（打开设置页最快：`palette desktop`） |
| `windows` / `page <index>` | 列窗口 / 切换后续命令作用的窗口 |
| `logs [n]` / `console [n]` | 主进程输出 / 渲染层 console 的最后 n 行 |
| `reload` | 重载当前页面 |
| `quit` | 关 Electron；只关驱动自己起的 Vite，复用的不动 |

## 运行（人工路径）

`npm run dev:electron` 会同时起 Vite 和一个真实窗口，用的是本机真实 profile；agent 不要用它。

## 测试

单测、类型检查、UI 截图测试怎么选，看 `skills/testing-strategy/SKILL.md`。

## Gotchas

- **真实 profile 里有账号和 AI 密钥。** 驱动用 `--user-data-dir=test-results/run-desktop/userdata`
  启动，并在第一条命令前核对 `app.getPath('userData')`，不一致直接退出。不要绕过这个检查去驱动真实 profile。
- **全新 profile 有两道首启门槛**：思索模式引导、「资料库用哪种界面？」选择弹窗。后者会盖在设置面板上。
  驱动启动时写入 `folia_last_seen_ponder_onboarding_version` 和 `library_suite_prompt_seen`
  （与 `test/component/fixtures.ts` 相同）后 reload；直接 `eval` 改这些键要再 `reload` 才生效。
- **要一首能放的歌**：`eval "window.__foliaDev.playMockSong().then(s => s.filePath)"`，导入并播放开发用的 mock 歌
  （合成音频 + 逐字歌词 + 封面，不用网络和登录）。细节见 `testing-strategy` 的“开发服务器已经在跑”。
- **主窗口地址写死 `http://localhost:3000`**（`electron/main.cjs` 的 `loadAppEntry`），Vite 必须就在 3000。
  驱动自己起的 Vite 带 `--strictPort`，3000 被别的程序占着时宁可启动失败也不换端口。
- **开发模式会多开一个 DevTools 窗口**，`app.windows()` 第一个往往是 `devtools://`。
  驱动按 URL 选 localhost 那个；`windows` 里带 `*` 的是当前目标。
- **`main-eval` 拿不到 `electron/main.cjs` 里的模块级变量**（`store`、`aiCredentials` 等）。
  读写设置走渲染层：`eval "window.electron.getSettings()"` / `window.electron.saveSettings(key, value)`。
- **界面语言默认跟系统**（本机是中文），`click-text` 依赖文案。要稳定的英文标签用 `serve --lang en`；
  英文界面里仍有个别描述是中文，属于现有文案缺口，不是驱动问题。
- **全新 profile 没有 AI 密钥**，启动后会弹「主题生成已切换为封面取色」提示；在线音乐 provider 未登录，
  `console` 里有 KuGou 502 之类的告警。这些是预期噪音。
- **`test-results/` 会被 Playwright 测试清空**，profile 和截图都是临时的，`--keep-profile` 只是尽力而为。

## Troubleshooting

- **`port 9230 is busy`**：已有驱动在跑（同一时间只能跑一个，第二个会在清空 profile 之前就退出），先发 `quit`。
- **`driver is not running on 127.0.0.1:9230`**（退出码 2）：`serve` 没起来或已退出，看后台任务输出。
- **vitest 报 `Cannot find package 'vitest'`**：`node_modules` 是空的，先 `npm ci --ignore-scripts`。
