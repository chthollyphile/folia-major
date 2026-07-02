import { sanitizeDualTheme } from "../src/services/themeSanitizer";

export const config = {
    runtime: 'edge', // Use edge runtime for fetch support
};

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const THEME_JSON_SCHEMA_NAME = 'dual_theme';

const THEME_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        light: {
            type: 'object',
            additionalProperties: false,
            description: 'Theme optimized for light/daylight mode',
            properties: {
                name: { type: 'string', description: 'A creative name for this light theme in Chinese, strictly limited to 10 characters or less' },
                description: { type: 'string', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
                backgroundColor: { type: 'string', description: 'Hex code for light background' },
                primaryColor: { type: 'string', description: 'Hex code for main text (dark)' },
                accentColor: { type: 'string', description: 'Hex code for highlighted text/effects' },
                secondaryColor: { type: 'string', description: 'Hex code for secondary elements' },
                wordColors: {
                    type: 'array',
                    description: 'List of exact emotional standalone words from the source text and their specific colors; Latin-script words must not contain punctuation or spaces',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            word: { type: 'string' },
                            color: { type: 'string' }
                        },
                        required: ['word', 'color']
                    }
                },
                lyricsIcons: {
                    type: 'array',
                    description: 'List of Lucide icon names related to the source text',
                    items: { type: 'string' }
                }
            },
            required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons']
        },
        dark: {
            type: 'object',
            additionalProperties: false,
            description: 'Theme optimized for dark/midnight mode',
            properties: {
                name: { type: 'string', description: 'A creative name for this dark theme in Chinese, strictly limited to 10 characters or less' },
                description: { type: 'string', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
                backgroundColor: { type: 'string', description: 'Hex code for dark background' },
                primaryColor: { type: 'string', description: 'Hex code for main text (light)' },
                accentColor: { type: 'string', description: 'Hex code for highlighted text/effects' },
                secondaryColor: { type: 'string', description: 'Hex code for secondary elements' },
                wordColors: {
                    type: 'array',
                    description: 'List of exact emotional standalone words from the source text and their specific colors; Latin-script words must not contain punctuation or spaces',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            word: { type: 'string' },
                            color: { type: 'string' }
                        },
                        required: ['word', 'color']
                    }
                },
                lyricsIcons: {
                    type: 'array',
                    description: 'List of Lucide icon names related to the source text',
                    items: { type: 'string' }
                }
            },
            required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons']
        }
    },
    required: ['light', 'dark']
} as const;

type OpenAICompatibleProvider = 'openai' | 'deepseek' | 'generic';

const normalizeOpenAIChatCompletionsUrl = (rawUrl?: string) => {
    const trimmedUrl = rawUrl?.trim();
    if (!trimmedUrl) {
        return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
    }

    try {
        const parsed = new URL(trimmedUrl);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');

        if (!normalizedPath || normalizedPath === '/') {
            parsed.pathname = '/v1/chat/completions';
            return parsed.toString();
        }

        if (/\/v\d+$/.test(normalizedPath)) {
            parsed.pathname = `${normalizedPath}/chat/completions`;
            return parsed.toString();
        }

        parsed.pathname = normalizedPath;
        return parsed.toString();
    } catch {
        return trimmedUrl.replace(/\/+$/, '');
    }
};

const resolveOpenAICompatibleModel = (apiUrl: string, configuredModel?: string) => {
    const trimmedModel = configuredModel?.trim();
    if (trimmedModel) {
        return trimmedModel;
    }

    try {
        const hostname = new URL(apiUrl).hostname.toLowerCase();
        if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
            return DEEPSEEK_DEFAULT_MODEL;
        }
    } catch {
        // Fall back to the generic OpenAI default when URL parsing fails.
    }

    return DEFAULT_OPENAI_MODEL;
};

const detectOpenAICompatibleProvider = (apiUrl: string, model: string): OpenAICompatibleProvider => {
    const normalizedModel = model.trim().toLowerCase();
    if (normalizedModel.startsWith('deepseek-')) {
        return 'deepseek';
    }

    try {
        const hostname = new URL(apiUrl).hostname.toLowerCase();
        if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
            return 'deepseek';
        }
        if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
            return 'openai';
        }
    } catch {
        // Fall through to generic provider handling.
    }

    if (/^(gpt|o[1-9]|o[1-9]-|chatgpt-)/.test(normalizedModel)) {
        return 'openai';
    }

    return 'generic';
};

