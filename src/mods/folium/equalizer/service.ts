import type { ModRuntimeInfo } from '../../types';
import type {
    FoliumContextKind,
    FoliumEqualizerCustomId,
    FoliumEqualizerPresetId,
    FoliumEqualizerService,
    FoliumEqualizerState,
    FoliumEqualizerUserMode,
    FoliumEqualizerWriteResult,
} from '../contract';
import type { FoliumStoppedCheck } from '../api';
import type { FoliumPermissionId } from '../shared';

// src/mods/folium/equalizer/service.ts
// `folium.equalizer` (Folium 1.7) as a mod sees it, and the seam it goes through. Like account.ts and
// omni/service.ts this module is loaded in the export window too, so it imports no store and nothing of
// runtime/: the main window installs the source (runtime/equalizer/hostEqualizer.ts, which reads and writes
// the audio settings store). Here: the checks in the order the contract gives, and each mod's write allowance.

/** One `folium.equalizer` write, for the source to judge and to carry out. */
export type FoliumEqualizerWrite =
    | { readonly kind: 'mode'; readonly mode: FoliumEqualizerUserMode }
    | { readonly kind: 'curve'; readonly gains: readonly number[] };

/** Where the main window's equalizer comes from (runtime/equalizer/hostEqualizer.ts). */
export interface FoliumEqualizerSource {
    getState(): FoliumEqualizerState;
    /** False when the audio effects window is open (`state.writable`). */
    isWritable(): boolean;
    /** True when the host has this sound. */
    hasMode(mode: { kind: string; id: string }): boolean;
    /** Whether the write would change anything: the user's settings it leaves, or the curve record. Pure: changes nothing itself. */
    wouldChange(mod: ModRuntimeInfo, write: FoliumEqualizerWrite): boolean;
    /** Carries the write out; whether anything changed. */
    write(mod: ModRuntimeInfo, write: FoliumEqualizerWrite): boolean;
    /** Takes this mod's curve off; false when the curve in place is not this mod's, or there is none. */
    releaseCurve(mod: ModRuntimeInfo): boolean;
}

let equalizerSource: FoliumEqualizerSource | null = null;

/** Installs (or with null removes) the main window's `folium.equalizer` source. */
export const registerFoliumEqualizerSource = (source: FoliumEqualizerSource | null) => {
    equalizerSource = source;
};

/** The ids the contract promises for 1.x (FoliumEqualizerPresetId / FoliumEqualizerCustomId); the tests walk them. */
export const FOLIUM_EQUALIZER_PRESET_IDS = ['flat', 'lofi', 'radio', 'hall', 'vocal', 'bass'] as const satisfies readonly FoliumEqualizerPresetId[];
export const FOLIUM_EQUALIZER_CUSTOM_IDS = ['custom1', 'custom2'] as const satisfies readonly FoliumEqualizerCustomId[];

/*
 * The two lists above are what the test of "the contract's ids stay usable in 1.x" walks, so an id the
 * contract gains and the lists lack would go untested. `satisfies` only keeps out ids the contract does not
 * have; these two keep in every id it does: `Exclude<...>` is never only when nothing is missing, and
 * otherwise the assignment of `true` fails to compile.
 */
type FoliumEqualizerIdsMissing<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const presetIdsComplete: FoliumEqualizerIdsMissing<FoliumEqualizerPresetId, typeof FOLIUM_EQUALIZER_PRESET_IDS[number]> = true;
const customIdsComplete: FoliumEqualizerIdsMissing<FoliumEqualizerCustomId, typeof FOLIUM_EQUALIZER_CUSTOM_IDS[number]> = true;
void presetIdsComplete;
void customIdsComplete;

/** The permission every write needs. */
const EQUALIZER_CONTROL: FoliumPermissionId = 'equalizer.control';

/** The shortest time between two counted writes of one mod. */
const EQUALIZER_WRITE_MIN_INTERVAL_MS = 1000;
/** The counted writes one mod may make in any 60 seconds. */
const EQUALIZER_WRITES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** When each mod's counted writes were, within the last minute, by mod id: a reload of the mod keeps them. */
const countedWrites = new Map<string, number[]>();

/* Whether one more counted write of this mod fits its allowance now. */
const withinAllowance = (modId: string, now: number): boolean => {
    const recent = (countedWrites.get(modId) ?? []).filter((at) => now - at < MINUTE_MS);
    countedWrites.set(modId, recent);
    const last = recent[recent.length - 1];
    if (last !== undefined && now - last < EQUALIZER_WRITE_MIN_INTERVAL_MS) return false;
    return recent.length < EQUALIZER_WRITES_PER_MINUTE;
};

const countWrite = (modId: string, now: number) => {
    countedWrites.set(modId, [...(countedWrites.get(modId) ?? []), now]);
};

