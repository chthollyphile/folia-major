import React, { useMemo } from 'react';
import type { Theme } from '@/types';
import {
    usePlaybackStore,
    selectDisplayLyrics,
    selectDisplaySong,
} from '@/stores/usePlaybackStore';
import { lyricCurrentTime } from '@/stores/motionSignals';
import type { FoliumStageLayerDef, FoliumStageSlot, FoliumSurface } from '../contract';
import { createFoliumRegistry, useFoliumRegistryEntries, type FoliumRegistryEntry } from '../registry';
import { useFoliumStageContext } from '../stageContext';
import { FoliumMountHost, foliumThemeVars } from '../FoliumMountHost';
import { toFoliumTheme } from '../dto';

// src/mods/folium/registries/stageLayers.tsx
// `folium.registries.stageLayers`: mod layers on the player page. The host
// renders one slot per position (see FoliumStageSlot) and each layer mounts
// into its own full-size container there. Layers exist only on the real player
// page — never in previews, the OBS source or the export window — so their
// context reads the live playback state directly: the displayed lyrics and
// song, the lyric clock, and the current line.

const STAGE_SLOTS: readonly FoliumStageSlot[] = ['player.stage.back', 'player.stage.front', 'app.overlay'];

export const stageLayersRegistry = createFoliumRegistry<FoliumStageLayerDef>('stageLayers', {
    validate: (def) => {
        if (!STAGE_SLOTS.includes(def.slot)) {
            throw new Error(`stageLayers.register: slot must be one of ${STAGE_SLOTS.join(', ')}`);
        }
        if (typeof def.mount !== 'function') {
            throw new Error('stageLayers.register: mount must be a function');
        }
        return def;
    },
});

const byOrder = (left: FoliumRegistryEntry<FoliumStageLayerDef>, right: FoliumRegistryEntry<FoliumStageLayerDef>) => (
    (left.def.order ?? 500) - (right.def.order ?? 500) || left.id.localeCompare(right.id)
);

const EMPTY_LINES: never[] = [];
const STAGE_SURFACE: FoliumSurface = Object.freeze({ transparent: false, hostBackground: true });

const FoliumStageLayer: React.FC<{
    entry: FoliumRegistryEntry<FoliumStageLayerDef>;
    theme: Theme;
    isDaylight: boolean;
    paused: boolean;
}> = ({ entry, theme, isDaylight, paused }) => {
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    const song = usePlaybackStore(selectDisplaySong);
    const currentLineIndex = usePlaybackStore((state) => state.currentLineIndex);
    const ctx = useFoliumStageContext({
        lines: lyrics?.lines ?? EMPTY_LINES,
        currentTime: lyricCurrentTime,
        currentLineIndex,
        paused,
        theme,
        isDaylight,
        songTitle: song?.name ?? null,
        songArtist: (song?.artists ?? []).map((artist) => artist?.name).filter(Boolean).join(' / ') || null,
        songAlbum: song?.album?.name ?? null,
        staticMode: false,
        surface: STAGE_SURFACE,
        settings: null,
    });
    const foliumTheme = useMemo(() => toFoliumTheme(theme, isDaylight), [theme, isDaylight]);
    return (
        <FoliumMountHost
            modId={entry.modId}
            where={`stage layer ${entry.id}`}
            mount={entry.def.mount}
            ctx={ctx}
            shadow
            theme={foliumTheme}
            className="absolute inset-0"
            pointerEvents={entry.def.interactive ? 'auto' : 'none'}
        />
    );
};

/*
 * One stage slot. Renders nothing (not even a wrapper) while no mod has a layer
 * there, so the host tree is unchanged for users without mods.
 */
export const FoliumStageLayerSlot: React.FC<{
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