const providerSupportsStructuredOutputs = (provider: OpenAICompatibleProvider) => provider === 'openai';

const extractProviderErrorMessage = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const error = (payload as { error?: unknown; }).error;
    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object') {
        const message = (error as { message?: unknown; }).message;
        if (typeof message === 'string') {
            return message;
        }
    }

    const message = (payload as { message?: unknown; }).message;
    return typeof message === 'string' ? message : null;
};

const formatOpenAICompatibleError = async (response: Response) => {
    const rawText = await response.text();
    let detail = rawText.trim();

    try {
        const parsed = JSON.parse(rawText);
        detail = extractProviderErrorMessage(parsed) || detail;
    } catch {
        // Leave non-JSON responses as-is.
    }

    return detail
        ? `OpenAI compatible API error (${response.status}): ${detail}`
        : `OpenAI compatible API error (${response.status}): ${response.statusText}`;
};

const buildThemeSystemPrompt = (includeSchemaText = false) => {
    const instructionPrompt = `Analyze the mood of the provided song source text and generate TWO visual theme configurations for a music player - one for LIGHT mode and one for DARK mode.

DUAL THEME REQUIREMENTS:
1. Generate TWO complete themes: one optimized for LIGHT/DAYLIGHT mode, one for DARK/MIDNIGHT mode.
2. Both themes should capture the SAME emotional essence of the source text, but with appropriate color palettes for their respective modes.
3. The theme names must be in Chinese and strictly limited to 10 characters or less. They should reflect both the mood AND the mode (e.g., "忧郁破晓" for light, "忧郁子夜" for dark).
4. The theme description must be a brief, emotional sentence in Chinese (strictly limited to 15 to 30 Chinese characters) reflecting a stream-of-consciousness style with youth and literary characteristics, capturing a listener's immediate emotional reaction to this song. Do not write formal analytical text. Must be written from a first-person listener perspective.
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
1. First, identify 10-20 key emotional standalone words from the source text that represent the core mood and atmosphere of the song.
2. Assign a specific, representative color to each of these key emotional standalone words under 'wordColors'.
3. Based on the emotional direction and colors of these identified words, construct the overall color palettes (backgroundColor, primaryColor, secondaryColor, accentColor) for the light and dark themes.
4. Coordinated Colors: The colors assigned in 'wordColors' must be designed in coordination and harmony with the overall color schemes of the themes.

LIGHT THEME RULES:
- Use LIGHT backgrounds. Avoid defaulting to pure white background for every light theme. Generate diverse and rich light-colored backgrounds (e.g., warm creams, soft pastel blues, pale sage greens, gentle peach, warm sands, pale lavenders) that directly match the song's mood.
- Ensure text/icons are dark enough for contrast, but avoid defaulting to pure black (#000000). Generate a very dark tone that coordinates with the background color's hue (e.g., deep navy, dark charcoal, dark plum).
- 'accentColor' must be visible against the light background.

DARK THEME RULES:
- Use DARK backgrounds. Avoid generic pure black backgrounds; use rich, diverse dark colors (e.g., deep midnight blue, dark forest green, charcoal gray, dark plum, deep chocolate, burgundy) matching the song's mood.
- Ensure text/icons are light enough for contrast, but avoid defaulting to pure white (#ffffff). Generate a very bright, soft tone that coordinates with the background color's hue (e.g., soft sky blue, pale mint green, light warm cream).
- 'accentColor' must contrast with the dark background and should be creatively derived from the song's specific mood (e.g., soft blues, mint greens, warm corals, lavender, pale gold) rather than defaulting to generic bright yellow.

SHARED RULES FOR BOTH THEMES:
1. CRITICAL for 'secondaryColor': This color is used for secondary TEXT (e.g., album name, artist name).
    - It MUST have sufficient contrast against 'backgroundColor' to be easily readable.
    - Aim for a contrast ratio of at least 4.5:1 for accessibility.
2. 'wordColors' and 'lyricsIcons' should be the SAME for both themes (they represent the source text's meaning).

IMPORTANT for 'wordColors':
1. Extract 10-20 emotional standalone words. For Latin-script text, each 'word' MUST be one complete word only, not a phrase.
2. CRITICAL: Do NOT include punctuation, apostrophes, curly quotes, hyphens, or spaces in Latin-script 'word' values. Use clean whole words like "train", "gone", "hidden", "cities"; do NOT return "train’s gone", "well-hidden", "set me free", or "shun the light".
3. Avoid function words such as articles, prepositions, pronouns, particles, and auxiliaries (for example: the, a, an, to, me, and, of, in, on).
4. For CJK lyrics, short meaningful semantic terms may contain multiple CJK characters, but do not select single particles unless they are emotionally meaningful.
5. The 'word' field MUST match text from the source snippet after removing surrounding punctuation. If the pure-instrumental title is very short, using the exact full title as a phrase is allowed.

IMPORTANT for 'lyricsIcons':
1. Identify 3-5 visual concepts/objects mentioned in or strongly implied by the source text.
2. Return them as valid Lucide React icon names (PascalCase, e.g., 'CloudLightning', 'HeartHandshake').`;

    const schemaPrompt = includeSchemaText ? `
Response MUST be a valid JSON object. Do not include markdown formatting like \`\`\`json. Just the raw JSON.

JSON Schema:
${JSON.stringify(THEME_JSON_SCHEMA, null, 2)}` : '';

    return `${instructionPrompt}${schemaPrompt}`;
};

