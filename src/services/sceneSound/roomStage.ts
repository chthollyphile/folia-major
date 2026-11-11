import { rampGain } from '../automix/crossfadeGraph';

// src/services/sceneSound/roomStage.ts
// The room in the playback graph: the music through a scene's IR, between the play/pause fade and the volume
// (playbackGraph.ts). Two ConvolverNodes used in turn; a new IR goes into the idle one and is faded to only after
// it has heard one IR length of music, since a convolver given a new buffer forgets the music it held and
// switching at once clicks (-53 dBFS; prototype REPORT.md P3). Turning the room on or off fades over half a
// second, and once off every node is disconnected: the fade feeds the volume directly again, as with no scene.
//
// The dry music is never taken out of the path: the fade stays wired to the volume, and while the room is on a
// second branch adds the same signal times -1, which cancels it exactly. So turning on and off is only ramps,
// never a re-wiring of what is sounding. The on/off ramp sits after the limiter: the output is then a blend of
// the dry music and the limited room, each under full scale, so no moment of a toggle can pass it.

/** Where the room goes: the fade's output and the volume's input of the playback graph. */
export interface RoomSlot {
    context: AudioContext;
    from: AudioNode;
    to: AudioNode;
}

let slot: RoomSlot | null = null;
const slotListeners = new Set<() => void>();

/** Called by the playback bridge once the graph exists. */
export const registerRoomSlot = (next: RoomSlot | null) => {
    slot = next;
    slotListeners.forEach(listener => listener());
};
export const getRoomSlot = () => slot;
export const onRoomSlot = (listener: () => void) => {
    slotListeners.add(listener);
    return () => { slotListeners.delete(listener); };
};

/** An IR ready to play: shaped (roomIr.ts), with the gain it plays at. */
export interface RoomIr {
    channels: readonly Float32Array[];
    sampleRate: number;
    gain: number;
}

/** Turning the room on or off (design 4.8). */
export const ROOM_TOGGLE_SECONDS = 0.5;
/** From one IR to the next. Linear: the two lanes carry nearly the same signal, and equal power would swell 3 dB. */
export const ROOM_SWAP_SECONDS = 0.1;
/** After the last ramp, before the nodes go. */
const RELEASE_GRACE_SECONDS = 0.05;

/**
 * The limiter at the end of the room (decision of 2026-10-26 00:40): smart volume balance can lift a song to
 * -1.5 dBFS, and the front seats are louder than the default one. Only exists while the room is on.
 */
const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };
/**
 * The compressor adds a fixed make-up gain of 0.6 x what it takes off a full-scale signal (Web Audio spec,
 * DynamicsCompressorNode); undone here so a quiet passage at the default seat stays as loud as with no room.
 */
const LIMITER_MAKEUP = 10 ** (0.6 * -LIMITER.threshold * (1 - 1 / LIMITER.ratio) / 20);

