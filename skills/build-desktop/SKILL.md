---
name: build-desktop
description: Use when asked to build, package, or produce the Folia Electron desktop installer (npm run build:electron / build:electron:dir / build:electron:pack), when the build or the packaged app fails to start, or when a freshly installed node_modules has to be checked before building.
---

# Build Desktop

`npm run build:electron` 出的是**安装包**（Windows 上是 NSIS 的 `release/Folia-Setup-<version>.exe`），
不是开发模式。只想跑起来看界面用 `skills/run-desktop/SKILL.md`，别为此打包。

下文命令默认在仓库根目录、Windows PowerShell 下执行；路径相对仓库根。

## 一、先查 node_modules，再谈构建

构建失败里很大一部分是依赖不完整，不是代码问题。按顺序查：

```powershell
node -v                                   # 必须 >= 24（package.json engines / .nvmrc 都是 24）
Test-Path node_modules                     # 不存在就先装
Test-Path node_modules\electron\dist\electron.exe
Test-Path node_modules\.bin\vite.cmd
```

`node_modules/electron/dist` 缺失是最常见的坑：Electron 的二进制由 postinstall 下载，
`npm ci --ignore-scripts` 会跳过它，装完看起来"装好了"，一构建就在 electron-builder 阶段或启动阶段炸。
补装不用重跑整个 `npm ci`：

```powershell
node node_modules\electron\install.js
```

装依赖本身（`npm ci`）会跑生命周期脚本、spawn 子进程，**在受限沙箱里必然 `spawn EPERM`**，
npm 缓存又在工作区外的 `%LOCALAPPDATA%\npm-cache`。要装就一次装完，别在沙箱里反复试。

## 二、Windows 上先排掉"目录被标成 Low 完整性"

这是本项目在本机踩过的真实坑，症状极像"构建出来的东西坏了"，其实是**文件系统权限**。

Chromium/Electron 的主进程不允许以 Low 完整性级别运行。如果仓库目录（或 `node_modules`）
被打了 Low Mandatory Level，`electron.exe` 一启动就崩：

```
Exception code: 0xc0000005   Faulting module: electron.exe
进程退出码: 0x80000003 (-2147483645)
```

关键判据：**同一份 exe（SHA256 相同）复制到 `%TEMP%` 下能跑，留在仓库目录下就崩** —— 那就是目录的锅，
不是二进制、不是代码、跟杀软也无关。开包前的自检：

```powershell
# 仓库根和每个一级目录，出现 Low 就是它
icacls . | Select-String 'Mandatory Label'
Get-ChildItem . -Directory -Force | ForEach-Object {
  $o = icacls $_.FullName 2>&1 | Select-String 'Mandatory Label'
  if ($o -match 'Low') { "LOW: $($_.Name)" }
}
```

修复（只改这些目录的权限，不动代码、不动全局环境）：先补当前用户的可继承完全控制，
再改完整性级别。顺序不能反——没有写权限时 `icacls /setintegritylevel` 会直接 `Access is denied`。

```powershell
# 对每个报 LOW 的目录，逐个来；node_modules 一定要先 /grant
icacls node_modules /grant "$($env:USERNAME):(OI)(CI)F" /T /C /Q
icacls node_modules /setintegritylevel (OI)(CI)M /T /C /Q
```

`/T` 递归、`/C` 出错继续、`/Q` 少刷屏。跑完用上面的自检再确认一遍全是 Medium。

## 三、构建前置（按平台）

`npm run build:electron` = `vite build` + `build:windowtolayer` + `build:wallpaper-helper` + `electron-builder`。
后两个脚本在非对应平台上会自己 no-op（`[windowtolayer] non-Linux host, skipping build`），
但**在对应平台上需要工具链**：

| 需要什么 | 什么时候 | 缺了会怎样 |
|---|---|---|
| Node >= 24 | 总是 | `vite` / electron-builder 版本不满足 |
| Rust + cargo | Windows（wallpaper-helper）、Linux（windowtolayer） | `build-wallpaper-helper.mjs` 直接抛错 |
| cmake >= 3.24 + C++17 编译器（MSVC / clang / gcc） | 总是（MNN 运行时） | `beforePack` 里 `prepareBundledMnn` 失败 |
| 网络 | 总是 | 首次会下 ffmpeg、两个模型、Electron zip |

原生运行时都在 `build/beforePack.cjs` 里按目标平台/架构准备，产物有缓存标记，重复构建很快：

