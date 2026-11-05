import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Native transport tests exercise the shared request dispatcher without WebKit or credentials.
const require = createRequire(import.meta.url);
const { createNativeSpawn } = require('../../../electron/appleMusic/nativeSpawn.cjs');
const { createCompanionClient } = require('../../../electron/appleMusic/companionClient.cjs');

function fixture(
    evaluate: (expression: string) => unknown = () => ({ ok: true, data: { items: [] } }),
    // A host's own answer to a native control: undefined answers success, null never answers.
    answer: (request: Record<string, any>) => Record<string, unknown> | null | undefined = () => undefined,
) {
    const child = new EventEmitter() as EventEmitter & Record<string, any>;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => { child.emit('exit'); });
    const commands: Record<string, any>[] = [];
    let generation = 1;
    const emit = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n');
    child.stdin = new Writable({
        write(bytes, _encoding, done) {
            const request = JSON.parse(String(bytes));
            commands.push(request);
            queueMicrotask(async () => {
                if (request.operation === 'navigate') emit({ event: 'document', generation: ++generation, ready: true, url: request.url });
                const own = answer(request);
                if (own === null) return;
                // The page may answer later (a promise), as a slow start does.
                const data = request.operation === 'evaluate' ? await evaluate(request.expression) : {};
                emit({ id: request.id, ...(own ?? { ok: true, data }) });
            });
            done();
        },
        final(done) { queueMicrotask(() => child.emit('exit')); done(); },
    });
    const spawn = vi.fn((_binary: string, _args: string[], _options: unknown) => child);
    const create = (options: Record<string, unknown> = {}) => createNativeSpawn({ spawnProcess: spawn, ...options })('/native', ['--user-data-dir=/private/profile']);
    const ready = () => emit({ event: 'document', generation: 1, ready: true, url: 'https://music.apple.com/cn/' });
    return { child, commands, spawn, create, ready, emit };
}
const instances: Array<{ disconnect: () => void }> = [];
afterEach(() => { instances.splice(0).forEach(child => child.disconnect()); vi.useRealTimers(); });

const send = (bridge: EventEmitter & Record<string, any>, request: unknown): Promise<any> => new Promise(resolve => {
    bridge.once('message', resolve);
    bridge.send(request, () => {});
});
// The page's answer per operation, read from the request the dispatcher serialized into the page.
const pageAnswers = (answers: Record<string, () => unknown>) => (expression: string) => {
    const operation = /"operation":"(\w+)"/.exec(expression)?.[1] ?? '';
    return (answers[operation] ?? (() => ({ ok: true, data: {} })))();
};
const pins = (commands: Record<string, any>[]) => commands.filter(request => request.operation === 'keepVisible').map(request => request.active);
const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const playing = (positionMs: number) => ({ ok: true, data: { isPlaying: true, positionMs } });

