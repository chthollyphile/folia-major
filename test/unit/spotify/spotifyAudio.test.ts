import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineFailureOf, stopsPlayback } from '@/services/onlineMusic/failure/onlineFailureCase';
import { describeSpotifyFailure } from '@/services/onlineMusic/spotify/spotifyFailure';
import { OnlineProviderError } from '@/types/onlineMusic';

// test/unit/spotify/spotifyAudio.test.ts — the scheme handler that serves Spotify's audio,
// against a stand-in for Spotify's CDN that holds a file encrypted the way Spotify encrypts one.

const require = createRequire(import.meta.url);
const { createSpotifyAudio, counterAt } = require('../../../electron/spotify/audio.cjs');
const { createSpotifyAudioFiles } = require('../../../electron/spotify/audioFiles.cjs');
const { toErrorResult } = require('../../../electron/spotify/errors.cjs');

const TRACK = '4cOdK2wGLETKBW3PvgPWqT';
const KEY = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const LEAD = 0xa7;
// A file as Spotify keeps one: its own page, then the Ogg stream, encrypted from the fixed counter.
const plainFile = (length = 6000) => {
    const file = Buffer.from(Uint8Array.from({ length }, (_, index) => (index * 7 + 3) % 251));
    file.write('OggS', 0, 'latin1');
    file.write('OggS', LEAD, 'latin1');
    return file;
};
const encrypt = (file: Buffer) => crypto.createCipheriv('aes-128-ctr', KEY, Buffer.from('72e067fbddcbcf77ebe8bc643f630d93', 'hex')).update(file);
const readAll = async (response: Response) => Buffer.from(await response.arrayBuffer());

// The folders the tests keep files in.
const folders: string[] = [];
const folder = () => {
    const made = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-spotify-audio-'));
    folders.push(made);
    return made;
};
afterEach(() => { folders.splice(0).forEach(made => fs.rmSync(made, { recursive: true, force: true })); });

// The CDN: answers a range of the encrypted file, and refuses the addresses listed in `expired`.
// With `directory`, files are kept there. Each new connection fails with `fail` until told otherwise.
const setup = ({ file = plainFile(), format = 'OGG_VORBIS_320', directory, fail = null }: { file?: Buffer; format?: string; directory?: string; fail?: string | null } = {}) => {
    const sealed = encrypt(file);
    const expired = new Set<string>();
    const asked: string[] = [];
    const fetch = vi.fn(async (url: string, init: any) => {
        const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range)!;
        asked.push(`${url} ${init.headers.Range}`);
        if (expired.has(url)) return new Response(null, { status: 403 });
        const part = sealed.subarray(Number(from), Number(to) + 1);
        return new Response(new Uint8Array(part), { status: 206, headers: { 'Content-Range': `bytes ${from}-${Number(from) + part.length - 1}/${sealed.length}` } });
    });
    let located = 0;
    const sessions: any[] = [];
    const openSession = vi.fn(async () => {
        const session = {
            fail: fail as null | string,
            resolveAudioFileAsync: vi.fn(async () => {
                if (session.fail) throw new Error(session.fail);
                located += 1;
                return { cdnUrl: `https://cdn.test/file?n=${located}`, keyHex: KEY.toString('hex'), format };
            }),
            close: vi.fn(async () => {}),
        };
        sessions.push(session);
        return session;
    });
    let clock = 1_000_000;
    const logs: string[] = [];
    const record = (...args: unknown[]) => { logs.push(args.join(' ')); };
    const onKept = vi.fn();
    const audio = createSpotifyAudio({
        accessToken: async () => 'access-private', deviceId: () => 'device', fetch, openSession, now: () => clock, quietLimitMs: 30, log: record, warn: record,
        ...(directory ? { disk: createSpotifyAudioFiles({ directory: () => directory }), onKept } : {}),
    });
    const get = (url: string, range?: string) => audio.handle(new Request(url, range ? { headers: { Range: range } } : undefined));
    return { audio, file, sealed, fetch, asked, expired, sessions, openSession, logs, get, onKept, advance: (ms: number) => { clock += ms; } };
};

