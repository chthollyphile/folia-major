import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmAudio.test.ts — the buffer one download fills while several readers are
// answered from it, and the scheme handler in front of it.

const require = createRequire(import.meta.url);
const { TrackBuffer, createByteLru } = require('../../../electron/ytm/trackBuffer.cjs');
const { createYtmAudio } = require('../../../electron/ytm/audio.cjs');
const { ytmError } = require('../../../electron/ytm/errors.cjs');

const VIDEO = 'm9SMT5ipbxk';
const bytes = (length: number, offset = 0) => Uint8Array.from({ length }, (_, index) => (index + offset) % 251);
const readAll = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

// A download the test feeds by hand, standing in for YouTube's stream.
const manualDownload = () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: value => { controller = value; } });
    // Like the real stream, aborting ends it with an error.
    const abort = vi.fn(() => controller.error(new Error('Download aborted.')));
    return { stream, abort, push: (chunk: Uint8Array) => controller.enqueue(chunk), end: () => controller.close(), fail: (error: Error) => controller.error(error) };
};
const instantPlan = (data: Uint8Array, mimeType = 'audio/webm') => ({
    mimeType, contentLength: data.length,
    open: vi.fn(async () => ({
        stream: new ReadableStream<Uint8Array>({ start: controller => { controller.enqueue(data); controller.close(); } }),
        abort: vi.fn(),
    })),
});
// A download that delivers the first `sent` bytes of the file and then breaks.
const brokenPlan = (data: Uint8Array, sent = 40) => ({
    mimeType: 'audio/webm', contentLength: data.length,
    open: vi.fn(async () => {
        let pulls = 0;
        return {
            stream: new ReadableStream<Uint8Array>({ pull: controller => {
                if (pulls++ === 0) controller.enqueue(data.subarray(0, sent)); else controller.error(new Error('stream broke'));
            } }),
            abort: vi.fn(),
        };
    }),
});
const get = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
// A plan as the bridge names it: made as the account of the sign-in, or by the guest's route.
const asAccount = <T extends object>(plan: T) => ({ ...plan, route: 'member' });
const asGuest = <T extends object>(plan: T) => ({ ...plan, route: 'web' });

describe('YouTube Music track buffer', () => {
    it('answers a reader that started before the bytes arrived, in order', async () => {
        const data = bytes(1000);
        const track = new TrackBuffer(data.length, 'audio/webm');
        const whole = readAll(track.read(0, 999));
        const tail = readAll(track.read(900, 999));
        track.push(data.subarray(0, 400));
        await Promise.resolve();
        track.push(data.subarray(400));
        expect(await whole).toEqual(data);
        expect(await tail).toEqual(data.subarray(900));
    });

    it('serves what was downloaded and then fails the reader when the download fails', async () => {
        const data = bytes(100);
        const track = new TrackBuffer(200, 'audio/webm');
        track.push(data);
        const reader = track.read(0, 199).getReader();
        expect((await reader.read()).value).toEqual(data);
        track.fail(new Error('connection lost'));
        await expect(reader.read()).rejects.toThrow('connection lost');
    });

    it('refuses more bytes than the declared length', () => {
        const track = new TrackBuffer(4, 'audio/webm');
        expect(() => track.push(bytes(5))).toThrow('longer than its declared length');
    });

    it('stops a cancelled reader without disturbing the others', async () => {
        const data = bytes(64);
        const track = new TrackBuffer(data.length, 'audio/webm');
        const cancelled = track.read(0, 63).getReader();
        const pending = cancelled.read();
        await cancelled.cancel();
        const other = readAll(track.read(0, 63));
        track.push(data);
        expect(await other).toEqual(data);
        expect((await pending).done).toBe(true);
    });
});

