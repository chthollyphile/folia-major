import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motionValue } from 'framer-motion';
import { Crosshair, House } from 'lucide-react';
import type { ProbeDefinition } from './definition';
import { PlayerState, type SongResult } from '../../src/types';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { WallToolsSurface } from '../../src/components/wall/WallToolsButton';
import { WallToolsHostContext, type WallToolsHost } from '../../src/components/wall/wallToolsHost';
import LatticePlaybackProvider from '../../src/components/app/lattice/LatticePlaybackProvider';
import LatticePlaybackControls from '../../src/components/app/lattice/LatticePlaybackControls';
import LatticePoster from '../../src/components/app/lattice/LatticePoster';
import { LatticeTransportContext } from '../../src/components/app/lattice/LatticeTransportContext';
import type { LatticeTile } from '../../src/components/app/lattice/latticeModel';
import { queueUiRegistry } from '../../src/mods/folium/queueUi';
import type { QueueUiMountContext } from '../../src/mods/folium/queueUi';
import { buttonMount, componentWidth, textMount } from '../folium/sample-queue-ui/components.mjs';
import { createFoliumIcon } from '../../src/mods/folium/icons';
import '../../src/components/wall/wall.css';
import '../../src/components/app/lattice/Lattice.css';

// dev/probes/queueUiWall.probe.tsx
// Native wall queue island and Lattice controls with a duplicate-song queue, entirely offline.
const song = (id: string, name: string): SongResult => ({
    id, name, artists: [{ id: 1, name: 'Example artist' }], album: { id: 1, name: 'Example album' },
    durationMs: 180_000, sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
});
const repeated = song('shared', 'Repeated song');
const queue = [repeated, song('other', 'Other song'), repeated];
const timeline = motionValue(42);
const snapshot = { themeGeneration: 'ready' as const, canShuffleQueue: true };
const noOp = () => {};
const host: WallToolsHost = {
    getSnapshot: () => snapshot, subscribe: () => noOp,
    shuffleQueue: noOp, generateTheme: noOp, previewVolume: noOp, openPlayer: noOp,
    playQueueSong: currentSong => usePlaybackStore.getState().setCurrentSong(currentSong),
    playQueueSongNext: noOp, moveQueueSongToEnd: noOp, removeQueueSong: noOp,
    moveQueueSong: noOp, clearQueue: noOp, saveQueueAsPlaylist: async () => {},
};
const tile: LatticeTile = { id: 'shared', song: repeated, queueIndex: 2,
    title: 'Repeated song', artist: 'Example artist', section: 'now' };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

