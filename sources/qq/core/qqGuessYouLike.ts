import type { FoliumSourceCollection, FoliumSourceFmCatalog, FoliumSourceSong } from '@folia/folium';
import { personalFmModes } from '@folia/folium-source-kit';
import { isQqError, qqText, qqTextKey } from './qqEnv';
import { normalizeQqSong } from './qqNormalize';
import { hasUsableQqSession, requestQq } from './qqTransport';

// sources/qq/core/qqGuessYouLike.ts
// 猜你喜欢（QQ 的电台 99）作为 QQ 的额外电台（station）：电台页多一张卡，点了开 FM；FM 模式选择器在它播的时候
// 换成它自己的「听歌模式」。手机上排的探索、默认、熟悉对上同名的模式，下面那一格（R&B、助眠、动感 DJ……）当场景，
// 场景的 id 就是模式的 poolId。取歌只带 poolId，不写账号的模式设置；模式选择只在内存里，换台、FM 结束、重开都回默认。
// 默认（或认不出的模式）读 `/user/guess-you-like` 的默认一批。

export const QQ_GUESS_YOU_LIKE_STATION = 'guess-you-like';

const FAMILIAR_NAME = '熟悉';
const EXPLORE_NAME = '探索';
const OTHER_CATEGORY = 'qq-other';
const SUGGESTED_CATEGORY = 'qq-suggested';
// 场景照默认私人 FM 目录的样子分成情绪、场景、曲风、语种几行，名字对不上的放「其他」；同一行里还是手机给的顺序。
// 名字取自手机上的那一格，比对时不分大小写、不看空格。行名是模组自己的文字（fm.category.*）。
const SCENE_ROWS: { id: string; names: string[] }[] = [
    { id: 'mood', names: ['深夜emo', '放松', '提神'] },
    { id: 'activity', names: ['宅家', '助眠', '暴汗时刻', '专注', '放假', '散步', '旅行', '起床', '通勤'] },
    { id: 'genre', names: ['动感DJ', 'R&B', 'Kpop', 'Lo-fi音乐', '年代金曲', 'AI尝鲜'] },
    { id: 'language', names: ['粤语'] },
];
const OTHER_ROW = { id: OTHER_CATEGORY };
const SUGGESTED_ROW = { id: SUGGESTED_CATEGORY };
// The texts of a row: the four shared ones, and the station's own two.
const ROW_TEXTS: Readonly<Record<string, string>> = {
    mood: 'fm.category.mood',
    activity: 'fm.category.activity',
    genre: 'fm.category.genre',
    language: 'fm.category.language',
    [OTHER_CATEGORY]: 'guessYouLike.other',
    [SUGGESTED_CATEGORY]: 'guessYouLike.suggested',
};
type QqFmMode = 'DEFAULT' | 'FAMILIAR' | 'EXPLORE' | 'SCENE_RCMD';
const modesOf = (ids: readonly QqFmMode[]) => personalFmModes(ids, id => qqTextKey(`fm.mode.${id}`));
const sceneKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '');
const ROW_OF_SCENE = new Map(SCENE_ROWS.flatMap(row => row.names.map(name => [sceneKey(name), row.id] as const)));
// 目录里的名字可能带「模式」（「探索模式」），比对时去掉。
const modeNameOf = (entry: any): string => (typeof entry?.name === 'string' ? entry.name.trim().replace(/模式$/, '') : '');
const CATALOG_TTL_MS = 10 * 60_000;

interface QqStationPools { familiar?: string; explore?: string }
interface QqStationCatalog { catalog: FoliumSourceFmCatalog; pools: QqStationPools; cover?: string }

// 模式选择器和命令面板的标签用电台自己的名字：「猜你喜欢模式」。
const stationName = () => qqTextKey('guessYouLike.name');

/** 只有默认一种模式：读不到目录（旧后端、读失败）时电台照样能放默认的一批。 */
const defaultOnly = (): QqStationCatalog => ({
    catalog: { name: stationName(), modes: modesOf(['DEFAULT']), scenes: [], categories: [] },
    pools: {},
});

