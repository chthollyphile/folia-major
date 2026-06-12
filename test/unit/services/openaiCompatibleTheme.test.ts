import { describe, expect, it, vi } from 'vitest';
import {
    generateOpenAICompatibleTheme,
    normalizeOpenAIChatCompletionsUrl,
} from '@/services/openaiCompatibleTheme';

describe('openaiCompatibleTheme', () => {
    it('normalizes base and version URLs to chat completions endpoints', () => {
        expect(normalizeOpenAIChatCompletionsUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions');
        expect(normalizeOpenAIChatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    });

    it('parses an OpenAI-compatible JSON response into a normalized dual theme', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({
                        light: {
                            name: 'Morning',
                            backgroundColor: '#f8fafc',
                            primaryColor: '#111827',
                            accentColor: '#2563eb',
                            secondaryColor: '#334155',
                            wordColors: [{ word: 'moonlight', color: '#2563eb' }],
                            lyricsIcons: ['Moon'],
                        },
                        dark: {
                            name: 'Midnight',
                            backgroundColor: '#020617',
                            primaryColor: '#e5e7eb',
                            accentColor: '#60a5fa',
                            secondaryColor: '#cbd5e1',
                            wordColors: [{ word: 'moonlight', color: '#2563eb' }],
                            lyricsIcons: ['Moon'],
                        },
                    }),
                },
            }],
        }), { status: 200 })) as unknown as typeof fetch;

        const theme = await generateOpenAICompatibleTheme({
            apiKey: 'test-key',
            apiUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o',
            lyricsText: 'moonlight',
            fetcher,
        });

        expect(fetcher).toHaveBeenCalledOnce();
        expect(theme.light.provider).toBe('OpenAI Compatible');
        expect(theme.dark.provider).toBe('OpenAI Compatible');
        expect(theme.light.fontStyle).toBe('sans');
        expect(theme.dark.fontStyle).toBe('sans');
    });
});
