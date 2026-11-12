import i18n from '@/i18n/config';
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    VISUALIZER_BACKGROUND_REGISTRY,
    getVisualizerBackgroundModeLabel,
    hasVisualizerBackgroundMode,
} from '@/components/visualizer/backgrounds/registry';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel, hasVisualizerMode } from '@/components/visualizer/registry';
import type { VisualizerModTuningKey, VisualizerTuningAdapter } from '@/components/visualizer/tuningDefinition';
import { getVisualizerTuning } from '@/components/visualizer/tuningRegistry';
import { offeredBeatEffects, resolveBeatEffectPartStrength, resolveBeatEffectSetting, type BeatEffectDef } from '@/services/beatFx/beatEffects';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import type { LyricRenderQuality, SmartBeatSettings } from '@/types';
import { isBuiltinVisualizerBackgroundMode, isBuiltinVisualizerMode } from '@/types/visualizerModes';
import type { ModRuntimeInfo } from '../../types';
import type {
    FoliumBackgroundInfo,
    FoliumBeatEffectInfo,
    FoliumBeatEffectState,
    FoliumBeatEffectsState,
    FoliumLyricRenderQuality,
    FoliumRenderQualityChangeOrigin,
    FoliumTuningKeyInfo,
    FoliumTuningValue,
    FoliumVisualizerChangeOrigin,
    FoliumVisualizerModeInfo,
    FoliumVisualizerTuning,
} from '../../folium/contract';
import { emitFoliumEvent, hasFoliumEventHandlers } from '../../folium/events';
import { registerFoliumVisualizerSource, type FoliumCheckedBeatEffectPatch, type FoliumVisualizerSource } from '../../folium/visualizer/service';
import { readFoliumAnimationIntensity, writeFoliumAnimationIntensity } from './hostAnimationIntensity';

// src/mods/runtime/visualizer/hostVisualizer.ts
// The main window's source of `folium.visualizer` and of the `visualizer.*` events (Folium 1.8). The visualizer
// settings store is the one place the lyric display settings live: a mod's write goes through the store's
// action, the same one the settings page or the player panel calls, and the styles follow the store. A
// style's own render override, its picture-cost settings and the 智能动感模式 switch are never written here.
// Installed in the main window only (mainWindowStart.ts). Folium 1.9 adds the background type, a store value
// as the rest, and the animation intensity, which the theme carries (hostAnimationIntensity.ts).
//
// The host's LyricRenderScale / LyricAntialias and the contract's FoliumLyricRenderScale / FoliumLyricAntialias
// are the same lists: the store's value is handed to mods as it is, and a mod's checked value to the store,
// so a value either side gains and the other lacks fails to compile here. The tuning keys a mod may set are
// the ones each style's tuning.ts declares (`modKeys`); the beat effects the ones the modes' entries offer.

type VisualizerSettingsState = ReturnType<typeof useVisualizerSettingsStore.getState>;
type Fields = Record<string, unknown>;

const settingsFields = () => useVisualizerSettingsStore.getState() as unknown as Fields;

let frozenFor: LyricRenderQuality | null = null;
let frozenQuality: FoliumLyricRenderQuality | null = null;

/** The global level, frozen, for `getRenderQuality()` and the event: the same object until the store's value changes. */
export const buildFoliumRenderQuality = (): FoliumLyricRenderQuality => {
    const quality = useVisualizerSettingsStore.getState().lyricRenderQuality;
    if (quality !== frozenFor || !frozenQuality) {
        frozenFor = quality;
        frozenQuality = Object.freeze({ scale: quality.scale, antialias: quality.antialias });
    }
    return frozenQuality;
};

// ---------------------------------------------------------------- Tuning

const EMPTY_TUNING_KEYS: Readonly<Record<string, FoliumTuningKeyInfo>> = Object.freeze({});
const EMPTY_TUNING: FoliumVisualizerTuning = Object.freeze({});

/* One declared key as the contract describes it, with the style's default. */
const tuningKeyInfo = (key: VisualizerModTuningKey, defaultValue: unknown): FoliumTuningKeyInfo => {
    if (key.type === 'number') {
        return Object.freeze({ type: 'number', min: key.min, max: key.max, step: key.step ?? null, defaultValue: defaultValue as number });
    }
    if (key.type === 'boolean') return Object.freeze({ type: 'boolean', defaultValue: defaultValue as boolean });
    return Object.freeze({ type: 'choice', options: Object.freeze([...key.options]), defaultValue: defaultValue as string });
};

