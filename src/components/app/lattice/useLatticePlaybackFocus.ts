import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { EXPANSION_SPAN } from './blockTemplates';
import { locateNearestInstance, type LatticeGeometry, type QueueInstance, type WallMetrics } from './layout';
import type { LatticeTile } from './latticeModel';

// Follows discrete song changes; per-frame camera movement stays inside useWallCameraPan.

export type ActiveLatticePoster = { instance: QueueInstance; tile: LatticeTile };

type PlaybackFocusOptions = {
    currentSong: SongResult | null;
    tiles: LatticeTile[];
    geometry: LatticeGeometry;
    metrics: WallMetrics;
    getViewportCenter: () => { x: number; y: number };
    setActivePoster: Dispatch<SetStateAction<ActiveLatticePoster | null>>;
    setShowHint: Dispatch<SetStateAction<boolean>>;
    setFocused: (instance: QueueInstance | null) => void;
    panTo: (rect: { x: number; y: number; width: number; height: number }) => void;
};

export const useLatticePlaybackFocus = ({
    currentSong,
    tiles,
    geometry,
    metrics,
    getViewportCenter,
    setActivePoster,
    setShowHint,
    setFocused,
    panTo,
}: PlaybackFocusOptions) => {
    const lastFocusedSongKeyRef = useRef<string | null>(null);

    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    useEffect(() => {
        if (!currentSongKey) {
            lastFocusedSongKeyRef.current = null;
            return;
        }
        if (lastFocusedSongKeyRef.current === currentSongKey) return;
        const queueIndex = tiles.findIndex(tile => tile.id === currentSongKey);
        if (queueIndex < 0) return;
        // The song is drawn in every cell; jump to whichever copy is closest to what is on screen.
        const instance = locateNearestInstance(
            geometry,
            tiles.length,
            queueIndex,
            getViewportCenter(),
            metrics,
        );
        if (!instance) return;

        const tile = tiles[queueIndex];
        lastFocusedSongKeyRef.current = currentSongKey;
        setShowHint(false);
        setFocused(instance);
        setActivePoster({ instance, tile });
        panTo({
            x: instance.x,
            y: instance.y,
            width: EXPANSION_SPAN.cols * (metrics.cellSize + metrics.gap) - metrics.gap,
            height: EXPANSION_SPAN.rows * (metrics.cellSize + metrics.gap) - metrics.gap,
        });
    }, [currentSongKey, geometry, getViewportCenter, metrics, panTo, setActivePoster, setFocused, setShowHint, tiles]);
};
