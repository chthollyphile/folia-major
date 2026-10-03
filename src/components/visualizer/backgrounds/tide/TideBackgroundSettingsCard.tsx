import React, { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import {
    DEFAULT_TIDE_BACKGROUND_TUNING,
    type Theme,
    type TideBackgroundTuning,
    type TideColorMode,
} from '../../../../types';
import { colorWithAlpha } from '../../colorMix';
import BackgroundToggleRow from '../BackgroundToggleRow';
import { TideColorRow, TidePillGroup, TideSectionLabel, TideSliderRow } from './tideSettingsRows';

// src/components/visualizer/backgrounds/tide/TideBackgroundSettingsCard.tsx
// The tide settings panel: how the lyrics are sampled (and how rarely), how the water is shaped,
// and where the colours come from. Rows are declared as small descriptor lists so adding a knob is
// one line here plus one i18n key in the three locales.

interface TideBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    tuning: TideBackgroundTuning;
    onTuningChange?: (patch: Partial<TideBackgroundTuning>) => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

type TideColorTarget = 'waterColor' | 'glintColor' | 'backgroundColor';

interface TideSliderSpec {
    key: keyof TideBackgroundTuning;
    labelKey: string;
    min: number;
    max: number;
    step: number;
    digits?: number;
    format?: (value: number) => string;
}

const INTERACTION_SLIDERS: TideSliderSpec[] = [
    { key: 'intensity', labelKey: 'options.tideIntensity', min: 0, max: 2, step: 0.05 },
    { key: 'spread', labelKey: 'options.tideSpread', min: 0.4, max: 2.5, step: 0.05 },
    {
        key: 'sampleSeconds',
        labelKey: 'options.tideSampleSeconds',
        min: 0.06,
        max: 0.6,
        step: 0.01,
        format: value => `${Math.round(value * 1000)}ms`,
    },
    { key: 'maxAnchors', labelKey: 'options.tideMaxAnchors', min: 1, max: 6, step: 1, digits: 0 },
    { key: 'smoothing', labelKey: 'options.tideSmoothing', min: 0, max: 0.9, step: 0.02 },
];

/** 只在开关打开时才显示的相机强度。 */
const CAMERA_SLIDER: TideSliderSpec = {
    key: 'cameraStrength',
    labelKey: 'options.tideCameraStrength',
    min: 0,
    max: 1,
    step: 0.05,
};

/** 只在跟随歌词打开时才显示的歌词抬升强度。 */
const LYRIC_LIFT_SLIDER: TideSliderSpec = {
    key: 'lyricLift',
    labelKey: 'options.tideLyricLift',
    min: 0,
    max: 2,
    step: 0.05,
};

/** 声音：只重排水面，不碰流体求解器。 */
const SOUND_SLIDERS: TideSliderSpec[] = [
    { key: 'soundReactive', labelKey: 'options.tideSoundReactive', min: 0, max: 2, step: 0.05 },
];

const WATER_SLIDERS: TideSliderSpec[] = [
    { key: 'flow', labelKey: 'options.tideFlow', min: 0, max: 2, step: 0.05 },
    { key: 'dissipation', labelKey: 'options.tideDissipation', min: 0, max: 1, step: 0.01 },
    { key: 'waveScale', labelKey: 'options.tideWaveScale', min: 0.4, max: 2.5, step: 0.05 },
    { key: 'waveSpeed', labelKey: 'options.tideWaveSpeed', min: 0, max: 2.5, step: 0.05 },
    { key: 'chop', labelKey: 'options.tideChop', min: 0, max: 1.5, step: 0.05 },
    { key: 'glintStrength', labelKey: 'options.tideGlintStrength', min: 0, max: 2.5, step: 0.05 },
    { key: 'fog', labelKey: 'options.tideFog', min: 0, max: 1, step: 0.02 },
    { key: 'perspective', labelKey: 'options.tidePerspective', min: 0, max: 1, step: 0.02 },
];

const COLOR_ROWS: { key: TideColorTarget; labelKey: string; }[] = [
    { key: 'waterColor', labelKey: 'options.tideWaterColor' },
    { key: 'glintColor', labelKey: 'options.tideGlintColor' },
    { key: 'backgroundColor', labelKey: 'options.tideBackgroundColor' },
];

const TideBackgroundSettingsCard: React.FC<TideBackgroundSettingsCardProps> = ({
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
    const [colorTarget, setColorTarget] = useState<TideColorTarget>('waterColor');
    const resolved: TideBackgroundTuning = { ...DEFAULT_TIDE_BACKGROUND_TUNING, ...tuning };
    const borderColor = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);
    const colorModeOptions = [
        { value: 'theme' as TideColorMode, label: t('options.tideColorModeTheme') },
        { value: 'custom' as TideColorMode, label: t('options.tideColorModeCustom') },
    ];

    const renderSlider = (spec: TideSliderSpec) => {
        const value = Number(resolved[spec.key]);

        return (
            <TideSliderRow
                key={spec.key}
                label={t(spec.labelKey)}
                value={value}
                valueLabel={spec.format ? spec.format(value) : undefined}
                digits={spec.digits}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                rangeInputClass={rangeInputClass}
                theme={theme}
                onChange={next => onTuningChange?.({ [spec.key]: next } as Partial<TideBackgroundTuning>)}
                onPointerDown={onSliderPointerDown}
                onPointerUp={onSliderCommit}
            />
        );
    };

    return (
        <div className="rounded-[24px] border p-4 space-y-5" style={{ backgroundColor: controlCardBg, borderColor }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                    {t('options.tideBackgroundSettings')}
                </div>
            </div>

            <BackgroundToggleRow
                label={t('options.tideFollowLyrics')}
                description={t('options.tideFollowLyricsDesc')}
                checked={resolved.followLyrics}
                onChange={followLyrics => onTuningChange?.({ followLyrics })}
                theme={theme}
            />
            <BackgroundToggleRow
                label={t('options.tideCameraFollow')}
                description={t('options.tideCameraFollowDesc')}
                checked={resolved.cameraFollow}
                onChange={cameraFollow => onTuningChange?.({ cameraFollow })}
                theme={theme}
            />

            <div className="space-y-4">
                <TideSectionLabel theme={theme}>{t('options.tideSectionInteraction')}</TideSectionLabel>
                {INTERACTION_SLIDERS.map(renderSlider)}
                {resolved.cameraFollow ? renderSlider(CAMERA_SLIDER) : null}
                {resolved.followLyrics ? renderSlider(LYRIC_LIFT_SLIDER) : null}
            </div>

            <div className="space-y-4">
                <TideSectionLabel theme={theme}>{t('options.tideSectionWater')}</TideSectionLabel>
                {WATER_SLIDERS.map(renderSlider)}
            </div>

            <div className="space-y-4">
                <TideSectionLabel theme={theme}>{t('options.tideSectionSound')}</TideSectionLabel>
                {SOUND_SLIDERS.map(renderSlider)}
            </div>

            <div className="space-y-4">
                <TideSectionLabel theme={theme}>{t('options.tideSectionColor')}</TideSectionLabel>
                <TidePillGroup
                    label={t('options.tideColorMode')}
                    value={resolved.colorMode}
                    options={colorModeOptions}
                    onChange={colorMode => onTuningChange?.({ colorMode })}
                    isDaylight={isDaylight}
                    theme={theme}
                />
                {resolved.colorMode === 'custom' ? (
                    <div className="space-y-3">
                        {COLOR_ROWS.map(row => (
                            <TideColorRow
                                key={row.key}
                                label={t(row.labelKey)}
                                color={resolved[row.key]}
                                active={colorTarget === row.key}
                                onSelect={() => setColorTarget(row.key)}
                                isDaylight={isDaylight}
                                theme={theme}
                            />
                        ))}
                        <div
                            className="space-y-3 rounded-[20px] border p-3"
                            style={{
                                borderColor: colorWithAlpha(theme.secondaryColor, 0.14),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.2),
                            }}
                        >
                            <HexColorPicker
                                color={resolved[colorTarget]}
                                onChange={value => onTuningChange?.({ [colorTarget]: value } as Partial<TideBackgroundTuning>)}
                                onPointerUp={onSliderCommit}
                                style={{ width: '100%', height: 160 }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="text-xs opacity-60" style={{ color: theme.primaryColor }}>
                        {t('options.tideColorThemeHint')}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TideBackgroundSettingsCard;