/** A style's tuning that declares keys for mods, or none. */
const modTuningOf = (mode: string): VisualizerTuningAdapter | undefined => {
    const adapter = getVisualizerTuning(mode);
    return adapter?.modKeys && Object.keys(adapter.modKeys).length > 0 ? adapter : undefined;
};

// The declared keys never change while the app runs: described once per mode.
const tuningKeysByMode = new Map<string, Readonly<Record<string, FoliumTuningKeyInfo>>>();

/** The keys mods may set on `mode` (a builtin with `modKeys`); empty for any other mode. */
const tuningKeysFor = (mode: string): Readonly<Record<string, FoliumTuningKeyInfo>> => {
    const adapter = modTuningOf(mode);
    if (!adapter) return EMPTY_TUNING_KEYS;
    let keys = tuningKeysByMode.get(mode);
    if (!keys) {
        const defaults = adapter.defaults as Fields;
        keys = Object.freeze(Object.fromEntries(Object.entries(adapter.modKeys as Record<string, VisualizerModTuningKey>)
            .map(([key, declared]) => [key, tuningKeyInfo(declared, defaults[key])])));
        tuningKeysByMode.set(mode, keys);
    }
    return keys;
};

// The frozen tuning of each mode, and the store object it was read from: the same object until that changes.
const frozenTunings = new Map<string, { from: unknown; tuning: FoliumVisualizerTuning }>();

/** A builtin mode's tuning as mods see it: its declared keys only, frozen. */
export const buildFoliumTuning = (mode: string): FoliumVisualizerTuning => {
    const adapter = modTuningOf(mode);
    if (!adapter) return EMPTY_TUNING;
    const held = settingsFields()[adapter.settingsKey] as Fields | undefined;
    const cached = frozenTunings.get(mode);
    if (cached && cached.from === held) return cached.tuning;
    const defaults = adapter.defaults as Fields;
    const tuning: FoliumVisualizerTuning = Object.freeze(Object.fromEntries(Object.keys(tuningKeysFor(mode))
        .map((key) => [key, (held?.[key] ?? defaults[key]) as FoliumTuningValue])));
    frozenTunings.set(mode, { from: held, tuning });
    return tuning;
};

// ---------------------------------------------------------------- Beat effects

/** Every beat effect a builtin mode offers, with its mode, in the order of the mode picker. Builtin entries never change. */
let offeredEffects: ReadonlyArray<{ mode: string; effect: BeatEffectDef }> | null = null;
const offeredEffectsList = () => {
    offeredEffects ??= VISUALIZER_REGISTRY
        .filter((entry) => isBuiltinVisualizerMode(entry.mode))
        .flatMap((entry) => offeredBeatEffects(entry.beatEffects).map((effect) => ({ mode: entry.mode as string, effect })));
    return offeredEffects;
};

const beatEffectInfo = (mode: string, effect: BeatEffectDef): FoliumBeatEffectInfo => Object.freeze({
    id: effect.id,
    mode,
    label: i18n.t(effect.nameKey),
    source: effect.source,
    parts: Object.freeze((effect.parts ?? []).map((part) => Object.freeze({ key: part.key, label: i18n.t(part.nameKey) }))),
});

let frozenBeatFor: SmartBeatSettings | null = null;
let frozenBeatEffects: FoliumBeatEffectsState | null = null;

/** The beat effects and the 智能动感模式 switch, frozen: the same object until the store's value changes. */
export const buildFoliumBeatEffects = (): FoliumBeatEffectsState => {
    const settings = useVisualizerSettingsStore.getState().smartBeat;
    if (settings === frozenBeatFor && frozenBeatEffects) return frozenBeatEffects;
    const effects = offeredEffectsList().map(({ mode, effect }): FoliumBeatEffectState => {
        const setting = resolveBeatEffectSetting(settings, effect.id);
        return Object.freeze({
            id: effect.id,
            mode,
            on: setting.on,
            strength: setting.strength,
            parts: Object.freeze(Object.fromEntries((effect.parts ?? []).map((part) => [part.key, resolveBeatEffectPartStrength(setting, part.key)]))),
        });
    });
    frozenBeatFor = settings;
    frozenBeatEffects = Object.freeze({ smartBeat: settings.mode, effects: Object.freeze(effects) });
    return frozenBeatEffects;
};