export interface RoomStageTimers {
    set: (callback: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
}

const defaultTimers: RoomStageTimers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Lane {
    convolver: ConvolverNode;
    gain: GainNode;
    ir: RoomIr | null;
}

interface Nodes {
    lanes: [Lane, Lane];
    wet: GainNode;
    limiter: DynamicsCompressorNode;
    /** The room's on/off, after the limiter. */
    level: GainNode;
    cancel: GainNode;
}

export interface RoomStage {
    /** Plays `ir`: the first one fades in from the dry music, a later one crossfades from the one before. */
    play(ir: RoomIr): void;
    /** Fades back to the dry music, then takes every node out of the graph. */
    stop(): void;
    /** At once, for a graph that is going away. */
    dispose(): void;
}

export const createRoomStage = ({ context, from, to }: RoomSlot, timers: RoomStageTimers = defaultTimers): RoomStage => {
    let nodes: Nodes | null = null;
    let active = -1;
    // When the last crossfade ends: a lane is only reloaded once it is silent.
    let quietAt = 0;
    let swapTimer: unknown = null;
    let releaseTimer: unknown = null;
    let on = false;

    const build = (): Nodes => {
        const lane = (): Lane => {
            const convolver = context.createConvolver();
            convolver.normalize = false;
            // Two inputs, four-channel IR: the true-stereo mode, each input to both ears.
            convolver.channelCount = 2;
            convolver.channelCountMode = 'explicit';
            const gain = context.createGain();
            gain.gain.value = 0;
            from.connect(convolver);
            convolver.connect(gain);
            return { convolver, gain, ir: null };
        };
        const wet = context.createGain();
        wet.gain.value = 1 / LIMITER_MAKEUP;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = LIMITER.threshold;
        limiter.knee.value = LIMITER.knee;
        limiter.ratio.value = LIMITER.ratio;
        limiter.attack.value = LIMITER.attack;
        limiter.release.value = LIMITER.release;
        const level = context.createGain();
        level.gain.value = 0;
        const cancel = context.createGain();
        cancel.gain.value = 0;
        const lanes: [Lane, Lane] = [lane(), lane()];
        lanes.forEach(entry => entry.gain.connect(wet));
        wet.connect(limiter);
        limiter.connect(level);
        level.connect(to);
        from.connect(cancel);
        cancel.connect(to);
        return { lanes, wet, limiter, level, cancel };
    };

    const release = () => {
        releaseTimer = null;
        if (!nodes) return;
        const { lanes, wet, limiter, level, cancel } = nodes;
        lanes.forEach(({ convolver, gain }) => {
            from.disconnect(convolver);
            convolver.disconnect();
            gain.disconnect();
            convolver.buffer = null;
        });
        from.disconnect(cancel);
        cancel.disconnect();
        wet.disconnect();
        limiter.disconnect();
        level.disconnect();
        nodes = null;
        active = -1;
        quietAt = 0;
        console.log('[RoomStage] room off, nodes released');
    };

    const fadeIn = () => {
        if (!nodes || on) return;
        on = true;
        rampGain(context, nodes.level, 1, ROOM_TOGGLE_SECONDS);
        rampGain(context, nodes.cancel, -1, ROOM_TOGGLE_SECONDS);
        console.log('[RoomStage] room on');
    };

    const clearSwap = () => {
        if (swapTimer !== null) timers.clear(swapTimer);
        swapTimer = null;
    };

    const bufferOf = (ir: RoomIr) => {
        const buffer = context.createBuffer(ir.channels.length, ir.channels[0].length, ir.sampleRate);
        ir.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
        return buffer;
    };

    return {
        play: (ir) => {
            if (releaseTimer !== null) {
                timers.clear(releaseTimer);
                releaseTimer = null;
            }
            nodes ??= build();
            const current = nodes;
            const playing = active >= 0 ? current.lanes[active] : null;
            if (playing?.ir === ir) {
                // The same IR again (the room turned back on while fading out, say): nothing to load.
                clearSwap();
                fadeIn();
                return;
            }
            clearSwap();
            const target = active < 0 ? 0 : 1 - active;
            const load = () => {
                const lane = current.lanes[target];
                // The browser prepares the convolution here, on the main thread: logged, as it grows with the IR's length.
                const loadStarted = performance.now();
                lane.convolver.buffer = bufferOf(ir);
                console.info(`[SceneSound] IR into the convolver in ${Math.round(performance.now() - loadStarted)} ms`);
                lane.ir = ir;
                // Let the fresh convolver hear one IR length of music before it is heard.
                swapTimer = timers.set(() => {
                    swapTimer = null;
                    const now = context.currentTime;
                    if (active >= 0) rampGain(context, current.lanes[active].gain, 0, ROOM_SWAP_SECONDS);
                    rampGain(context, lane.gain, ir.gain, ROOM_SWAP_SECONDS);
                    quietAt = now + ROOM_SWAP_SECONDS;
                    active = target;
                    fadeIn();
                }, (ir.channels[0].length / ir.sampleRate) * 1000);
            };
            const wait = Math.max(0, quietAt - context.currentTime);
            if (wait > 0) swapTimer = timers.set(load, wait * 1000);
            else load();
        },
        stop: () => {
            clearSwap();
            if (!nodes) return;
            if (on) {
                on = false;
                rampGain(context, nodes.level, 0, ROOM_TOGGLE_SECONDS);
                rampGain(context, nodes.cancel, 0, ROOM_TOGGLE_SECONDS);
            }
            if (releaseTimer === null) releaseTimer = timers.set(release, (ROOM_TOGGLE_SECONDS + RELEASE_GRACE_SECONDS) * 1000);
        },
        dispose: () => {
            clearSwap();
            if (releaseTimer !== null) timers.clear(releaseTimer);
            on = false;
            release();
        },
    };
};
