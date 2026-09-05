import { useLatticeControlsStore } from '../stores/useLatticeControlsStore';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { selectDisplayLyrics, selectDisplayPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { setIsPanelOpen, setPanelTab, useAppViewStore } from '../stores/useAppViewStore';
import { useShallow } from 'zustand/react/shallow';
import type { CommandPaletteContext } from '../components/command-palette/types';
import {
    buildNavigationCommandContext,
    buildPanelCommandContext,
    buildPlaybackCommandContext,
    buildSharedCommandContext,
    type NavigationCommandContextDeps,
    type PanelCommandContextDeps,
    type PlaybackCommandContextDeps,
    type SharedCommandContextDeps,
} from '../components/app/command-palette-context/buildAppOwnedCommandContext';
import { buildSearchCommandContext, type SearchCommandContextDeps } from '../components/app/command-palette-context/buildSearchCommandContext';
import { buildSettingsCommandContext, type SettingsCommandContextDeps } from '../components/app/command-palette-context/buildSettingsCommandContext';
import { buildVisualizerCommandContext } from '../components/app/command-palette-context/buildVisualizerCommandContext';
import { useAddToPlaylistStore } from '../stores/useAddToPlaylistStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { useAutomixSettingsStore } from '../stores/useAutomixSettingsStore';
import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { useSleepTimerStore } from '../stores/useSleepTimerStore';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useLyricSegmentationStore } from '../stores/useLyricSegmentationStore';
import type { LyricSegmentationActions } from '../components/app/playback/createLyricSegmentationActions';

// src/hooks/useCommandPaletteContext.ts
// Assembles the command palette's namespaced context.
//
// This replaces a 218-line useMemo in App.tsx that took 106 hand-written parameters. The
// namespaces whose state lives in a store now read it here; only what genuinely still lives in
// App.tsx is passed in.
//
// The store *values* are subscribed to (not just read via getState) so the context is rebuilt when
// one of them changes — commands' `isAvailable` reads a snapshot, so a stale context would grey the
// wrong entries. The subscriptions are deliberately narrow: only fields the palette actually shows
// or gates on, not whole stores.

/** What this hook fills in from stores, i18n and the display selectors. */
const AMBIENT_KEYS = [
    't', 'currentSong', 'lyrics', 'playerState',
    'queue', 'isFmMode',
    'setHomeViewTab', 'setPanelTab', 'setIsPanelOpen',
] as const;

type AmbientKey = (typeof AMBIENT_KEYS)[number];

export type CommandPaletteContextDeps = Omit<
    SharedCommandContextDeps
    & SearchCommandContextDeps
    & PlaybackCommandContextDeps
    & NavigationCommandContextDeps
    & PanelCommandContextDeps
    & SettingsCommandContextDeps,
    AmbientKey
>;

