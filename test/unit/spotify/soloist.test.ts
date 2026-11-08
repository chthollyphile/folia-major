import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/soloist.test.ts — Spotify Soloist in the main process (electron/spotify/soloist.cjs)
// and the reading of its build (soloistBuild.cjs). The program is a stand-in: `spawn` starts a real
// WebSocket server on loopback, writes its port where Soloist writes it, and answers the way the
// documented control API does. The tests then drive it as the program would.

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const { createSoloist } = require('../../../electron/spotify/soloist.cjs');
const { describeBuild, createSoloistBuildReader, DAY_MS } = require('../../../electron/spotify/soloistBuild.cjs');

const URI = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
const OTHER = 'spotify:track:7qiZfU4dY1lWllzX7mPBI3';
const KEY = 'sk-test-0123456789';

const folders: string[] = [];
const servers: any[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
        for (const client of server.clients) client.terminate();
        server.close(resolve);
    })));
    folders.splice(0).forEach(made => fs.rmSync(made, { recursive: true, force: true }));
});

const keychain = (available = true) => ({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => (available ? 'dpapi' : 'basic_text'),
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (sealed: Buffer) => sealed.toString().replace(/^sealed:/, ''),
});

const memoryStore = (initial: Record<string, unknown> = {}) => {
    const values = new Map(Object.entries(initial));
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); }, values };
};

/** The program, as its control API behaves: `spawned` holds each start, with what it was told and asked. */
const program = ({ paired = true, exitAtOnce = null as number | null, pairAfterMs = null as number | null, stderr = null as ((key: string) => string) | null } = {}) => {
    const spawned: Array<{ args: string[]; commands: any[]; send: (event: object) => void; proc: any }> = [];
    const spawn = vi.fn((_file: string, args: string[]) => {
        const proc: any = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.exitCode = null;
        proc.signalCode = null;
        proc.pid = 4321;
        const run = { args, commands: [] as any[], send: (_event: object) => { }, proc };
        spawned.push(run);
        proc.kill = vi.fn(() => {
            if (proc.exitCode !== null) return;
            proc.exitCode = 0;
            setImmediate(() => proc.emit('exit', 0));
        });
        if (exitAtOnce !== null) {
            setImmediate(() => {
                proc.exitCode = exitAtOnce;
                const key = args[args.indexOf('-k') + 1];
                if (stderr) {
                    // Said in two pieces, cut inside the key.
                    const text = stderr(key);
                    const cut = text.indexOf(key) + 5;
                    proc.stderr.emit('data', text.slice(0, cut));
                    proc.stderr.emit('data', text.slice(cut));
                } else {
                    proc.stderr.emit('data', `could not start, key was ${key}`);
                }
                proc.emit('exit', exitAtOnce);
            });
            return proc;
        }
        const dataDir = args[args.indexOf('-D') + 1];
        const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        servers.push(server);
        server.on('listening', () => fs.writeFileSync(path.join(dataDir, 'ws.port'), String(server.address().port)));
        server.on('connection', (socket: any) => {
            run.send = event => socket.send(JSON.stringify(event));
            socket.on('message', (raw: Buffer) => run.commands.push(JSON.parse(String(raw))));
            run.send({ type: 'auth_state', logged_in: pairAfterMs === null ? paired : false, is_active: false, device_name: 'Folia' });
            if (pairAfterMs !== null) setTimeout(() => run.send({ type: 'auth_state', logged_in: true, is_active: false, device_name: 'Folia' }), pairAfterMs);
        });
        return proc;
    });
    return { spawn, spawned };
};

const VALID_BUILD = { path: '/opt/soloist', state: 'valid', version: '1.0.0', builtAt: Date.now() - 10 * DAY_MS, expiresAt: Date.now() + 80 * DAY_MS, daysLeft: 80 };

