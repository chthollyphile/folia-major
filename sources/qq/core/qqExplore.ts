import type {
    FoliumSourceExplore,
    FoliumSourceExploreItem,
    FoliumSourceExplorePage,
    FoliumSourceExploreSection,
    FoliumSourceSong,
} from '@folia/folium';
import { createHandedOut, cursorWords, errorMessage, stampCursor } from '@folia/folium-source-kit';
import { isQqError, qqText } from './qqEnv';
import { qqRadioCollection, qqToplistCollection } from './qqLists';
import { normalizeQqCollection, normalizeQqSong, qqSongIdNumberOf } from './qqNormalize';
import { hasUsableQqSession, requestQq } from './qqTransport';

// sources/qq/core/qqExplore.ts
// QQ 音乐的探索页：个人化的在前，往下相似歌曲和公开的栏交替。
//  1. 第一页：刷歌模式（`/recommend/radar`，客户端的「雷达」，一页约 10 首，没登录也有，放最上面）、
//     每日 30 首（要登录）、客户端首页 feed 的几架（`/recommend/feed`，要登录，只有第 1 页，
//     只有歌曲与歌单；架子每次读取都不同）、推荐歌单（`/recommend/playlists`）、
//     全部榜单的卡片（`/recommend/toplists`，点开读那个榜的歌，见 qqLists.ts）。
//  2. 后面的几部分，相似歌曲和公开的栏交替：相似歌曲 → 新歌速递与新碟上架 → 相似歌曲 →
//     榜单的歌（照 QQ 的榜单顺序每次轮 4 个）→ 相似歌曲 → 歌单分类 → 电台。
//     「与《某首歌》相似」（`/song/similar`，要登录）问的歌先用听的人在应用里听过的，再用每日 30 首；
//     一部分做三栏，一次读取最多九栏。歌单分类每次轮到 3 个、各一栏。
//     电台（要登录）每次轮到 2 组、各一栏电台卡片，点开现给一批歌（`/radio/list`、`/radio/tracks`）；
//     「猜你喜欢」（电台 99）和账号的收听记录「最近」都不放。
// 「换一批」：大部分栏只有重读才换得了（分类、电台、相似歌曲的栏每次换一组），所以在第一页声明
// `refreshReadsAnew`，每次换一批都从头重读；每栏一次读取交一批，交过什么记在 exploreReads.ts 的共用记忆里，
// 下一次先交没交过的。一栏的游标只给「更多」用：把这一栏接着展开，不换内容。

/** 一栏一次交出的条数，「更多」每次也是这么多。 */
const BATCH = 12;
// 一部分做几栏相似歌曲、一次读取最多几栏（每栏一个请求），一栏至少要几首不在别栏里的歌。
const SIMILAR_A_PART = 3;
const MAX_SIMILAR = 9;
const SIMILAR_MIN = 4;
// 一次读取轮到几个分类、几组电台。
const CATEGORIES_A_READ = 3;
const RADIO_GROUPS_A_READ = 2;
// 榜单的歌一次读取轮几个榜，各一栏；照 QQ 的榜单顺序（巅峰、地区、特色、全球）轮下去。
const CHARTS_A_READ = 4;
// 电台 99 是「猜你喜欢」；私人 FM 读 `/user/personal-fm`，只有旧后端才退回猜你喜欢。
const GUESS_YOU_LIKE_RADIO = 99;
// 账号自己的收听记录（客户端电台页的「最近」）不属于探索页（EXPLORE_ADAPTER.md 规则 4）。
const isListeningRecord = (title: string) => title.startsWith('最近');

// 首页 feed 一架的标题。`{String}` 有两种用法：放在开头的是打招呼加昵称，去掉只留后面的话（昵称不进栏标题）；
// 夹在引号里的（「{String}」也会喜欢）是作种子的歌名，填进去，填不了就用通用的「为你推荐」。
// 没有占位的标题后面接上填进去的字；没有标题也用「为你推荐」。
const FEED_PLACEHOLDER = '{String}';
const QUOTED_PLACEHOLDER = /[「《“"]\{String\}[」》”"]/;
const feedTitleOf = (template: unknown, content: unknown): string => {
    const words = typeof template === 'string' ? template : '';
    const filled = typeof content === 'string' ? content.trim() : '';
    if (QUOTED_PLACEHOLDER.test(words)) {
        // 用函数替换：歌名里的 `$` 原样填进去，不当替换语法。
        return filled ? words.replace(FEED_PLACEHOLDER, () => filled).trim() : qqText('explore.feedForYou');
    }
    const at = words.indexOf(FEED_PLACEHOLDER);
    const title = (at >= 0 ? words.slice(at + FEED_PLACEHOLDER.length) : words).trim();
    if (!title) return qqText('explore.feedForYou');
    return at < 0 && filled ? `${title} · ${filled}` : title;
};

