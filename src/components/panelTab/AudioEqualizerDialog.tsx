import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AUDIO_EQUALIZER_CUSTOM_SLOT_IDS,
    areAudioEqualizerSettingsEqual,
    getAudioEqualizerCustomSlotIndex,
    isAudioEqualizerCustomSlotId,
    resolveAudioEqualizerSettings,
    type AudioEqualizerCustomSlotId,
    type AudioEqualizerModeId,
    type AudioEqualizerSettings,
} from '../../utils/audioEqualizer';
import { AUDIO_SOUND_PRESETS, AUDIO_SOUND_PRESET_IDS } from '../../utils/audioPresets';
import { createNeutralAudioEffects, type AudioEffectId, type AudioEffectSettings } from '../../utils/audioEffects';
import { resolveHeardAudioEqualizerSettings } from '../../utils/audioEqualizerModCurve';
import Sheet from '../shared/Sheet';
import { Toggle } from '../modal/settings/kit';
import AudioEffectGrid from './equalizer/AudioEffectGrid';
import EqualizerBandGrid from './equalizer/EqualizerBandGrid';
import PresetChips from './equalizer/PresetChips';
import ModCurveNotice from './equalizer/ModCurveNotice';
import HifiBypassNotice from '../hifi/HifiBypassNotice';
import { useIsHifiRoute } from '../hifi/useHifiSignalPath';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';

// src/components/panelTab/AudioEqualizerDialog.tsx
// The audio effect window opened from the controls tab, on the app's sheet: the processing switch
// in the header, then the presets, the ten EQ bands and the effect chain. It owns the draft that
// the parts edit and writes it to the store when an edit is let go.

type AudioEqualizerDialogProps = {
    isDaylight: boolean;
};

const PRESET_IDS: AudioEqualizerModeId[] = [...AUDIO_SOUND_PRESET_IDS, ...AUDIO_EQUALIZER_CUSTOM_SLOT_IDS];

