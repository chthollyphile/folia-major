export const config = {
    runtime: 'edge', // Use edge runtime for fetch support
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const { lyricsText, themeMode } = await req.json();

        if (!lyricsText) {
            return new Response(JSON.stringify({ error: 'Missing lyricsText' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

        if (!apiKey) {
            console.error("OpenAI API Key is missing in server environment.");
            return new Response(JSON.stringify({ error: 'Server configuration error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Limit text to avoid token limits if lyrics are huge
        const snippet = lyricsText.slice(0, 2000);

        const prompt = `Analyze the mood of these lyrics and generate a visual theme configuration (colors and animation style) for a music player.

THEME PREFERENCES:
1. Theme Mode: ${themeMode === 'light' ? 'LIGHT/DAYLIGHT' : 'DARK/MIDNIGHT'}
2. If mode is LIGHT: Use LIGHT backgrounds (whites, creams, soft pastels). Ensure text/icons are dark enough for contrast.
3. If mode is DARK: Use DARK backgrounds (deep colors).
4. If the lyrics strongly suggest a contrary mood (e.g. "dark night" in light mode), you MAY override, but generally stick to the requested mode.
5. If a LIGHT background is necessary for the mood:
    - Ensure 'accentColor' (used for geometric shapes/icons) are visible against the background. 
    - Avoid very faint colors on white backgrounds. The shapes should be discernable.
6. CRITICAL for 'secondaryColor': This color is used for secondary TEXT (e.g., album name, artist name).
    - It MUST have sufficient contrast against 'backgroundColor' to be easily readable.
    - Aim for a contrast ratio of at least 4.5:1 for accessibility.
    - On light backgrounds, use darker shades; on dark backgrounds, use lighter shades.

IMPORTANT for 'wordColors':
1. Identify 5-10 key emotional words or phrases from the lyrics.
2. Assign a specific color to each word that represents its emotion.
3. CRITICAL: The 'word' field MUST match the EXACT text in the lyrics snippet (case-insensitive) to be highlighted correctly. Do not change the word form or use synonyms.

IMPORTANT for 'lyricsIcons':
1. Identify 3-5 visual concepts/objects mentioned in or relevant to the lyrics (e.g. 'Heart', 'Cloud', 'Sun', 'Moon', 'Flame', 'Music', 'Star', 'Zap').
2. Return them as valid Lucide React icon names (PascalCase, e.g., 'CloudLightning', 'HeartHandshake').

Response MUST be a valid JSON object. Do not include markdown formatting like \`\`\`json. Just the raw JSON.

Lyrics snippet:
${snippet}

JSON Schema:
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "A creative name for this theme" },
    "backgroundColor": { "type": "string", "description": "Hex code for background" },
    "primaryColor": { "type": "string", "description": "Hex code for main text" },
    "accentColor": { "type": "string", "description": "Hex code for highlighted text/effects" },
    "secondaryColor": { "type": "string", "description": "Hex code for secondary elements" },
    "animationIntensity": { "type": "string", "enum": ["calm", "normal", "chaotic"] },
    "wordColors": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "word": { "type": "string" },
          "color": { "type": "string" }
        },
        "required": ["word", "color"]
      }
    },
    "lyricsIcons": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["name", "backgroundColor", "primaryColor", "accentColor", "secondaryColor", "animationIntensity"]
}`;

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o", // Default, you can override via URL potentially if using compatible API that ignores model.
                messages: [
                    { role: "system", content: "You are a helpful assistant that generates JSON themes for music players." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" } // Force JSON mode for OpenAI
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("OpenAI API Error:", response.status, errText);
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;

        if (!content) {
            throw new Error("Failed to generate theme JSON");
        }

        // Attempt to parse JSON. 
        // Sometimes OpenAI might still wrap in markdown despite response_format, though strict json mode shouldn't.
        // Standard compatible APIs might not support response_format strictly.
        let theme;
        let jsonStr = content.trim();

        // Remove markdown code blocks if present
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }

        try {
            theme = JSON.parse(jsonStr);
        } catch (e) {
            console.error("Failed to parse JSON from AI response:", jsonStr);
            throw new Error("Invalid JSON response from AI");
        }

        // Force fixed font style
        theme.fontStyle = 'sans';
        theme.provider = 'OpenAI Compatible';

        return new Response(JSON.stringify(theme), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error("Error generating theme:", error);
        const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
