import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqSessionRefresh.test.ts
// 网页版接 Serverless 后端时的续期：真的 provider 与 transport，只有 fetch 和 localStorage 是替身。

const storage = new Map<string, string>();
const HOUR = 60 * 60 * 1000;

type Backend = {
    sessionMode?: 'sealed' | 'stored';
    refresh?: (token: string) => Response | Promise<Response>;
    accountId?: () => string;
    read?: (path: string) => Response | Promise<Response> | undefined;
};

// 照路径回答的后端：/login/channels 宣告会话存法，/login/status 认得会话，/login/refresh 按用例回答。
const serve = ({ sessionMode = 'sealed', refresh, accountId = () => '10001', read }: Backend) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url, 'https://folia.example.test').pathname;
        if (path === '/api/qq/login/channels') {
            return Response.json({ code: 200, data: { channels: ['qq', 'wechat'], sessionMode, configured: true } });
        }
        if (path === '/api/qq/login/status') {
            return Response.json({ code: 200, data: { profile: { uin: accountId(), nick: 'fixture user' } } });
        }
        if (path === '/api/qq/login/refresh' && refresh) {
            return refresh(String((init?.headers as Record<string, string>)?.['X-QQ-Session'] ?? ''));
        }
        if (path === '/api/qq/logout') return Response.json({ code: 200 });
        const answer = read?.(path);
        if (answer) return answer;
        return Response.json({ code: 404 }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

const refreshCalls = (fetchMock: ReturnType<typeof serve>) => fetchMock.mock.calls.filter(([url]) => String(url).includes('/login/refresh'));

const load = async () => {
    const { qqProvider } = await import('@/services/onlineMusic/qq/qqProvider');
    const { readProviderSessionValue, writeProviderSessionValue } = await import('@/services/onlineMusic/providerStorage');
    const { refreshQqSession } = await import('@/services/onlineMusic/qq/qqSessionRefresh');
    writeProviderSessionValue('qq', 'cookie', 'qqmusic_session=old-token');
    return {
        signedIn: () => qqProvider.auth!.getLoginStatus(),
        logout: () => qqProvider.auth!.logout(),
        checkLogin: () => qqProvider.auth!.checkLogin!('fixture-login'),
        session: () => readProviderSessionValue('qq', 'cookie'),
        refreshQqSession,
    };
};

beforeEach(() => {
    vi.resetModules();
    storage.clear();
    vi.stubEnv('VITE_QQ_API_BASE', '/api/qq');
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.spyOn(console, 'info').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('QQ session refresh on a serverless backend', () => {
    it('keeps in-flight Explore previews and their replay ticket across a real same-account token rotation', async () => {
        let releaseRadar!: (response: Response) => void;
        let guessReads = 0;
        const song = (mid: string) => ({ mid, id: mid === 'daily' ? 2 : 1, name: mid, singer: [], album: { mid: 'album', name: 'Album' } });
        serve({
            refresh: () => Response.json({ code: 200, data: { token: 'new-token', rotated: true } }),
            read: path => {
                if (path === '/api/qq/recommend/radar') return new Promise(resolve => { releaseRadar = resolve; });
                if (path === '/api/qq/user/guess-you-like') return Response.json({ code: 200, songs: [song(`guess-${++guessReads}`)] });
                if (path === '/api/qq/user/daily-songs') return Response.json({ code: 200, songs: [song('daily')] });
            },
        });
        const qq = await load();
        const { createQqExplore } = await import('@/services/onlineMusic/qq/qqExplore');
        const { qqRecommendations } = await import('@/services/onlineMusic/qq/qqRecommendations');
        const reading = createQqExplore().getFeed();
        await vi.waitFor(() => { expect(releaseRadar).toBeDefined(); expect(guessReads).toBe(1); });

        await qq.refreshQqSession();
        expect(qq.session()).toBe('qqmusic_session=new-token');
        releaseRadar(Response.json({ code: 200, songs: [], more: false }));
        const page = await reading;
        const cards = page.sections[0].items.flatMap(item => item.kind === 'collection' ? [item.collection] : []);
        expect(cards[0].songPreview?.firstSong?.qqMid).toBe('guess-1');
        expect(cards[1].songPreview?.firstSong?.qqMid).toBe('daily');
        const start = { station: cards[0].personalFm!.station, previewToken: cards[0].songPreview!.playbackToken };
        expect((await qqRecommendations.getPersonalFm!(start)).map(entry => entry.qqMid)).toEqual(['guess-1']);
        expect(guessReads).toBe(1);
        expect((await qqRecommendations.getPersonalFm!({ station: start.station })).map(entry => entry.qqMid)).toEqual(['guess-2']);
        expect((await qqRecommendations.getPersonalFm!(start)).map(entry => entry.qqMid)).toEqual(['guess-1']);
        expect(guessReads).toBe(2);
    });

    it.each(['logout', 'account switch', 'new login'] as const)('invalidates an old preview ticket through the real %s path', async action => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        let account = '10001';
        let guessReads = 0;
        serve({
            accountId: () => account,
            refresh: () => Response.json({ code: 200, data: { rotated: false } }),
            read: path => {
                if (path === '/api/qq/login/qr/check') return Response.json({ code: 803, cookie: 'qqmusic_session=relogin-token' });
                if (path === '/api/qq/user/guess-you-like') {
                    guessReads += 1;
                    return Response.json({ code: 200, songs: [{ mid: 'old-preview', id: 1, name: 'Old', singer: [], album: { mid: 'album' } }] });
                }
            },
        });
        const qq = await load();
        await qq.signedIn();
        const { getQqGuessYouLikeCard } = await import('@/services/onlineMusic/qq/qqGuessYouLike');
        const { qqRecommendations } = await import('@/services/onlineMusic/qq/qqRecommendations');
        const card = (await getQqGuessYouLikeCard())!;
        if (action === 'logout') await qq.logout();
        else if (action === 'new login') await qq.checkLogin();
        else { account = '20002'; await qq.signedIn(); }

        expect(await qqRecommendations.getPersonalFm!({ station: card.personalFm!.station, previewToken: card.songPreview!.playbackToken })).toEqual([]);
        expect(guessReads).toBe(1);
    });

    it('keeps the new token when the backend hands one out, sending the old one as a POST in the header', async () => {
        const fetchMock = serve({ refresh: () => Response.json({ code: 200, data: { token: 'new-token', rotated: true, expiresAt: 1 } }) });
        const qq = await load();

        await qq.signedIn();

        await vi.waitFor(() => expect(qq.session()).toBe('qqmusic_session=new-token'));
        const [[, init]] = refreshCalls(fetchMock);
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>)['X-QQ-Session']).toBe('old-token');
    });

    it('does nothing when the backend keeps the token', async () => {
        const fetchMock = serve({ refresh: () => Response.json({ code: 200, data: { token: 'old-token', rotated: false, expiresAt: 1 } }) });
        const qq = await load();

        await qq.signedIn();

        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));
        expect(qq.session()).toBe('qqmusic_session=old-token');
    });

    it('asks a backend that keeps its sessions itself (desktop, Docker) once an hour too, keeping the token', async () => {
        // stored 后端只在离到期不到 6 小时、又有请求进来时续：Folia 开着就每小时给它一个请求。
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const fetchMock = serve({ sessionMode: 'stored', refresh: () => Response.json({ code: 200, data: { token: 'old-token', rotated: false } }) });
        const qq = await load();

        await qq.signedIn();
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(HOUR);
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(2));
        expect(qq.session()).toBe('qqmusic_session=old-token');
    });

    it('does not put a token back over a session that changed while it was asked', async () => {
        let answer: (response: Response) => void = () => { };
        const fetchMock = serve({ refresh: () => new Promise<Response>(resolve => { answer = resolve; }) });
        const qq = await load();
        const { writeProviderSessionValue } = await import('@/services/onlineMusic/providerStorage');
        const { noteQqBackendDeclaration } = await import('@/services/onlineMusic/qq/qqBackendDeclaration');
        noteQqBackendDeclaration({ sessionMode: 'sealed' });

        const asked = qq.refreshQqSession();
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));
        writeProviderSessionValue('qq', 'cookie', 'qqmusic_session=another-account');
        answer(Response.json({ code: 200, data: { token: 'new-token', rotated: true } }));
        await asked;

        expect(qq.session()).toBe('qqmusic_session=another-account');
    });

    it('asks once an hour while signed in, not again on every read, and stops on logout', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const fetchMock = serve({ refresh: () => Response.json({ code: 200, data: { token: 'old-token', rotated: false } }) });
        const qq = await load();

        await qq.signedIn();
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));
        // 回到窗口又读一次账号：一小时内不再问。读账号之后续期是在后台接着走的（探测 → keepQqSessionFresh → 请求），
        // 等它走完再数。
        await qq.signedIn();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(refreshCalls(fetchMock)).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(HOUR);
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(2));

        await qq.logout();
        // 退出时就停掉定时器，不等下一次到点时自己发现会话没了。
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(3 * HOUR);
        expect(refreshCalls(fetchMock)).toHaveLength(2);
    });

    it('asks and starts the timer while the session mode is not known yet', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const fetchMock = serve({ refresh: () => Response.json({ code: 200, data: { token: 'old-token', rotated: false } }) });
        await load();
        const { keepQqSessionFresh } = await import('@/services/onlineMusic/qq/qqSessionRefresh');

        // 通道探测失败了，会话存法还不知道：存法不影响要不要问，照样问、照样起定时器。
        keepQqSessionFresh();
        expect(vi.getTimerCount()).toBe(1);
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));

        await vi.advanceTimersByTimeAsync(HOUR);
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(2));
    });

    it('stops asking an older backend without the route', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const fetchMock = serve({});
        const qq = await load();

        await qq.signedIn();
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(3 * HOUR);

        expect(refreshCalls(fetchMock)).toHaveLength(1);
        expect(qq.session()).toBe('qqmusic_session=old-token');
    });

    it('keeps the old token after a failed refresh and tries again an hour later', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const fetchMock = serve({ refresh: () => Response.json({ code: 502, errorKey: 'network.unknown' }, { status: 502 }) });
        const qq = await load();

        await qq.signedIn();
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(1));
        expect(qq.session()).toBe('qqmusic_session=old-token');

        await vi.advanceTimersByTimeAsync(HOUR);
        await vi.waitFor(() => expect(refreshCalls(fetchMock)).toHaveLength(2));
    });
});
