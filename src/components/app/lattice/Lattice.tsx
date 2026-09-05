import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import { PlayerState, type SongResult, type LyricData } from '../../../types';
import LatticePlaybackProvider, { type LatticePlaybackActions } from './LatticePlaybackProvider';
import PosterWall from './PosterWall';
import LatticeFocusButton from './LatticeFocusButton';
import { buildLatticeTiles, type LatticeTile } from './latticeModel';
import { useStableCallbacks } from '../../../hooks/useStableCallbacks';
import { countRender } from '../../../dev/renderCount';
import './Lattice.css';

// Queue display layer; it renders the play queue and never mutates it.

type LatticeProps = {
    controls: LatticePlaybackActions;
    lyrics: LyricData | null;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    queue: SongResult[];
    isDaylight: boolean;
    onBack: () => void;
    onOpenPlayer: () => void;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
};

export default function Lattice({
    controls,
    lyrics,
    currentSong,
    playerState,
    currentTime,
    playbackDuration,
    canTogglePlayback,
    queue,
    isDaylight,
    onBack,
    onOpenPlayer,
    onPlaySong,
    onTogglePlayback,
    onSeek,
}: LatticeProps) {
    countRender('Lattice');
    const { t } = useTranslation();
    const tiles = useMemo(() => buildLatticeTiles({ queue, currentSong }), [currentSong, queue]);
    // App rebuilds these on every render of its own, and the wall hands them to every poster on
    // screen. Given a permanent identity here they stop being a reason for those posters to render.
    const wall = useStableCallbacks({
        onPlay: (tile: LatticeTile) => onPlaySong(tile.song, queue),
        onTogglePlayback,
        onSeek,
        onOpenPlayer,
    });

    return (
        <LatticePlaybackProvider actions={controls} currentSong={currentSong} queue={queue} lyrics={lyrics}
            currentTime={currentTime} duration={playbackDuration} onSeek={onSeek} isDaylight={isDaylight}>
        <section className={`lattice-root ${isDaylight ? 'is-daylight' : ''}`} aria-label={t('home.latticeLabel')}>
            <PosterWall
                tiles={tiles}
                currentSong={currentSong}
                playerState={playerState}
                currentTime={currentTime}
                playbackDuration={playbackDuration}
                canTogglePlayback={canTogglePlayback}
                onPlay={wall.onPlay}
                onTogglePlayback={wall.onTogglePlayback}
                onSeek={wall.onSeek}
                onOpenPlayer={wall.onOpenPlayer}
            />
            <LatticeFocusButton />
            <header className="lattice-header">
                <button type="button" className="lattice-back" onClick={onBack} aria-label={t('home.latticeBack')}>
                    <ArrowLeft />
                </button>
                <div className="lattice-brand">
                    <strong>FOLIA / WALL</strong>
                    <span>{t('home.latticeSubtitle')}</span>
                </div>
            </header>
            {tiles.length === 0 && (
                <div className="lattice-empty">
                    <strong>{t('home.latticeEmptyTitle')}</strong>
                    <span>{t('home.latticeEmptyText')}</span>
                </div>
            )}
        </section>
        </LatticePlaybackProvider>
    );
}