describe('Spotify audio', () => {
    it('counts the blocks before a byte into the counter, carrying into the bytes above', () => {
        expect(counterAt(0).toString('hex')).toBe('72e067fbddcbcf77ebe8bc643f630d93');
        expect(counterAt(15).toString('hex')).toBe('72e067fbddcbcf77ebe8bc643f630d93');
        expect(counterAt(16 * 0x6d).toString('hex')).toBe('72e067fbddcbcf77ebe8bc643f630e00');
        expect(counterAt(16 * 0xf300).toString('hex')).toBe('72e067fbddcbcf77ebe8bc643f640093');
    });

    it('gives the element the Ogg stream without Spotify\'s own page, decrypted, for any range it asks', async () => {
        const { audio, file, get } = setup();
        const { url, format } = await audio.issue(TRACK, 320);
        expect(url).toMatch(/^folia-spotify:\/\/audio\/4cOdK2wGLETKBW3PvgPWqT\?k=[0-9a-f]{32}$/);
        expect(format).toBe('OGG_VORBIS_320');
        const stream = file.subarray(LEAD);

        const whole = await get(url);
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-type')).toBe('audio/ogg');
        expect(whole.headers.get('content-length')).toBe(String(stream.length));
        expect((await readAll(whole)).equals(stream)).toBe(true);

        // Ranges that begin inside a 16-byte block of the file, and past the place where the
        // counter carries.
        for (const [range, from, to] of [['bytes=0-', 0, stream.length - 1], ['bytes=5-20', 5, 20], ['bytes=1800-1900', 1800, 1900], ['bytes=-100', stream.length - 100, stream.length - 1]] as const) {
            const part = await get(url, range);
            expect(part.status).toBe(206);
            expect(part.headers.get('content-range')).toBe(`bytes ${from}-${to}/${stream.length}`);
            expect((await readAll(part)).equals(stream.subarray(from, to + 1))).toBe(true);
        }
        expect((await get(url, `bytes=${stream.length}-`)).status).toBe(416);
    });

    it('hands out a new address each time and locates the file once', async () => {
        const { audio, sessions, openSession } = setup();
        const first = await audio.issue(TRACK, 320);
        const second = await audio.issue(TRACK, 320);
        expect(second.url).not.toBe(first.url);
        expect(openSession).toHaveBeenCalledTimes(1);
        expect(sessions[0].resolveAudioFileAsync).toHaveBeenCalledTimes(1);
        await audio.issue(TRACK, 160);
        expect(sessions[0].resolveAudioFileAsync).toHaveBeenCalledTimes(2);
    });

    it('locates the file again when its address has run out, and goes on from the byte asked for', async () => {
        const { audio, file, get, expired, sessions, advance } = setup();
        const { url } = await audio.issue(TRACK, 320);
        expired.add('https://cdn.test/file?n=1');
        const part = await get(url, 'bytes=300-399');
        expect(part.status).toBe(206);
        expect((await readAll(part)).equals(file.subarray(LEAD + 300, LEAD + 400))).toBe(true);
        expect(sessions[0].resolveAudioFileAsync).toHaveBeenCalledTimes(2);
        // After its time the address is not tried at all.
        advance(11 * 60 * 1000);
        expect((await get(url, 'bytes=0-9')).status).toBe(206);
        expect(sessions[0].resolveAudioFileAsync).toHaveBeenCalledTimes(3);
    });

    it('makes a new connection once when the kept one fails, and none for a track Spotify has not', async () => {
        const { audio, sessions, openSession } = setup();
        await audio.issue(TRACK, 320);
        sessions[0].fail = 'audio key unavailable: channel closed';
        await audio.issue(TRACK, 160);
        expect(openSession).toHaveBeenCalledTimes(2);
        expect(sessions[0].close).toHaveBeenCalledTimes(1);

        sessions[1].fail = 'track is unavailable';
        await expect(audio.issue('0000000000000000000000', 320)).rejects.toMatchObject({ code: 'not-playable' });
        expect(openSession).toHaveBeenCalledTimes(2);
        expect(sessions[1].close).not.toHaveBeenCalled();
    });

    it('refuses a file the key does not open, and a kind of file it cannot give the element', async () => {
        const broken = plainFile();
        broken.write('nope', LEAD, 'latin1');
        await expect(setup({ file: broken }).audio.issue(TRACK, 320)).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(setup({ format: 'AAC_24' }).audio.issue(TRACK, 320)).rejects.toMatchObject({ code: 'not-playable' });
        const mp3 = setup({ format: 'MP3_320' });
        const { url } = await mp3.audio.issue(TRACK, 320);
        const whole = await mp3.get(url);
        expect(whole.headers.get('content-type')).toBe('audio/mpeg');
        expect((await readAll(whole)).equals(mp3.file)).toBe(true);
    });

    it('honours only the addresses it issued, and none of them after the account changes', async () => {
        const { audio, get, sessions, openSession } = setup();
        const { url } = await audio.issue(TRACK, 320);
        expect((await get(url.replace(/k=.*/, 'k=00000000000000000000000000000000'))).status).toBe(503);
        expect((await get(url.replace(TRACK, '1111111111111111111111'))).status).toBe(503);
        audio.clear();
        expect(sessions[0].close).toHaveBeenCalledTimes(1);
        expect((await get(url)).status).toBe(503);
        await audio.issue(TRACK, 320);
        expect(openSession).toHaveBeenCalledTimes(2);
    });

    it('gives up a file whose first bytes never come, and locates it anew the next time', async () => {
        const { audio, fetch, sessions } = setup();
        const abort = vi.fn();
        fetch.mockImplementationOnce(async (_url: string, init: any) => {
            init.signal.addEventListener('abort', abort);
            return new Response(new ReadableStream({ start() {} }), { status: 206, headers: { 'Content-Range': 'bytes 0-170/6000' } });
        });
        await expect(audio.issue(TRACK, 320)).rejects.toMatchObject({ code: 'network' });
        expect(abort).toHaveBeenCalled();
        expect((await audio.issue(TRACK, 320)).url).toMatch(/^folia-spotify:/);
        expect(sessions[0].resolveAudioFileAsync).toHaveBeenCalledTimes(2);
    });

    it('does not decrypt bytes of another place than the one it asked for', async () => {
        const { audio, get, fetch } = setup();
        const { url } = await audio.issue(TRACK, 320);
        fetch.mockResolvedValueOnce(new Response(new Uint8Array(10), { status: 206, headers: { 'Content-Range': 'bytes 0-9/6000' } }));
        expect((await get(url, 'bytes=100-109')).type).toBe('error');
    });

    it('closes a connection once when two tracks fail on it together', async () => {
        const { audio, sessions, openSession } = setup();
        await audio.issue(TRACK, 320);
        sessions[0].fail = 'audio key unavailable: channel closed';
        await Promise.all([audio.issue(TRACK, 160), audio.issue('1111111111111111111111', 320)]);
        expect(sessions[0].close).toHaveBeenCalledTimes(1);
        expect(openSession).toHaveBeenCalledTimes(2);
    });

    it('tells a refused key apart: an account never given one stops, one given keys before tries later; a CDN 429 tries later', async () => {
        const REFUSED_KEY = 'audio key unavailable: Error { kind: Unavailable, error: AesKey }';
        // What the renderer makes of a failure: the shared case, and whether the queue stops.
        const shown = async (asking: Promise<unknown>) => {
            const thrown = await asking.then(() => null, error => error);
            const { error } = toErrorResult(thrown);
            const provided = new OnlineProviderError(error.code, error.message, 'spotify');
            const failure = onlineFailureOf({ operation: 'audio', providerId: 'spotify' }, { error: provided, detail: describeSpotifyFailure('audio', provided) ?? undefined });
            return { case: failure.case, stops: stopsPlayback(failure, true), message: error.message };
        };

        const { audio, sessions, openSession, logs, fetch } = setup({ fail: REFUSED_KEY });
        // No key yet in this run: the account cannot play; no new connection is made for it.
        expect(await shown(audio.issue(TRACK, 320))).toEqual({ case: 'account-refused', stops: true, message: 'Spotify gives this account no audio key' });
        expect(openSession).toHaveBeenCalledTimes(1);
        expect(logs.at(-1)).toMatch(/has given this account no key in this run; the account cannot play here/);

        // A key was given before: Spotify asks to slow down.
        sessions[0].fail = null;
        await audio.issue(TRACK, 160);
        sessions[0].fail = REFUSED_KEY;
        expect(await shown(audio.issue('1111111111111111111111', 320))).toEqual({ case: 'retry-later', stops: false, message: 'Spotify refused the audio key for now' });
        expect(openSession).toHaveBeenCalledTimes(1);
        expect(sessions[0].close).not.toHaveBeenCalled();
        expect(logs.at(-1)).toMatch(/refused the key after giving keys in this run; asked to try later/);

        // Another account signs in: what the one before was given does not count for it.
        audio.clear();
        expect((await shown(audio.issue(TRACK, 320))).case).toBe('account-refused');

        // The CDN answers 429.
        sessions[1].fail = null;
        fetch.mockResolvedValueOnce(new Response(null, { status: 429 }));
        expect(await shown(audio.issue('2222222222222222222222', 320))).toMatchObject({ case: 'retry-later', stops: false });
    });

    it('answers a line that fails as a network error, so that the element asks again', async () => {
        const { audio, get, fetch } = setup();
        const { url } = await audio.issue(TRACK, 320);
        fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
        const failed = await get(url, 'bytes=0-9');
        expect(failed.type).toBe('error');
        expect((await get(url, 'bytes=0-9')).status).toBe(206);
    });

    it('keeps a file on disk as Spotify sends it, encrypted, and then reads it from there', async () => {
        const directory = folder();
        const { audio, file, sealed, asked, get, onKept } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        expect(await audio.kept(url)).toBe(false);
        expect(await audio.keep(url, 4096)).toBe(true);
        expect(onKept).toHaveBeenCalledWith(4096);
        expect(fs.readdirSync(directory)).toEqual([`${TRACK}-320.bin`]);
        // What is on disk is the encrypted file, byte for byte: no decrypted audio, and no key.
        const onDisk = fs.readFileSync(path.join(directory, `${TRACK}-320.bin`));
        expect(onDisk.equals(sealed)).toBe(true);
        expect(onDisk.includes('OggS')).toBe(false);
        expect(onDisk.includes(KEY)).toBe(false);

        const requests = asked.length;
        expect(await audio.kept(url)).toBe(true);
        expect(await audio.keep(url, 4096)).toBe(true);
        const stream = file.subarray(LEAD);
        expect((await readAll(await get(url))).equals(stream)).toBe(true);
        const part = await get(url, 'bytes=1800-1900');
        expect(part.headers.get('content-range')).toBe(`bytes 1800-1900/${stream.length}`);
        expect((await readAll(part)).equals(stream.subarray(1800, 1901))).toBe(true);
        expect(asked.length).toBe(requests);
        expect(onKept).toHaveBeenCalledTimes(1);
    });

    it('opens a file kept by an earlier run with the key of this one, and asks the CDN for nothing', async () => {
        const directory = folder();
        const earlier = setup({ directory });
        await earlier.audio.keep((await earlier.audio.issue(TRACK, 320)).url, 0);

        const { audio, file, asked, get, logs } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        expect((await readAll(await get(url, 'bytes=5-20'))).equals(file.subarray(LEAD + 5, LEAD + 21))).toBe(true);
        expect(asked).toEqual([]);
        expect(logs.some(line => line.includes('kept on disk'))).toBe(true);
    });

    it('drops a kept file the key does not open, and plays the track from the CDN', async () => {
        const directory = folder();
        fs.writeFileSync(path.join(directory, `${TRACK}-320.bin`), Buffer.alloc(6000, 7));
        const { audio, file, asked, get } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        expect(fs.readdirSync(directory)).toEqual([]);
        expect((await readAll(await get(url, 'bytes=0-9'))).equals(file.subarray(LEAD, LEAD + 10))).toBe(true);
        expect(asked.length).toBe(2);
    });

    it('does not read a kept file of another length than the one the address stands for', async () => {
        const directory = folder();
        const { audio, file, sealed, asked, get } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        fs.writeFileSync(path.join(directory, `${TRACK}-320.bin`), sealed.subarray(0, 3000));
        expect(await audio.kept(url)).toBe(false);
        expect((await readAll(await get(url, 'bytes=0-9'))).equals(file.subarray(LEAD, LEAD + 10))).toBe(true);
        expect(asked.length).toBe(2);
    });

    it('keeps nothing of a file that did not arrive whole', async () => {
        const directory = folder();
        const { audio, sealed, fetch } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        fetch.mockResolvedValueOnce(new Response(new Uint8Array(sealed.subarray(0, 4000)), { status: 206, headers: { 'Content-Range': 'bytes 0-3999/6000' } }));
        await expect(audio.keep(url, 0)).rejects.toThrow('4000 bytes were written of a file of 6000');
        expect(fs.readdirSync(directory)).toEqual([]);
        expect(await audio.kept(url)).toBe(false);
        // The next asking writes it.
        expect(await audio.keep(url, 0)).toBe(true);
        expect(fs.readFileSync(path.join(directory, `${TRACK}-320.bin`)).equals(sealed)).toBe(true);
    });

    it('closes the CDN answer when the file cannot be written at all', async () => {
        const blocked = path.join(folder(), 'a-file');
        fs.writeFileSync(blocked, 'not a folder');
        const { audio, fetch } = setup({ directory: path.join(blocked, 'spotify') });
        const { url } = await audio.issue(TRACK, 320);
        await expect(audio.keep(url, 0)).rejects.toThrow();
        expect(fetch.mock.calls.at(-1)![1].headers.Range).toBe('bytes=0-5999');
        expect(fetch.mock.calls.at(-1)![1].signal.aborted).toBe(true);
    });

    it('says whether a file is kept without asking Spotify, also once its address has run out', async () => {
        const directory = folder();
        const { audio, asked, sessions, advance } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        await audio.keep(url, 0);
        advance(11 * 60 * 1000);
        const requests = asked.length;
        expect(await audio.kept(url)).toBe(true);
        expect(await audio.keep(url, 0)).toBe(true);
        expect(asked.length).toBe(requests);
        expect(sessions[0].resolveAudioFileAsync).toHaveBeenCalledTimes(1);
    });

    it('keeps nothing when Spotify has replaced the file since the address was issued', async () => {
        const directory = folder();
        const { audio, sealed, fetch, advance } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        // The address has run out, and the file located anew is longer than the one it stands for.
        advance(11 * 60 * 1000);
        fetch.mockResolvedValueOnce(new Response(new Uint8Array(sealed.subarray(0, LEAD + 4)), { status: 206, headers: { 'Content-Range': `bytes 0-${LEAD + 3}/9000` } }));
        await expect(audio.keep(url, 0)).rejects.toMatchObject({ code: 'unavailable' });
        expect(fs.readdirSync(directory)).toEqual([]);
    });

    it('writes a file once when it is asked for twice together', async () => {
        const directory = folder();
        const { audio, asked } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        const requests = asked.length;
        expect(await Promise.all([audio.keep(url, 0), audio.keep(url, 0)])).toEqual([true, true]);
        expect(asked.length).toBe(requests + 1);
    });

    it('keeps no file the key cannot be checked against, none for an address it did not issue, and none without a store', async () => {
        const directory = folder();
        const mp3 = setup({ format: 'MP3_320', directory });
        expect(await mp3.audio.keep((await mp3.audio.issue(TRACK, 320)).url, 0)).toBe(false);
        const { audio } = setup({ directory });
        const { url } = await audio.issue(TRACK, 320);
        expect(await audio.keep(url.replace(/k=.*/, 'k=00000000000000000000000000000000'), 0)).toBe(false);
        expect(await audio.kept('not an address')).toBe(false);
        expect(fs.readdirSync(directory)).toEqual([]);

        const bare = setup();
        const issued = await bare.audio.issue(TRACK, 320);
        expect(await bare.audio.keep(issued.url, 0)).toBe(false);
        expect(await bare.audio.kept(issued.url)).toBe(false);
    });
});
