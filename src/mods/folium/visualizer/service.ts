import type { ModRuntimeInfo } from '../../types';
import type {
    FoliumBeatEffectPatch,
    FoliumBeatEffectsState,
    FoliumBeatEffectsWriteResult,
    FoliumContextKind,
    FoliumLyricAntialias,
    FoliumLyricRenderQuality,
    FoliumLyricRenderScale,
    FoliumModeWriteResult,
    FoliumRenderQualityWriteResult,
    FoliumTuningKeyInfo,
    FoliumTuningValue,
    FoliumTuningWriteResult,
    FoliumVisualizerModeInfo,
    FoliumVisualizerService,
    FoliumVisualizerTuning,
} from '../contract';
import { BEAT_EFFECT_STRENGTH_MAX } from '@/services/beatFx/beatEffects';
import type { FoliumStoppedCheck } from '../api';
import type { FoliumPermissionId } from '../shared';

// src/mods/folium/visualizer/service.ts
// `folium.visualizer` (Folium 1.8) as a mod sees it, and the seam it goes through. Like equalizer/service.ts
// this module is loaded in the export window too, so it imports no store and nothing of runtime/: the main
// window installs the source (runtime/visualizer/hostVisualizer.ts, which reads and writes the visualizer
// settings store). Here: the checks in the order the contract gives, the values made to fit what each key
// declares, and each mod's write allowances, one for each kind of write.

/** One beat effect's change once checked: the fields given, each valid; part keys the effect has. */
export interface FoliumCheckedBeatEffectPatch {
    on?: boolean;
    strength?: number;
    parts?: Record<string, number>;
}

/** Where the main window's lyric display settings come from (runtime/visualizer/hostVisualizer.ts). */
export interface FoliumVisualizerSource {
    getRenderQuality(): FoliumLyricRenderQuality;
    /** Sets the global level as the settings page does, for this mod; whether anything changed. */
    setRenderQuality(mod: ModRuntimeInfo, quality: FoliumLyricRenderQuality): boolean;
    listModes(): readonly FoliumVisualizerModeInfo[];
    getMode(): string;
    /** Whether `id` is a mode now. */
    hasMode(id: string): boolean;
    /** Whether switching to `id` as the player panel does would change anything: the mode, or random-per-song going off. */
    modeWriteChanges(id: string): boolean;
    /** Switches to the mode as the player panel does, for this mod; whether anything changed. */
    setMode(mod: ModRuntimeInfo, id: string): boolean;
    /** The tuning keys mods may set on `mode`, or null when `mode` is no mode now. */
    tuningKeysOf(mode: string): Readonly<Record<string, FoliumTuningKeyInfo>> | null;
    /** The tuning of a mode `tuningKeysOf` knows. */
    getTuning(mode: string): FoliumVisualizerTuning;
    /** Writes checked values through the mode's own setter, for this mod; whether anything changed. */
    setTuning(mod: ModRuntimeInfo, mode: string, patch: Readonly<Record<string, FoliumTuningValue>>): boolean;
    getBeatEffects(): FoliumBeatEffectsState;
    /** The part keys of the beat effect `id`, or null when no mode offers it. */
    beatEffectPartsOf(id: string): readonly string[] | null;
    /** Writes checked changes as the modes' settings do, for this mod; whether anything changed. */
    setBeatEffects(mod: ModRuntimeInfo, patch: Readonly<Record<string, FoliumCheckedBeatEffectPatch>>): boolean;
}

let visualizerSource: FoliumVisualizerSource | null = null;

/** Installs (or with null removes) the main window's `folium.visualizer` source. */
export const registerFoliumVisualizerSource = (source: FoliumVisualizerSource | null) => {
    visualizerSource = source;
};

/** The values the contract promises for 1.x (FoliumLyricRenderScale / FoliumLyricAntialias); setRenderQuality takes these and no others. */
export const FOLIUM_LYRIC_RENDER_SCALES = [0.5, 0.75, 1, 1.5, 2] as const satisfies readonly FoliumLyricRenderScale[];
export const FOLIUM_LYRIC_ANTIALIAS_MODES = ['auto', 'on', 'off'] as const satisfies readonly FoliumLyricAntialias[];

/*
 * As in equalizer/service.ts: `satisfies` only keeps out values the contract does not have; these two keep in
 * every value it does, so a value the contract gains and the lists lack would fail to compile rather than be
 * refused as an invalid argument.
 */
