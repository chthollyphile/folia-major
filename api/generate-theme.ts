import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { lyricsText } = req.body;

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
      model: "gemini-2.5-flash",
      contents: `Analyze the mood of these lyrics and generate a visual theme configuration (colors and animation style) for a music player.
      
      THEME PREFERENCES:
      1. Prefer DARK backgrounds (deep colors) for a cinematic feel, but if the lyrics are light and bright, use a light background.
      2. If a LIGHT background is necessary for the mood:
         - Ensure 'secondaryColor' and 'accentColor' (used for geometric shapes/icons) are visible against the background. 
         - Avoid very faint colors on white backgrounds. The shapes should be discernable.
  
      IMPORTANT for 'wordColors':
      1. Identify 5-10 key emotional words or phrases from the lyrics.
      2. Assign a specific color to each word that represents its emotion.
      3. CRITICAL: The 'word' field MUST match the EXACT text in the lyrics snippet (case-insensitive) to be highlighted correctly. Do not change the word form or use synonyms.
      
      IMPORTANT for 'lyricsIcons':
      1. Identify 3-5 visual concepts/objects mentioned in or relevant to the lyrics (e.g. 'Heart', 'Cloud', 'Sun', 'Moon', 'Flame', 'Music', 'Star', 'Zap').
      2. Return them as valid Lucide React icon names (PascalCase, e.g., 'CloudLightning', 'HeartHandshake').
      
      Lyrics snippet:
      ${snippet}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "A creative name for this theme" },
            backgroundColor: { type: Type.STRING, description: "Hex code for background" },
            primaryColor: { type: Type.STRING, description: "Hex code for main text" },
            accentColor: { type: Type.STRING, description: "Hex code for highlighted text/effects" },
            secondaryColor: { type: Type.STRING, description: "Hex code for secondary elements" },
            animationIntensity: { type: Type.STRING, enum: ["calm", "normal", "chaotic"] },
            wordColors: {
              type: Type.ARRAY,
              description: "List of exact emotional words from lyrics and their specific colors",
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
              description: "List of Lucide icon names related to lyrics",
              items: { type: Type.STRING }
            },
          },
          required: ["name", "backgroundColor", "primaryColor", "accentColor", "secondaryColor", "animationIntensity"],
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error("Failed to generate theme JSON");
    }

    const theme = JSON.parse(jsonText);

    // Force fixed font style
    theme.fontStyle = 'sans';

    return res.status(200).json(theme);

  } catch (error) {
    console.error("Error generating theme:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return res.status(500).json({ error: errorMessage });
  }
}
