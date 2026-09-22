import { LatticeTitle } from './LatticeTitle';
import { lazy, memo, Suspense } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRef, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react';
import type { ReflowTile } from './layout';
import type { LatticeTile } from './latticeModel';
import { useLatticeChromeDisclosure } from './useLatticeChromeDisclosure';
import LatticePlaybackControls from './LatticePlaybackControls';
import { useLatticeExpansionSettled } from './useLatticeExpansionSettled';
import { prewarmLatticeLyrics } from './lyrics/prewarmLatticeLyrics';
import { prewarmLatticePosterArtwork, useLatticePosterArtwork } from './useLatticePosterArtwork';
import { countRender } from '../../../dev/renderCount';

// Renders one poster and its expanded Player Chrome controls.
const LatticeLyrics = lazy(() => import('./lyrics/LatticeLyrics'));

type LatticePosterProps = {
    instanceId: string;
    isFocused: boolean;
    tile: LatticeTile;
    rect: Omit<ReflowTile, 'instanceId'>;
    /** Empty world-space distance between neighbouring poster slots. */
    gap: number;
    /** World units to device pixels: the camera's scale times the display's pixel ratio. */
    pixelScale: number;
    /** World-space edge of the gear an expanded card takes, so a press can warm that variant. */
    expandedSize: number;
    /** Seconds this poster waits before dropping into its slot, or null outside the opening wave. */
    entranceDelay: number | null;
    /**
     * Reverse-wave delay for the moment the complete wall leaves the viewport. A function, not a
     * number, because it measures from a corner that moves with the camera: a card is not
     * re-rendered before it leaves, and a number handed down per render would either go stale or
     * re-render every mounted card on each re-cull. Identity must stay stable.
     */
    getExitDelay: (rect: { x: number; y: number }) => number;
    expanded: boolean;
    reducedMotion: boolean | null;
    didDragRef: MutableRefObject<boolean>;
    onExpand: (instanceId: string) => void;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
};

// How far above its slot a landing tile starts, in world units.
const ENTRANCE_LIFT = 90;

// Resolved at exit time from the card's own `custom`, so the leaving wave reads the live camera.
const LEAVING: Variants = {
    leaving: (resolve: () => { y: number; delay: number }) => {
        const { y, delay } = resolve();
        return { y, opacity: 0, scale: 0.88, scaleX: 1, scaleY: 1,
            transition: { duration: 0.28, delay, ease: [0.4, 0, 1, 1] } };
    },
};

// Lift for the card under the pointer or the wall's keyboard cursor. It scales the whole article,
// which is why it has to run through Framer Motion - Framer owns the inline transform, so CSS
// cannot add to it. Zooming only the artwork inside a fixed frame was tried and abandoned: the wall
// carries a fractional scale, so a card's box sits on fractional device pixels, and a composited
// child snaps to them independently of the card itself. That left a 1px seam of unmasked artwork
// along the card outline on roughly half the frames of every hover. Measured across inset, clip-path
// and opacity-crossfade variants, all of which showed it. Scaling the whole card has no such second
// snapping unit and measured clean, so do NOT reintroduce `will-change` here as an optimization:
// promoting the card is what would give it a layer to misalign against. X and Y use independent
// ratios so every edge grows outward by exactly one layout gap even when its aspect ratio or span differs.

// `tile` and `rect` are rebuilt by the wall's own memos whenever the queue, the selection or the
// camera moves, so comparing them by identity would re-render every poster for values that did not
// change. Every other prop is a scalar, a ref or a permanently-identified callback. Transport state
// is deliberately absent: it reaches the expanded chrome through `LatticeTransportContext`, because
// as a prop it changed on every pause and resume and no comparison here could absorb that.
const sameRect = (a: LatticePosterProps['rect'], b: LatticePosterProps['rect']) => (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
);

const sameTile = (a: LatticeTile, b: LatticeTile) => (
    a.id === b.id && a.queueIndex === b.queueIndex && a.section === b.section
    && a.title === b.title && a.artist === b.artist && a.coverUrl === b.coverUrl && a.song === b.song
);

