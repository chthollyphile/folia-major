import React, { useMemo } from 'react';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useSmartBeatAvailability } from '../../hooks/useSmartBeatAvailability';
import { colorWithAlpha } from './colorMix';
import type { VisualizerSettingsPanelProps } from './definition';
import VisualizerPresetGroup, { type VisualizerPresetOption } from './VisualizerPresetGroup';
import { SonnetRangeControl } from './sonnet/SonnetSettingsControls';

// src/components/visualizer/SmartBeatSettingsCard.tsx
// 智能动感模式's one switch and two strengths, under the lyric renderer picker: it is a setting of
// the whole picture, driving every mode and background that draws beat FX, so it sits with no one
// mode's panel. Reads and writes the settings store itself; nothing about it is a per-mode draft.

type SmartBeatSettingsCardProps = Pick<
    VisualizerSettingsPanelProps,
    't' | 'isDaylight' | 'theme' | 'controlCardBg' | 'rangeInputClass' | 'onSliderPointerDown' | 'onSliderCommit'
>;

const SmartBeatSettingsCard: React.FC<SmartBeatSettingsCardProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const smartBeat = useVisualizerSettingsStore(state => state.smartBeat);
    const setSmartBeat = useVisualizerSettingsStore(state => state.handleSetSmartBeat);
    const availability = useSmartBeatAvailability(smartBeat.enabled);
    const unavailableReason = availability === 'ready' ? null : t(`options.beatFxUnavailable_${availability}`);

    const switchOptions: VisualizerPresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.smartBeatOn') },
        { value: false, label: t('options.smartBeatOff') },
    ]), [t]);

    return (
        <div
            className="rounded-[24px] border p-4 space-y-4"
            style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                    {t('options.smartBeat')}
                </div>
                <div className="text-xs leading-relaxed opacity-70" style={{ color: theme.secondaryColor }}>
                    {t('options.smartBeatDesc')}
                </div>
            </div>
            <VisualizerPresetGroup
                label={t('options.smartBeatEnabled')}
                value={smartBeat.enabled}
                options={switchOptions}
                onChange={enabled => setSmartBeat({ enabled })}
                isDaylight={isDaylight}
                theme={theme}
            />
            {unavailableReason && (
                <p className="text-xs leading-relaxed" style={{ color: theme.primaryColor }}>
                    {unavailableReason}
                </p>
            )}
            {smartBeat.enabled && (
                <>
                    <SonnetRangeControl
                        label={t('options.smartBeatBeatIntensity')}
                        value={smartBeat.beatIntensity}
                        rangeInputClass={rangeInputClass}
                        onChange={beatIntensity => setSmartBeat({ beatIntensity })}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                    />
                    <SonnetRangeControl
                        label={t('options.smartBeatDownbeatIntensity')}
                        value={smartBeat.downbeatIntensity}
                        rangeInputClass={rangeInputClass}
                        onChange={downbeatIntensity => setSmartBeat({ downbeatIntensity })}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                    />
                </>
            )}
        </div>
    );
};

export default SmartBeatSettingsCard;
