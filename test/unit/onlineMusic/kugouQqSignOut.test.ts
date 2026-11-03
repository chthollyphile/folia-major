import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kugouProvider } from '@/services/onlineMusic/kugou/kugouProvider';
import { qqProvider } from '@/services/onlineMusic/qq/qqProvider';

// test/unit/onlineMusic/kugouQqSignOut.test.ts
// What the KuGou and QQ adapters keep of a sign-in in the page's storage, and when it goes at a
// sign-out (`auth.logout`, which is also their `signInRanOut`): before the first wait, whatever
// becomes of the request. The page's storage is a map of texts; the platform is `fetch`, answered
// by the test. Both adapters run as on the web: there is no desktop side here.

const QQ_SESSION = 'online_provider:qq:cookie';
const page = new Map<string, string>();
const fetchMock = vi.fn();
// A request the test answers when it chooses to.
const held = () => {
    let answer!: (response: Response) => void;
    const promise = new Promise<Response>(resolve => { answer = resolve; });
    return { promise, answer };
};
const asked = () => new URL(String(fetchMock.mock.calls[0][0]));
const sent = () => vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { interval: 1 });
// The four values KuGou's sign-in leaves in the page.
const kugouSignedIn = (name: string) => {
    page.set('online_provider:kugou:cookie', `KuGoo=${name}`);
    page.set('online_provider:kugou:token', `${name}-token`);
    page.set('online_provider:kugou:userid', `${name}-id`);
    page.set('online_provider:kugou:dfid', `${name}-device`);
};

beforeEach(() => {
    page.clear();
    fetchMock.mockReset();
    vi.stubEnv('VITE_KUGOU_API_BASE', 'http://kugou.test');
    vi.stubEnv('VITE_QQ_API_BASE', 'http://qq.test');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => page.get(key) ?? null,
        setItem: (key: string, value: string) => { page.set(key, value); },
        removeItem: (key: string) => { page.delete(key); },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('a KuGou sign-out', () => {
    it('tells KuGou with the session, which has left the page before the first wait, though the request never ends', () => {
        kugouSignedIn('old');
        fetchMock.mockReturnValue(new Promise(() => {}));

        void kugouProvider.auth!.logout();

        expect(page.size).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(asked().pathname).toBe('/logout');
        expect(asked().searchParams.get('cookie')).toBe('KuGoo=old;dfid=old-device;token=old-token;userid=old-id');
    });

    it('leaves the session of a sign-in made since alone when the answer comes after it', async () => {
        kugouSignedIn('old');
        const request = held();
        fetchMock.mockReturnValue(request.promise);

        const signedOut = kugouProvider.auth!.logout();
        kugouSignedIn('new');
        request.answer(Response.json({ status: 1 }));
        await signedOut;

        expect(Object.fromEntries(page)).toEqual({
            'online_provider:kugou:cookie': 'KuGoo=new',
            'online_provider:kugou:token': 'new-token',
            'online_provider:kugou:userid': 'new-id',
            'online_provider:kugou:dfid': 'new-device',
        });
    });

    it('writes nothing of what the sign-out is answered with back into the page', async () => {
        kugouSignedIn('old');
        fetchMock.mockResolvedValue(Response.json({ status: 1, cookie: 'KuGoo=old', data: { token: 'old-token', userid: 'old-id' } }));

        await kugouProvider.auth!.logout();

        expect(page.size).toBe(0);
    });
});

describe('a QQ sign-out', () => {
    it('tells the backend with the session, which has left the page before the first wait, though the request never ends', async () => {
        page.set(QQ_SESSION, 'qqmusic_session=old');
        fetchMock.mockReturnValue(new Promise(() => {}));

        void qqProvider.auth!.logout();

        expect(page.size).toBe(0);
        await sent();
        expect(asked().pathname).toBe('/logout');
        expect(asked().searchParams.get('cookie')).toBe('qqmusic_session=old');
    });

    // 401: the backend no longer knew the session it was told to end.
    it.each([200, 401])('leaves the session of a sign-in made since alone when the answer (%s) comes after it', async status => {
        page.set(QQ_SESSION, 'qqmusic_session=old');
        const request = held();
        fetchMock.mockReturnValue(request.promise);

        const signedOut = qqProvider.auth!.logout();
        await sent();
        page.set(QQ_SESSION, 'qqmusic_session=new');
        request.answer(Response.json({ code: status }, { status }));
        await signedOut;

        expect(page.get(QQ_SESSION)).toBe('qqmusic_session=new');
    });
});
