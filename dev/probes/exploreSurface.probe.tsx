import React, { useState } from 'react';
import ExploreSurface from '../../src/components/app/home/explore/ExploreSurface';
import { registerOnlineMusicProvider } from '../../src/services/onlineMusic/providerRegistry';
import { noteSongListened, noteSongPlayed, resetRecentPlays } from '../../src/components/app/home/explore/recentPlays';
import { useExploreFeedStore } from '../../src/stores/useExploreFeedStore';
import { useOnlineProviderAccountStore } from '../../src/stores/useOnlineProviderAccountStore';
import { bass, mid, treble } from '../../src/stores/motionSignals';
import { setCurrentSong, setPlayerState } from '../../src/stores/usePlaybackStore';
import { PlayerState } from '../../src/types';
import type { UnifiedSong } from '../../src/types';
import type { OnlineMusicProvider, ProviderCollection, ProviderExploreItem, ProviderExploreSection } from '../../src/types/onlineMusic';
import type { ProbeDefinition } from './definition';
// dev/probes/exploreSurface.probe.tsx

/**
 * 首页的“探索”分页只有登录了带推荐页的平台才出现，整应用测试走不到。这里挂一个假平台：
 * 第一页六栏（比窗口高，要滚动才到底），第一栏的“更多”再给三首。滚到底时，下一页是空的，
 * 再下一页第一次读失败、重试后给出最后一栏。
 * 用来看卡片排版、明暗两套配色，以及点歌、点卡片、读更多、读失败后重试、收起再回来这几条路。
 * 每逢第二次读第一页，头两栏对调着给（真实平台每次给的顺序不一样）；页面该按第一次的顺序排。
 * “换一批”平时不重读页面：第一栏换成“更多”后面那三首，别的栏没有可换的。要看重读页面的那条路，
 * 先按“sections have no further items”（之后栏内“更多”答“没有了”），再按“换一批”。
 * 顶上的按钮还能让下一次读第一页停住不答、放行，或者失败一次，以及把“Playlist 1”当作刚被取消收藏。
 * “hear a song”当作刚在应用里听了一首新歌（应用自己的“最近播放”一栏就出现在最前面），
 * “hear the oldest again”当作把最早听的那首又听了一遍，“hear the second again”是第二首：
 * 听过不止一次的歌另有一栏“再听一次”，排在“最近播放”后面。每次打开页面，这份记录从空开始。
 * 点一首歌，它就成了播放器上正在响的那首（真应用里是播放器做的事）；“pause”让它停住。
 * “hum”开始像播放器那样每帧写音量，是一段平平的低音；“kick”是这段低音里的一记鼓。
 * 地址带 `&slow=<毫秒>` 时，每次读取都等这么久才答，用来看读取期间的样子。
 *
 * 地址带 `&sample=page` 时，第一页换成照真实推荐页的构成编的内容：歌曲和合辑是 16:9 的视频
 * 截图，歌手是圆头像，标题有长有短，有一栏只有一首，最后一栏只有一首但还有“更多”。不带时是上面那六栏。
 * 再带 `&stills=<视频 id>,<视频 id>…` 时，宽封面换成这些公开视频的真实截图（要联网）。
 */
const PROVIDER_ID = 'explore-probe';
const showsSamplePage = new URLSearchParams(window.location.search).get('sample') === 'page';
const stills = (new URLSearchParams(window.location.search).get('stills') ?? '').split(',').filter(id => /^[\w-]{11}$/.test(id));
const slowMs = Number(new URLSearchParams(window.location.search).get('slow')) || 0;
const slowly = () => new Promise<void>(resolve => { setTimeout(resolve, slowMs); });
// 应用自己的“最近播放”存在 localStorage 里；每次打开页面从空开始，测试之间互不相干。
localStorage.removeItem('folia_recent_plays');
resetRecentPlays();
const ACCOUNT_ID = 'probe';
let songsHeard = 0;
let refusalsLeft = 1;
let firstPageReads = 0;
// 停住时，读第一页要等到放行；`refusesFirstPage` 让下一次读第一页失败一次。
let release: (() => void) | null = null;
let held: Promise<void> | null = null;
let refusesFirstPage = false;

