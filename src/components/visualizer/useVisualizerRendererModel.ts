import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PlayerState, type Theme, type VisualizerMode } from '../../types';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';
import { audioBands, audioPower, lyricCurrentTime } from '../../stores/motionSignals';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { useAppChromeStore } from '../../stores/useAppChromeStore';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useTypographySettingsStore } from '../../stores/useTypographySettingsStore';
import { usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useStageSettingsStore } from '../../stores/useStageSettingsStore';
import { resolveMainWindowVisualizerMode } from '../../utils/obsBrowserSource';
import {
    selectDisplayCoverUrl,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
    selectIsShowingTail,
    usePlaybackStore,
} from '../../stores/usePlaybackStore';
import { getSongAlbumLabel, getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getVisualizerRegistryEntry } from './registry';
import { getVisualizerTuning } from './tuningRegistry';
import { useVisualizerBackgroundConfig } from './useVisualizerBackgroundConfig';
import { useVisualizerStyleAssets } from './useVisualizerStyleAssets';
import { useVisualizerTunings } from './useVisualizerTunings';
import { useVisualizerSongHandoff } from './useVisualizerSongHandoff';
import { useShownTheme } from './useShownTheme';
import { NO_LYRIC_LINES } from '../../utils/lyrics/noLyricLines';
import { selectLibraryPlayerBackdrop, useLibraryPlayerOcclusionStore } from '../../stores/useLibraryPlayerOcclusionStore';
import { resolveVisualizerShowText, resolveVisualizerBackAction } from '../app/presentation/playerVisualizerBackdrop';
import { useBackgroundLyricHoldStore } from '../app/backgroundThrottling/backgroundLyricHoldStore';

// src/components/visualizer/useVisualizerRendererModel.ts
//
// Assembles VisualizerRenderer's props. This was 47 of them written out in App.tsx's JSX, plus the
// memos that fed them.
//
// VisualizerRenderer itself stays a plain props component on purpose: the same visualizers render
// inside VisPlayground, the Theme Park preview and the OBS browser source, and none of those hosts
// has this app's stores to subscribe to. The subscription boundary is this file, not deeper.

/** What only App.tsx can supply: the theme bundle it derives, and the flags it computes. */
type VisualizerRendererModelDeps = {
    /** Built from `appStyle` + the active theme, which are not store state. */
    theme: Theme;
    subtitleTheme: Theme;
    /** The displayed song's id; visualizers infer "song changed" from it. */
    seed: string | number | undefined;
    /** Rendering into the OBS browser source instead of the window: freeze to a still (unless the user keeps the animation). */
    isObsBrowserSourceRendering: boolean;
    shouldPauseVisualizerBackground: boolean;
    hideTranslationSubtitle: boolean;
    isPlayerPageTransparent: boolean;
    onLyricLineSeek: (index: number) => void;
    onBack: () => void;
};