describe('byte-budget cache', () => {
    it('drops the least recently used entries, never the newest', () => {
        const cache = createByteLru(100);
        cache.set('a', 'A', 40);
        cache.set('b', 'B', 40);
        expect(cache.get('a')).toBe('A');
        cache.set('c', 'C', 40);
        expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual(['A', undefined, 'C']);
        cache.set('huge', 'H', 500);
        expect([cache.get('a'), cache.get('c'), cache.get('huge')]).toEqual([undefined, undefined, 'H']);
        cache.delete('huge');
        expect(cache.size).toBe(0);
    });

    it('reports every entry that leaves: evicted, replaced, deleted or cleared', () => {
        const dropped: string[] = [];
        const cache = createByteLru(100, (value: string) => dropped.push(value));
        cache.set('a', 'A', 60);
        cache.set('b', 'B', 60);
        cache.set('b', 'B2', 60);
        cache.set('c', 'C', 30);
        cache.delete('c');
        cache.clear();
        expect(dropped).toEqual(['A', 'B', 'C', 'B2']);
    });
});

describe('YouTube Music audio scheme', () => {
    it('hands out a different URL on every call and plans the track once', async () => {
        const loadPlan = vi.fn(async () => instantPlan(bytes(10)));
        const audio = createYtmAudio({ loadPlan });
        const [first, second] = [await audio.issue(VIDEO), await audio.issue(VIDEO)];
        expect(first.url).toMatch(/^folia-ytm:\/\/audio\/m9SMT5ipbxk\/high\?k=[a-f0-9]{32}$/);
        expect(second.url).not.toBe(first.url);
        expect(loadPlan).toHaveBeenCalledTimes(1);
    });

    it.each(['', 'short', '../../../etc/passwd', 'm9SMT5ipbxk?x=1', 42, null])('refuses the track id %j before asking YouTube', async id => {
        const loadPlan = vi.fn();
        await expect(createYtmAudio({ loadPlan }).issue(id)).rejects.toMatchObject({ code: 'unsupported' });
        expect(loadPlan).not.toHaveBeenCalled();
    });

    it('starts the download only when the bytes are asked for, and once for all readers', async () => {
        const data = bytes(5000);
        const plan = instantPlan(data);
        const audio = createYtmAudio({ loadPlan: async () => plan });
        const { url } = await audio.issue(VIDEO);
        expect(plan.open).not.toHaveBeenCalled();

        const [whole, prefix, suffix] = await Promise.all([
            audio.handle(get(url)), audio.handle(get(url, { Range: 'bytes=0-99' })), audio.handle(get(url, { Range: 'bytes=-10' })),
        ]);
        expect(plan.open).toHaveBeenCalledTimes(1);
        expect(whole.status).toBe(200);
        expect(Object.fromEntries(whole.headers)).toMatchObject({
            'content-type': 'audio/webm', 'content-length': '5000', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*',
        });
        expect(new Uint8Array(await whole.arrayBuffer())).toEqual(data);
        expect(prefix.status).toBe(206);
        expect(prefix.headers.get('content-range')).toBe('bytes 0-99/5000');
        expect(new Uint8Array(await prefix.arrayBuffer())).toEqual(data.subarray(0, 100));
        expect(suffix.headers.get('content-range')).toBe('bytes 4990-4999/5000');
        expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(data.subarray(4990));
    });

    it('answers a range past the end with 416 and no body', async () => {
        const audio = createYtmAudio({ loadPlan: async () => instantPlan(bytes(100)) });
        const { url } = await audio.issue(VIDEO);
        const response = await audio.handle(get(url, { Range: 'bytes=100-200' }));
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */100');
        expect(await response.text()).toBe('');
    });

    it('keeps a track once for each quality level, and answers a URL only at the level it was issued for', async () => {
        const loadPlan = vi.fn(async (..._asked: unknown[]) => instantPlan(bytes(10)));
        const audio = createYtmAudio({ loadPlan });
        const high = await audio.issue(VIDEO, 'high');
        const standard = await audio.issue(VIDEO, 'standard');
        await audio.issue(VIDEO, 'high');
        // The track buffered at one level is planned anew at the other, and once for each.
        expect(loadPlan.mock.calls).toEqual([[VIDEO, undefined, 'high'], [VIDEO, undefined, 'standard']]);
        expect(standard.url).toMatch(/^folia-ytm:\/\/audio\/m9SMT5ipbxk\/standard\?k=[a-f0-9]{32}$/);
        // A key is of one level: under the other level's address it is an unknown key.
        const key = new URL(high.url).searchParams.get('k');
        expect((await audio.handle(get(`folia-ytm://audio/${VIDEO}/standard?k=${key}`))).status).toBe(503);
        expect((await audio.handle(get(standard.url))).status).toBe(200);
        expect((await audio.handle(get(high.url))).status).toBe(200);
        await expect(audio.issue(VIDEO, 'lossless')).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('answers only URLs it issued, for the track they were issued for', async () => {
        const loadPlan = vi.fn(async () => instantPlan(bytes(10)));
        const audio = createYtmAudio({ loadPlan });
        const { url } = await audio.issue(VIDEO);
        const key = new URL(url).searchParams.get('k');
        loadPlan.mockClear();
        for (const request of [get(`folia-ytm://other/${VIDEO}?k=${key}`), new Request(url, { method: 'POST' })]) {
            expect((await audio.handle(request)).type).toBe('error');
        }
        // A key that is not this track's will never be: a status, so the element stops asking.
        for (const request of [
            get(`folia-ytm://audio/${VIDEO}`),
            get(`folia-ytm://audio/${VIDEO}/high?k=${'0'.repeat(32)}`),
            get(`folia-ytm://audio/ZRtdQ81jPUQ/high?k=${key}`),
        ]) {
            const response = await audio.handle(request);
            expect(response.status).toBe(503);
            expect(await response.text()).toBe('');
        }
        // An unissued id never reaches YouTube, so page content cannot drive signed-in requests.
        expect(loadPlan).not.toHaveBeenCalled();
        expect((await audio.handle(get(url))).status).toBe(200);
    });

    it('fails the body, not the status, when the download breaks, and plans afresh for the next URL', async () => {
        const download = manualDownload();
        const broken = { mimeType: 'audio/webm', contentLength: 100, open: async () => download };
        const loadPlan = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(instantPlan(bytes(100)));
        const audio = createYtmAudio({ loadPlan });
        const first = await audio.issue(VIDEO);
        const response = await audio.handle(get(first.url));
        expect(response.status).toBe(200);
        download.push(bytes(40));
        download.fail(new Error('stream broke'));
        // A caller saving this response would otherwise keep 40 bytes as the whole track.
        await expect(response.arrayBuffer()).rejects.toThrow();

        const second = await audio.issue(VIDEO);
        // The new plan is told which one broke, so that it can go another way.
        expect(loadPlan.mock.calls).toEqual([[VIDEO, undefined, 'high'], [VIDEO, broken, 'high']]);
        expect(new Uint8Array(await (await audio.handle(get(second.url))).arrayBuffer())).toEqual(bytes(100));
    });

    it('gives up a download that stops arriving, and plans afresh for the next URL', async () => {
        const download = manualDownload();
        const stalled = { mimeType: 'audio/webm', contentLength: 100, open: async () => download };
        const loadPlan = vi.fn().mockResolvedValueOnce(stalled).mockResolvedValueOnce(instantPlan(bytes(100)));
        const audio = createYtmAudio({ loadPlan, stallMs: 20 });
        const first = await audio.issue(VIDEO);
        const response = await audio.handle(get(first.url));
        download.push(bytes(40));
        await expect(response.arrayBuffer()).rejects.toThrow();
        expect(download.abort).toHaveBeenCalled();

        const second = await audio.issue(VIDEO);
        expect(loadPlan.mock.calls).toEqual([[VIDEO, undefined, 'high'], [VIDEO, stalled, 'high']]);
        expect(new Uint8Array(await (await audio.handle(get(second.url))).arrayBuffer())).toEqual(bytes(100));
    });

    it('lets a slow download run for as long as it keeps arriving', async () => {
        const data = bytes(150);
        const download = manualDownload();
        const audio = createYtmAudio({ loadPlan: async () => ({ mimeType: 'audio/webm', contentLength: 150, open: async () => download }), stallMs: 100 });
        const response = await audio.handle(get((await audio.issue(VIDEO)).url));
        // Fifteen chunks, 10 ms apart: longer in all than the limit, never quiet for that long.
        for (let sent = 0; sent < data.length; sent += 10) {
            await new Promise(resolve => setTimeout(resolve, 10));
            download.push(data.subarray(sent, sent + 10));
        }
        download.end();
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(data);
        expect(download.abort).not.toHaveBeenCalled();
    });

    it('finishes a broken download on the same URL when the new plan offers the same file', async () => {
        let time = 0;
        const data = bytes(100);
        const broken = brokenPlan(data);
        const loadPlan = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(instantPlan(data));
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
        // The audio element asks again from where it stopped, about thirty times in half a minute.
        // The ones that come too soon after the last plan are told to try again.
        time += 300;
        expect((await audio.handle(get(url, { Range: 'bytes=40-' }))).type).toBe('error');
        expect(loadPlan).toHaveBeenCalledTimes(1);
        time += 2700;
        const rest = await audio.handle(get(url, { Range: 'bytes=40-' }));
        expect(rest.status).toBe(206);
        expect(new Uint8Array(await rest.arrayBuffer())).toEqual(data.subarray(40));
        expect(loadPlan.mock.calls).toEqual([[VIDEO, undefined, 'high'], [VIDEO, broken, 'high']]);
    });

    it('lets the same URL go on once the network is back', async () => {
        let time = 0;
        const data = bytes(100);
        const broken = brokenPlan(data);
        const loadPlan = vi.fn<(videoId: string, failed?: unknown) => Promise<unknown>>(async () => { throw new TypeError('fetch failed'); }).mockResolvedValueOnce(broken);
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
        // As many attempts as a broken download gets new plans: these made none, and do not count.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            time += 3000;
            // A network error: the element keeps asking.
            expect((await audio.handle(get(url, { Range: 'bytes=40-' }))).type).toBe('error');
        }
        loadPlan.mockResolvedValueOnce(instantPlan(data));
        time += 3000;
        const rest = await audio.handle(get(url, { Range: 'bytes=40-' }));
        expect(new Uint8Array(await rest.arrayBuffer())).toEqual(data.subarray(40));
        // Every attempt was told which plan broke.
        expect(loadPlan.mock.calls.map(call => call[1])).toEqual([undefined, broken, broken, broken, broken, broken]);
    });

    it('stops healing a URL after half a minute without a plan, however slowly the attempts fail', async () => {
        let time = 0;
        const data = bytes(100);
        const broken = brokenPlan(data);
        // Every attempt takes eight seconds to fail, as on a line where connections time out.
        const loadPlan = vi.fn<(videoId: string, failed?: unknown) => Promise<unknown>>(async () => {
            time += 8000;
            throw new TypeError('fetch failed');
        }).mockResolvedValueOnce(broken);
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
        time += 5000;
        const ask = () => audio.handle(get(url, { Range: 'bytes=40-' }));
        // Four attempts, 32 seconds: network errors, the element keeps asking.
        for (let attempt = 0; attempt < 4; attempt += 1) expect((await ask()).type).toBe('error');
        expect(loadPlan).toHaveBeenCalledTimes(5);
        // Past half a minute: a status at once, and YouTube is not asked.
        const refused = await ask();
        expect(refused.status).toBe(503);
        expect(await refused.text()).toBe('');
        expect(loadPlan).toHaveBeenCalledTimes(5);

        // The renderer's request for a new URL is still tried, and a plan starts the count again.
        loadPlan.mockResolvedValueOnce(brokenPlan(data));
        const next = await audio.issue(VIDEO);
        await expect((await audio.handle(get(next.url))).arrayBuffer()).rejects.toThrow();
        time += 3000;
        expect((await audio.handle(get(next.url, { Range: 'bytes=40-' }))).type).toBe('error');
        expect(loadPlan).toHaveBeenCalledTimes(7);
    });

    it('asks YouTube again for a kept URL once the asking had stopped', async () => {
        let time = 0;
        const data = bytes(100);
        const offline = async () => { throw new TypeError('fetch failed'); };
        const loadPlan = vi.fn<(videoId: string, failed?: unknown) => Promise<unknown>>(offline).mockResolvedValueOnce(brokenPlan(data));
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
        const ask = () => audio.handle(get(url, { Range: 'bytes=40-' }));
        // Offline: the element asks for half a minute and is then refused.
        let refused = false;
        for (let turn = 0; turn < 12 && !refused; turn += 1) {
            time += 3000;
            refused = (await ask()).status === 503;
        }
        expect(refused).toBe(true);
        // The renderer's request for a new URL fails as well, and the listener moves on.
        await expect(audio.issue(VIDEO)).rejects.toThrow('fetch failed');
        const asked = loadPlan.mock.calls.length;

        // The line is back when the URL the renderer kept is used again: one plan, and the bytes.
        time += 5 * 60 * 1000;
        loadPlan.mockResolvedValueOnce(instantPlan(data));
        expect(new Uint8Array(await (await ask()).arrayBuffer())).toEqual(data.subarray(40));
        expect(loadPlan).toHaveBeenCalledTimes(asked + 1);
    });

    it('does not count the time nobody asked towards the half minute', async () => {
        let time = 0;
        const data = bytes(100);
        const loadPlan = vi.fn<(videoId: string, failed?: unknown) => Promise<unknown>>()
            .mockResolvedValueOnce(brokenPlan(data)).mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(instantPlan(data));
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
        // One request finds no plan, and the listener skips the track.
        time += 3000;
        expect((await audio.handle(get(url, { Range: 'bytes=40-' }))).type).toBe('error');
        // Forty seconds later the track is played again from the same URL.
        time += 40_000;
        const rest = await audio.handle(get(url, { Range: 'bytes=40-' }));
        expect(new Uint8Array(await rest.arrayBuffer())).toEqual(data.subarray(40));
    });

    it('logs a finished download with its size and time, and a broken one with how far it got', async () => {
        const [log, warn] = [vi.fn(), vi.fn()];
        const whole = createYtmAudio({ loadPlan: async () => ({ ...instantPlan(bytes(100)), route: 'web' }), log, warn });
        await (await whole.handle(get((await whole.issue(VIDEO)).url))).arrayBuffer();
        await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
            expect.stringMatching(new RegExp(`^\\[Ytm\\] Download of ${VIDEO} by the web route is complete: 100 bytes in \\d+ms$`))));
        expect(warn).not.toHaveBeenCalled();

        const broken = createYtmAudio({ loadPlan: async () => asAccount(brokenPlan(bytes(100))), log, warn });
        await expect((await broken.handle(get((await broken.issue(VIDEO)).url))).arrayBuffer()).rejects.toThrow();
        expect(warn.mock.calls).toEqual([[expect.stringMatching(
            new RegExp(`^\\[Ytm\\] Download of ${VIDEO} by the member route broke at 40 of 100 bytes after \\d+ms: invalid-response \\(stream broke\\)$`))]]);
    });

    it('says that a download was stopped for bringing nothing, and that a plan took too long', async () => {
        const warn = vi.fn();
        const silent = createYtmAudio({ loadPlan: async () => ({ mimeType: 'audio/webm', contentLength: 100, route: 'web', open: async () => manualDownload() }), stallMs: 20, warn });
        await expect((await silent.handle(get((await silent.issue(VIDEO)).url))).arrayBuffer()).rejects.toThrow();
        expect(warn.mock.calls).toEqual([[expect.stringMatching(
            new RegExp(`^\\[Ytm\\] Download of ${VIDEO} by the web route broke at 0 of 100 bytes after \\d+ms: no data for 20ms$`))]]);

        warn.mockClear();
        const slow = createYtmAudio({ loadPlan: () => new Promise(() => {}), planLimitMs: 20, warn });
        await expect(slow.issue(VIDEO)).rejects.toMatchObject({ code: 'network' });
        expect(warn.mock.calls).toEqual([[`[Ytm] ${VIDEO} got no plan in 20ms; the wait is over`]]);
    });

    it('gives a broken download a new plan four times in five minutes, and then none', async () => {
        let time = 0;
        const warn = vi.fn();
        const loadPlan = vi.fn(async () => asAccount(brokenPlan(bytes(100))));
        const audio = createYtmAudio({ loadPlan, now: () => time, warn });
        // Plays the track on one URL until nothing more is planned for it.
        const breakUntilRefused = async () => {
            const { url } = await audio.issue(VIDEO);
            await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
            for (let turn = 0; turn < 10; turn += 1) {
                time += 3000;
                const response = await audio.handle(get(url, { Range: 'bytes=40-' }));
                if (response.status === 503) return response;
                await expect(response.arrayBuffer()).rejects.toThrow();
            }
            throw new Error('the track was never refused');
        };
        // A status with no body: the element stops asking, and a caller has nothing to save.
        expect(await (await breakUntilRefused()).text()).toBe('');
        expect(loadPlan).toHaveBeenCalledTimes(5);
        await expect(audio.issue(VIDEO)).rejects.toMatchObject({ code: 'not-playable', message: 'YouTube Music playback of this track kept breaking' });
        expect(loadPlan).toHaveBeenCalledTimes(5);
        // Refused twice by now, and said once.
        expect(warn.mock.calls.filter(([line]) => String(line).includes('is left alone'))).toEqual(
            [[`[Ytm] ${VIDEO} is left alone: 4 new plans in 5 min did not keep its download going`]]);

        // Another track is not held back, and this one is planned again later.
        await audio.issue('ZRtdQ81jPUQ');
        time += 5 * 60 * 1000;
        await breakUntilRefused();
        expect(loadPlan).toHaveBeenCalledTimes(10);
        // Another sign-in can change what YouTube allows its account: the count starts again.
        audio.clear('member');
        await breakUntilRefused();
        expect(loadPlan).toHaveBeenCalledTimes(15);
    });

    it('does not count the plans of tracks that were only pushed out of the buffer', async () => {
        const loadPlan = vi.fn(async () => instantPlan(bytes(60)));
        const audio = createYtmAudio({ loadPlan, maxCacheBytes: 100 });
        for (let round = 0; round < 8; round += 1) {
            await audio.issue(VIDEO);
            await audio.issue('ZRtdQ81jPUQ');
        }
        expect(loadPlan).toHaveBeenCalledTimes(16);
    });

    it('does not hold a track back for plans that could not be made', async () => {
        const loadPlan = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
        const audio = createYtmAudio({ loadPlan });
        for (let attempt = 0; attempt < 8; attempt += 1) await expect(audio.issue(VIDEO)).rejects.toThrow('fetch failed');
        // The network is back.
        loadPlan.mockResolvedValue(instantPlan(bytes(10)));
        expect((await audio.handle(get((await audio.issue(VIDEO)).url))).status).toBe(200);
        expect(loadPlan).toHaveBeenCalledTimes(9);
    });

    it('does not continue a URL with the bytes of another file', async () => {
        const data = bytes(100);
        for (const other of [instantPlan(bytes(120)), instantPlan(bytes(100, 3), 'audio/mp4')]) {
            let time = 0;
            const loadPlan = vi.fn().mockResolvedValueOnce(brokenPlan(data)).mockResolvedValueOnce(other);
            const audio = createYtmAudio({ loadPlan, now: () => time });
            const { url } = await audio.issue(VIDEO);
            await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
            time += 3000;
            const response = await audio.handle(get(url, { Range: 'bytes=40-' }));
            expect(response.status).toBe(503);
            expect(await response.text()).toBe('');
            expect((await audio.handle(get(url))).status).toBe(503);
            expect(other.open).not.toHaveBeenCalled();

            // A new URL is a new start for the element, so it gets the other file.
            const next = await audio.issue(VIDEO);
            expect(loadPlan).toHaveBeenCalledTimes(2);
            const replaced = await audio.handle(get(next.url));
            expect(replaced.headers.get('content-type')).toBe(other.mimeType);
            expect((await replaced.arrayBuffer()).byteLength).toBe(other.contentLength);
        }
    });

    it('stops waiting for a plan that YouTube never answers, and asks again the next time', async () => {
        const loadPlan = vi.fn().mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(instantPlan(bytes(10)));
        const audio = createYtmAudio({ loadPlan, planLimitMs: 20 });
        await expect(audio.issue(VIDEO)).rejects.toMatchObject({ code: 'network' });
        expect((await audio.handle(get((await audio.issue(VIDEO)).url))).status).toBe(200);
    });

    it('treats a stream that ends short of its declared length as a failure', async () => {
        const audio = createYtmAudio({ loadPlan: async () => ({ ...instantPlan(bytes(60)), contentLength: 100 }) });
        const { url } = await audio.issue(VIDEO);
        await expect((await audio.handle(get(url))).arrayBuffer()).rejects.toThrow();
    });

    it('stops a stream that brings more than its declared length', async () => {
        const download = manualDownload();
        const audio = createYtmAudio({ loadPlan: async () => ({ mimeType: 'audio/webm', contentLength: 100, open: async () => download }) });
        const { url } = await audio.issue(VIDEO);
        const body = (await audio.handle(get(url))).arrayBuffer();
        download.push(bytes(60));
        download.push(bytes(60));
        await expect(body).rejects.toThrow();
        expect(download.abort).toHaveBeenCalledTimes(1);
    });

    it('reports a track with no usable length as not playable', async () => {
        for (const contentLength of [0, Number.NaN, 300 * 1024 * 1024]) {
            const audio = createYtmAudio({ loadPlan: async () => ({ mimeType: 'audio/webm', contentLength, open: vi.fn() }) });
            await expect(audio.issue(VIDEO)).rejects.toMatchObject({ code: 'not-playable' });
        }
    });

    it('plans an unused track again when its plan has aged, and tells a reader whether the failure may pass', async () => {
        const loadPlan = vi.fn().mockResolvedValueOnce(instantPlan(bytes(10)))
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockRejectedValueOnce(ytmError('not-playable', 'YouTube Music cannot play this track'));
        let time = 0;
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        // The plan was never used and YouTube's stream URL may have expired since: it is asked again.
        time += 31 * 60 * 1000;
        // The network may come back: a network error, after which the element asks again.
        expect((await audio.handle(get(url))).type).toBe('error');
        // Nothing broke, so no plan is handed over as failed.
        expect(loadPlan.mock.calls).toEqual([[VIDEO, undefined, 'high'], [VIDEO, undefined, 'high']]);
        // YouTube's refusal will not pass: a status.
        time += 3000;
        expect((await audio.handle(get(url))).status).toBe(503);
        expect(loadPlan).toHaveBeenCalledTimes(3);
    });

    it('keeps a started download past the plan lifetime', async () => {
        const plan = instantPlan(bytes(10));
        const loadPlan = vi.fn(async () => plan);
        let time = 0;
        const audio = createYtmAudio({ loadPlan, now: () => time });
        const { url } = await audio.issue(VIDEO);
        await (await audio.handle(get(url))).arrayBuffer();
        time += 3 * 60 * 60 * 1000;
        expect((await audio.handle(get(url))).status).toBe(200);
        expect(loadPlan).toHaveBeenCalledTimes(1);
        expect(plan.open).toHaveBeenCalledTimes(1);
    });

    it('stops a download in progress when its track leaves the cache', async () => {
        for (const leave of ['sign-out', 'eviction'] as const) {
            const download = manualDownload();
            const plans = new Map<string, unknown>([
                [VIDEO, asAccount({ mimeType: 'audio/webm', contentLength: 100, open: async () => download })],
                ['ZRtdQ81jPUQ', instantPlan(bytes(60))],
            ]);
            const warn = vi.fn();
            const audio = createYtmAudio({ loadPlan: async (id: string) => plans.get(id), maxCacheBytes: 100, log: vi.fn(), warn });
            const response = await audio.handle(get((await audio.issue(VIDEO)).url));
            download.push(bytes(40));
            await vi.waitFor(() => expect(download.abort).not.toHaveBeenCalled());
            if (leave === 'sign-out') audio.clear('member'); else await audio.issue('ZRtdQ81jPUQ');
            expect(download.abort).toHaveBeenCalledTimes(1);
            await expect(response.arrayBuffer()).rejects.toThrow();
            // Stopped on purpose: not a failure to report.
            expect(warn).not.toHaveBeenCalled();
        }
    });

    it('does not start a download for a track that left the cache while it was being opened', async () => {
        const download = manualDownload();
        let opened!: (source: unknown) => void;
        const open = vi.fn(() => new Promise(resolve => { opened = resolve; }));
        const audio = createYtmAudio({ loadPlan: async () => asAccount({ mimeType: 'audio/webm', contentLength: 100, open }) });
        const response = await audio.handle(get((await audio.issue(VIDEO)).url));
        await vi.waitFor(() => expect(open).toHaveBeenCalled());
        audio.clear('member');
        opened(download);
        await expect(response.arrayBuffer()).rejects.toThrow();
        expect(download.abort).toHaveBeenCalledTimes(1);
    });

    it('leaves a finished download alone when its track leaves the cache', async () => {
        const plan = instantPlan(bytes(10));
        const audio = createYtmAudio({ loadPlan: async () => asAccount(plan) });
        await (await audio.handle(get((await audio.issue(VIDEO)).url))).arrayBuffer();
        audio.clear('member');
        expect((await plan.open.mock.results[0].value).abort).not.toHaveBeenCalled();
    });

    it('evicts the oldest buffered track once the byte budget is spent', async () => {
        const plans = new Map([[VIDEO, instantPlan(bytes(60))], ['ZRtdQ81jPUQ', instantPlan(bytes(60, 7))]]);
        const loadPlan = vi.fn(async (id: string) => plans.get(id));
        let time = 0;
        const audio = createYtmAudio({ loadPlan, maxCacheBytes: 100, now: () => time });
        const first = await audio.issue(VIDEO);
        await (await audio.handle(get(first.url))).arrayBuffer();
        await audio.issue('ZRtdQ81jPUQ');
        time += 3000;
        // The first track fell out of the cache: reading it again downloads it again.
        expect(new Uint8Array(await (await audio.handle(get(first.url))).arrayBuffer())).toEqual(bytes(60));
        expect(plans.get(VIDEO)!.open).toHaveBeenCalledTimes(2);
    });

    it('forgets what the account\'s route planned when it is cleared, plans a track it was planning once more, and leaves the guest\'s alone', async () => {
        const releases: Array<(plan: unknown) => void> = [];
        const held = () => new Promise(resolve => { releases.push(resolve); });
        const loadPlan = vi.fn()
            .mockResolvedValueOnce(asAccount(instantPlan(bytes(10))))
            .mockResolvedValueOnce(asGuest(instantPlan(bytes(30))))
            .mockReturnValueOnce(held())
            .mockReturnValueOnce(held())
            .mockResolvedValueOnce(asAccount(instantPlan(bytes(20))));
        const audio = createYtmAudio({ loadPlan });
        const { url } = await audio.issue(VIDEO);
        const guest = await audio.issue('ZRtdQ81jPUQ');
        const pending = audio.issue('AAAAAAAAAAA');
        const pendingAsGuest = audio.issue('BBBBBBBBBBB');
        audio.clear('member');
        // The answer for the previous account is not the one handed out.
        releases[0](asAccount(instantPlan(bytes(10))));
        const response = await audio.handle(get((await pending).url));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes(20));
        expect((await audio.handle(get(url))).status).toBe(503);
        // What the guest's route planned stays, and so does a plan of its that was under way.
        expect((await audio.handle(get(guest.url))).status).toBe(200);
        releases[1](asGuest(instantPlan(bytes(40))));
        expect((await (await audio.handle(get((await pendingAsGuest).url))).arrayBuffer()).byteLength).toBe(40);
        expect(loadPlan).toHaveBeenCalledTimes(5);
    });

    it('reports a session that changes twice while one track is planned', async () => {
        const releases: Array<(plan: unknown) => void> = [];
        const loadPlan = vi.fn(() => new Promise(resolve => { releases.push(resolve); }));
        const audio = createYtmAudio({ loadPlan });
        const pending = audio.issue(VIDEO);
        audio.clear('member');
        releases[0](asAccount(instantPlan(bytes(10))));
        await vi.waitFor(() => expect(releases).toHaveLength(2));
        audio.clear('member');
        releases[1](asAccount(instantPlan(bytes(10))));
        await expect(pending).rejects.toMatchObject({ code: 'auth-required' });
    });
});
