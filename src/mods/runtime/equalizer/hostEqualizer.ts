import i18n from '@/i18n/config';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { setStatusMessage } from '@/stores/useStatusMessageStore';
import {
    AUDIO_EQUALIZER_BANDS,
    AUDIO_EQUALIZER_MAX_GAIN_DB,
    AUDIO_EQUALIZER_MIN_GAIN_DB,
    areAudioEqualizerSettingsEqual,
    audioEqualizerBandShape,
    isAudioEqualizerCustomSlotId,
    planAudioSoundPreset,
    type AudioEqualizerModeId,
} from '@/utils/audioEqualizer';
import {
    areAudioEqualizerModCurvesEqual,
    normalizeAudioEqualizerModCurveGains,
    resolveHeardAudioEqualizerSettings,
    type AudioEqualizerChangeOrigin,
} from '@/utils/audioEqualizerModCurve';
import { isAudioSoundPresetId, type AudioSoundPresetId } from '@/utils/audioPresets';
import type { ModRuntimeInfo } from '../../types';
import { isModsBridgeAvailable } from '../../ipc';
import type {
    FoliumEqualizerBand,
    FoliumEqualizerChangeOrigin,
    FoliumEqualizerMode,
    FoliumEqualizerState,
} from '../../folium/contract';
import { emitFoliumEvent, hasFoliumEventHandlers } from '../../folium/events';
import { registerFoliumEqualizerSource, type FoliumEqualizerSource, type FoliumEqualizerWrite } from '../../folium/equalizer/service';
import { getFoliumModList, onFoliumModListChanged } from '../clientLoader';

// src/mods/runtime/equalizer/hostEqualizer.ts
// The main window's source of `folium.equalizer` and of the `equalizer.changed` event (Folium 1.7). The
// audio settings store is the one place the equalizer lives: a mod's write goes through the store's actions,
// with the same normalization as the window, and the audio graph and the window follow the store. No audio
// node is touched here, and this layer is installed in the main window only (mainWindowStart.ts).
//
// A mod's curve is held back while its mod is disabled or removed, and only by the mod list's enabled state,
// never by whether the mod's client runs here right now: a reload (any edit of the mod reloads it), an
// `activate` that throws, or a start that missed the first screen changes neither the sound nor the state.

type AudioSettingsState = ReturnType<typeof useAudioSettingsStore.getState>;
type PlaybackState = ReturnType<typeof usePlaybackStore.getState>;

/** The bands as mods see them: made once, the same frozen array on every read. */
const FOLIUM_EQUALIZER_BANDS: readonly FoliumEqualizerBand[] = Object.freeze(AUDIO_EQUALIZER_BANDS.map((band, index) => (
    Object.freeze({ frequency: band.frequency, shape: audioEqualizerBandShape(index) })
)));

/*
 * Built-in sounds the host has retired, each pointed at the closest one left, so `setMode` keeps taking
 * every id FoliumEqualizerPresetId promised for 1.x. None retired so far.
 */
const RETIRED_PRESET_IDS: Readonly<Record<string, AudioSoundPresetId>> = Object.freeze({});

/*
 * Whether what plays goes through the host's own audio element, and so through the equalizer. External Stage
 * playback (another player's now-playing, a Stage source with lyrics and no audio) has none: it is Stage
 * with no audio source of the host's. A Stage media session that hands over an audio source plays through
 * the host's element, equalizer included. Stage is read from `activePlaybackContext`, as hostQueue.ts reads
 * it for the queue kind.
 */
const hostPlaysAudioNow = (state: PlaybackState = usePlaybackStore.getState()): boolean => (
    !(state.activePlaybackContext === 'stage' && !state.audioSrc)
);

/* The host's sound for a mode a mod named, retired ids mapped; null for one the host has not. */
const modeIdOf = (mode: { kind: string; id: string }): AudioEqualizerModeId | null => {
    if (mode.kind === 'preset') {
        if (isAudioSoundPresetId(mode.id)) return mode.id;
        return Object.hasOwn(RETIRED_PRESET_IDS, mode.id) ? RETIRED_PRESET_IDS[mode.id] : null;
    }
    if (mode.kind === 'custom') return isAudioEqualizerCustomSlotId(mode.id) ? mode.id : null;
    return null;
};

/** The equalizer as it is heard, frozen, for `folium.equalizer.getState()` and `equalizer.changed`. */
export const buildFoliumEqualizerState = (): FoliumEqualizerState => {
    const audio = useAudioSettingsStore.getState();
    const settings = audio.audioEqualizerSettings;
    const curve = audio.audioEqualizerModCurve;
    const heard = resolveHeardAudioEqualizerSettings(settings, curve, audio.audioEqualizerModCurveSuspended);
    const mode: FoliumEqualizerMode = curve && !audio.audioEqualizerModCurveSuspended
        ? Object.freeze({ kind: 'mod', modId: curve.modId })
        : isAudioEqualizerCustomSlotId(settings.preset)
            ? Object.freeze({ kind: 'custom', id: settings.preset })
            : Object.freeze({ kind: 'preset', id: settings.preset });
    return Object.freeze({
        enabled: settings.enabled,
        mode,
        gains: Object.freeze([...heard.gains]),
        bands: FOLIUM_EQUALIZER_BANDS,
        minGain: AUDIO_EQUALIZER_MIN_GAIN_DB,
        maxGain: AUDIO_EQUALIZER_MAX_GAIN_DB,
        hostPlaysAudio: hostPlaysAudioNow(),
        writable: !audio.isAudioEqualizerOpen,
    });
};

