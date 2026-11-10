import React from 'react';
import GridView from '../../src/library/suites/grid/collection/GridView';
import { collectionKey, type GridViewCollectionDescriptor } from '../../src/components/app/home/gridViewCollectionAdapters';
import { locatePlayingSong } from '../../src/components/app/playing-song-locator/playingSongLocator';
import { registerOnlineMusicProvider } from '../../src/services/onlineMusic/providerRegistry';
import { getActiveGridViewCollection, useCollectionNavigationStore } from '../../src/stores/useCollectionNavigationStore';
import { useAppViewStore } from '../../src/stores/useAppViewStore';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../src/stores/usePlayingSongLocatorStore';
import { useStatusMessageStore } from '../../src/stores/useStatusMessageStore';
import type { SongResult, UnifiedSong } from '../../src/types';
import type { OnlineMusicProvider } from '../../src/types/onlineMusic';
import { getPlaybackSongKey } from '../../src/utils/appPlaybackGuards';
import type { CollectionResource } from '../../src/library/core/shared/resource.contract';
import { createCollectionResourceState } from '../../src/library/core/collection/resource/collectionResourceState.service';
import { useCollectionResource } from '../../src/library/core/collection/resource/useCollectionResource';
import type { ProbeDefinition } from './definition';
// dev/probes/collectionGrid.probe.tsx

/**
 * 歌单页（真实的 GridView）的三件事。
 *
 * 一，歌曲分批到达。在线歌单是一页一页读的：先显示第一页，其余的在后台补上，YouTube Music
 * 一页只有 15 或 100 首，一张大歌单要补很多次。这里的歌由探针给（探针自己的集合资源），按一次
 * 按钮多给一页，和后台补齐对网格来说是一回事：卡片数变多，已有的卡片位置不变。“还在到达”
 * 打开时，网格把自己当作还没读完；“读取失败”打开时，给它的歌算作没读全，也不会再来。
 *
 * 二，“定位正在播放的歌”。探针把这一页登记成正在看的那一页，按钮让某一首成为正在播放的歌；
 * 页面右下角的定位按钮（列表面板里还有一个）只在这一页已有的卡片里找，按下就回答，不等，也不去别的歌单；
 * 状态栏的话、还没人回答的提问都能在这里看到。“3000 首”用来量大歌单上按下到卡片居中的时间。
 *
 * 三，第二张歌单“Loaded Playlist”：它的歌不由探针给，由在线集合资源（宿主给歌单页的那一种）向一个假平台一页
 * 一页读（和读 YouTube Music、网易云的歌单是同一段代码）。每一次读取都被探针扣着，按“放行”
 * 才答（开发环境下页面的读取会启动两次，所以同一页可能被读两次，一起放行）。
 * “从 Loaded Playlist 播放”让队列算作从那张歌单开始；“回到开始播放的歌单”是播放器封面上那个按钮做的事
 * （`locatePlayingSong`）：换到 Loaded Playlist 去找，歌还没读到之前页面不该说“没有”。
 */

const PLAYLIST = {
    source: 'online',
    providerId: 'netease',
    id: 'paged-playlist',
    name: 'Paged Playlist',
    type: 'playlist',
} as GridViewCollectionDescriptor;

const COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2f9e44"/></svg>')}`;

const makeTrack = (index: number) => ({
    id: 2_000_000 + index,
    // At least three digits, so that no title of the first thousand is the start of another.
    name: `Track ${String(index).padStart(3, '0')}`,
    artists: [{ id: 7, name: 'Probe Artist' }],
    album: { id: 9, name: 'Probe Album' },
    duration: 180000,
    coverUrl: COVER,
}) as unknown as SongResult;

