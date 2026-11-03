import React from 'react';
import { Theme, ThemeMode, VisualizerMode } from '../../types';
import type { ThemeSourceModel } from '../../hooks/themeControllerState';
import AudioEqualizerDialog from './AudioEqualizerDialog';
import AppearanceSection from './controls/AppearanceSection';
import SoundTiles from './controls/SoundTiles';
import ThemeNameRow from './controls/ThemeNameRow';
import ThemeSourceRow from './controls/ThemeSourceRow';
import VolumeRow from './controls/VolumeRow';
import { GroupLine } from './shell/GroupLine';

// src/components/panelTab/ControlsTab.tsx
// 控制标签页只负责装配，三组：声音（音量和三块）、外观（歌词样式、背景、播放页透明背景）、主题（来源和当前主题那一行）。

interface ControlsTabProps {
    loopMode: 'off' | 'all' | 'one';
    onToggleLoop: () => void;
    onGenerateAITheme: () => void;
    isGeneratingTheme: boolean;
    canGenerateAITheme: boolean;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    onBgModeChange: (mode: ThemeMode) => void;
    hasCustomTheme: boolean;
    themeSourceModel: ThemeSourceModel;
    defaultTheme: Theme;
    daylightTheme: Theme;
    visualizerMode: VisualizerMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    useCoverColorBg: boolean;
    onToggleCoverColorBg: (enable: boolean) => void;
    transparentPlayerBackground: boolean;
    onToggleTransparentPlayerBackground: (enable: boolean) => void;
    isDaylight: boolean;
    onToggleDaylight: () => void;
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
    loopToggleDisabled?: boolean;
    onClosePanel?: () => void;
}

const ControlsTab: React.FC<ControlsTabProps> = ({
    loopMode,
    onToggleLoop,
    onGenerateAITheme,
    isGeneratingTheme,
    canGenerateAITheme,
    theme,
    onThemeChange,
    onBgModeChange,
    hasCustomTheme,
    themeSourceModel,
    defaultTheme,
    daylightTheme,
    visualizerMode,
    onVisualizerModeChange,
    useCoverColorBg,
    onToggleCoverColorBg,
    transparentPlayerBackground,
    onToggleTransparentPlayerBackground,
    isDaylight,
    onToggleDaylight,
    volume,
    isMuted,
    onVolumePreview,
    onVolumeChange,
    onToggleMute,
    loopToggleDisabled = false,
    onClosePanel,
}) => (
    <div>
        <VolumeRow
            volume={volume}
            isMuted={isMuted}
            onVolumePreview={onVolumePreview}
            onVolumeChange={onVolumeChange}
            onToggleMute={onToggleMute}
        />
        <SoundTiles
            loopMode={loopMode}
            onToggleLoop={onToggleLoop}
            loopToggleDisabled={loopToggleDisabled}
        />

        <GroupLine />

        <AppearanceSection
            theme={theme}
            onThemeChange={onThemeChange}
            isDaylight={isDaylight}
            visualizerMode={visualizerMode}
            onVisualizerModeChange={onVisualizerModeChange}
            useCoverColorBg={useCoverColorBg}
            onToggleCoverColorBg={onToggleCoverColorBg}
            transparentPlayerBackground={transparentPlayerBackground}
            onToggleTransparentPlayerBackground={onToggleTransparentPlayerBackground}
            onClosePanel={onClosePanel}
        />

        <GroupLine />

        <ThemeSourceRow
            themeSourceModel={themeSourceModel}
            onBgModeChange={onBgModeChange}
            hasCustomTheme={hasCustomTheme}
            defaultTheme={defaultTheme}
            daylightTheme={daylightTheme}
            isDaylight={isDaylight}
        />
        <ThemeNameRow
            theme={theme}
            themeSourceModel={themeSourceModel}
            defaultTheme={defaultTheme}
            daylightTheme={daylightTheme}
            onGenerateAITheme={onGenerateAITheme}
            isGeneratingTheme={isGeneratingTheme}
            canGenerateAITheme={canGenerateAITheme}
            isDaylight={isDaylight}
            onToggleDaylight={onToggleDaylight}
        />

        <AudioEqualizerDialog isDaylight={isDaylight} />
    </div>
);

export default ControlsTab;
