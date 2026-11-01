import { describe, expect, it } from 'vitest';
import {
    buildStageClearRequest,
    buildStageHealthRequest,
    buildStageLyricsRequest,
    buildStagePlayRequest,
    buildStagePlayerControlRequest,
    buildStagePlayerQueueGetRequest,
    buildStagePlayerQueueRequest,
    buildStagePlayerStatusRequest,
    buildStagePlayerTimeRequest,
    buildStagePlayerWebSocketUrl,
    buildStageSearchRequest,
    buildStageSessionRequest,
    buildStageStatusRequest,
    isValidStageSongRef,
    shouldUseStageMultipart,
    validateStageLyricsRequestInput,
    validateStagePlayRequestInput,
    validateStagePlayerControlRequestInput,
    validateStagePlayerQueueRequestInput,
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

    it('builds a lyrics request with a parser-compatible lyric source', () => {
        const result = buildStageLyricsRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            title: 'Stage Lyrics',
            artist: 'Folia',
            lyricSourceJson: JSON.stringify({
                type: 'local',
                lrcContent: '[00:00.00]Hello world',
                tLrcContent: '[00:00.00]你好，世界',
                formatHint: 'lrc',
            }),
        });

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/lyrics');
        expect(JSON.parse(String(result.init.body))).toEqual({
            title: 'Stage Lyrics',
            artist: 'Folia',
            lyricSource: {
                type: 'local',
                lrcContent: '[00:00.00]Hello world',
                tLrcContent: '[00:00.00]你好，世界',
                formatHint: 'lrc',
            },
        });
    });

    it('rejects empty lyrics payloads before sending', () => {
        const error = validateStageLyricsRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            lyricSourceJson: '   ',
        });

        expect(error).toBe('Lyric source JSON is required.');
    });

    it('rejects invalid lyric source json before sending', () => {
        const error = validateStageLyricsRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            lyricSourceJson: '{bad json',
        });

        expect(error).toBe('Lyric source JSON must be valid JSON.');
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

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/player/search');
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

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/player/play');
        expect(JSON.parse(String(result.init.body))).toEqual({
            songId: 123456,
        });
    });

    it('builds a queue-append play request when requested', () => {
        const result = buildStagePlayRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            songId: 123456,
            appendToQueue: true,
        });

        expect(JSON.parse(String(result.init.body))).toEqual({
            songId: 123456,
            appendToQueue: true,
        });
    });

    it('rejects invalid song ids before sending', () => {
        const error = validateStagePlayRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            songId: 0,
        });

        expect(error).toBe('songId must be a positive integer or a <provider>:<songId> reference.');
    });

    it('reads song references the way the Stage API does', () => {
        for (const songRef of [123456, '123456', 'qq:97773', 'netease:42', 'kugou:abc123', 'folium.mod.source:x']) {
            expect(isValidStageSongRef(songRef)).toBe(true);
        }
        for (const songRef of [0, -1, 1.5, '', 'qq:', ':1', 'a b:1', null, undefined]) {
            expect(isValidStageSongRef(songRef)).toBe(false);
        }
    });

    it('sends a search provider only when one is given', () => {
        const base = { baseUrl: 'http://127.0.0.1:32107', token: 'demo-token', query: 'x' };
        expect(JSON.parse(String(buildStageSearchRequest({ ...base, provider: ' qq ' }).init.body))).toEqual({ query: 'x', provider: 'qq' });
        expect(JSON.parse(String(buildStageSearchRequest({ ...base, provider: '' }).init.body))).toEqual({ query: 'x' });
        expect(validateStageSearchRequestInput({ ...base, provider: 'QQ Music!' })).toBe('provider must be an omni provider id.');
    });

    it('builds player status and time requests', () => {
        const status = buildStagePlayerStatusRequest('http://127.0.0.1:32107/', 'demo-token');
        const time = buildStagePlayerTimeRequest('http://127.0.0.1:32107/', 'demo-token');

        expect(status.endpoint).toBe('http://127.0.0.1:32107/stage/player/status');
        expect(time.endpoint).toBe('http://127.0.0.1:32107/stage/player/time');
        expect(status.init.headers).toEqual({ Authorization: 'Bearer demo-token' });
    });

    it('builds player control requests', () => {
        const result = buildStagePlayerControlRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            action: 'seek',
            positionMs: 30000,
        });

        expect(result.endpoint).toBe('http://127.0.0.1:32107/stage/player/control');
        expect(JSON.parse(String(result.init.body))).toEqual({
            action: 'seek',
            positionMs: 30000,
        });
        expect(validateStagePlayerControlRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            action: 'seek',
        })).toBe('Seek requires a non-negative positionMs.');
    });

    it('builds player queue get and edit requests', () => {
        const getResult = buildStagePlayerQueueGetRequest('http://127.0.0.1:32107', 'demo-token', {
            offset: 20,
            limit: 50,
            around: 'current',
        });
        const editResult = buildStagePlayerQueueRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            action: 'move',
            fromQueueItemId: 'netease:1:0',
            toIndex: 1,
        });
        const selectResult = buildStagePlayerQueueRequest({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            action: 'select',
            index: 2,
        });

        expect(getResult.endpoint).toBe('http://127.0.0.1:32107/stage/player/queue?offset=20&limit=50&around=current');
        expect(getResult.init.method).toBe('GET');
        expect(JSON.parse(String(editResult.init.body))).toEqual({
            action: 'move',
            fromQueueItemId: 'netease:1:0',
            toIndex: 1,
        });
        expect(JSON.parse(String(selectResult.init.body))).toEqual({
            action: 'select',
            index: 2,
        });
        expect(validateStagePlayerQueueRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            action: 'remove',
        })).toBe('Queue remove requires queueItemId or index.');
        expect(validateStagePlayerQueueRequestInput({
            baseUrl: 'http://127.0.0.1:32107',
            token: 'demo-token',
            action: 'select',
        })).toBe('Queue select requires queueItemId or index.');
    });

    it('builds a tokenized player websocket URL', () => {
        expect(buildStagePlayerWebSocketUrl('http://127.0.0.1:32107/', 'demo-token')).toBe(
            'ws://127.0.0.1:32107/stage/player/ws?token=demo-token'
        );
    });
});
