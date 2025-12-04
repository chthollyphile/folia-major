import { Theme } from "../types";

export const generateThemeFromLyrics = async (lyricsText: string): Promise<Theme> => {
  try {
    const response = await fetch('/api/generate-theme', {
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

    const theme = await response.json();
    return theme as Theme;
  } catch (error) {
    console.error("Failed to generate theme via API:", error);
    throw error;
  }
};