function QueueUiWallProbe() {
    const [nativeCalls, setNativeCalls] = useState(0);
    const [enabled, setEnabled] = useState(false);
    const [daylight, setDaylight] = useState(false);
    const [poster, setPoster] = useState(false);
    const didDragRef = useRef(false);
    const [calls, setCalls] = useState<string[]>([]);
    const [counts] = useState(() => [15, 15, 15]);
    useEffect(() => {
        if (!enabled) return undefined;
        const syncMount = buttonMount({ label: 'Fixture sync', icon: () => createFoliumIcon('refresh-cw'), run: () => setCalls(value => [...value, 'header:wall']) });
        const voteMount = buttonMount({ label: (ctx: QueueUiMountContext) => `Vote ${ctx.entry!.index}`, icon: () => createFoliumIcon('thumbs-up'),
            count: (ctx: QueueUiMountContext) => counts[ctx.entry!.index],
            run: (ctx: QueueUiMountContext) => { setCalls(value => [...value, `vote:${ctx.surface}:${ctx.entry!.index}`]); counts[ctx.entry!.index] += 1; notify(); } });
        const overlineMount = textMount((ctx: QueueUiMountContext) => `Recommender ${ctx.entry!.index}`);
        const handle = queueUiRegistry.register('probe-queue-ui-wall', {
            id: 'append',
            getHeaderContent: surface => [{ id: 'sync', width: componentWidth(surface, true), mount: syncMount }],
            getEntryContent: ({ surface }) => ({ overline: { id: 'recommender', mount: overlineMount },
                trailing: [{ id: 'vote', width: componentWidth(surface), mount: voteMount }] }),
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        });
        return () => handle.unregister();
    }, [counts, enabled]);
    useEffect(() => {
        usePlaybackStore.setState({ playQueue: queue, currentSong: repeated, activePlaybackContext: 'main', isFmMode: false });
    }, []);
    const callNative = () => setNativeCalls(value => value + 1);
    return <div className={`lattice-root lattice-queue-root h-screen w-screen ${daylight ? 'is-daylight' : ''}`} data-native-calls={nativeCalls} data-extension-calls={JSON.stringify(calls)} style={{
        background: daylight ? '#f4eef9' : '#151821', color: daylight ? '#1e1921' : '#f4edf7',
        '--bg-color': daylight ? '#f3ece7' : '#1b171f',
        '--text-primary': daylight ? '#1e1921' : '#f4edf7', '--text-accent': '#bc95ff',
    } as CSSProperties}>
        <button data-probe-enable onClick={() => setEnabled(value => !value)} style={{ position: 'absolute', top: 160, left: 40 }}>Toggle contribution</button>
        <button data-probe-daylight onClick={() => setDaylight(value => !value)} style={{ position: 'absolute', top: 160, left: 220 }}>Toggle daylight</button>
        <button data-probe-poster onClick={() => setPoster(value => !value)} style={{ position: 'absolute', top: 160, left: 400 }}>Full poster</button>
        <div data-probe-lattice style={{ position: 'absolute', top: poster ? 220 : 40, left: 40,
            width: poster ? 640 : 540, height: poster ? 640 : undefined }}>
            <LatticePlaybackProvider currentSong={repeated} queue={queue} lyrics={null} currentTime={timeline}
                duration={180} onSeek={noOp} isDaylight={daylight} actions={{ loopMode: 'all',
                    playback: { prev: callNative, next: callNative, toggleLoop: callNative, shuffleQueue: noOp,
                        toggleSongLike: callNative, isSongLiked: false, isFmMode: false },
                    invokeCommandById: noOp, canInvokeCommandById: () => true,
                }}>
                <LatticeTransportContext.Provider value={{ currentSong: repeated, playerState: PlayerState.PLAYING,
                    currentTime: timeline, playbackDuration: 180, canTogglePlayback: true }}>
                    {poster ? <LatticePoster instanceId="queue-ui-poster" isFocused tile={tile}
                        rect={{ x: 0, y: 0, width: 640, height: 640 }} gap={0} pixelScale={1} expandedSize={640}
                        entranceDelay={null} getExitDelay={() => 0} handoff={null} expanded reducedMotion
                        didDragRef={didDragRef} onExpand={noOp} onPlay={noOp} onTogglePlayback={callNative}
                        onSeek={noOp} onOpenPlayer={noOp} />
                        : <LatticePlaybackControls revealed tile={tile} onPlay={noOp} onTogglePlayback={callNative}
                            onSeek={noOp} onOpenPlayer={noOp} />}
                </LatticeTransportContext.Provider>
            </LatticePlaybackProvider>
        </div>
        <WallToolsHostContext.Provider value={host}>
            <WallToolsSurface idPrefix="queue-ui-wall-tools" label="Wall tools" isDaylight={daylight}
                locate={{ id: 'locate-playing', icon: Crosshair, label: 'Locate playing', onSelect: callNative }}
                destination={{ id: 'go-home', icon: House, label: 'Home', onSelect: callNative }}
                entries={[]} help={null} />
        </WallToolsHostContext.Provider>
    </div>;
}

export default {
    id: 'queueUiWall', title: 'Experimental queue UI: shared wall',
    description: 'Append-only actions and overlines without changing native wall controls or queue identity.',
    Component: QueueUiWallProbe,
} satisfies ProbeDefinition;