type FoliumRenderValuesMissing<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const scalesComplete: FoliumRenderValuesMissing<FoliumLyricRenderScale, typeof FOLIUM_LYRIC_RENDER_SCALES[number]> = true;
const antialiasComplete: FoliumRenderValuesMissing<FoliumLyricAntialias, typeof FOLIUM_LYRIC_ANTIALIAS_MODES[number]> = true;
void scalesComplete;
void antialiasComplete;

/** The strength range of a beat effect and of each of its parts, as the modes' settings have it (services/beatFx/beatEffects.ts). */
export const FOLIUM_BEAT_EFFECT_STRENGTH_MAX = BEAT_EFFECT_STRENGTH_MAX;

/** The four kinds of write, each with the permission it needs and an allowance of its own. */
type WriteKind = 'renderQuality' | 'mode' | 'tuning' | 'beatEffects';
const PERMISSION_OF: Record<WriteKind, FoliumPermissionId> = {
    renderQuality: 'visualizer.renderQuality',
    mode: 'visualizer.mode',
    tuning: 'visualizer.tuning',
    beatEffects: 'visualizer.beatEffects',
};

/** The shortest time between two counted writes of one kind by one mod. */
const WRITE_MIN_INTERVAL_MS = 1000;
/** The counted writes of one kind one mod may make in any 60 seconds. */
const WRITES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** When each mod's counted writes of each kind were, within the last minute, by `<mod id>\n<kind>`: a reload of the mod keeps them. */
const countedWrites = new Map<string, number[]>();

/* Whether one more counted write of this kind by this mod fits its allowance now. */
const withinAllowance = (key: string, now: number): boolean => {
    const recent = (countedWrites.get(key) ?? []).filter((at) => now - at < MINUTE_MS);
    countedWrites.set(key, recent);
    const last = recent[recent.length - 1];
    if (last !== undefined && now - last < WRITE_MIN_INTERVAL_MS) return false;
    return recent.length < WRITES_PER_MINUTE;
};

const countWrite = (key: string, now: number) => {
    countedWrites.set(key, [...(countedWrites.get(key) ?? []), now]);
};

/* Takes back the write `countWrite` counted at `now`, when it turned out to change nothing. */
const uncountWrite = (key: string, now: number) => {
    const counted = countedWrites.get(key) ?? [];
    const at = counted.lastIndexOf(now);
    if (at !== -1) counted.splice(at, 1);
};

/** Forgets every mod's counted writes; for tests (call it in afterEach). */
export const resetFoliumVisualizerWriteLimitsForTest = () => {
    countedWrites.clear();
};

const invalid = (problem: string) => new TypeError(`invalid-arguments: ${problem}`);

const isListed = <T>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

/* The patch argument of setRenderQuality: an object whose `scale` and `antialias`, where given, are listed values. Other keys are dropped. */
const patchOf = (patch: unknown): Partial<FoliumLyricRenderQuality> => {
    if (!isPlainObject(patch)) throw invalid('patch must be { scale?, antialias? }');
    const { scale, antialias } = patch;
    if (scale !== undefined && !isListed(FOLIUM_LYRIC_RENDER_SCALES, scale)) {
        throw invalid(`scale must be one of ${FOLIUM_LYRIC_RENDER_SCALES.join(', ')}`);
    }
    if (antialias !== undefined && !isListed(FOLIUM_LYRIC_ANTIALIAS_MODES, antialias)) {
        throw invalid(`antialias must be one of ${FOLIUM_LYRIC_ANTIALIAS_MODES.join(', ')}`);
    }
    return {
        ...(scale !== undefined ? { scale } : {}),
        ...(antialias !== undefined ? { antialias } : {}),
    };
};

