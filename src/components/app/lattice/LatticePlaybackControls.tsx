import { motionValue } from 'framer-motion';
import { ArrowUpRight, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProgressBar from '../../ProgressBar';
import { PlayerState } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { useLatticeTransport } from './LatticeTransportContext';
import type { LatticeTile } from './latticeModel';
import LatticeChromeTime from './LatticeChromeTime';
import LatticeExtraControls from './LatticeExtraControls';
import './LatticeChrome.css';

// Adapts the shared Player Chrome transport and progress bar to one expanded wall tile.

type LatticePlaybackControlsProps = {
    revealed: boolean;
    tile: LatticeTile;
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
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
}: LatticePlaybackControlsProps) {
    const { t } = useTranslation();
    // Subscribed here rather than threaded through every poster: only this card reads transport state.
    const { currentSong, playerState, currentTime, playbackDuration, canTogglePlayback } = useLatticeTransport();
    const isCurrentSong = Boolean(
        currentSong && getPlaybackSongKey(currentSong) === getPlaybackSongKey(tile.song),
    );
    const canControlCurrent = isCurrentSong && canTogglePlayback;
    const isPlaying = canControlCurrent && playerState === PlayerState.PLAYING;
    const duration = canControlCurrent
        ? playbackDuration
        : Math.max(0, tile.song.durationMs / 1000);

    return (
        <div
            // 思索靠这个属性认出整条控制条。类名会随样式重构改名，属性不会 —— 见 ponderSelectorContract。
            data-ponder="lattice-chrome"
            className={`lattice-chrome ${revealed ? 'is-revealed' : ''}`}
            role="group"
            aria-label={t('home.latticePlaybackControls')}
        >
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
                    <LatticeExtraControls disabled={!canControlCurrent} queueIndex={tile.queueIndex} song={tile.song} />
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
