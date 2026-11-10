import { useMemo, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import Lattice from '../../src/components/app/lattice/Lattice';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import { PlayerState, type SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';

// dev/probes/latticeTitleExpansion.probe.tsx — real wall, long titles, expansion-time title fitting.
//
// The static title probe cannot show this: the poster's width is animated by the expansion spring,
// and the reported artifact only appears while the fitted string has not caught up with it.
const TITLES = ['束光似水 Light Shines Through Fingers as a Silver Stream',
    '壤土下的安居 Cozy Home Underground', '锤砧间的音符 Notes From Striking the Anvil'];
const noop = () => {};
function Probe() {
    const time = useMotionValue(0);
    const [songs] = useState(() => Array.from({ length: 40 }, (_, index) => ({
        id: `d-${index}`, name: TITLES[index % TITLES.length], artists: [{ id: 1, name: 'HOYO-MiX' }],
        album: { id: 1, name: 'Probe' }, durationMs: 180000,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: `d-${index}` },
    } satisfies SongResult)));
    const source = useMemo(() => ({ currentTime: time, currentLineIndex: -1, lines: [], theme: DEFAULT_THEME }), [time]);
    return <div style={{ height: '100vh' }}>
        <Lattice queue={songs} currentSong={null} playerState={PlayerState.PAUSED} currentTime={time} lyricCurrentTime={time}
            playbackDuration={180} canTogglePlayback={false} isDaylight={false} lyrics={null}
            lyricSource={source} lyricKeywordColoringEnabled={false}
            controls={{ loopMode: 'off', playback: { prev: noop, next: noop, toggleLoop: noop, shuffleQueue: noop,
                toggleSongLike: noop, isSongLiked: false, isFmMode: false }, invokeCommandById: noop, canInvokeCommandById: () => false }}
            onBack={noop} onOpenPlayer={noop} onPlaySong={noop} onTogglePlayback={noop} onSeek={noop} />
    </div>;
}
export default { id: 'latticeTitleExpansion', title: 'Lattice title on expansion',
    description: 'Real wall: when a long title reaches its fitted form as a poster expands.', Component: Probe } satisfies ProbeDefinition;