// ---------------------------------------------------------------- Modes

/** The modes there are now, in the order of the mode picker. */
const buildFoliumModes = (): readonly FoliumVisualizerModeInfo[] => Object.freeze(VISUALIZER_REGISTRY.map((entry) => {
    const builtin = isBuiltinVisualizerMode(entry.mode);
    return Object.freeze({
        id: entry.mode,
        label: getVisualizerModeLabel(entry.mode, (key) => i18n.t(key)),
        kind: builtin ? 'builtin' as const : 'mod' as const,
        tuning: tuningKeysFor(entry.mode),
        beatEffects: Object.freeze(builtin ? offeredBeatEffects(entry.beatEffects).map((effect) => beatEffectInfo(entry.mode, effect)) : []),
    });
}));

// ---------------------------------------------------------------- Backgrounds

/** The background types there are now, in the order of the background picker. */
const buildFoliumBackgrounds = (): readonly FoliumBackgroundInfo[] => Object.freeze(VISUALIZER_BACKGROUND_REGISTRY.map((entry) => Object.freeze({
    id: entry.mode,
    label: getVisualizerBackgroundModeLabel(entry.mode, (key) => i18n.t(key)),
    kind: isBuiltinVisualizerBackgroundMode(entry.mode) ? 'builtin' as const : 'mod' as const,
})));

/** The background type the user has picked: the store's, or the default while none was ever picked. */
const pickedBackground = (): string => useVisualizerSettingsStore.getState().visualizerBackgroundMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;

// ---------------------------------------------------------------- Writes

// The mod whose write is in the store's action right now: the store's subscribers run inside it.
let writingModId: string | null = null;

/* Runs a store action as `mod`'s write, so the subscriber below names it. */
const asMod = (mod: ModRuntimeInfo, action: () => void) => {
    // A handler of an event sent inside the action may write too: the outer write's mod comes back after it.
    const outer = writingModId;
    writingModId = mod.id;
    try {
        action();
    } finally {
        writingModId = outer;
    }
};

/* What the events compare: a value as one string. */
const signatureOf = (value: unknown) => JSON.stringify(value);

