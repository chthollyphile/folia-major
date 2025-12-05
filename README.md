![folia](/img/1.png)

# Folia

Folia 是一个专注于提供绚丽歌词播放效果的在线音乐播放器。

# 展示

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

## 前置要求

### 后端 API
本项目依赖 [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供后端服务。
**您必须自行部署此 API 服务**才能使用播放器。

### AI 功能
Folia 使用 Google Gemini 提供 AI 驱动的功能。
**您需要获取 Google Gemini API Key** 才能启用这些功能。

## 部署与开发

### 在 Vercel 上部署
点击下方按钮在 Vercel 上部署此项目。请确保在 Vercel 项目设置中配置必要的环境变量（`GEMINI_API_KEY`和 `VITE_NETEASE_API_BASE`）。

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
    | `GEMINI_API_KEY` | 用于 AI 主题生成的 Google Gemini API Key | 是 |
    | `VITE_NETEASE_API_BASE` | 您的网易云音乐 API 实例的 URL | 是 |

    示例 `.env.local`：
    ```env
    GEMINI_API_KEY=your_google_gemini_api_key
    VITE_NETEASE_API_BASE=http://localhost:3000
    ```

3.  **启动开发服务器**
    ```bash
    vercel dev
    ```

## 免责声明
本软件在 AI 的广泛协助下开发。因此，可能存在细微或难以检测的错误。我们对此可能造成的不便深表歉意。

## 许可证
MIT License
