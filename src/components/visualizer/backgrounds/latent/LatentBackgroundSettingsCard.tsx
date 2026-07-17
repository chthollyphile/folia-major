import React from 'react';
import type {
    LatentBackgroundColorSource,
    LatentBackgroundDisplayMode,
    LatentBackgroundTuning,
    Theme,
} from '../../../../types';
import { colorWithAlpha } from '../../colorMix';
import BackgroundToggleRow from '../BackgroundToggleRow';

// src/components/visualizer/backgrounds/latent/LatentBackgroundSettingsCard.tsx
// Edits Latent layer visibility, shader presets, and the wider audio-driven speed ranges.

interface LatentBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    tuning: LatentBackgroundTuning;
    onTuningChange?: (patch: Partial<LatentBackgroundTuning>) => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

interface SliderRowProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format?: (value: number) => string;
    rangeInputClass: string;
    theme: Theme;
    onChange: (value: number) => void;
    onPointerDown?: () => void;
    onPointerUp?: () => void;
    disabled?: boolean;
}

const SliderRow: React.FC<SliderRowProps> = ({
    label,
    value,
    min,
    max,
    step,
    format = next => next.toFixed(1),
    rangeInputClass,
    theme,
    onChange,
    onPointerDown,
    onPointerUp,
    disabled = false,
}) => (
    <label className="block space-y-2">
        <span className="flex justify-between gap-3 text-sm" style={{ color: theme.primaryColor }}>
            <span>{label}</span>
            <span className="font-mono opacity-70">{format(value)}</span>
        </span>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={event => onChange(Number(event.target.value))}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            className={rangeInputClass}
        />
    </label>
);

const LatentBackgroundSettingsCard: React.FC<LatentBackgroundSettingsCardProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const borderColor = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);
    const selectedBg = colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16);
    const displayModes: Array<[LatentBackgroundDisplayMode, string]> = [
        ['dithering', t('options.latentDisplayDithering')],
        ['mesh', t('options.latentDisplayMesh')],
        ['both', t('options.latentDisplayBoth')],
    ];
    const colorSources: Array<[LatentBackgroundColorSource, string]> = [
        ['cover-theme', t('options.latentColorSourceCoverTheme')],
        ['cover-only', t('options.latentColorSourceCoverOnly')],
    ];
    const sharedSliderProps = {
        rangeInputClass,
        theme,
        onPointerDown: onSliderPointerDown,
        onPointerUp: onSliderCommit,
    };

    return (
        <div className="rounded-[24px] border p-4 space-y-5" style={{ backgroundColor: controlCardBg, borderColor }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                    {t('options.latentBackgroundSettings')}
                </div>
                <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                    {t('options.latentBackgroundSettingsDesc')}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-sm" style={{ color: theme.primaryColor }}>
                    {t('options.latentDisplayMode')}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {displayModes.map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onTuningChange?.({ displayMode: value })}
                            className="rounded-xl border px-2 py-2 text-xs"
                            style={{
                                borderColor: tuning.displayMode === value ? theme.accentColor : borderColor,
                                backgroundColor: tuning.displayMode === value ? selectedBg : 'transparent',
                                color: theme.primaryColor,
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-sm" style={{ color: theme.primaryColor }}>
                    {t('options.latentColorSource')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {colorSources.map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onTuningChange?.({ colorSource: value })}
                            className="rounded-xl border px-2 py-2 text-xs"
                            style={{
                                borderColor: tuning.colorSource === value ? theme.accentColor : borderColor,
                                backgroundColor: tuning.colorSource === value ? selectedBg : 'transparent',
                                color: theme.primaryColor,
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <BackgroundToggleRow
                label={t('options.latentDynamicOnlyInPlayer')}
                description={t('options.latentDynamicOnlyInPlayerDesc')}
                checked={tuning.dynamicOnlyInPlayer}
                onChange={dynamicOnlyInPlayer => onTuningChange?.({ dynamicOnlyInPlayer })}
                theme={theme}
            />

            <BackgroundToggleRow
                label={t('options.latentEnhancedBeatResponse')}
                description={t('options.latentEnhancedBeatResponseDesc')}
                checked={tuning.enhancedBeatResponse}
                onChange={enhancedBeatResponse => onTuningChange?.({ enhancedBeatResponse })}
                theme={theme}
            />

            <div className="space-y-3 rounded-2xl border p-3" style={{ borderColor }}>
                <BackgroundToggleRow
                    label={t('options.nomandBackgroundOverlay')}
                    description={t('options.nomandBackgroundOverlayDesc')}
                    checked={tuning.overlayEnabled}
                    onChange={overlayEnabled => onTuningChange?.({ overlayEnabled })}
                    theme={theme}
                />
                <div className={tuning.overlayEnabled ? '' : 'opacity-45'}>
                    <SliderRow
                        {...sharedSliderProps}
                        label={t('options.nomandBackgroundOverlayOpacity')}
                        value={tuning.overlayOpacity}
                        disabled={!tuning.overlayEnabled}
                        min={0}
                        max={1}
                        step={0.05}
                        format={value => `${Math.round(value * 100)}%`}
                        onChange={overlayOpacity => onTuningChange?.({ overlayOpacity })}
                    />
                </div>
            </div>

            <div className="space-y-4 rounded-2xl border p-3" style={{ borderColor }}>
                <div className="text-xs font-medium uppercase tracking-[0.2em]" style={{ color: theme.secondaryColor }}>
                    {t('options.latentDitheringGroup')}
                </div>
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentBaseSpeed')}
                    value={tuning.ditheringSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={ditheringSpeed => onTuningChange?.({ ditheringSpeed })}
                />
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentAudioSpeed')}
                    value={tuning.ditheringAudioSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={ditheringAudioSpeed => onTuningChange?.({ ditheringAudioSpeed })}
                />
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentDitheringSize')}
                    value={tuning.ditheringSize}
                    min={0.5}
                    max={8}
                    step={0.25}
                    onChange={ditheringSize => onTuningChange?.({ ditheringSize })}
                />
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentDitheringOpacity')}
                    value={tuning.ditheringOpacity}
                    min={0}
                    max={1}
                    step={0.05}
                    format={value => `${Math.round(value * 100)}%`}
                    onChange={ditheringOpacity => onTuningChange?.({ ditheringOpacity })}
                />
            </div>

            <div className="space-y-4 rounded-2xl border p-3" style={{ borderColor }}>
                <div className="text-xs font-medium uppercase tracking-[0.2em]" style={{ color: theme.secondaryColor }}>
                    {t('options.latentMeshGroup')}
                </div>
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentBaseSpeed')}
                    value={tuning.meshSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={meshSpeed => onTuningChange?.({ meshSpeed })}
                />
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentAudioSpeed')}
                    value={tuning.meshAudioSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={meshAudioSpeed => onTuningChange?.({ meshAudioSpeed })}
                />
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentMeshDistortion')}
                    value={tuning.meshDistortion}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={meshDistortion => onTuningChange?.({ meshDistortion })}
                />
                <SliderRow
                    {...sharedSliderProps}
                    label={t('options.latentMeshSwirl')}
                    value={tuning.meshSwirl}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={meshSwirl => onTuningChange?.({ meshSwirl })}
                />
            </div>
        </div>
    );
};

export default LatentBackgroundSettingsCard;