// 游标：读取的序号之后，是页面的下一部分，或一栏「更多」接着的位置（`HELD` 是这次读取持有的整份列表，
// `PAGED` 是要接着向 QQ 读的列表）。
const PART = 'part ';
const HELD = 'held ';
const PAGED = 'paged ';

const RADAR = 'radar';
const NEW_ALBUMS = 'new-albums';
const CHART = 'chart-';
const CATEGORY = 'category-';

const NEW_SONGS_ID = 'qq-new-songs';
const CHARTS_ID = 'qq-charts';
const DAILY_SONGS_ID = 'qq-daily-songs';
const PLAYLISTS_ID = 'qq-recommended-playlists';
// 交过什么记在这几个范围下（`handedOut`）：问过的歌、轮过的分类、轮过的电台组。
const SEEDS = 'seeds';
const CHART_TURN = 'charts';
const CATEGORIES = 'categories';
const RADIO_GROUPS = 'radio-groups';

// `id` 是数字歌曲 id（`/song/similar` 认它），`mid` 是这首歌在 Folia 里的 id（songmid）。
interface Seed { id: string; mid: string; name: string }
interface Named { id: string; name: string }
interface RadioGroup { id: string; name: string; radios: FoliumSourceExploreItem[] }

const newMemory = () => ({
    /** 分页读的列表上一次停在哪里（刷歌模式是第几页，其余是位置）：下一次读取从那里接着读。 */
    reached: new Map<string, number>(),
    /** 前几次读取交过的条目、问过的歌、轮过的分类和电台组（exploreReads.ts）。 */
    handedOut: createHandedOut(),
});

const newRead = (number: number, memory: ReturnType<typeof newMemory>, signedIn: boolean, listened: FoliumSourceSong[] = []) => ({
    number,
    memory,
    signedIn,
    /** 听的人在应用里听过的歌，拿来问相似歌曲。 */
    listened,
    /** 每日 30 首，一次读取只要一次：一栏用它，问相似歌曲也用它。 */
    daily: undefined as Promise<FoliumSourceSong[]> | undefined,
    /** 这次读取要问的歌，和已经用掉几首。 */
    seeds: undefined as Promise<Seed[]> | undefined,
    seedsUsed: 0,
    /** 整份读来的列表，按栏的范围，按这次交出的顺序：这一批，然后是「更多」接着给的。 */
    held: new Map<string, FoliumSourceExploreItem[]>(),
    /** 一首歌只出现在一栏相似歌曲里。 */
    onShelf: new Set<string>(),
    /** 排行榜清单（按组），一次读取只要一次。 */
    toplists: undefined as Promise<any[][]> | undefined,
});
type Read = ReturnType<typeof newRead>;

const present = <T>(value: T | null | undefined): value is T => value != null;
const keyOf = (item: FoliumSourceExploreItem): string => (item.kind === 'collection' ? `${item.collection.type}:${item.collection.id}` : `song:${item.song.id}`);
const countOf = (sections: FoliumSourceExploreSection[]) => sections.reduce((count, section) => count + section.items.length, 0);
const songItem = (song: FoliumSourceSong): FoliumSourceExploreItem => ({ kind: 'song', song });
const songsIn = (answer: any): FoliumSourceSong[] => (
    (Array.isArray(answer?.songs) ? answer.songs : []).map(normalizeQqSong).filter((song: FoliumSourceSong) => Boolean(song.lyricIds?.qq))
);
const listOf = (value: unknown): any[] => (Array.isArray(value) ? value : []);

// 422 是「上游成功但没有数据」：这一栏这次没有东西，不是失败。
const isEmptyAnswer = (error: unknown): boolean => (
    isQqError(error, 'network') && error.httpStatus === 422
);
const orEmpty = async <T>(asked: Promise<T>, empty: T): Promise<T> => {
    try {
        return await asked;
    } catch (error) {
        if (isEmptyAnswer(error)) return empty;
        throw error;
    }
};

