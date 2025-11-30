![folia](/img/1.png)

# Folia

Folia is an online music player focused on delivering dazzling lyric playback effects.

## Prerequisites

### Backend API
This project relies on the [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) for its backend services.
**You must deploy this API service yourself** to use the player.

### AI Features
Folia utilizes Google Gemini for its AI-powered features.
**You need to obtain a Google Gemini API Key** to enable these functionalities.

## Deployment & Development

### Deploy on Vercel
You can easily deploy this project on Vercel. Ensure you configure the necessary environment variables (like your API endpoints and Gemini API key) in your Vercel project settings.

### Local Development
We recommend using `vercel dev` for local development to ensure the environment matches production.

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Configure Environment**
    Create a `.env.local` file in the root directory. You can copy the example file:
    ```bash
    cp .env.example .env.local
    ```
    
    **Alternatively, if you have already configured the environment variables on Vercel, you can pull them directly:**
    ```bash
    vercel env pull .env.local
    ```

    Then fill in your environment variables (if manually creating):

    | Variable | Description | Required |
    | --- | --- | --- |
    | `GEMINI_API_KEY` | Google Gemini API Key for AI theme generation | Yes |
    | `VITE_NETEASE_API_BASE` | URL of your Netease Cloud Music API instance | Yes |

    Example `.env.local`:
    ```env
    GEMINI_API_KEY=your_google_gemini_api_key
    VITE_NETEASE_API_BASE=http://localhost:3000
    ```

3.  **Start Development Server**
    ```bash
    vercel dev
    ```

## Disclaimer
This software was developed with extensive assistance from AI. Consequently, there may be subtle or difficult-to-detect bugs. We apologize for any inconvenience this may cause.

## License
MIT License
