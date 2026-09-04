import { useReducedMotion, type MotionValue } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayerState, type SongResult } from '../../../types';
import {
    getLatticeGeometry,
    layoutExpandedBlock,
    layoutLattice,
    type Bounds,
    type WallMetrics,
} from './layout';
import { useWallCameraPan, type LatticeCamera } from './useWallCameraPan';
import { useWallKeyboardFocus } from './useWallKeyboardFocus';
import { useWallPointerPan } from './useWallPointerPan';
import type { LatticeTile } from './latticeModel';
import LatticePoster from './LatticePoster';
import {
    useLatticePlaybackFocus,
    type ActiveLatticePoster,
} from './useLatticePlaybackFocus';

// Draggable poster field: one greedily packed block template repeats over the queue.

type PosterWallProps = {
    tiles: LatticeTile[];
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
};


const CELL_SIZE = 128;
const GAP = 8;
const OVERSCAN = 500;
// How much of the flight path may stay rendered while the camera travels, in viewports.
const MAX_RESERVED_VIEWPORTS = 3;
const METRICS: WallMetrics = { cellSize: CELL_SIZE, gap: GAP };


const getScale = (width: number) => width < 640 ? 0.52 : width < 1100 ? 0.64 : 0.76;

const getWorldBounds = (camera: LatticeCamera, viewport: { width: number; height: number }): Bounds => ({
    left: -camera.x / camera.scale,
    top: -camera.y / camera.scale,
    right: (viewport.width - camera.x) / camera.scale,
    bottom: (viewport.height - camera.y) / camera.scale,
});

export default function PosterWall({
    tiles,
    currentSong,
    playerState,
    currentTime,
    playbackDuration,
    canTogglePlayback,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
}: PosterWallProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<LatticeCamera>({ x: 34, y: 80, scale: 0.76 });
    const viewportRef = useRef({ width: 1280, height: 720 });
    const frameRef = useRef<number | null>(null);
    const [bounds, setBounds] = useState<Bounds>(() => getWorldBounds(cameraRef.current, viewportRef.current));
    const [activePoster, setActivePoster] = useState<ActiveLatticePoster | null>(null);
    const [showHint, setShowHint] = useState(true);
    const reducedMotion = useReducedMotion();

    const geometry = useMemo(() => getLatticeGeometry(tiles.length, METRICS), [tiles.length]);

    const applyCamera = useCallback((next: LatticeCamera, updateBounds = false) => {
        cameraRef.current = next;
        if (worldRef.current) {
            worldRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
        }
        if (!updateBounds || frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            setBounds(getWorldBounds(cameraRef.current, viewportRef.current));
            frameRef.current = null;
        });
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(([entry]) => {
            viewportRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
            applyCamera({ ...cameraRef.current, scale: getScale(entry.contentRect.width) }, true);
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        };
    }, [applyCamera]);

    // Widens the culled region to cover a pan's destination the moment it starts. Held arrow
    // keys interrupt each pan before it settles, so bounds cannot wait for the animation to end.
    const reserveBounds = useCallback((camera: LatticeCamera) => {
        const destination = getWorldBounds(camera, viewportRef.current);
        setBounds(current => {
            const covered = destination.left >= current.left && destination.right <= current.right
                && destination.top >= current.top && destination.bottom <= current.bottom;
            if (covered) return current;

            const merged = {
                left: Math.min(current.left, destination.left),
                right: Math.max(current.right, destination.right),
                top: Math.min(current.top, destination.top),
                bottom: Math.max(current.bottom, destination.bottom),
            };
            // A long flight would otherwise reserve more than the render cap can fill, which
            // empties the far end; past that point only the destination is worth keeping.
            const mergedArea = (merged.right - merged.left) * (merged.bottom - merged.top);
            const destinationArea = (destination.right - destination.left)
                * (destination.bottom - destination.top);
            return mergedArea > destinationArea * MAX_RESERVED_VIEWPORTS ? destination : merged;
        });
    }, []);

    const panTo = useWallCameraPan({ cameraRef, viewportRef, reducedMotion, applyCamera, reserveBounds });

    const instances = useMemo(() => {
        const visible = layoutLattice(geometry, tiles.length, bounds, OVERSCAN, METRICS);
        if (!activePoster || visible.some(instance => instance.instanceId === activePoster.instance.instanceId)) {
            return visible;
        }
        return [...visible, activePoster.instance];
    }, [activePoster, bounds, geometry, tiles.length]);

    // World point the viewport is centred on; both the keyboard seed and playback follow need it.
    const getViewportCenter = useCallback(() => {
        const camera = cameraRef.current;
        const viewport = viewportRef.current;
        return {
            x: (viewport.width / 2 - camera.x) / camera.scale,
            y: (viewport.height / 2 - camera.y) / camera.scale,
        };
    }, []);

    const { didDragRef, onPointerDown, onPointerMove, onPointerUp, onWheel } = useWallPointerPan({
        applyCamera,
        bounds,
        cameraRef,
        getWorldBounds,
        setShowHint,
        viewportRef,
    });

    // Only the block holding the open card is re-geared; every other poster keeps its base rect.
    const layout = useMemo(() => (
        activePoster
            ? layoutExpandedBlock(geometry, tiles.length, activePoster.instance, METRICS)
            : new Map<string, { x: number; y: number; width: number; height: number }>()
    ), [activePoster, geometry, tiles.length]);

    const { focused, setFocused, handleKeyDown } = useWallKeyboardFocus({
        activePoster,
        containerRef,
        geometry,
        getViewportCenter,
        instances,
        metrics: METRICS,
        panTo,
        rendered: layout,
        setActivePoster,
        setShowHint,
        totalEntries: tiles.length,
        worldRef,
    });

    useLatticePlaybackFocus({
        currentSong,
        tiles,
        geometry,
        metrics: METRICS,
        getViewportCenter,
        setActivePoster,
        setShowHint,
        setFocused,
        panTo,
    });
    return (
        <div
            ref={containerRef}
            className="lattice-field"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
        >
            <div ref={worldRef} className="lattice-world">
                {instances.map(instance => {
                    const tile = tiles[instance.queueIndex];
                    if (!tile) return null;
                    const expanded = activePoster?.instance.instanceId === instance.instanceId;
                    const rect = layout.get(instance.instanceId) ?? instance;
                    return (
                        <LatticePoster
                            key={instance.instanceId}
                            instanceId={instance.instanceId}
                            isFocused={focused?.instanceId === instance.instanceId}
                            tile={tile}
                            rect={rect}
                            expanded={expanded}
                            reducedMotion={reducedMotion}
                            didDragRef={didDragRef}
                            currentSong={currentSong}
                            playerState={playerState}
                            currentTime={currentTime}
                            playbackDuration={playbackDuration}
                            canTogglePlayback={canTogglePlayback}
                            onExpand={() => {
                                setShowHint(false);
                                setFocused(instance);
                                setActivePoster({ instance, tile });
                            }}
                            onPlay={onPlay}
                            onTogglePlayback={onTogglePlayback}
                            onSeek={onSeek}
                            onOpenPlayer={onOpenPlayer}
                            onClose={() => setActivePoster(null)}
                        />
                    );
                })}
            </div>

            <div className={`lattice-hint ${showHint && tiles.length ? '' : 'is-hidden'}`}>
                <span />
                <strong>{t('home.latticeExplore')}</strong>
                <small>{t('home.latticeExploreHint')}</small>
            </div>

        </div>
    );
}
