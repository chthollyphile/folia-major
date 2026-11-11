import { mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOM_FORMAT as CONTRACT_ROOM_FORMAT } from '@/services/sceneSound/acousticsTypes';
import { STEAM_AUDIO_VERSION as FETCHED_VERSION } from '../../../build/fetchSteamAudio.mjs';

// test/unit/sceneAcoustics/acoustics.test.ts
// The scene room sound's Electron side (electron/acoustics/): which library file is loaded, the disk cache
// (one file per key, dropped when format, Steam Audio version or bass cut-off differ, never thrown on a broken
// file), the IR's channel order and delays, the request check, and - where the library is present - one room
// computed for real in both output modes.

const require = createRequire(import.meta.url);
const phonon = require('../../../electron/acoustics/phonon.cjs');
const host = require('../../../electron/acoustics/host.cjs');

const scratch = mkdtempSync(path.join(tmpdir(), 'folia-acoustics-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let dirs = 0;
const freshDir = () => { const dir = path.join(scratch, `d${dirs += 1}`); mkdirSync(dir, { recursive: true }); return dir; };

/** A closed box with inward faces, one material. */
const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const quads = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    return {
        positions: Float32Array.from(v.flat()),
        indices: Uint32Array.from(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])),
        triangleMaterials: new Uint16Array(12),
    };
};
const roomRequest = (output: 'headphones' | 'speakers', key = `room-${output}`) => ({
    key,
    meshes: [box(-5, 5, 0, 5, 0, 20)],
    materials: [{ absorption: [0.3, 0.3, 0.3], scattering: 0.1, transmission: [0, 0, 0] }],
    speakers: [[-3, 3, 0.3], [3, 3, 0.3]],
    listener: { position: [0.5, 1.2, 12], forward: [0, 0, -1], up: [0, 1, 0] },
    output,
    sampleRate: 48000,
});
const someChannels = (length: number) => [0, 1, 2, 3].map(c => Float32Array.from({ length }, (_, i) => Math.sin(i * (c + 1)) / (i + 1)));

describe('versions', () => {
    it('ROOM_FORMAT and the Steam Audio version agree across the two halves and the build script', () => {
        expect(host.ROOM_FORMAT).toBe(CONTRACT_ROOM_FORMAT);
        expect(phonon.STEAM_AUDIO_VERSION).toBe(FETCHED_VERSION);
    });
});

describe('library path', () => {
    const touch = (file: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, ''); return file; };

    it('a packaged app loads resources/steam-audio, a dev run build/steam-audio/<os>-<arch>', () => {
        const root = freshDir();
        const packaged = touch(path.join(root, 'resources', 'steam-audio', 'phonon.dll'));
        const dev = touch(path.join(root, 'app', 'build', 'steam-audio', 'mac-arm64', 'libphonon.dylib'));
        expect(phonon.steamAudioLibraryPath({ packaged: true, resourcesPath: path.join(root, 'resources'), platform: 'win32', arch: 'x64' })).toBe(packaged);
        expect(phonon.steamAudioLibraryPath({ packaged: false, appRoot: path.join(root, 'app'), platform: 'darwin', arch: 'arm64' })).toBe(dev);
    });

    it('null when the file is missing or the platform has no library', () => {
        const root = freshDir();
        expect(phonon.steamAudioLibraryPath({ packaged: false, appRoot: root, platform: 'linux', arch: 'x64' })).toBeNull();
        expect(phonon.steamAudioLibraryPath({ packaged: true, resourcesPath: root, platform: 'freebsd', arch: 'x64' })).toBeNull();
    });
});