const buildThemeSourcePrompt = (snippet: string, isPureMusic: boolean, songTitle?: string) => `Pure instrumental: ${isPureMusic ? 'yes' : 'no'}
${isPureMusic && songTitle ? `Song title: ${songTitle}\n` : ''}Source snippet:
${snippet}`;

const buildOpenAICompatibleRequestBody = (
    model: string,
    provider: OpenAICompatibleProvider,
    systemPrompt: string,
    sourcePrompt: string
) => {
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sourcePrompt }
    ];

    if (providerSupportsStructuredOutputs(provider)) {
        return {
            model,
            messages,
            temperature: 0.7,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: THEME_JSON_SCHEMA_NAME,
                    strict: true,
                    schema: THEME_JSON_SCHEMA
                }
            }
        };
    }

    return {
        model,
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' }
    };
};

const extractResponseContentText = (message: { content?: unknown; refusal?: unknown; } | undefined) => {
    if (!message) {
        return null;
    }

    if (typeof message.refusal === 'string' && message.refusal.trim()) {
        throw new Error(`Model refused request: ${message.refusal}`);
    }

    if (typeof message.content === 'string') {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        const text = message.content
            .filter((part): part is { type?: unknown; text?: unknown; } => !!part && typeof part === 'object')
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('');
        return text || null;
    }

    return null;
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const { lyricsText, isPureMusic = false, songTitle } = await req.json();

        if (!lyricsText) {
            return new Response(JSON.stringify({ error: 'Missing lyricsText' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        const apiUrl = normalizeOpenAIChatCompletionsUrl(process.env.OPENAI_API_URL);
        const model = resolveOpenAICompatibleModel(apiUrl, process.env.OPENAI_API_MODEL);
        const provider = detectOpenAICompatibleProvider(apiUrl, model);

        if (!apiKey) {
            console.error("OpenAI API Key is missing in server environment.");
            return new Response(JSON.stringify({ error: 'Server configuration error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Limit text to avoid token limits if lyrics are huge
        const snippet = lyricsText.slice(0, 2000);
        const systemPrompt = buildThemeSystemPrompt(true);
        const sourcePrompt = buildThemeSourcePrompt(snippet, isPureMusic, songTitle);

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(buildOpenAICompatibleRequestBody(model, provider, systemPrompt, sourcePrompt)),
        });

        if (!response.ok) {
            const errorMessage = await formatOpenAICompatibleError(response);
            console.error("OpenAI API Error:", errorMessage);
            throw new Error(errorMessage);
        }

        const data = await response.json();
        const content = extractResponseContentText(data.choices[0]?.message);

        if (!content) {
            throw new Error("Failed to generate theme JSON");
        }

        // Attempt to parse JSON
        let dualTheme;
        let jsonStr = content.trim();

        // Remove markdown code blocks if present
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }

        try {
            dualTheme = sanitizeDualTheme(JSON.parse(jsonStr));
        } catch (e) {
            console.error("Failed to parse JSON from AI response:", jsonStr);
            throw new Error("Invalid JSON response from AI");
        }

        // Force fixed properties for both themes
        dualTheme.light.fontStyle = 'sans';
        dualTheme.light.provider = 'OpenAI Compatible';
        dualTheme.dark.fontStyle = 'sans';
        dualTheme.dark.provider = 'OpenAI Compatible';

        return new Response(JSON.stringify(dualTheme), {
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
