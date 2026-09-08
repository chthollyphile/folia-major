import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    CappellaAvatarImage,
    CappellaEmojiImage,
    DualTheme,
    MonetPortraitImage,
    SongResult,
    SubtitleContentMode,
    Theme,
    VisualizerMode,
} from '../../types';
import { getVisualizerModeLabel } from '../visualizer/registry';
import { normalizeThemeHexColor } from '../../services/themeSanitizer';
import { BASE_DUAL_THEME } from '../../services/baseThemes';
import type { ThemeCacheSongKey } from '../../services/themeCache';
import { extractColors } from '../../utils/colorExtractor';
import { buildRecommendedColors } from '../../utils/themeEditorPalette';
import { useThemeQuickEditorStore } from '../../stores/useThemeQuickEditorStore';
import type { VisualizerTuningBundle } from '../visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../visualizer/backgrounds/definition';
import ThemePreview from './theme-park/ThemeParkPreview';
import ThemeParkHeader from './theme-park/ThemeParkHeader';
import ThemeParkColorPanel from './theme-park/ThemeParkColorPanel';
import ThemeParkDetailsPanel from './theme-park/ThemeParkDetailsPanel';
import ThemeParkContentPanel from './theme-park/ThemeParkContentPanel';
import ThemeParkAiPanel from './theme-park/ThemeParkAiPanel';
import { useThemeParkDraft } from './theme-park/useThemeParkDraft';
import { useThemeParkPreviewClock } from './theme-park/useThemeParkPreviewClock';
import {
    isDualThemeNameValid,
    type EditableMode,
    type ThemeEditTarget,
    type ThemeParkTab,
} from './theme-park/themeParkDraft';

// src/components/modal/ThemePark.tsx
// Full theme editor: live visualizer preview on the left, and a tabbed editor on the right that
// covers every editable Theme field (colors, names/descriptions, word colors and lyric icons,
// plus the manual AI JSON round trip). The edit target — the song's AI theme or the saved custom
// theme — is chosen inside the editor; both drafts stay alive while the modal is open.

interface ThemeParkProps {
    initialTheme: DualTheme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    visualizerTunings?: VisualizerTuningBundle;
    staticMode?: boolean;
    visualizerOpacity?: number;
    backgroundConfig?: VisualizerBackgroundConfig;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    monetPortraitImage?: MonetPortraitImage | null;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsFontWeight?: number | null;
    lyricsCustomFontFamily?: string | null;
    onClose: () => void;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onSaveAiTheme: (dualTheme: DualTheme, song: SongResult | null, songKey: ThemeCacheSongKey | null) => void;
}

const TABS: Array<{ id: ThemeParkTab; labelKey: string; }> = [
    { id: 'colors', labelKey: 'theme.tabColors' },
    { id: 'details', labelKey: 'theme.tabDetails' },
    { id: 'content', labelKey: 'theme.tabContent' },
    { id: 'ai', labelKey: 'theme.tabAi' },
];

