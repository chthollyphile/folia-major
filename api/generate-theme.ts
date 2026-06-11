import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { lyricsText, isPureMusic = false, songTitle } = req.body;

    if (!lyricsText) {
      return res.status(400).json({ error: 'Missing lyricsText' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("Gemini API Key is missing in server environment.");
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Limit text to avoid token limits if lyrics are huge
    const snippet = lyricsText.slice(0, 2000);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the mood of the provided song source text and generate TWO visual theme configurations for a music player - one for LIGHT mode and one for DARK mode.

      DUAL THEME REQUIREMENTS:
      1. Generate TWO complete themes: one optimized for LIGHT/DAYLIGHT mode, one for DARK/MIDNIGHT mode.
      2. Both themes should capture the SAME emotional essence of the source text, but with appropriate color palettes for their respective modes.
      3. The theme names should reflect both the mood AND the mode (e.g., "Melancholic Dawn" for light, "Melancholic Midnight" for dark).
      4. The theme description should be a brief, emotional sentence in Chinese (10-20 characters) reflecting a stream-of-consciousness style with youth and literary characteristics, capturing a listener's immediate emotional reaction to this song. Do not write formal analytical text. Must be written from a first-person listener perspective.
         GUIDELINES FOR THE EXPRESSIVE STYLE:
         - Stream of Consciousness & Literary Vibe: Emphasize poetic, reflective, or introspective thoughts (e.g., emotional connection, existential thoughts, quiet solitude).
         - Youth & Nostalgia: Associate the mood with nostalgic memories of youth, dreams, seasons, or romantic longing.
         - Spatial & Situational Synesthesia: Translate the music's vibe into a vivid situation, atmosphere, weather, or imagery (e.g., summer breeze, starry sky, quiet room).
         Examples for reference: "戴上耳机的那一刻，喧嚣的世界瞬间消失了。", "然后，这份爱编织了太阳和所有星星", "你的世界，也包括我在内吗？", "微醺的夏夜吹拂过一阵海风。", "青春是一种眺望的姿态！", "仿佛回到了那个满是汽水味和单车后座的夏天。"。

      SOURCE MODE:
      1. If 'Pure instrumental' is yes, the source text below is the song title of a pure instrumental track, not lyrics.
      2. If 'Pure instrumental' is no, the source text below is a lyrics snippet.
      3. Base your mood inference only on the provided source text.
      
      COLOR & THEME GENERATION WORKFLOW:
      1. First, identify 5-10 key emotional words or phrases from the source text that represent the core mood and atmosphere of the song.
      2. Assign a specific, representative color to each of these key emotional words/phrases under 'wordColors'.
      3. Based on the emotional direction and colors of these identified words, construct the overall color palettes (backgroundColor, primaryColor, secondaryColor, accentColor) for the light and dark themes.
      4. Coordinated Colors: The colors assigned in 'wordColors' must be designed in coordination and harmony with the overall color schemes of the themes.

      LIGHT THEME RULES:
      - Use LIGHT backgrounds. Avoid defaulting to pure white background for every light theme. Generate diverse and rich light-colored backgrounds (e.g., warm creams, soft pastel blues, pale sage greens, gentle peach, warm sands, pale lavenders) that directly match the song's mood.
      - Ensure text/icons are dark enough for contrast.
      - 'accentColor' must be visible against the light background.
      
      DARK THEME RULES:
      - Use DARK backgrounds. Avoid generic pure black backgrounds; use rich, diverse dark colors (e.g., deep midnight blue, dark forest green, charcoal gray, dark plum, deep chocolate, burgundy) matching the song's mood.
      - Ensure text/icons are light enough for contrast.
      
      SHARED RULES FOR BOTH THEMES:
      1. CRITICAL for 'secondaryColor': This color is used for secondary TEXT (e.g., album name, artist name).
         - It MUST have sufficient contrast against 'backgroundColor' to be easily readable.
         - Aim for a contrast ratio of at least 4.5:1 for accessibility.
      2. 'wordColors' and 'lyricsIcons' should be the SAME for both themes (they represent the source text's meaning).
      
      IMPORTANT for 'wordColors':
      1. As stated in the workflow, extract 5-10 emotional words or phrases. If the source text is a very short pure-instrumental title, you may return fewer entries.
      2. CRITICAL: The 'word' field MUST match the EXACT text in the source snippet (case-insensitive). If the pure-instrumental title is very short, using the exact full title as a phrase is allowed.
      
      IMPORTANT for 'lyricsIcons':
      1. Identify 3-5 visual concepts/objects mentioned in or strongly implied by the source text.
      2. Return them as valid Lucide React icon names (PascalCase, e.g., 'CloudLightning', 'HeartHandshake').
      
      Pure instrumental: ${isPureMusic ? 'yes' : 'no'}
      ${isPureMusic && songTitle ? `Song title: ${songTitle}\n` : ''}Source snippet:
      ${snippet}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            light: {
              type: Type.OBJECT,
              description: "Theme optimized for light/daylight mode",
              properties: {
                name: { type: Type.STRING, description: "A creative name for this light theme" },
                description: { type: Type.STRING, description: "A creative 1-sentence description of the mood or visual concept" },
                backgroundColor: { type: Type.STRING, description: "Hex code for light background (whites, creams, pastels)" },
                primaryColor: { type: Type.STRING, description: "Hex code for main text (dark color for contrast)" },
                accentColor: { type: Type.STRING, description: "Hex code for highlighted text/effects" },
                secondaryColor: { type: Type.STRING, description: "Hex code for secondary elements (must contrast with light bg)" },
                wordColors: {
                  type: Type.ARRAY,
                  description: "List of exact emotional words or phrases from the source text and their specific colors",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      word: { type: Type.STRING },
                      color: { type: Type.STRING },
                    },
                    required: ["word", "color"],
                  },
                },
                lyricsIcons: {
                  type: Type.ARRAY,
                  description: "List of Lucide icon names related to the source text",
                  items: { type: Type.STRING }
                },
              },
              required: ["name", "backgroundColor", "primaryColor", "accentColor", "secondaryColor"],
            },
            dark: {
              type: Type.OBJECT,
              description: "Theme optimized for dark/midnight mode",
              properties: {
                name: { type: Type.STRING, description: "A creative name for this dark theme" },
                description: { type: Type.STRING, description: "A creative 1-sentence description of the mood or visual concept" },
                backgroundColor: { type: Type.STRING, description: "Hex code for dark background (deep colors)" },
                primaryColor: { type: Type.STRING, description: "Hex code for main text (light color for contrast)" },
                accentColor: { type: Type.STRING, description: "Hex code for highlighted text/effects" },
                secondaryColor: { type: Type.STRING, description: "Hex code for secondary elements (must contrast with dark bg)" },
                wordColors: {
                  type: Type.ARRAY,
                  description: "List of exact emotional words or phrases from the source text and their specific colors",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      word: { type: Type.STRING },
                      color: { type: Type.STRING },
                    },
                    required: ["word", "color"],
                  },
                },
                lyricsIcons: {
                  type: Type.ARRAY,
                  description: "List of Lucide icon names related to the source text",
                  items: { type: Type.STRING }
                },
              },
              required: ["name", "backgroundColor", "primaryColor", "accentColor", "secondaryColor"],
            },
          },
          required: ["light", "dark"],
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error("Failed to generate theme JSON");
    }

    const dualTheme = JSON.parse(jsonText);

    // Force fixed properties for both themes
    dualTheme.light.fontStyle = 'sans';
    dualTheme.light.provider = 'Google Gemini';
    dualTheme.dark.fontStyle = 'sans';
    dualTheme.dark.provider = 'Google Gemini';

    return res.status(200).json(dualTheme);

  } catch (error) {
    console.error("Error generating theme:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return res.status(500).json({ error: errorMessage });
  }
}