/** Forgets every mod's counted writes; for tests (call it in afterEach). */
export const resetFoliumEqualizerWriteLimitsForTest = () => {
    countedWrites.clear();
};

const invalid = (problem: string) => new TypeError(`invalid-arguments: ${problem}`);

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/*
 * The mode argument of setMode, checked for its shape. A kind this host does not know is no malformed
 * argument (a later minor may have added it, with or without an id): it reads as a mode the host lacks,
 * which setMode refuses `unknown-mode`.
 */
const modeOf = (mode: unknown): { kind: string; id: string } => {
    if (!isPlainObject(mode)) throw invalid('mode must be { kind, id }');
    const { kind, id } = mode;
    if (typeof kind !== 'string') throw invalid('mode.kind must be a string');
    if (kind === 'mod') throw invalid('a curve of your own is put in place with applyCurve, not setMode');
    if (kind === 'preset' || kind === 'custom') {
        if (typeof id !== 'string') throw invalid('mode.id must be a string');
        return { kind, id };
    }
    return { kind, id: typeof id === 'string' ? id : '' };
};

/* The gains argument of applyCurve: 1 to `bands` finite numbers, copied so later changes to the array do not reach the write. */
const gainsOf = (gains: unknown, bands: number): readonly number[] => {
    if (!Array.isArray(gains) || gains.length === 0 || gains.length > bands) {
        throw invalid(`gains must be an array of 1-${bands} numbers`);
    }
    // By index, not forEach: forEach skips the holes of a sparse array, which would then be read as 0 dB.
    for (let index = 0; index < gains.length; index += 1) {
        const gain: unknown = gains[index];
        if (typeof gain !== 'number' || !Number.isFinite(gain)) throw invalid(`gains[${index}] must be a finite number`);
    }
    return Object.freeze([...gains] as number[]);
};

/**
 * `folium.equalizer` for one mod in `context`. `stopped` refuses the writes of an activation that was torn
 * down (and names the call in the console).
 */
export const createFoliumEqualizerService = (
    mod: ModRuntimeInfo,
    context: FoliumContextKind,
    stopped: FoliumStoppedCheck = () => false,
): FoliumEqualizerService => {
    /* The installed source; outside the main window, and before it is installed, every call throws. */
    const sourceOf = (): FoliumEqualizerSource => {
        if (context !== 'main' || !equalizerSource) throw new Error(`equalizer-unavailable-in-${context}-context`);
        return equalizerSource;
    };

    /* The permission first, then where the call is made: as playback.control does (services.ts). */
    const controlSource = (): FoliumEqualizerSource => {
        if (!mod.permissions.includes(EQUALIZER_CONTROL)) throw new Error(`permission-denied:${EQUALIZER_CONTROL}`);
        return sourceOf();
    };

    /*
     * The common end of setMode and applyCurve, from the fourth check on: a stopped mod, a mode the host
     * lacks, a write that changes nothing (accepted, uncounted, whatever else holds), the open window, the
     * allowance; then the write, counted when it changed something.
     */
    const carryOut = (
        source: FoliumEqualizerSource,
        method: 'setMode' | 'applyCurve',
        write: FoliumEqualizerWrite,
        hasMode: boolean,
    ): FoliumEqualizerWriteResult => {
        if (stopped(`equalizer.${method}`)) return Object.freeze({ ok: false, reason: 'stopped' });
        if (!hasMode) return Object.freeze({ ok: false, reason: 'unknown-mode' });
        if (!source.wouldChange(mod, write)) return Object.freeze({ ok: true, state: source.getState() });
        if (!source.isWritable()) return Object.freeze({ ok: false, reason: 'panel-open' });
        const now = Date.now();
        if (!withinAllowance(mod.id, now)) return Object.freeze({ ok: false, reason: 'rate-limited' });
        if (source.write(mod, write)) countWrite(mod.id, now);
        return Object.freeze({ ok: true, state: source.getState() });
    };

    return Object.freeze({
        getState: () => sourceOf().getState(),
        setMode: (mode: FoliumEqualizerUserMode) => {
            const source = controlSource();
            const checked = modeOf(mode);
            const hasMode = source.hasMode(checked);
            // Only a mode the host has goes on as a write; its kind and id are then the contract's.
            const write: FoliumEqualizerWrite = { kind: 'mode', mode: Object.freeze(checked) as FoliumEqualizerUserMode };
            return carryOut(source, 'setMode', write, hasMode);
        },
        applyCurve: (gains: readonly number[]) => {
            const source = controlSource();
            const checked = gainsOf(gains, source.getState().bands.length);
            return carryOut(source, 'applyCurve', { kind: 'curve', gains: checked }, true);
        },
        releaseCurve: () => {
            const source = controlSource();
            if (stopped('equalizer.releaseCurve')) return false;
            return source.releaseCurve(mod);
        },
    });
};
