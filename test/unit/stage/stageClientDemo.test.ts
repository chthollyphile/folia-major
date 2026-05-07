import { describe, expect, it } from 'vitest';
import {
    buildStageSessionRequest,
    shouldUseStageMultipart,
    validateStageSessionRequestInput,
} from '@/utils/stageClientDemo';

// Stage demo client request tests keep the manual page and payload rules in sync.

describe('stageClientDemo helpers', () => {
    it('builds a JSON request when no files are provided', () => {
        const result = buildStageSessionRequest({
            baseUrl: 'http://127.0.0.1:32107/',
            token: 'demo-token',
            title: 'Example',
            artist: 'Artist',
            audioUrl: 'https://example.com/demo.mp3',
            lyricsText: '[00:00.00]Hello',
            lyricsFormat: 'lrc',
        });

        expect(result.transport).toBe('json');
        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/session');
        expect(result.init.method).toBe('POST');
        expect(result.init.headers).toMatchObject({
            Authorization: 'Bearer demo-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(String(result.init.body))).toEqual({
            title: 'Example',
            artist: 'Artist',
            audioUrl: 'https://example.com/demo.mp3',
            lyricsText: '[00:00.00]Hello',
            lyricsFormat: 'lrc',
        });
    });

    it('builds a multipart request when any file is provided', () => {
        const audioFile = new File(['audio'], 'demo.wav', { type: 'audio/wav' });
        const result = buildStageSessionRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            title: 'Example',
            lyricsFormat: 'enhanced-lrc',
            audioFile,
        });

        expect(shouldUseStageMultipart({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            lyricsFormat: 'enhanced-lrc',
            audioFile,
        })).toBe(true);
        expect(result.transport).toBe('multipart');
        expect(result.init.headers).toEqual({
            Authorization: 'Bearer demo-token',
        });

        const formData = result.init.body as FormData;
        expect(formData.get('title')).toBe('Example');
        expect(formData.get('lyricsFormat')).toBe('enhanced-lrc');
        expect(formData.get('lyricsText')).toBeNull();
        const uploadedAudio = formData.get('audioFile');
        expect(uploadedAudio).toBeInstanceOf(File);
        expect((uploadedAudio as File).name).toBe('demo.wav');
    });

    it('rejects mixed URL and file payloads before sending', () => {
        const error = validateStageSessionRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            audioUrl: 'https://example.com/demo.mp3',
            audioFile: new File(['audio'], 'demo.wav', { type: 'audio/wav' }),
            lyricsText: '[00:00.00]Hello',
            lyricsFormat: 'lrc',
        });

        expect(error).toBe('Choose either an audio URL or an audio file, not both.');
    });

    it('allows audio urls without lyrics for lyric-less playback', () => {
        const error = validateStageSessionRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            audioUrl: 'https://example.com/demo.mp3',
            lyricsFormat: 'lrc',
        });

        expect(error).toBeNull();
    });

    it('omits lyricsFormat when the demo keeps auto-detect selected', () => {
        const result = buildStageSessionRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            audioFile: new File(['audio'], 'demo.wav', { type: 'audio/wav' }),
            lyricsFormat: '',
        });

        const formData = result.init.body as FormData;
        expect(formData.get('lyricsFormat')).toBeNull();
    });
});
