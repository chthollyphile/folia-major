![folia](/img/1.png)

# Folia

Folia 是一个专注于提供绚丽歌词播放效果的在线音乐播放器。

# 下载桌面端客户端

如果你想直接获得开箱即用的体验，无需手动搭建任何 Node 环境即可使用自带前后端的跨平台桌面版，**请直接前往 [Releases 页面](https://github.com/chthollyphile/folia-major/releases) 下载** 适用于 Windows、macOS 和 Linux 的最新安装包。

# 展示

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

# 核心功能

## **音乐搜索与播放在线歌曲**
   在主界面的搜索框中输入您想听的歌曲、歌手或专辑名称，即可快速找到在线音乐资源。点击搜索结果中的歌曲即可开始播放，并自动加载对应的歌词与封面。

## **本地音乐支持**
   如果您有自己下载的音频文件，可以直接使用 Folia 播放。
   * 点击界面上的“本地”选项，选择文件夹进行导入（仅支持PC端）
   * Folia 会在您的浏览器本地安全地保存这些信息，不会上传到任何服务器。

## **智能歌词与数据匹配**
   当您播放本地音乐时，Folia 会尝试自动匹配在线的歌词和封面。
   * 如果本地歌曲的同一级目录下存在与歌曲文件同名的 `.lrc` 歌词文件，则会自动加载歌词。翻译歌词文件需要命名为 `歌曲名.t.lrc` 才能自动识别
   * 如果自动匹配的结果不准确，您可以在播放界面右侧面板中打开 “本地” 选项卡，点击 “在线匹配”。
   * 在弹出的 “匹配数据” 窗口中，您可以手动搜索并选择正确的版本。
   * 您可以自由选择使用在线的封面、歌词或元数据（歌手和专辑名），也可以完全关闭在线匹配，仅使用您音频文件自带的数据。

## **个性化主题与背景**
   * **AI 驱动的沉浸式主题**：在播放特定歌曲时，您可以通过点击播放界面右侧面板的 “AI 主题” 按钮（需配置 API 密钥），让 AI 根据歌曲的情感和歌词自动为您生成独一无二的视觉背景参数，获得全新的视听体验。

## 前置要求

### 后端 API
本项目依赖 [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供后端服务。
**您必须自行部署此 API 服务**才能使用播放器。

### AI 功能
Folia 支持 **Google Gemini**（推荐，JSON 响应更稳定）和 **OpenAI 兼容 API**（如 DeepSeek、ChatGPT 等）提供 AI 驱动的功能。

## 部署与开发

### 在 Vercel 上部署
点击下方按钮在 Vercel 上部署此项目。请确保在 Vercel 项目设置中配置必要的环境变量。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)



### 本地开发
我们建议使用 `vercel dev` 进行本地开发，以确保环境与生产环境匹配。

1.  **安装依赖**
    ```bash
    npm install
    ```

2.  **配置环境**
    在根目录创建 `.env.local` 文件。您可以复制示例文件：
    ```bash
    cp .env.example .env.local
    ```
    
    **或者，如果您已经在 Vercel 上配置了环境变量，可以直接拉取：**
    ```bash
    vercel env pull .env.local
    ```

    然后填写您的环境变量（如果手动创建）：

    | 变量名 | 描述 | 必需 |
    | --- | --- | --- |
    | `VITE_NETEASE_API_BASE` | 您的网易云音乐 API 实例的 URL | 是 |
    | `VITE_AI_PROVIDER` | AI 提供商：`google`（Gemini）或 `openai`（OpenAI 兼容） | 是 |
    | `GEMINI_API_KEY` | Google Gemini API Key（使用 Gemini 时需要） | 可选 |
    | `openai_api_key` | OpenAI 兼容 API Key（使用 OpenAI 时需要） | 可选 |
    | `openai_api_url` | OpenAI 兼容 API 端点 URL | 可选 |

    **使用 Google Gemini 的示例：**
    ```env
    VITE_NETEASE_API_BASE=http://localhost:3000
    VITE_AI_PROVIDER=google
    GEMINI_API_KEY=your_google_gemini_api_key
    ```

    **使用 OpenAI 兼容 API 的示例（如 DeepSeek）：**
    ```env
    VITE_NETEASE_API_BASE=http://localhost:3000
    VITE_AI_PROVIDER=openai
    openai_api_key=your_api_key
    openai_api_url=https://api.deepseek.com/v1/chat/completions
    ```

3.  **启动开发服务器**
    ```bash
    vercel dev
    ```

## 法律与免责声明
本软件在 AI 的广泛协助下开发。因此，可能存在细微或难以检测的错误。我们对此可能造成的不便深表歉意。

**特别声明：**
本应用作为展示播放动效与 UI 设计的开源项目，其涉及的任何在线音乐流媒体、在线歌词查阅、专辑封面等数据的版权，均完全归属原版权所有者（如各类流媒体平台、唱片公司及独立创作者）所有。
本应用及源代码仅供个人编程技术学习、交流以及非营利性测试用途，严禁将其用于商业盈利行为。如使用者因传播、加工在线资源后产生任何版权纠纷或其他连带侵权责任，将由使用者个人承担，开发者概不负责。
请始终尊重数字版权，并在有条件的情况下前往官方流媒体平台支持正版音乐。

## 许可证
AGPL-3.0 license