const arePosterPropsEqual = (previous: LatticePosterProps, next: LatticePosterProps) => {
    for (const key of Object.keys(next) as (keyof LatticePosterProps)[]) {
        if (key === 'tile' || key === 'rect') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return sameTile(previous.tile, next.tile) && sameRect(previous.rect, next.rect);
};

const fallbackBackground = (id: string) => {
    const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    return `linear-gradient(145deg, hsl(${hue} 68% 58%), hsl(${(hue + 52) % 360} 62% 18%))`;
};

function LatticePoster({
    instanceId,
    isFocused,
    tile,
    rect,
    gap,
    pixelScale,
    expandedSize,
    entranceDelay,
    getExitDelay,
    expanded,
    reducedMotion,
    didDragRef,
    onExpand,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
}: LatticePosterProps) {
    countRender('LatticePoster');
    const { t } = useTranslation();
    const chrome = useLatticeChromeDisclosure(expanded);
    // The open card is already the foreground and carries the lyric canvas, so it never pops.
    const popped = !expanded && (chrome.hovered || isFocused);
    const popScaleX = popped && rect.width > 0 ? (rect.width + gap * 2) / rect.width : 1;
    const popScaleY = popped && rect.height > 0 ? (rect.height + gap * 2) / rect.height : 1;
    const isCurrent = tile.section === 'now';
    // The lyric scene is a Pixi renderer whose layout is rebuilt from the card's box, so mounting it
    // mid-expansion would rasterize every line once per animation frame. It waits for the spring.
    const [expansionSettled, onExpansionComplete] = useLatticeExpansionSettled(expanded, Boolean(reducedMotion));
    // The artwork only has to cover the card's own box, and a square cover is scaled to the longer
    // edge. Both inputs are discrete - gears are integer spans and the camera only rescales on a
    // breakpoint - so this is not a per-frame value even while the card animates towards the size.
    const coverUrl = useLatticePosterArtwork(tile.coverUrl, Math.max(rect.width, rect.height) * pixelScale);
    // Hover and press are the last moments before the open: warming here keeps the lyric chunk,
    // the Pixi module and the first shader compile off the click path.
    const warmLyrics = () => { if (isCurrent) prewarmLatticeLyrics(); };
    // Deliberately not on hover: a pointer sweeping the wall would pull a full-size cover per card,
    // which costs more than the swap it saves. A press is already an open in all but name.
    const warmExpandedArtwork = () => prewarmLatticePosterArtwork(tile.coverUrl, expandedSize * pixelScale);
    // Frozen at mount: the wave's own delay must not follow later camera moves.
    const landingDelay = useRef(entranceDelay).current;
    const landing = entranceDelay === null ? null : landingDelay;

    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest('button, input')) return;
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }
        if (!expanded) onExpand(instanceId);
        else chrome.toggleTouch();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!expanded) {
                onExpand(instanceId);
                return;
            }
            if (isCurrent) onTogglePlayback();
            else onPlay(tile);
            return;
        }
        if (event.key === ' ') {
            event.preventDefault();
            if (!expanded) onExpand(instanceId);
            else chrome.toggleKeyboard();
        }
    };

    return (
        <motion.article
            ref={chrome.articleRef}
            onPointerEnter={(event: PointerEvent<HTMLElement>) => { warmLyrics(); chrome.onPointerEnter(event); }}
            onPointerLeave={chrome.onPointerLeave}
            onPointerDownCapture={(event: PointerEvent<HTMLElement>) => { warmLyrics(); warmExpandedArtwork(); chrome.onPointerDownCapture(event); }}
            onFocusCapture={chrome.onFocusCapture}
            onBlurCapture={chrome.onBlurCapture}
            key={instanceId}
            className={`lattice-poster ${expanded ? 'is-expanded' : ''} ${isFocused ? 'is-focused' : ''} ${isCurrent ? 'is-current' : ''}`}
            data-instance-id={instanceId}
            initial={reducedMotion
                ? false
                : landing === null
                    // Outside the opening wave a poster still fades up in place, so posters
                    // revealed by a pan or a queue change never pop in fully drawn.
                    ? { ...rect, opacity: 0, scale: 0.94 }
                    : { ...rect, y: rect.y - ENTRANCE_LIFT, opacity: 0, scale: 0.88 }}
            animate={{
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                opacity: 1,
                scale: 1,
                scaleX: popScaleX,
                scaleY: popScaleY,
            }}
            // A dynamic variant rather than a target object: Framer resolves it when the exit
            // actually runs, which is the only moment the wave's delay can be read from the camera
            // where it stands. Nothing else here is a variant, so no label reaches the children.
            variants={LEAVING}
            custom={() => ({ y: rect.y - ENTRANCE_LIFT, delay: getExitDelay(rect) })}
            exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : 'leaving'}
            transition={reducedMotion
                ? { duration: 0 }
                : landing === null
                    ? {
                        type: 'spring', stiffness: 300, damping: 34,
                        opacity: { duration: 0.26, ease: 'easeOut' },
                        scaleX: { duration: 0.3, ease: 'easeOut' },
                        scaleY: { duration: 0.3, ease: 'easeOut' },
                    }
                    : {
                        type: 'spring', stiffness: 360, damping: 24, delay: landing,
                        opacity: { duration: 0.24, delay: landing },
                    }}
            style={{
                backgroundImage: coverUrl ? `url("${coverUrl}")` : fallbackBackground(tile.id),
                zIndex: expanded ? 20 : undefined,
            }}
            onAnimationComplete={onExpansionComplete}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role={expanded ? 'group' : 'button'}
            tabIndex={expanded ? -1 : 0}
            aria-expanded={expanded ? undefined : false}
            aria-label={`${tile.title} · ${tile.artist}`}
        >
            <span className="lattice-poster-shade" />
            <span className="lattice-poster-lights-out" />
            <span className="lattice-poster-tint" />
            <span className={`lattice-poster-badge ${isCurrent ? 'is-current' : ''}`}>
                {isCurrent && <>{t('home.latticeBadgeNow')} · </>}
                {String(tile.queueIndex + 1).padStart(2, '0')}
            </span>
            {expanded && expansionSettled && isCurrent ? (
                <Suspense fallback={<span className="lattice-poster-copy"><LatticeTitle title={tile.title} expanded={expanded} targetPosterWidth={rect.width} /><small>{tile.artist}</small></span>}>
                    <LatticeLyrics key={tile.id} tile={tile} reducedMotion={Boolean(reducedMotion)} pixelScale={pixelScale} />
                </Suspense>
            ) : <span className="lattice-poster-copy">
                {/* `rect` is the slot the card is heading for, in world units, so the title is fitted
                    against its final column before the spring has moved it there. */}
                <LatticeTitle title={tile.title} expanded={expanded} targetPosterWidth={rect.width} />
                <small>{tile.artist}</small>
            </span>}
            {expanded && (
                <motion.div
                    className="lattice-poster-controls"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reducedMotion ? 0 : 0.14, duration: reducedMotion ? 0 : 0.24 }}
                >
                    <LatticePlaybackControls
                        revealed={chrome.revealed}
                        tile={tile}
                        onPlay={onPlay}
                        onTogglePlayback={onTogglePlayback}
                        onSeek={onSeek}
                        onOpenPlayer={onOpenPlayer}
                    />
                </motion.div>
            )}
        </motion.article>
    );
}

export default memo(LatticePoster, arePosterPropsEqual);