/** What `folium.visualizer` goes through in the main window: the visualizer settings store, through its actions. */
export const FOLIUM_HOST_VISUALIZER_SOURCE: FoliumVisualizerSource = Object.freeze({
    getRenderQuality: buildFoliumRenderQuality,
    setRenderQuality: (mod: ModRuntimeInfo, quality: FoliumLyricRenderQuality) => {
        const before = useVisualizerSettingsStore.getState().lyricRenderQuality;
        asMod(mod, () => useVisualizerSettingsStore.getState().handleSetLyricRenderQuality({ scale: quality.scale, antialias: quality.antialias }));
        const after = useVisualizerSettingsStore.getState().lyricRenderQuality;
        const changed = after !== before;
        if (changed) console.info(`[FoliumVisualizer] ${mod.id} set the lyric render quality to ${after.scale}x, antialias ${after.antialias}`);
        return changed;
    },
    listModes: buildFoliumModes,
    getMode: () => useVisualizerSettingsStore.getState().visualizerMode,
    hasMode: (id: string) => hasVisualizerMode(id),
    modeWriteChanges: (id: string) => {
        const state = useVisualizerSettingsStore.getState();
        // The player panel's switch to the mode on screen still turns random-per-song off.
        return state.visualizerMode !== id || state.randomVisualizerModePerSong;
    },
    setMode: (mod: ModRuntimeInfo, id: string) => {
        const before = useVisualizerSettingsStore.getState();
        // As the player panel switches: no notice, and "a random mode for every song" goes off.
        asMod(mod, () => useVisualizerSettingsStore.getState().handleSetVisualizerMode(id, { notify: false }));
        const after = useVisualizerSettingsStore.getState();
        const changed = after.visualizerMode !== before.visualizerMode || after.randomVisualizerModePerSong !== before.randomVisualizerModePerSong;
        if (changed) console.info(`[FoliumVisualizer] ${mod.id} switched the lyric animation mode to ${id}${before.randomVisualizerModePerSong ? ', random-per-song off' : ''}`);
        return changed;
    },
    tuningKeysOf: (mode: string) => (hasVisualizerMode(mode) ? tuningKeysFor(mode) : null),
    getTuning: buildFoliumTuning,
    setTuning: (mod: ModRuntimeInfo, mode: string, patch: Readonly<Record<string, FoliumTuningValue>>) => {
        const adapter = modTuningOf(mode);
        const setter = adapter ? settingsFields()[adapter.settingsSetterKey] : undefined;
        if (!adapter || typeof setter !== 'function' || Object.keys(patch).length === 0) return false;
        const before = signatureOf(buildFoliumTuning(mode));
        // Laid out as the style's panel sends it (a slider taking the other end along), then the panel's setter.
        const held = settingsFields()[adapter.settingsKey];
        const sent = adapter.modPatch ? adapter.modPatch(held, { ...patch }) : { ...patch };
        asMod(mod, () => (setter as (patch: object) => void)(sent as object));
        const changed = signatureOf(buildFoliumTuning(mode)) !== before;
        if (changed) console.info(`[FoliumVisualizer] ${mod.id} set ${Object.keys(patch).join(', ')} of the ${mode} tuning`);
        return changed;
    },
    getBeatEffects: buildFoliumBeatEffects,
    beatEffectPartsOf: (id: string) => {
        const offered = offeredEffectsList().find(({ effect }) => effect.id === id);
        return offered ? (offered.effect.parts ?? []).map((part) => part.key) : null;
    },
    setBeatEffects: (mod: ModRuntimeInfo, patch: Readonly<Record<string, FoliumCheckedBeatEffectPatch>>) => {
        if (Object.keys(patch).length === 0) return false;
        const before = signatureOf(buildFoliumBeatEffects().effects);
        // Effects only: the 智能动感模式 switch is never in a mod's patch.
        asMod(mod, () => useVisualizerSettingsStore.getState().handleSetSmartBeat({ effects: patch }));
        const changed = signatureOf(buildFoliumBeatEffects().effects) !== before;
        if (changed) console.info(`[FoliumVisualizer] ${mod.id} changed the beat effects ${Object.keys(patch).join(', ')}`);
        return changed;
    },
    listBackgrounds: buildFoliumBackgrounds,
    getBackground: pickedBackground,
    hasBackground: (id: string) => hasVisualizerBackgroundMode(id),
    setBackground: (mod: ModRuntimeInfo, id: string) => {
        if (!hasVisualizerBackgroundMode(id)) return false;
        const before = pickedBackground();
        asMod(mod, () => useVisualizerSettingsStore.getState().handleSetVisualizerBackgroundMode(id));
        const changed = pickedBackground() !== before;
        if (changed) console.info(`[FoliumVisualizer] ${mod.id} switched the background type to ${id}`);
        return changed;
    },
    getAnimationIntensity: readFoliumAnimationIntensity,
    setAnimationIntensity: writeFoliumAnimationIntensity,
});

// ---------------------------------------------------------------- Events

const USER_ORIGIN: FoliumVisualizerChangeOrigin = Object.freeze({ kind: 'user', modId: null });

/* Who is changing the store now: the mod whose write is in the action, anyone else otherwise. */
const currentOrigin = (): FoliumVisualizerChangeOrigin => (
    writingModId !== null ? Object.freeze({ kind: 'mod' as const, modId: writingModId }) : USER_ORIGIN
);

/*
 * The events made once per task (render quality, each mode's tuning, the beat effects, the background type): the changes of a task
 * gathered under a key, one event a microtask after the first, read from the value as it settled, with the
 * origin of the last change. A value that ends where it began fires none. The signatures are kept up to date
 * while no mod listens, so a mod that starts listening later is not told of changes that came before it.
 */
const lastSignatures = new Map<string, string>();
const pendingOrigins = new Map<string, FoliumVisualizerChangeOrigin>();
let flushQueued = false;

interface TaskEvent {
    signature: () => string;
    emit: (origin: FoliumVisualizerChangeOrigin) => void;
}
const taskEvents = new Map<string, TaskEvent>();

const flushTaskEvents = () => {
    flushQueued = false;
    const pending = [...pendingOrigins];
    pendingOrigins.clear();
    for (const [key, origin] of pending) {
        const event = taskEvents.get(key);
        if (!event) continue;
        const signature = event.signature();
        if (signature === lastSignatures.get(key)) continue;
        lastSignatures.set(key, signature);
        event.emit(origin);
    }
};

