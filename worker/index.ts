import { handleGenerateTheme } from "./generate-theme.ts";
import { handleGenerateOpenAITheme } from "./generate-theme_openai.ts";
import { handleLyricProxy } from "./lyric-proxy.ts";

type Env = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_API_URL?: string;
  OPENAI_API_MODEL?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate-theme") {
      return handleGenerateTheme(request, env);
    }

    if (url.pathname === "/api/generate-theme_openai") {
      return handleGenerateOpenAITheme(request, env);
    }

    if (url.pathname === "/api/lyric-proxy") {
      return handleLyricProxy(request);
    }

    return env.ASSETS.fetch(request);
  },
};
