import {
    generateOpenAICompatibleTheme,
    normalizeOpenAIChatCompletionsUrl,
    resolveOpenAICompatibleModel,
} from '../src/services/openaiCompatibleTheme';

export const config = {
    runtime: 'edge',
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

        if (!apiKey) {
            console.error('OpenAI API Key is missing in server environment.');
            return new Response(JSON.stringify({ error: 'Server configuration error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const dualTheme = await generateOpenAICompatibleTheme({
            apiKey,
            apiUrl,
            model,
            lyricsText,
            isPureMusic,
            songTitle,
        });

        return new Response(JSON.stringify(dualTheme), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error generating theme:', error);
        const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
