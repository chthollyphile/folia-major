import React, { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerState, type Theme, type VisualizerBackgroundMode, type VisualizerMode } from '../../../types';
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
import { BackgroundModeGlyph } from '../../visualizer/modeGlyphs';
import { panelMakesImages, panelPictureTheme } from './panelPictures';
import BackgroundPicture from '../../visualizer/preview/BackgroundPicture';
import { LyricPreviewProvider, type LyricPreviewLook } from '../../visualizer/preview/LyricPreviewContext';
import { drawLyricStyleChoice, drawLyricStyleChoiceGlyph, RANDOM_VISUALIZER_CHOICE, selectLyricStyleChoice } from '../../visualizer/random/lyricStyleChoices';
import RandomPoolPicker from '../../visualizer/random/RandomPoolPicker';
import { useRandomPool } from '../../visualizer/random/useRandomPool';
import { usePreviewClock } from '../../visualizer/preview/usePreviewClock';
import { backgroundTuningActions, getVisualizerTuning } from '../../visualizer/tuningRegistry';
import type { VisualizerTuningSettings } from '../../visualizer/tuningDefinition';
import { useVisualizerBackgroundConfig } from '../../visualizer/useVisualizerBackgroundConfig';
import { useVisualizerTunings } from '../../visualizer/useVisualizerTunings';
import { useTypographySettingsStore } from '../../../stores/useTypographySettingsStore';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';
import { selectDisplayPlayerState, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { usePonderStore } from '../../../stores/usePonderStore';
import { Toggle, type PictureState } from '../../modal/settings/kit';

// src/components/panelTab/controls/AppearanceSection.tsx
// 外观区：歌词样式、背景、播放页透明背景三件事放在一起。
// 前两行是「‹ 字形 当前模式 ›」取景器：歌词样式的动画强度在按钮右侧，分词开关和背景参数在按钮下面一行，
// 没有就收起；背景的模式专属参数由背景注册表自己提供，
// 面板不再按模式写 if 链，新增背景模式会自带快捷控件。
// 行里只有字形；点开后的一格一格小图画的是真的样式和背景，用的是当前主题和已保存的设置；
// 它们共用这里的一个预览时钟，只有某一行的选择器开着时时钟才走。
// 歌在放的时候，只有选择器开着才做小图，换歌带来的新主题也要等下一次打开选择器才用上（panelPictures.ts）。
// 歌词样式选「随机」时，下面一行是这首歌抽到的样式和「选择随机池」：前者点一下从随机池里另抽一种，后者打开随机池的多选层（RandomPoolPicker.tsx），
// 那里每格只画样式的字形、不画小图，所以它开着时时钟不走，也不做小图。

interface AppearanceSectionProps {
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    useCoverColorBg: boolean;
    onToggleCoverColorBg: (enable: boolean) => void;
    transparentPlayerBackground: boolean;
    onToggleTransparentPlayerBackground: (enable: boolean) => void;
    onClosePanel?: () => void;
}

const ANIMATION_INTENSITIES: Theme['animationIntensity'][] = ['calm', 'normal', 'chaotic'];

const drawBackground = (mode: VisualizerBackgroundMode, state: PictureState) => <BackgroundPicture mode={mode} {...state} />;
const drawBackgroundGlyph = (mode: VisualizerBackgroundMode) => <BackgroundModeGlyph mode={mode} size={18} />;

type PictureTheme = { theme: Theme; isDaylight: boolean };

const AppearanceSection: React.FC<AppearanceSectionProps> = ({
    theme,
    onThemeChange,
    isDaylight,
    visualizerMode,
    onVisualizerModeChange,
    useCoverColorBg,
    onToggleCoverColorBg,
    transparentPlayerBackground,
    onToggleTransparentPlayerBackground,
    onClosePanel,
}) => {
    const { t } = useTranslation();
    const transparentLabelId = useId();
    const openSettings = useSettingsModalStore(state => state.openSettings);
    // Only the modes whose typography is built from word segmentation get the chip; the registry
    // says which, so adding such a mode does not mean editing a list here.
    const usesWordSegmentation = Boolean(getVisualizerRegistryEntry(visualizerMode).usesWordSegmentation);
    const hasSavedSegmentation = useLyricSegmentationStore(state => Boolean(state.record));
    const randomEnabled = useVisualizerSettingsStore(state => state.randomVisualizerModePerSong);
    const randomPool = useRandomPool();
    const visualizerBackgroundMode = useVisualizerSettingsStore(state => state.visualizerBackgroundMode);
    const setVisualizerBackgroundMode = useVisualizerSettingsStore(state => state.handleSetVisualizerBackgroundMode);

    const visualizerOptions = useMemo(
        () => [
            ...VISUALIZER_REGISTRY.map(entry => ({
                value: entry.mode,
                label: getVisualizerModeLabel(entry.mode, t),
            })),
            { value: RANDOM_VISUALIZER_CHOICE, label: t('ui.visualizerRandom') },
        ],
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

    // Which row's picker is open, if any (the random pool's is the style row's second one). The
    // pictures' clock runs only while one of the two rows' pictures is open: a picture moves only
    // while the pointer rests on it in an open picker. The pool's layer draws glyphs, no pictures.
    const [openPicker, setOpenPicker] = useState<'style' | 'pool' | 'background' | null>(null);
    const picturesOpen = openPicker === 'style' || openPicker === 'background';
    const poolChipRef = useRef<HTMLButtonElement>(null);
    const isPlaying = usePlaybackStore(state => selectDisplayPlayerState(state) === PlayerState.PLAYING);
    const pageTheme = useMemo<PictureTheme>(() => ({ theme, isDaylight }), [theme, isDaylight]);
    // No picture is drawn before a picker opens, and opening one takes the page's theme.
    const [pictureTheme, setPictureTheme] = useState(pageTheme);
    const followedTheme = panelPictureTheme(pictureTheme, pageTheme, { playing: isPlaying, pickerOpens: false });
    if (followedTheme !== pictureTheme) {
        setPictureTheme(followedTheme);
    }
    const changeOpenPicker = (next: 'style' | 'pool' | 'background' | null) => {
        setOpenPicker(next);
        if (next === 'style' || next === 'background') {
            setPictureTheme(held => panelPictureTheme(held, pageTheme, { playing: isPlaying, pickerOpens: true }));
        }
        if (next !== null) {
            // The rows' Ponder hint, if it is showing, would lie over the picker (lyricStyle.target.ts keeps it away while one is open).
            usePonderStore.getState().setHoveredTargetId(null);
        }
    };
    const previewClock = usePreviewClock({ mode: visualizerMode, paused: !picturesOpen });
    const visualizerTunings = useVisualizerTunings();
    const lyricsFontScale = useTypographySettingsStore(state => state.lyricsFontScale);
    const pictureLook = useMemo<LyricPreviewLook>(() => ({ visualizerTunings, lyricsFontScale }), [visualizerTunings, lyricsFontScale]);
    const pictureBackground = useVisualizerBackgroundConfig();

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

    // The style's own quick controls get its tuning as it is saved, and a change that is saved at once
    // through the store action its tuning.ts names (an action needs no subscription).
    const styleTuning = getVisualizerTuning(visualizerMode);
    const styleQuickControls = getVisualizerRegistryEntry(visualizerMode).renderQuickControls?.({
        t,
        isDaylight,
        theme,
        tuning: styleTuning?.read(visualizerTunings),
        onTuningChange: (patch) => {
            const save = styleTuning && (useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>)[styleTuning.settingsSetterKey];
            if (typeof save === 'function') {
                save(patch);
            }
        },
        settings: useVisualizerSettingsStore.getState() as unknown as VisualizerTuningSettings,
        onClosePanel,
    });
    const hasStyleQuickControls = styleQuickControls !== null && styleQuickControls !== undefined && styleQuickControls !== false;

    const backgroundQuickControls = getVisualizerBackgroundRegistryEntry(resolvedBackgroundMode).renderQuickControls?.({
        // The backgrounds' tunings as they are saved, and the store's actions for them (an action needs no subscription).
        config: { ...pictureBackground, common: { ...pictureBackground.common, useCoverColorBg } },
        actions: {
            common: {
                onCoverColorChange: onToggleCoverColorBg,
                onDisableVignetteChange: useVisualizerSettingsStore.getState().handleToggleDisableVisualizerVignette,
            },
            ...backgroundTuningActions(useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>),
        },
        t,
        isDaylight,
        theme,
    });

    return (
        <div>
            {/* 思索「歌词样式」的埋点：两行一起算，因为那一章讲的就是歌词和背景各选各的。 */}
            <div data-ponder="lyric-style">
                <LyricPreviewProvider
                    clock={previewClock}
                    theme={pictureTheme.theme}
                    isDaylight={pictureTheme.isDaylight}
                    look={pictureLook}
                    background={pictureBackground}
                    making={panelMakesImages({ playing: isPlaying, pickerOpen: picturesOpen })}
                >
                    <ModeStepperRow<VisualizerMode>
                        value={randomEnabled ? RANDOM_VISUALIZER_CHOICE : visualizerMode}
                        options={visualizerOptions}
                        onSelect={mode => selectLyricStyleChoice(mode, onVisualizerModeChange)}
                        onStep={stepVisualizerMode}
                        renderGlyph={drawLyricStyleChoiceGlyph}
                        renderPicture={drawLyricStyleChoice}
                        caption={t('ui.animationMode')}
                        moreLabel={t('ui.moreSettings')}
                        onOpenMore={openVisualizerSettings}
                        open={openPicker === 'style'}
                        onOpenChange={open => changeOpenPicker(open ? 'style' : null)}
                        aside={(
                            <QuickControlChip
                                label={t(`animation.${theme.animationIntensity}`)}
                                title={`${t('ui.animationIntensity')}: ${t(`animation.${theme.animationIntensity}`)}`}
                                onClick={cycleAnimationIntensity}
                            />
                        )}
                        params={randomEnabled ? (
                            <>
                                {/* 这首歌抽到的样式：点一下从随机池里另抽一种。 */}
                                <QuickControlChip
                                    label={getVisualizerModeLabel(visualizerMode, t)}
                                    title={`${t('options.randomVisualizerReroll')}: ${getVisualizerModeLabel(visualizerMode, t)}`}
                                    disabled={!randomPool.canReroll}
                                    onClick={randomPool.reroll}
                                />
                                <QuickControlChip
                                    buttonRef={poolChipRef}
                                    expanded={openPicker === 'pool'}
                                    label={t('options.randomPoolChoose')}
                                    title={`${t('options.randomPoolChoose')}: ${randomPool.countLabel}`}
                                    onClick={() => changeOpenPicker(openPicker === 'pool' ? null : 'pool')}
                                />
                            </>
                        ) : (usesWordSegmentation || hasStyleQuickControls) && (
                            <>
                                {usesWordSegmentation && (
                                    <QuickControlToggle
                                        active={hasSavedSegmentation}
                                        label={t('commandPalette.commands.lyric-segmentation.title')}
                                        onToggle={() => {
                                            openCommandPaletteCommand(LYRIC_SEGMENTATION_COMMAND_ID);
                                            onClosePanel?.();
                                        }}
                                    >
                                        <WholeWord size={14} />
                                    </QuickControlToggle>
                                )}
                                {styleQuickControls}
                            </>
                        )}
                    />
                    {/* The pool's layer stays mounted while it leaves (Popover); it opens from the chip above. */}
                    <RandomPoolPicker
                        anchorRef={poolChipRef}
                        open={randomEnabled && openPicker === 'pool'}
                        onClose={() => changeOpenPicker(null)}
                        moreLabel={t('ui.moreSettings')}
                        onOpenMore={openVisualizerSettings}
                    />

                    <ModeStepperRow<VisualizerBackgroundMode>
                        value={resolvedBackgroundMode}
                        options={backgroundOptions}
                        onSelect={setVisualizerBackgroundMode}
                        onStep={stepBackgroundMode}
                        renderGlyph={drawBackgroundGlyph}
                        renderPicture={drawBackground}
                        caption={t('options.visualizerBackgroundMode')}
                        moreLabel={t('ui.moreSettings')}
                        onOpenMore={openBackgroundSettings}
                        open={openPicker === 'background'}
                        onOpenChange={open => changeOpenPicker(open ? 'background' : null)}
                        params={backgroundQuickControls}
                    />
                </LyricPreviewProvider>
            </div>

            {/* Only the switch turns it; the text names it for a screen reader. */}
            {/* <div className="flex min-h-11 items-center gap-3 py-1.5">
                <span id={transparentLabelId} className="min-w-0 flex-1 text-sm leading-5">{t('options.transparentPlayerBackground')}</span>
                <Toggle checked={transparentPlayerBackground} onChange={onToggleTransparentPlayerBackground} labelledBy={transparentLabelId} />
            </div> */}
        </div>
    );
};

export default AppearanceSection;
