// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import vercelLyricProxy from '../../../api-ts/lyric-proxy';
import builtLyricProxy from '../../../api/lyric-proxy.js';
import { handleLyricProxy } from '../../../worker/lyric-proxy';

// test/unit/services/lyricProxyRelays.test.ts
// The web relays /api/lyric-proxy forwarding a JSON POST to QQ's musicu, as the QQ adapter sends a song lookup
// (`requestQqMusicu`) and as QQ lyrics and the anonymous search send theirs: Vercel's source in api-ts/, the
// file built from it in api/ (Vercel and the Docker backend run it), and Cloudflare's in worker/. Recorded with
// a fake fetch; no request leaves the test. The dev server's relay (vite.config.ts) and the desktop's CORS
// allowance (electron/main.cjs) are not here: they are checked by hand.

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const SENT = {
    comm: { ct: 24, cv: 0 },
    q0: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_type: 0, song_id: 97773 } },
};
// What musicu answers: JSON, sent as text/plain.
const ANSWER = JSON.stringify({ code: 0, q0: { code: 0, data: { track_info: { id: 97773, mid: '0039MnYb0qxYhV', name: '晴天' } } } });
const ANSWER_TYPE = 'text/plain; charset=utf-8';

type Recorded = { url: string; init: RequestInit };

/** A fake fetch that records each request and answers as musicu would. */
const recordMusicu = (status = 200, headers: Record<string, string> = {}) => {
    const requests: Recorded[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(ANSWER, { status, headers: { 'content-type': ANSWER_TYPE, ...headers } });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { requests, fetchMock };
};

/** A Vercel response object that records what the handler set and sent. */
const recordingResponse = () => {
    const recorded: { headers: Record<string, string>; status?: number; sent?: unknown; json?: unknown; ended: boolean } = { headers: {}, ended: false };
    const res = {
        setHeader: (key: string, value: string) => { recorded.headers[key.toLowerCase()] = value; },
        status: (code: number) => { recorded.status = code; return res; },
        send: (value: unknown) => { recorded.sent = value; return res; },
        json: (value: unknown) => { recorded.json = value; return res; },
        end: () => { recorded.ended = true; return res; },
    };
    return { res, recorded };
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe.each([
    ['api-ts/lyric-proxy.ts', vercelLyricProxy],
    ['api/lyric-proxy.js', builtLyricProxy],
])('the Vercel relay (%s)', (_file, handler: (req: any, res: any) => Promise<unknown>) => {
    it('forwards a musicu POST with its JSON body, without the page\'s cookies, and hands back QQ\'s bytes and type', async () => {
        const { requests } = recordMusicu();
        const { res, recorded } = recordingResponse();

        await handler({
            method: 'POST',
            query: { url: MUSICU },
            headers: { 'content-type': 'application/json', cookie: 'a=b' },
            body: SENT,
        }, res);

        expect(requests).toHaveLength(1);
        const [{ url, init }] = requests;
        expect(url).toBe(MUSICU);
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual(SENT);
        const headers = init.headers as Record<string, string>;
        expect(headers.Cookie).toBe('tmeLoginType=-1;');
        expect(headers).not.toHaveProperty('cookie');
        expect(recorded.status).toBe(200);
        expect(Buffer.from(recorded.sent as Uint8Array).toString('utf8')).toBe(ANSWER);
        expect(recorded.headers['content-type']).toBe(ANSWER_TYPE);
    });

    it('refuses a target that is not a QQ or KuGou host, without fetching it', async () => {
        const { fetchMock } = recordMusicu();
        const { res, recorded } = recordingResponse();

        await handler({ method: 'POST', query: { url: 'https://example.com/' }, headers: {}, body: SENT }, res);

        expect(recorded.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('the Cloudflare relay (worker/lyric-proxy.ts)', () => {
    const relayed = (target: string) => new Request(`https://folia.example/api/lyric-proxy?url=${encodeURIComponent(target)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SENT),
    });

    // requestQqMusicu reads the wait of a refused request from Retry-After, which only this relay hands on.
    it.each([200, 429])('forwards a musicu POST with its body and hands back QQ\'s %s as it came, Retry-After included', async (status) => {
        const { requests } = recordMusicu(status, { 'Retry-After': '25' });

        const response = await handleLyricProxy(relayed(MUSICU));

        expect(requests).toHaveLength(1);
        const [{ url, init }] = requests;
        expect(url).toBe(MUSICU);
        expect(init.method).toBe('POST');
        expect(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer))).toEqual(SENT);
        expect(response.status).toBe(status);
        await expect(response.text()).resolves.toBe(ANSWER);
        expect(response.headers.get('content-type')).toBe(ANSWER_TYPE);
        expect(response.headers.get('retry-after')).toBe('25');
    });

    it('refuses a target that is not a QQ or KuGou host, without fetching it', async () => {
        const { fetchMock } = recordMusicu();

        const response = await handleLyricProxy(relayed('https://example.com/'));

        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
