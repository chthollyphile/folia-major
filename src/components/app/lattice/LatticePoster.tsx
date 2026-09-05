import { X } from 'lucide-react';
import { lazy, memo, Suspense } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRef, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react';
import { PlayerState, type SongResult } from '../../../types';
import type { ReflowTile } from './layout';
import type { LatticeTile } from './latticeModel';
import { useLatticeChromeDisclosure } from './useLatticeChromeDisclosure';
import LatticePlaybackControls from './LatticePlaybackControls';
import { useLatticeExpansionSettled } from './useLatticeExpansionSettled';
import { prewarmLatticeLyrics } from './lyrics/prewarmLatticeLyrics';
import { countRender } from '../../../dev/renderCount';

// Renders one poster and its expanded Player Chrome controls.
const LatticeLyrics = lazy(() => import('./lyrics/LatticeLyrics'));

type LatticePosterProps = {
    instanceId: string;
    isFocused: boolean;
    tile: LatticeTile;
    rect: Omit<ReflowTile, 'instanceId'>;
    /** Seconds this poster waits before dropping into its slot, or null outside the opening wave. */
    entranceDelay: number | null;
    /** Reverse-wave delay used when the complete wall leaves the viewport. */
    exitDelay: number;
    expanded: boolean;
    reducedMotion: boolean | null;
    didDragRef: MutableRefObject<boolean>;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    onExpand: (instanceId: string) => void;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onClose: () => void;
};

// How far above its slot a landing tile starts, in world units.
const ENTRANCE_LIFT = 90;

// Lift for the card under the pointer or the wall's keyboard cursor. It scales the whole article,
// which is why it has to run through Framer Motion - Framer owns the inline transform, so CSS
// cannot add to it. Zooming only the artwork inside a fixed frame was tried and abandoned: the wall
// carries a fractional scale, so a card's box sits on fractional device pixels, and a composited
// child snaps to them independently of the card itself. That left a 1px seam of unmasked artwork
// along the card outline on roughly half the frames of every hover. Measured across inset, clip-path
// and opacity-crossfade variants, all of which showed it. Scaling the whole card has no such second
// snapping unit and measured clean, so do NOT reintroduce `will-change` here as an optimization:
// promoting the card is what would give it a layer to misalign against.
const POP_SCALE = 1.03;

// `tile` and `rect` are rebuilt by the wall's own memos whenever the queue, the selection or the
// camera moves, so comparing them by identity would re-render every poster for values that did not
// change. Every other prop is a scalar, a ref, a MotionValue or a permanently-identified callback.
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
    entranceDelay,
    exitDelay,
    expanded,
    reducedMotion,
    didDragRef,
    currentSong,
    playerState,
    currentTime,
    playbackDuration,
    canTogglePlayback,
    onExpand,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onClose,
}: LatticePosterProps) {
    countRender('LatticePoster');
    const { t } = useTranslation();
    const chrome = useLatticeChromeDisclosure(expanded);
    // The open card is already the foreground and carries the lyric canvas, so it never pops.
    const popped = !expanded && (chrome.hovered || isFocused);
    const isCurrent = tile.section === 'now';
    // The lyric scene is a Pixi renderer whose layout is rebuilt from the card's box, so mounting it
    // mid-expansion would rasterize every line once per animation frame. It waits for the spring.
    const [expansionSettled, onExpansionComplete] = useLatticeExpansionSettled(expanded, Boolean(reducedMotion));
    // Hover and press are the last moments before the open: warming here keeps the lyric chunk,
    // the Pixi module and the first shader compile off the click path.
    const warmLyrics = () => { if (isCurrent) prewarmLatticeLyrics(); };
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
            onPointerDownCapture={(event: PointerEvent<HTMLElement>) => { warmLyrics(); chrome.onPointerDownCapture(event); }}
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
            animate={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: 1, scale: popped ? POP_SCALE : 1 }}
            exit={reducedMotion
                ? { opacity: 0, transition: { duration: 0 } }
                : {
                    y: rect.y - ENTRANCE_LIFT,
                    opacity: 0,
                    scale: 0.88,
                    transition: { duration: 0.28, delay: exitDelay, ease: [0.4, 0, 1, 1] },
                }}
            transition={reducedMotion
                ? { duration: 0 }
                : landing === null
                    ? {
                        type: 'spring', stiffness: 300, damping: 34,
                        opacity: { duration: 0.26, ease: 'easeOut' },
                        scale: { duration: 0.3, ease: 'easeOut' },
                    }
                    : {
                        type: 'spring', stiffness: 360, damping: 24, delay: landing,
                        opacity: { duration: 0.24, delay: landing },
                    }}
            style={{
                backgroundImage: tile.coverUrl ? `url("${tile.coverUrl}")` : fallbackBackground(tile.id),
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
            <span className={`lattice-poster-badge ${isCurrent ? 'is-current' : ''}`}>
                {isCurrent && <>{t('home.latticeBadgeNow')} · </>}
                {String(tile.queueIndex + 1).padStart(2, '0')}
            </span>
            {expanded && expansionSettled && isCurrent ? (
                <Suspense fallback={<span className="lattice-poster-copy"><strong>{tile.title}</strong><small>{tile.artist}</small></span>}>
                    <LatticeLyrics key={tile.id} tile={tile} reducedMotion={Boolean(reducedMotion)} />
                </Suspense>
            ) : <span className="lattice-poster-copy">
                <strong>{tile.title}</strong>
                <small>{tile.artist}</small>
            </span>}
            {expanded && (
                <button type="button" className="lattice-poster-close" onClick={onClose}
                    aria-label={t('home.latticeClose')} title={t('home.latticeClose')}>
                    <X size={18} />
                </button>
            )}
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
                        currentSong={currentSong}
                        playerState={playerState}
                        currentTime={currentTime}
                        playbackDuration={playbackDuration}
                        canTogglePlayback={canTogglePlayback}
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
