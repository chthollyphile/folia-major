import React from 'react';
import { Waves } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    AUDIO_EFFECT_CONTROLS,
    audioEffectToSliderPosition,
    formatAudioEffectValue,
    sliderPositionToAudioEffect,
    type AudioEffectId,
    type AudioEffectSettings,
} from '../../../utils/audioEffects';
import type { EqualizerStyles } from './equalizerStyles';

// src/components/panelTab/equalizer/AudioEffectGrid.tsx
// Renders the non-EQ effect sliders (cutoffs, saturation, crush, wow, noise, width, space, punch).

type AudioEffectGridProps = {
    effects: AudioEffectSettings;
    styles: EqualizerStyles;
    onEffectChange: (id: AudioEffectId, value: number) => void;
    onCommit: () => void;
};

const AudioEffectGrid: React.FC<AudioEffectGridProps> = ({ effects, styles, onEffectChange, onCommit }) => {
    const { t } = useTranslation();

    return (
        <div className={`mt-4 rounded-2xl border p-4 ${styles.surfaceClass}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                <span className={`flex items-center gap-1.5 ${styles.inactiveText}`}><Waves size={13} />{t('ui.equalizerEffects')}</span>
                <span className={`normal-case tracking-normal ${styles.inactiveText}`}>{t('ui.equalizerEffectsHint')}</span>
            </div>
            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {AUDIO_EFFECT_CONTROLS.map(control => {
                    const value = effects[control.id] ?? control.neutral;
                    const isNeutral = value === control.neutral;
                    return (
                        <label key={control.id} className="flex flex-col gap-1">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className={`flex items-baseline gap-1.5 text-[11px] font-semibold ${styles.inactiveText}`}>
                                    {t(`ui.equalizerEffect.${control.id}`)}
                                    {/* Shown whether or not the slider is up: the point is to answer
                                        "where is this noise coming from" BEFORE it is turned on. */}
                                    {control.addsNoise && (
                                        <span
                                            className="rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em] opacity-70"
                                            style={isNeutral ? undefined : {
                                                color: styles.selectedAccentColor,
                                                borderColor: styles.selectedAccentColor,
                                                opacity: 1,
                                            }}
                                            title={t('ui.equalizerEffectNoiseTagHint')}
                                        >
                                            {t('ui.equalizerEffectNoiseTag')}
                                        </span>
                                    )}
                                </span>
                                <span
                                    className={`text-[10px] font-semibold tabular-nums ${styles.valueTextClass}`}
                                    style={{ color: isNeutral ? undefined : styles.selectedAccentColor }}
                                >
                                    {formatAudioEffectValue(control, value)}
                                </span>
                            </span>
                            <input
                                type="range"
                                min={0}
                                max={1000}
                                step={1}
                                value={audioEffectToSliderPosition(control, value)}
                                aria-label={t(`ui.equalizerEffect.${control.id}`)}
                                onInput={event => onEffectChange(control.id, sliderPositionToAudioEffect(control, Number(event.currentTarget.value)))}
                                onChange={event => onEffectChange(control.id, sliderPositionToAudioEffect(control, Number(event.currentTarget.value)))}
                                onPointerUp={onCommit}
                                onPointerCancel={onCommit}
                                onKeyUp={onCommit}
                                onBlur={onCommit}
                                className={`h-1.5 w-full cursor-pointer appearance-none rounded-full ${styles.trackClass}`}
                                style={{ accentColor: styles.isDaylight ? styles.selectedAccentColor : styles.accentColor }}
                            />
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

export default AudioEffectGrid;