// The second collection: 70 tracks (the same songs as the first 70 of the page above), read by
// the page's own loader, 15 to a page, each page answered only when the probe lets it go.
const LOADED_PROVIDER = 'probe-paged';
const LOADED_TOTAL = 70;
const LOADED = {
    source: 'online',
    providerId: LOADED_PROVIDER,
    // A fresh id for every visit of the probe: the loader keeps what it has read in the browser.
    id: `loaded-${Date.now()}`,
    name: 'Loaded Playlist',
    type: 'playlist',
} as GridViewCollectionDescriptor;
const heldReads = new Set<() => void>();
// How far into the collection the answered reads have reached.
let readUpTo = 0;
// Once on, every read that is let go is refused.
let refusesReads = false;
const heldListeners = new Set<() => void>();
const noteHeld = () => heldListeners.forEach(listener => listener());
const loadedProvider: OnlineMusicProvider = {
    id: LOADED_PROVIDER, displayName: 'Paged probe',
    capabilities: {
        search: false, playback: false, lyrics: false, auth: false, userLibrary: false, playlists: true, albums: false,
        artists: false, recommendations: false, mutations: false, wordByWordLyrics: false, explore: false,
    },
    normalizeSong: raw => raw as UnifiedSong,
    catalog: {
        async getPlaylistTracks(_id, limit, offset) {
            await new Promise<void>(resolve => {
                const release = () => { heldReads.delete(release); noteHeld(); resolve(); };
                heldReads.add(release);
                noteHeld();
            });
            if (refusesReads) throw new Error('The probe refuses this read');
            const size = Math.max(0, Math.min(PAGE, limit, LOADED_TOTAL - offset));
            readUpTo = Math.max(readUpTo, offset + size);
            const items = Array.from({ length: size }, (_, index) => makeTrack(offset + index) as UnifiedSong);
            return { items, total: LOADED_TOTAL, nextOffset: offset + size, hasMore: offset + size < LOADED_TOTAL };
        },
    },
};
registerOnlineMusicProvider(loadedProvider);

const THEME = { primaryColor: '#4f8cf7', secondaryColor: '#4f8cf7', accentColor: '#4f8cf7' } as never;
const FIRST_PAGE = 40;
const PAGE = 15;
// A long list, to time a press on: the song looked for is its last but one.
const MANY = 3000;
// Two of the first page, one that only a later page brings, one that is in no page, and one near the end of the long list.
const PLAYABLE = [30, 35, 60, 900, MANY - 2];
// Played as if from "Loaded Playlist": one that its last page brings, and one it does not hold.
const PLAYABLE_FROM_LOADED = [65, 900];

/**
 * The tracks the probe gives the first page, as a collection's resource holds them: `arriving`,
 * more are still to come (the background fill); `failed`, the read did not bring them all and
 * no more will come (a Navidrome read that failed).
 */
const createGivenResource = (): CollectionResource & { give: (tracks: SongResult[], arriving: boolean, failed: boolean) => void } => {
    const state = createCollectionResourceState('probe:given', 'navidrome', { status: 'ready' });
    return {
        key: 'probe:given',
        kind: 'navidrome',
        getSnapshot: state.get,
        subscribe: state.subscribe,
        ensure: () => {},
        reload: () => {},
        resumeSync: () => {},
        canReuse: () => false,
        pause: () => {},
        dispose: state.clear,
        removeTracks: async () => {},
        removeAt: () => false,
        replaceTrackAt: () => false,
        replaceAll: async () => false,
        give: (tracks, arriving, failed) => state.set({
            status: failed ? 'error' : 'ready',
            tracks,
            error: failed ? { kind: 'generic', message: '' } : null,
            sync: arriving ? { status: 'syncing' } : { status: 'none' },
        }, 'background'),
    };
};

