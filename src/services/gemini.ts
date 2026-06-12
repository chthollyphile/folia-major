import { DualTheme } from "../types";
import { applyStoredAnimationIntensityToDualTheme } from "./themePreferences";
import { getRuntimeEnvironment } from "../platform/runtime";
import { getMobileAiConfig, validateMobileAiConfig } from "./mobileAiConfig";
import { generateOpenAICompatibleTheme } from "./openaiCompatibleTheme";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? '');
};

export const isMissingAiApiKeyError = (error: unknown) => {
  const message = getErrorMessage(error);
  return /(?:openai_api_key|gemini_api_key|api key|api url|model)/i.test(message)
    && /(?:not configured|missing|configure)/i.test(message);
};

export const generateThemeFromLyrics = async (
  lyricsText: string,
  options?: { isPureMusic?: boolean; songTitle?: string }
): Promise<DualTheme> => {
  try {
    const runtime = getRuntimeEnvironment();

    // Check if running in Electron environment
    if (runtime === 'electron' && (window as any).electron && typeof (window as any).electron.generateTheme === 'function') {
      return await (window as any).electron.generateTheme(lyricsText, options);
    }

    if (runtime === 'capacitor-mobile') {
      const mobileConfig = await getMobileAiConfig();
      validateMobileAiConfig(mobileConfig);
      const dualTheme = await generateOpenAICompatibleTheme({
        apiKey: mobileConfig.apiKey,
        apiUrl: mobileConfig.apiUrl,
        model: mobileConfig.model,
        lyricsText,
        ...options,
      });
      return applyStoredAnimationIntensityToDualTheme(dualTheme);
    }

    const provider = import.meta.env.VITE_AI_PROVIDER;
    const endpoint = provider === 'openai' ? '/api/generate-theme_openai' : '/api/generate-theme';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lyricsText, ...options }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate theme');
    }

    const dualTheme = await response.json();
    return applyStoredAnimationIntensityToDualTheme(dualTheme as DualTheme);
  } catch (error) {
    console.error("Failed to generate theme via API:", error);
    throw error;
  }
};