let catalogTask: Promise<QqStationCatalog> | null = null;
let catalogAt = 0;
// 为卡片封面读的那一批默认歌：猜你喜欢是动态推荐，封面用它第一首的图；点卡片开播（默认模式）时先放这一批，
// 不白白多耗一批。只留几分钟，过了就不用。
const COVER_BATCH_TTL_MS = 5 * 60_000;
let coverBatch: { songs: FoliumSourceSong[]; at: number } | null = null;
// 清掉的次数：清掉之前就在路上的封面那一批，回来时不再记下（不让上一个账号的歌留给下一个账号）。
let generation = 0;

/** 换账号、登出时清掉：模式目录和封面那一批都跟着账号。 */
export const clearQqGuessYouLikeCatalog = (): void => {
    generation += 1;
    catalogTask = null;
    catalogAt = 0;
    coverBatch = null;
};

const listOf = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const poolOf = (entry: any): string | null => {
    const pool = Number(entry?.poolId);
    return Number.isSafeInteger(pool) && pool > 0 ? String(pool) : null;
};

const readCatalog = async (): Promise<QqStationCatalog> => {
    const answer = await requestQq<any>('user_guess_you_like_modes');
    const pools: QqStationPools = {};
    let cover: string | undefined;
    let defaultCover: string | undefined;
    // 上排先认：熟悉、探索变成同名模式，它们的 pool 不再在场景里出现第二次（推荐那一格常常就是它们）。
    const seen = new Set<string>();
    for (const entry of listOf(answer?.primaryModes)) {
        const name = modeNameOf(entry);
        const pool = poolOf(entry);
        if (!cover && typeof entry?.cover === 'string' && entry.cover) cover = entry.cover;
        if (!defaultCover && name === '默认' && typeof entry?.cover === 'string' && entry.cover) defaultCover = entry.cover;
        if (!pool) continue;
        if (name === FAMILIAR_NAME && !pools.familiar) { pools.familiar = pool; seen.add(pool); }
        else if (name === EXPLORE_NAME && !pools.explore) { pools.explore = pool; seen.add(pool); }
    }
    const others = listOf(answer?.primaryModes).filter(entry => ![FAMILIAR_NAME, EXPLORE_NAME, '默认'].includes(modeNameOf(entry)));
    // 场景按名字分行（上排其余的模式也算场景）；手机给的建议另排一行，和场景重复的不再出现，去完是空的就没有这一行。
    const scenes: FoliumSourceFmCatalog['scenes'] = [];
    const add = (entries: any[], categoryOf: (name: string) => string) => {
        for (const entry of entries) {
            const pool = poolOf(entry);
            const name = modeNameOf(entry);
            if (!pool || !name || seen.has(pool)) continue;
            seen.add(pool);
            scenes.push({ id: pool, category: categoryOf(name), label: name, keywords: [name, pool] });
        }
    };
    add([...listOf(answer?.scenes), ...others], name => ROW_OF_SCENE.get(sceneKey(name)) ?? OTHER_CATEGORY);
    add(listOf(answer?.recommended), () => SUGGESTED_CATEGORY);
    const rows = [...SCENE_ROWS, OTHER_ROW, SUGGESTED_ROW].filter(row => scenes.some(scene => scene.category === row.id));
    // 选择器按目录里场景的先后排；先按行排好，同一行里保持原来的顺序。
    scenes.sort((a, b) => rows.findIndex(row => row.id === a.category) - rows.findIndex(row => row.id === b.category));
    const modes = modesOf([
        'DEFAULT',
        ...(pools.familiar ? ['FAMILIAR' as const] : []),
        ...(pools.explore ? ['EXPLORE' as const] : []),
        ...(scenes.length > 0 ? ['SCENE_RCMD' as const] : []),
    ]);
    console.info(`[QQProvider] guess-you-like-modes:read ${modes.length} modes, ${scenes.length} scenes`);
    return {
        catalog: {
            name: stationName(),
            modes,
            categories: rows.map(({ id }) => ({ id, label: qqTextKey(ROW_TEXTS[id]) })),
            scenes,
        },
        pools,
        ...(defaultCover || cover ? { cover: defaultCover || cover } : {}),
    };
};

