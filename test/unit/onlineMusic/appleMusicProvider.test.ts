import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { appleMusicProvider } from '@/services/onlineMusic/appleMusicProvider';
import { normalizeAppleSong, applePage } from '@/services/onlineMusic/appleMusic/normalize';
import { omni } from '@/services/onlineMusic/omni';

// test/unit/onlineMusic/appleMusicProvider.test.ts

const resource = { id: '42', type: 'songs', attributes: { name: 'Song', artistName: 'Artist', albumName: 'Album', durationInMillis: 120000,
    artwork: { url: 'https://example.org/{w}x{h}.jpg' }, previews: [{ url: 'https://example.org/preview.m4a' }] } };
const request = vi.fn();
beforeEach(() => { vi.stubGlobal('window', { electron: { appleMusicRequest: request, appleMusicAvailable: true } }); request.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('Apple Music through Omni', () => {
    it('preserves library identity and never maps previews to audio sources', async () => {
        const song = normalizeAppleSong({ ...resource, id: 'i.library', attributes: { ...resource.attributes, playParams: { catalogId: '42' } } });
        expect(song.sourceRef).toMatchObject({ providerId: 'applemusic', mediaId: 'i.library', providerData: { catalogId: '42' } });
        expect(song.album.coverUrl).toBe('https://example.org/600x600.jpg');
        expect(omni.usesRemotePlayback(song)).toBe(true);
        await expect(omni.getAudioSource(song, 'lossless')).rejects.toMatchObject({ code: 'unsupported' });
    });
    it('uses the authenticated storefront and encodes search terms', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { data: [{ id: 'jp' }] } })
            .mockResolvedValueOnce({ ok: true, data: { results: { songs: { data: [resource], next: '/v1/catalog/jp/search?offset=25' } } } });
        const page = await omni.searchProviderSongs('applemusic', 'A & B', { limit: 30, offset: 0 });
        expect(request.mock.calls[1][1].path).toBe('/v1/catalog/jp/search?term=A+%26+B&types=songs&limit=25&offset=0');
        expect(page).toMatchObject({ nextOffset: 25, hasMore: true, items: [{ sourceRef: { providerId: 'applemusic', mediaId: '42' } }] });
    });
    it('does not invent a logged-in account from a public catalog response', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { data: [{ id: 'us' }] } })
            .mockResolvedValueOnce({ ok: false, error: 'auth-required' });
        await expect(omni.getLoginStatus('applemusic')).rejects.toMatchObject({ code: 'auth-required' });
    });
    it('routes library playback and seek through the isolated host', async () => {
        request.mockResolvedValue({ ok: true, data: true });
        const song = normalizeAppleSong({ ...resource, id: 'i.library' });
        await omni.startRemotePlayback(song);
        await omni.remotePlaybackCommand(song, 'seek', 32);
        expect(request.mock.calls).toEqual([
            ['start', { id: 'i.library', bitrate: 256, continueIfCurrent: false }], ['command', { command: 'seek', value: 32 }],
        ]);
    });
    it('resolves a library song to the catalog before requesting lyrics', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { data: [{ id: 'us' }] } })
            .mockResolvedValueOnce({ ok: true, data: { data: [resource] } })
            .mockResolvedValue({ ok: true, data: { data: [] } });
        await omni.getLyrics(normalizeAppleSong({ ...resource, id: 'i.library' }));
        expect(request.mock.calls.map(call => call[1]?.path)).toEqual([
            '/v1/me/storefront', '/v1/me/library/songs/i.library/catalog',
            '/v1/catalog/us/songs/42/syllable-lyrics', '/v1/catalog/us/songs/42/lyrics',
        ]);
    });
    it('keeps pagination progressing and rejects malformed resources', () => {
        expect(applePage({ data: [resource], next: '/page?offset=0' }, 20, normalizeAppleSong).nextOffset).toBe(21);
        expect(() => normalizeAppleSong({ id: '42' })).toThrow();
    });
});

describe('standalone MusicKit routing', () => {
    it('does not advertise a connection when the desktop release has no application credentials', () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: request, appleMusicAvailable: false } });
        expect(appleMusicProvider.getAvailability!().configured).toBe(false);
    });
    it('passes Apple word timing through Omni and falls back only when the syllable resource is absent', async () => {
        const ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div><p begin="1.000" end="3.000" itunes:key="L1"><span begin="1.000" end="2.000">Test </span><span begin="2.000" end="3.000">line</span></p></div></body></tt>';
        const music = vi.fn(async (_action: string, input: { path: string }) => ({ ok: true, data:
            input.path === '/v1/me/storefront' ? { data: [{ id: 'us' }] }
                : input.path.endsWith('/syllable-lyrics') ? { data: [] }
                    : { data: [{ attributes: { ttml } }] },
        }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: music, appleMusicAvailable: true } });
        const result = await omni.getLyrics(normalizeAppleSong(resource));
        expect(result.lyrics?.lines[0]).toMatchObject({ startTime: 1, endTime: 3 });
        expect(result.lyrics?.lines[0]?.words).toHaveLength(2);
        expect(result.wordByWordText).toBe(ttml);
        music.mockResolvedValue({ ok: false, error: 'lyrics-network-error' } as any);
        await expect(omni.getLyrics(normalizeAppleSong(resource))).rejects.toMatchObject({ code: 'network' });
    });
    it('uses the isolated host for catalog data and playback through MusicKit', async () => {
        const music = vi.fn(async (action: string) => ({ ok: true, data: action === 'api' ? { data: [{ id: 'us' }] } : true }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: music, appleMusicAvailable: true } });
        await appleMusicProvider.auth!.configureConnection!();
        await appleMusicProvider.playback!.remote!.start('42');
        await appleMusicProvider.playback!.remote!.command('seek', 33);
        expect(music.mock.calls.map(call => call[0])).toEqual(['connect', 'start', 'command']);
    });
    it('routes bitrate preferences and queued successors through Omni', async () => {
        request.mockResolvedValue({ ok: true, data: true });
        const song = normalizeAppleSong(resource);
        const next = normalizeAppleSong({ ...resource, id: '43' });
        await omni.startRemotePlayback(song, { quality: 'standard' });
        await omni.startRemotePlayback(song, { quality: 'lossless', continueIfCurrent: true });
        await omni.queueRemotePlaybackNext(song, next);
        expect(request.mock.calls).toEqual([
            ['start', { id: '42', bitrate: 64, continueIfCurrent: false }],
            ['start', { id: '42', bitrate: 256, continueIfCurrent: true }],
            ['queueNext', { id: '43' }],
        ]);
    });
    it('surfaces credential and DRM errors from the MusicKit host', async () => {
        const music = vi.fn().mockResolvedValue({ ok: false, error: 'developer-token-expired' });
        vi.stubGlobal('window', { electron: { appleMusicRequest: music, appleMusicAvailable: true } });
        await expect(appleMusicProvider.auth!.configureConnection!()).rejects.toMatchObject({ code: 'auth-required', message: 'developer-token-expired' });
        music.mockResolvedValue({ ok: false, error: 'widevine-unavailable' });
        await expect(appleMusicProvider.playback!.remote!.start('42')).rejects.toMatchObject({ code: 'unavailable' });
    });
});