- `build/ffmpeg/<os>-<arch>/`（`packaging/ffmpeg/fetch-ffmpeg.mjs`，按 sha256 校验）
- `build/mnn/<os>-<arch>/folia_mnn.dll`（`build/buildMnnRuntime.mjs`，`BUILD-INFO.txt` 是缓存戳，
  源码/patch/commit 没变就跳过；MNN 只能构建宿主平台，不支持交叉编译）
- `models/beat_this-wgsl.bin`、`models/htdemucs-wgsl.bin`（`build/fetchModels.mjs`）

看到 `[models] ... already present and verified` 就是缓存命中了，正常。

## 四、构建

```powershell
npm run build:electron
```

耗时参考（Windows / x64 / 依赖和原生运行时都已缓存）：vite 约 16 s，整条命令约 3–5 分钟，
大头是 electron-builder 打 NSIS 安装包。

产物都在 `release/`：

```
release/win-unpacked/                 解包目录，可直接跑 Folia.exe 验证
release/Folia-Setup-<version>.exe     安装包
release/latest.yml + *.blockmap       自动更新用
```

其它两个脚本只在需要时用：`build:electron:dir` 只出解包目录（快，验证打包结果够用），
`build:electron:pack` 与 `build:electron` 当前等价。

## 五、验证

构建退出码 0 不等于能用。至少确认：

```powershell
Get-ChildItem release -Filter '*.exe' | Select-Object Name,Length,LastWriteTime
Get-ChildItem release\win-unpacked\resources | Select-Object Name   # 应能看到 app.asar、ffmpeg-audio、mnn、models、folia-wallpaper-helper.exe
```

再直接跑 `release\win-unpacked\Folia.exe` 看能不能起窗口。**起不来时先回到第二节查完整性标签**，
别急着怀疑打包产物——这两件事的症状一模一样。

## Gotchas

- **`ELECTRON_RUN_AS_NODE=1` 会让 electron 变成纯 Node。** 某些 agent 运行时（含本仓库的桌面宿主）
  会把这个变量注入子进程，此时 `electron --version` 打印的是 Node 版本、`electron .` 报
  `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`。
  这**不是构建问题**，只影响你手动跑 exe 的验证。在当前 shell 里临时清掉即可，不要改系统环境变量：
  `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`
- **不要改全局运行环境来"修"构建。** 换 Node 版本、写系统环境变量、动 npm 全局配置都属于越界；
  缺什么就在命令里临时补，或者告诉用户要装什么。
- **`npm warn Unknown user config "electron_mirror"`** 是用户级 `.npmrc` 的告警，npm 11 起会提示，
  不影响构建，忽略。
- **electron-builder 会打印一大串 `duplicate dependency references`**，是上游依赖图的既有状态，正常。
- **vite 的 `Some chunks are larger than 500 kB` 告警**是既有的，不阻塞。
- **`release/` 与 `build/` 是产物目录，不进 git**；`build/` 里的部分文件（如 `build/icon.png`、
  `build/thumbar/*.png`）是 `extraResources` 的输入，别当成产物删掉。
- **构建期间别同时跑 `npm run dev:electron`**：vite 的 watcher 会去开 `release/win-unpacked.tmp` 的句柄，
  而 electron-builder 要把那个目录改名成 `win-unpacked`，会撞。`vite.config.ts` 的 `server.watch`
  已经排掉了产物目录，但同一时间只留一个构建/开发进程最稳。

## Troubleshooting

| 症状 | 原因 | 处理 |
|---|---|---|
| `spawn EPERM` | 在受限沙箱里跑，管道 stdio 被拦 | 换到正常终端跑，或让用户跑；别反复重试 |
| `npm ci` 报 `EPERM rmdir node_modules\...` | 同上，且残留目录被占用 | 关掉占用进程后重跑 |
| electron 启动即崩，`0x80000003` / `0xc0000005` | 目录 Low 完整性标签 | 见第二节 |
| `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')` | `ELECTRON_RUN_AS_NODE=1` | 见 Gotchas |
| `[mnn] ... cmake` 失败 | 缺 cmake / MSVC | 装 VS Build Tools（含 C++ 工作负载）+ cmake >= 3.24 |
| `build-wallpaper-helper` 抛错 | 缺 Rust | 装 rustup，或确认 `build/folia-wallpaper-helper.exe` 已存在 |
| 打包时 `ffmpeg` 下载失败 | 网络 | 手动 `node packaging/ffmpeg/fetch-ffmpeg.mjs` 重试 |