const CollectionGridProbe: React.FC = () => {
    const [count, setCount] = React.useState(FIRST_PAGE);
    const [isArriving, setIsArriving] = React.useState(false);
    // 给这一页的歌没读全（Navidrome 的页面就是这样拿歌的：读取失败时，给它的可能只是一部分，或一首都没有）。
    const [hasGivenFailed, setHasGivenFailed] = React.useState(false);
    // 每按一次“歌单变了”加一：Loaded Playlist 的歌曲数变了，页面会自己把它重读一遍。
    const [loadedChanges, setLoadedChanges] = React.useState(0);
    const loaded = React.useMemo(() => (loadedChanges === 0 ? LOADED : { ...LOADED, trackCount: LOADED_TOTAL + loadedChanges }), [loadedChanges]);
    const tracks = React.useMemo(() => Array.from({ length: count }, (_, index) => makeTrack(index)), [count]);
    const [given] = React.useState(createGivenResource);
    React.useLayoutEffect(() => given.give(tracks, isArriving, hasGivenFailed), [given, hasGivenFailed, isArriving, tracks]);
    // The second page reads its tracks as the host has them read: through an online collection's resource.
    const status = useStatusMessageStore(state => state.message);
    const request = usePlayingSongLocatorStore(state => state.request);
    const open = useCollectionNavigationStore(state => getActiveGridViewCollection(state.snapshot));
    const isLoadedOpen = open !== null && collectionKey(open) === collectionKey(LOADED);
    // The second page reads its tracks as the host has them read: through an online collection's
    // resource, asked for while that page is open.
    const loadedResource = useCollectionResource({ descriptor: isLoadedOpen ? loaded as never : null });
    const held = React.useSyncExternalStore(
        listener => { heldListeners.add(listener); return () => heldListeners.delete(listener); },
        () => heldReads.size,
    );
    // Every status line shown since the probe opened: one that came and went is still seen here.
    const [said, setSaid] = React.useState<string[]>([]);
    React.useEffect(() => useStatusMessageStore.subscribe(state => {
        const text = state.message?.text;
        if (text) setSaid(current => [...current, text]);
    }), []);
    const buttonClass = 'rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10';

    // This page is the one on screen, and nothing plays yet.
    React.useEffect(() => {
        useCollectionNavigationStore.getState().openRoot(PLAYLIST, 'home');
        usePlaybackStore.setState({ currentSong: null, playQueue: [] });
        usePlayingSongLocatorStore.getState().setRequest(null);
        useStatusMessageStore.getState().setMessage(null);
        // The app's navigation, as far as this probe has screens: a collection page over another.
        const pushCollection = (collection: GridViewCollectionDescriptor) => { useCollectionNavigationStore.getState().push(collection); };
        usePlayingSongLocatorStore.getState().setNavigator({ navigateToHome: () => {}, navigateToCollection: pushCollection, pushCollection });
        return () => {
            useCollectionNavigationStore.getState().clear();
            usePlayingSongLocatorStore.getState().setNavigator(null);
        };
    }, []);

    return (
        <div
            className="min-h-screen bg-zinc-900 text-zinc-200"
            data-probe-tracks={count}
            data-probe-status={status?.text ?? ''}
            data-probe-said={said.join(' | ')}
            data-probe-request={request ? 'asked' : 'none'}
            data-probe-open={isLoadedOpen ? 'loaded' : 'given'}
            data-probe-held={held}
            data-probe-read={readUpTo}
        >
            {/* 工具条必须在网格之上：GridView 是 fixed inset-0 z-[110]。 */}
            <div className="flex flex-wrap items-center gap-2 p-4" style={{ position: 'relative', zIndex: 200 }}>
                <button type="button" data-probe-add-page className={buttonClass} onClick={() => setCount(current => current + PAGE)}>
                    再到一页（{PAGE} 首）
                </button>
                <button type="button" data-probe-arriving={isArriving ? 'on' : 'off'} className={buttonClass} onClick={() => setIsArriving(current => !current)}>
                    还在到达：{isArriving ? '是' : '否'}
                </button>
                <button type="button" data-probe-given-failed={hasGivenFailed ? 'on' : 'off'} className={buttonClass} onClick={() => setHasGivenFailed(current => !current)}>
                    读取失败：{hasGivenFailed ? '是' : '否'}
                </button>
                {PLAYABLE.map(index => (
                    <button key={index} type="button" data-probe-play={index} className={buttonClass} onClick={() => usePlaybackStore.setState({ currentSong: makeTrack(index), playQueue: [makeTrack(index)] })}>
                        播放第 {index} 首
                    </button>
                ))}
                {/* 问的是另一张歌单的页面：这一页不该动，也不该替它回答。 */}
                <button
                    type="button"
                    data-probe-ask-another
                    className={buttonClass}
                    onClick={() => usePlayingSongLocatorStore.getState().setRequest({ nonce: -1, collectionKey: 'online:playlist:another', songKey: getPlaybackSongKey(makeTrack(5)), waits: true })}
                >
                    问另一页
                </button>
                {PLAYABLE_FROM_LOADED.map(index => (
                    <button
                        key={index}
                        type="button"
                        data-probe-play-from-loaded={index}
                        className={buttonClass}
                        onClick={() => {
                            usePlayingSongLocatorStore.getState().setSource({ collection: LOADED, songKeys: new Set([getPlaybackSongKey(makeTrack(index))]) });
                            usePlaybackStore.setState({ currentSong: makeTrack(index), playQueue: [makeTrack(index)] });
                        }}
                    >
                        从 Loaded Playlist 播放第 {index} 首
                    </button>
                ))}
                {/* 播放器封面上的“来自某歌单”按钮做的事：回到队列开始的那张歌单。 */}
                <button type="button" data-probe-go-to-source className={buttonClass} onClick={locatePlayingSong}>
                    回到开始播放的歌单
                </button>
                {/* 筛选框归命令面板管，这里没有面板：直接把筛选词交给页面登记的那个入口。 */}
                <button type="button" data-probe-filter className={buttonClass} onClick={() => useAppViewStore.getState().commandFilter?.setQuery('Track 03')}>
                    筛选“Track 03”
                </button>
                <button type="button" data-probe-many className={buttonClass} onClick={() => setCount(MANY)}>
                    {MANY} 首
                </button>
                <button type="button" data-probe-release className={buttonClass} disabled={held === 0} onClick={() => [...heldReads].forEach(letGo => letGo())}>
                    放行（扣着 {held} 次读取）
                </button>
                {/* 之后放行的读取都失败：补齐重试几次后放弃，歌单停在没读完的地方。 */}
                <button type="button" data-probe-refuse-reads className={buttonClass} onClick={() => { refusesReads = true; }}>
                    之后的读取都失败
                </button>
                <button type="button" data-probe-change-loaded className={buttonClass} onClick={() => setLoadedChanges(count => count + 1)}>
                    Loaded Playlist 变了
                </button>
                <span className="text-xs opacity-60">现在 {count} 首 · 正在看 {isLoadedOpen ? 'Loaded Playlist' : 'Paged Playlist'}</span>
            </div>
            {isLoadedOpen ? (
                <GridView
                    key="loaded"
                    title="Loaded Playlist"
                    mode="tracks"
                    collection={loaded as never}
                    resource={loadedResource}
                    theme={THEME}
                    isDaylight={false}
                    isInteractive
                    onBack={() => {}}
                    onDone={() => {}}
                />
            ) : (
                <GridView
                    key="given"
                    title="Paged Playlist"
                    mode="tracks"
                    collection={PLAYLIST as never}
                    resource={given}
                    theme={THEME}
                    isDaylight={false}
                    isInteractive
                    onBack={() => {}}
                    onDone={() => {}}
                />
            )}
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'collectionGrid',
    title: '歌单页：歌曲分批到达，定位正在播放的歌',
    description: '真实的 GridView，歌由探针一页一页给。验证：滚到别处后再到一页不会把视图拉回原来那张卡片；页面自己的定位按钮只在这一页找，按下就回答（居中、没有、或没读完）；“回到开始播放的歌单”换到队列开始的那一张，歌读到之前不说“没有”。',
    Component: CollectionGridProbe,
};

export default definition;
