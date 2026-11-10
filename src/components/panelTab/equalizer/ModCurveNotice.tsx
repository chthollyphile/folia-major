import React from 'react';
import { Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUDIO_EQUALIZER_CUSTOM_SLOT_IDS } from '../../../utils/audioEqualizer';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';

// src/components/panelTab/equalizer/ModCurveNotice.tsx
// The note over the presets while a mod's equalizer curve is kept (Folium 1.7 `folium.equalizer`): whose it
// is, and the ways back to the listener's own sound or into a custom slot; while that mod is disabled or
// removed, that the curve is on hold. Reads the store only, so it knows nothing of the mod system.

// The look of a preset chip (PresetChips.tsx), not chosen.
const ACTION_CLASS = 'st-t-fast h-7 whitespace-nowrap rounded-lg bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t2)] transition-[background-color,color,scale] hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-t1)] active:scale-[0.96]';

const ModCurveNotice: React.FC = () => {
    const { t } = useTranslation();
    const curve = useAudioSettingsStore(state => state.audioEqualizerModCurve);
    const suspended = useAudioSettingsStore(state => state.audioEqualizerModCurveSuspended);
    const release = useAudioSettingsStore(state => state.handleReleaseModEqualizerCurve);
    const saveToSlot = useAudioSettingsStore(state => state.handleSaveModEqualizerCurveToSlot);

    if (!curve) {
        return null;
    }

    // The name the mod had when it put the curve there: it still reads after the mod is gone.
    const name = curve.modName;
    const backToOwnSound = () => {
        release({ kind: 'user' });
    };

    return (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-[var(--st-card)] px-4 py-3 shadow-[0_0_0_1px_var(--st-line)]">
            <Puzzle size={16} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--st-t2)]" />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">
                    {suspended ? t('ui.equalizerModCurveDormant', { name }) : t('ui.equalizerModCurve', { name })}
                </p>
                {!suspended && (
                    <p className="mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{t('ui.equalizerModCurveHint')}</p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {suspended ? (
                        <button type="button" className={ACTION_CLASS} onClick={backToOwnSound}>
                            {t('ui.equalizerModCurveDiscard')}
                        </button>
                    ) : (
                        <>
                            <button type="button" className={ACTION_CLASS} onClick={backToOwnSound}>
                                {t('ui.equalizerModCurveRelease')}
                            </button>
                            {AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.map(slotId => (
                                <button
                                    key={slotId}
                                    type="button"
                                    className={ACTION_CLASS}
                                    onClick={() => saveToSlot(slotId)}
                                >
                                    {t('ui.equalizerModCurveSave', { slot: t(`ui.equalizerPreset.${slotId}`) })}
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ModCurveNotice;
