import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    CappellaAvatarImage,
    CappellaEmojiImage,
    DualTheme,
    MonetPortraitImage,
    SongResult,
    SubtitleContentMode,
    SubtitleOverlayLayout,
    Theme,
    VisualizerMode,
} from '../../types';
import { BASE_DUAL_THEME } from '../../services/baseThemes';
import type { ThemeCacheSongKey } from '../../services/themeCache';
import { useThemeQuickEditorStore } from '../../stores/useThemeQuickEditorStore';
import type { VisualizerTuningBundle } from '../visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../visualizer/backgrounds/definition';
import StudioWindow from '../shared/StudioWindow';
import { useSettingsKitTheme } from './settings/kit';
import ThemePreview from './theme-park/ThemeParkPreview';
import { ThemeParkHeaderActions, ThemeParkHeaderSlot } from './theme-park/ThemeParkHeader';
import ThemeParkColumn from './theme-park/ThemeParkColumn';
import { useThemeParkDraft } from './theme-park/useThemeParkDraft';
import { useThemeParkPreviewClock } from './theme-park/useThemeParkPreviewClock';
import type { PreviewSource } from '../visualizer/preview/PreviewSourceSwitch';
import { useLivePreviewFeed } from '../visualizer/preview/useLivePreviewFeed';
import { useStillClockPulse } from '../visualizer/preview/stillClockPulse';
import { useThemeRecommendedColors } from './theme-park/useThemeRecommendedColors';
import { isDualThemeNameValid } from './theme-park/themeParkDraft';

// src/components/modal/ThemePark.tsx
// Full theme editor: live visualizer preview on the left, and a tabbed editor on the right that
// covers every editable Theme field (colors, names/descriptions, word colors and lyric icons,
// plus the manual AI JSON round trip). The edit target — the song's AI theme or the saved custom
// theme — is chosen inside the editor; both drafts stay alive while the modal is open.
//
// The window itself is the shared work-window shell (StudioWindow): this file puts three pieces on
// it that take no layout from it: what the title bar holds beside the title (ThemeParkHeader's two
// parts), the sample (ThemeParkPreview) and the editing column (ThemeParkColumn).

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
    subtitleOverlayLayout?: SubtitleOverlayLayout;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsFontWeight?: number | null;
    lyricsCustomFontFamily?: string | null;
    onClose: () => void;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onSaveAiTheme: (dualTheme: DualTheme, song: SongResult | null, songKey: ThemeCacheSongKey | null) => void;
}

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
    subtitleOverlayLayout,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsFontWeight,
    lyricsCustomFontFamily,
    onClose,
    onSaveCustomTheme,
    onSaveAiTheme,
}) => {
    const { t } = useTranslation();
    // The app's own theme colours the window; the sample alone shows the theme being edited.
    const { theme: appTheme } = useSettingsKitTheme();
    const [isPaused, setIsPaused] = useState(false);
    const [previewSource, setPreviewSource] = useState<PreviewSource>('builtin');
    const previewBoxRef = useRef<HTMLDivElement>(null);
    // What the player shows now, when the sample is set aside for it; null while it has no lyrics.
    const livePreview = useLivePreviewFeed({ enabled: previewSource === 'live', paused: isPaused, stageRef: previewBoxRef });
    const liveContent = livePreview.content;

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

    const editor = useThemeParkDraft({
        aiTheme,
        customTheme,
        bgMode,
        seedTheme: initialTheme,
        isDaylight,
        defaultCustomTheme: BASE_DUAL_THEME,
    });
    const { target, setTarget, mode, draft, safeDraft, baseTheme, reset, buildFinalTheme } = editor;

    // The sample's clock rests while the live picture is drawn.
    const sampleClock = useThemeParkPreviewClock(visualizerMode, isPaused || liveContent !== null);
    // The sample, paused, has no change of time for a style mounted anew (a switch from the live picture).
    useStillClockPulse({ time: sampleClock.currentTime, still: isPaused && liveContent === null, boxRef: previewBoxRef, restartKey: previewSource });
    const { currentTime, audioPower, audioBands } = liveContent ? livePreview : sampleClock;
    const currentLineIndex = liveContent ? liveContent.currentLineIndex : sampleClock.currentLineIndex;

    const recommendedColors = useThemeRecommendedColors(baseTheme, coverUrl, 4);

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

    const targetHint = target === 'custom'
        ? (customTheme ? t('theme.targetCustomHint') : t('theme.targetCustomNewHint'))
        : (aiTheme ? t('theme.targetAiHint') : t('theme.targetAiNewHint'));

    return (
        <StudioWindow
            title={t('theme.themePark')}
            onBack={onClose}
            backLabel={t('ui.back')}
            isDaylight={isDaylight}
            theme={appTheme}
            ponderId="theme-park"
            slot={<ThemeParkHeaderSlot target={target} targetHint={targetHint} onTargetChange={setTarget} />}
            actions={<ThemeParkHeaderActions target={target} canSave={isNameValid} onReset={reset} onSave={handleSave} />}
            stage={(
                <ThemePreview
                    theme={previewTheme[mode]}
                    mode={mode}
                    name={draft[mode].name ?? ''}
                    description={draft[mode].description ?? ''}
                    visualizerMode={visualizerMode}
                    visualizerTunings={visualizerTunings}
                    staticMode={staticMode}
                    visualizerOpacity={visualizerOpacity}
                    backgroundConfig={backgroundConfig}
                    cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                    cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                    monetPortraitImage={monetPortraitImage}
                    showSubtitleTranslation={showSubtitleTranslation}
                    subtitleContentMode={subtitleContentMode}
                    subtitleOverlayLayout={subtitleOverlayLayout}
                    lyricsFontScale={lyricsFontScale}
                    currentTime={currentTime}
                    progressTime={liveContent ? livePreview.playbackTime : sampleClock.currentTime}
                    currentLineIndex={currentLineIndex}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    isPaused={isPaused}
                    onTogglePause={() => setIsPaused(previous => !previous)}
                    previewSource={previewSource}
                    onPreviewSourceChange={setPreviewSource}
                    liveContent={liveContent}
                    boxRef={previewBoxRef}
                />
            )}
        >
            <ThemeParkColumn
                editor={editor}
                recommendedColors={recommendedColors}
                promptSource={{ promptSourceText, isPureMusic, songTitle }}
            />
        </StudioWindow>
    );
};

export default ThemePark;
