import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SongResult } from '../../../types';
import {
    overlaps,
    toBounds,
    type Bounds,
    type ReflowTile,
    type WallMetrics,
} from '../../wall/layout';
import { createQueueLayout, type WallSection } from './wallLayout';
import { createExploreLayout } from './exploreLayout';
import { useWallCameraPan, type LatticeCamera } from '../../wall/useWallCameraPan';
import { useLatticePosterSelection } from './useLatticePosterSelection';
import { useWallKeyboardFocus } from './useWallKeyboardFocus';
import { useWallPointerPan } from '../../wall/useWallPointerPan';
import { formatWorldTransform } from '../../wall/wallView';
import type { LatticeTile } from './latticeModel';
import LatticePoster from './LatticePoster';
import LatticeHeading from './LatticeHeading';
import LatticeSectionFinder from './LatticeSectionFinder';
import { useWallSections } from './useWallSections';
import { countRender } from '../../../dev/renderCount';
import {
    useLatticePlaybackFocus,
} from './useLatticePlaybackFocus';
import { setLatticeCurrentSongPosterVisible } from '../../../stores/useLatticeControlsStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { useDevicePixelRatio } from '../../../hooks/useMediaQuery';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { EXPANSION_SPAN } from '../../wall/blockTemplates';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../stores/useWallHandoffStore';
import { useLatticeWallHandoff } from './useLatticeWallHandoff';
import { wallIsLeftForPage } from './wallLayer';

// Draggable poster field: one greedily packed block template repeats over the wall's list
// (the play queue). The explore page's entries are laid out by the page's sections instead,
// each section a lot with its heading as a tile (exploreLayout.ts); the field asks either
// layout the same questions (`WallLayout` in wallLayout.ts).
// 翻牌交接（设计稿 §7「进入队列」）：从资料库墙进来时不跑自己的入场波次，海报侧立着等资料库墙翻出、再按到起点的距离翻进；
// 回资料库墙时海报按距离翻出（useLatticeWallHandoff）。

type PosterWallProps = {
    tiles: LatticeTile[];
    /** The explore wall only: the sections `tiles` stand in, by which that wall is laid out. Without them the wall is the queue's. */
    sections?: WallSection[];
    /** The tile the wall opens on in place of the playing song: the one it was left on for a collection's page. */
    startTileId?: string | null;
    /** Only for playback focus and visibility tracking; the chrome reads transport state from context. */
    currentSong: SongResult | null;
    /** The wall's day/night mode: the chrome below the field (the section finder) follows it. */
    isDaylight: boolean;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onBack: () => void;
};


const CELL_SIZE = 128;
const GAP = 8;
const OVERSCAN = 500;
// How much of the flight path may stay rendered while the camera travels, in viewports.
const MAX_RESERVED_VIEWPORTS = 3;
// Metro tile landing: the wave starts at the top-left of the viewport and runs down the diagonal.
const ENTRANCE_STAGGER = 0.03;
const ENTRANCE_MAX_DELAY = 0.34;
const ENTRANCE_WINDOW = 1100;
const METRICS: WallMetrics = { cellSize: CELL_SIZE, gap: GAP };
// Longest edge a card can reach, which is the gear expansion hands it.
const EXPANDED_SIZE = EXPANSION_SPAN.cols * (CELL_SIZE + GAP) - GAP;


// Where the wall's own top left stands in the window when the wall opens with nothing to go to:
// under the wall's buttons. A section the explore wall is taken to has its heading put there.
const CAMERA_HOME = { x: 34, y: 80 };

const getScale = (width: number) => width < 640 ? 0.52 : width < 1100 ? 0.64 : 0.76;

const getWorldBounds = (camera: LatticeCamera, viewport: { width: number; height: number }): Bounds => ({
    left: -camera.x / camera.scale,
    top: -camera.y / camera.scale,
    right: (viewport.width - camera.x) / camera.scale,
    bottom: (viewport.height - camera.y) / camera.scale,
});