describe('native WebView companion adapter', () => {
    it('forwards only fixed lifecycle events and ignores arbitrary runtime text', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            const f = fixture(); const bridge = f.create(); instances.push(bridge);
            f.emit({ event: 'diagnostic', code: 'environment-ready' });
            f.emit({ event: 'diagnostic', code: 'private-page-value' });
            f.child.stderr.write('private-runtime-output\n');
            expect(info).toHaveBeenCalledExactlyOnceWith('[AppleMusic] Native companion:', 'environment-ready');
        } finally { info.mockRestore(); }
    });
    it('uses only private pipes and a stable profile-specific store', () => {
        const f = fixture(); const bridge = f.create(); instances.push(bridge);
        expect(f.spawn).toHaveBeenCalledWith('/native', expect.arrayContaining(['--profile=/private/profile']), { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        expect(f.spawn.mock.calls[0][1]).toContainEqual(expect.stringMatching(/^--store=[a-f0-9-]{36}$/));
        bridge.disconnect();
        expect(bridge.connected).toBe(false);
        expect(f.child.stdin.writableEnded).toBe(true);
    });
    it('keeps requests not-ready until the document is ready and never forwards caller scripts', async () => {
        const f = fixture(); const bridge = f.create(); instances.push(bridge);
        expect(await send(bridge, { id: 'early', operation: 'search', params: { query: 'example' } })).toMatchObject({ error: 'not-ready' });
        expect(f.commands).toHaveLength(0);
        f.ready();
        expect(await send(bridge, { id: 'ready', operation: 'search', params: { query: 'example', expression: 'private-source' } })).toMatchObject({ ok: true });
        expect(f.commands[0].expression).not.toContain('private-source');
        f.emit({ event: 'document', generation: 2, ready: false, url: 'https://music.apple.com/cn/' });
        expect(await send(bridge, { id: 'navigation', operation: 'search', params: { query: 'example' } })).toMatchObject({ error: 'not-ready' });
    });
    it('maps show/hide to native controls and replies with the public request identity', async () => {
        const f = fixture(); const bridge = f.create(); instances.push(bridge);
        expect(await send(bridge, { id: 'show', operation: 'showWindow' })).toMatchObject({ id: 'show', ok: true });
        expect(await send(bridge, { id: 'hide', operation: 'hideWindow' })).toMatchObject({ id: 'hide', ok: true });
        expect(f.commands.map(request => request.operation)).toEqual(['show', 'hide']);
    });
    it('clears the WebKit store only after the old page has been replaced', async () => {
        const f = fixture(); const bridge = f.create(); instances.push(bridge); f.ready();
        expect(await send(bridge, { id: 'logout', operation: 'logout' })).toMatchObject({ ok: true });
        expect(f.commands.map(request => [request.operation, request.url])).toEqual([
            ['navigate', 'about:blank'], ['clear', undefined], ['navigate', 'https://music.apple.com/'],
        ]);
    });
    it('keeps the page visible from a start until the player sounds', async () => {
        let status: unknown = { ok: true, data: { isPlaying: false, starting: true, positionMs: 0 } };
        const f = fixture(pageAnswers({ playbackStatus: () => status }));
        const bridge = f.create(); instances.push(bridge); f.ready();
        const poll = async () => { await send(bridge, { id: 'status', operation: 'playbackStatus' }); await settle(); };
        await send(bridge, { id: 'play', operation: 'playSong', params: { catalogId: '123', startSec: 30 } });
        // The pin is written before the page is asked to start.
        expect(f.commands.slice(0, 2).map(request => request.operation)).toEqual(['keepVisible', 'evaluate']);
        await poll();
        // MusicKit says "playing" for a moment before it loads, at the start position of a restored song.
        status = playing(30000); await poll();
        status = { ok: true, data: { isPlaying: false, state: 1, positionMs: 30000 } }; await poll();
        status = playing(30000); await poll();
        expect(pins(f.commands)).toEqual([true]);
        status = playing(30500); await poll();
        await poll();
        expect(pins(f.commands)).toEqual([true, false]);
    });
    it('ends the pin with a pause, a failed start, a live station sounding and a logout, not with a start the client asks again', async () => {
        let start: unknown = { ok: true, data: {} };
        const f = fixture(pageAnswers({
            playSong: () => start,
            playbackStatus: () => ({ ok: true, data: { isPlaying: true, live: true, positionMs: 0 } }),
        }));
        const bridge = f.create(); instances.push(bridge); f.ready();
        await send(bridge, { id: 'resume', operation: 'resume' });
        await send(bridge, { id: 'pause', operation: 'pause' }); await settle();
        expect(pins(f.commands)).toEqual([true, false]);
        start = { ok: false, error: 'playback-failed', playbackStage: 'play' };
        await send(bridge, { id: 'failed', operation: 'playSong', params: { catalogId: '123' } }); await settle();
        expect(pins(f.commands)).toEqual([true, false, true, false]);
        start = { ok: false, error: 'not-ready' };
        await send(bridge, { id: 'early', operation: 'playSong', params: { catalogId: '123' } }); await settle();
        expect(pins(f.commands)).toEqual([true, false, true, false, true]);
        await send(bridge, { id: 'station', operation: 'playStation', params: { stationId: 'ra.example' } });
        await send(bridge, { id: 'live', operation: 'playbackStatus' });
        await send(bridge, { id: 'live-again', operation: 'playbackStatus' }); await settle();
        expect(pins(f.commands)).toEqual([true, false, true, false, true, true, false]);
        start = { ok: true, data: {} };
        await send(bridge, { id: 'play', operation: 'playSong', params: { catalogId: '123' } });
        await send(bridge, { id: 'logout', operation: 'logout' }); await settle();
        expect(pins(f.commands)).toEqual([true, false, true, false, true, true, false, true, false]);
    });
    it('leaves a newer start pinned when an older start fails or the page still holds its failure', async () => {
        const firstStart = deferred();
        const secondStart = deferred();
        const queue = [firstStart, secondStart];
        const f = fixture(pageAnswers({
            playSong: () => queue.shift()!.promise,
            playbackStatus: () => ({ ok: false, error: 'playback-failed', playbackStage: 'play' }),
        }));
        const bridge = f.create(); instances.push(bridge); f.ready();
        const first = send(bridge, { id: 'first', operation: 'playSong', params: { catalogId: '111' } });
        await settle();
        const second = send(bridge, { id: 'second', operation: 'playSong', params: { catalogId: '222' } });
        await settle();
        expect(pins(f.commands)).toEqual([true, true]);
        // The first song fails after the second one was pinned.
        firstStart.resolve({ ok: false, error: 'playback-failed', playbackStage: 'queue' });
        await first; await settle();
        // A status read before the second start reached the page still shows the first failure.
        await send(bridge, { id: 'stale', operation: 'playbackStatus' }); await settle();
        expect(pins(f.commands)).toEqual([true, true]);
        secondStart.resolve({ ok: true, data: {} });
        await second; await settle();
        // Now a failure answers for the second start.
        await send(bridge, { id: 'failed', operation: 'playbackStatus' }); await settle();
        expect(pins(f.commands)).toEqual([true, true, false]);
    });
    it('leaves a newer start pinned when an older pause answers after it', async () => {
        const hold = deferred();
        const f = fixture(pageAnswers({ pause: () => hold.promise }));
        const bridge = f.create(); instances.push(bridge); f.ready();
        await send(bridge, { id: 'play', operation: 'playSong', params: { catalogId: '111' } });
        const paused = send(bridge, { id: 'pause', operation: 'pause' });
        await settle();
        const next = send(bridge, { id: 'next', operation: 'playSong', params: { catalogId: '222' } });
        await settle();
        hold.resolve({ ok: true, data: {} });
        await paused; await next; await settle();
        expect(pins(f.commands)).toEqual([true, true]);
    });
    it('releases a pin nothing ended once the page would have given the start up', async () => {
        const f = fixture();
        const bridge = f.create({ pinLimitMs: 20 }); instances.push(bridge); f.ready();
        await send(bridge, { id: 'play', operation: 'playSong', params: { catalogId: '123' } });
        expect(pins(f.commands)).toEqual([true]);
        await settle(60);
        expect(pins(f.commands)).toEqual([true, false]);
    });
    it('starts without waiting for the host to answer the pin', async () => {
        const f = fixture(undefined, request => request.operation === 'keepVisible' ? null : undefined);
        const bridge = f.create(); instances.push(bridge); f.ready();
        expect(await send(bridge, { id: 'play', operation: 'playSong', params: { catalogId: '123' } })).toMatchObject({ ok: true });
        expect(f.commands.map(request => request.operation)).toEqual(['keepVisible', 'evaluate']);
    });
    it('asks a host that does not know the pin once and never releases it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            let position = 1000;
            const f = fixture(
                pageAnswers({ playbackStatus: () => playing(position += 500) }),
                request => request.operation === 'keepVisible' ? { ok: false, error: 'invalid-request' } : undefined,
            );
            const bridge = f.create(); instances.push(bridge); f.ready();
            expect(await send(bridge, { id: 'play', operation: 'playSong', params: { catalogId: '123' } })).toMatchObject({ ok: true });
            await settle();
            await send(bridge, { id: 'status', operation: 'playbackStatus' });
            await send(bridge, { id: 'status-again', operation: 'playbackStatus' });
            await send(bridge, { id: 'pause', operation: 'pause' });
            await send(bridge, { id: 'resume', operation: 'resume' }); await settle();
            expect(pins(f.commands)).toEqual([true]);
            // On Windows an old host build would bring the stall back: that is worth a line.
            expect(warn).toHaveBeenCalledTimes(process.platform === 'win32' ? 1 : 0);
        } finally { warn.mockRestore(); }
    });
    it.runIf(process.platform === 'darwin' || process.platform === 'win32')('delivers native results through the existing companion client without changing its public API', async () => {
        const f = fixture();
        const client = createCompanionClient({ nativeExecutablePath: '/native', profilePath: '/private/profile', spawnProcess: f.spawn });
        const result = client.request('showWindow');
        expect(await result).toMatchObject({ ok: true });
        client.close();
    });
});
