import { useMemo } from 'react';
import { useMotionValue } from 'framer-motion';
import Lattice from '../../../src/components/app/lattice/Lattice';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { PlayerState, type SongResult } from '../../../src/types';

// dev/probes/lattice-performance/Wall.tsx — real virtualized wall, deterministic long titles, no network audio.
const TITLES = ['Piano Sonata, Op. 27 No. 2, in C♯ minor, “Moonlight”',
    '壤土下的安居 Cozy Home Underground', '锤砧间的音符 Notes From Striking the Anvil',
    '新月的摇篮曲（其三）：眉间落英 Lullaby of the New Moon'];
const noop = () => {};
export function Wall({ count }: { count: number }) {
    const time = useMotionValue(0);
    const queue = useMemo<SongResult[]>(() => Array.from({ length: count }, (_, index) => ({
        id: `perf-${index}`, name: `${TITLES[index % TITLES.length]} · ${index}`, artists: [{ id: 1, name: 'HOYO-MiX' }],
        album: { id: 1, name: 'Probe' }, durationMs: 180000,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: `perf-${index}` },
    })), [count]);
    return <Lattice queue={queue} currentSong={null} playerState={PlayerState.PAUSED} currentTime={time} lyricCurrentTime={time}
        playbackDuration={180} canTogglePlayback={false} isDaylight={false} lyrics={null}
        lyricSource={{ currentTime: time, currentLineIndex: -1, lines: [], theme: DEFAULT_THEME }} lyricKeywordColoringEnabled={false}
        controls={{ loopMode: 'off', playback: { prev: noop, next: noop, toggleLoop: noop, shuffleQueue: noop,
            toggleSongLike: noop, isSongLiked: false, isFmMode: false }, invokeCommandById: noop, canInvokeCommandById: () => false }}
        onBack={noop} onOpenPlayer={noop} onPlaySong={noop} onTogglePlayback={noop} onSeek={noop} />;
}
