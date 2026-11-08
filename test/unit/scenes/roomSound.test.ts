import { describe, expect, it, vi } from 'vitest';
import { ACOUSTIC_MATERIALS, flattenAcoustics, GENERIC_MATERIAL } from '@/services/sceneSound/acousticMaterials';
import type { RoomRequest, RoomResult, SceneAcousticsApi } from '@/services/sceneSound/acousticsTypes';
import { loudnessGain, roomRequestKey } from '@/services/sceneSound/roomIr';
import { createRoomStage, ROOM_SWAP_SECONDS, ROOM_TOGGLE_SECONDS, type RoomIr, type RoomSlot, type RoomStage } from '@/services/sceneSound/roomStage';
import { createRoomSound } from '@/services/sceneSound/sceneSound';

// test/unit/scenes/roomSound.test.ts
// The room sound's logic the user cannot see: the loudness gain, the cache key,
// material flattening, the swap and fade schedule of the room stage, and that with the room off the playback
// graph has exactly the edges it had before. Fake audio nodes and a fake acoustics api; no audio is rendered.

const RATE = 48_000;
const impulse = (length: number, at = 0, value = 1) => {
    const out = new Float32Array(length);
    out[at] = value;
    return out;
};
const db = (gain: number) => 20 * Math.log10(gain);

describe('loudnessGain', () => {
    const zero = new Float32Array(4800);
    it('is 1 for an IR that passes each input straight to its own ear, delayed or not', () => {
        expect(db(loudnessGain([impulse(4800), zero, zero, impulse(4800)], RATE))).toBeCloseTo(0, 2);
        expect(db(loudnessGain([impulse(4800, 300), zero, zero, impulse(4800, 300)], RATE))).toBeCloseTo(0, 2);
    });
    it('makes up what a quieter IR loses', () => {
        expect(loudnessGain([impulse(4800, 0, 0.5), zero, zero, impulse(4800, 0, 0.5)], RATE)).toBeCloseTo(2, 3);
    });
    it('adds the inputs by energy, as independent left and right noise does', () => {
        const all = [impulse(4800), impulse(4800), impulse(4800), impulse(4800)];
        expect(loudnessGain(all, RATE)).toBeCloseTo(Math.SQRT1_2, 3);
    });
});

const requestOf = (overrides: Partial<Omit<RoomRequest, 'key'>> = {}): Omit<RoomRequest, 'key'> => ({
    meshes: [{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]), triangleMaterials: Uint16Array.from([0]) }],
    materials: [{ absorption: [0.1, 0.2, 0.3], scattering: 0.05, transmission: [0.1, 0.05, 0.03] }],
    speakers: [[-6, 6, 0.3], [6, 6, 0.3]],
    listener: { position: [0.28, 2, 15], forward: [0, 0, -1], up: [0, 1, 0] },
    output: 'headphones',
    sampleRate: RATE,
    ...overrides,
});

describe('roomRequestKey', () => {
    it('is the same for the same contents in new arrays, and differs when anything that shapes the IR does', async () => {
        const key = await roomRequestKey(requestOf());
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        expect(await roomRequestKey(requestOf())).toBe(key);
        expect(await roomRequestKey(requestOf({ output: 'speakers' }))).not.toBe(key);
        expect(await roomRequestKey(requestOf({ listener: { position: [0.28, 2, 15.01], forward: [0, 0, -1], up: [0, 1, 0] } }))).not.toBe(key);
        expect(await roomRequestKey(requestOf({ sampleRate: 44_100 }))).not.toBe(key);
        const moved = requestOf();
        moved.meshes[0].positions[4] = 0.5;
        expect(await roomRequestKey(moved)).not.toBe(key);
    });
});

describe('flattenAcoustics', () => {
    it('makes one table across meshes and points each triangle into it; unknown ids become generic', () => {
        const mesh = (materials: string[], triangles: number[]) => ({
            positions: new Float32Array(9), indices: new Uint32Array(3), triangleMaterials: Uint16Array.from(triangles), materials,
        });
        const flat = flattenAcoustics({ meshes: [mesh(['carpet', 'wood'], [1, 0, 1]), mesh(['wood', 'marshmallow'], [0, 1, 7])] });
        // carpet, wood, generic
        expect(flat.materials).toHaveLength(3);
        expect(flat.materials[2]).toBe(ACOUSTIC_MATERIALS[GENERIC_MATERIAL]);
        expect(flat.meshes[0].triangleMaterials).toEqual(Uint16Array.from([1, 0, 1]));
        expect(flat.meshes[1].triangleMaterials).toEqual(Uint16Array.from([1, 2, 2]));
        expect(flat.unknown).toEqual(['marshmallow']);
    });
});