const setup = ({
    paired = true, exitAtOnce = null as number | null, executable = '/opt/soloist' as string | null, sealed = true, available = true, build = VALID_BUILD as any,
    pairAfterMs = null as number | null, stderr = null as ((key: string) => string) | null,
} = {}) => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-soloist-'));
    folders.push(data);
    const store = memoryStore({ SPOTIFY_SOLOIST_V1: { executable, sealedKey: sealed ? Buffer.from(`sealed:${KEY}`).toString('base64') : null } });
    const fake = program({ paired, exitAtOnce, pairAfterMs, stderr });
    const logs: string[] = [];
    const soloist = createSoloist({
        store,
        safeStorage: keychain(available),
        dataDirectory: () => path.join(data, 'data'),
        cacheDirectory: () => path.join(data, 'cache'),
        chooseFile: vi.fn(async () => '/downloads/soloist'),
        spawn: fake.spawn,
        readBuild: vi.fn(async (file: string) => ({ ...build, path: file })),
        wait: (ms: number) => new Promise(resolve => { setTimeout(resolve, Math.min(ms, 20)); }),
        log: (line: string) => logs.push(line),
        warn: (line: string) => logs.push(line),
        onProcessExit: (stop: () => void) => { exitStops.push(stop); },
        signInWaitMs: 400,
    });
    return { soloist, store, ...fake, logs, data, exitStops };
};
// What each Soloist made in a test would stop when the process ends.
const exitStops: Array<() => void> = [];

/** Lets the stand-in's messages arrive. */
const settle = (ms = 30) => new Promise(resolve => { setTimeout(resolve, ms); });

