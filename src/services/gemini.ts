import { DualTheme } from "../types";

export const generateThemeFromLyrics = async (lyricsText: string): Promise<DualTheme> => {
  try {
    const provider = import.meta.env.VITE_AI_PROVIDER;
    const endpoint = provider === 'openai' ? '/api/generate-theme_openai' : '/api/generate-theme';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lyricsText }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate theme');
    }

    const dualTheme = await response.json();
    return dualTheme as DualTheme;
  } catch (error) {
    console.error("Failed to generate theme via API:", error);
    throw error;
  }
};