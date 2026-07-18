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
        vi.stubEnv('VITE_NETEASE_API_BASE', 'http://127.0.0.1:3000');
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => {
                if (key === 'netease_anonymous_cookie') return 'mock-anon-cookie';
                return null;
            }),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllEnvs();
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

    describe('fetchWithCreds anonymous cookie behavior', () => {
        let storageMap: Record<string, string>;

        beforeEach(() => {
            storageMap = {};
            vi.stubGlobal('localStorage', {
                getItem: vi.fn((key: string) => storageMap[key] || null),
                setItem: vi.fn((key: string, val: string) => { storageMap[key] = val; }),
                removeItem: vi.fn((key: string) => { delete storageMap[key]; }),
            });
        });

        it('uses stored logged-in cookie and does not fetch anonymous cookie', async () => {
            storageMap['netease_cookie'] = 'real-login-cookie';
            const fetchMock = vi.mocked(fetch);
            fetchMock.mockResolvedValueOnce(mockJsonResponse({ code: 200 }) as any);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getSongUrl(12345);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).toContain('cookie=real-login-cookie');
            expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('register/anonimous');
            expect(storageMap['netease_anonymous_cookie']).toBeUndefined();
        });

        it('fetches anonymous cookie when unlogged-in and not cached', async () => {
            const fetchMock = vi.mocked(fetch);
            // First mock resolve: /register/anonimous
            fetchMock.mockResolvedValueOnce(mockJsonResponse({ code: 200, cookie: 'anon-cookie-value' }) as any);
            // Second mock resolve: the actual api request
            fetchMock.mockResolvedValueOnce(mockJsonResponse({ code: 200 }) as any);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getSongUrl(12345);

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/register/anonimous');
            expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cookie=anon-cookie-value');
            expect(storageMap['online_provider:netease:anonymous_cookie']).toBe('anon-cookie-value');
        });

        it('uses cached anonymous cookie when unlogged-in', async () => {
            storageMap['netease_anonymous_cookie'] = 'cached-anon-cookie';
            const fetchMock = vi.mocked(fetch);
            fetchMock.mockResolvedValueOnce(mockJsonResponse({ code: 200 }) as any);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getSongUrl(12345);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).toContain('cookie=cached-anon-cookie');
            expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('register/anonimous');
        });

        it('does not fetch anonymous cookie for login/status/logout endpoints', async () => {
            const fetchMock = vi.mocked(fetch);
            fetchMock.mockResolvedValueOnce(mockJsonResponse({ code: 200 }) as any);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getLoginStatus();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('cookie=');
            expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('register/anonimous');
        });

        it('clears anonymous cookie cache on auth expiration (301, 401, 403)', async () => {
            storageMap['netease_anonymous_cookie'] = 'expired-anon-cookie';
            const fetchMock = vi.mocked(fetch);
            fetchMock.mockResolvedValueOnce(mockJsonResponse({ code: 301 }) as any);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getSongUrl(12345);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(storageMap['netease_anonymous_cookie']).toBeUndefined();
        });
    });
});
