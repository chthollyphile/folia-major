import type { CommandPaletteContext } from '../../command-palette/types';
import type { LyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import type { ThemeGenerationSource } from '../../../services/themePreferences';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { useAutomixSettingsStore } from '../../../stores/useAutomixSettingsStore';
import { useDesktopSettingsStore } from '../../../stores/useDesktopSettingsStore';
import { useLocalLibrarySettingsStore } from '../../../stores/useLocalLibrarySettingsStore';
import { isLocalLibraryAutoScanSupported } from '../../../services/localLibraryAutoScan';
import { isNeteaseScrobbleReady } from '../../../services/onlineMusic/playbackReportGate';
import { useLyricSettingsStore } from '../../../stores/useLyricSettingsStore';
import { useGridViewSettingsStore } from '../../../stores/useGridViewSettingsStore';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { useMotionSettingsStore } from '../../../stores/useMotionSettingsStore';
import { usePlaybackEntryViewStore } from '../../../stores/usePlaybackEntryViewStore';
import { usePonderStore } from '../../../stores/usePonderStore';
import { useHomeLayoutSettingsStore } from '../../../stores/useHomeLayoutSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';
import { useStageSettingsStore } from '../../../stores/useStageSettingsStore';
import { useSleepTimerStore } from '../../../stores/useSleepTimerStore';
import { useTypographySettingsStore } from '../../../stores/useTypographySettingsStore';
import { useThemeQuickEditorStore } from '../../../stores/useThemeQuickEditorStore';
import { usePlayerBottomBarLayoutStore } from '../../../stores/usePlayerBottomBarLayoutStore';
import type { SongResult } from '../../../types';
import { cycleSubtitleContentMode } from '../../../utils/lyrics/alternateText';

// src/components/app/command-palette-context/buildSettingsCommandContext.ts
// The `settings` namespace of the palette context.
//
// Reads the domain stores itself rather than being handed ~46 value+setter pairs by App.tsx.
// The toggles call the stores' own handleToggle* — the builder used to re-implement each flip as
// `() => setX(!x)`, which is what forced App.tsx to pass both halves of every boolean.

/** The few members that genuinely live in App.tsx rather than in a store. */
export type SettingsCommandContextDeps = {
    currentSong: SongResult | null;
    /** Wraps the Electron transparent-window handoff, not just the stored boolean. */
    toggleTransparentBackground: () => void;
    toggleDaylightMode: () => void;
    /** Both compose handleSaveLyricFilterPattern; neither is a plain store setter. */
    cycleLyricStaffPolicy: () => void;
    cycleLyricStaffAbsorbMode: () => void;
    canGenerateAITheme: boolean;
    isGeneratingTheme: boolean;
    generateAITheme: () => void;
    themeGenerationSource: ThemeGenerationSource;
    setThemeGenerationSource: (source: ThemeGenerationSource) => void;
    voiceInputPauseSupported: boolean;
    /** A getter: the answer changes when a model download finishes, with nothing re-rendering. */
    canUseTransitionPerformance: () => boolean;
};

export const buildSettingsCommandContext = (
    deps: SettingsCommandContextDeps,
): CommandPaletteContext['settings'] => {
    const typography = useTypographySettingsStore.getState();
    const chrome = usePlayerChromeSettingsStore.getState();
    const desktop = useDesktopSettingsStore.getState();
    const audio = useAudioSettingsStore.getState();
    const automix = useAutomixSettingsStore.getState();
    const sleepTimer = useSleepTimerStore.getState();
    const modal = useSettingsModalStore.getState();
    const themeQuickEditor = useThemeQuickEditorStore.getState();
    const lattice = useLatticeSettingsStore.getState();
    const entryView = usePlaybackEntryViewStore.getState();
    const ponder = usePonderStore.getState();

    return {
        openSettings: modal.openSettings,
        setAppLanguagePreference: modal.handleSetAppLanguagePreference,
        toggleTransparentBackground: deps.toggleTransparentBackground,
        toggleDaylightMode: deps.toggleDaylightMode,
        toggleBottomSubtitleOverlay: () => typography.handleToggleHidePlayerTranslationSubtitle(
            !useTypographySettingsStore.getState().hidePlayerTranslationSubtitle,
        ),
        subtitleContentMode: typography.subtitleContentMode,
        cycleSubtitleContentMode: () => typography.handleSetSubtitleContentMode(
            cycleSubtitleContentMode(useTypographySettingsStore.getState().subtitleContentMode),
        ),
        toggleSubtitleOverlayBackground: () => typography.handleToggleSubtitleOverlayBackground(
            !useTypographySettingsStore.getState().subtitleOverlayBackground,
        ),
        playbackEntryView: entryView.playbackEntryView,
        setPlaybackEntryView: entryView.setPlaybackEntryView,
        ponderHintVisibility: ponder.ponderHintVisibility,
        setPonderHintVisibility: ponder.setPonderHintVisibility,
        togglePonderTouchButton: () => {
            const state = usePonderStore.getState();
            state.setShowPonderTouchButton(!state.showPonderTouchButton);
        },
        toggleRememberHomeCardPosition: () => {
            const home = useHomeLayoutSettingsStore.getState();
            home.handleToggleRememberHomeCardPosition(!home.rememberHomeCardPosition);
        },
        startPlayerBottomBarPositioning: usePlayerBottomBarLayoutStore.getState().requestPositioning,
        canStartPlayerBottomBarPositioning: Boolean(deps.currentSong) && !chrome.hidePlayerProgressBar,
        toggleAlwaysShowPlayerBackButton: () => chrome.handleToggleAlwaysShowPlayerBackButton(
            !usePlayerChromeSettingsStore.getState().alwaysShowPlayerBackButton,
        ),
        toggleGridViewFullBleedCover: () => useGridViewSettingsStore.getState().handleToggleGridViewFullBleedCover(
            !useGridViewSettingsStore.getState().gridViewFullBleedCover,
        ),
        toggleGridViewSquareCards: () => useGridViewSettingsStore.getState().handleToggleGridViewSquareCards(
            !useGridViewSettingsStore.getState().gridViewSquareCards,
        ),
        canUseGridViewSquareCards: () => useGridViewSettingsStore.getState().gridViewFullBleedCover,
        toggleLatticeVignette: () => useLatticeSettingsStore.getState().handleToggleLatticeVignette(
            !useLatticeSettingsStore.getState().latticeVignette,
        ),
        toggleReduceLatticeMotion: () => {
            const motion = useMotionSettingsStore.getState();
            motion.handleToggleReducedMotionSurface('lattice', !motion.reducedMotionSurfaces.lattice);
        },
        toggleFollowSystemReducedMotion: () => {
            const motion = useMotionSettingsStore.getState();
            motion.handleToggleFollowSystemReducedMotion(!motion.followSystemReducedMotion);
        },
        toggleLatticeAutoFocusOnSongChange: () => useLatticeSettingsStore.getState().handleToggleAutoFocusOnSongChange(
            !useLatticeSettingsStore.getState().autoFocusOnSongChange,
        ),
        latticePosterTintEnabled: lattice.latticePosterTintEnabled,
        latticePosterTintUseCustomColor: lattice.latticePosterTintUseCustomColor,
        latticePosterTintColor: lattice.latticePosterTintColor,
        latticePosterTintIntensity: lattice.latticePosterTintIntensity,
        setLatticePosterTintEnabled: lattice.handleToggleLatticePosterTint,
        setLatticePosterTintUseCustomColor: lattice.handleToggleLatticePosterTintCustomColor,
        setLatticePosterTintColor: lattice.handleSetLatticePosterTintColor,
        setLatticePosterTintIntensity: lattice.handleSetLatticePosterTintIntensity,
        toggleAlwaysShowTrackSwitchButtons: () => chrome.handleToggleAlwaysShowTrackSwitchButtons(
            !usePlayerChromeSettingsStore.getState().alwaysShowTrackSwitchButtons,
        ),
        toggleAlwaysShowMainWindowTitlebar: () => chrome.handleToggleAlwaysShowMainWindowTitlebar(
            !usePlayerChromeSettingsStore.getState().alwaysShowMainWindowTitlebar,
        ),
        toggleHideFullscreenButton: () => chrome.handleToggleHideFullscreenButton(
            !usePlayerChromeSettingsStore.getState().hideFullscreenButton,
        ),
        toggleNativeMacFullscreenButton: () => chrome.handleToggleNativeMacFullscreenButton(
            !usePlayerChromeSettingsStore.getState().useNativeMacFullscreenButton,
        ),
        toggleAutoHideCursorWithPlayerChrome: () => chrome.handleToggleAutoHideCursorWithPlayerChrome(
            !usePlayerChromeSettingsStore.getState().autoHideCursorWithPlayerChrome,
        ),
        toggleAutoPlayOnLaunch: () => audio.handleToggleAutoPlayOnLaunch(
            !useAudioSettingsStore.getState().autoPlayOnLaunch,
        ),
        toggleTranscodeFallback: () => audio.handleToggleTranscodeFallback(
            !useAudioSettingsStore.getState().enableTranscodeFallback,
        ),
        togglePlaybackFade: () => audio.handleTogglePlaybackFade(
            !useAudioSettingsStore.getState().playbackFadeEnabled,
        ),
        canAutoScanLocalLibrary: isLocalLibraryAutoScanSupported,
        toggleLocalLibraryAutoScan: () => useLocalLibrarySettingsStore.getState().toggleAutoScan(),
        canReportNeteasePlayback: isNeteaseScrobbleReady,
        toggleNeteaseScrobble: () => audio.handleToggleNeteaseScrobble(
            !useAudioSettingsStore.getState().neteaseScrobbleEnabled,
        ),
        voiceInputPauseSupported: deps.voiceInputPauseSupported,
        modSystemEnabled: desktop.modSystemEnabled,
        toggleVoiceInputPause: () => desktop.handleToggleVoiceInputPause(
            !useDesktopSettingsStore.getState().voiceInputPauseEnabled,
        ),
        togglePreventDisplaySleepDuringPlayback: () => desktop.handleTogglePreventDisplaySleepDuringPlayback(
            !useDesktopSettingsStore.getState().preventDisplaySleepDuringPlayback,
        ),
        toggleWallpaperMode: () => desktop.handleToggleWallpaperMode(
            !useDesktopSettingsStore.getState().wallpaperMode,
        ),
        toggleCloseToTray: () => desktop.handleToggleCloseToTray(
            !useDesktopSettingsStore.getState().closeToTray,
        ),
        toggleHideRemoteControlTitlebar: () => desktop.handleToggleHideRemoteControlTitlebar(
            !useDesktopSettingsStore.getState().hideRemoteControlTitlebar,
        ),
        unlockRemoteControl: () => desktop.handleToggleRemoteControlClickThrough(false),
        toggleObsKeepMainWindowAnimation: () => useStageSettingsStore.getState().handleToggleObsKeepMainWindowAnimation(
            !useStageSettingsStore.getState().obsKeepMainWindowAnimation,
        ),
        // Reads + flips through the main-process controller so the command and the settings
        // section share one source of truth (the broadcast status), not two stored booleans.
        toggleSpoutOutput: async () => {
            if (!window.electron?.getSpoutOutputStatus || !window.electron?.setSpoutOutputConfig) {
                return false;
            }
            const status = await window.electron.getSpoutOutputStatus();
            await window.electron.setSpoutOutputConfig({ enabled: !status.enabled });
            return true;
        },
        toggleWallpaperMacAutohideDock: () => desktop.handleToggleWallpaperMacAutohideDock(
            !useDesktopSettingsStore.getState().wallpaperMacAutohideDock,
        ),
        sleepTimerEnabled: sleepTimer.sleepTimerEnabled,
        setSleepTimerEnabled: sleepTimer.handleToggleSleepTimer,
        sleepTimerHours: sleepTimer.sleepTimerHours,
        setSleepTimerHours: sleepTimer.handleSetSleepTimerHours,
        sleepTimerMinutes: sleepTimer.sleepTimerMinutes,
        setSleepTimerMinutes: sleepTimer.handleSetSleepTimerMinutes,
        sleepTimerDeadlineMs: sleepTimer.sleepTimerDeadlineMs,
        canGenerateAITheme: deps.canGenerateAITheme,
        isGeneratingTheme: deps.isGeneratingTheme,
        generateAITheme: deps.generateAITheme,
        openThemeQuickEditor: themeQuickEditor.openEditor,
        canOpenThemeQuickEditor: themeQuickEditor.canOpenEditor,
        themeGenerationSource: deps.themeGenerationSource,
        setThemeGenerationSource: deps.setThemeGenerationSource,
        lyricStaffPolicy: useLyricSettingsStore.getState().lyricStaffPolicy,
        cycleLyricStaffPolicy: deps.cycleLyricStaffPolicy,
        lyricStaffAbsorbMode: useLyricSettingsStore.getState().lyricStaffAbsorbMode,
        cycleLyricStaffAbsorbMode: deps.cycleLyricStaffAbsorbMode,
        automixEnabled: automix.automixEnabled,
        transitionMode: automix.transitionMode,
        transitionPerformance: automix.transitionPerformance,
        toggleAutomix: () => automix.handleToggleAutomix(!useAutomixSettingsStore.getState().automixEnabled),
        setTransitionMode: automix.handleSetTransitionMode,
        toggleTransitionPerformance: () => automix.handleToggleTransitionPerformance(
            !useAutomixSettingsStore.getState().transitionPerformance,
        ),
        canUseTransitionPerformance: deps.canUseTransitionPerformance,
    };
};
