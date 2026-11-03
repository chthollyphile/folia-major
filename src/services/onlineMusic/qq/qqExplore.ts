import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import type {
    OnlineExploreProvider,
    ProviderExploreItem,
    ProviderExploreItemsPage,
    ProviderExplorePage,
    ProviderExploreSection,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createHandedOut, cursorWords, stampCursor } from '../exploreReads';
import { errorMessage } from '../../../utils/errorText';
import { qqRadioCollection, qqToplistCollection } from './qqLists';
import { normalizeQqCollection, normalizeQqSong } from './qqNormalize';
import { hasUsableQqSession, requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqExplore.ts
// QQ 音乐的探索页。QQ 没有一条能直接用的推荐页接口（它的首页 feed 登录后只给 3 栏、卡片分不出类型，
// qq-music-api 3.3.3 没有接），所以栏都是这里用 3.3.3 的路由拼出来的，
// 顺序照 QQ 音乐客户端的推荐、乐馆、雷达三页：个人化的在前，公开的在后。
//  1. 第一页：刷歌模式（`/recommend/radar`，客户端的「雷达」，一页约 10 首，没登录也有），
//     登录后再加「与《某首歌》相似」（`/song/similar`，要登录）。问的歌先用听的人在应用里听过的，
//     再用每日 30 首，一次读取最多做 3 栏。
//  2. 新歌速递（`/recommend/new-songs`）和新碟上架（`/recommend/new-albums`）。
//  3. 排行榜：全部榜的卡片（`/recommend/toplists`，点开读那个榜的歌，见 qqLists.ts），和热歌榜的歌。
//  4. 歌单分类：每次读取轮到 3 个分类，各一栏（`/recommend/categories`、`/recommend/category-playlists`）。
//  5. 电台（要登录）：每次读取轮到 2 组，各一栏电台卡片，点开现给一批歌（`/radio/list`、`/radio/tracks`）。
//     「猜你喜欢」（电台 99）就是电台页签的私人 FM，「最近」是账号自己的收听记录，都不放。
// 每日 30 首和推荐歌单在电台页签，这里不重复。
// 「换一批」：大部分栏只有重读才换得了（分类、电台、相似歌曲的栏每次换一组），所以在第一页声明
// `refreshReadsAnew`，每次换一批都从头重读；每栏一次读取交一批，交过什么记在 exploreReads.ts 的共用记忆里，
// 下一次先交没交过的。一栏的游标只给「更多」用：把这一栏接着展开，不换内容。

/** 一栏一次交出的条数，「更多」每次也是这么多。 */
const BATCH = 12;
// 一次读取最多做几栏相似歌曲（每栏一个请求），一栏至少要几首不在别栏里的歌。
const SIMILAR_A_READ = 3;
const SIMILAR_MIN = 4;
// 一次读取轮到几个分类、几组电台。
const CATEGORIES_A_READ = 3;
const RADIO_GROUPS_A_READ = 2;
// 热歌榜按名字认；认不出就用清单里的第一个榜。
const HOT_CHART_TITLE = '热歌榜';
// 电台 99 是「猜你喜欢」，和电台页签的私人 FM 同一个来源。
const GUESS_YOU_LIKE_RADIO = 99;
// 账号自己的收听记录（客户端电台页的「最近」）不属于探索页（EXPLORE_ADAPTER.md 规则 4）。
const isListeningRecord = (title: string) => title.startsWith('最近');

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
// 交过什么记在这几个范围下（`handedOut`）：问过的歌、轮过的分类、轮过的电台组。
const SEEDS = 'seeds';
const CATEGORIES = 'categories';
const RADIO_GROUPS = 'radio-groups';

interface Seed { id: string; name: string }
interface Named { id: string; name: string }
interface RadioGroup { id: string; name: string; radios: ProviderExploreItem[] }

const newMemory = () => ({
    /** 分页读的列表上一次停在哪里（刷歌模式是第几页，其余是位置）：下一次读取从那里接着读。 */
    reached: new Map<string, number>(),
    /** 前几次读取交过的条目、问过的歌、轮过的分类和电台组（exploreReads.ts）。 */
    handedOut: createHandedOut(),
});

const newRead = (number: number, memory: ReturnType<typeof newMemory>, signedIn: boolean) => ({
    number,
    memory,
    signedIn,
    /** 整份读来的列表，按栏的范围，按这次交出的顺序：这一批，然后是「更多」接着给的。 */
    held: new Map<string, ProviderExploreItem[]>(),
    /** 一首歌只出现在一栏相似歌曲里。 */
    onShelf: new Set<string>(),
    /** 排行榜清单，一次读取只要一次。 */
    toplists: undefined as Promise<any[]> | undefined,
});
type Read = ReturnType<typeof newRead>;

const present = <T>(value: T | null | undefined): value is T => value != null;
const keyOf = (item: ProviderExploreItem): string => (item.kind === 'collection' ? `${item.collection.type}:${item.collection.id}` : `song:${item.song.id}`);
const countOf = (sections: ProviderExploreSection[]) => sections.reduce((count, section) => count + section.items.length, 0);
const songItem = (song: UnifiedSong): ProviderExploreItem => ({ kind: 'song', song });
const songsIn = (answer: any): UnifiedSong[] => (
    (Array.isArray(answer?.songs) ? answer.songs : []).map(normalizeQqSong).filter((song: UnifiedSong) => Boolean(song.qqMid))
);
const listOf = (value: unknown): any[] => (Array.isArray(value) ? value : []);

// 422 是「上游成功但没有数据」：这一栏这次没有东西，不是失败。
const isEmptyAnswer = (error: unknown): boolean => (
    error instanceof OnlineProviderError && error.code === 'network' && error.httpStatus === 422
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

export const createQqExplore = (): OnlineExploreProvider => {
    let reads = 0;
    let memory = newMemory();
    // 画面上那一次读取。从头读的那一次在第一页到了之后接替它。
    let page = newRead(0, memory, false);
    // 一次只有一个从头读：有效的游标是最后到的那次读取的，它也得是最后要的那次。
    let lastRead: Promise<unknown> = Promise.resolve();
    // 相似歌曲、分类、电台的栏每次读取都是另一栏，靠做出来的先后认。
    let shelvesMade = 0;
    // 上一次读取有没有登录。登录状态变了就另起一份记忆，访客读过的不排账号的栏，反过来也一样。
    let hadAccount: boolean | undefined;

    const stamp = (read: Read, words: string) => stampCursor(read.number, words);
    const wordsIn = (cursor: string): string | null => cursorWords(cursor, page.number);

    /**
     * 范围 `scope` 下一整份列表的一批：这一栏没交过的在前，交过的按最久以前交过的在前。
     * 比一批长的，剩下的留在这次读取里，「更多」接着给。
     */
    const handOut = (read: Read, scope: string, listed: ProviderExploreItem[]): Pick<ProviderExploreSection, 'items' | 'moreCursor'> => {
        const all = [...new Map(listed.map(item => [keyOf(item), item] as const)).values()];
        const inTurn = read.memory.handedOut.inTurn(scope, all, keyOf);
        const items = inTurn.slice(0, BATCH);
        read.memory.handedOut.note(scope, items.map(keyOf));
        read.held.set(scope, inTurn);
        return { items, ...(inTurn.length > BATCH ? { moreCursor: stamp(read, `${HELD}${BATCH} ${scope}`) } : {}) };
    };

    /** 一份整读来的列表做成一栏；空的不出。`id` 不给就用范围当 id。 */
    const listShelf = (read: Read, scope: string, title: string, all: ProviderExploreItem[], made?: string): ProviderExploreSection | null => (
        all.length > 0
            ? { id: made ?? scope, title, ...handOut(read, scope, all), ...(made ? { changesWithRead: true } : {}) }
            : null
    );

    /** 列表 `key` 从 `from` 起的一批，和下一批从哪里起；`hasMore` 是 QQ 说后面还有。 */
    const readPaged = async (key: string, from: number): Promise<{ items: ProviderExploreItem[]; hasMore: boolean; next: number }> => {
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
                .map((collection): ProviderExploreItem => ({ kind: 'collection', collection }));
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
                .map((collection): ProviderExploreItem => ({ kind: 'collection', collection }));
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
    const pagedShelf = async (read: Read, key: string, title: string, made?: string): Promise<ProviderExploreSection | null> => {
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

    /** 这次读取要问的歌：听过的在前，再来是每日 30 首；前几次读取问过的排后面。 */
    const seedsOf = async (read: Read, listened: UnifiedSong[]): Promise<Seed[]> => {
        const seeds: Seed[] = [];
        const known = new Set<string>();
        const add = (songs: UnifiedSong[]) => songs.forEach(song => {
            const id = String(song.id);
            const numeric = Number(id);
            // `/song/similar` 认数字歌曲 id。
            if (!song.name || !Number.isSafeInteger(numeric) || numeric <= 0 || known.has(id)) return;
            known.add(id);
            seeds.push({ id, name: song.name });
        });
        add(listened.filter(song => song.sourceRef?.kind !== 'online' || song.sourceRef.providerId === 'qq'));
        if (seeds.length < SIMILAR_A_READ) {
            try {
                add(songsIn(await orEmpty(requestQq<any>('user_daily_songs'), null)));
            } catch (error) {
                console.warn(`[QQ] Explore page: the daily songs to ask with could not be read (${errorMessage(error)})`);
            }
        }
        const taken = read.memory.handedOut.inTurn(SEEDS, seeds, seed => seed.id).slice(0, SIMILAR_A_READ);
        read.memory.handedOut.note(SEEDS, taken.map(seed => seed.id));
        return taken;
    };

    /** 和 `seed` 相似、又不在别栏里的歌做成一栏；太少或读不到就不出。 */
    const similarShelf = async (read: Read, seed: Seed): Promise<ProviderExploreSection | null> => {
        try {
            const found = songsIn(await orEmpty(requestQq<any>('song_similar', { id: Number(seed.id) }), null));
            const met = new Set([seed.id]);
            const songs = found.filter(song => {
                const id = String(song.id);
                if (met.has(id) || read.onShelf.has(id)) return false;
                met.add(id);
                return true;
            });
            if (songs.length < SIMILAR_MIN) {
                console.log(`[QQ] Explore songs like ${seed.id}: ${songs.length} on no other shelf, too few for a shelf`);
                return null;
            }
            songs.forEach(song => read.onShelf.add(String(song.id)));
            console.log(`[QQ] Explore songs like ${seed.id}: a shelf of ${songs.length} songs`);
            return {
                id: `qq-similar-${++shelvesMade}`,
                title: i18n.t('home.exploreSimilar', { name: seed.name }),
                items: songs.slice(0, BATCH).map(songItem),
                // 下一次读取问别的歌：它的栏接替这几栏的位置。
                changesWithRead: true,
            };
        } catch (error) {
            console.warn(`[QQ] Explore songs like ${seed.id} could not be read (${errorMessage(error)}); the page goes on without them`);
            return null;
        }
    };

    const toplistsOf = (read: Read): Promise<any[]> => {
        if (!read.toplists) {
            read.toplists = orEmpty(requestQq<any>('recommend_toplists'), null)
                .then(answer => listOf(answer?.groups).flatMap(group => listOf(group?.toplists)));
            // 失败的那次下回再要。
            read.toplists.catch(() => { read.toplists = undefined; });
        }
        return read.toplists;
    };

    const newPart = async (read: Read): Promise<ProviderExploreSection[]> => (await arrivedOf('the new songs and albums', [
        orEmpty(requestQq<any>('recommend_new_songs'), null)
            .then(answer => listShelf(read, NEW_SONGS_ID, i18n.t('home.qqNewSongs'), songsIn(answer).map(songItem))),
        pagedShelf(read, NEW_ALBUMS, i18n.t('home.qqNewAlbums')),
    ])).filter(present);

    const chartsPart = async (read: Read): Promise<ProviderExploreSection[]> => {
        const toplists = await toplistsOf(read);
        const cards = toplists.map(qqToplistCollection).filter(present)
            .map((collection): ProviderExploreItem => ({ kind: 'collection', collection }));
        const hot = toplists.find(toplist => toplist?.title === HOT_CHART_TITLE) ?? toplists[0];
        const hotId = Number(hot?.id);
        return (await arrivedOf('the charts', [
            Promise.resolve(listShelf(read, CHARTS_ID, i18n.t('home.qqCharts'), cards)),
            Number.isSafeInteger(hotId) && hotId > 0 ? pagedShelf(read, `${CHART}${hotId}`, String(hot.title)) : Promise.resolve(null),
        ])).filter(present);
    };

    const categoriesPart = async (read: Read): Promise<ProviderExploreSection[]> => {
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

    const radioPart = async (read: Read): Promise<ProviderExploreSection[]> => {
        if (!read.signedIn) return [];
        const answer = await orEmpty(requestQq<any>('radio_list'), null);
        const groups: RadioGroup[] = listOf(answer?.groups).map(group => ({
            id: String(group?.id ?? ''),
            name: typeof group?.title === 'string' ? group.title.trim() : '',
            radios: listOf(group?.radios)
                .filter(radio => Number(radio?.id) !== GUESS_YOU_LIKE_RADIO)
                .map(qqRadioCollection)
                .filter(present)
                .map((collection): ProviderExploreItem => ({ kind: 'collection', collection, isMix: true })),
        })).filter(group => group.id && group.name && !isListeningRecord(group.name) && group.radios.length > 0);
        const taken = read.memory.handedOut.inTurn(RADIO_GROUPS, groups, group => group.id).slice(0, RADIO_GROUPS_A_READ);
        read.memory.handedOut.note(RADIO_GROUPS, taken.map(group => group.id));
        return taken
            .map(group => listShelf(read, `qq-radio-${group.id}`, group.name, group.radios, `qq-radio-made-${++shelvesMade}`))
            .filter(present);
    };

    const PARTS = [newPart, chartsPart, categoriesPart, radioPart];

    // 从第 `from` 部分起，第一个有栏的部分。读不到的部分略过，失败记进 `failures`。
    const madeHere = async (read: Read, from: number, failures: unknown[] = []): Promise<ProviderExplorePage> => {
        for (let index = from; index < PARTS.length; index += 1) {
            let sections: ProviderExploreSection[] = [];
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

    const firstPage = async (listened: UnifiedSong[]): Promise<ProviderExplorePage> => {
        // 停用的会话（isQqSessionParked）请求不带，照游客读。
        const signedIn = hasUsableQqSession();
        if (hadAccount !== undefined && hadAccount !== signedIn) {
            memory = newMemory();
            console.log(`[QQ] Explore page: read ${signedIn ? 'for an account after a guest' : 'for a guest after an account'}; what the shelves handed out before is forgotten`);
        }
        hadAccount = signedIn;
        const read = newRead(++reads, memory, signedIn);
        const failures: unknown[] = [];
        const [radar, similar] = await Promise.allSettled([
            pagedShelf(read, RADAR, i18n.t('home.qqRadar')),
            signedIn
                ? seedsOf(read, listened).then(async seeds => (await Promise.all(seeds.map(seed => similarShelf(read, seed)))).filter(present))
                : Promise.resolve([]),
        ]);
        for (const answer of [radar, similar]) {
            if (answer.status !== 'rejected') continue;
            failures.push(answer.reason);
            console.warn(`[QQ] Explore page: part of the first page could not be read (${errorMessage(answer.reason)}); the page goes on without it`);
        }
        const sections = [
            radar.status === 'fulfilled' ? radar.value : null,
            ...(similar.status === 'fulfilled' ? similar.value : []),
        ].filter(present);
        page = read;
        console.log(`[QQ] Explore page: ${sections.length} shelves, ${countOf(sections)} entries; ${signedIn ? 'signed in' : 'a guest: no similar songs and no radio'}`);
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
        async getSectionItems(cursor): Promise<ProviderExploreItemsPage> {
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

export const qqExplore = createQqExplore();
