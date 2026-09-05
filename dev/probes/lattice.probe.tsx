import { useState } from 'react';
import { useMotionValue } from 'framer-motion';
import Lattice from '../../src/components/app/lattice/Lattice';
import { PlayerState, type SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import { useLatticeControlsStore } from '../../src/stores/useLatticeControlsStore';
import AppOverlays from '../../src/components/app/overlays/AppOverlays';

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
    const [backs, setBacks] = useState(0);
    const [seek, setSeek] = useState(42);
    const isCurrentSongPosterVisible = useLatticeControlsStore(state => state.isCurrentSongPosterVisible);
    return <div style={{ height: '100vh' }} data-loop={loopMode} data-command={command} data-toggles={toggles} data-backs={backs} data-seek={seek}
        data-current-song-poster-visible={isCurrentSongPosterVisible}>
        <Lattice lyrics={null} controls={{ loopMode,
            playback: { prev: () => setCurrentSong(queue[Math.max(0, queue.indexOf(currentSong!) - 1)]),
                next: () => setCurrentSong(queue[(queue.indexOf(currentSong!) + 1) % queue.length]),
                toggleLoop: () => setLoopMode(value => value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'),
                shuffleQueue: () => setSongs(value => [...value].reverse()), toggleSongLike: () => {}, isSongLiked: false, isFmMode: false },
            invokeCommandById: setCommand, canInvokeCommandById: () => true,
        }} queue={songs} currentSong={currentSong} playerState={PlayerState.PLAYING}
            lyricSource={{ currentTime: time, currentLineIndex: -1, lines: [], theme: DEFAULT_THEME }} lyricKeywordColoringEnabled
            currentTime={time} playbackDuration={180} canTogglePlayback isDaylight={false}
            onBack={() => setBacks(value => value + 1)} onOpenPlayer={() => {}} onPlaySong={song => setCurrentSong(song)}
            onTogglePlayback={() => setToggles(value => value + 1)} onSeek={setSeek} />
        <AppOverlays model={{
            floatingControls: currentSong ? {
                currentSong,
                playerState: PlayerState.PLAYING,
                currentTime: time,
                duration: 180,
                loopMode,
                currentView: 'lattice',
                audioSrc: 'probe://audio',
                canTogglePlay: true,
                lyrics: null,
                onSeek: setSeek,
                onTogglePlay: () => setToggles(value => value + 1),
                onToggleLoop: () => setLoopMode(value => value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'),
                onNavigateToPlayer: () => {},
                isDaylight: false,
                slotPrimary: 'loop',
                slotSecondary: 'lyrics-timeline',
                slotContext: {
                    onShuffle: () => {}, canShuffle: true,
                    onLike: () => {}, isLiked: false, likeDisabled: false,
                    invokeCommandById: setCommand, canInvokeCommandById: () => true,
                },
                onCommitBottomBarOffset: () => {},
            } : null,
        }} />
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