/** 模式目录，十分钟内共用一份。读不到就只有默认：电台照样能放，只是不能换模式。 */
const stationCatalog = (): Promise<QqStationCatalog> => {
    if (!catalogTask || Date.now() - catalogAt > CATALOG_TTL_MS) {
        catalogAt = Date.now();
        const task = readCatalog().catch(error => {
            if (!isQqError(error, 'unsupported')) {
                console.warn('[QQProvider] guess-you-like-modes:failed', error);
            }
            // 失败的不留着：下一次再读。
            if (catalogTask === task) catalogTask = null;
            return defaultOnly();
        });
        catalogTask = task;
    }
    return catalogTask;
};

export const getQqGuessYouLikeCatalog = async (): Promise<FoliumSourceFmCatalog> => (await stationCatalog()).catalog;

/** What getPersonalFm is asked with. */
export interface QqFmRequest { mode?: string; submode?: string | null; station?: string | null }

/** 选中的模式对应哪个 poolId；默认、认不出或目录读不到时是 null，读默认的一批。 */
const poolOfSelection = async (selected: QqFmRequest): Promise<string | null> => {
    if (selected.mode === 'SCENE_RCMD') {
        const scene = String(selected.submode ?? '');
        return /^[1-9]\d{0,9}$/.test(scene) ? scene : null;
    }
    if (selected.mode !== 'FAMILIAR' && selected.mode !== 'EXPLORE') return null;
    const { pools } = await stationCatalog();
    return (selected.mode === 'FAMILIAR' ? pools.familiar : pools.explore) ?? null;
};

const songsOf = (response: any): FoliumSourceSong[] => (Array.isArray(response?.songs) ? response.songs : [])
    .map(normalizeQqSong)
    .filter((song: FoliumSourceSong) => Boolean(song.lyricIds?.qq));

/**
 * 这个电台的一批：选了模式按 poolId 取。按模式取不到（后端没有这条路由、这个 pool 没给歌、请求失败）都退回默认的
 * 一批：场景的 poolId 是先前从目录记下的，目录或 pool 后来读不到时，电台照样接着放，不变成没歌。
 */
export const getQqGuessYouLikeBatch = async (selected: QqFmRequest): Promise<FoliumSourceSong[]> => {
    if (!hasUsableQqSession()) return [];
    const pool = await poolOfSelection(selected);
    if (!pool && coverBatch && Date.now() - coverBatch.at < COVER_BATCH_TTL_MS) {
        const kept = coverBatch.songs;
        coverBatch = null;
        return kept;
    }
    if (pool) {
        try {
            const songs = songsOf(await requestQq<any>('user_guess_you_like_tracks', { pool }));
            if (songs.length > 0) return songs;
            console.info('[QQProvider] guess-you-like-pool:empty, default batch');
        } catch (error) {
            if (!isQqError(error, 'unsupported')) {
                console.warn('[QQProvider] guess-you-like-pool:failed, default batch', error);
            }
        }
    }
    return songsOf(await requestQq<any>('user_guess_you_like'));
};

/**
 * 电台页上这个电台的卡片：登录了才有。猜你喜欢是动态推荐，封面用默认一批第一首的图（这一批留给开播用），
 * 读不到歌才借默认模式的图。
 */
export const getQqGuessYouLikeCard = async (): Promise<FoliumSourceCollection | null> => {
    if (!hasUsableQqSession()) return null;
    const mine = generation;
    const songs = await requestQq<any>('user_guess_you_like').then(songsOf).catch(error => {
        console.warn('[QQProvider] guess-you-like-cover:failed', error);
        return [] as FoliumSourceSong[];
    });
    if (songs.length > 0 && mine === generation) coverBatch = { songs, at: Date.now() };
    const cover = songs.find(song => song.album?.coverUrl)?.album?.coverUrl
        || (mine === generation ? (await stationCatalog()).cover : undefined);
    return {
        id: `station-${QQ_GUESS_YOU_LIKE_STATION}`,
        type: 'radio',
        name: qqText('guessYouLike.name'),
        description: qqText('guessYouLike.description'),
        ...(cover ? { coverUrl: cover } : {}),
        personalFm: { mode: 'DEFAULT', scene: null, station: QQ_GUESS_YOU_LIKE_STATION },
    };
};