const isOwnChange = (origin: AudioEqualizerChangeOrigin, modId: string) => origin.kind === 'mod' && origin.modId === modId;

const sameSound = (left: FoliumEqualizerState, right: FoliumEqualizerState) => (
    JSON.stringify(left.mode) === JSON.stringify(right.mode)
    && left.gains.length === right.gains.length
    && left.gains.every((gain, index) => gain === right.gains[index])
);

/*
 * The toast that tells the user a mod took the sound over: only when this mod took it from someone else
 * (the user, a command, the host, another mod), so a mod that follows the songs is announced once and not
 * at every song, and only when what is heard changed.
 */
const announceTakeover = (
    mod: ModRuntimeInfo,
    write: FoliumEqualizerWrite,
    modeId: AudioEqualizerModeId | null,
    before: FoliumEqualizerState,
    originBefore: AudioEqualizerChangeOrigin,
) => {
    if (isOwnChange(originBefore, mod.id) || sameSound(before, buildFoliumEqualizerState())) return;
    setStatusMessage({
        type: 'info',
        text: write.kind === 'mode' && modeId
            ? i18n.t('notifications.equalizerModMode', { mod: mod.name, mode: i18n.t(`ui.equalizerPreset.${modeId}`) })
            : i18n.t('notifications.equalizerModCurve', { mod: mod.name }),
    });
};

/** What `folium.equalizer` goes through in the main window: the audio settings store, through its actions. */
export const FOLIUM_HOST_EQUALIZER_SOURCE: FoliumEqualizerSource = Object.freeze({
    getState: buildFoliumEqualizerState,
    isWritable: () => !useAudioSettingsStore.getState().isAudioEqualizerOpen,
    hasMode: (mode: { kind: string; id: string }) => modeIdOf(mode) !== null,
    wouldChange: (mod: ModRuntimeInfo, write: FoliumEqualizerWrite) => {
        const audio = useAudioSettingsStore.getState();
        if (write.kind === 'mode') {
            const modeId = modeIdOf(write.mode);
            const next = modeId ? planAudioSoundPreset(audio.audioEqualizerSettings, modeId, { keepEnabled: true }) : null;
            if (!next) return false;
            // Any curve in place ends with it, which is a change by itself.
            return audio.audioEqualizerModCurve !== null || !areAudioEqualizerSettingsEqual(next, audio.audioEqualizerSettings);
        }
        const gains = normalizeAudioEqualizerModCurveGains(write.gains);
        return !areAudioEqualizerModCurvesEqual(audio.audioEqualizerModCurve, { modId: mod.id, gains });
    },
    write: (mod: ModRuntimeInfo, write: FoliumEqualizerWrite) => {
        const audio = useAudioSettingsStore.getState();
        const before = buildFoliumEqualizerState();
        const originBefore = audio.audioEqualizerChangeOrigin;
        const origin: AudioEqualizerChangeOrigin = { kind: 'mod', modId: mod.id };
        const modeId = write.kind === 'mode' ? modeIdOf(write.mode) : null;
        let changed: boolean;
        if (write.kind === 'mode') {
            // Never the switch: a mod's write leaves processing as the user set it.
            changed = modeId !== null && audio.handleApplyAudioSoundPreset(modeId, { origin, keepEnabled: true });
            if (changed) console.info(`[FoliumEqualizer] ${mod.id} switched the sound to ${modeId}`);
        } else {
            changed = audio.handleApplyModEqualizerCurve({ modId: mod.id, modName: mod.name, gains: write.gains });
            if (changed) {
                console.info(`[FoliumEqualizer] ${mod.id} put its curve in place: ${useAudioSettingsStore.getState().audioEqualizerModCurve?.gains.join(' ')} dB`);
            }
        }
        if (changed) announceTakeover(mod, write, modeId, before, originBefore);
        return changed;
    },
    releaseCurve: (mod: ModRuntimeInfo) => {
        const audio = useAudioSettingsStore.getState();
        if (audio.audioEqualizerModCurve?.modId !== mod.id) return false;
        const released = audio.handleReleaseModEqualizerCurve({ kind: 'mod', modId: mod.id });
        if (released) console.info(`[FoliumEqualizer] ${mod.id} took its curve off; the user's own sound plays`);
        return released;
    },
});

/* A mod counts as running when the list has it installed and enabled, and this run did not skip the mods. */
const isModEnabledInList = (list: readonly ModRuntimeInfo[], modId: string) => list.some((mod) => (
    mod.id === modId && mod.enabled === true && mod.status !== 'skipped'
));

