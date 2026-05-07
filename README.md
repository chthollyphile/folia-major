<p align="center">
  <img src="/img/1.png" alt="Folia" width="100%" />
</p>

<div align="center">

# Folia

Lyrics Reimagined

[![GitHub release](https://img.shields.io/github/v/release/chthollyphile/folia-major?label=release)](https://github.com/chthollyphile/folia-major/releases)
[![License](https://img.shields.io/github/license/chthollyphile/folia-major)](https://github.com/chthollyphile/folia-major/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/chthollyphile/folia-major?style=social)](https://github.com/chthollyphile/folia-major/stargazers)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

[桌面版下载](https://github.com/chthollyphile/folia-major/releases)
·
[Vercel 部署](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)

</div>

## 项目简介

Folia是一个以全屏沉浸式歌词播放为核心的在线音乐播放器，支持网易云，navidrome和本地音乐库，通过智能歌词匹配和AI生成的动态背景，为用户提供独特的听歌体验。

如果你希望直接获得开箱即用的体验，而不是手动配置 Node 环境或部署服务，推荐直接使用基于Electron的 windows/ macOS/ Linux 桌面端版本。

对于移动设备，可以选择一键部署到 Vercel 的 Web 版本，或自行部署到其他支持 Node.js 的平台。

## 展示

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

## 核心能力

| 模块 | 说明 |
| --- | --- |
| 在线搜索与播放 | 搜索歌曲、歌手或专辑后即可播放，并自动加载相关封面与歌词。 |
| 本地音乐支持 | 可导入本地音频文件，在本地安全保存索引信息，不上传文件内容。 |
| 智能歌词匹配 | 本地歌曲可自动匹配在线歌词与封面，也支持手动修正匹配结果。 |
| LRC 文件识别 | 自动加载同目录同名 `.lrc` 歌词文件，翻译歌词文件命名为 `歌曲名.t.lrc`。 |
| AI 主题生成 | 基于歌曲情绪与歌词内容生成沉浸式背景与视觉参数。 |
| 多端体验 | 提供 Web 部署方式，同时支持桌面端打包分发。 |

## 桌面端下载

桌面版内置前后端运行环境，适合希望即装即用的用户。最新版本请前往 [Releases 页面](https://github.com/chthollyphile/folia-major/releases)。

### Linux 获取方式

1. Arch Linux / Manjaro：通过 AUR 安装 `folia-major-bin`

```
yay -S folia-major-bin
```

2. Debian / Ubuntu / Linux Mint：下载 `.deb`
3. Fedora / RHEL / openSUSE：下载 `.rpm`
4. 其他发行版：下载 `tar.gz`，解压后直接运行 `folia-major`

`tar.gz` 包中附带图标与 `.desktop` 模板，可按需手动创建桌面启动项。

## 部署与开发

### 后端 API

本项目依赖 [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供音乐相关后端服务。

如果使用前端版本的话，需要先自行部署该 API 服务。

### AI 能力

Folia 当前支持以下两类 AI 提供方式：

- Google Gemini
- OpenAI 兼容 API，例如 DeepSeek、ChatGPT 接口等

Gemini 通常更适合当前项目场景，因为 JSON 输出相对稳定。

## 部署与开发

### 一键部署到 Vercel

如果你希望快速上线 Web 版本，可以直接通过下方入口创建 Vercel 项目：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)

部署完成后，请在 Vercel 项目设置中补齐环境变量。

### 本地开发

推荐使用 `vercel dev`，这样本地环境会更接近线上部署行为。

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
| `VITE_AI_PROVIDER` | AI 提供商，`google` 或 `openai` | 是 |
| `GEMINI_API_KEY` | Gemini API Key | 使用 Gemini 时需要 |
| `OPENAI_API_KEY` | OpenAI 兼容 API Key | 使用 OpenAI兼容接口 时需要 |
| `OPENAI_API_URL` | OpenAI 兼容接口地址，可填 base URL 或完整 `chat/completions` 地址 | 使用 OpenAI兼容接口 时需要 |
| `OPENAI_API_MODEL` | 模型名，例如 `gpt-4o`、`gpt-4.1-mini`、`deepseek-v4-flash` | 使用 OpenAI兼容接口 时需要 |

Gemini 示例：

```env
VITE_NETEASE_API_BASE=http://localhost:3000
VITE_AI_PROVIDER=google
GEMINI_API_KEY=your_google_gemini_api_key
```

OpenAI 兼容接口示例：

```env
VITE_NETEASE_API_BASE=http://localhost:3000
VITE_AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key
OPENAI_API_URL=https://api.deepseek.com
OPENAI_API_MODEL=deepseek-v4-flash
```

如果你使用的是 OpenAI 官方接口，也可以这样写：

```env
VITE_NETEASE_API_BASE=http://localhost:3000
VITE_AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_MODEL=gpt-4o
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
| `npm run dev:electron:dist` | 构建后以桌面模式运行 |
| `npm run build:electron` | 打包桌面端应用 |
| `npm run stage:client` | 打开本地 Stage 联调客户端 |

## 本地音乐与匹配说明

使用本地音乐时，Folia 会优先尝试从以下来源补全信息：

1. 音频文件自身元数据
2. 同目录同名歌词文件
3. 在线匹配结果

如果自动匹配不准确，可以在播放界面的右侧面板进入“本地”选项卡，手动搜索并指定更合适的歌词、封面或元数据来源。你也可以选择只使用本地信息，关闭在线匹配结果。

## Stage 联调客户端

如果你已经在桌面端开启了 Stage Mode，可以使用仓库内置的 Stage controller 调试台向 Folia 推送会话，并测试新版实时控制协议。

1. 在 Folia 设置中开启 Stage Mode，并复制 Bearer token
2. 运行：

```bash
npm run stage:client
```

3. 页面打开后填写：

- Stage 地址，默认 `http://127.0.0.1:32107`
- Bearer token
- controller ID
- 音频 URL 或音频文件
- 歌词文本或歌词文件

如果上传的是音频文件，Folia 还会尝试直接读取文件内嵌歌词、封面和歌曲 metadata。歌词现在是可选的；如果提供了歌词，Stage 会复用 Folia 自己的解析链来尝试解析，失败时会降级成无歌词播放。
联调页面里的 `Lyrics format` 也可以保持 `auto-detect`，或者显式指定 `lrc`、`enhanced-lrc`、`vtt`、`yrc`。
页面会分别展示 `GET /stage/health`、`POST /stage/session`、`DELETE /stage/session` 以及 `WS /stage/ws` 的组装请求和返回结果。

新版调试台还支持：

- 连接多个 Electron Folia 实例
- 自动发送 controller `hello`
- 查看 `server_hello`、`hello_ack`、`control_request`、`stage_session` 等实时消息
- 在浏览器里直接广播 `stage_state`
- 手动测试 `play / pause / seek / next / prev / loop`
- 将单个实例收到的控制请求同步广播到多个选中实例，验证集群一致性

## 技术栈

- React 19
- Vite 6
- TypeScript
- Tailwind CSS 4
- Framer Motion
- Electron
- i18next

## 法律与免责声明

本项目在 AI 的广泛协助下开发，因此仍可能存在细微或不易察觉的问题。若给你带来不便，敬请理解。

本项目主要用于展示播放动效、界面设计与相关工程实现。应用中涉及的在线音乐流媒体、歌词、专辑封面及其他内容，其版权均归对应权利人所有。

本仓库及其源代码仅供个人学习、技术交流与非营利测试使用。请勿将其用于商业盈利用途。若因对在线资源的传播、加工或再分发而引发版权纠纷或其他责任，均由使用者自行承担，项目开发者不承担相关责任。

请始终尊重数字版权，并在条件允许时通过官方平台支持正版音乐。

## 许可证

本项目基于 `AGPL-3.0` 许可证开源。