const ThemePark: React.FC<ThemeParkProps> = ({
    initialTheme,
    isDaylight,
    visualizerMode,
    visualizerTunings,
    staticMode = false,
    visualizerOpacity = 1,
    backgroundConfig,
    cappellaCustomEmojiImages = [],
    cappellaCustomAvatarImages = [],
    monetPortraitImage = null,
    showSubtitleTranslation = true,
    subtitleContentMode,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsFontWeight,
    lyricsCustomFontFamily,
    onClose,
    onSaveCustomTheme,
    onSaveAiTheme,
}) => {
    const { t } = useTranslation();
    const isMouseDownOnOverlayRef = useRef(false);
    const [isPaused, setIsPaused] = useState(false);
    const [activeTab, setActiveTab] = useState<ThemeParkTab>('colors');
    const [coverColors, setCoverColors] = useState<string[]>([]);

    // Shared theme-editing context (also feeding the quick editor): the live AI / custom themes
    // plus the current song, so a saved AI theme lands on the right cache entry.
    const { aiTheme, customTheme, bgMode, coverUrl, song, songKey, promptSourceText, isPureMusic, songTitle } = useThemeQuickEditorStore(
        useShallow(state => ({
            aiTheme: state.aiTheme,
            customTheme: state.customTheme,
            bgMode: state.bgMode,
            coverUrl: state.coverUrl,
            song: state.song,
            songKey: state.songKey,
            promptSourceText: state.promptSourceText,
            isPureMusic: state.isPureMusic,
            songTitle: state.songTitle,
        })),
    );

    const {
        target,
        setTarget,
        mode,
        setMode,
        activeColorKey,
        setActiveColorKey,
        draft,
        safeDraft,
        baseTheme,
        updateColorThrottled,
        updateColorInstant,
        updateModeField,
        updateSharedField,
        replaceDraft,
        reset,
        buildFinalTheme,
    } = useThemeParkDraft({
        aiTheme,
        customTheme,
        bgMode,
        seedTheme: initialTheme,
        isDaylight,
        defaultCustomTheme: BASE_DUAL_THEME,
    });

    const { currentTime, audioPower, audioBands, currentLineIndex } = useThemeParkPreviewClock(visualizerMode, isPaused);

    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-950/88';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const controlCardBg = isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)';
    const overlayBackground = isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';
    const visualizerModeLabel = getVisualizerModeLabel(visualizerMode, t);

    const recommendedColors = useMemo(
        () => buildRecommendedColors(baseTheme, coverColors),
        [baseTheme, coverColors],
    );

    const previewTheme = useMemo<DualTheme>(() => ({
        light: {
            ...safeDraft.light,
            fontStyle: lyricsFontStyle,
            fontWeight: lyricsFontWeight ?? undefined,
            fontFamily: lyricsCustomFontFamily ?? undefined,
        },
        dark: {
            ...safeDraft.dark,
            fontStyle: lyricsFontStyle,
            fontWeight: lyricsFontWeight ?? undefined,
            fontFamily: lyricsCustomFontFamily ?? undefined,
        },
    }), [safeDraft, lyricsCustomFontFamily, lyricsFontStyle, lyricsFontWeight]);

    const isNameValid = isDualThemeNameValid(draft);

    const handleHexCommit = () => {
        updateModeField({
            [activeColorKey]: normalizeThemeHexColor(draft[mode][activeColorKey], baseTheme[mode][activeColorKey]),
        });
    };

    const handleSave = () => {
        if (!isNameValid) {
            return;
        }

        const finalTheme = buildFinalTheme();
        if (target === 'custom') {
            onSaveCustomTheme(finalTheme);
        } else {
            onSaveAiTheme(finalTheme, song, songKey);
        }
    };

    // 仅当 mouse down 和 click 都在 overlay 元素本身发生时才触发关闭，
    // 避免在调色板拖拽鼠标至外部松开时误触关闭。
    const handleOverlayMouseDown = (event: React.MouseEvent) => {
        isMouseDownOnOverlayRef.current = event.target === event.currentTarget;
    };

    const handleOverlayClick = (event: React.MouseEvent) => {
        if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) {
            onClose();
        }
    };

    const targetHint = target === 'custom'
        ? (customTheme ? t('theme.targetCustomHint') : t('theme.targetCustomNewHint'))
        : (aiTheme ? t('theme.targetAiHint') : t('theme.targetAiNewHint'));

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed inset-0 z-[140] backdrop-blur-xl p-3 sm:p-5"
            style={{ backgroundColor: overlayBackground }}
            onMouseDown={handleOverlayMouseDown}
            onClick={handleOverlayClick}
        >
            <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
                className={`mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
            >
                <ThemeParkHeader
                    target={target}
                    targetHint={targetHint}
                    isDaylight={isDaylight}
                    canSave={isNameValid}
                    onTargetChange={setTarget}
                    onReset={reset}
                    onSave={handleSave}
                    onClose={onClose}
                />

                <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_380px] lg:items-stretch">
                    <div className="min-h-[300px] lg:min-h-0 lg:h-full">
                        <ThemePreview
                            theme={previewTheme[mode]}
                            mode={mode}
                            visualizerMode={visualizerMode}
                            visualizerTunings={visualizerTunings}
                            visualizerModeLabel={visualizerModeLabel}
                            staticMode={staticMode}
                            visualizerOpacity={visualizerOpacity}
                            backgroundConfig={backgroundConfig}
                            cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                            cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                            monetPortraitImage={monetPortraitImage}
                            showSubtitleTranslation={showSubtitleTranslation}
                            subtitleContentMode={subtitleContentMode}
                            lyricsFontScale={lyricsFontScale}
                            currentTime={currentTime}
                            currentLineIndex={currentLineIndex}
                            audioPower={audioPower}
                            audioBands={audioBands}
                            isPaused={isPaused}
                            onTogglePause={() => setIsPaused(previous => !previous)}
                        />
                    </div>

                    <div className="relative z-30 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
                        <div
                            className="space-y-4 rounded-[24px] border border-white/10 p-4"
                            style={{ backgroundColor: controlCardBg }}
                        >
                            <div className="grid grid-cols-4 gap-1 rounded-full bg-white/5 p-1">
                                {TABS.map(({ id, labelKey }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setActiveTab(id)}
                                        className="truncate rounded-full px-2 py-2 text-xs transition-colors"
                                        style={{
                                            color: 'var(--text-primary)',
                                            backgroundColor: activeTab === id
                                                ? (isDaylight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.12)')
                                                : 'transparent',
                                        }}
                                    >
                                        {t(labelKey)}
                                    </button>
                                ))}
                            </div>

                            {activeTab === 'colors' && (
                                <ThemeParkColorPanel
                                    mode={mode}
                                    onModeChange={setMode}
                                    activeColorKey={activeColorKey}
                                    onActiveColorKeyChange={setActiveColorKey}
                                    safeDraft={safeDraft}
                                    rawColorValue={draft[mode][activeColorKey]}
                                    recommendedColors={recommendedColors}
                                    isDaylight={isDaylight}
                                    onColorDrag={updateColorThrottled}
                                    onColorPick={updateColorInstant}
                                    onHexInput={(value) => updateModeField({ [activeColorKey]: value })}
                                    onHexCommit={handleHexCommit}
                                />
                            )}

                            {activeTab === 'details' && (
                                <ThemeParkDetailsPanel
                                    draft={draft}
                                    onFieldChange={(fieldMode: EditableMode, patch) => updateModeField(patch, fieldMode)}
                                />
                            )}

                            {activeTab === 'content' && (
                                <ThemeParkContentPanel
                                    wordColors={draft.dark.wordColors ?? []}
                                    lyricsIcons={draft.dark.lyricsIcons ?? []}
                                    accentColor={safeDraft[mode].accentColor}
                                    onWordColorsChange={(wordColors) => updateSharedField({ wordColors })}
                                    onLyricsIconsChange={(lyricsIcons) => updateSharedField({ lyricsIcons })}
                                />
                            )}

                            {activeTab === 'ai' && (
                                <ThemeParkAiPanel
                                    promptSourceText={promptSourceText}
                                    isPureMusic={isPureMusic}
                                    songTitle={songTitle}
                                    buildFinalTheme={buildFinalTheme}
                                    fallbackTheme={baseTheme}
                                    onImportTheme={replaceDraft}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default ThemePark;