/*
 * Holds a curve back while its mod is disabled or removed, and lets it go when the mod is enabled again. A
 * mod whose files changed and wait to be confirmed is disabled in the list already. Before the first list
 * (the first screen waits for it) nothing is changed: the curve plays meanwhile, rather than going off and
 * on again.
 */
const syncCurveSuspension = () => {
    const audio = useAudioSettingsStore.getState();
    const curve = audio.audioEqualizerModCurve;
    const list = getFoliumModList();
    if (!curve || list === null) return;
    const suspended = !isModEnabledInList(list, curve.modId);
    if (suspended === audio.audioEqualizerModCurveSuspended) return;
    audio.handleSetAudioEqualizerModCurveSuspended(suspended);
    console.info(suspended
        ? `[FoliumEqualizer] the curve of ${curve.modId} is on hold: the mod is disabled or removed, the user's own sound plays`
        : `[FoliumEqualizer] the curve of ${curve.modId} plays again: the mod is enabled`);
};

/* What `equalizer.changed` compares: everything the state reports, as one string. */
const signatureOf = (state: FoliumEqualizerState) => JSON.stringify([state.enabled, state.mode, state.gains, state.hostPlaysAudio, state.writable]);

let lastSignature = '';
let lastHostPlaysAudio = true;
// The origins of the changes of this task, in order; emptied when the event of the task is made.
let pendingOrigins: AudioEqualizerChangeOrigin[] = [];

/* The origin a task's changes report: the last that was not the host's, or the host when all were. */
const originOfTask = (origins: readonly AudioEqualizerChangeOrigin[]): FoliumEqualizerChangeOrigin => {
    const last = [...origins].reverse().find((origin) => origin.kind !== 'host') ?? { kind: 'host' as const };
    return Object.freeze({ kind: last.kind, modId: last.kind === 'mod' ? last.modId : null });
};

/*
 * equalizer.changed: one event for all the changes of a task, a microtask after the first, read from the
 * state as it settled. A state that ends where it began fires none. The signature is kept up to date while no
 * mod listens, so a mod that starts listening later is not told of changes that came before it.
 */
const emitEqualizerChange = () => {
    const origins = pendingOrigins;
    pendingOrigins = [];
    const state = buildFoliumEqualizerState();
    const signature = signatureOf(state);
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (!hasFoliumEventHandlers('equalizer.changed')) return;
    emitFoliumEvent('equalizer.changed', { state, origin: originOfTask(origins) });
};

const noteChange = (origin: AudioEqualizerChangeOrigin) => {
    pendingOrigins.push(origin);
    if (pendingOrigins.length === 1) queueMicrotask(emitEqualizerChange);
};

/* The store changed: who changed the sound, or only the window opening or closing (the host). */
const onAudioSettingsChange = (state: AudioSettingsState, previous: AudioSettingsState) => {
    if (
        state.audioEqualizerSettings !== previous.audioEqualizerSettings
        || state.audioEqualizerModCurve !== previous.audioEqualizerModCurve
        || state.audioEqualizerModCurveSuspended !== previous.audioEqualizerModCurveSuspended
    ) {
        noteChange(state.audioEqualizerChangeOrigin);
    } else if (state.isAudioEqualizerOpen !== previous.isAudioEqualizerOpen) {
        noteChange({ kind: 'host' });
    }
    if (state.audioEqualizerModCurve !== previous.audioEqualizerModCurve) syncCurveSuspension();
};

/* Playback changed: only the sound leaving or coming back to the host's own audio counts (a new song alone does not). */
const onPlaybackChange = (state: PlaybackState) => {
    const playsAudio = hostPlaysAudioNow(state);
    if (playsAudio === lastHostPlaysAudio) return;
    lastHostPlaysAudio = playsAudio;
    noteChange({ kind: 'host' });
};

let installed = false;

/** Installs the equalizer source, the curve's hold by the mod list and `equalizer.changed` (main window only; idempotent). */
export const installFoliumHostEqualizer = () => {
    if (installed) return;
    installed = true;
    registerFoliumEqualizerSource(FOLIUM_HOST_EQUALIZER_SOURCE);
    // Without the bridge (the web build, an OBS page) no mod runs here at all: a curve kept from before is held back.
    if (!isModsBridgeAvailable() && useAudioSettingsStore.getState().audioEqualizerModCurve) {
        useAudioSettingsStore.getState().handleSetAudioEqualizerModCurveSuspended(true);
        console.info('[FoliumEqualizer] no mods run in this window: the curve a mod put in place is on hold');
    }
    syncCurveSuspension();
    // The starting point: what is there before any mod could listen is no change.
    lastHostPlaysAudio = hostPlaysAudioNow();
    lastSignature = signatureOf(buildFoliumEqualizerState());
    onFoliumModListChanged(syncCurveSuspension);
    useAudioSettingsStore.subscribe(onAudioSettingsChange);
    usePlaybackStore.subscribe(onPlaybackChange);
};
