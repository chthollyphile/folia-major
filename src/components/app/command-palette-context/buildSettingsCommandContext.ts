import type { CommandPaletteContext } from '../../command-palette/types';
import type { LyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import type { ThemeGenerationSource } from '../../../services/themePreferences';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { useAutomixSettingsStore } from '../../../stores/useAutomixSettingsStore';
import { useDesktopSettingsStore } from '../../../stores/useDesktopSettingsStore';
import { useLyricSettingsStore } from '../../../stores/useLyricSettingsStore';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';
import { useSleepTimerStore } from '../../../stores/useSleepTimerStore';
import { useTypographySettingsStore } from '../../../stores/useTypographySettingsStore';
import { useThemeQuickEditorStore } from '../../../stores/useThemeQuickEditorStore';
import { usePlayerBottomBarLayoutStore } from '../../../stores/usePlayerBottomBarLayoutStore';
import type { SongResult } from '../../../types';

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

    return {
        openSettings: modal.openSettings,
        setIsUserGuideModalOpen: modal.setIsUserGuideModalOpen,
        setAppLanguagePreference: modal.handleSetAppLanguagePreference,
        toggleTransparentBackground: deps.toggleTransparentBackground,
        toggleDaylightMode: deps.toggleDaylightMode,
        toggleBottomSubtitleOverlay: () => typography.handleToggleHidePlayerTranslationSubtitle(
            !useTypographySettingsStore.getState().hidePlayerTranslationSubtitle,
        ),
        subtitleContentMode: typography.subtitleContentMode,
        cycleSubtitleContentMode: () => typography.handleSetSubtitleContentMode(
            useTypographySettingsStore.getState().subtitleContentMode === 'translation' ? 'romanization' : 'translation',
        ),
        toggleSubtitleOverlayBackground: () => typography.handleToggleSubtitleOverlayBackground(
            !useTypographySettingsStore.getState().subtitleOverlayBackground,
        ),
        startPlayerBottomBarPositioning: usePlayerBottomBarLayoutStore.getState().requestPositioning,
        canStartPlayerBottomBarPositioning: Boolean(deps.currentSong) && !chrome.hidePlayerProgressBar,
        toggleAlwaysShowPlayerBackButton: () => chrome.handleToggleAlwaysShowPlayerBackButton(
            !usePlayerChromeSettingsStore.getState().alwaysShowPlayerBackButton,
        ),
        toggleLatticeVignette: () => useLatticeSettingsStore.getState().handleToggleLatticeVignette(
            !useLatticeSettingsStore.getState().latticeVignette,
        ),
        toggleAlwaysShowTrackSwitchButtons: () => chrome.handleToggleAlwaysShowTrackSwitchButtons(
            !usePlayerChromeSettingsStore.getState().alwaysShowTrackSwitchButtons,
        ),
        toggleAlwaysShowMainWindowTitlebar: () => chrome.handleToggleAlwaysShowMainWindowTitlebar(
            !usePlayerChromeSettingsStore.getState().alwaysShowMainWindowTitlebar,
        ),
        toggleAutoPlayOnLaunch: () => audio.handleToggleAutoPlayOnLaunch(
            !useAudioSettingsStore.getState().autoPlayOnLaunch,
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