/* One change under `key` in this task, by whoever is changing the store now. */
const noteChange = (key: string) => {
    pendingOrigins.delete(key);
    pendingOrigins.set(key, currentOrigin());
    if (!flushQueued) {
        flushQueued = true;
        queueMicrotask(flushTaskEvents);
    }
};

const RENDER_QUALITY_EVENT = 'renderQuality';
const BEAT_EFFECTS_EVENT = 'beatEffects';
const BACKGROUND_EVENT = 'background';
const tuningEventKey = (mode: string) => `tuning:${mode}`;

/* The modes whose tuning mods may set, with the store field each is held in. */
const modTuningFields = () => VISUALIZER_REGISTRY
    .filter((entry) => isBuiltinVisualizerMode(entry.mode))
    .flatMap((entry) => {
        const adapter = modTuningOf(entry.mode);
        return adapter ? [{ mode: entry.mode as string, field: adapter.settingsKey }] : [];
    });

let watchedTunings: ReadonlyArray<{ mode: string; field: string }> = [];

/* The store changed: note what each event watches, as a mod's write when one is in the action. */
const onVisualizerSettingsChange = (state: VisualizerSettingsState, previous: VisualizerSettingsState) => {
    // One event for each change, as before 1.8, now with its origin.
    if (state.visualizerMode !== previous.visualizerMode) {
        emitFoliumEvent('visualizer.modeChanged', { mode: state.visualizerMode, origin: currentOrigin() });
    }
    if (state.lyricRenderQuality !== previous.lyricRenderQuality) noteChange(RENDER_QUALITY_EVENT);
    if (state.smartBeat !== previous.smartBeat) noteChange(BEAT_EFFECTS_EVENT);
    if (state.visualizerBackgroundMode !== previous.visualizerBackgroundMode) noteChange(BACKGROUND_EVENT);
    const now = state as unknown as Fields;
    const before = previous as unknown as Fields;
    for (const { mode, field } of watchedTunings) {
        if (now[field] !== before[field]) noteChange(tuningEventKey(mode));
    }
};

let installed = false;

/** Installs the `folium.visualizer` source and the `visualizer.*` events (main window only; idempotent). */
export const installFoliumHostVisualizer = () => {
    if (installed) return;
    installed = true;
    registerFoliumVisualizerSource(FOLIUM_HOST_VISUALIZER_SOURCE);
    taskEvents.set(RENDER_QUALITY_EVENT, {
        signature: () => signatureOf(buildFoliumRenderQuality()),
        emit: (origin) => {
            if (!hasFoliumEventHandlers('visualizer.renderQualityChanged')) return;
            emitFoliumEvent('visualizer.renderQualityChanged', { quality: buildFoliumRenderQuality(), origin: origin as FoliumRenderQualityChangeOrigin });
        },
    });
    taskEvents.set(BEAT_EFFECTS_EVENT, {
        signature: () => signatureOf(buildFoliumBeatEffects()),
        emit: (origin) => {
            if (!hasFoliumEventHandlers('visualizer.beatEffectsChanged')) return;
            emitFoliumEvent('visualizer.beatEffectsChanged', { state: buildFoliumBeatEffects(), origin });
        },
    });
    taskEvents.set(BACKGROUND_EVENT, {
        signature: pickedBackground,
        emit: (origin) => {
            if (!hasFoliumEventHandlers('visualizer.backgroundChanged')) return;
            emitFoliumEvent('visualizer.backgroundChanged', { background: pickedBackground(), origin });
        },
    });
    watchedTunings = modTuningFields();
    for (const { mode } of watchedTunings) {
        taskEvents.set(tuningEventKey(mode), {
            signature: () => signatureOf(buildFoliumTuning(mode)),
            emit: (origin) => {
                if (!hasFoliumEventHandlers('visualizer.tuningChanged')) return;
                emitFoliumEvent('visualizer.tuningChanged', { mode, tuning: buildFoliumTuning(mode), origin });
            },
        });
    }
    // The starting point: what is there before any mod could listen is no change.
    for (const [key, event] of taskEvents) lastSignatures.set(key, event.signature());
    useVisualizerSettingsStore.subscribe(onVisualizerSettingsChange);
};
