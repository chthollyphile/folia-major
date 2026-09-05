import { useState } from 'react';
import { useMotionValue } from 'framer-motion';
import Lattice from '../../src/components/app/lattice/Lattice';
import { PlayerState, type SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';

// dev/probes/lattice.probe.tsx
// Real wall and playback controls with local, deterministic queue data.
const queue: SongResult[] = Array.from({ length: 12 }, (_, index) => ({
    id: String(index), name: `Poster ${index}`, artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' }, durationMs: 180000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(index) },
}));

function LatticeProbe() {
    const time = useMotionValue(42);
    const [songs, setSongs] = useState(queue);
    const [currentSong, setCurrentSong] = useState<SongResult | null>(queue[0]);
    const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>('all');
    const [command, setCommand] = useState('');
    const [toggles, setToggles] = useState(0);
    const [seek, setSeek] = useState(42);
    return <div style={{ height: '100vh' }} data-loop={loopMode} data-command={command} data-toggles={toggles} data-seek={seek}>
        <Lattice lyrics={null} controls={{ loopMode,
            playback: { prev: () => setCurrentSong(queue[Math.max(0, queue.indexOf(currentSong!) - 1)]),
                next: () => setCurrentSong(queue[(queue.indexOf(currentSong!) + 1) % queue.length]),
                toggleLoop: () => setLoopMode(value => value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'),
                shuffleQueue: () => setSongs(value => [...value].reverse()), toggleSongLike: () => {}, isSongLiked: false, isFmMode: false },
            invokeCommandById: setCommand, canInvokeCommandById: () => true,
        }} queue={songs} currentSong={currentSong} playerState={PlayerState.PLAYING}
            currentTime={time} playbackDuration={180} canTogglePlayback isDaylight={false}
            onBack={() => {}} onOpenPlayer={() => {}} onPlaySong={song => setCurrentSong(song)}
            onTogglePlayback={() => setToggles(value => value + 1)} onSeek={setSeek} />
        <div style={{ position: 'fixed', right: 0, top: 0, zIndex: 100 }}>
            <button onClick={() => setSongs(value => [...value].reverse())}>Reverse queue</button>
            <button onClick={() => setSongs(value => value.filter(song => song.id !== '3'))}>Remove poster 3</button>
            <button onClick={() => { setSongs([]); setCurrentSong(null); }}>Clear queue</button>
            <button onClick={() => setSongs(queue)}>Restore queue</button>
        </div>
    </div>;
}

export default {
    id: 'lattice', title: 'Lattice gestures',
    description: 'Pointer, wheel and keyboard interactions with expanded playback controls.',
    Component: LatticeProbe,
} satisfies ProbeDefinition;
