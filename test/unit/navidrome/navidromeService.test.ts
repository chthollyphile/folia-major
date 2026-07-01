import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStableUrlSaltCache, navidromeApi, saveNavidromeConfig } from '@/services/navidromeService';
import type { NavidromeConfig } from '@/types/navidrome';

// test/unit/navidrome/navidromeService.test.ts
// Covers P0 Navidrome discovery and playback-report API wiring.

const config: NavidromeConfig = {
    serverUrl: 'https://navidrome.test',
    username: 'folio',
    passwordHash: 'secret',
};

const okResponse = (payload: unknown) => ({
    ok: true,
    json: async () => payload,
});

const subsonicOk = (payload: Record<string, unknown> = {}) => ({
    'subsonic-response': {
        status: 'ok',
        version: '1.16.1',
        type: 'navidrome',
        serverVersion: '0.58.0',
        openSubsonic: true,
        ...payload,
    },
});

const stubIncrementingCrypto = () => {
    let saltSeed = 0;
    vi.stubGlobal('crypto', {
        getRandomValues: (array: Uint8Array) => {
            saltSeed += 1;
            for (let index = 0; index < array.length; index += 1) {
                array[index] = (saltSeed >> ((index % 4) * 8)) & 0xff;
            }
            return array;
        },
    });
};

describe('navidromeService P0 endpoints', () => {
    beforeEach(() => {
        vi.stubGlobal('crypto', {
            getRandomValues: (array: Uint8Array) => {
                array.fill(1);
                return array;
            },
        });
    });

    afterEach(() => {
        clearStableUrlSaltCache();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sends scrobble boolean and time parameters', async () => {
        const fetchMock = vi.fn(async () => okResponse(subsonicOk())) as any;
        vi.stubGlobal('fetch', fetchMock);

        const success = await navidromeApi.scrobble(config, 'song-1', {
            submission: false,
            time: 123456,
        });

        expect(success).toBe(true);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe('/rest/scrobble');
        expect(url.searchParams.get('id')).toBe('song-1');
        expect(url.searchParams.get('submission')).toBe('false');
        expect(url.searchParams.get('time')).toBe('123456');
    });

    it('serializes array and boolean parameters for playlist updates', async () => {
        const fetchMock = vi.fn(async () => okResponse(subsonicOk())) as any;
        vi.stubGlobal('fetch', fetchMock);

        const success = await navidromeApi.updatePlaylist(config, 'playlist-1', {
            public: false,
            songIdsToAdd: ['a', 'b'],
            songIndexesToRemove: [0, 2],
        });

        expect(success).toBe(true);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe('/rest/updatePlaylist');
        expect(url.searchParams.get('public')).toBe('false');
        expect(url.searchParams.getAll('songIdToAdd')).toEqual(['a', 'b']);
        expect(url.searchParams.getAll('songIndexToRemove')).toEqual(['0', '2']);
    });

    it('keeps generated media URLs stable across repeated renders', () => {
        stubIncrementingCrypto();

        const stableConfig = { ...config, username: 'stable-media-url' };

        const firstCoverUrl = navidromeApi.getCoverArtUrl(stableConfig, 'cover-1', 600);
        const secondCoverUrl = navidromeApi.getCoverArtUrl(stableConfig, 'cover-1', 600);
        const otherCoverUrl = navidromeApi.getCoverArtUrl(stableConfig, 'cover-2', 600);
        const firstStreamUrl = navidromeApi.getStreamUrl(stableConfig, 'song-1');
        const secondStreamUrl = navidromeApi.getStreamUrl(stableConfig, 'song-1');

        expect(secondCoverUrl).toBe(firstCoverUrl);
        expect(secondStreamUrl).toBe(firstStreamUrl);
        expect(new URL(otherCoverUrl).searchParams.get('s')).not.toBe(new URL(firstCoverUrl).searchParams.get('s'));
    });

    it('clears stable media URL salts when config is saved', () => {
        stubIncrementingCrypto();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });

        const firstCoverUrl = navidromeApi.getCoverArtUrl(config, 'cover-1', 600);
        saveNavidromeConfig(config);
        const secondCoverUrl = navidromeApi.getCoverArtUrl(config, 'cover-1', 600);

        expect(new URL(secondCoverUrl).searchParams.get('s')).not.toBe(new URL(firstCoverUrl).searchParams.get('s'));
    });

    it('evicts old stable media URL salts after many unique media URLs', () => {
        stubIncrementingCrypto();
        const stableConfig = { ...config, username: 'bounded-media-url-cache' };

        const firstCoverUrl = navidromeApi.getCoverArtUrl(stableConfig, 'cover-0', 600);
        for (let index = 1; index <= 600; index += 1) {
            navidromeApi.getCoverArtUrl(stableConfig, `cover-${index}`, 600);
        }
        const refreshedCoverUrl = navidromeApi.getCoverArtUrl(stableConfig, 'cover-0', 600);

        expect(new URL(refreshedCoverUrl).searchParams.get('s')).not.toBe(new URL(firstCoverUrl).searchParams.get('s'));
    });

    it('builds a server profile even when extension discovery fails', async () => {
        const fetchMock = vi.fn(async (rawUrl: string) => {
            const url = new URL(rawUrl);
            const endpoint = url.pathname.replace('/rest/', '');

            if (endpoint === 'getOpenSubsonicExtensions') {
                return { ok: false, status: 404, json: async () => ({}) };
            }

            if (endpoint === 'getUser') {
                return okResponse(subsonicOk({ user: { username: 'folio', scrobblingEnabled: true } }));
            }

            if (endpoint === 'getMusicFolders') {
                return okResponse(subsonicOk({
                    musicFolders: {
                        musicFolder: [{ id: 'music', name: 'Music' }],
                    },
                }));
            }

            if (endpoint === 'getLicense') {
                return okResponse(subsonicOk({ license: { valid: true } }));
            }

            return okResponse(subsonicOk());
        }) as any;
        vi.stubGlobal('fetch', fetchMock);

        const profile = await navidromeApi.getServerProfile(config);

        expect(profile.serverVersion).toBe('0.58.0');
        expect(profile.user?.username).toBe('folio');
        expect(profile.musicFolders).toEqual([{ id: 'music', name: 'Music' }]);
        expect(profile.license?.valid).toBe(true);
        expect(profile.openSubsonicExtensions).toEqual([]);
        expect(profile.capabilities.supportsFormPost).toBe(false);
    });
});