// ---------------------------------------------------------------- fake audio graph and clock

type Edge = [FakeNode, FakeNode];
interface FakeNode { kind: string; connect(to: FakeNode): FakeNode; disconnect(to?: FakeNode): void; [key: string]: unknown }

const createFakeAudio = () => {
    let now = 0;
    const tasks: { at: number; fn: () => void }[] = [];
    const edges: Edge[] = [];
    const ramps: { node: FakeNode; target: number; at: number; until: number }[] = [];
    const node = (kind: string, extra: Record<string, unknown> = {}): FakeNode => {
        const self: FakeNode = {
            kind,
            ...extra,
            connect: (to) => { edges.push([self, to]); return to; },
            disconnect: (to) => {
                for (let i = edges.length - 1; i >= 0; i -= 1) if (edges[i][0] === self && (!to || edges[i][1] === to)) edges.splice(i, 1);
            },
        };
        return self;
    };
    const param = (owner: () => FakeNode, value = 1) => {
        const self = {
            value,
            cancelScheduledValues: vi.fn(),
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: (target: number, until: number) => {
                ramps.push({ node: owner(), target, at: now, until });
                self.value = target;
            },
        };
        return self;
    };
    const gain = () => {
        const self: FakeNode = node('gain');
        self.gain = param(() => self);
        return self;
    };
    const context = {
        sampleRate: RATE,
        get currentTime() { return now; },
        createGain: gain,
        createConvolver: () => node('convolver', { buffer: null, normalize: true }),
        createDynamicsCompressor: () => node('limiter', { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }),
        createBuffer: (channels: number, length: number, rate: number) => ({ numberOfChannels: channels, length, duration: length / rate, copyToChannel: vi.fn() }),
    };
    const timers = {
        set: (fn: () => void, ms: number) => { const task = { at: now + ms / 1000, fn }; tasks.push(task); return task; },
        clear: (task: unknown) => { const at = tasks.indexOf(task as never); if (at >= 0) tasks.splice(at, 1); },
    };
    /** Runs every timer due within `seconds`, in order, moving the clock. */
    const advance = (seconds: number) => {
        const end = now + seconds;
        for (;;) {
            const next = tasks.filter(task => task.at <= end + 1e-9).sort((a, b) => a.at - b.at)[0];
            if (!next) break;
            tasks.splice(tasks.indexOf(next), 1);
            now = Math.max(now, next.at);
            next.fn();
        }
        now = end;
    };
    const from = gain();
    const to = gain();
    from.connect(to); // fade -> volume, as the playback graph wires them
    const slot = { context, from, to } as unknown as RoomSlot;
    return { context, edges, ramps, timers, advance, slot, from, to };
};

/** A 2-second IR (as the acoustics process makes them). */
const irOf = (gain = 1): RoomIr => ({ channels: [impulse(2 * RATE), new Float32Array(2 * RATE), new Float32Array(2 * RATE), impulse(2 * RATE)], sampleRate: RATE, gain });
const convolvers = (edges: Edge[]) => [...new Set(edges.map(([a]) => a).filter(n => n.kind === 'convolver'))];
const laneGainOf = (edges: Edge[], convolver: FakeNode) => edges.find(([a]) => a === convolver)![1];

