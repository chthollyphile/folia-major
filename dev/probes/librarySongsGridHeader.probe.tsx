import { useLayoutEffect, useMemo, useState } from 'react';
import GridView from '../../src/library/suites/grid/collection/GridView';
import { createCollectionResourceState } from '../../src/library/core/collection/resource/collectionResourceState.service';
import { useAppViewStore } from '../../src/stores/useAppViewStore';
import type { CollectionResource } from '../../src/library/core/shared/resource.contract';
import type { SongResult, Theme } from '../../src/types';
import type { ProbeDefinition } from './definition';

// Real GridView header hit-testing after a failed refresh retains the previous complete library.

const THEME: Theme = {
    name: 'Header probe', backgroundColor: '#18181b', primaryColor: '#4f8cf7',
    secondaryColor: '#4f8cf7', accentColor: '#4f8cf7', fontStyle: 'sans', animationIntensity: 'calm',
};
const TRACKS: SongResult[] = Array.from({ length: 666 }, (_, index) => ({
    id: `header-${index}`, name: `Track ${index}`, artists: [], album: { id: 1, name: 'Album' }, durationMs: 180_000,
}));
const UNSUPPORTED_TRACK: SongResult = {
    id: 'i.uploaded', name: 'Uploaded library song', artists: [], album: { id: 'upload', name: 'Uploads' }, durationMs: 180_000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'i.uploaded', providerData: { resourceType: 'library-songs', playbackAvailable: false } },
};
type Stage = 'refreshFailed' | 'loading' | 'complete' | 'playlist' | 'unsupported';
const STAGES: Stage[] = ['refreshFailed', 'loading', 'complete', 'playlist', 'unsupported'];

const LibrarySongsGridHeaderProbe = () => {
    const [stage, setStage] = useState<Stage>('refreshFailed');
    const [retries, setRetries] = useState(0);
    const [backs, setBacks] = useState(0);
    const [collected, setCollected] = useState(0);
    const [state] = useState(() => createCollectionResourceState('probe:library-header', 'online', { tracks: TRACKS }));
    const resource = useMemo<CollectionResource>(() => ({
        key: 'probe:library-header', kind: 'online', getSnapshot: state.get, subscribe: state.subscribe,
        ensure: () => {}, reload: () => {}, resumeSync: () => setRetries(count => count + 1),
        canReuse: () => false, pause: () => {}, dispose: state.clear,
        removeTracks: async () => {}, removeAt: () => false, replaceTrackAt: () => false, replaceAll: async () => false,
    }), [state]);
    useLayoutEffect(() => {
        state.set({
            tracks: stage === 'unsupported' ? [UNSUPPORTED_TRACK] : TRACKS,
            status: stage === 'refreshFailed' ? 'error' : 'ready',
            sync: stage === 'refreshFailed'
                ? { status: 'interrupted', offset: 200, message: 'Probe page failed' }
                : stage === 'loading' ? { status: 'syncing' } : { status: 'none' },
            librarySongs: stage === 'playlist' ? undefined : {
                complete: stage === 'complete' || stage === 'unsupported',
                loadedCount: stage === 'unsupported' ? 1 : stage === 'complete' ? 666 : 200, refreshing: stage === 'refreshFailed',
            },
        }, 'urgent');
    }, [stage, state]);
    const collection = useMemo(() => ({
        source: 'online', providerId: 'appleMusic', id: 'library-header',
        name: stage === 'playlist' ? 'Ordinary playlist' : 'All songs',
        type: stage === 'playlist' ? 'playlist' : 'library_songs',
    }), [stage]);
    return (
        <div data-probe-retries={retries} data-probe-backs={backs} data-probe-collected={collected} data-probe-header-stage={stage}>
            <GridView title={collection.name} subtitle="Songs in your music library" mode="tracks"
                collection={collection} resource={resource} theme={THEME} isDaylight={false} isInteractive
                onBack={() => {}} onDone={() => setBacks(count => count + 1)}
                onSelectTrack={() => {}} onPlayAll={() => {}} onAddAllToQueue={() => {}} onAddTrackToQueue={() => {}}
                collectTrack={tracks => setCollected(count => count + tracks.length)} saveToPlaylist={() => {}} canSaveToPlaylist={() => true}
                collectScope={tracks => setCollected(count => count + tracks.length)} />
            <div className="fixed bottom-2 left-2 z-[200] flex flex-wrap gap-1">
                <input aria-label="Probe filter" className="w-24 bg-zinc-800 text-white"
                    onChange={event => useAppViewStore.getState().commandFilter?.setQuery(event.target.value)} />
                {STAGES.map(value => (
                    <button type="button" key={value} data-probe-stage={value}
                        className="rounded bg-zinc-800 px-2 py-1 text-xs text-white" onClick={() => setStage(value)}>
                        {value}
                    </button>
                ))}
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'librarySongsGridHeader', title: 'Grid library header: status and retry hit-testing',
    description: 'Real GridView with 666 retained tracks and a failed refresh after 200 loaded rows; narrow headers must leave title, back and retry accessible.',
    Component: LibrarySongsGridHeaderProbe,
};
export default definition;