describe('cache', () => {
    const request = roomRequest('headphones', 'cinema|seat.r09|headphones|48000');
    const result = { key: request.key, sampleRate: 48000, channels: someChannels(4800) };

    it('reads back what it wrote, sample for sample', async () => {
        const dir = freshDir();
        await host.writeCachedRoom(dir, result, 200);
        const channels = await host.readCachedRoom(dir, request, 200);
        expect(channels).toHaveLength(4);
        channels.forEach((ch: Float32Array, i: number) => expect(Array.from(ch)).toEqual(Array.from(result.channels[i])));
    });

    it('a file for another key, rate or bass cut-off is not this room', () => {
        const bytes = host.encodeRoom(result, 200);
        expect(host.decodeRoom(bytes, request, 200)).not.toBeNull();
        expect(host.decodeRoom(bytes, { ...request, key: 'other' }, 200)).toBeNull();
        expect(host.decodeRoom(bytes, { ...request, sampleRate: 44100 }, 200)).toBeNull();
        expect(host.decodeRoom(bytes, request, 150)).toBeNull();
    });

    it('a file of another format or Steam Audio version is stale', () => {
        const header = (patch: object) => {
            const bytes: Buffer = host.encodeRoom(result, 200);
            const length = bytes.readUInt32LE(0);
            const json = { ...JSON.parse(bytes.toString('utf8', 4, 4 + length)), ...patch };
            const head = Buffer.from(JSON.stringify(json));
            const out = Buffer.alloc(4 + head.length + bytes.length - 4 - length);
            out.writeUInt32LE(head.length, 0);
            head.copy(out, 4);
            bytes.copy(out, 4 + head.length, 4 + length);
            return out;
        };
        expect(host.decodeRoom(header({}), request, 200)).not.toBeNull();
        expect(host.decodeRoom(header({ format: host.ROOM_FORMAT + 1 }), request, 200)).toBeNull();
        expect(host.decodeRoom(header({ steamAudio: '4.7.0' }), request, 200)).toBeNull();
    });

    it('a truncated or garbage file is recomputed, never thrown', async () => {
        const bytes: Buffer = host.encodeRoom(result, 200);
        expect(host.decodeRoom(bytes.subarray(0, bytes.length - 4), request, 200)).toBeNull();
        expect(host.decodeRoom(Buffer.from('not a room at all'), request, 200)).toBeNull();
        expect(host.decodeRoom(Buffer.alloc(2), request, 200)).toBeNull();
        const dir = freshDir();
        writeFileSync(host.cacheFileFor(dir, request.key), 'garbage');
        await expect(host.readCachedRoom(dir, request, 200)).resolves.toBeNull();
        await expect(host.readCachedRoom(freshDir(), request, 200)).resolves.toBeNull();
    });

    it('the key never becomes a path', () => {
        const dir = freshDir();
        const file = host.cacheFileFor(dir, '../../etc/passwd');
        expect(path.dirname(file)).toBe(dir);
        expect(path.basename(file)).toMatch(/^[0-9a-f]{40}\.room$/);
    });

    it('keeps the most recently used rooms', async () => {
        const dir = freshDir();
        for (let i = 0; i < 5; i += 1) {
            const file = path.join(dir, `${i}.room`);
            writeFileSync(file, '');
            utimesSync(file, 1000 + i, 1000 + i);
        }
        await host.pruneCache(dir, 3);
        expect(readdirSync(dir).sort()).toEqual(['2.room', '3.room', '4.room']);
    });
});

describe('IR assembly', () => {
    const impulse = (length: number, at: number, value = 1) => { const x = new Float32Array(length); x[at] = value; return x; };

    it('true-stereo order, each speaker at its own delay, effect latency and the shared delay removed', () => {
        const lead = 256;
        const part = (length: number, at: number, ears: [number, number]) => ears.map(g => impulse(length, at, g));
        const channels = phonon.assembleIR({
            perSpeaker: [
                { dry: part(1024, lead, [1, 0.5]), wet: part(4096, lead + 500, [0.25, 0.125]), delay: 1100 },
                { dry: part(1024, lead, [0.3, 0.9]), wet: part(4096, lead + 700, [0.2, 0.1]), delay: 1000 },
            ],
            lead,
            irSize: 48000,
            sampleRate: 48000,
            bassCutoffHz: 0,
        });
        expect(channels).toHaveLength(4);
        const spikes = channels.map((ch: Float32Array) => Array.from(ch).flatMap((v, i) => (v ? [[i, +v.toFixed(3)]] : [])));
        // [L speaker -> L ear, L -> R ear, R -> L ear, R -> R ear]; the right speaker is the nearer, at sample 0.
        expect(spikes).toEqual([
            [[100, 1], [600, 0.25]],
            [[100, 0.5], [600, 0.125]],
            [[0, 0.3], [700, 0.2]],
            [[0, 0.9], [700, 0.1]],
        ]);
    });

    it('high-passes only the reflections and fades the last 50 ms', () => {
        const flat = (length: number) => new Float32Array(length).fill(1);
        const channels = phonon.assembleIR({
            perSpeaker: [0, 1].map(() => ({ dry: [flat(4800), flat(4800)], wet: [flat(9600), flat(9600)], delay: 0 })),
            lead: 0,
            irSize: 9600,
            sampleRate: 48000,
            bassCutoffHz: 200,
        });
        // A constant through a high-pass dies out: at 0.09 s only the dry part (here up to 4800) would remain.
        expect(channels[0][4000]).toBeGreaterThan(0.99);
        expect(Math.abs(channels[0][4799 + 2400])).toBeLessThan(0.01);
        expect(channels[0][9599]).toBeCloseTo(0, 6);
    });
});

