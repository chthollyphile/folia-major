import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    AUDIO_EFFECT_CONTROLS,
    audioEffectToSliderPosition,
    formatAudioEffectValue,
    sliderPositionToAudioEffect,
    type AudioEffectId,
    type AudioEffectSettings,
} from '../../../utils/audioEffects';
import { Tooltip } from '../../modal/settings/kit';
import PanelSlider from '../controls/PanelSlider';
import EqualizerSection from './EqualizerSection';

// src/components/panelTab/equalizer/AudioEffectGrid.tsx
// The effect chain of the audio effect window (cutoffs, saturation, crush, wow, noise, width, space,
// punch): for each effect its name, its value and a slider, in as many columns as fit: three in the
// wide window, one in a narrow one.

/** The places along a slider's travel that the effect conversions count in. */
const SLIDER_POSITIONS = 1000;

type AudioEffectGridProps = {
    effects: AudioEffectSettings;
    onEffectChange: (id: AudioEffectId, value: number) => void;
    onCommit: () => void;
    /** The sliders are out of reach (inert); the names, the values and the noise tag's hint still read. */
    readOnly?: boolean;
};

const AudioEffectGrid: React.FC<AudioEffectGridProps> = ({ effects, onEffectChange, onCommit, readOnly = false }) => {
    const { t } = useTranslation();

    return (
        <EqualizerSection title={t('ui.equalizerEffects')} hint={t('ui.equalizerEffectsHint')}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-7 gap-y-1.5 px-4 pb-3.5 pt-3">
                {AUDIO_EFFECT_CONTROLS.map(control => {
                    const value = effects[control.id] ?? control.neutral;
                    const isNeutral = value === control.neutral;
                    const name = t(`ui.equalizerEffect.${control.id}`);
                    const valueText = formatAudioEffectValue(control, value);
                    return (
                        <div key={control.id} className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[13px] leading-5">
                                <span className="truncate">{name}</span>
                                {/* Shown whether or not the slider is up: the point is to answer
                                    "where is this noise coming from" BEFORE it is turned on. */}
                                {control.addsNoise && (
                                    <Tooltip text={t('ui.equalizerEffectNoiseTagHint')} className="inline-flex shrink-0">
                                        <span
                                            className={`st-t-fast rounded px-[5px] text-[11px] leading-4 transition-colors ${isNeutral
                                                ? 'bg-[var(--st-fill2)] text-[color:var(--st-t2)]'
                                                : 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]'}`}
                                        >
                                            {t('ui.equalizerEffectNoiseTag')}
                                        </span>
                                    </Tooltip>
                                )}
                                <span className="ml-auto shrink-0 font-mono text-xs text-[color:var(--st-t2)]">{valueText}</span>
                            </div>
                            {/* The gap keeps the slider's focus ring clear of the name above it. */}
                            <div inert={readOnly} className="mt-1 flex">
                                <PanelSlider
                                    value={audioEffectToSliderPosition(control, value) / SLIDER_POSITIONS}
                                    label={name}
                                    valueText={valueText}
                                    onPreview={(place) => {
                                        const next = sliderPositionToAudioEffect(control, place * SLIDER_POSITIONS);
                                        // The same value writes nothing: an edit turns processing on and goes to a custom slot.
                                        // (A press on the thumb that does not move it sends no value at all: PanelSlider.)
                                        if (next !== value) onEffectChange(control.id, next);
                                    }}
                                    onCommit={onCommit}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </EqualizerSection>
    );
};

export default AudioEffectGrid;
