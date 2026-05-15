import { describe, expect, it } from 'vitest';
import {
    buildStageClearRequest,
    buildStageHealthRequest,
    buildStageLineRequest,
    buildStagePlayRequest,
    buildStageSearchRequest,
    buildStageSessionRequest,
    buildStageStatusRequest,
    shouldUseStageMultipart,
    validateStageLineRequestInput,
    validateStagePlayRequestInput,
    validateStageSearchRequestInput,
    validateStageSessionRequestInput,
} from '@/utils/stageClientDemo';

// Stage demo helper tests keep the manual API console aligned with the
// current local-only Stage HTTP contract.

describe('stageClientDemo helpers', () => {
    it('builds a public health request without auth', () => {
        const result = buildStageHealthRequest('http://127.0.0.1:32107/');

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/health');
        expect(result.init.method).toBe('GET');
    });

    it('builds an authenticated status request', () => {
        const result = buildStageStatusRequest('http://127.0.0.1:32107/', 'demo-token');

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/status');
        expect(result.init.headers).toEqual({
            Authorization: 'Bearer demo-token',
        });
    });

    it('builds a line request with translation and words', () => {
        const result = buildStageLineRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            fullText: 'Hello world',
            translation: '你好，世界',
            words: [
                { text: 'Hello', startTime: 0, endTime: 0.5 },
                { text: 'world', startTime: 0.5, endTime: 1.1 },
            ],
        });

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/line');
        expect(JSON.parse(String(result.init.body))).toEqual({
            fullText: 'Hello world',
            translation: '你好，世界',
            words: [
                { text: 'Hello', startTime: 0, endTime: 0.5 },
                { text: 'world', startTime: 0.5, endTime: 1.1 },
            ],
        });
    });

    it('rejects empty line payloads before sending', () => {
        const error = validateStageLineRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
        });

        expect(error).toBe('Provide fullText or at least one word.');
    });

    it('builds a JSON session request when no files are provided', () => {
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
        expect(JSON.parse(String(result.init.body))).toEqual({
            title: 'Example',
            artist: 'Artist',
            audioUrl: 'https://example.com/demo.mp3',
            lyricsText: '[00:00.00]Hello',
            lyricsFormat: 'lrc',
        });
    });

    it('builds a multipart session request when any file is provided', () => {
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
        const uploadedAudio = formData.get('audioFile');
        expect(uploadedAudio).toBeInstanceOf(File);
        expect((uploadedAudio as File).name).toBe('demo.wav');
    });

    it('rejects mixed audio url and file payloads before sending', () => {
        const error = validateStageSessionRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            audioUrl: 'https://example.com/demo.mp3',
            audioFile: new File(['audio'], 'demo.wav', { type: 'audio/wav' }),
        });

        expect(error).toBe('Choose either an audio URL or an audio file, not both.');
    });

    it('builds a clear-state request', () => {
        const result = buildStageClearRequest('http://127.0.0.1:32107', 'demo-token');

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/state');
        expect(result.init.method).toBe('DELETE');
    });

    it('builds a search request with query and limit', () => {
        const result = buildStageSearchRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            query: 'Mili',
            limit: 5,
        });

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/search');
        expect(JSON.parse(String(result.init.body))).toEqual({
            query: 'Mili',
            limit: 5,
        });
    });

    it('rejects empty search requests before sending', () => {
        const error = validateStageSearchRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            query: '   ',
        });

        expect(error).toBe('Search query is required.');
    });

    it('builds a play request with songId', () => {
        const result = buildStagePlayRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            songId: 123456,
        });

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/play');
        expect(JSON.parse(String(result.init.body))).toEqual({
            songId: 123456,
        });
    });

    it('rejects invalid song ids before sending', () => {
        const error = validateStagePlayRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            songId: 0,
        });

        expect(error).toBe('songId must be a positive integer.');
    });
});