describe('room stage', () => {
    it('lets a new IR hear one IR length of music before fading to it, then crossfades lanes linearly', () => {
        const audio = createFakeAudio();
        const stage = createRoomStage(audio.slot, audio.timers);
        const first = irOf(4);
        stage.play(first);
        const [laneA, laneB] = convolvers(audio.edges);
        expect(laneA.buffer).not.toBeNull();
        expect(audio.ramps).toHaveLength(0);
        audio.advance(1.99);
        expect(audio.ramps).toHaveLength(0);
        audio.advance(0.02);
        const gainA = laneGainOf(audio.edges, laneA);
        expect(audio.ramps.find(r => r.node === gainA)).toMatchObject({ target: 4 });
        // The limiter's make-up undone before it, as a fixed gain; turning on ramps the room up after the limiter
        // (so a toggle only blends dry with limited wet) and cancels the dry, over the toggle time.
        const limiter = audio.edges.find(([, b]) => b.kind === 'limiter')!;
        expect((limiter[0].gain as { value: number }).value).toBeCloseTo(10 ** (-0.57 / 20), 4);
        const level = audio.edges.find(([a]) => a.kind === 'limiter')![1];
        const toggles = audio.ramps.filter(r => r.node !== gainA);
        expect(toggles).toHaveLength(2);
        expect(toggles.map(r => r.target)).toContain(-1);
        expect(toggles.find(r => r.target !== -1)).toMatchObject({ node: level, target: 1 });
        toggles.forEach(r => expect(r.until - r.at).toBeCloseTo(ROOM_TOGGLE_SECONDS, 6));

        // The next seat, once that fade is done: into the idle lane, faded to after its IR length.
        audio.advance(0.2);
        audio.ramps.length = 0;
        stage.play(irOf(4));
        expect(laneB.buffer).not.toBeNull();
        audio.advance(2.01);
        const gainB = laneGainOf(audio.edges, laneB);
        expect(audio.ramps.find(r => r.node === gainA)).toMatchObject({ target: 0 });
        expect(audio.ramps.find(r => r.node === gainB)).toMatchObject({ target: 4 });
        audio.ramps.forEach(r => expect(r.until - r.at).toBeCloseTo(ROOM_SWAP_SECONDS, 6));

        // A third IR during that crossfade waits until lane A is silent before loading it.
        const bufferBefore = laneA.buffer;
        stage.play(irOf(4));
        expect(laneA.buffer).toBe(bufferBefore);
        audio.advance(ROOM_SWAP_SECONDS);
        expect(laneA.buffer).not.toBe(bufferBefore);
        stage.dispose();
    });

    it('turns back on without reloading when the same IR is asked for again', () => {
        const audio = createFakeAudio();
        const stage = createRoomStage(audio.slot, audio.timers);
        const ir = irOf(2);
        stage.play(ir);
        audio.advance(2.01);
        stage.stop();
        audio.advance(0.1);
        const [laneA] = convolvers(audio.edges);
        const buffer = laneA.buffer;
        audio.ramps.length = 0;
        stage.play(ir);
        expect(laneA.buffer).toBe(buffer);
        expect(audio.ramps.map(r => r.target)).toContain(-1);
        audio.advance(5);
        expect(convolvers(audio.edges)).toHaveLength(2);
        stage.dispose();
    });

    it('leaves the graph with exactly the edges it had once the room is off', () => {
        const audio = createFakeAudio();
        const before = [...audio.edges];
        const stage = createRoomStage(audio.slot, audio.timers);
        stage.play(irOf());
        audio.advance(2.01);
        expect(audio.edges.length).toBeGreaterThan(before.length);
        stage.stop();
        audio.advance(ROOM_TOGGLE_SECONDS - 0.01);
        expect(audio.edges.length).toBeGreaterThan(before.length); // still fading out
        audio.advance(0.2);
        expect(audio.edges).toEqual(before);
        expect(audio.edges).toEqual([[audio.from, audio.to]]);
    });
});

// ---------------------------------------------------------------- the scene's ctx.sound

const seats = [
    { id: 'R10-7', ear: [0.28, 3.5, 15] as const, lookAt: [0, 4.7, 0] as const, preferred: true },
    { id: 'R2-7', ear: [0.28, 1.2, 6.6] as const, lookAt: [0, 4.7, 0] as const },
];
const speakers = [{ id: 'L', position: [-6.3, 6.4, 0.3] as const }, { id: 'R', position: [6.3, 6.4, 0.3] as const }];
const world = { meshes: [{ positions: new Float32Array(9), indices: Uint32Array.from([0, 1, 2]), triangleMaterials: Uint16Array.from([0]), materials: ['carpet'] }] };

