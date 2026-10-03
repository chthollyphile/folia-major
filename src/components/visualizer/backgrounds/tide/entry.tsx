import React from 'react';
import { Waves } from 'lucide-react';
import { DEFAULT_TIDE_BACKGROUND_TUNING } from '../../../../types';
import { QuickControlToggle } from '../../../shared/QuickControlChip';
import { defineVisualizerBackground } from '../definition';
import TideBackground from './TideBackground';
import TideBackgroundSettingsCard from './TideBackgroundSettingsCard';

// src/components/visualizer/backgrounds/tide/entry.tsx
// Registers the tide background: a fluid layer that is stirred by where the lyrics actually are,
// and whose surface is voiced by the music.

export default defineVisualizerBackground({
    mode: 'tide',
    order: 45,
    labelKey: 'options.visualizerBackgroundModeTide',
    labelFallback: 'Tide',
    render: ({
        config,
        theme,
        isDaylight,
        paused,
        staticMode,
        stageRef,
        lines,
        currentLineIndex,
        currentTime,
        audioPower,
        audioBands,
    }) => (
        <div className="absolute inset-0 z-0" style={{ backgroundColor: isDaylight ? '#ffffff' : '#000000' }}>
            <TideBackground
                theme={theme}
                isDaylight={isDaylight}
                staticMode={staticMode}
                paused={paused}
                tuning={config?.tide?.tuning ?? DEFAULT_TIDE_BACKGROUND_TUNING}
                stageRef={stageRef}
                lines={lines}
                currentLineIndex={currentLineIndex}
                currentTime={currentTime}
                audioPower={audioPower}
                audioBands={audioBands}
            />
        </div>
    ),
    renderSettingsPanel: ({ config, actions, t, isDaylight, theme, controlCardBg, rangeInputClass, onSliderPointerDown, onSliderCommit }) => (
        <TideBackgroundSettingsCard
            t={t}
            isDaylight={isDaylight}
            theme={theme}
            controlCardBg={controlCardBg}
            rangeInputClass={rangeInputClass}
            tuning={config?.tide?.tuning ?? DEFAULT_TIDE_BACKGROUND_TUNING}
            onTuningChange={actions?.tide?.onTuningChange}
            onSliderPointerDown={onSliderPointerDown}
            onSliderCommit={onSliderCommit}
        />
    ),
    renderQuickControls: ({ config, actions, t, theme }) => {
        const tuning = config?.tide?.tuning ?? DEFAULT_TIDE_BACKGROUND_TUNING;
        return (
            <div className="flex items-center gap-1.5">
                <QuickControlToggle
                    active={tuning.followLyrics}
                    theme={theme}
                    label={t('options.tideFollowLyrics')}
                    onToggle={() => actions?.tide?.onTuningChange?.({ followLyrics: !tuning.followLyrics })}
                >
                    <Waves size={14} />
                </QuickControlToggle>
            </div>
        );
    },
    resetSettings: actions => actions?.tide?.onResetTuning?.(),
});
