# Folia Style Tools — Windows 安装与测试

独立的 MCP 工具包与离线 Style Studio，Windows 10/11 x64，版本 1.0.0-rc.2。不安装或替换 Folia 播放器。内含校验过的 Node 24.15.0、MCP SDK、打包工具、内置风格源码参考、完整审美 skill 和原创建例，无需安装 Node/npm 或保留 Folia 仓库。

这是供真实接口测试的候选包；安装器尚未签署代码签名。Windows 可能显示“未知发布者”。分发时应同时提供 SHA256 校验文件和对应的 Source.zip；候选测试通过后再申请上游合并。

## 安装和启动

1. 双击 `Folia-Style-Tools-1.0.0-rc.2-win-x64-Setup.exe`，按当前用户安装，不需要管理员权限。
2. 开始菜单 → Folia Style Tools → 风格调试器。离线 HTML 使用默认浏览器打开；推荐支持 OffscreenCanvas 的当前 Chrome/Edge。
3. 开始菜单 → 测试 MCP 接口。看到 `passed: true`，表示真实 stdio 和本机 HTTP 接口均通过，不代表模型宿主或美术效果已通过验收。

默认位置：`%LOCALAPPDATA%\Programs\FoliaStyleTools`。后文 PowerShell 使用：

```powershell
$foliaTools = Join-Path $env:LOCALAPPDATA 'Programs\FoliaStyleTools\folia-style.cmd'
& $foliaTools self-test
& $foliaTools configs
```

`configs` 输出到 `%LOCALAPPDATA%\FoliaStyleTools\client-configs`，不会覆盖客户端原配置。内含 Codex、Claude Code/Desktop、DeepSeek Harness、WorkBuddy 配置；支持工具发现的普通 stdio 宿主也可使用 generic 配置。不要把 MCP 端点当作 DeepSeek 聊天网页插件。

## 接入 Codex 并真实调用

先确保 Codex CLI 在 PATH 中可用：

```powershell
& $foliaTools connect-codex
codex mcp get folia-style
```

接入操作通过 `codex mcp add` 仅替换同名条目，原配置备份到 `%LOCALAPPDATA%\FoliaStyleTools\backups`。备份可能含用户原有凭据，仅留在本机，不上传。若 CLI 不在 PATH，手动合并导出的 `codex.stdio.toml`。已打开的聊天可能不会热加载，开启新聊天后发送：

> 使用 folia-style MCP：先调用 folia_style_status，确认 installation.mode 为 standalone；然后用 folia_style_brief 为窗边轻哼写一个方案，读取 lyric-release 和 renderer-api，查询 lumiere 第 3 个参考文件。最后使用 folia_style_check_pack 校验我提供的绝对路径风格包。报告实际调用结果，不要把格式有效写成视觉验收通过。

七个接口：catalog、brief、reference、review_motion、check_pack、read_guide、status（均带 `folia_style_` 前缀）。服务是只读的指导/检查层；Agent 用自己的文件编辑工具生成代码，在 Studio 真正渲染。视频参考在 Studio 本地取帧和标注，MCP 本身不自动识别视频。

## 制作并调试风格包

先选择“个性”（完整设计）或“样式”（歌词模板）。MCP 的 catalog 列出两类内置参考；Studio 可切换分类、载入纯歌词模板。创建样式骨架时给 new 的第三个参数写 lyric-template，例如 `new <目录> my.lyrics lyric-template`。lyricTemplate 元数据只是来源记录，不自动拼接内置程序。旧包缺少 kind 时仍可导入。

```powershell
& $foliaTools new "$env:USERPROFILE\Desktop\my-folia-style" my.first-style
# 编辑目录中的 renderer.js 和 manifest.json；本地模块 import 会在 pack 阶段合并。
& $foliaTools pack "$env:USERPROFILE\Desktop\my-folia-style" "$env:USERPROFILE\Desktop\my-style.json"
& $foliaTools check "$env:USERPROFILE\Desktop\my-style.json"
& $foliaTools studio
```

在 Studio 导入 JSON，测试播放、拖动、横竖屏、减少动态、字幕和连续输出。默认示例为原创 Prism；夜莺、猫蜂包含的第三方壁纸素材不随公共安装包发布，用户已有的本地整合包可以在 Studio 中单独导入。

现有播放器只有包含本项目新增“风格包”加载器的版本才能导入 API 2 JSON；旧版播放器不会因为安装本工具包自动获得该入口。独立 Studio 能完整调试，播放器集成代码已在项目中，贡献合并后需要播放器发布相应版本。

## HTTP 和其他客户端

优先使用 stdio；无需后台常驻服务或端口。需要多个本机客户端共享服务时：

```powershell
$env:FOLIA_MCP_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
& $foliaTools serve --http 43197
```

另一个终端/客户端必须获得相同令牌（不要输出、提交或硬编码）。运行 `doctor --http http://127.0.0.1:43197/mcp` 或 `self-test --http ...` 测试现有服务。只监听 127.0.0.1，拒绝缺失令牌和浏览器 Origin，不提供公网或云端连接器。关闭终端停止服务。

## 更新与卸载

更新前关闭连接到它的 MCP 客户端和服务，再运行新安装器。保留默认安装位置；客户端配置使用绝对路径，迁移后重新运行 configs/connect-codex。不要把自己的项目放在安装目录。

先运行 `disconnect-codex` 移除由当前安装登记的条目（若已改指其他服务，则拒绝删除），再在 Windows“已安装的应用”卸载 Folia Style Tools。其他宿主自行移除对应条目。卸载只删除安装清单内的文件，保留用户添加的文件；配置导出、备份和用户作品保留在安装目录之外。卸载不触碰播放器设置。

## 从源码构建与贡献

在 Windows x64、Node 24.15+ 和已安装仓库依赖的环境中运行：

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run test:unit -- test/unit/stylePacks
npm run style:tools:build
npm run style:tools:source
```

构建从官方 nodejs.org 下载固定版本并核对 SHA256；NSIS 使用 electron-builder 的固定工具链。安装器在 `release/style-tools/`，源码快照与补丁由 source 命令生成。`release.json` 记录 Node 校验、依赖版本、基点提交；安装清单 SHA256SUMS.txt 可供追溯。首次构建需要网络，安装和 stdio 调试不需要网络。

PR 草稿见 `docs/style-tools-contribution.md`。测试报告必须区分：协议自动测试、具体宿主真实调用、浏览器渲染验收和人工审美评价。Claude/DeepSeek Harness/WorkBuddy 配置互通不等于其 UI 或模型回合已经实测。
