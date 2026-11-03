import { sendOpenAICompatibleRequest } from '../shared/openAICompatibleRequest.mjs';
import { budgetFor } from '../shared/ai/aiTasks.mjs';
import { runAttempts } from '../shared/ai/attemptRunner.mjs';
import { MAX_ERROR_BODY_CHARS, buildCompatibleBody, exhaustedByReasoning, withErrorHint } from '../shared/ai/compatibleBody.mjs';
import { getAiAdapter, resolveAiConnection } from '../shared/ai/providerRegistry.mjs';
import { sanitizeDualTheme } from '../shared/themeSanitizer.mjs';

type WorkerEnv = {
    OPENAI_API_KEY?: string;
    OPENAI_API_URL?: string;
    OPENAI_API_MODEL?: string;
    OPENAI_API_TEMPERATURE?: string;
};

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;
const THEME_JSON_SCHEMA_NAME = 'dual_theme';
// What the theme answer itself needs. Attempts that leave the model thinking get room for that on
// top (shared/ai/aiTasks.mjs), so this is the same 8192 the desktop asks with.
const THEME_MAX_OUTPUT_TOKENS = 8192;

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
            required: ['name', 'description', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons']
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
            required: ['name', 'description', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons']
        }
    },
    required: ['light', 'dark']
} as const;

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

const formatOpenAICompatibleErrorText = (response: Response, rawText: string) => {
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

/**
 * The theme JSON text, walking the provider adapter's theme attempts through the shared runner:
 * the provider comes from the address's host (the registry the desktop uses; this route speaks
 * only the OpenAI-compatible protocol, so anything else is the custom adapter), and an attempt
 * whose reasoning switch is rejected by name, or whose reasoning ate the budget, gives way to the
 * next. Any other failure is thrown as the provider's own error line.
 */
const requestThemeContent = async (
    { apiUrl, apiKey, model, adapterId, temperature, systemPrompt, sourcePrompt }:
    { apiUrl: string; apiKey: string; model: string; adapterId: string; temperature: number; systemPrompt: string; sourcePrompt: string; },
) => {
    const adapter = getAiAdapter(adapterId)!;
    return runAttempts({
        adapter,
        task: 'theme',
        url: apiUrl,
        model,
        attempts: adapter.attempts('theme', model),
        log: (line: string) => console.log(line),
        describeEmpty: (result) => (result.exhausted
            ? `Model "${model}" used its entire output budget on reasoning and returned no theme.`
            : 'Failed to generate theme JSON'),
        send: async (attempt) => {
            const response = await sendOpenAICompatibleRequest({
                apiUrl,
                provider: adapter.id,
                rejectsFormat: adapter.rejectedParameter,
                body: buildCompatibleBody(adapter, {
                    task: 'theme',
                    model,
                    attempt,
                    systemPrompt,
                    sourcePrompt,
                    schema: THEME_JSON_SCHEMA,
                    schemaName: THEME_JSON_SCHEMA_NAME,
                    budget: budgetFor('theme', THEME_MAX_OUTPUT_TOKENS, attempt),
                    temperature,
                }),
                init: {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                    },
                    signal: AbortSignal.timeout(120_000),
                },
            });

            if (!response.ok) {
                // errorText is for people; errorBody keeps error.param and error.code for the runner.
                const rawText = await response.text();
                const errorText = formatOpenAICompatibleErrorText(response, rawText);
                // A warning, not an error: the runner may still move on to the next attempt. A final
                // failure is logged by the handler ("Error generating theme").
                console.warn(`[ai] theme ${attempt.label} failed: ${errorText}`);
                return withErrorHint(adapter, {
                    ok: false,
                    status: response.status,
                    errorText,
                    errorBody: rawText.slice(0, MAX_ERROR_BODY_CHARS),
                });
            }

            const data = await response.json() as {
                choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: unknown; reasoning_content?: unknown; }; }>;
                usage?: unknown;
            };
            const choice = data.choices?.[0];
            return {
                ok: true,
                status: response.status,
                content: extractResponseContentText(choice?.message),
                exhausted: exhaustedByReasoning(choice, data.usage, adapter),
            };
        },
    });
};

export async function handleGenerateOpenAITheme(request: Request, env: WorkerEnv) {
    if (request.method !== 'POST') {
        return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    try {
        const { lyricsText, isPureMusic = false, songTitle } = await request.json() as {
            lyricsText?: string;
            isPureMusic?: boolean;
            songTitle?: string;
        };

        if (!lyricsText) {
            return Response.json({ error: 'Missing lyricsText' }, { status: 400 });
        }

        const apiKey = env.OPENAI_API_KEY;
        // The provider comes from the address's host, the same registry the desktop uses; this
        // route speaks only the OpenAI-compatible protocol, so anything else is the custom adapter.
        const connection = resolveAiConnection({
            AI_PROVIDER: 'openai',
            OPENAI_API_URL: env.OPENAI_API_URL,
            OPENAI_API_MODEL: env.OPENAI_API_MODEL,
        }, { protocols: ['openai'] });
        const apiUrl = normalizeOpenAIChatCompletionsUrl(env.OPENAI_API_URL);
        const model = connection.model;
        const configuredTemperature = Number.parseFloat(env.OPENAI_API_TEMPERATURE?.trim() || '');
        const temperature = Number.isFinite(configuredTemperature) && configuredTemperature >= 0 && configuredTemperature <= 2
            ? configuredTemperature
            : DEFAULT_OPENAI_TEMPERATURE;

        if (!apiKey) {
            console.error('OpenAI API Key is missing in server environment.');
            return Response.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Limit text to avoid token limits if lyrics are huge
        const snippet = lyricsText.slice(0, 2000);
        const systemPrompt = buildThemeSystemPrompt(true);
        const sourcePrompt = buildThemeSourcePrompt(snippet, isPureMusic, songTitle);

        const content = await requestThemeContent({
            apiUrl, apiKey, model, adapterId: connection.adapterId, temperature, systemPrompt, sourcePrompt,
        });

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
            console.error('Failed to parse JSON from AI response:', jsonStr);
            throw new Error('Invalid JSON response from AI');
        }

        // Force fixed properties for both themes
        dualTheme.light.fontStyle = 'sans';
        dualTheme.light.provider = 'OpenAI Compatible';
        dualTheme.dark.fontStyle = 'sans';
        dualTheme.dark.provider = 'OpenAI Compatible';

        return Response.json(dualTheme);
    } catch (error) {
        console.error('Error generating theme:', error);
        const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
        return Response.json({ error: errorMessage }, { status: 500 });
    }
}