const fakeApi = (ok = true) => {
    const requests: RoomRequest[] = [];
    const api: SceneAcousticsApi = {
        available: vi.fn(async () => ({ ok, reason: ok ? undefined : 'no library' })),
        computeRoom: vi.fn(async (request: RoomRequest): Promise<RoomResult> => {
            requests.push(request);
            // The front seat's IR is twice as loud as the default seat's.
            const level = request.listener.position[2] < 10 ? 0.2 : 0.1;
            const channels = [impulse(4800, 0, level), new Float32Array(4800), new Float32Array(4800), impulse(4800, 0, level)] as RoomResult['channels'];
            return { key: request.key, sampleRate: request.sampleRate, channels, source: requests.length > 2 ? 'cache' : 'computed', ms: 5 };
        }),
    };
    return { api, requests };
};
const fakeStage = () => {
    const played: RoomIr[] = [];
    const stage: RoomStage & { stopped: number } = { stopped: 0, play: ir => { played.push(ir); }, stop: () => { stage.stopped += 1; }, dispose: () => {} };
    return { stage, played };
};
const settle = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
};

describe('room sound', () => {
    const make = (ok = true) => {
        const { api, requests } = fakeApi(ok);
        const { stage, played } = fakeStage();
        const slot = { context: { sampleRate: RATE } } as unknown as RoomSlot;
        const sound = createRoomSound({ anchors: { viewpoints: () => seats, speakers: () => speakers }, api, getSlot: () => slot, onSlot: () => () => {}, createStage: () => stage });
        return { sound, api, requests, stage, played };
    };

    it('takes the gain from the default seat and keeps the chosen seat physically louder', async () => {
        const { sound, requests, played } = make();
        sound.setOptions({ enabled: true, output: 'speakers' });
        sound.setListener({ viewpoint: 'R2-7' });
        sound.setAcoustics(world);
        await vi.waitFor(() => expect(played).toHaveLength(1));
        expect(requests).toHaveLength(2);
        expect(requests[0].listener.position).toEqual([0.28, 3.5, 15]); // default seat first, for the gain
        expect(requests[1].listener.position).toEqual([0.28, 1.2, 6.6]);
        expect(requests[1].speakers).toEqual([[-6.3, 6.4, 0.3], [6.3, 6.4, 0.3]]);
        expect(requests.every(request => request.output === 'speakers' && request.sampleRate === RATE)).toBe(true);
        // Facing the screen, level.
        expect(requests[1].listener.forward[1]).toBe(0);
        expect(requests[1].listener.forward[2]).toBeLessThan(-0.99);
        expect(played).toHaveLength(1);
        expect(played[0].channels[0][0]).toBeCloseTo(0.2, 6); // the chosen seat's IR, not the default seat's
        expect(played[0].gain).toBeCloseTo(10, 3); // 1 / 0.1 from the default seat
        expect(sound.tier).toBe('realtime');
    });

    it('asks once for the default seat, and plays dry when switched off', async () => {
        const { sound, requests, played, stage } = make();
        sound.setAcoustics(world);
        await vi.waitFor(() => expect(played).toHaveLength(1));
        expect(requests).toHaveLength(1);
        expect(played[0].gain).toBeCloseTo(10, 3);
        sound.setOptions({ enabled: false, output: 'headphones' });
        await vi.waitFor(() => expect(stage.stopped).toBe(1));
        expect(sound.tier).toBe('off');
        sound.setOptions({ enabled: true, output: 'headphones' });
        await vi.waitFor(() => expect(played).toHaveLength(2));
        expect(requests).toHaveLength(1); // kept, not asked again
        expect(played[1]).toBe(played[0]);
    });

    it('stays off and never asks when the acoustics process is not available', async () => {
        const { sound, api, played } = make(false);
        sound.setAcoustics(world);
        await settle();
        expect(api.computeRoom).not.toHaveBeenCalled();
        expect(played).toHaveLength(0);
        expect(sound.tier).toBe('off');
    });

    it('stays off with no api at all, and adds nothing to the graph', async () => {
        const audio = createFakeAudio();
        const before = [...audio.edges];
        const sound = createRoomSound({ anchors: { viewpoints: () => seats, speakers: () => speakers }, api: null, getSlot: () => audio.slot, onSlot: () => () => {} });
        sound.setAcoustics(world);
        await settle();
        expect(sound.tier).toBe('off');
        expect(audio.edges).toEqual(before);
        sound.dispose();
    });
});
