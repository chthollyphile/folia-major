import { describe, expect, it } from 'vitest';
import {
    MIN_CACHEABLE_AUDIO_BYTES,
    clearCachedSongAudioDistrust,
    distrustCachedSongAudio,
    isCacheableAudioResponse,
    isCachedSongAudioDistrusted,
} from '@/services/playbackRecovery/mediaCacheGuard';
import type { SongResult } from '@/types';

// test/unit/playback/mediaCacheGuard.test.ts
// 媒体缓存写入守卫：错误页、JSON 报错和截断的下载不能当成音频存起来。

const response = (status: number, contentType: string | null) => ({
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
});

const blob = (size: number, type = '') => ({ size, type });

const song = (providerId: string, mediaId: string): SongResult => ({
    id: mediaId,
    name: mediaId,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId },
}) as SongResult;

describe('isCacheableAudioResponse', () => {
    it('rejects a failed response', () => {
        expect(isCacheableAudioResponse(response(403, 'audio/mpeg'), blob(MIN_CACHEABLE_AUDIO_BYTES))).toBe(false);
    });

    it.each(['text/html; charset=utf-8', 'application/json', 'application/xml', 'application/xhtml+xml', 'text/plain'])(
        'rejects a %s body served with 200',
        contentType => {
            expect(isCacheableAudioResponse(response(200, contentType), blob(MIN_CACHEABLE_AUDIO_BYTES * 4))).toBe(false);
        },
    );

    it('rejects a body smaller than 16 KiB', () => {
        expect(MIN_CACHEABLE_AUDIO_BYTES).toBe(16 * 1024);
        expect(isCacheableAudioResponse(response(200, 'audio/mpeg'), blob(MIN_CACHEABLE_AUDIO_BYTES - 1))).toBe(false);
    });

    it.each(['audio/mpeg', 'audio/flac', 'binary/octet-stream', 'application/octet-stream'])('accepts %s of at least 16 KiB', contentType => {
        expect(isCacheableAudioResponse(response(200, contentType), blob(MIN_CACHEABLE_AUDIO_BYTES))).toBe(true);
    });

    it('falls back to the blob type when the header is missing', () => {
        expect(isCacheableAudioResponse({ ok: true }, blob(MIN_CACHEABLE_AUDIO_BYTES, 'text/html'))).toBe(false);
        expect(isCacheableAudioResponse(response(200, null), blob(MIN_CACHEABLE_AUDIO_BYTES, 'audio/mpeg'))).toBe(true);
        expect(isCacheableAudioResponse({ ok: true }, blob(MIN_CACHEABLE_AUDIO_BYTES))).toBe(true);
    });
});

describe('cached audio distrust', () => {
    it('is scoped to one song key and can be cleared', () => {
        const kugou = song('kugou', '1');
        const netease = song('netease', '1');

        expect(isCachedSongAudioDistrusted(kugou)).toBe(false);
        distrustCachedSongAudio(kugou);

        expect(isCachedSongAudioDistrusted(kugou)).toBe(true);
        expect(isCachedSongAudioDistrusted({ ...kugou, name: 'same song, another object' })).toBe(true);
        expect(isCachedSongAudioDistrusted(netease)).toBe(false);

        clearCachedSongAudioDistrust(kugou);
        expect(isCachedSongAudioDistrusted(kugou)).toBe(false);
    });
});