/** Plays URI and answers it as the program would. */
const playing = async (soloist: any, spawned: any[], options: { startMs?: number; durationMs?: number } = {}) => {
    const started = soloist.play({ uri: URI, ...options });
    for (let tries = 0; tries < 100 && !spawned[0]?.commands.some((command: any) => command.command === 'play'); tries += 1) await settle(10);
    const run = spawned[0];
    run.send({ type: 'track_changed', item: { uri: URI, duration_ms: options.durationMs ?? 200_000 } });
    run.send({ type: 'playback_state', status: 'playing', item: { uri: URI, duration_ms: options.durationMs ?? 200_000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
    await started;
    return run;
};

describe('soloistBuild', () => {
    const at = Date.UTC(2026, 9, 1);
    const seconds = Math.floor(at / 1000);

    it('reads the build time next to "build" and counts the 90 days from it', () => {
        expect(describeBuild(`soloist 1.4.2 build ${seconds} linux x86_64`, at + 10 * DAY_MS)).toMatchObject({
            state: 'valid', version: '1.4.2', builtAt: at, expiresAt: at + 90 * DAY_MS, daysLeft: 80,
        });
    });

    it('warns from 14 days before the end, and is expired at it', () => {
        expect(describeBuild(`soloist 1.0 build ${seconds}`, at + 76 * DAY_MS)).toMatchObject({ state: 'expiring', daysLeft: 14 });
        expect(describeBuild(`soloist 1.0 build ${seconds}`, at + 75 * DAY_MS)).toMatchObject({ state: 'valid', daysLeft: 15 });
        expect(describeBuild(`soloist 1.0 build ${seconds}`, at + 90 * DAY_MS)).toMatchObject({ state: 'expired', daysLeft: 0 });
    });

    it('reads an ISO date, says when nothing can be read, and distrusts a clock behind the build', () => {
        expect(describeBuild('Spotify Soloist 2.0.0 (built 2026-10-01T00:00:00Z)', at + DAY_MS)).toMatchObject({ state: 'valid', builtAt: at, version: '2.0.0' });
        expect(describeBuild('soloist 2.0.0', at)).toMatchObject({ state: 'unknown', version: '2.0.0', daysLeft: null });
        expect(describeBuild(`soloist 1.0 build ${seconds}`, at - 3 * DAY_MS)).toMatchObject({ state: 'clock' });
    });

    it('tells a missing file, a program that is not Soloist, and the exit code of an expired build', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-soloist-build-'));
        folders.push(dir);
        const file = path.join(dir, 'soloist');
        fs.writeFileSync(file, 'binary');
        const run = vi.fn(async () => ({ code: 0, failed: false, output: `soloist 1.0 build ${seconds}` }));
        const read = createSoloistBuildReader({ run, now: () => at + DAY_MS });
        await expect(read(path.join(dir, 'nothing'))).resolves.toMatchObject({ state: 'missing' });
        await expect(read(file)).resolves.toMatchObject({ state: 'valid', version: '1.0' });
        await read(file);
        expect(run).toHaveBeenCalledTimes(1);

        const notSoloist = createSoloistBuildReader({ run: async () => ({ code: 0, failed: false, output: 'ffmpeg version 7' }) });
        await expect(notSoloist(file)).resolves.toMatchObject({ state: 'invalid' });
        const expired = createSoloistBuildReader({ run: async () => ({ code: 10, failed: true, output: 'build expired' }) });
        await expect(expired(file)).resolves.toMatchObject({ state: 'expired', daysLeft: 0 });
    });
});

describe('soloist', () => {
    it('is not started before it is wanted, and says what is missing', async () => {
        const { soloist, spawn } = setup({ executable: null, sealed: false });
        await expect(soloist.state({ start: true })).resolves.toMatchObject({ executable: null, key: 'missing', running: false, paired: false });
        await expect(soloist.play({ uri: URI })).rejects.toMatchObject({ code: 'unavailable', reason: 'soloist-program' });
        expect(spawn).not.toHaveBeenCalled();
    });

    it('keeps the key sealed, never in the clear, and refuses one it cannot seal or that is no key', async () => {
        const { soloist, store } = setup({ sealed: false });
        await expect(soloist.saveKey('has a space')).resolves.toEqual({ saved: false, why: 'shape' });
        await expect(soloist.saveKey(KEY)).resolves.toEqual({ saved: true });
        expect(JSON.stringify([...store.values])).not.toContain(KEY);
        await expect(soloist.state()).resolves.toMatchObject({ key: 'saved' });

        const locked = setup({ sealed: false, available: false });
        await expect(locked.soloist.saveKey(KEY)).resolves.toEqual({ saved: false, why: 'keychain' });
    });

    it('starts on a port the system picks, plays one track with repeat off, and seeks only after it plays', async () => {
        const { soloist, spawned, logs } = setup();
        const run = await playing(soloist, spawned, { startMs: 42_000 });
        expect(run.args).toEqual(expect.arrayContaining(['-n', 'Folia', '-k', KEY, '-w', '127.0.0.1:0']));
        await settle();
        expect(run.commands.map((command: any) => command.command)).toEqual(['set_repeat_track', 'set_repeat_context', 'play', 'seek']);
        expect(run.commands[2]).toMatchObject({ type: 'command', command: 'play', uri: URI });
        expect(run.commands[3]).toMatchObject({ position_ms: 42_000 });
        expect(logs.join('\n')).not.toContain(KEY);
        await soloist.shutdown();
    });

    it('says the program is not paired instead of playing', async () => {
        const { soloist } = setup({ paired: false });
        await expect(soloist.play({ uri: URI })).rejects.toMatchObject({ reason: 'soloist-unpaired' });
        await expect(soloist.state()).resolves.toMatchObject({ running: true, paired: false });
        await soloist.shutdown();
    });

    it('follows the position between events while it plays', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned);
        run.send({ type: 'position_sync', position: { position_ms: 30_000, timestamp_ms: Date.now() - 2000, speed: 1 } });
        await settle();
        const status = soloist.status();
        expect(status).toMatchObject({ uri: URI, status: 'playing', ended: false, durationMs: 200_000 });
        expect(status.positionMs).toBeGreaterThanOrEqual(31_900);
        expect(status.positionMs).toBeLessThan(33_000);
        await soloist.shutdown();
    });

    it('ends the track when the program goes on to its own next one at the end, and pauses that one', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_000, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        run.send({ type: 'track_changed', item: { uri: OTHER, duration_ms: 180_000 } });
        await settle();
        expect(soloist.status()).toMatchObject({ uri: URI, ended: true, positionMs: 200_000 });
        expect(run.commands.at(-1)).toMatchObject({ command: 'pause' });
        await soloist.shutdown();
    });

    it('puts the track back when a seek or a resume finds the program on another one, in the order asked', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_000, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        run.send({ type: 'track_changed', item: { uri: OTHER, duration_ms: 180_000 } });
        await settle();
        expect(soloist.status()).toMatchObject({ ended: true });
        run.commands.length = 0;

        // The bar is dragged back on the ended song, and play is pressed at once.
        const seeking = soloist.seek(50_000);
        const resuming = soloist.resume();
        for (let tries = 0; tries < 50 && !run.commands.some((command: any) => command.command === 'play'); tries += 1) await settle(10);
        run.send({ type: 'playback_state', status: 'playing', item: { uri: URI, duration_ms: 200_000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await seeking;
        await resuming;
        await settle();
        expect(run.commands.map((command: any) => [command.command, command.uri ?? command.position_ms])).toEqual([
            ['set_repeat_track', undefined], ['set_repeat_context', undefined], ['play', URI], ['seek', 50_000], ['pause', undefined], ['play', undefined],
        ]);
        expect(soloist.status()).toMatchObject({ uri: URI, ended: false });
        await soloist.shutdown();
    });

    it('has nothing to pause where the program does not run', async () => {
        const { soloist, spawn } = setup();
        await expect(soloist.pause()).resolves.toBeUndefined();
        expect(spawn).not.toHaveBeenCalled();
    });

    it('does not take the next track for ended because the one before stopped at its end', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_500, timestamp_ms: Date.now(), speed: 1 } });
        run.send({ type: 'playback_changed', status: 'idle' });
        await settle();
        expect(soloist.status()).toMatchObject({ ended: true });

        // The queue goes on with a shorter track; the program names it before it says it plays it.
        const next = soloist.play({ uri: OTHER, durationMs: 180_000 });
        for (let tries = 0; tries < 50 && run.commands.filter((command: any) => command.command === 'play').length < 2; tries += 1) await settle(10);
        run.send({ type: 'track_changed', item: { uri: OTHER, duration_ms: 180_000 } });
        await settle();
        expect(soloist.status()).toMatchObject({ uri: OTHER, ended: false });
        run.send({ type: 'playback_state', status: 'playing', item: { uri: OTHER, duration_ms: 180_000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await next;
        expect(soloist.status()).toMatchObject({ uri: OTHER, ended: false });
        await soloist.shutdown();
    });

    it('plays the same track again from its start, not as ended', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_500, timestamp_ms: Date.now(), speed: 1 } });
        run.send({ type: 'playback_changed', status: 'idle' });
        await settle();
        const again = soloist.play({ uri: URI, durationMs: 200_000 });
        await settle();
        expect(soloist.status()).toMatchObject({ ended: false });
        run.send({ type: 'playback_state', status: 'playing', item: { uri: URI, duration_ms: 200_000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await again;
        expect(soloist.status()).toMatchObject({ ended: false });
        expect(soloist.status().positionMs).toBeLessThan(1000);
        await soloist.shutdown();
    });

    it('moves on again after a pause or a buffering stop without a new position', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned);
        run.send({ type: 'position_sync', position: { position_ms: 40_000, timestamp_ms: Date.now(), speed: 1 } });
        run.send({ type: 'playback_changed', status: 'buffering' });
        await settle();
        const held = soloist.status().positionMs;
        run.send({ type: 'playback_changed', status: 'playing' });
        await settle(300);
        expect(soloist.status().positionMs).toBeGreaterThan(held + 200);
        await soloist.shutdown();
    });

    it('does not take a pause the listener asked for near the end for an end', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 198_800, timestamp_ms: Date.now(), speed: 1 } });
        await soloist.pause();
        run.send({ type: 'playback_changed', status: 'paused' });
        await settle();
        expect(soloist.status()).toMatchObject({ ended: false, status: 'paused' });
        await soloist.shutdown();
    });

    it('drops a play that a newer one replaced while it waited its turn', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned);
        run.commands.length = 0;
        const third = 'spotify:track:1111111111111111111111';
        const skipped = soloist.play({ uri: OTHER });
        const last = soloist.play({ uri: third });
        for (let tries = 0; tries < 50 && !run.commands.some((command: any) => command.command === 'play'); tries += 1) await settle(10);
        run.send({ type: 'playback_state', status: 'playing', item: { uri: third, duration_ms: 1000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await Promise.all([skipped, last]);
        expect(run.commands.filter((command: any) => command.command === 'play').map((command: any) => command.uri)).toEqual([third]);
        await soloist.shutdown();
    });

    it('waits a moment for a program just started to sign in with its stored pairing', async () => {
        const { soloist, spawned } = setup({ pairAfterMs: 150 });
        const run = await playing(soloist, spawned);
        expect(run.commands.some((command: any) => command.command === 'play')).toBe(true);
        await soloist.shutdown();
    });

    it('ends the track when the program goes back to its start at the end and stops there', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_000, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        run.send({ type: 'playback_state', status: 'paused', item: { uri: URI, duration_ms: 200_000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        expect(soloist.status()).toMatchObject({ uri: URI, ended: true });

        const again = setup();
        const second = await playing(again.soloist, again.spawned, { durationMs: 200_000 });
        second.send({ type: 'position_sync', position: { position_ms: 199_000, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        second.send({ type: 'position_sync', position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        second.send({ type: 'playback_changed', status: 'paused' });
        await settle();
        expect(again.soloist.status()).toMatchObject({ ended: true });
        await soloist.shutdown();
        await again.soloist.shutdown();
    });

    it('does not take a seek back to the start near the end for an end', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_000, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        await soloist.seek(0);
        run.send({ type: 'position_sync', position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        expect(soloist.status()).toMatchObject({ ended: false });
        await soloist.shutdown();
    });

    it('does not fail a play for a refusal of another command when the play takes', async () => {
        const { soloist, spawned } = setup();
        const started = soloist.play({ uri: URI });
        for (let tries = 0; tries < 100 && !spawned[0]?.commands.some((command: any) => command.command === 'play'); tries += 1) await settle(10);
        const run = spawned[0];
        run.send({ type: 'error', message: 'repeat cannot be set with nothing loaded' });
        await settle();
        run.send({ type: 'playback_state', status: 'playing', item: { uri: URI, duration_ms: 200_000 }, position: { position_ms: 0, timestamp_ms: Date.now(), speed: 1 } });
        await expect(started).resolves.toBeUndefined();
        await soloist.shutdown();
    });

    it('fails a play the program refuses and does not then play', async () => {
        const { soloist, spawned } = setup();
        const started = soloist.play({ uri: URI });
        for (let tries = 0; tries < 100 && !spawned[0]?.commands.some((command: any) => command.command === 'play'); tries += 1) await settle(10);
        spawned[0].send({ type: 'error', message: 'track unavailable' });
        await expect(started).rejects.toMatchObject({ reason: 'soloist-refused' });
        await soloist.shutdown();
    });

    it('leaves no part of the key in the log, wherever the program cuts what it says', async () => {
        const { soloist, logs } = setup({ exitAtOnce: 1, stderr: key => `${'x'.repeat(590)}key=${key}${'y'.repeat(590)}` });
        await expect(soloist.play({ uri: URI })).rejects.toMatchObject({ reason: 'soloist-start' });
        const said = logs.join('\n');
        expect(said).not.toContain(KEY.slice(-8));
        expect(said).not.toContain(KEY.slice(0, 8));
    });

    it('does not take a track changed in another app mid-track for an end', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 60_000, timestamp_ms: Date.now(), speed: 1 } });
        await settle();
        run.send({ type: 'track_changed', item: { uri: OTHER, duration_ms: 180_000 } });
        await settle();
        expect(soloist.status()).toMatchObject({ uri: OTHER, ended: false });
        await soloist.shutdown();
    });

    it('ends the track when the program stops at its end', async () => {
        const { soloist, spawned } = setup();
        const run = await playing(soloist, spawned, { durationMs: 200_000 });
        run.send({ type: 'position_sync', position: { position_ms: 199_500, timestamp_ms: Date.now(), speed: 1 } });
        run.send({ type: 'playback_changed', status: 'idle' });
        await settle();
        expect(soloist.status()).toMatchObject({ ended: true });
        await soloist.shutdown();
    });

    it('says an expired build and leaves the key out of what it logs of the failure', async () => {
        const { soloist, logs } = setup({ exitAtOnce: 10 });
        await expect(soloist.play({ uri: URI })).rejects.toMatchObject({ reason: 'soloist-expired' });
        await expect(soloist.state()).resolves.toMatchObject({ running: false, error: 'expired' });
        expect(logs.join('\n')).toContain('<key>');
        expect(logs.join('\n')).not.toContain(KEY);
    });

    it('uses a program an earlier run left running, and stops it by the process id Folia wrote', async () => {
        const first = setup();
        await playing(first.soloist, first.spawned);
        const dataDir = path.join(first.data, 'data');
        expect(fs.readFileSync(path.join(dataDir, 'folia-soloist.pid'), 'utf8')).toBe('4321');
        const spawn = vi.fn();
        let alive = true;
        const killPid = vi.fn((_pid: number) => { alive = false; });
        const again = createSoloist({
            store: first.store,
            safeStorage: keychain(),
            dataDirectory: () => dataDir,
            cacheDirectory: () => path.join(first.data, 'cache'),
            chooseFile: async () => null,
            spawn,
            readBuild: async () => VALID_BUILD,
            log: () => { },
            warn: () => { },
            onProcessExit: () => { },
            isAlive: () => alive,
            killPid,
        });
        await expect(again.state({ start: false })).resolves.toMatchObject({ running: false });
        await again.restart();
        expect(spawn).not.toHaveBeenCalled();
        await expect(again.state()).resolves.toMatchObject({ running: true, paired: true });
        await again.setVolume(40);
        await settle();
        expect(first.spawned[0].commands.at(-1)).toMatchObject({ command: 'set_volume', volume: 40 });

        // A new key is to be used: the program taken over is stopped, and its address forgotten.
        await again.saveKey('sk-another-key-42');
        expect(killPid).toHaveBeenCalledWith(4321);
        expect(fs.existsSync(path.join(dataDir, 'ws.port'))).toBe(false);
        await first.soloist.shutdown();
    });

    it('forgets the process id of a program it took over once that program goes away', async () => {
        const first = setup();
        await playing(first.soloist, first.spawned);
        const dataDir = path.join(first.data, 'data');
        const killPid = vi.fn();
        const again = createSoloist({
            store: first.store, safeStorage: keychain(), dataDirectory: () => dataDir, cacheDirectory: () => path.join(first.data, 'cache'),
            chooseFile: async () => null, spawn: vi.fn(), readBuild: async () => VALID_BUILD, log: () => { }, warn: () => { },
            onProcessExit: () => { }, isAlive: () => false, killPid,
        });
        await again.restart();
        await expect(again.state()).resolves.toMatchObject({ running: true });
        // The program taken over goes away (it crashed, or it was ended by hand).
        for (const server of servers) for (const client of server.clients) client.terminate();
        await settle(50);
        await expect(again.state()).resolves.toMatchObject({ running: false });
        expect(again.shutdown()).toBeNull();
        expect(killPid).not.toHaveBeenCalled();
        await first.soloist.shutdown();
    });

    it('stops what it started when the process ends without quitting', async () => {
        const { soloist, spawned, exitStops: stops } = setup();
        await playing(soloist, spawned);
        stops.at(-1)!();
        expect(spawned[0].proc.kill).toHaveBeenCalled();
        await soloist.shutdown();
    });

    it('does not wait for a start under way when the app quits', async () => {
        const { soloist, spawned } = setup();
        const starting = soloist.play({ uri: URI }).catch((error: any) => error);
        for (let tries = 0; tries < 50 && !spawned[0]; tries += 1) await settle(5);
        const quitAt = Date.now();
        await soloist.shutdown();
        expect(Date.now() - quitAt).toBeLessThan(1000);
        expect(spawned[0].proc.kill).toHaveBeenCalled();
        await starting;
    });

    it('stops the program when the app quits', async () => {
        const { soloist, spawned } = setup();
        await playing(soloist, spawned);
        expect(soloist.shutdown()).not.toBeNull();
        await settle();
        expect(spawned[0].proc.kill).toHaveBeenCalled();
        expect(soloist.shutdown()).toBeNull();
    });

    it('keeps a program it picked only when it runs', async () => {
        const { soloist, store } = setup({ executable: null, build: { state: 'invalid', version: null } });
        await expect(soloist.pickExecutable()).resolves.toMatchObject({ picked: false, executable: { state: 'invalid' } });
        expect((store.get('SPOTIFY_SOLOIST_V1') as any).executable).toBeNull();
        const good = setup({ executable: null });
        await expect(good.soloist.pickExecutable()).resolves.toMatchObject({ picked: true });
        expect((good.store.get('SPOTIFY_SOLOIST_V1') as any).executable).toBe('/downloads/soloist');
    });
});