export default function PosterWall({
    tiles,
    sections,
    startTileId = null,
    currentSong,
    isDaylight,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onBack,
}: PosterWallProps) {
    countRender('PosterWall');
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<LatticeCamera>({ ...CAMERA_HOME, scale: 0.76 });
    const viewportRef = useRef({ width: 1280, height: 720 });
    const frameRef = useRef<number | null>(null);
    const trackedCurrentPosterRef = useRef<{
        enabled: boolean;
        rect: Omit<ReflowTile, 'instanceId'> | null;
    }>({ enabled: false, rect: null });
    const currentPosterVisibleRef = useRef(true);
    const [bounds, setBounds] = useState<Bounds>(() => getWorldBounds(cameraRef.current, viewportRef.current));
    // Nothing is drawn until the field reports its size: the seeded camera and the default
    // viewport would otherwise place the entering wave, and the playing song, off centre.
    const [measured, setMeasured] = useState(false);
    // A wall come back to from a collection's page (`startTileId`) stands as it was left from
    // its first frame, for that page's cover flies back to the tile: no opening wave, nothing
    // drawn until the camera is on the tile and the tile is grown (`opened`), and the posters
    // of the render that draws it first mounted as they are drawn (`hasDrawnRef`).
    const isReturn = startTileId !== null;
    const [entranceDone, setEntranceDone] = useState(isReturn);
    const [opened, setOpened] = useState(!isReturn);
    const hasDrawnRef = useRef(!isReturn);
    useEffect(() => {
        if (opened) hasDrawnRef.current = true;
    }, [opened]);
    // Camera scale, mirrored into state only so posters can size their artwork. It follows the
    // width breakpoints, so this settles after the first measure and then only moves on a resize.
    const [cameraScale, setCameraScale] = useState(() => cameraRef.current.scale);
    const reducedMotion = useReducedMotionFor('lattice');
    // 从资料库墙翻牌交接进来（或淡入交叉）：入场由交接代替，不跑抬起落下的波次。
    const entranceSuppressed = useWallHandoffStore(state => resolveWallHandoffRole(state.session, 'lattice') === 'in');
    const autoFocusOnSongChange = useLatticeSettingsStore(state => state.autoFocusOnSongChange);
    const devicePixelRatio = useDevicePixelRatio();
    const pixelScale = cameraScale * devicePixelRatio;

    const wallLayout = useMemo(
        () => (sections ? createExploreLayout(sections, METRICS) : createQueueLayout(tiles.length, METRICS)),
        [sections, tiles.length],
    );
    const [activePoster, setActivePoster] = useLatticePosterSelection(tiles, wallLayout);
    // What follows the camera besides the posters: which section the explore wall stands in
    // (useWallSections, further down, which needs the pan this camera is applied by).
    const cameraWatchRef = useRef<(camera: LatticeCamera) => void>(() => undefined);

    const publishCurrentPosterVisibility = useCallback((camera: LatticeCamera) => {
        const tracked = trackedCurrentPosterRef.current;
        const visible = !tracked.enabled || Boolean(
            tracked.rect && overlaps(toBounds(tracked.rect), getWorldBounds(camera, viewportRef.current)),
        );
        if (currentPosterVisibleRef.current === visible) return;
        currentPosterVisibleRef.current = visible;
        setLatticeCurrentSongPosterVisible(visible);
    }, []);

    const applyCamera = useCallback((next: LatticeCamera, updateBounds = false) => {
        cameraRef.current = next;
        if (worldRef.current) {
            worldRef.current.style.transform = formatWorldTransform(next.x, next.y, next.scale);
        }
        publishCurrentPosterVisibility(next);
        cameraWatchRef.current(next);
        if (!updateBounds || frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            setBounds(getWorldBounds(cameraRef.current, viewportRef.current));
            frameRef.current = null;
        });
    }, [publishCurrentPosterVisibility]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(([entry]) => {
            viewportRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
            const scale = getScale(entry.contentRect.width);
            applyCamera({ ...cameraRef.current, scale }, true);
            setCameraScale(previous => previous === scale ? previous : scale);
            setMeasured(true);
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
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

    const { panTo, stopPan, animationRef } = useWallCameraPan({ cameraRef, viewportRef, reducedMotion, applyCamera, reserveBounds });
    const wallSections = useWallSections({ layout: wallLayout, cameraRef, viewportRef, animationRef, panTo, corner: CAMERA_HOME });
    cameraWatchRef.current = wallSections.watchCamera;

    useEffect(() => {
        if (!measured || entranceDone) return;
        if (reducedMotion || entranceSuppressed) {
            setEntranceDone(true);
            return;
        }
        const timer = setTimeout(() => setEntranceDone(true), ENTRANCE_WINDOW);
        return () => clearTimeout(timer);
    }, [entranceDone, entranceSuppressed, measured, reducedMotion]);

    // Posters landing in the opening wave are held back by their distance from that corner; once
    // the wave is over every poster mounts in place, so panning never replays it.
    const getEntranceDelay = useCallback((rect: { x: number; y: number }) => {
        if (entranceDone || reducedMotion || entranceSuppressed) return null;
        const steps = Math.max(0, rect.x - bounds.left) + Math.max(0, rect.y - bounds.top);
        return Math.min(ENTRANCE_MAX_DELAY, (steps / (CELL_SIZE + GAP)) * ENTRANCE_STAGGER);
    }, [bounds.left, bounds.top, entranceDone, entranceSuppressed, reducedMotion]);

    // The entry wave reaches the top-left first; leaving reverses that order while cards retrace
    // their upward flight, so the wall empties back toward the corner it entered from.
    //
    // Permanently identified, and reading the corner it measures from through a ref, because the
    // posters hold this across camera moves. A delay computed per render would have to be handed
    // down as a changing number, and the corner moves with every pan - which defeated
    // LatticePoster's memo and re-rendered every mounted card on each re-cull. The card calls this
    // when it actually leaves, so the wave is still measured against the corner of the moment.
    const exitWaveRef = useRef({ bounds, reducedMotion });
    exitWaveRef.current = { bounds, reducedMotion };
    // No wave where the wall is left for a collection's page: it fades as a whole then, in a
    // moment (wallLayer.ts), under the cover that flies from its tile.
    const getExitDelay = useCallback((rect: { x: number; y: number }) => {
        if (wallIsLeftForPage()) return null;
        const { bounds: corner, reducedMotion: reduced } = exitWaveRef.current;
        if (reduced) return 0;
        const steps = Math.max(0, rect.x - corner.left) + Math.max(0, rect.y - corner.top);
        const entranceDelay = Math.min(ENTRANCE_MAX_DELAY, (steps / (CELL_SIZE + GAP)) * ENTRANCE_STAGGER);
        return ENTRANCE_MAX_DELAY - entranceDelay;
    }, []);

    // The posters, and on the explore wall the headings, that are drawn.
    const drawn = useMemo(() => {
        if (!measured || !opened) return { posters: [], headings: [] };
        const visible = wallLayout.near(bounds, OVERSCAN);
        if (!activePoster || visible.posters.some(instance => instance.instanceId === activePoster.instance.instanceId)) {
            return visible;
        }
        return { posters: [...visible.posters, activePoster.instance], headings: visible.headings };
    }, [activePoster, bounds, wallLayout, measured, opened]);
    const instances = drawn.posters;

    // World point the viewport is centred on; both the keyboard seed and playback follow need it.
    const getViewportCenter = useCallback(() => {
        const camera = cameraRef.current;
        const viewport = viewportRef.current;
        return {
            x: (viewport.width / 2 - camera.x) / camera.scale,
            y: (viewport.height / 2 - camera.y) / camera.scale,
        };
    }, []);

    const { didDragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } = useWallPointerPan({
        applyCamera,
        animationRef,
        stopPan,
        containerRef,
        reducedMotion,
        overscan: OVERSCAN,
        bounds,
        cameraRef,
        getWorldBounds,
        viewportRef,
    });

    // Only the block holding the open card is re-geared; every other poster keeps its base rect.
    // (On the explore wall: only the lot.)
    const layout = useMemo(() => (
        activePoster
            ? wallLayout.grown(activePoster.instance)
            : new Map<string, { x: number; y: number; width: number; height: number }>()
    ), [activePoster, wallLayout]);

    // A new list may seat the grown card elsewhere: the grid of blocks follows the list's length,
    // and a tile's seats its place in the list; on the explore wall the lots, and the places they
    // stand at, follow the page's sections (useLatticePosterSelection keeps the card, on the
    // nearest seat of its tile). While the card is in the window the camera then moves by as much
    // as the card did, at once and before the paint that moves it: the card stays where it was in
    // the window, also where the listener had dragged it to, and a flight or a coast under way
    // ends there. Nothing while the card is out of the window (the listener looks elsewhere), for
    // a card that keeps its place, when another card is grown, or while none is.
    const grownRect = activePoster ? layout.get(activePoster.instance.instanceId) ?? activePoster.instance : null;
    const grownId = activePoster?.tile.id ?? null;
    const seatedRef = useRef({ tiles, id: grownId, rect: grownRect });
    useLayoutEffect(() => {
        const before = seatedRef.current;
        seatedRef.current = { tiles, id: grownId, rect: grownRect };
        if (before.tiles === tiles || before.id !== grownId || !before.rect || !grownRect) return;
        const dx = grownRect.x - before.rect.x;
        const dy = grownRect.y - before.rect.y;
        if (dx === 0 && dy === 0) return;
        const camera = cameraRef.current;
        if (!overlaps(toBounds(before.rect), getWorldBounds(camera, viewportRef.current))) return;
        console.log(`[Lattice] A new list (${before.tiles.length} to ${tiles.length} entries) moved the grown card: camera moved with it`);
        stopPan();
        const moved = { x: camera.x - dx * camera.scale, y: camera.y - dy * camera.scale, scale: camera.scale };
        reserveBounds(moved);
        applyCamera(moved, true);
    }, [applyCamera, grownId, grownRect, reserveBounds, stopPan, tiles]);

    useEffect(() => {
        const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        const isTracking = measured && Boolean(currentSongKey);
        const rect = activePoster && activePoster.tile.id === currentSongKey
            ? layout.get(activePoster.instance.instanceId) ?? activePoster.instance
            : null;
        trackedCurrentPosterRef.current = { enabled: isTracking, rect };
        publishCurrentPosterVisibility(cameraRef.current);
    }, [activePoster, currentSong, layout, measured, publishCurrentPosterVisibility]);

    useEffect(() => () => {
        currentPosterVisibleRef.current = true;
        setLatticeCurrentSongPosterVisible(true);
    }, []);

    const { focused, setFocused, handleKeyDown, handleFocusCapture, handleBlurCapture } = useWallKeyboardFocus({
        activePoster,
        containerRef,
        layout: wallLayout,
        getViewportCenter,
        instances,
        metrics: METRICS,
        panTo,
        rendered: layout,
        setActivePoster,
        tiles,
        worldRef,
        onBack,
    });

    // Permanent identities for the two handlers every poster receives. An arrow per poster is
    // re-created on each wall render, which alone would defeat LatticePoster's memo and put all
    // 50+ poster bodies back on the critical path of every unrelated App re-render.
    const latestWall = useRef({ wallLayout, instances, tiles });
    latestWall.current = { wallLayout, instances, tiles };
    const expandPoster = useCallback((instanceId: string) => {
        const { wallLayout: currentLayout, instances: currentInstances, tiles: currentTiles } = latestWall.current;
        const instance = currentInstances.find(item => item.instanceId === instanceId);
        const tile = instance ? currentTiles[instance.queueIndex] : undefined;
        if (!instance || !tile) return;
        setFocused(instance);
        setActivePoster({ instance, tile });
        // Expansion reflows both the position and size of the selected slot.
        const expandedRect = currentLayout.grown(instance).get(instanceId);
        if (expandedRect) panTo(expandedRect);
    }, [panTo, setActivePoster, setFocused]);
    const collapsePoster = useCallback(() => setActivePoster(null), [setActivePoster]);

    useLatticePlaybackFocus({
        currentSong,
        startTileId,
        ready: measured,
        tiles,
        layout: wallLayout,
        getViewportCenter,
        setActivePoster,
        setFocused,
        panTo,
    });
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const handoff = useLatticeWallHandoff({
        containerRef,
        cameraRef,
        applyCamera,
        measured,
        metrics: METRICS,
        activePoster,
        layout,
        focused,
        waitingForFocus: autoFocusOnSongChange && !activePoster && currentSongKey !== null
            && tiles.some(tile => tile.id === currentSongKey),
    });
    // After the effects of the hook above, which put the camera on the start tile and grow it.
    useEffect(() => {
        if (measured) setOpened(true);
    }, [measured]);

    // A flight to a section leaves the focused poster far outside the window, where it is taken
    // down: with the focus still on it the field would hear no key after. The field takes the
    // focus, and the next arrow starts from what is on screen (as after Escape).
    const leaveForSection = useCallback(() => {
        setFocused(null);
        containerRef.current?.focus({ preventScroll: true });
    }, [setFocused]);
    const goToSection = wallSections.goToSection;
    const chooseSection = useCallback((section: number) => {
        leaveForSection();
        goToSection(section);
    }, [goToSection, leaveForSection]);

    // PageDown and PageUp are the explore wall's (the next and the previous section); every
    // other key, and both of these on the queue wall, goes on to the wall's own handler.
    const handleFieldKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (wallSections.handleKeyDown(event)) leaveForSection();
        else handleKeyDown(event);
    };

    return (
        <>
        <div
            ref={containerRef}
            className="lattice-field"
            tabIndex={-1}
            onKeyDown={handleFieldKeyDown}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={event => {
                // Touch transfers implicit capture from the poster to the field when dragging.
                if (event.target === event.currentTarget) onPointerCancel(event);
            }}
            onClickCapture={onClickCapture}
        >
            <div ref={worldRef} className="lattice-world">
                {/* The explore wall's headings: tiles of the wall that are no posters. */}
                {drawn.headings.map(heading => {
                    const section = wallLayout.sections[heading.section];
                    if (!section) return null;
                    return (
                        <LatticeHeading
                            key={heading.instanceId}
                            rect={heading}
                            section={section}
                            number={heading.section + 1}
                            count={wallLayout.sections.length}
                            part={heading.part + 1}
                            parts={heading.parts}
                            entranceDelay={getEntranceDelay(heading)}
                            mountsInPlace={!hasDrawnRef.current}
                            getExitDelay={getExitDelay}
                            reducedMotion={reducedMotion}
                        />
                    );
                })}
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
                            gap={METRICS.gap}
                            pixelScale={pixelScale}
                            expandedSize={EXPANDED_SIZE}
                            entranceDelay={getEntranceDelay(rect)}
                            mountsInPlace={!hasDrawnRef.current}
                            getExitDelay={getExitDelay}
                            handoff={handoff.getPosterHandoff(instance.instanceId, rect)}
                            expanded={expanded}
                            reducedMotion={reducedMotion}
                            didDragRef={didDragRef}
                            onExpand={expandPoster}
                            onPlay={onPlay}
                            onTogglePlayback={onTogglePlayback}
                            onSeek={onSeek}
                            onOpenPlayer={onOpenPlayer}
                        />
                    );
                })}
            </div>

        </div>
        {/* Outside the field, whose keys and drags are the wall's: the explore wall's way to a section. */}
        {wallSections.section !== null && (
            <LatticeSectionFinder sections={wallLayout.sections} current={wallSections.section} onChoose={chooseSection} isDaylight={isDaylight} />
        )}
        </>
    );
}