export const useCommandPaletteContext = (
    deps: CommandPaletteContextDeps,
    lyricSegmentationActions: LyricSegmentationActions,
): CommandPaletteContext => {
    const { t } = useTranslation();
    const currentSong = usePlaybackStore(state => state.currentSong);
    const queue = usePlaybackStore(state => state.playQueue);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const setHomeViewTab = useSearchNavigationStore(state => state.setHomeViewTab);
    // What is on screen, transitions included: surfaces that publish lyrics (the mod runtime
    // snapshot) must send the rendered ones, not a guess rebuilt from the song's stored state.
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    // The transport the listener can hear, like the main controls, the remote and the taskbar.
    // The raw state goes IDLE for the length of an arm while the outgoing deck is still playing,
    // and the palette read that as "paused": its Play command called toggle, which during a blend
    // pauses - so Play paused - while Pause saw no PLAYING to toggle and did nothing at all. Both
    // commands named the opposite of what they did, for up to half a minute per track.
    const playerState = usePlaybackStore(selectDisplayPlayerState);
    const ambient = useMemo(() => ({
        t: (key: string, fallback?: string) => t(key, fallback ?? ''),
        currentSong,
        lyrics,
        playerState,
        queue,
        isFmMode,
        setHomeViewTab,
        setPanelTab,
        setIsPanelOpen,
    }), [t, currentSong, lyrics, playerState, queue, isFmMode, setHomeViewTab]);

    // Narrow subscriptions: these are the store fields the palette displays or gates on.
    const settingsSignals = useTypographySettingsStore(useShallow(state => ({
        subtitleContentMode: state.subtitleContentMode,
    })));
    const chromeSignals = usePlayerChromeSettingsStore(useShallow(state => ({
        transparentPlayerBackground: state.transparentPlayerBackground,
        hidePlayerProgressBar: state.hidePlayerProgressBar,
    })));
    const desktopSignals = useDesktopSettingsStore(useShallow(state => ({
        modSystemEnabled: state.modSystemEnabled,
        wallpaperMode: state.wallpaperMode,
    })));
    const automixSignals = useAutomixSettingsStore(useShallow(state => ({
        automixEnabled: state.automixEnabled,
        transitionMode: state.transitionMode,
        transitionPerformance: state.transitionPerformance,
    })));
    const sleepTimerSignals = useSleepTimerStore(useShallow(state => ({
        sleepTimerEnabled: state.sleepTimerEnabled,
        sleepTimerHours: state.sleepTimerHours,
        sleepTimerMinutes: state.sleepTimerMinutes,
        sleepTimerDeadlineMs: state.sleepTimerDeadlineMs,
    })));
    const audioSignals = useAudioSettingsStore(useShallow(state => ({
        volume: state.volume,
        isMuted: state.isMuted,
    })));
    const visualizerSignals = useVisualizerSettingsStore(useShallow(state => ({
        visualizerMode: state.visualizerMode,
        visualizerBackgroundMode: state.visualizerBackgroundMode,
        randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    })));
    // Read through getState() by the builder, so the subscription has to be here or the command
    // would keep the answer it had when the context was last built.
    const canAddCurrentSongToPlaylist = useAddToPlaylistStore(state => state.availability.canAdd);
    const lyricStaffPolicy = useLyricSettingsStore(state => state.lyricStaffPolicy);
    const lyricStaffAbsorbMode = useLyricSettingsStore(state => state.lyricStaffAbsorbMode);
    const personalFmSelection = usePersonalFmModeStore(state => state.selection);
    // Which surface the palette is opening over; commands that only apply to one of them gate on it.
    const latticeFocusAction = useLatticeControlsStore(state => state.focusCurrentSong);
    const view = useAppViewStore(state => state.view);
    // Whoever currently reads typed characters. Identity only changes when a grid takes or gives up
    // the keyboard, so it does not rebuild the context per keystroke — the query itself never
    // travels through here, the palette's own input holds it.
    const commandFilter = useAppViewStore(state => state.commandFilter);
    // Subscribed, not read through getState: the segmentation surface and the panel chip both show
    // whether the current song has a saved split, so the context has to be rebuilt when it changes.
    const lyricSegmentationRecord = useLyricSegmentationStore(state => state.record);

    // App.tsx recreates several of these callbacks on every render (handleSaveLyricFilterPattern
    // is not memoised, and the toggles close over it), so keying the memo on `deps` identity would
    // rebuild the context every render — and with it useCommandPalette's 120-command availability
    // filter. Callbacks are therefore reached through a latest-ref, which is safe because commands
    // invoke them at execute time, never during render; only the *values* drive re-memoisation.
    const depsRef = useRef(deps);
    depsRef.current = deps;

    const stableCallbacks = useMemo(() => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(depsRef.current)) {
            if (typeof (depsRef.current as Record<string, unknown>)[key] === 'function') {
                out[key] = (...args: unknown[]) => (
                    (depsRef.current as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args)
                );
            }
        }
        return out;
    }, []);

    const valueDeps = Object.entries(deps)
        .filter(([, value]) => typeof value !== 'function')
        .map(([, value]) => value);

    return useMemo(() => {
        // `ambient` is what this hook reads for itself; `deps` is what only App.tsx can supply.
        const stableDeps = { ...deps, ...stableCallbacks, ...ambient } as CommandPaletteContextDeps
            & typeof ambient;
        return {
            shared: buildSharedCommandContext(stableDeps),
            scope: { view, filter: commandFilter },
            search: buildSearchCommandContext(stableDeps),
            playback: buildPlaybackCommandContext(stableDeps),
            navigation: buildNavigationCommandContext(stableDeps),
            panel: buildPanelCommandContext(stableDeps),
            settings: buildSettingsCommandContext(stableDeps),
            visualizer: buildVisualizerCommandContext(lyricSegmentationActions),
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value list is derived, shape is fixed
    }, [
        ...valueDeps,
        ambient,
        settingsSignals, chromeSignals, desktopSignals, automixSignals,
        sleepTimerSignals, audioSignals, visualizerSignals,
        lyricStaffPolicy, lyricStaffAbsorbMode, personalFmSelection, view, commandFilter, canAddCurrentSongToPlaylist,
        lyricSegmentationRecord, lyricSegmentationActions, latticeFocusAction,
    ]);
};
