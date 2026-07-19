import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKugouLyrics } from '@/utils/lyrics/providers/kugouLyricProvider';
import type { SongResult } from '@/types';

// test/unit/lyrics/kugouLyricProvider.test.ts

const getProxiedTarget = (requestUrl: string): URL => {
    const proxyUrl = new URL(requestUrl, 'http://localhost');
    return new URL(proxyUrl.searchParams.get('url') || requestUrl);
};

const encodeUtf8Base64 = (text: string): string => (
    btoa(String.fromCharCode(...new TextEncoder().encode(text)))
);

describe('Kugou lyric provider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the provider album audio id instead of the hash song identity', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                candidates: [{ id: 'lyric-id', accesskey: 'lyric-key' }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                content: encodeUtf8Base64('[00:01.00]测试歌词'),
                contenttype: 2,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        const song: SongResult = {
            id: '8C2F0C043E99779C8910C78E43DBC42A',
            name: '挪德卡莱 Nod-Krai',
            artists: [{ id: 1, name: 'HOYO-MiX' }, { id: 2, name: 'AURORA' }],
            album: { id: 164446399, name: '原神-幽暮衬映之月 Outside It Is Growing Dark' },
            durationMs: 239_000,
            kgHash: '8C2F0C043E99779C8910C78E43DBC42A',
            sourceRef: {
                kind: 'online',
                providerId: 'kugou',
                mediaId: '8C2F0C043E99779C8910C78E43DBC42A',
                providerData: { albumAudioId: 500617606 },
            },
        };

        await expect(fetchKugouLyrics(song)).resolves.not.toBeNull();

        const searchUrl = getProxiedTarget(String(fetchMock.mock.calls[0][0]));
        expect(searchUrl.searchParams.get('album_audio_id')).toBe('500617606');
        expect(searchUrl.searchParams.get('hash')).toBe(song.kgHash);
    });

    it('does not infer album_audio_id from a numeric song id', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const song: SongResult = {
            id: 500617606,
            name: 'Song',
            artists: [],
            album: { id: 0, name: '' },
            durationMs: 0,
            kgHash: 'HASH-IDENTITY',
            sourceRef: {
                kind: 'online', providerId: 'kugou', mediaId: 'HASH-IDENTITY', providerData: {},
            },
        };

        await expect(fetchKugouLyrics(song)).resolves.toBeNull();

        const searchUrl = getProxiedTarget(String(fetchMock.mock.calls[0][0]));
        expect(searchUrl.searchParams.has('album_audio_id')).toBe(false);
    });
});