/** 几个请求里到了的，按位置，没到的是 null。全都没到才失败（EXPLORE_ADAPTER.md 规则 6）。 */
const arrivedOf = async <T>(what: string, asked: Array<Promise<T>>): Promise<Array<T | null>> => {
    const answers = await Promise.allSettled(asked);
    const failed = answers.filter((answer): answer is PromiseRejectedResult => answer.status === 'rejected');
    if (failed.length > 0 && failed.length === answers.length) throw failed[0].reason;
    failed.forEach(answer => console.warn(`[QQ] Explore page: part of ${what} could not be read (${errorMessage(answer.reason)}); the page goes on without it`));
    return answers.map(answer => (answer.status === 'fulfilled' ? answer.value : null));
};

export const createQqExplore = (): FoliumSourceExplore => {
    let reads = 0;
    let memory = newMemory();
    // 画面上那一次读取。从头读的那一次在第一页到了之后接替它。
    let page = newRead(0, memory, false);
    // 一次只有一个从头读：有效的游标是最后到的那次读取的，它也得是最后要的那次。
    let lastRead: Promise<unknown> = Promise.resolve();
    // 相似歌曲、分类、电台的栏每次读取都是另一栏，靠做出来的先后认。
    let shelvesMade = 0;
    // 首页 feed 的架子每次读取都不同，靠做出来的先后认。
    let feedShelvesMade = 0;
    // 上一次读取有没有登录。登录状态变了就另起一份记忆，访客读过的不排账号的栏，反过来也一样。
    let hadAccount: boolean | undefined;

    const stamp = (read: Read, words: string) => stampCursor(read.number, words);
    const wordsIn = (cursor: string): string | null => cursorWords(cursor, page.number);

    /**
     * 范围 `scope` 下一整份列表的一批：这一栏没交过的在前，交过的按最久以前交过的在前。
     * 比一批长的，剩下的留在这次读取里，「更多」接着给。
     */
    const handOut = (read: Read, scope: string, listed: FoliumSourceExploreItem[]): Pick<FoliumSourceExploreSection, 'items' | 'moreCursor'> => {
        const all = [...new Map(listed.map(item => [keyOf(item), item] as const)).values()];
        const inTurn = read.memory.handedOut.inTurn(scope, all, keyOf);
        const items = inTurn.slice(0, BATCH);
        read.memory.handedOut.note(scope, items.map(keyOf));
        read.held.set(scope, inTurn);
        return { items, ...(inTurn.length > BATCH ? { moreCursor: stamp(read, `${HELD}${BATCH} ${scope}`) } : {}) };
    };

    /** 一份整读来的列表做成一栏；空的不出。`id` 不给就用范围当 id。 */
    const listShelf = (read: Read, scope: string, title: string, all: FoliumSourceExploreItem[], made?: string): FoliumSourceExploreSection | null => (
        all.length > 0
            ? { id: made ?? scope, title, ...handOut(read, scope, all), ...(made ? { changesWithRead: true } : {}) }
            : null
    );

    /** 列表 `key` 从 `from` 起的一批，和下一批从哪里起；`hasMore` 是 QQ 说后面还有。 */
    const readPaged = async (key: string, from: number): Promise<{ items: FoliumSourceExploreItem[]; hasMore: boolean; next: number }> => {
        if (key === RADAR) {
            // 刷歌模式按页读，`from` 是已经读过几页。
            const answer = await orEmpty(requestQq<any>('recommend_radar', { page: from + 1 }), null);
            const items = songsIn(answer).map(songItem);
            return { items, hasMore: answer?.more === true, next: from + 1 };
        }
        if (key === NEW_ALBUMS) {
            const answer = await orEmpty(requestQq<any>('recommend_new_albums', { offset: from, limit: BATCH }), null);
            const albums = listOf(answer?.albums);
            const items = albums
                .map(album => normalizeQqCollection(album, 'album'))
                .filter(album => album.id !== '' && album.name)
                .map((collection): FoliumSourceExploreItem => ({ kind: 'collection', collection }));
            // 下一批从后端给了几条算起，不从滤掉坏条目后剩几条算：否则下一批会和这一批重叠。
            return { items, hasMore: answer?.more === true, next: from + albums.length };
        }
        if (key.startsWith(CATEGORY)) {
            // 分类歌单按页码读：一页一批。
            const answer = await orEmpty(requestQq<any>('recommend_category_playlists', {
                id: Number(key.slice(CATEGORY.length)),
                page: Math.floor(from / BATCH) + 1,
                limit: BATCH,
            }), null);
            const items = listOf(answer?.playlists)
                .map(playlist => normalizeQqCollection(playlist))
                .filter(playlist => playlist.id !== '' && playlist.name)
                .map((collection): FoliumSourceExploreItem => ({ kind: 'collection', collection }));
            return { items, hasMore: answer?.more === true, next: from + BATCH };
        }
        const answer = await orEmpty(requestQq<any>('recommend_toplist', { id: Number(key.slice(CHART.length)), offset: from, limit: BATCH }), null);
        const items = songsIn(answer).map(songItem);
        return { items, hasMore: answer?.more === true, next: from + listOf(answer?.songs).length };
    };

    /**
     * 分页读的列表 `key` 做成一栏：接着上一次读取（自己或「更多」）交到的地方读一批，读到头就从头再来。
     * 后面还有就给游标。
     */
    const pagedShelf = async (read: Read, key: string, title: string, made?: string): Promise<FoliumSourceExploreSection | null> => {
        let from = read.memory.reached.get(key) ?? 0;
        let batch = await readPaged(key, from);
        // 列表比上次停的地方短了：从头读。
        if (batch.items.length === 0 && from > 0) {
            from = 0;
            batch = await readPaged(key, 0);
        }
        const goesOn = batch.hasMore && batch.items.length > 0;
        read.memory.reached.set(key, goesOn ? batch.next : 0);
        if (batch.items.length === 0) return null;
        return {
            id: made ?? `qq-${key}`,
            title,
            items: batch.items,
            ...(goesOn ? { moreCursor: stamp(read, `${PAGED}${batch.next} ${key}`) } : {}),
            ...(made ? { changesWithRead: true } : {}),
        };
    };

    /** 这次读取的每日 30 首；没登录不问，读不到当没有。 */
    const dailyOf = (read: Read): Promise<FoliumSourceSong[]> => {
        if (!read.daily) {
            read.daily = read.signedIn
                ? orEmpty(requestQq<any>('user_daily_songs'), null).then(songsIn).catch(error => {
                    console.warn(`[QQ] Explore page: the daily songs could not be read (${errorMessage(error)})`);
                    return [];
                })
                : Promise.resolve([]);
        }
        return read.daily;
    };

    /** 这次读取要问的歌：听过的在前，再来是每日 30 首；前几次读取问过的排后面，最多 `MAX_SIMILAR` 首。 */
    const seedsOf = (read: Read): Promise<Seed[]> => {
        read.seeds ??= collectSeeds(read);
        return read.seeds;
    };
    const collectSeeds = async (read: Read): Promise<Seed[]> => {
        const seeds: Seed[] = [];
        const known = new Set<string>();
        const add = (songs: FoliumSourceSong[]) => songs.forEach(song => {
            // `/song/similar` 认数字歌曲 id：歌里记着的（data.songId），旧版存下的歌 id 本身就是数字。
            const numeric = qqSongIdNumberOf(song) ?? Number(song.id);
            const id = String(numeric);
            if (!song.title || !Number.isSafeInteger(numeric) || numeric <= 0 || known.has(id)) return;
            known.add(id);
            seeds.push({ id, mid: song.id, name: song.title });
        });
        // 宿主交来的就是在应用里听过的这个音源的歌。
        add(read.listened);
        if (seeds.length < MAX_SIMILAR) add(await dailyOf(read));
        return read.memory.handedOut.inTurn(SEEDS, seeds, seed => seed.id).slice(0, MAX_SIMILAR);
    };

    /** 和 `seed` 相似、又不在别栏里的歌做成一栏；太少或读不到就不出。 */
    const similarShelf = async (read: Read, seed: Seed): Promise<FoliumSourceExploreSection | null> => {
        try {
            const found = songsIn(await orEmpty(requestQq<any>('song_similar', { id: Number(seed.id) }), null));
            const met = new Set([seed.mid]);
            const songs = found.filter(song => {
                const id = song.id;
                if (met.has(id) || read.onShelf.has(id)) return false;
                met.add(id);
                return true;
            });
            if (songs.length < SIMILAR_MIN) {
                console.log(`[QQ] Explore songs like ${seed.id}: ${songs.length} on no other shelf, too few for a shelf`);
                return null;
            }
            songs.forEach(song => read.onShelf.add(song.id));
            console.log(`[QQ] Explore songs like ${seed.id}: a shelf of ${songs.length} songs`);
            return {
                id: `qq-similar-${++shelvesMade}`,
                title: qqText('explore.similar', { name: seed.name }),
                items: songs.slice(0, BATCH).map(songItem),
                // 下一次读取问别的歌：它的栏接替这几栏的位置。
                changesWithRead: true,
            };
        } catch (error) {
            console.warn(`[QQ] Explore songs like ${seed.id} could not be read (${errorMessage(error)}); the page goes on without them`);
            return null;
        }
    };

    const toplistsOf = (read: Read): Promise<any[][]> => {
        if (!read.toplists) {
            read.toplists = orEmpty(requestQq<any>('recommend_toplists'), null)
                .then(answer => listOf(answer?.groups).map(group => listOf(group?.toplists)));
            // 失败的那次下回再要。
            read.toplists.catch(() => { read.toplists = undefined; });
        }
        return read.toplists;
    };

    const newPart = async (read: Read): Promise<FoliumSourceExploreSection[]> => (await arrivedOf('the new songs and albums', [
        orEmpty(requestQq<any>('recommend_new_songs'), null)
            .then(answer => listShelf(read, NEW_SONGS_ID, qqText('explore.newSongs'), songsIn(answer).map(songItem))),
        pagedShelf(read, NEW_ALBUMS, qqText('explore.newAlbums')),
    ])).filter(present);

    /** 下一部分的相似歌曲：接着这次读取要问的歌往下用 `SIMILAR_A_PART` 首；没登录没有。 */
    const similarPart = async (read: Read): Promise<FoliumSourceExploreSection[]> => {
        if (!read.signedIn) return [];
        const seeds = (await seedsOf(read)).slice(read.seedsUsed, read.seedsUsed + SIMILAR_A_PART);
        read.seedsUsed += seeds.length;
        read.memory.handedOut.note(SEEDS, seeds.map(seed => seed.id));
        return (await Promise.all(seeds.map(seed => similarShelf(read, seed)))).filter(present);
    };

    /** 榜单的歌：照 QQ 的榜单顺序，这次轮到的几个榜各一栏；前几次读取轮过的排后面。 */
    const chartSongsPart = async (read: Read): Promise<FoliumSourceExploreSection[]> => {
        const charts = (await toplistsOf(read)).flat()
            .filter(toplist => Number.isSafeInteger(Number(toplist?.id)) && Number(toplist.id) > 0);
        const taken = read.memory.handedOut.inTurn(CHART_TURN, charts, toplist => String(Number(toplist.id))).slice(0, CHARTS_A_READ);
        read.memory.handedOut.note(CHART_TURN, taken.map(toplist => String(Number(toplist.id))));
        return (await arrivedOf('the songs of the charts', taken.map(toplist => (
            pagedShelf(read, `${CHART}${Number(toplist.id)}`, String(toplist.title ?? ''))
        )))).filter(present);
    };

    const categoriesPart = async (read: Read): Promise<FoliumSourceExploreSection[]> => {
        const answer = await orEmpty(requestQq<any>('recommend_categories'), null);
        // 热门那一组（第一组）里的分类轮流出。
        const categories: Named[] = listOf(listOf(answer?.groups)[0]?.categories)
            .map(category => ({ id: String(category?.id ?? ''), name: typeof category?.name === 'string' ? category.name.trim() : '' }))
            .filter(category => Number(category.id) > 0 && category.name);
        const taken = read.memory.handedOut.inTurn(CATEGORIES, categories, category => category.id).slice(0, CATEGORIES_A_READ);
        read.memory.handedOut.note(CATEGORIES, taken.map(category => category.id));
        return (await arrivedOf('the playlist categories', taken.map(category => (
            pagedShelf(read, `${CATEGORY}${category.id}`, category.name, `qq-category-${++shelvesMade}`)
        )))).filter(present);
    };

    const radioPart = async (read: Read): Promise<FoliumSourceExploreSection[]> => {
        if (!read.signedIn) return [];
        const answer = await orEmpty(requestQq<any>('radio_list'), null);
        const groups: RadioGroup[] = listOf(answer?.groups).map(group => ({
            id: String(group?.id ?? ''),
            name: typeof group?.title === 'string' ? group.title.trim() : '',
            radios: listOf(group?.radios)
                .filter(radio => Number(radio?.id) !== GUESS_YOU_LIKE_RADIO)
                .map(qqRadioCollection)
                .filter(present)
                .map((collection): FoliumSourceExploreItem => ({ kind: 'collection', collection, isMix: true })),
        })).filter(group => group.id && group.name && !isListeningRecord(group.name) && group.radios.length > 0);
        const taken = read.memory.handedOut.inTurn(RADIO_GROUPS, groups, group => group.id).slice(0, RADIO_GROUPS_A_READ);
        read.memory.handedOut.note(RADIO_GROUPS, taken.map(group => group.id));
        return taken
            .map(group => listShelf(read, `qq-radio-${group.id}`, group.name, group.radios, `qq-radio-made-${++shelvesMade}`))
            .filter(present);
    };

    const PARTS = [similarPart, newPart, similarPart, chartSongsPart, similarPart, categoriesPart, radioPart];

    // 从第 `from` 部分起，第一个有栏的部分。读不到的部分略过，失败记进 `failures`。
    const madeHere = async (read: Read, from: number, failures: unknown[] = []): Promise<FoliumSourceExplorePage> => {
        for (let index = from; index < PARTS.length; index += 1) {
            let sections: FoliumSourceExploreSection[] = [];
            try {
                sections = await PARTS[index](read);
            } catch (error) {
                failures.push(error);
                console.warn(`[QQ] Explore page: part ${index + 1} of ${PARTS.length} could not be read (${errorMessage(error)}); the page goes on without it`);
            }
            if (read !== page) return { sections: [] };
            if (sections.length === 0) continue;
            console.log(`[QQ] Explore page (part ${index + 1} of ${PARTS.length}): ${sections.length} shelves, ${countOf(sections)} entries`);
            return { sections, ...(index + 1 < PARTS.length ? { nextCursor: stamp(read, `${PART}${index + 1}`) } : {}) };
        }
        return { sections: [] };
    };

    /** 首页 feed 的几架（要登录）；旧后端没有这条路由、没有可用架子都只是不出。 */
    const feedShelvesOf = async (read: Read): Promise<FoliumSourceExploreSection[]> => {
        if (!read.signedIn) return [];
        // 旧后端没有这条路由（404／旧 Serverless 的 501，transport 报成 unsupported）是常态，不当成读失败。
        const answer = await orEmpty(requestQq<any>('recommend_feed'), null).catch(error => {
            if (isQqError(error, 'unsupported')) return null;
            throw error;
        });
        return listOf(answer?.shelves).map((shelf, index) => {
            const items = listOf(shelf?.items).map((item): FoliumSourceExploreItem | null => {
                if (item?.type === 'song') {
                    const song = normalizeQqSong(item.song);
                    return song.lyricIds?.qq ? songItem(song) : null;
                }
                if (item?.type !== 'playlist') return null;
                const playlist = item.playlist ?? {};
                const collection = normalizeQqCollection({ tid: playlist.id, title: playlist.title, picurl: playlist.cover, desc: playlist.subtitle });
                return collection.id !== '' && collection.name ? { kind: 'collection', collection } : null;
            }).filter(present);
            return listShelf(read, `feed-${index}`, feedTitleOf(shelf?.titleTemplate, shelf?.titleContent), items, `qq-feed-${++feedShelvesMade}`);
        }).filter(present);
    };

    const firstPage = async (listened: FoliumSourceSong[]): Promise<FoliumSourceExplorePage> => {
        // 停用的会话（isQqSessionParked）请求不带，照游客读。
        const signedIn = hasUsableQqSession();
        if (hadAccount !== undefined && hadAccount !== signedIn) {
            memory = newMemory();
            console.log(`[QQ] Explore page: read ${signedIn ? 'for an account after a guest' : 'for a guest after an account'}; what the shelves handed out before is forgotten`);
        }
        hadAccount = signedIn;
        const read = newRead(++reads, memory, signedIn, listened);
        const failures: unknown[] = [];
        const shelves = await Promise.allSettled([
            pagedShelf(read, RADAR, qqText('explore.radar')),
            dailyOf(read).then(songs => listShelf(read, DAILY_SONGS_ID, qqText('explore.dailySongs'), songs.map(songItem))),
            feedShelvesOf(read),
            requestQq<any>('recommend_playlists', { limit: BATCH }).catch(error => (isEmptyAnswer(error) ? null : Promise.reject(error)))
                .then(answer => listShelf(read, PLAYLISTS_ID, qqText('explore.recommendedPlaylists'), listOf(answer?.playlists)
                    .map(playlist => normalizeQqCollection(playlist))
                    .filter(playlist => playlist.id !== '' && playlist.name)
                    .map((collection): FoliumSourceExploreItem => ({ kind: 'collection', collection })))),
            toplistsOf(read).then(groups => listShelf(read, CHARTS_ID, qqText('explore.charts'), groups.flat()
                .map(qqToplistCollection).filter(present)
                .map((collection): FoliumSourceExploreItem => ({ kind: 'collection', collection })))),
        ]);
        for (const answer of shelves) {
            if (answer.status !== 'rejected') continue;
            failures.push(answer.reason);
            console.warn(`[QQ] Explore page: part of the first page could not be read (${errorMessage(answer.reason)}); the page goes on without it`);
        }
        const sections = shelves.flatMap(answer => (answer.status === 'fulfilled' ? [answer.value].flat() : [])).filter(present);
        page = read;
        console.log(`[QQ] Explore page: ${sections.length} shelves, ${countOf(sections)} entries; ${signedIn ? 'signed in' : 'a guest: no daily songs, no similar songs and no radio'}`);
        if (sections.length === 0) {
            // 第一页什么都没有：直接给后面第一个有栏的部分。整页都读不到才算失败（EXPLORE_ADAPTER.md 规则 6）。
            const rest = await madeHere(read, 0, failures);
            if (rest.sections.length === 0 && failures.length > 0) throw failures[0];
            return { ...rest, refreshReadsAnew: true };
        }
        return { sections, nextCursor: stamp(read, `${PART}0`), refreshReadsAnew: true };
    };

    return {
        async getFeed(cursor, listened = []) {
            if (!cursor) {
                const answer = lastRead.then(() => firstPage(listened), () => firstPage(listened));
                lastRead = answer.catch(() => undefined);
                return answer;
            }
            const words = wordsIn(cursor);
            if (words === null) {
                console.log('[QQ] Explore page: further shelves asked for with a cursor of a read before; none given');
                return { sections: [] };
            }
            if (words.startsWith(PART)) return madeHere(page, Number(words.slice(PART.length)) || 0);
            return { sections: [] };
        },
        // 一栏的「更多」：接着它交出的往下给。（换一批不走这里：第一页说了换一批要整页重读。）
        async getSectionItems(cursor): Promise<{ items: FoliumSourceExploreItem[]; moreCursor?: string }> {
            const read = page;
            const words = wordsIn(cursor);
            if (words === null) {
                console.log('[QQ] Explore shelf: further entries asked for with a cursor of a read before; none given');
                return { items: [] };
            }
            const placed = (rest: string): [number, string] => {
                const at = rest.indexOf(' ');
                return [Number(rest.slice(0, at)) || 0, rest.slice(at + 1)];
            };
            if (words.startsWith(HELD)) {
                const [place, scope] = placed(words.slice(HELD.length));
                const held = read.held.get(scope) ?? [];
                const end = place + BATCH;
                const items = held.slice(place, end);
                // 算这次读取交过的：下一次读取先给没展开到的。
                read.memory.handedOut.note(scope, items.map(keyOf));
                console.log(`[QQ] Explore shelf ${scope}: ${items.length} further entries from place ${place}, ${Math.max(0, held.length - end)} after them`);
                return { items, ...(end < held.length ? { moreCursor: stamp(read, `${HELD}${end} ${scope}`) } : {}) };
            }
            if (words.startsWith(PAGED)) {
                const [from, key] = placed(words.slice(PAGED.length));
                const batch = await readPaged(key, from);
                if (read !== page) return { items: [] };
                const goesOn = batch.hasMore && batch.items.length > 0;
                // 下一次读取接着「更多」读到的地方；读到头就从头再来。
                read.memory.reached.set(key, goesOn ? batch.next : 0);
                console.log(`[QQ] Explore shelf ${key}: ${batch.items.length} further entries from place ${from}${goesOn ? '' : ', the last of the list'}`);
                return { items: batch.items, ...(goesOn ? { moreCursor: stamp(read, `${PAGED}${batch.next} ${key}`) } : {}) };
            }
            return { items: [] };
        },
    };
};