export const useVisualizerRendererModel = ({
    theme,
    subtitleTheme,
    seed,
    isObsBrowserSourceRendering,
    shouldPauseVisualizerBackground,
    hideTranslationSubtitle,
    isPlayerPageTransparent,
    onLyricLineSeek,
    onBack,
}: VisualizerRendererModelDeps) => {
    const currentView = useAppViewStore(state => state.view);
    const isPanelOpen = useAppViewStore(state => state.isPanelOpen);
    const isPlayerChromeHidden = useAppChromeStore(state => state.isPlayerChromeHidden);
    const onPlayerPanelGuideHotspotChange = useAppChromeStore(state => state.setIsPlayerPanelGuideHotspotActive);
    const isSettingsModalOpen = useSettingsModalStore(state => state.settingsModalState.isOpen);
    const isSettingsSubviewOpen = useSettingsModalStore(state => state.isSubSettingsViewOpen);
    // 首页墙后面透出来的 visualizer 要不要画歌词（bravais「墙后的画面」，stage 经契约报告；没有 stage 时为 false）。
    const backdropLyrics = useLibraryPlayerOcclusionStore(state => selectLibraryPlayerBackdrop(state).lyrics);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const staticMode = useThemeSettingsStore(state => state.staticMode);
    const alwaysShowPlayerBackButton = usePlayerChromeSettingsStore(state => state.alwaysShowPlayerBackButton);
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const obsKeepMainWindowAnimation = useStageSettingsStore(state => state.obsKeepMainWindowAnimation);
    const visualizerOpacity = useVisualizerSettingsStore(state => state.visualizerOpacity);
    const disableGeometricBackground = useVisualizerSettingsStore(state => state.disableVisualizerGeometricBackground);
    const onMonetTuningChange = useVisualizerSettingsStore(state => state.handleSetMonetTuning);
    // A change the style on screen makes to its own tuning (Machi's camera dragged to a pinned view): saved through
    // the store action its tuning.ts names (an action needs no subscription).
    const onVisualizerTuningChange = useCallback((patch: object) => {
        const tuning = getVisualizerTuning(visualizerMode);
        const save = tuning && (useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>)[tuning.settingsSetterKey];
        if (typeof save === 'function') save(patch);
    }, [visualizerMode]);
    const typography = useTypographySettingsStore(useShallow(state => ({
        lyricsFontScale: state.lyricsFontScale,
        subtitleFontScale: state.subtitleFontScale,
        subtitleOverlayOpacity: state.subtitleOverlayOpacity,
        subtitleOverlayBackground: state.subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur: state.subtitleUpcomingLyricsBlur,
        showHarmonySubtitle: state.showHarmonySubtitle,
        harmonySubtitleBackground: state.harmonySubtitleBackground,
        showSubtitleTranslation: state.showSubtitleTranslation,
        subtitleContentMode: state.subtitleContentMode,
        subtitleOverlayLayout: state.subtitleOverlayLayout,
    })));
    const assets = useVisualizerStyleAssets();
    const currentLineIndex = usePlaybackStore(state => state.currentLineIndex);
    // The held picture throughout: song, lyrics, cover and transport must describe one track for the
    // whole length of a blend.
    const displaySong = usePlaybackStore(selectDisplaySong);
    const displayLyrics = usePlaybackStore(selectDisplayLyrics);
    const displayCoverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const displayPlayerState = usePlaybackStore(selectDisplayPlayerState);
    const displayDuration = usePlaybackStore(selectDisplayDuration);
    // 后台节流 holds the lyric animation while the window is minimised or hidden: drawn as if paused,
    // which every style and background already settles into, and moving again once it is back on screen.
    const backgroundLyricHeld = useBackgroundLyricHoldStore(state => state.held);
    // The theme too: the live one is the incoming song's once it comes (useShownTheme).
    const liveThemes = useMemo(() => ({ theme, subtitleTheme }), [theme, subtitleTheme]);
    const shownThemes = useShownTheme(liveThemes, usePlaybackStore(selectIsShowingTail), displaySong?.id);
    // A blend's incoming song, for the style that draws the hand-off; the others switch at the settle.
    const songHandoff = useVisualizerSongHandoff(getVisualizerRegistryEntry(visualizerMode).followsSongHandoff === true, liveThemes);
    const backgroundConfig = useVisualizerBackgroundConfig();
    const visualizerTunings = useVisualizerTunings();

    const songArtist = useMemo(
        () => (displaySong ? getSongArtistLabel(displaySong) || null : null),
        [displaySong],
    );
    const songAlbum = useMemo(
        () => (displaySong ? getSongAlbumLabel(displaySong) || null : null),
        [displaySong],
    );

    const background = useMemo<VisualizerBackgroundConfig>(() => ({
        ...backgroundConfig,
        transparent: isPlayerPageTransparent,
        common: {
            ...backgroundConfig.common,
            // A settings subview covers the geometry anyway, and drawing it under an opaque panel
            // is the one place the cost buys nothing.
            disableGeometricBackground: disableGeometricBackground || isSettingsSubviewOpen,
        },
    }), [backgroundConfig, isPlayerPageTransparent, disableGeometricBackground, isSettingsSubviewOpen]);

    const mode: VisualizerMode = resolveMainWindowVisualizerMode(visualizerMode, isObsBrowserSourceRendering, obsKeepMainWindowAnimation);

    return {
        mode,
        currentTime: lyricCurrentTime,
        duration: Number.isFinite(displayDuration) ? displayDuration : 0,
        currentLineIndex,
        lines: displayLyrics?.lines || NO_LYRIC_LINES,
        theme: shownThemes.theme,
        subtitleTheme: shownThemes.subtitleTheme,
        isDaylight,
        audioPower,
        audioBands,
        songTitle: displaySong?.name,
        songArtist,
        songAlbum,
        coverUrl: displayCoverUrl,
        showText: resolveVisualizerShowText({ currentView, isSettingsModalOpen, isPanelOpen, backdropLyrics }),
        seed,
        songHandoff,
        staticMode,
        backgroundStaticMode: shouldPauseVisualizerBackground
            || (
                background.mode === 'latent'
                && background.latent?.tuning?.dynamicOnlyInPlayer
                && currentView !== 'player'
            ),
        paused: displayPlayerState !== PlayerState.PLAYING || backgroundLyricHeld,
        visualizerOpacity,
        background,
        ...typography,
        isPlayerChromeHidden,
        hideTranslationSubtitle,
        visualizerTunings,
        onVisualizerTuningChange,
        onMonetTuningChange,
        ...assets,
        // Only a style that reads a click on a lyric line says so in its entry; the rest have no line
        // hit-testing at all.
        onLyricLineSeek: getVisualizerRegistryEntry(visualizerMode).seeksOnLineClick ? onLyricLineSeek : undefined,
        // The back button goes back to the player page, so it belongs to that page only. The renderer
        // stays mounted on the home page (the picture behind the wall), and a back button there would
        // sit in the top-left corner over the home surface.
        onBack: resolveVisualizerBackAction(currentView, onBack),
        isPanelOpen,
        alwaysShowBackButton: alwaysShowPlayerBackButton || isPanelOpen,
        onPlayerPanelGuideHotspotChange,
    };
};
