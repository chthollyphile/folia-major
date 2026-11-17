import { shuffledCopy } from '../../../../utils/shuffledCopy';

// src/components/app/playback/shuffle/shuffleRound.ts
// 「一轮不重复」的洗牌规则（纯函数）。开关打开时，打乱队列、合集与歌手页的随机播放都按轮洗：一轮里听过的歌排到
// 没听过的后面，整轮都听过了就清零重来。「这一轮」认的是一队歌本身：洗的时候记下这队歌的集合（指纹）和洗出来的
// 顺序（顺序的哈希），之后只有队列还是这个顺序时才接着记听过哪些（见 useShuffleRoundTracking）；同一批歌再洗一次
// （再点一次随机播放同一个歌单）就接着上一轮。

/** 记着的那一轮：哪批歌（指纹）、洗出来的顺序（哈希）、这一轮已经听过的（playback key）。 */
export type ShuffleRoundState = {
    fingerprint: string;
    orderHash: string;
    played: string[];
};

const FNV_OFFSET = 0x811c9dc5;
const fnv = (hash: number, key: string): number => {
    let next = hash;
    for (let index = 0; index < key.length; index += 1) next = Math.imul(next ^ key.charCodeAt(index), 0x01000193);
    // 分隔符：["ab", "c"] 与 ["a", "bc"] 不撞。
    return Math.imul(next ^ 0xff, 0x01000193);
};
const hashKeys = (keys: readonly string[]): string => `${keys.length}:${(keys.reduce(fnv, FNV_OFFSET) >>> 0).toString(16)}`;

/** 一批歌的指纹：与顺序无关，歌多一首、少一首、换一首都会变。 */
export const queueFingerprint = (keys: readonly string[]): string => hashKeys([...keys].sort());

/** 一队歌的顺序哈希：同一批歌换了顺序也会变。存它而不是整份顺序，免得长队列每次切歌都写一大串。 */
export const queueOrderHash = (keys: readonly string[]): string => hashKeys(keys);

/** 这队歌是不是记着的那一轮洗出来的、而且还是洗出来的顺序（拖动、增删过就不再算，等下一次洗）。 */
export const isRoundQueue = (state: ShuffleRoundState | null, keys: readonly string[]): state is ShuffleRoundState => (
    state !== null && state.orderHash === queueOrderHash(keys)
);

/**
 * 按轮洗一队歌。`pinnedIndex` 那一首（正在播的）钉在最前、算作已听；没有就传 -1（合集的随机播放：新队列从
 * 随机的一首开始）。同一批歌接着 `state` 那一轮，没听过的洗在前、听过的洗在后；整轮都听过（或换了一批歌）就从
 * 新的一轮开始，全部均匀洗。「整轮」只算 `counts` 说算的歌（能播的；播不了的永远轮不到，不能拦住一轮）。
 */
export const shuffleForRound = <T>({
    songs,
    keyOf,
    pinnedIndex,
    state,
    counts = () => true,
    random = Math.random,
}: {
    songs: readonly T[];
    keyOf: (song: T) => string;
    pinnedIndex: number;
    state: ShuffleRoundState | null;
    counts?: (song: T) => boolean;
    random?: () => number;
}): { queue: T[]; state: ShuffleRoundState; newRound: boolean } => {
    const keys = songs.map(keyOf);
    const fingerprint = queueFingerprint(keys);
    const pinned = pinnedIndex >= 0 && pinnedIndex < songs.length ? songs[pinnedIndex] : null;
    const pinnedKey = pinned === null ? null : keys[pinnedIndex];
    const played = new Set(state?.fingerprint === fingerprint ? state.played : []);
    if (pinnedKey !== null) played.add(pinnedKey);
    const rest = songs.filter((_, index) => index !== pinnedIndex);

    const counted = songs.filter(counts).map(keyOf);
    const newRound = counted.length > 0 && counted.every(key => played.has(key));
    let ordered: T[];
    if (newRound) {
        played.clear();
        if (pinnedKey !== null) played.add(pinnedKey);
        ordered = shuffledCopy(rest, random);
    } else {
        const fresh = rest.filter(song => !played.has(keyOf(song)));
        const heard = rest.filter(song => played.has(keyOf(song)));
        ordered = [...shuffledCopy(fresh, random), ...shuffledCopy(heard, random)];
    }
    const queue = pinned === null ? ordered : [pinned, ...ordered];
    return {
        queue,
        state: { fingerprint, orderHash: queueOrderHash(queue.map(keyOf)), played: keys.filter(key => played.has(key)) },
        newRound,
    };
};

/**
 * 切歌时这一轮该做什么：不是记着的那一队（或这首不在队里）就什么都不做；记下这首听过了，能播的都听过了且是列表
 * 循环，就整队重洗；否则只在有变化时写回。`countedKeys` 是这队里能播的歌。除了正在播的这首再没有能播的歌时不重洗：
 * 重洗出的新一轮也只有这首算听过，一洗完又是「整轮听完」，会无限重洗下去。
 */
export const decideRoundStep = ({
    state,
    keys,
    currentKey,
    countedKeys,
    loopMode,
}: {
    state: ShuffleRoundState | null;
    keys: readonly string[];
    currentKey: string;
    countedKeys: readonly string[];
    loopMode: 'off' | 'all' | 'one';
}): { kind: 'none' } | { kind: 'write'; state: ShuffleRoundState } | { kind: 'reshuffle' } => {
    if (!isRoundQueue(state, keys) || !keys.includes(currentKey)) return { kind: 'none' };
    const played = state.played.includes(currentKey) ? state.played : [...state.played, currentKey];
    const heard = new Set(played);
    const complete = countedKeys.length > 0 && countedKeys.every(key => heard.has(key));
    const othersCounted = countedKeys.some(key => key !== currentKey);
    if (complete && loopMode === 'all' && othersCounted) return { kind: 'reshuffle' };
    return played === state.played ? { kind: 'none' } : { kind: 'write', state: { ...state, played } };
};
