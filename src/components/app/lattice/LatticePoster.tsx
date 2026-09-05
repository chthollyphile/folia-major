import { X } from 'lucide-react';
import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRef, type KeyboardEvent, type MouseEvent, type MutableRefObject } from 'react';
import { PlayerState, type SongResult } from '../../../types';
import type { ReflowTile } from './layout';
import type { LatticeTile } from './latticeModel';
import { useLatticeChromeDisclosure } from './useLatticeChromeDisclosure';
import LatticePlaybackControls from './LatticePlaybackControls';

// Renders one poster and its expanded Player Chrome controls.

type LatticePosterProps = {
    instanceId: string;
    isFocused: boolean;
    tile: LatticeTile;
    rect: Omit<ReflowTile, 'instanceId'>;
    /** Seconds this poster waits before dropping into its slot, or null outside the opening wave. */
    entranceDelay: number | null;
    expanded: boolean;
    reducedMotion: boolean | null;
    didDragRef: MutableRefObject<boolean>;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    onExpand: () => void;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onClose: () => void;
};

// How far above its slot a landing tile starts, in world units.
const ENTRANCE_LIFT = 90;

const fallbackBackground = (id: string) => {
    const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    return `linear-gradient(145deg, hsl(${hue} 68% 58%), hsl(${(hue + 52) % 360} 62% 18%))`;
};

export default function LatticePoster({
    instanceId,
    isFocused,
    tile,
    rect,
    entranceDelay,
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
    const { t } = useTranslation();
    const chrome = useLatticeChromeDisclosure(expanded);
    // Frozen at mount: the wave's own delay must not follow later camera moves.
    const landingDelay = useRef(entranceDelay).current;
    const landing = entranceDelay === null ? null : landingDelay;

    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest('button, input')) return;
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }
        if (!expanded) onExpand();
        else chrome.toggleTouch();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!expanded) onExpand();
            else chrome.toggleKeyboard();
        }
    };

    return (
        <motion.article
            ref={chrome.articleRef}
            onPointerEnter={chrome.onPointerEnter}
            onPointerLeave={chrome.onPointerLeave}
            onPointerDownCapture={chrome.onPointerDownCapture}
            onFocusCapture={chrome.onFocusCapture}
            onBlurCapture={chrome.onBlurCapture}
            key={instanceId}
            className={`lattice-poster ${expanded ? 'is-expanded' : ''} ${isFocused ? 'is-focused' : ''} ${tile.section === 'now' ? 'is-current' : ''}`}
            data-instance-id={instanceId}
            initial={landing === null
                ? false
                : { ...rect, y: rect.y - ENTRANCE_LIFT, opacity: 0, scale: 0.88 }}
            animate={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: 1, scale: 1 }}
            transition={reducedMotion
                ? { duration: 0 }
                : landing === null
                    ? { type: 'spring', stiffness: 300, damping: 34 }
                    : {
                        type: 'spring', stiffness: 360, damping: 24, delay: landing,
                        opacity: { duration: 0.24, delay: landing },
                    }}
            style={{
                backgroundImage: tile.coverUrl ? `url("${tile.coverUrl}")` : fallbackBackground(tile.id),
                zIndex: expanded ? 20 : undefined,
            }}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role={expanded ? 'group' : 'button'}
            tabIndex={expanded ? -1 : 0}
            aria-expanded={expanded ? undefined : false}
            aria-label={`${tile.title} · ${tile.artist}`}
        >
            <span className="lattice-poster-shade" />
            <span className="lattice-poster-badge">{t(`home.latticeBadge.${tile.section}`)}</span>
            <span className="lattice-poster-copy">
                <strong>{tile.title}</strong>
                <small>{tile.artist}</small>
            </span>
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
