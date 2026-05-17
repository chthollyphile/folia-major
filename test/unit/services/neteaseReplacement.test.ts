import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Covers unavailable-song replacement resolution and legacy Web API fallback behavior.

const mockJsonResponse = (payload: unknown) => ({
    json: vi.fn().mockResolvedValue(payload),
});

const createUnavailableSong = (overrides: Record<string, unknown> = {}) => ({
    id: 27946878,
    name: 'Unavailable Song',
    artists: [],
    album: { id: 1, name: 'Album' },
    duration: 1000,
    privilege: { st: -200 },
    noCopyrightRcmd: null,
    ...overrides,
});

const createPlayableSongPayload = (id: number, name = 'Replacement Song') => ({
    id,
    name,
    ar: [{ id: 1, name: 'Artist' }],
    al: { id: 2, name: 'Album', picUrl: 'http://example.com/cover.jpg' },
    dt: 1234,
});

describe('netease unavailable song replacement', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
        });
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the legacy replacement song id without calling the new endpoint', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            songs: [createPlayableSongPayload(411500779, 'Legacy Replacement')],
            privileges: [{ id: 411500779, st: 0, pl: 320000, dl: 320000 }],
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: 411500779, typeDesc: '其它版本可播' },
        }) as any);

        expect(replacement?.replacementSongId).toBe(411500779);
        expect(replacement?.replacementSong.name).toBe('Legacy Replacement');
        expect(replacement?.typeDesc).toBe('其它版本可播');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/song/detail?ids=411500779');
    });

    it('falls back to the new copyright recommendation endpoint when songId is missing', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            code: 200,
            data: {
                originSong: {
                    noCopyrightRcmd: {
                        typeDesc: '其它版本可播',
                    },
                },
                rcmd: createPlayableSongPayload(1859082445, 'Fallback Replacement'),
                sp: { id: 1859082445, st: 0, pl: 320000, dl: 999000 },
            },
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: null, typeDesc: '其它版本可播' },
        }) as any);

        expect(replacement?.replacementSongId).toBe(1859082445);
        expect(replacement?.replacementSong.name).toBe('Fallback Replacement');
        expect(replacement?.replacementSong.privilege?.st).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/song/copyright/rcmd?songid=27946878');
    });

    it('uses the new endpoint when the legacy detail result is still unavailable', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(mockJsonResponse({
                songs: [createPlayableSongPayload(411500779, 'Unavailable Legacy Replacement')],
                privileges: [{ id: 411500779, st: -200 }],
            }) as any)
            .mockResolvedValueOnce(mockJsonResponse({
                code: 200,
                data: {
                    originSong: {
                        noCopyrightRcmd: {
                            typeDesc: '其它版本可播',
                        },
                    },
                    rcmd: createPlayableSongPayload(1859082445, 'Fallback Replacement'),
                    sp: { id: 1859082445, st: 0, pl: 320000, dl: 999000 },
                },
            }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: 411500779, typeDesc: '其它版本可播' },
        }) as any);

        expect(replacement?.replacementSongId).toBe(1859082445);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/song/copyright/rcmd?songid=27946878');
    });

    it('returns null when the new endpoint has no playable replacement', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            code: 200,
            data: {
                originSong: {
                    noCopyrightRcmd: {
                        typeDesc: '其它版本可播',
                    },
                },
                rcmd: createPlayableSongPayload(1859082445, 'Unavailable Replacement'),
                sp: { id: 1859082445, st: -200 },
            },
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: null, typeDesc: '其它版本可播' },
        }) as any);

        expect(replacement).toBeNull();
    });

    it('disables the new endpoint for the rest of the session after a legacy web API failure', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            code: 404,
        }) as any);

        const { neteaseApi } = await import('@/services/netease');
        const song = createUnavailableSong({
            noCopyrightRcmd: { songId: null, typeDesc: '其它版本可播' },
        }) as any;

        const firstAttempt = await neteaseApi.getUnavailableSongReplacement(song);
        const secondAttempt = await neteaseApi.getUnavailableSongReplacement(song);

        expect(firstAttempt).toBeNull();
        expect(secondAttempt).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('prefers the unavailable type description for list tags when present', async () => {
        const { getSongUnavailableTagText } = await import('@/services/netease');

        expect(getSongUnavailableTagText(createUnavailableSong({
            noCopyrightRcmd: { typeDesc: '其它版本可播' },
        }) as any, '已下架')).toBe('其它版本可播');

        expect(getSongUnavailableTagText(createUnavailableSong() as any, '已下架')).toBe('已下架');
    });
});
