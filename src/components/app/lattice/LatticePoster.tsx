import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { KeyboardEvent, MouseEvent, MutableRefObject } from 'react';
import { PlayerState, type SongResult } from '../../../types';
import type { ReflowTile } from './layout';
import type { LatticeTile } from './latticeModel';
import LatticePlaybackControls from './LatticePlaybackControls';

// Renders one poster and its expanded Player Chrome controls.

type LatticePosterProps = {
    instanceId: string;
    isFocused: boolean;
    tile: LatticeTile;
    rect: Omit<ReflowTile, 'instanceId'>;
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

const fallbackBackground = (id: string) => {
    const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    return `linear-gradient(145deg, hsl(${hue} 68% 58%), hsl(${(hue + 52) % 360} 62% 18%))`;
};

export default function LatticePoster({
    instanceId,
    isFocused,
    tile,
    rect,
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

    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof HTMLElement && event.target.closest('button')) return;
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }
        if (!expanded) onExpand();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if ((event.key === 'Enter' || event.key === ' ') && !expanded) {
            event.preventDefault();
            onExpand();
        }
    };

    return (
        <motion.article
            key={instanceId}
            className={`lattice-poster ${expanded ? 'is-expanded' : ''} ${isFocused ? 'is-focused' : ''}`}
            data-instance-id={instanceId}
            initial={false}
            animate={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 34 }}
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
                <motion.div
                    className="lattice-poster-controls"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reducedMotion ? 0 : 0.14, duration: reducedMotion ? 0 : 0.24 }}
                >
                    <LatticePlaybackControls
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
                        onClose={onClose}
                    />
                </motion.div>
            )}
        </motion.article>
    );
}
