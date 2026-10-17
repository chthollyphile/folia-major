import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/analysis/trackAudio.test.ts
// The one "where are this track's bytes" ladder every analyser reads through. Never an online
// track's download; a library server's http (Navidrome) is read, and checked to be audio.

const { getCachedSongAudioBlob } = vi.hoisted(() => ({ getCachedSongAudioBlob: vi.fn() }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ getCachedSongAudioBlob }));

const { readLocalTrackBytes, registerLocalTrackFileReader } = await import('@/services/analysis/trackAudio');

const online = { id: 'o', sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'o' } } as unknown as SongResult;
const local = { id: 'l', isLocal: true, localRef: { songId: 'l' }, sourceRef: { kind: 'local', songId: 'l' } } as unknown as SongResult;
const bytes = (n: number) => new ArrayBuffer(n);
const navidrome = { id: 'n', sourceRef: { kind: 'navidrome', songId: 'n' } } as unknown as SongResult;
const audioResponse = (size: number, type = 'audio/mpeg', ok = true) => {
    const blob = new Blob([new Uint8Array(size)], { type });
    return {
        ok,
        status: ok ? 200 : 401,
        headers: { get: (name: string) => (name === 'content-type' ? type : null) },
        blob: async () => blob,
        arrayBuffer: async () => blob.arrayBuffer(),
    };
};

describe('readLocalTrackBytes', () => {
    beforeEach(() => {
        getCachedSongAudioBlob.mockReset().mockResolvedValue(null);
        registerLocalTrackFileReader(null);
        vi.unstubAllGlobals();
    });

    it('reads the representation it is handed, and does not fall through when that fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
        getCachedSongAudioBlob.mockResolvedValue(new Blob([new Uint8Array(3)]));
        const found = await readLocalTrackBytes(online, {
            representation: { url: 'blob:rep' } as never,
        });
        expect(found).toEqual({ skipped: 'the playback representation could not be read' });
        expect(getCachedSongAudioBlob).not.toHaveBeenCalled();
    });

    it('answers null for an uncached online track, leaving any download to the caller', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        expect(await readLocalTrackBytes(online, { representation: null, audioUrl: 'https://cdn/x.mp3' })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reads a local track with no URL through the registered file reader', async () => {
        const reader = vi.fn(async () => bytes(5));
        registerLocalTrackFileReader(reader);
        const found = await readLocalTrackBytes(local, { representation: null });
        expect(found && 'bytes' in found ? found.bytes.byteLength : -1).toBe(5);
        expect(reader).toHaveBeenCalledWith(local);
    });

    it('never asks the registered file reader about an online track', async () => {
        const reader = vi.fn(async () => bytes(5));
        registerLocalTrackFileReader(reader);
        expect(await readLocalTrackBytes(online, { representation: null })).toBeNull();
        expect(reader).not.toHaveBeenCalled();
    });

    it('reads a library server URL only when it answers with audio', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => audioResponse(32 * 1024)));
        const found = await readLocalTrackBytes(navidrome, { representation: null, audioUrl: 'http://nas/rest/stream?id=n' });
        expect(found && 'bytes' in found ? found.bytes.byteLength : -1).toBe(32 * 1024);
    });

    it('skips, rather than handing back as audio, a library server error', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => audioResponse(4000, 'text/html', false)));
        expect(await readLocalTrackBytes(navidrome, { representation: null, audioUrl: 'http://nas/rest/stream?id=n' }))
            .toEqual({ skipped: 'the local file could not be read' });
    });

    it('skips a library server page that answers 200 with HTML', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => audioResponse(64 * 1024, 'text/html')));
        expect(await readLocalTrackBytes(navidrome, { representation: null, audioUrl: 'http://nas/rest/stream?id=n' }))
            .toEqual({ skipped: 'the library server did not answer with audio' });
    });

    it('reads a blob: URL as it is, whatever its size', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => audioResponse(10, '')));
        const found = await readLocalTrackBytes(local, { representation: null, audioUrl: 'blob:deck' });
        expect(found && 'bytes' in found ? found.bytes.byteLength : -1).toBe(10);
    });

    it('reads the media cache before any URL', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        getCachedSongAudioBlob.mockResolvedValue(new Blob([new Uint8Array(7)]));
        const found = await readLocalTrackBytes(online, { representation: null, audioUrl: 'blob:deck' });
        expect(found && 'bytes' in found ? found.bytes.byteLength : -1).toBe(7);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('asks the registered file reader about local tracks only', async () => {
        const reader = vi.fn(async () => bytes(5));
        registerLocalTrackFileReader(reader);
        expect(await readLocalTrackBytes(navidrome, { representation: null })).toBeNull();
        expect(reader).not.toHaveBeenCalled();
    });

    it('prefers a caller\'s own reader, whatever the source', async () => {
        const own = vi.fn(async () => bytes(3));
        const found = await readLocalTrackBytes(online, { representation: null, readLocalFile: own });
        expect(found && 'bytes' in found ? found.bytes.byteLength : -1).toBe(3);
    });
});
