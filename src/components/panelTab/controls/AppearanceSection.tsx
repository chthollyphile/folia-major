import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme, ThemeMode, VisualizerBackgroundMode, VisualizerMode } from '../../../types';
import type { ThemeSourceModel } from '../../../hooks/themeControllerState';
import { getVisualizerModeLabel, getVisualizerRegistryEntry, VISUALIZER_REGISTRY } from '../../visualizer/registry';
import {
    getVisualizerBackgroundModeLabel,
    getVisualizerBackgroundRegistryEntry,
    VISUALIZER_BACKGROUND_REGISTRY,
} from '../../visualizer/backgrounds/registry';
import { resolveVisualizerBackgroundMode } from '../../../stores/visualizerSettingsPersistence';
import { useVisualizerModeStepper } from '../../../hooks/useVisualizerModeStepper';
import { QuickControlChip, QuickControlToggle } from '../../shared/QuickControlChip';
import { WholeWord } from 'lucide-react';
import { openCommandPaletteCommand } from '../../../stores/useAppViewStore';
import { useLyricSegmentationStore } from '../../../stores/useLyricSegmentationStore';
import { LYRIC_SEGMENTATION_COMMAND_ID } from '../../command-palette/commands/lyricSegmentationCommand';
import ModeStepperRow from './ModeStepperRow';
import ThemeSourceRow from './ThemeSourceRow';
import { BackgroundModeGlyph, VisualizerModeGlyph } from '../../visualizer/modeGlyphs';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';

// src/components/panelTab/controls/AppearanceSection.tsx
// 外观区：歌词样式、背景、主题来源三件事放在一起。
// 前两行是「‹ 字形 当前模式 参数 ›」取景器；背景的模式专属参数由背景注册表自己提供，
// 面板不再按模式写 if 链，新增背景模式会自带快捷控件。

interface AppearanceSectionProps {
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    useCoverColorBg: boolean;
    onToggleCoverColorBg: (enable: boolean) => void;
    themeSourceModel: ThemeSourceModel;
    onBgModeChange: (mode: ThemeMode) => void;
    hasCustomTheme: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    onClosePanel?: () => void;
}

const ANIMATION_INTENSITIES: Theme['animationIntensity'][] = ['calm', 'normal', 'chaotic'];

