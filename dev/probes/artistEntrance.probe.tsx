import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ArtistGridView from '../../src/library/suites/grid/artist/ArtistGridView';
import { CollectionMorphOverlay } from '../../src/library/suites/grid/transitions/CollectionMorphOverlay';
import { planForOpening, useCollectionMorphStore, useMorphPageExit, useMorphPlanFor } from '../../src/library/suites/grid/transitions/collectionMorphStore';
import { cardOf, probeCentredCard } from '../../src/library/suites/grid/transitions/morphProbes';
import ActiveGridMarker from '../../src/library/suites/grid/shared/ActiveGridMarker';
import { CARD_TITLE_ATTR, MORPH_SOURCE_ATTR, MORPH_TARGET_ATTR } from '../../src/library/suites/grid/transitions/gridMorphContract';
import { registerOnlineMusicProvider } from '../../src/services/onlineMusic/providerRegistry';
import { useCollectionNavigationStore } from '../../src/stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '../../src/components/app/home/gridViewCollectionAdapters';
import type { OnlineMusicProvider } from '../../src/types/onlineMusic';
import { useArtistResource } from '../../src/library/core/artist/useArtistResource';
import { collectionKey } from '../../src/library/core/collection/collectionIdentity';
import type { LibraryPlaybackPort } from '../../src/library/core/shared/ports.contract';
import type { LibraryDeclaredActions } from '../../src/library/core/suite/suite.contract';
import type { ProbeDefinition } from './definition';
// dev/probes/artistEntrance.probe.tsx

/**
 * 真的歌手页（ArtistGridView）加真的转场 overlay，平台是假的：歌手资料、热门歌曲、专辑各隔一段
 * 时间才答（地址上的 `detail`、`songs`、`albums`，毫秒）。图片地址在 `/__probe_img__/` 下，
 * 由测试脚本拦下来、隔一段时间再给，用来看图片晚到时的样子。
 * 两条进入的路：点圆头像卡片（探索页那样，卡片飞到头像上），或点“按名字打开”（没有卡片可飞）。
 * 在歌手页点开一张专辑，到的是一张只有替身卡的假专辑页；它的“返回”做的事和宿主一样（先量中间
 * 那张卡、备好飞回去的那一程，再改导航），用来看回到歌手页时的样子。
 */
const PROVIDER_ID = 'artist-probe';
const query = new URLSearchParams(window.location.search);
const msOf = (name: string, fallback: number) => Number(query.get(name) ?? fallback);
const DETAIL_MS = msOf('detail', 400);
const SONGS_MS = msOf('songs', 400);
const ALBUMS_MS = msOf('albums', 300);
const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
// How many times each read was asked for.
const reads = { detail: 0, songs: 0, albums: 0 };
(window as unknown as { __artistReads: typeof reads }).__artistReads = reads;
const picture = (name: string) => `${window.location.origin}/__probe_img__/${name}.svg`;

const provider = {
    id: PROVIDER_ID, displayName: 'Artist probe',
    capabilities: {
        search: false, playback: false, lyrics: false, auth: false, userLibrary: false, playlists: false, albums: true,
        artists: true, recommendations: false, mutations: false, wordByWordLyrics: false,
    },
    normalizeSong: (raw: unknown) => raw,
    catalog: {
        async getArtistDetail(id: string) {
            reads.detail += 1;
            await wait(DETAIL_MS);
            return {
                providerId: PROVIDER_ID, id, type: 'artist', name: 'Probe Artist', coverUrl: picture('avatar'),
                description: 'An artist read from a platform that takes its time. '.repeat(6), trackCount: 120, albumCount: 30,
            };
        },
        async getArtistSongs() {
            reads.songs += 1;
            await wait(SONGS_MS);
            return {
                items: Array.from({ length: 10 }, (_, index) => ({
                    id: `song-${index}`, name: `Song ${index}`, durationMs: 200000,
                    artists: [{ id: 'probe-artist', name: 'Probe Artist' }],
                    album: { id: `album-${index}`, name: `Album ${index}`, coverUrl: picture(`song-${index}`) },
                    sourceRef: { kind: 'online', providerId: PROVIDER_ID, mediaId: `song-${index}` },
                })),
                hasMore: false, offset: 0, total: 10,
            };
        },
        async getArtistAlbums(_id: string, _limit: number, offset: number) {
            reads.albums += 1;
            await wait(ALBUMS_MS);
            return {
                items: offset > 0 ? [] : Array.from({ length: 30 }, (_, index) => ({
                    providerId: PROVIDER_ID, id: `album-${index}`, type: 'album', name: `Album ${index}`,
                    coverUrl: picture(`album-${index}`), publishedAt: Date.UTC(2010 + (index % 12), 0, 1),
                })),
                hasMore: false, offset, total: 30,
            };
        },
    },
} as unknown as OnlineMusicProvider;
registerOnlineMusicProvider(provider);

const ARTIST = {
    source: 'online', providerId: PROVIDER_ID, type: 'artist', id: 'probe-artist', name: 'Probe Artist',
} as unknown as GridViewCollectionDescriptor;
const THEME = { primaryColor: '#4f8cf7', secondaryColor: '#4f8cf7', accentColor: '#4f8cf7' } as never;
// Nothing is played here; the page's entries are what the grid declares for an artist's page.
const NO_PLAYBACK: LibraryPlaybackPort = { playTrack: () => {}, playAll: () => {}, enqueueTrack: () => {}, enqueueAll: () => {} };
const DECLARED: LibraryDeclaredActions = { actions: ['play', 'enqueue', 'open-album', 'open-artist'], extraActions: [] };
// The artist is an online one: the local library it is not read off is empty, and read.
const NO_LOCAL_LIBRARY = { catalog: { ready: true, entities: [], assignments: [] }, songs: [] };

