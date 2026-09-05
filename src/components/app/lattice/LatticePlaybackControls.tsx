import { motionValue, type MotionValue } from 'framer-motion';
import { ArrowUpRight, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProgressBar from '../../ProgressBar';
import { PlayerState, type SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import type { LatticeTile } from './latticeModel';
import LatticeChromeTime from './LatticeChromeTime';
import LatticeExtraControls from './LatticeExtraControls';
import './LatticeChrome.css';

// Adapts the shared Player Chrome transport and progress bar to one expanded wall tile.

type LatticePlaybackControlsProps = {
    revealed: boolean;
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
};

const idleTime = motionValue(0);
const ignoreSeek = () => { };

export default function LatticePlaybackControls({
    revealed,
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
        <div className={`lattice-chrome ${revealed ? 'is-revealed' : ''}`} role="group" aria-label={t('home.latticePlaybackControls')}>
            <div className="lattice-chrome-transport">
                <button
                    type="button"
                    className="lattice-transport-button"
                    onClick={() => canControlCurrent ? onTogglePlayback() : onPlay(tile)}
                    aria-label={isPlaying ? t('player.pause') : t('player.play')}
                    title={isPlaying ? t('player.pause') : t('player.play')}
                >
                    {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                </button>
                <div className="lattice-chrome-details" inert={!revealed} aria-hidden={!revealed}>
                    <LatticeExtraControls disabled={!canControlCurrent} />
                </div>
                <LatticeChromeTime currentTime={canControlCurrent ? currentTime : idleTime} duration={duration} />
                <button type="button" className="lattice-secondary-action" onClick={onOpenPlayer}
                    aria-label={t('home.latticeOpenPlayer')} title={t('home.latticeOpenPlayer')}>
                    <ArrowUpRight size={20} />
                </button>
            </div>
            <div className="lattice-progress">
                <ProgressBar
                    currentTime={canControlCurrent ? currentTime : idleTime}
                    duration={duration}
                    onSeek={canControlCurrent ? onSeek : ignoreSeek}
                    primaryColor="var(--lattice-chrome-ink)"
                    secondaryColor="var(--lattice-chrome-ink)"
                    trackColor="color-mix(in srgb, var(--lattice-chrome-ink) 20%, transparent)"
                    disabled={!canControlCurrent}
                    edgeStyle="square"
                />
            </div>
        </div>
    );
}