const finiteNumber = (value: unknown, what: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${what} must be a finite number`);
    return value;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* A value for one declared tuning key, made to fit it: a number clamped and put on its step, a switch, a listed choice. */
const tuningValueOf = (key: string, info: FoliumTuningKeyInfo, value: unknown): FoliumTuningValue => {
    if (info.type === 'number') {
        const within = clamp(finiteNumber(value, key), info.min, info.max);
        if (info.step === null) return within;
        // On the nearest whole step from min, as the slider lands; never past max.
        const stepped = info.min + Math.round((within - info.min) / info.step) * info.step;
        return clamp(Number(stepped.toFixed(10)), info.min, info.max);
    }
    if (info.type === 'boolean') {
        if (typeof value !== 'boolean') throw invalid(`${key} must be a boolean`);
        return value;
    }
    if (info.type === 'choice') {
        if (!isListed(info.options, value)) throw invalid(`${key} must be one of ${info.options.join(', ')}`);
        return value;
    }
    // A type a later host adds and this one does not know: never reached, as the host declares only these.
    throw invalid(`${key} cannot be set`);
};

/*
 * The patch argument of setTuning: the keys `keys` declares, each fitted; the others named in `ignored`. A value
 * the key holds now is taken as it is, so what getTuning read always writes back, also one the declaration
 * leaves to the user (cappella's `custom` avatar).
 */
const tuningPatchOf = (keys: Readonly<Record<string, FoliumTuningKeyInfo>>, current: FoliumVisualizerTuning, patch: unknown) => {
    if (!isPlainObject(patch)) throw invalid('patch must be an object of tuning keys');
    const checked: Record<string, FoliumTuningValue> = {};
    const ignored: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
        const info = Object.prototype.hasOwnProperty.call(keys, key) ? keys[key] : undefined;
        if (!info) {
            ignored.push(key);
            continue;
        }
        checked[key] = Object.is(value, current[key]) ? value as FoliumTuningValue : tuningValueOf(key, info, value);
    }
    return { checked, ignored };
};

/* A strength of an effect or a part, clamped to 0..2. */
const strengthOf = (value: unknown, what: string) => clamp(finiteNumber(value, what), 0, FOLIUM_BEAT_EFFECT_STRENGTH_MAX);

/* The patch argument of setBeatEffects: changes to effects some mode offers, each checked; the rest in `ignored`. */
const beatEffectsPatchOf = (source: FoliumVisualizerSource, patch: unknown) => {
    if (!isPlainObject(patch)) throw invalid('patch must be an object of beat effect ids');
    const checked: Record<string, FoliumCheckedBeatEffectPatch> = {};
    const ignored: string[] = [];
    for (const [id, change] of Object.entries(patch)) {
        const parts = source.beatEffectPartsOf(id);
        if (!parts) {
            ignored.push(id);
            continue;
        }
        if (!isPlainObject(change)) throw invalid(`${id} must be { on?, strength?, parts? }`);
        const { on, strength, parts: partStrengths } = change as FoliumBeatEffectPatch;
        const effect: FoliumCheckedBeatEffectPatch = {};
        if (on !== undefined) {
            if (typeof on !== 'boolean') throw invalid(`${id}.on must be a boolean`);
            effect.on = on;
        }
        if (strength !== undefined) effect.strength = strengthOf(strength, `${id}.strength`);
        if (partStrengths !== undefined) {
            if (!isPlainObject(partStrengths)) throw invalid(`${id}.parts must be an object of part strengths`);
            const checkedParts: Record<string, number> = {};
            for (const [part, value] of Object.entries(partStrengths)) {
                if (!parts.includes(part)) {
                    ignored.push(`${id}:${part}`);
                    continue;
                }
                checkedParts[part] = strengthOf(value, `${id}.parts.${part}`);
            }
            if (Object.keys(checkedParts).length) effect.parts = checkedParts;
        }
        checked[id] = effect;
    }
    return { checked, ignored };
};

/* Whether the checked beat effect changes leave every effect as it is now. */
const beatEffectsUnchanged = (state: FoliumBeatEffectsState, patch: Readonly<Record<string, FoliumCheckedBeatEffectPatch>>) => (
    Object.entries(patch).every(([id, change]) => {
        const now = state.effects.find((effect) => effect.id === id);
        if (!now) return false;
        if (change.on !== undefined && change.on !== now.on) return false;
        if (change.strength !== undefined && change.strength !== now.strength) return false;
        return Object.entries(change.parts ?? {}).every(([part, value]) => now.parts[part] === value);
    })
);

/**
 * `folium.visualizer` for one mod in `context`. `stopped` refuses the writes of an activation that was torn
 * down (and names the call in the console).
 */
export const createFoliumVisualizerService = (
    mod: ModRuntimeInfo,
    context: FoliumContextKind,
    stopped: FoliumStoppedCheck = () => false,
): FoliumVisualizerService => {
    /* The installed source; outside the main window, and before it is installed, every call throws. */
    const sourceOf = (): FoliumVisualizerSource => {
        if (context !== 'main' || !visualizerSource) throw new Error(`visualizer-unavailable-in-${context}-context`);
        return visualizerSource;
    };

    const requirePermission = (kind: WriteKind) => {
        if (!mod.permissions.includes(PERMISSION_OF[kind])) throw new Error(`permission-denied:${PERMISSION_OF[kind]}`);
    };

    /*
     * The end every write shares, once its arguments are checked: a stopped mod, a write that changes nothing
     * (accepted, uncounted), the allowance of its kind; then the write, counted unless it changed nothing.
     */
    const write = <Ok>(
        kind: WriteKind,
        call: string,
        unchanged: () => boolean,
        apply: () => boolean,
        done: () => Ok,
    ): Ok | { readonly ok: false; readonly reason: 'stopped' | 'rate-limited' } => {
        if (stopped(call)) return Object.freeze({ ok: false as const, reason: 'stopped' as const });
        if (unchanged()) return done();
        const now = Date.now();
        const key = `${mod.id}\n${kind}`;
        if (!withinAllowance(key, now)) return Object.freeze({ ok: false as const, reason: 'rate-limited' as const });
        // Counted before it lands: the host tells the mods of a change synchronously, so a write a mod makes
        // from that callback must find this one counted already, or it slips past the allowance (#1000).
        countWrite(key, now);
        if (!apply()) uncountWrite(key, now);
        return done();
    };

    return Object.freeze({
        getRenderQuality: () => sourceOf().getRenderQuality(),
        /* The permission first, then where the call is made (as equalizer/service.ts), then the patch; then `write`. */
        setRenderQuality: (patch: Partial<FoliumLyricRenderQuality>): FoliumRenderQualityWriteResult => {
            requirePermission('renderQuality');
            const source = sourceOf();
            const checked = patchOf(patch);
            const current = source.getRenderQuality();
            const next: FoliumLyricRenderQuality = Object.freeze({
                scale: checked.scale ?? current.scale,
                antialias: checked.antialias ?? current.antialias,
            });
            return write(
                'renderQuality',
                'visualizer.setRenderQuality',
                () => next.scale === current.scale && next.antialias === current.antialias,
                () => source.setRenderQuality(mod, next),
                () => Object.freeze({ ok: true as const, quality: source.getRenderQuality() }),
            );
        },
        listModes: () => sourceOf().listModes(),
        getMode: () => sourceOf().getMode(),
        setMode: (id: string): FoliumModeWriteResult => {
            requirePermission('mode');
            const source = sourceOf();
            if (typeof id !== 'string' || !source.hasMode(id)) throw invalid(`"${String(id)}" is not a lyric animation mode`);
            return write(
                'mode',
                'visualizer.setMode',
                () => !source.modeWriteChanges(id),
                () => source.setMode(mod, id),
                () => Object.freeze({ ok: true as const, mode: source.getMode() }),
            );
        },
        getTuning: (mode: string): FoliumVisualizerTuning => {
            const source = sourceOf();
            if (typeof mode !== 'string' || !source.tuningKeysOf(mode)) throw invalid(`"${String(mode)}" is not a lyric animation mode`);
            return source.getTuning(mode);
        },
        setTuning: (mode: string, patch: Readonly<Record<string, FoliumTuningValue>>): FoliumTuningWriteResult => {
            requirePermission('tuning');
            const source = sourceOf();
            const keys = typeof mode === 'string' ? source.tuningKeysOf(mode) : null;
            if (!keys) throw invalid(`"${String(mode)}" is not a lyric animation mode`);
            const { checked, ignored } = tuningPatchOf(keys, source.getTuning(mode), patch);
            const frozenIgnored = Object.freeze(ignored);
            return write(
                'tuning',
                'visualizer.setTuning',
                () => {
                    const current = source.getTuning(mode);
                    return Object.entries(checked).every(([key, value]) => current[key] === value);
                },
                () => source.setTuning(mod, mode, checked),
                () => Object.freeze({ ok: true as const, tuning: source.getTuning(mode), ignored: frozenIgnored }),
            );
        },
        getBeatEffects: () => sourceOf().getBeatEffects(),
        setBeatEffects: (patch: Readonly<Record<string, FoliumBeatEffectPatch>>): FoliumBeatEffectsWriteResult => {
            requirePermission('beatEffects');
            const source = sourceOf();
            const { checked, ignored } = beatEffectsPatchOf(source, patch);
            const frozenIgnored = Object.freeze(ignored);
            return write(
                'beatEffects',
                'visualizer.setBeatEffects',
                () => beatEffectsUnchanged(source.getBeatEffects(), checked),
                () => source.setBeatEffects(mod, checked),
                () => Object.freeze({ ok: true as const, state: source.getBeatEffects(), ignored: frozenIgnored }),
            );
        },
    });
};
