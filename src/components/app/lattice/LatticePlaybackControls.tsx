import { motionValue, type MotionValue } from 'framer-motion';
import { Pause, Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProgressBar from '../../ProgressBar';
import { PlayerState, type SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import type { LatticeTile } from './latticeModel';

// Adapts the shared Player Chrome transport and progress bar to one expanded wall tile.

type LatticePlaybackControlsProps = {
    tile: LatticeTile;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onClose: () => void;
};

const idleTime = motionValue(0);
const ignoreSeek = () => { };

export default function LatticePlaybackControls({
    tile,
    currentSong,
    playerState,
    currentTime,
    playbackDuration,
    canTogglePlayback,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onClose,
}: LatticePlaybackControlsProps) {
    const { t } = useTranslation();
    const isCurrentSong = Boolean(
        currentSong && getPlaybackSongKey(currentSong) === getPlaybackSongKey(tile.song),
    );
    const canControlCurrent = isCurrentSong && canTogglePlayback;
    const isPlaying = canControlCurrent && playerState === PlayerState.PLAYING;
    const duration = canControlCurrent
        ? playbackDuration
        : Math.max(0, tile.song.durationMs / 1000);

    return (
        <div className="lattice-chrome">
            <button
                type="button"
                className="lattice-transport-button"
                onClick={() => canControlCurrent ? onTogglePlayback() : onPlay(tile)}
                aria-label={isPlaying ? t('player.pause') : t('player.play')}
            >
                {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
            <div className="lattice-progress">
                <ProgressBar
                    currentTime={canControlCurrent ? currentTime : idleTime}
                    duration={duration}
                    onSeek={canControlCurrent ? onSeek : ignoreSeek}
                    primaryColor="var(--text-primary)"
                    secondaryColor="var(--text-secondary)"
                    trackColor="color-mix(in srgb, var(--text-primary) 20%, transparent)"
                    disabled={!canControlCurrent}
                    edgeStyle="square"
                />
            </div>
            <button type="button" className="lattice-secondary-action" onClick={onOpenPlayer}>
                {t('home.latticeOpenPlayer')}
            </button>
            <button type="button" className="lattice-poster-close" onClick={onClose} aria-label={t('home.latticeClose')}>
                <X />
            </button>
        </div>
    );
}