const AudioEqualizerDialog: React.FC<AudioEqualizerDialogProps> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const ownSettings = useAudioSettingsStore(state => state.audioEqualizerSettings);
    const modCurve = useAudioSettingsStore(state => state.audioEqualizerModCurve);
    const modCurveSuspended = useAudioSettingsStore(state => state.audioEqualizerModCurveSuspended);
    const isOpen = useAudioSettingsStore(state => state.isAudioEqualizerOpen);
    const close = useAudioSettingsStore(state => state.closeAudioEqualizer);
    const commitSettings = useAudioSettingsStore(state => state.handleSetAudioEqualizerSettings);
    const commitEnabled = useAudioSettingsStore(state => state.handleSetAudioEqualizerEnabled);
    // What is heard: the listener's own settings, with a mod's curve over the gains while it plays (Folium 1.7).
    const settings = useMemo(
        () => resolveHeardAudioEqualizerSettings(ownSettings, modCurve, modCurveSuspended),
        [ownSettings, modCurve, modCurveSuspended],
    );
    const curveHeard = Boolean(modCurve) && !modCurveSuspended;
    // On the HiFi route mpv plays the song and none of this is heard: the window only shows the settings, kept for the web engine.
    const isHifiRoute = useIsHifiRoute();
    const readOnly = curveHeard || isHifiRoute;
    const [draft, setDraft] = useState<AudioEqualizerSettings>(settings);
    const draftRef = useRef(draft);
    const mountedRef = useRef(false);

    const updateDraft = (next: AudioEqualizerSettings) => {
        draftRef.current = next;
        setDraft(next);
    };

    useEffect(() => {
        if (isOpen) {
            updateDraft({
                enabled: settings.enabled,
                gains: [...settings.gains],
                preset: settings.preset,
                effects: { ...settings.effects },
                customSlots: settings.customSlots.map(slot => ({ gains: [...slot.gains], effects: { ...slot.effects } })),
            });
        }
    }, [isOpen, settings]);

    /*
     * The window is drawn only while the controls tab is up, and the tab can be switched away under it (a
     * Personal FM start, the now-playing card, a mod opening another tab), which leaves the open flag up and
     * every mod write refused `panel-open`. So going away closes it. A microtask later, and only if it did
     * not come back: development's StrictMode unmounts and remounts at once, and the "Audio effects" command
     * raises the flag before the window mounts.
     */
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            queueMicrotask(() => {
                if (!mountedRef.current) close();
            });
        };
    }, [close]);

    // Edits are always written into a custom slot: the active one, or the first while a built-in plays.
    const writeCustomDraft = (gains: number[], effects: AudioEffectSettings) => {
        const slotId: AudioEqualizerCustomSlotId = isAudioEqualizerCustomSlotId(draftRef.current.preset)
            ? draftRef.current.preset
            : AUDIO_EQUALIZER_CUSTOM_SLOT_IDS[0];
        const slotIndex = getAudioEqualizerCustomSlotIndex(slotId);
        updateDraft({
            ...draftRef.current,
            enabled: true,
            gains,
            effects,
            preset: slotId,
            customSlots: draftRef.current.customSlots.map((slot, index) => (
                index === slotIndex ? { gains: [...gains], effects: { ...effects } } : slot
            )),
        });
    };

    const updateBandDraft = (index: number, value: number) => {
        const gains = [...draftRef.current.gains];
        gains[index] = value;
        writeCustomDraft(gains, { ...draftRef.current.effects });
    };

    const updateEffectDraft = (id: AudioEffectId, value: number) => {
        writeCustomDraft([...draftRef.current.gains], { ...draftRef.current.effects, [id]: value });
    };

    const applyPreset = (presetId: AudioEqualizerModeId) => {
        const source = isAudioEqualizerCustomSlotId(presetId)
            ? draftRef.current.customSlots[getAudioEqualizerCustomSlotIndex(presetId)]
            : AUDIO_SOUND_PRESETS[presetId];
        const next: AudioEqualizerSettings = {
            ...draftRef.current,
            enabled: true,
            preset: presetId,
            gains: [...source.gains],
            effects: { ...source.effects },
        };
        updateDraft(next);
        commitSettings(next);
    };

    // Reset only ever clears a custom slot; the built-in presets are not editable, so nothing to undo.
    const resetActiveCustomSlot = () => {
        const slotId = isAudioEqualizerCustomSlotId(draftRef.current.preset) ? draftRef.current.preset : null;
        if (!slotId) return;

        const slotIndex = getAudioEqualizerCustomSlotIndex(slotId);
        const gains = [...AUDIO_SOUND_PRESETS.flat.gains];
        const effects = createNeutralAudioEffects();
        const next: AudioEqualizerSettings = {
            ...draftRef.current,
            gains,
            effects,
            customSlots: draftRef.current.customSlots.map((slot, index) => (
                index === slotIndex ? { gains: [...gains], effects: { ...effects } } : slot
            )),
        };
        updateDraft(next);
        commitSettings(next);
    };

    // The switch stops the processing and keeps every value.
    const setEnabled = (enabled: boolean) => {
        updateDraft({ ...draftRef.current, enabled });
        // Only the switch: a mod's curve stays, and nothing else in the draft is written by it.
        commitEnabled(enabled);
    };

    // While a mod's curve plays the bands and effects are read-only; this keeps a stray commit from writing it into a slot.
    // A let-go with nothing edited (a key, focus passing through, a press on a thumb) writes nothing either: any
    // write ends a curve on hold, and only an edit of the listener's own sound is meant to.
    const commitDraft = () => {
        if (readOnly) return;
        if (areAudioEqualizerSettingsEqual(resolveAudioEqualizerSettings(draftRef.current), ownSettings)) return;
        commitSettings(draftRef.current);
    };

    const presetChips = (
        <PresetChips
            presetIds={PRESET_IDS}
            chosen={curveHeard ? null : draft.preset}
            onChoose={applyPreset}
            canReset={!curveHeard && isAudioEqualizerCustomSlotId(draft.preset)}
            onReset={resetActiveCustomSlot}
        />
    );

    return (
        <Sheet
            isOpen={isOpen}
            onClose={close}
            isDaylight={isDaylight}
            size="l"
            title={t('ui.equalizerTitle')}
            subtitle={t('ui.equalizerDescription')}
            headerActions={(
                // The switch takes its name from the label it sits in. A narrow window has no room for the words: they stay for a screen reader.
                <label className="flex cursor-pointer items-center gap-3">
                    <span className="whitespace-nowrap text-xs text-[color:var(--st-t2)] max-sm:sr-only">
                        {t(draft.enabled ? 'ui.equalizerEnabled' : 'ui.equalizerDisabled')}
                    </span>
                    <Toggle checked={draft.enabled} onChange={setEnabled} disabled={isHifiRoute} />
                </label>
            )}
        >
            {/* 这一层排窗口里的内容（至少和窗口一样高，多出的高度给推子），也让这扇对话框自己能被思索命中。 */}
            <div data-ponder="audio-equalizer" className="flex min-h-full flex-col">
                <HifiBypassNotice />
                <ModCurveNotice />
                {isHifiRoute ? (
                    // Out of reach on HiFi as well: a preset would write a sound that is not heard.
                    <div inert className="opacity-40">{presetChips}</div>
                ) : presetChips}
                {/* Dimmed while processing is off, and still in reach: an edit turns processing on. */}
                {/* While a mod's curve plays they are read-only: keep it as a custom slot first. */}
                {/* The grids take the faders and sliders out of reach themselves: a narrow window must still scroll the bands sideways to show them all. */}
                <div
                    className={`st-t-move flex flex-1 flex-col transition-opacity${draft.enabled && !readOnly ? '' : ' opacity-40'}`}
                >
                    <EqualizerBandGrid gains={draft.gains} onBandChange={updateBandDraft} onCommit={commitDraft} readOnly={readOnly} />
                    <AudioEffectGrid effects={draft.effects} onEffectChange={updateEffectDraft} onCommit={commitDraft} readOnly={readOnly} />
                </div>
            </div>
        </Sheet>
    );
};

export default AudioEqualizerDialog;
