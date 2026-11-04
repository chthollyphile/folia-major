import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Native transport tests exercise the shared request dispatcher without WebKit or credentials.
const require = createRequire(import.meta.url);
const { createNativeSpawn } = require('../../../electron/appleMusic/nativeSpawn.cjs');
const { createCompanionClient } = require('../../../electron/appleMusic/companionClient.cjs');

function fixture(evaluate: (expression: string) => unknown = () => ({ ok: true, data: { items: [] } })) {
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
            queueMicrotask(() => {
                if (request.operation === 'navigate') emit({ event: 'document', generation: ++generation, ready: true, url: request.url });
                emit({ id: request.id, ok: true, data: request.operation === 'evaluate' ? evaluate(request.expression) : {} });
            });
            done();
        },
        final(done) { queueMicrotask(() => child.emit('exit')); done(); },
    });
    const spawn = vi.fn((_binary: string, _args: string[], _options: unknown) => child);
    const create = () => createNativeSpawn({ spawnProcess: spawn })('/native', ['--user-data-dir=/private/profile']);
    const ready = () => emit({ event: 'document', generation: 1, ready: true, url: 'https://music.apple.com/cn/' });
    return { child, commands, spawn, create, ready, emit };
}
const instances: Array<{ disconnect: () => void }> = [];
afterEach(() => { instances.splice(0).forEach(child => child.disconnect()); vi.useRealTimers(); });

const send = (bridge: EventEmitter & Record<string, any>, request: unknown): Promise<any> => new Promise(resolve => {
    bridge.once('message', resolve);
    bridge.send(request, () => {});
});

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
    it.runIf(process.platform === 'darwin' || process.platform === 'win32')('delivers native results through the existing companion client without changing its public API', async () => {
        const f = fixture();
        const client = createCompanionClient({ nativeExecutablePath: '/native', profilePath: '/private/profile', spawnProcess: f.spawn });
        const result = client.request('showWindow');
        expect(await result).toMatchObject({ ok: true });
        client.close();
    });
});
