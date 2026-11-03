# Folia 技术与开发说明

这份文档收纳仓库 README 中较细的部署、开发、桌面端和技术栈说明。更完整的使用指南也可以访问专门的文档站点：

- [Folia Guide](https://folia-site.cielaniska.top/guide/)
- [Stage API 文档](../test/manual/stage-client/README.md)

## 桌面端说明

桌面版内置前后端运行环境，适合希望即装即用的用户。最新版本请前往 [Releases 页面](https://github.com/chthollyphile/folia-major/releases)。

### 发布与更新通道

| 通道 | 面向对象 | 更新来源 | 网盘下载 |
| --- | --- | --- | --- |
| Realeco | 正式版 | `latest` | 提供 |
| Limo | Nightly | `beta`，也可升级到 Realeco | 不提供 |
| Cielo | Canary | `alpha`，也可升级到 Limo / Realeco | 不提供 |

Realeco 发布仅在 `main` 修改根目录 `realeco-release` 时触发。自动触发时，该文件必须只包含单行 `A.B.C`，并且必须同时与 `package.json` 版本、当前完整提交信息 `release: vA.B.C` 严格一致。手动触发作为应急入口，会跳过这两项一致性检查，直接使用当前 HEAD 的 `package.json.version`（仍必须是稳定的 `A.B.C`）打包。工作流创建草稿 Release；维护者在 GitHub 手动公开后，Realeco 客户端才会发现更新。

Cielo 的 `[canary]` 推送会更新滚动的 `cielo` prerelease，供 Cielo 通道客户端获取更新。手动运行 Cielo 工作流时可选择 `branch-release`，为当前分支和提交创建独立的 `cielo-<branch>-<sha>` prerelease，供人工下载和回归；该 Release 不参与客户端自动更新。选择 `artifacts` 则不创建 Release，只将各平台构建产物保留 14 天。

### Linux 获取方式

1. Arch Linux / Manjaro：通过 AUR 安装 `folia-major-bin`

```bash
yay -S folia-major-bin
```

2. Debian / Ubuntu / Linux Mint：下载 `.deb`
3. Fedora / RHEL / openSUSE：下载 `.rpm`
4. 其他发行版：下载 `tar.gz`，解压后直接运行 `folia-major`

`tar.gz` 包中附带图标与 `.desktop` 模板，可按需手动创建桌面启动项。

### Quickshell 歌词插件

对于 omarchy 4 / quickshell 用户，我们提供一个简单的顶部歌词插件：[lia.lines](https://github.com/chthollyphile/lia.lines)

omarchy 用户可从下列官方插件市场链接获取：

https://omarchyplugins.com/plugin.html?id=lia.folia-lyrics

可连接 folia-v1-lyric 接口，在顶部状态栏查看歌词，以及进行暂停/播放操作。该插件在folia没有播放的时候也支持作为简易MPRIS组件，显示媒体信息

<img width="2560" height="51" alt="image" src="https://github.com/user-attachments/assets/87cb8db0-ef00-4382-9eb3-fa7696e4f6ff" />



### Hyprland / Wayland 遥控窗

桌面端的外部遥控窗会作为主窗口的伴随窗口打开，并使用稳定窗口标题 `Folia Remote`。

纯 Wayland 下 Folia 没法自己把窗口置顶：Chromium 的 Wayland 后端收到置顶请求后只记下这个值，不发给合成器（标准 xdg-shell 也没有"置顶"这个请求）。所以这时遥控窗右上角的图钉、遥控窗"更多"里主窗口的"置顶"、托盘菜单的"窗口置顶"都是灰的，命令面板里也没有"切换主窗口置顶"。要置顶，交给合成器的窗口规则，做法见下面 Hyprland 和 KDE 两节；也可以改用 XWayland 运行（见 KDE 一节最后），那样这几个开关照常可用。

#### Hyprland

如果希望遥控窗以悬浮小窗方式出现并保持置顶，可以在 `hyprland.conf` 中添加类似规则：

```ini
windowrule {
  name = folia-remote
  float = on
  size = 602 184
  center = on
  pin = on
  no_blur = on
  border_size = 0
  no_shadow = on
  match:class = ^(folia-major)$
  match:title = ^(Folia Remote)$
}

```

不同打包方式下窗口 `class` 可能不同；如果规则没有生效，可以用 `hyprctl clients` 查看实际 `class` / `title` 后再调整匹配条件。

#### KDE Plasma（KWin）

长期生效的做法是加一条 KWin 窗口规则（括号里是英文界面的名字，中文翻译随版本可能略有不同）：

1. 打开"系统设置"里的"窗口规则"（Window Rules），新建一条规则。
2. "窗口类（应用程序）"（Window class (application)）填 `folia-major`，"窗口标题"（Window title）填 `Folia Remote`，都选"完全匹配"（Exact Match）。也可以在遥控窗开着时点"检测窗口属性"（Detect Window Properties），再点一下遥控窗，自动填入。
3. 点"添加属性"（Add Property），选"保持在其他窗口之上"（Keep above other windows），设为"强制"（Force）和"是"（Yes），然后应用。

主窗口（例如桌面歌词）也想置顶的话，把"窗口标题"那一项去掉、只按窗口类匹配：这条规则会同时作用于主窗口和遥控窗。

只想临时置顶一次：选中窗口后按 `Alt+F3` 打开窗口菜单，在"更多操作"（More Actions）里勾选"保持在其他窗口之上"（Keep Above Others）。遥控窗没有系统标题栏，所以用快捷键打开这个菜单；关掉窗口后这个设置不会保留。

和 Hyprland 一样，不同打包方式下窗口类可能不同，以"检测窗口属性"看到的为准。

也可以让 Folia 走 XWayland：启动时加上 `--ozone-platform=x11`（例如 `folia-major --ozone-platform=x11`，或者写进 `.desktop` 文件的 `Exec` 行）。这时置顶由 Folia 自己完成，上面几个开关照常可用；代价是窗口改走 X11 兼容层，缩放、输入法等方面的表现可能与原生 Wayland 不同，壁纸模式在这种运行方式下也不保证可用。

## 部署与开发

### 后端 API

本项目依赖 [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供音乐相关后端服务。

如果使用前端版本的话，需要先自行部署该 API 服务。

QQ 音乐是可选音源，由 npm 包 `@yakult-green-tea/qq-music-api` 提供，有两种部署形态。一是常驻 Node 进程（Docker 容器、裸 Node，或 Electron 主进程内嵌），功能最完整，支持手机 QQ 扫码、微信扫码和 QQ 音乐 App 扫码；后端 3.3.2 起 Folia 只显示一张 QQ 音乐 App 扫码的二维码，手机 QQ、微信、QQ 音乐 App 都能扫。二是 serverless：从 3.0.0 起该包提供 `./serverless` 导出，本仓库已内置 Cloudflare Workers 与 Vercel 两个平台的入口，把 `VITE_QQ_API_BASE` 填成 `/api/qq` 并配好 `QQ_SESSION_SECRET` 即可，不需要单独部署 API 实例。serverless 形态默认支持微信扫码，3.3.3 起也支持手机 QQ 扫码（走 QQ 互联的网页登录，不用长连接），且 `/getMusicPlay` 必须先登录；Cloudflare 可选地绑定 Durable Object（`QQ_QR_CHANNEL` → `QqQrChannel`），手机 QQ 扫码改走长连接，3.3.2 起还多一个 QQ 音乐 App 扫码。完整部署步骤与排错方法见 [QQ 音乐部署指南](qq-music-deployment.md)；Docker 镜像、卷和常驻服务细节见 [`deploy/docker/qq-api/README.md`](../deploy/docker/qq-api/README.md)。Electron 版在主进程内直接启动该包，不需要单独部署。Folia 锁定 3.3.3：电台页的每日推荐、私人 FM（猜你喜欢）与推荐歌单，往自建歌单加歌删歌和收藏歌单，是 3.3.0 新增的接口；红心与收藏专辑是 3.3.1 新增的；3.3.2、3.3.3 新增的接口（音乐云盘、QQ 音乐 App 扫码、续期、排行榜、新碟、刷歌模式等）见 [`deploy/docker/qq-api/README.md`](../deploy/docker/qq-api/README.md)。不喜欢与历史日推后端还没有，QQ 不提供这两项。

### AI 能力

Folia 当前支持以下两类 AI 提供方式：

- Google Gemini
- OpenAI 兼容 API，例如 DeepSeek、ChatGPT 接口等

Gemini 通常更适合当前项目场景，因为 JSON 输出相对稳定。

桌面版的设置里可以直接选 OpenAI、Anthropic、Google Gemini、DeepSeek、Kimi、智谱 GLM、阿里云 Qwen、腾讯云 TokenHub、小米 MiMo，或自定义兼容接口；有多个站点的（如 Kimi、GLM 的国内站和国际站，Qwen 的各地域）可以选站点。每家供应商一个适配器（`shared/ai/`），按接口地址的主机名选用，分别决定推理开关、温度范围、上限字段和结构化输出：歌词分词和测试连接能关思考就关、关不掉就用最低档；主题用最低档或关掉。网页版用同一批适配器，同样按 `OPENAI_API_URL` 的主机名推断，但只走 OpenAI 兼容协议（没有网页版的 Anthropic 原生协议）。

### Stage API

Folia 提供了从外部与播放器进行交互的 Stage API，从而可以实现外部程序与播放器的深度集成。可以通过 `npm run stage:client` 启动本地联调台，查看和测试这些接口的功能。

具体可参考 [Stage API 文档](../test/manual/stage-client/README.md)。

### 歌词接口

Electron 桌面端可在“连接与集成”中启用歌词接口。启用后，Folia 仅在回环地址提供无需鉴权的固定接口：

```text
GET http://127.0.0.1:32109/v1/lyric
```

接口返回当前歌词的精简 JSON，并在顶层 `offset` 字段中携带用户设置的歌词时间偏移（毫秒）；当前没有歌词时返回 `null`。请求、响应结构、字段说明和调用示例见 [歌词接口文档](lyric-api.md)。

### 一键部署到 Vercel

如果你希望快速上线 Web 版本，可以直接通过下方入口创建 Vercel 项目：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)

部署完成后，请在 Vercel 项目设置中补齐环境变量。

### 本地开发

推荐使用 `vercel dev`，这样本地环境会更接近线上部署行为。

本项目要求 Node.js 24 或更高版本。

#### 1. 安装依赖

```bash
npm install
```

#### 2. 配置环境变量

在项目根目录创建 `.env.local`：

```bash
cp .env.example .env.local
```

如果你已经在 Vercel 中配置过环境变量，也可以直接拉取：

```bash
vercel env pull .env.local
```

然后按需填写以下变量：

| 变量名 | 描述 | 是否必需 |
| --- | --- | --- |
| `VITE_NETEASE_API_BASE` | 网易云音乐 API 实例地址 | 是 |
| `VITE_KUGOU_API_BASE` | Web 版的 KuGouMusicApi 实例地址；Electron 不使用此项 | 否，默认留空 |
| `VITE_QQ_API_BASE` | QQ 音乐 API 实例地址；Cloudflare / Vercel 上可填 `/api/qq` 用本仓库内置的 serverless 入口；留空时 QQ 入口可见但不可用 | 否，默认留空 |
| `QQ_SESSION_SECRET` | serverless 形态下加密登录态用的服务端密钥，**不加 `VITE_` 前缀**；未设置时 QQ 登录路由回 501，曲库路由仍可用 | 用 `/api/qq` 时需要 |
| `QQ_SESSION_SECRET_PREVIOUS` | 轮换 `QQ_SESSION_SECRET` 时用来验证旧令牌，避免把所有人一次性登出 | 否 |
| `VITE_AI_PROVIDER` | AI 提供商，`google` 或 `openai` | 是 |
| `GEMINI_API_KEY` | Gemini API Key | 使用 Gemini 时需要 |
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | 使用 OpenAI兼容接口 时需要 |
| `OPENAI_API_URL` | OpenAI 兼容接口地址，可填 base URL 或完整 `chat/completions` 地址；留空等于 OpenAI 官方接口。供应商按主机名推断（`api.openai.com`、`api.deepseek.com`、`api.moonshot.cn` / `api.moonshot.ai`、`open.bigmodel.cn` / `api.z.ai`、百炼 `dashscope*.aliyuncs.com`、TokenHub、`*.xiaomimimo.com`），其余主机按自定义兼容接口处理 | 使用 OpenAI兼容接口 时需要 |
| `OPENAI_API_MODEL` | 模型名，例如 `gpt-5.6-luna`、`deepseek-flash`；留空时用该供应商的默认模型（OpenAI 与自定义接口 `gpt-5.6-luna`、DeepSeek `deepseek-flash`、Kimi `kimi-k2.6`、GLM `glm-5.2`、Qwen `qwen3.8-flash`、TokenHub `deepseek-v4-flash`、MiMo `mimo-v2.6-flash`） | 否 |
| `OPENAI_API_TEMPERATURE` | 温度，留空或无效时默认使用 `0.7`；只发给接受它的供应商，并截到该供应商的范围 | 否 |

注意：温度按供应商处理。OpenAI 和 Kimi 从不发温度（OpenAI 的推理模型带温度会报错，Kimi 的模型采样是固定的）；GLM 截到 `1`，MiMo 截到 `1.5`，Qwen 截到 `1.99`，TokenHub 只发给部分模型；DeepSeek 和自定义接口按 `0`–`2`。

Gemini 示例：

```env
VITE_NETEASE_API_BASE=http://localhost:3000
VITE_KUGOU_API_BASE=
VITE_AI_PROVIDER=google
GEMINI_API_KEY=your_google_gemini_api_key
```

Web 版要使用酷狗时，需要自行部署 [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) 并填写 `VITE_KUGOU_API_BASE`。该变量没有默认公共实例；开发调试时可在 `.env.local` 中临时指向调试服务。Electron 版在主进程中直接调用内置的 KuGouMusicApi Node 模块，不会再启动一个酷狗 HTTP 服务。

Electron 的酷狗登录与账号刷新日志位于 `%APPDATA%\Folia\logs\kugou-provider.log`。日志只记录请求阶段、状态、字段名和错误摘要，token、Cookie、userid、dfid 会被脱敏。

本机同时验收 Folia、网易云扫码和 QQ 扫码时，Vite 使用 `3000`，因此网易云 API 应改用 `3300`，QQ API 使用 `3200`。在 `folia-major/.env.local` 设置：

```env
VITE_NETEASE_API_BASE=http://localhost:3300
VITE_QQ_API_BASE=http://localhost:3200
```

然后分别打开三个 PowerShell 窗口并保持运行：

```powershell
# qq-music-api repo
$env:PORT = '3200'
npm start

# folia-major repo：网易云 API
npx cross-env PORT=3300 api

# folia-major repo：前端
npm run dev
```

修改 `.env.local` 后必须重启 Vite。关闭对应窗口或按 `Ctrl+C` 会停止服务。

OpenAI 兼容接口示例：

```env
VITE_NETEASE_API_BASE=http://localhost:3000
VITE_AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key
OPENAI_API_URL=https://api.deepseek.com
OPENAI_API_MODEL=deepseek-flash
OPENAI_API_TEMPERATURE=0.7
```

如果你使用的是 OpenAI 官方接口，也可以这样写（OpenAI 不发温度，`OPENAI_API_TEMPERATURE` 不用填）：

```env
VITE_NETEASE_API_BASE=http://localhost:3000
VITE_AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_MODEL=gpt-5.6-luna
```

#### 3. 启动开发环境

```bash
vercel dev
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 构建 Web 版本 |
| `npm run preview` | 预览构建结果 |
| `npm run dev:electron` | 启动 Electron 开发模式 |
| `npm run dev:electron:update-preview` | 启动 Electron 开发模式，并模拟显示版本更新提示 |
| `npm run dev:electron:wallpaper` | 先构建 `windowtolayer`，再启动 Electron 开发模式（Linux 壁纸模式联调） |
| `npm run dev:electron:dist` | 构建后以桌面模式运行 |
| `npm run build:electron` | 打包桌面端应用 |
| `npm run build:windowtolayer` | 单独构建 Linux 壁纸模式依赖的 `build/windowtolayer` |
| `npm run build:wallpaper-helper` | 单独构建 Windows 壁纸模式依赖的 `build/folia-wallpaper-helper.exe`（非 Windows 主机为 no-op） |
| `npm run stage:client` | 打开本地 Stage API 联调台 |

所有 `dev:electron*` 脚本都会注入 `FOLIA_WINDOWTOLAYER_PATH=build/windowtolayer`，让开发运行也能找到壁纸模式所需的
`windowtolayer`（打包运行时用的是 `resources/windowtolayer`）。该二进制不随仓库分发，首次联调壁纸模式前先跑一次
`npm run build:windowtolayer`（或直接用 `npm run dev:electron:wallpaper`）；二进制缺失时壁纸模式开关会自动回退关闭。

## 代码速查地图

| 需求 | 优先入口 |
| --- | --- |
| App 顶层装配、overlay、dialog、播放器面板参数组装 | `src/components/app/*` |
| 设置中心 UI | `src/components/modal/settings/*` |
| 设置持久化、visualizer tuning、偏好 store | `src/stores/useSettingsUiStore.ts` |
| 命令面板命令 | `src/components/command-palette/commands/<group>Commands.ts`（`commandRegistry.ts` 只做拼接与过滤） |
| visualizer 共享契约和注册 | `src/components/visualizer/definition.ts`、`src/components/visualizer/registry.tsx` |
| visualizer 预览和设置面板 | `src/components/visualizer/window/VisPlayground.tsx`、`src/components/visualizer/window/VisPlaygroundSettingsPanel.tsx` |
| visualizer 模式实现 | `src/components/visualizer/<mode>/*` |
| 歌词解析和渲染提示 | `src/utils/lyrics/*` |
| 智能过渡（混音过渡开关背后的全部实现） | `src/services/automix/*`，先读该目录的 `README.md` |
| 本地音乐、Navidrome、网易云服务 | `src/services/*` |
| 共享类型和默认 tuning | `src/types.ts` |

新增设置时遵守项目 skill：视觉相关设置需要进入外观页的配置导入导出；功能性设置和可执行动作需要注册到 command palette。

## 技术栈

- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- React 19
- Vite 6
- TypeScript
- Tailwind CSS 4
- Framer Motion
- Electron
- i18next