const AppearanceSection: React.FC<AppearanceSectionProps> = ({
    theme,
    onThemeChange,
    isDaylight,
    visualizerMode,
    onVisualizerModeChange,
    useCoverColorBg,
    onToggleCoverColorBg,
    themeSourceModel,
    onBgModeChange,
    hasCustomTheme,
    defaultTheme,
    daylightTheme,
    onClosePanel,
}) => {
    const { t } = useTranslation();
    const openSettings = useSettingsModalStore(state => state.openSettings);
    // Only the modes whose typography is built from word segmentation get the chip; the registry
    // says which, so adding such a mode does not mean editing a list here.
    const usesWordSegmentation = Boolean(getVisualizerRegistryEntry(visualizerMode).usesWordSegmentation);
    const hasSavedSegmentation = useLyricSegmentationStore(state => Boolean(state.record));
    const visualizerBackgroundMode = useVisualizerSettingsStore(state => state.visualizerBackgroundMode);
    const setVisualizerBackgroundMode = useVisualizerSettingsStore(state => state.handleSetVisualizerBackgroundMode);
    const monetBackgroundTuning = useVisualizerSettingsStore(state => state.monetBackgroundTuning);
    const setMonetBackgroundTuning = useVisualizerSettingsStore(state => state.handleSetMonetBackgroundTuning);
    const nomandBackgroundTuning = useVisualizerSettingsStore(state => state.nomandBackgroundTuning);
    const setNomandBackgroundTuning = useVisualizerSettingsStore(state => state.handleSetNomandBackgroundTuning);
    const latentBackgroundTuning = useVisualizerSettingsStore(state => state.latentBackgroundTuning);
    const setLatentBackgroundTuning = useVisualizerSettingsStore(state => state.handleSetLatentBackgroundTuning);
    const soraBackgroundTuning = useVisualizerSettingsStore(state => state.soraBackgroundTuning);
    const setSoraBackgroundTuning = useVisualizerSettingsStore(state => state.handleSetSoraBackgroundTuning);

    const visualizerOptions = useMemo(
        () => VISUALIZER_REGISTRY.map(entry => ({
            value: entry.mode,
            label: getVisualizerModeLabel(entry.mode, t),
        })),
        [t],
    );
    const visualizerModes = useMemo(() => visualizerOptions.map(option => option.value), [visualizerOptions]);
    const stepVisualizerMode = useVisualizerModeStepper(visualizerModes);

    const backgroundOptions = useMemo(
        () => VISUALIZER_BACKGROUND_REGISTRY.map(entry => ({
            value: entry.mode,
            label: getVisualizerBackgroundModeLabel(entry.mode, t),
        })),
        [t],
    );
    const resolvedBackgroundMode = resolveVisualizerBackgroundMode(visualizerBackgroundMode, visualizerMode);

    const stepBackgroundMode = (direction: -1 | 1) => {
        if (backgroundOptions.length < 2) {
            return;
        }

        const index = backgroundOptions.findIndex(option => option.value === resolvedBackgroundMode);
        const nextIndex = ((index < 0 ? 0 : index) + direction + backgroundOptions.length) % backgroundOptions.length;
        setVisualizerBackgroundMode(backgroundOptions[nextIndex].value);
    };

    const openVisualizerSettings = () => {
        openSettings('options', 'visualizer', 'visualizer');
        onClosePanel?.();
    };

    const openBackgroundSettings = () => {
        openSettings('options', 'visualizer', 'background');
        onClosePanel?.();
    };

    const cycleAnimationIntensity = () => {
        const currentIndex = ANIMATION_INTENSITIES.indexOf(theme.animationIntensity);
        onThemeChange({
            ...theme,
            animationIntensity: ANIMATION_INTENSITIES[(currentIndex + 1) % ANIMATION_INTENSITIES.length],
        });
    };

    const backgroundQuickControls = getVisualizerBackgroundRegistryEntry(resolvedBackgroundMode).renderQuickControls?.({
        config: {
            common: { useCoverColorBg },
            monet: { tuning: monetBackgroundTuning },
            nomand: { tuning: nomandBackgroundTuning },
            latent: { tuning: latentBackgroundTuning },
            sora: { tuning: soraBackgroundTuning },
        },
        actions: {
            common: { onCoverColorChange: onToggleCoverColorBg },
            monet: { onTuningChange: setMonetBackgroundTuning },
            nomand: { onTuningChange: setNomandBackgroundTuning },
            latent: { onTuningChange: setLatentBackgroundTuning },
            sora: { onTuningChange: setSoraBackgroundTuning },
        },
        t,
        isDaylight,
        theme,
    });

    return (
        <div className="space-y-1">
            {/* 思索「歌词样式」的埋点：两行一起算，因为那一章讲的就是歌词和背景各选各的。 */}
            <div data-ponder="lyric-style" className="space-y-1">
                <ModeStepperRow<VisualizerMode>
                    value={visualizerMode}
                    options={visualizerOptions}
                    onSelect={onVisualizerModeChange}
                    onStep={stepVisualizerMode}
                    renderGlyph={mode => <VisualizerModeGlyph mode={mode} />}
                    ariaLabel={t('ui.animationMode')}
                    moreLabel={t('ui.moreSettings')}
                    onOpenMore={openVisualizerSettings}
                    isDaylight={isDaylight}
                    primaryColor={theme.primaryColor}
                    trailing={(
                        <>
                            <QuickControlChip
                                isDaylight={isDaylight}
                                label={t(`animation.${theme.animationIntensity}`)}
                                title={`${t('ui.animationIntensity')}: ${t(`animation.${theme.animationIntensity}`)}`}
                                onClick={cycleAnimationIntensity}
                            />
                            {usesWordSegmentation && (
                                <QuickControlToggle
                                    active={hasSavedSegmentation}
                                    theme={theme}
                                    label={t('commandPalette.commands.lyric-segmentation.title')}
                                    onToggle={() => {
                                        openCommandPaletteCommand(LYRIC_SEGMENTATION_COMMAND_ID);
                                        onClosePanel?.();
                                    }}
                                >
                                    <WholeWord size={14} />
                                </QuickControlToggle>
                            )}
                        </>
                    )}
                />

                <ModeStepperRow<VisualizerBackgroundMode>
                    value={resolvedBackgroundMode}
                    options={backgroundOptions}
                    onSelect={setVisualizerBackgroundMode}
                    onStep={stepBackgroundMode}
                    renderGlyph={mode => <BackgroundModeGlyph mode={mode} />}
                    ariaLabel={t('options.visualizerBackgroundMode')}
                    moreLabel={t('ui.moreSettings')}
                    onOpenMore={openBackgroundSettings}
                    isDaylight={isDaylight}
                    primaryColor={theme.primaryColor}
                    trailing={backgroundQuickControls}
                />
            </div>

            <div className="pt-1">
                <ThemeSourceRow
                    themeSourceModel={themeSourceModel}
                    onBgModeChange={onBgModeChange}
                    hasCustomTheme={hasCustomTheme}
                    defaultTheme={defaultTheme}
                    daylightTheme={daylightTheme}
                    isDaylight={isDaylight}
                />
            </div>
        </div>
    );
};

export default AppearanceSection;
