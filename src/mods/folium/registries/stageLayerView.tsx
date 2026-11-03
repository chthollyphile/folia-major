import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '@/types';
import {
    usePlaybackStore,
    selectDisplayCoverUrl,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplaySong,
} from '@/stores/usePlaybackStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useAppChromeStore } from '@/stores/useAppChromeStore';
import { useSettingsModalStore } from '@/stores/useSettingsModalStore';
import { useTypographySettingsStore } from '@/stores/useTypographySettingsStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { audioBands, audioPower, lyricCurrentTime } from '@/stores/motionSignals';
import { NO_LYRIC_LINES } from '@/utils/lyrics/noLyricLines';
import type { FoliumStageLayerDef, FoliumStageSlot, FoliumSurface } from '../contract';
import { useFoliumRegistryEntries, type FoliumRegistryEntry } from '../../runtime/registry';
import { useFoliumStageContext, type FoliumStageInputs } from './stageContext';
import { FoliumMountHost, foliumThemeVars } from '../../runtime/FoliumMountHost';
import { toFoliumTheme } from '../dto';
import { stageLayersRegistry } from './stageLayers';
import { foliumMountName } from '../kinds';

// src/mods/folium/registries/stageLayerView.tsx
// The store-reading half of the stage layer slot (see stageLayers.tsx for why
// it is split out and loaded lazily). Builds each layer's FoliumStageContext
// from the live playback state and mounts it in an isolated container.

const byOrder = (left: FoliumRegistryEntry<FoliumStageLayerDef>, right: FoliumRegistryEntry<FoliumStageLayerDef>) => (
    (left.def.order ?? 500) - (right.def.order ?? 500) || left.id.localeCompare(right.id)
);

const STAGE_SURFACE: FoliumSurface = Object.freeze({ transparent: false, hostBackground: true });

const STAGE_LAYER = foliumMountName('stageLayers', 'stageLayer');
// Stage layers only exist on the live player page, so they read the app's own analyser signals.
const STAGE_AUDIO = Object.freeze({ audioPower, audioBands });

/*
 * Display settings for stage layers, read from the stores the visualizer
 * renderer model reads (useVisualizerRendererModel): stage layers exist only on
 * the live player page, so the stores are what builtin modes render with there.
 * `hideTranslationSubtitle` is computed in App and has no store, so it stays at
 * its builtin default.
 */
const useStageLayerDisplay = (): FoliumStageInputs['display'] => {
    const typography = useTypographySettingsStore(useShallow((state) => ({
        lyricsFontScale: state.lyricsFontScale,
        subtitleFontScale: state.subtitleFontScale,
        subtitleOverlayOpacity: state.subtitleOverlayOpacity,
        subtitleOverlayBackground: state.subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur: state.subtitleUpcomingLyricsBlur,
        showHarmonySubtitle: state.showHarmonySubtitle,
        harmonySubtitleBackground: state.harmonySubtitleBackground,
        showSubtitleTranslation: state.showSubtitleTranslation,
        subtitleContentMode: state.subtitleContentMode,
    })));
    const currentView = useAppViewStore((state) => state.view);
    const isPanelOpen = useAppViewStore((state) => state.isPanelOpen);
    const isPlayerChromeHidden = useAppChromeStore((state) => state.isPlayerChromeHidden);
    const isSettingsModalOpen = useSettingsModalStore((state) => state.settingsModalState.isOpen);
    const visualizerOpacity = useVisualizerSettingsStore((state) => state.visualizerOpacity);
    return {
        ...typography,
        showText: currentView === 'player' && !isSettingsModalOpen,
        isPanelOpen,
        isPlayerChromeHidden,
        visualizerOpacity,
    };
};

const FoliumStageLayer: React.FC<{
    entry: FoliumRegistryEntry<FoliumStageLayerDef>;
    theme: Theme;
    isDaylight: boolean;
    paused: boolean;
}> = ({ entry, theme, isDaylight, paused }) => {
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    const song = usePlaybackStore(selectDisplaySong);
    const currentLineIndex = usePlaybackStore((state) => state.currentLineIndex);
    const coverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const duration = usePlaybackStore(selectDisplayDuration);
    const display = useStageLayerDisplay();
    const ctx = useFoliumStageContext({
        lines: lyrics?.lines ?? NO_LYRIC_LINES,
        currentTime: lyricCurrentTime,
        duration: Number.isFinite(duration) ? duration : 0,
        currentLineIndex,
        paused,
        theme,
        isDaylight,
        songTitle: song?.name ?? null,
        songArtist: (song?.artists ?? []).map((artist) => artist?.name).filter(Boolean).join(' / ') || null,
        songAlbum: song?.album?.name ?? null,
        staticMode: false,
        // Same seed rule as builtin modes (buildVisualizerTheme), minus the per-mode
        // fallback: a stage layer belongs to no mode.
        seed: song?.id ?? null,
        isPreview: false,
        coverUrl: coverUrl ?? null,
        display,
        surface: STAGE_SURFACE,
        settings: null,
        audio: STAGE_AUDIO,
    });
    const foliumTheme = useMemo(() => toFoliumTheme(theme, isDaylight), [theme, isDaylight]);
    return (
        <FoliumMountHost
            modId={entry.modId}
            where={`stage layer ${entry.id}`}
            entryKind={STAGE_LAYER}
            entryId={entry.id}
            mount={entry.def.mount}
            ctx={ctx}
            shadow
            theme={foliumTheme}
            className="absolute inset-0"
            pointerEvents={entry.def.interactive ? 'auto' : 'none'}
        />
    );
};

const FoliumStageLayerSlotView: React.FC<{
    slot: FoliumStageSlot;
    theme: Theme;
    isDaylight: boolean;
    paused: boolean;
    className?: string;
}> = ({ slot, theme, isDaylight, paused, className }) => {
    const entries = useFoliumRegistryEntries(stageLayersRegistry);
    const layers = entries.filter((entry) => entry.def.slot === slot).sort(byOrder);
    if (layers.length === 0) return null;
    return (
        <div
            className={className ?? 'absolute inset-0 pointer-events-none'}
            style={foliumThemeVars(toFoliumTheme(theme, isDaylight))}
            data-folium-slot={slot}
        >
            {layers.map((entry) => (
                <FoliumStageLayer key={entry.id} entry={entry} theme={theme} isDaylight={isDaylight} paused={paused} />
            ))}
        </div>
    );
};

export default FoliumStageLayerSlotView;