const cover = (hue: number, wide = false) => {
    if (wide && stills.length > 0) return `https://i.ytimg.com/vi/${stills[hue % stills.length]}/hqdefault.jpg`;
    const width = 320;
    const height = wide ? 180 : 320;
    return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
        + `<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,30%)"/></linearGradient></defs>`
        + `<rect width="${width}" height="${height}" fill="url(#g)"/>`
        + `<circle cx="${width * 0.72}" cy="${height * 0.3}" r="${height * 0.42}" fill="hsl(${(hue + 25) % 360},85%,70%)" opacity="0.35"/>`
        + `<circle cx="${width * 0.2}" cy="${height * 0.85}" r="${height * 0.5}" fill="hsl(${(hue + 320) % 360},60%,20%)" opacity="0.45"/></svg>`,
    )}`;
};

const song = (index: number): UnifiedSong => ({
    id: `song-${index}`, name: `Song number ${index}`, durationMs: 200000,
    artists: [{ id: '', name: index % 3 === 0 ? 'A rather long artist name that will not fit' : `Artist ${index}` }],
    album: { id: '', name: '', coverUrl: cover(index * 37) },
    sourceRef: { kind: 'online', providerId: PROVIDER_ID, mediaId: `song-${index}` },
});
const card = (type: string, index: number, extra: Partial<ProviderCollection> = {}): ProviderCollection => ({
    providerId: PROVIDER_ID, id: `${type}-${index}`, type, name: `${type[0].toUpperCase()}${type.slice(1)} ${index}`,
    coverUrl: index === 2 ? '' : cover(index * 53 + 120), ...extra,
});
const songs = (from: number, count: number): ProviderExploreItem[] => Array.from({ length: count }, (_, offset) => ({ kind: 'song', song: song(from + offset) }));

const classicSections = (): ProviderExploreSection[] => [
    { id: 'picks', title: 'Picked for you', items: songs(1, 6), moreCursor: 'more-picks' },
    { id: 'mixed', title: 'Playlists, albums and artists', items: [
        { kind: 'collection', collection: card('playlist', 1) },
        { kind: 'collection', collection: card('playlist', 2), isMix: true },
        { kind: 'collection', collection: card('album', 3, { artists: [{ id: '', name: 'Album Artist' }] }) },
        { kind: 'collection', collection: card('artist', 4) },
        ...songs(20, 8),
    ] },
    ...[50, 60, 70, 80].map(from => ({ id: `row-${from}`, title: `Shelf ${from}`, items: songs(from, 6) })),
];

// What the real page was made of when it was measured (2026-10-07): video stills for songs and
// mixes, round pictures for artists, titles from 2 to 93 characters, artists' names often absent.
const TITLES = [
    'アイドル', '夜に駆ける', 'Never Gonna Give You Up (Official Video) (4K Remaster)', '群青',
    '【MV】あの夢をなぞって / YOASOBI — 小説「夢の雫と星の花」原作 Official Music Video Full Version', '晴天', 'Bling-Bang-Bang-Born',
    '怪物', 'Subtitle', '勇者', 'Blinding Lights', '花に亡霊', 'ただ声一つ', 'KICK BACK', '夜曲', '稻香',
    'Shape of You', 'ドライフラワー', '白日', 'Lemon', '打上花火', 'Pretender',
];
const ARTISTS = ['YOASOBI', 'Rick Astley', '周杰伦', 'Creepy Nuts', 'Official髭男dism', '米津玄師', 'ヨルシカ', 'The Weeknd', 'Ado', 'King Gnu'];
const previewSong = (index: number): ProviderExploreItem => ({
    kind: 'song',
    wideCoverUrl: cover(index * 47 + 10, true),
    song: {
        id: `song-${index}`, name: TITLES[index % TITLES.length], durationMs: 150000 + ((index * 37) % 140) * 1000,
        artists: index % 4 === 3 ? [] : [{ id: '', name: ARTISTS[index % ARTISTS.length] }],
        album: { id: '', name: '', coverUrl: cover(index * 47 + 10, true) },
        sourceRef: { kind: 'online', providerId: PROVIDER_ID, mediaId: `song-${index}` },
    },
});
const previewCard = (type: string, index: number, name: string, wide: boolean, extra: Partial<ProviderCollection> = {}): ProviderExploreItem => ({
    kind: 'collection',
    ...(wide ? { wideCoverUrl: cover(index * 61 + 200, true) } : {}),
    collection: { providerId: PROVIDER_ID, id: `${type}-${index}`, type, name, coverUrl: cover(index * 61 + 200, wide), ...extra },
});
const previewSections = (): ProviderExploreSection[] => [
    { id: 'picks', title: '为你推荐', items: [1, 2, 3, 4, 5, 6].map(previewSong), moreCursor: 'more-picks' },
    { id: 'vault', title: '猜你喜欢', items: [previewSong(7)] },
    { id: 'mixes', title: '为你打造的合辑', moreCursor: 'more-mixes', items: [
        '我的超级合辑', 'YOASOBI 合辑', '日语流行精选', '深夜放松', '专注工作', '华语经典',
    ].map((name, index) => ({ ...previewCard('playlist', index + 1, name, true), isMix: true })) },
    { id: 'artists', title: '你常听的艺人', items: ARTISTS.slice(0, 6).map((name, index) => previewCard('artist', index + 1, name, false)) },
    { id: 'fresh', title: '新歌速递', items: [
        previewSong(8), previewSong(9), previewSong(10), previewSong(11),
        previewCard('playlist', 20, '本周新歌', true), previewCard('playlist', 21, 'RELEASED', true),
    ] },
    { id: 'albums', title: '专辑', items: [
        ['THE BOOK', 'YOASOBI'], ['叶惠美', '周杰伦'], ['STRAY SHEEP', '米津玄師'], ['After Hours', 'The Weeknd'], ['盗作', 'ヨルシカ'],
    ].map(([name, artist], index) => previewCard('album', index + 1, name, false, { artists: [{ id: '', name: artist }] })) },
    { id: 'hits', title: '热门单曲', items: [12, 13, 14, 15].map(previewSong) },
    { id: 'next', title: '接着听', items: [previewSong(22)], moreCursor: 'more-next' },
];

// 打开后，之后读到的第一页各栏的 id 和上一次读到的一样（契约没有说 id 每次都换）。
let keepsSectionIds = false;
// 平台有两种：有的每次读第一页都给另一批条目，有的几乎原样给回来（实测 YouTube 是后一种）。
// 默认是前一种：第二次起读到的条目另有一套 id（名字和图不变），页面把它们当成别的条目。打开后是后一种。
let handsSameEntriesBack = false;
// “换一批”先换每一栏自己后面的条目，所有栏都没有没显示过的条目了才从头重读页面。打开后，栏内“更多”
// 一律答“没有了”：每次“换一批”都是重读页面。
let hasNoFurtherItems = false;
const ofRead = (item: ProviderExploreItem, read: number): ProviderExploreItem => {
    if (read === 1 || handsSameEntriesBack) return item;
    return item.kind === 'song'
        ? { ...item, song: { ...item.song, id: `${item.song.id}~${read}`, sourceRef: { kind: 'online', providerId: PROVIDER_ID, mediaId: `${item.song.id}~${read}` } } }
        : { ...item, collection: { ...item.collection, id: `${item.collection.id}~${read}` } };
};

const provider: OnlineMusicProvider = {
    id: PROVIDER_ID, displayName: 'Explore probe',
    capabilities: {
        search: false, playback: false, lyrics: false, auth: false, userLibrary: false, playlists: false, albums: false,
        artists: false, recommendations: false, mutations: false, wordByWordLyrics: false, explore: true,
    },
    normalizeSong: raw => raw as UnifiedSong,
    explore: {
        async getFeed(cursor) {
            if (slowMs > 0) await slowly();
            if (cursor === 'page-2') return { sections: [], nextCursor: 'page-3' };
            if (cursor) {
                if (refusalsLeft > 0) { refusalsLeft -= 1; throw new Error('The probe refuses this page once'); }
                return { sections: [{ id: 'later', title: 'A shelf from the next page', items: songs(40, 5) }] };
            }
            await held;
            if (refusesFirstPage) { refusesFirstPage = false; throw new Error('The probe refuses this read once'); }
            firstPageReads += 1;
            // 真实平台的栏目除了标题没有别的标识，每次读到的 id 都是新的。
            const sections = (showsSamplePage ? previewSections() : classicSections()).map(section => ({
                ...section, id: keepsSectionIds ? section.id : `${section.id}-${firstPageReads}`, items: section.items.map(item => ofRead(item, firstPageReads)),
            }));
            const ordered = firstPageReads % 2 === 0 ? [sections[1], sections[0], ...sections.slice(2)] : sections;
            return { nextCursor: 'page-2', sections: ordered };
        },
        async getSectionItems(cursor) {
            if (slowMs > 0) await slowly();
            if (hasNoFurtherItems) return { items: [] };
            return { items: showsSamplePage ? [16, 17, 18, 19, 20, 21].map(previewSong) : songs(10, 3) };
        },
    },
};
registerOnlineMusicProvider(provider);
// 一首刚听过的歌：样例页里是它那种带宽截图的歌。
const heardSong = (index: number): UnifiedSong => {
    const sample = showsSamplePage ? previewSong(index) : null;
    return sample?.kind === 'song' ? sample.song : song(index);
};
// 应用里一首歌从头听过一半时，播放记录先后收到的就是这两句：响够几秒算播放过，听够一半算听过一次。
// 交给它的歌长是 1 毫秒：播放记录把“隔得比歌本身还短”的两次收听算作同一次，探针里连着按两次按钮要算两次收听。
const hearThrough = (index: number) => {
    noteSongPlayed(heardSong(index), ACCOUNT_ID);
    noteSongListened(heardSong(index), ACCOUNT_ID, 1, false);
};
useOnlineProviderAccountStore.getState().setActiveProviderId(PROVIDER_ID);
// 播放器每帧往全应用写一次各频段的音量。“hum”从此照样每帧写：一段平平的低音（两个相邻的数来回，
// 连写同一个数不算变化，听的人收不到）；“kick”让接下来的两帧顶到最高，是一记鼓。
let kickFrames = 0;
let humming = false;
const hum = () => {
    if (humming) return;
    humming = true;
    let frames = 0;
    const write = () => {
        frames += 1;
        bass.set(kickFrames > 0 ? 255 : 80 + (frames % 2));
        mid.set(120 + (frames % 2));
        treble.set(60 + (frames % 2));
        if (kickFrames > 0) kickFrames -= 1;
        requestAnimationFrame(write);
    };
    write();
};

const ExploreSurfaceProbe: React.FC = () => {
    const [isDaylight, setIsDaylight] = useState(false);
    const [isShown, setIsShown] = useState(true);
    const [played, setPlayed] = useState('');
    const [queued, setQueued] = useState('');
    const [opened, setOpened] = useState('');

    return (
        <div
            className="flex h-screen flex-col"
            style={{
                backgroundColor: isDaylight ? '#f5f5f4' : '#09090b',
                ['--bg-color' as string]: isDaylight ? '#f5f5f4' : '#09090b',
                ['--text-primary' as string]: isDaylight ? '#1c1917' : '#f4f4f5',
                color: isDaylight ? '#1c1917' : '#f4f4f5',
            }}
            data-probe-played={played}
            data-probe-queue={queued}
            data-probe-opened={opened}
        >
            <div className="flex gap-2 self-start p-2 text-xs">
                <button data-probe-toggle="daylight" onClick={() => setIsDaylight(value => !value)}>toggle daylight</button>
                {/* 首页被播放页盖住时整个卸载，回来时重新挂上。 */}
                <button data-probe-toggle="surface" onClick={() => setIsShown(value => !value)}>toggle surface</button>
                {/* 切换平台时正在读的那一页作废，store 里什么都不留。 */}
                <button data-probe-forget onClick={() => useExploreFeedStore.getState().clear()}>forget page</button>
                <button data-probe-hold onClick={() => { held = new Promise(resolve => { release = resolve; }); }}>hold reads</button>
                <button data-probe-release onClick={() => { release?.(); held = null; }}>release</button>
                <button data-probe-refuse onClick={() => { refusesFirstPage = true; }}>refuse next read</button>
                {/* 在集合界面取消收藏之后，探索页收到的就是这一句。 */}
                <button data-probe-take-out onClick={() => useExploreFeedStore.getState().noteSaved({ providerId: PROVIDER_ID, type: 'playlist', id: 'playlist-1' }, false)}>take Playlist 1 out</button>
                <button data-probe-hear onClick={() => { songsHeard += 1; hearThrough(100 + songsHeard); }}>hear a song</button>
                <button data-probe-hear-again onClick={() => hearThrough(101)}>hear the oldest again</button>
                <button data-probe-hear-second-again onClick={() => hearThrough(102)}>hear the second again</button>
                <button data-probe-keep-ids onClick={() => { keepsSectionIds = true; }}>platform names its sections alike in every read</button>
                <button data-probe-same-entries onClick={() => { handsSameEntriesBack = true; }}>platform hands the same entries back in every read</button>
                <button data-probe-no-further onClick={() => { hasNoFurtherItems = true; }}>sections have no further items: every refresh reads the page</button>
                <button data-probe-pause onClick={() => setPlayerState(PlayerState.PAUSED)}>pause</button>
                <button data-probe-hum onClick={hum}>hum</button>
                <button data-probe-kick onClick={() => { kickFrames = 2; }}>kick</button>
            </div>
            <div className="min-h-0 flex-1">
                {isShown && (
                    <ExploreSurface
                        providerId={PROVIDER_ID}
                        accountId={ACCOUNT_ID}
                        scope="probe:en"
                        onPlaySong={(picked, queue) => {
                            setPlayed(`${picked.id} of ${queue.length}`);
                            setQueued(queue.map(entry => entry.id).join(' '));
                            setCurrentSong(picked);
                            setPlayerState(PlayerState.PLAYING);
                        }}
                        onOpenCollection={collection => setOpened(`${collection.type}:${collection.id}`)}
                    />
                )}
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'exploreSurface',
    title: '首页 · 探索',
    description: '平台推荐页的分栏卡片。验证排版、明暗配色，以及点歌、点卡片、栏内“更多”、换一批（旧页留到新页读到、栏目顺序不变）、滚到底读下一页（含读失败后重试）、收起再回来时停在原处、应用自己的两栏（“最近播放”，以及听过不止一次的歌“再听一次”）。地址加 &sample=page 看照真实推荐页编的内容，加 &slow=800 看读取期间的样子。',
    Component: ExploreSurfaceProbe,
};

export default definition;