/** An album's page, as far as coming back from it needs: a stand-in the album's cover lands on. */
const AlbumPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const plan = useCollectionMorphStore(state => state.plan);
    const pageExit = useMorphPageExit();
    const [cover] = React.useState(() => (plan?.kind === 'morph' ? plan.coverUrl ?? null : null));
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={pageExit} style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#18181b' }}>
            <ActiveGridMarker />
            <button type="button" data-probe-action="back" className="relative z-10 m-6 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs" onClick={onBack}>
                返回
            </button>
            <div {...{ [MORPH_TARGET_ATTR]: '' }} style={{ position: 'absolute', left: 620, top: 350, width: 200, height: 200, borderRadius: 8, overflow: 'hidden' }}>
                {cover && <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </div>
        </motion.div>
    );
};

const ArtistEntranceProbe: React.FC = () => {
    const snapshot = useCollectionNavigationStore(state => state.snapshot);
    // As the host hands it over: only to the page it was committed for.
    const plan = useMorphPlanFor(snapshot?.stack.length ?? 0);
    const active = snapshot?.stack[snapshot.stack.length - 1] ?? null;
    // The artist's resource, as the host holds it for the page on show.
    const artist = active && active.type === 'artist' ? active : null;
    const resource = useArtistResource({ key: artist ? collectionKey(artist) : null, descriptor: artist, local: NO_LOCAL_LIBRARY });

    // What the grid does at a card's click (the overlay commits the plan with the capture), and
    // for an open with no card: the plan before the navigation.
    const open = () => {
        const next = planForOpening();
        if (next.kind === 'morph') useCollectionMorphStore.getState().commitPlan(next, 1);
        useCollectionNavigationStore.getState().openRoot(ARTIST, 'home');
    };
    const back = () => {
        useCollectionMorphStore.getState().clear();
        useCollectionNavigationStore.getState().clear();
    };
    const pushAlbum = (id: number | string, album?: { name?: string }) => {
        useCollectionMorphStore.getState().commitPlan(planForOpening(), 2);
        useCollectionNavigationStore.getState().push({ source: 'online', providerId: PROVIDER_ID, type: 'album', id, name: album?.name ?? 'Album' } as unknown as GridViewCollectionDescriptor);
    };
    // What the grid's beforeBack does on a nested back (gridHostTransitions): the flight back is
    // armed while the page is there, and the navigation moves a moment later.
    const backFromAlbum = () => {
        const navigation = useCollectionNavigationStore.getState();
        const stack = navigation.snapshot?.stack ?? [];
        const centred = probeCentredCard();
        if (centred) useCollectionMorphStore.getState().armNestedExit(cardOf(centred));
        setTimeout(() => {
            if (navigation.snapshot) navigation.restore({ ...navigation.snapshot, stack: stack.slice(0, -1) });
        }, 20);
    };

    return (
        <div
            className="min-h-screen bg-zinc-900 p-8 text-zinc-200"
            style={{ ['--bg-color' as string]: '#18181b', ['--text-primary' as string]: '#fafafa' }}
        >
            <div style={{ visibility: snapshot ? 'hidden' : 'visible', transition: `visibility 0s linear ${snapshot ? 0.45 : 0}s` }}>
                <button type="button" data-probe-action="open-by-name" className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs" onClick={open}>
                    按名字打开（没有卡片可飞）
                </button>
                <button
                    type="button"
                    {...{ [MORPH_SOURCE_ATTR]: 'artist:probe-artist' }}
                    data-probe-card
                    onClick={open}
                    style={{ position: 'fixed', left: 80, top: 320, width: 168, textAlign: 'center', cursor: 'pointer' }}
                >
                    <span style={{ display: 'block', width: 168, height: 168, borderRadius: '50%', overflow: 'hidden' }}>
                        <img src={picture('card')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </span>
                    <span {...{ [CARD_TITLE_ATTR]: '' }} style={{ display: 'block', marginTop: 8, fontSize: 14, fontWeight: 700 }}>Probe Artist</span>
                </button>
            </div>

            <AnimatePresence initial={false}>
                {active && (active.type === 'album' ? <AlbumPage key={`album-${active.id}`} onBack={backFromAlbum} /> : (
                    <ArtistGridView
                        key={String(active.id)}
                        collection={active}
                        resource={resource}
                        playback={NO_PLAYBACK}
                        declaredActions={DECLARED}
                        onBack={back}
                        onDone={back}
                        onSelectAlbum={pushAlbum}
                        theme={THEME}
                        isDaylight={false}
                        morphPlan={plan}
                    />
                ))}
            </AnimatePresence>

            <CollectionMorphOverlay enabled />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'artistEntrance',
    title: '歌手页的入场',
    description: '真的歌手页和转场，假的平台：资料、歌曲、专辑、图片各晚到一段时间。看头像和其余卡片是怎么出现的。',
    Component: ArtistEntranceProbe,
};

export default definition;