describe('request check', () => {
    it('takes a well-formed room', () => {
        expect(() => phonon.validateRoomRequest(roomRequest('speakers'))).not.toThrow();
    });

    it('refuses what native code would read out of bounds or cannot use', () => {
        const bad = (patch: (r: ReturnType<typeof roomRequest>) => void) => { const r = roomRequest('speakers'); patch(r); return () => phonon.validateRoomRequest(r); };
        expect(bad(r => { r.meshes[0].indices[0] = 8; })).toThrow(/index past/);
        expect(bad(r => { r.meshes[0].triangleMaterials[3] = 1; })).toThrow(/material past/);
        expect(bad(r => { (r as { output: string }).output = 'surround'; })).toThrow(/output/);
        expect(bad(r => { r.speakers.pop(); })).toThrow(/speakers/);
        expect(bad(r => { r.listener.up = [0, 0, -2]; })).toThrow(/parallel/);
        expect(bad(r => { r.materials[0].absorption = [2, 0, 0]; })).toThrow(/material 0/);
        expect(bad(r => { (r.meshes[0] as { positions: unknown }).positions = [0, 0, 0]; })).toThrow(/positions/);
    });
});

describe('host', () => {
    const fakeIpc = () => {
        const handlers = new Map<string, (...args: unknown[]) => unknown>();
        return { handlers, ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) } };
    };
    const trusted = { sender: 'main' };

    it('an untrusted window gets no answer and runs nothing', async () => {
        const { handlers, ipcMain } = fakeIpc();
        host.createAcousticsHost({ ipcMain, isTrusted: (e: typeof trusted) => e.sender === 'main', libraryFile: null, getCacheDir: freshDir });
        expect(await handlers.get('scene-acoustics-available')!({ sender: 'popup' })).toEqual({ ok: false, reason: 'not available to this window' });
        expect(() => handlers.get('scene-acoustics-compute')!({ sender: 'popup' }, roomRequest('speakers'))).toThrow(/Untrusted/);
    });

    it('without the library: available says why and computeRoom rejects with it, a cached room still comes back', async () => {
        const { handlers, ipcMain } = fakeIpc();
        const dir = freshDir();
        host.createAcousticsHost({ ipcMain, isTrusted: () => true, libraryFile: null, getCacheDir: () => dir });
        const answer = await handlers.get('scene-acoustics-available')!(trusted) as { ok: boolean; reason: string };
        expect(answer.ok).toBe(false);
        expect(answer.reason).toMatch(/no Steam Audio library/);
        const request = roomRequest('headphones');
        await expect(handlers.get('scene-acoustics-compute')!(trusted, request)).rejects.toThrow(answer.reason);
        const channels = someChannels(480);
        await host.writeCachedRoom(dir, { key: request.key, sampleRate: 48000, channels }, phonon.DEFAULTS.bassCutoffHz);
        const result = await handlers.get('scene-acoustics-compute')!(trusted, request) as { source: string; channels: Float32Array[]; key: string };
        expect(result.source).toBe('cache');
        expect(result.key).toBe(request.key);
        expect(Array.from(result.channels[3])).toEqual(Array.from(channels[3]));
    });
});

/** The first sample any of these channels is heard at. */
const heardFrom = (channels: Float32Array[]) => Math.min(...channels.map((ch): number => phonon.onsetOf(ch)).filter(i => i >= 0));

const libraryFile = phonon.steamAudioLibraryPath({ packaged: false, appRoot: path.resolve('.') });

describe.skipIf(!libraryFile)('Steam Audio, for real (skipped without build/steam-audio)', () => {
    it('both output modes: the nearer speaker at sample 0, reflections where the direct sound puts them', async () => {
        const settings = { rays: 4096, bounces: 16, duration: 0.5 };
        const offsets: number[] = [];
        for (const output of ['headphones', 'speakers'] as const) {
            const sim = await phonon.simulateSpeakers(libraryFile, roomRequest(output), settings);
            // Wet and dry go through effects with the same latency, so the reflections keep their place.
            offsets.push(heardFrom(sim.perSpeaker.flatMap((s: { wet: Float32Array[] }) => s.wet)) - sim.lead);
            const channels = phonon.assembleIR({ ...sim, sampleRate: 48000 });
            expect(channels.map((ch: Float32Array) => ch.length)).toEqual([24000, 24000, 24000, 24000]);
            // The listener sits right of centre: the right speaker is nearer and starts the IR.
            expect(heardFrom(channels.slice(2))).toBe(0);
            expect(heardFrom(channels.slice(0, 2))).toBeGreaterThan(20);
        }
        expect(Math.abs(offsets[0] - offsets[1])).toBeLessThan(32);
    }, 60_000);
});
