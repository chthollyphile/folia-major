import type { SongResult, UnifiedSong } from '../../types';
import type { ForeignSongQuery, OnlineMusicProvider } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { getOnlineMusicProvider, listOnlineMusicProviders } from './providerRegistry';
import { getSourceState } from './sourceStates';

// src/services/onlineMusic/songCounterparts.ts
// 「对应歌曲」：问一个音源「别家的这些歌，你有没有同一首」（songs@1.counterpartSources / getCounterparts）。
// 用在把平台歌单转存成 Folia 歌单、其中能精确对应的歌改由另一个音源播放。这里不认识任何具体的音源：
// 谁能答哪些来源由音源自己声明。
// - 被问的音源只拿到公开的东西：来源 id、歌在来源那边的 id 和公开 id、歌名、歌手名、专辑名、时长、封面。
//   原音源自己的数据（sourceRef.providerData）、账号、凭据都不给。
// - 只读、不联网的约定在音源那边；这里管批量、每次调用的时限和总时限。抛错、答得不成样子的那一批算「没有」；
//   有一批超时了就不再问（剩下的都算「没有」），不让一个不答的音源把人晾满总时限。
// - 云盘歌（sourceRef.variant）和歌以外的条目（itemKind）不问：它们的 id 不一定是平台上公开的那首歌。
// - 目标音源没注册（模组没装或没加载）、被停用或只用于匹配、没配好、或根本不答这件事时，
//   一首都不问，`unavailable` 写明是哪一种；歌全部算「没有」，调用方照原样保留。

/** 一次调用最多问多少首。 */
export const SONG_COUNTERPARTS_PER_CALL = 200;
/** 一次调用最多等多久（毫秒）。 */
export const SONG_COUNTERPARTS_CALL_TIMEOUT_MS = 10_000;
/** 一整批最多等多久（毫秒）；到点之后剩下的都算「没有」。 */
export const SONG_COUNTERPARTS_TOTAL_TIMEOUT_MS = 60_000;

export type SongCounterpartsUnavailable =
    /** 没有这个音源：模组没装、没启用，或还没加载完。 */
    | 'not-registered'
    /** 音源被停用，或只用于匹配：它的歌现在不能播，换过去没有意义。 */
    | 'switched-off'
    /** 音源说自己还没配好。 */
    | 'not-configured'
    /** 音源不答这件事（没有 getCounterparts，或没声明任何来源）。 */
    | 'unsupported';

export interface SongCounterpartsAnswer {
    /** 和传入的歌一一对应：目标音源自己的那首，没有就是 null。 */
    songs: (UnifiedSong | null)[];
    /** 一首都没问的原因；问了就没有这一项。 */
    unavailable?: SongCounterpartsUnavailable;
    /** 实际拿去问的歌数（来源在目标音源声明的范围里的）。 */
    asked: number;
    /** 因为超时、抛错而整批算「没有」的歌数。 */
    failed: number;
}

export interface SongCounterpartsDeps {
    getProvider(sourceId: string): Pick<OnlineMusicProvider, 'id' | 'getAvailability' | 'playback'> | null | undefined;
    isSwitchedOn(sourceId: string): boolean;
    now(): number;
    perCall: number;
    callTimeoutMs: number;
    totalTimeoutMs: number;
}

const defaultDeps: SongCounterpartsDeps = {
    getProvider: sourceId => getOnlineMusicProvider(sourceId),
    isSwitchedOn: sourceId => getSourceState(sourceId) === 'enabled',
    now: () => Date.now(),
    perCall: SONG_COUNTERPARTS_PER_CALL,
    callTimeoutMs: SONG_COUNTERPARTS_CALL_TIMEOUT_MS,
    totalTimeoutMs: SONG_COUNTERPARTS_TOTAL_TIMEOUT_MS,
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** 一首在线歌给别的音源看的样子；不是在线歌（本地、Navidrome、舞台）回 null。 */
export const toForeignSongQuery = (song: SongResult): ForeignSongQuery | null => {
    const ref = getPlaybackSourceRef(song);
    if (ref.kind !== 'online' || !ref.mediaId || ref.variant || song.itemKind) return null;
    const id = ref.mediaId;
    const publicId = String(song.id);
    // 存下来的旧歌可能缺字段：缺了就当空的，不让一首坏的挡住一整张歌单。
    const loose = song as { album?: { name?: unknown; coverUrl?: unknown } | null; artists?: unknown };
    const album = text(loose.album?.name);
    const coverUrl = text(loose.album?.coverUrl);
    const durationMs = Number.isFinite(song.durationMs) && song.durationMs > 0 ? song.durationMs : 0;
    const artists: unknown[] = Array.isArray(loose.artists) ? loose.artists : [];
    return {
        sourceId: ref.providerId,
        id,
        ...(publicId && publicId !== id ? { publicId } : {}),
        title: text(song.name),
        artists: artists.map(artist => text((artist as { name?: unknown } | null)?.name)).filter(Boolean),
        ...(album ? { album } : {}),
        ...(durationMs ? { durationMs } : {}),
        ...(coverUrl ? { coverUrl } : {}),
    };
};

class CounterpartsTimeout extends Error {}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CounterpartsTimeout('timed out')), ms);
    work.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
});

// 音源声明的来源；它的 getter 抛错当成没声明（不让一个坏音源弄坏别人的列表）。
const declaredSources = (provider: Pick<OnlineMusicProvider, 'playback'>): readonly string[] => {
    try {
        return provider.playback?.counterpartSources ?? [];
    } catch (error) {
        console.warn('[SongCounterparts] Reading counterpartSources threw', error);
        return [];
    }
};

/** 目标音源现在能不能答、答哪些来源。 */
export const getSongCounterpartSources = (
    targetSourceId: string,
    deps: Pick<SongCounterpartsDeps, 'getProvider' | 'isSwitchedOn'> = defaultDeps,
): { sources: readonly string[]; unavailable?: SongCounterpartsUnavailable } => {
    const provider = deps.getProvider(targetSourceId);
    if (!provider) return { sources: [], unavailable: 'not-registered' };
    if (!deps.isSwitchedOn(targetSourceId)) return { sources: [], unavailable: 'switched-off' };
    if (!provider.playback?.getCounterparts) return { sources: [], unavailable: 'unsupported' };
    const sources = declaredSources(provider).filter(sourceId => sourceId !== targetSourceId);
    // 先看配没配好：没配好的音源往往也说不出能答哪些来源，原因该是「没配好」。
    if (provider.getAvailability && !provider.getAvailability().configured) return { sources: [], unavailable: 'not-configured' };
    if (sources.length === 0) return { sources: [], unavailable: 'unsupported' };
    return { sources };
};

/**
 * 哪些音源能替 `originSourceId` 的歌答「对应歌曲」（界面上「改由某个音源播放」能选的）。停用、只用于匹配、
 * 不答这件事的不列；没配好的列出来并写明原因（界面可以提示去配）。
 */
export const listSongCounterpartTargets = (
    originSourceId: string,
    deps: Pick<SongCounterpartsDeps, 'getProvider' | 'isSwitchedOn'> & { listSourceIds(): string[] } = {
        ...defaultDeps,
        listSourceIds: () => listOnlineMusicProviders().map(provider => provider.id),
    },
): Array<{ sourceId: string; unavailable?: SongCounterpartsUnavailable }> => deps.listSourceIds().flatMap((sourceId) => {
    if (sourceId === originSourceId || !deps.isSwitchedOn(sourceId)) return [];
    const provider = deps.getProvider(sourceId);
    if (!provider?.playback?.getCounterparts || !declaredSources(provider).includes(originSourceId)) return [];
    const { unavailable } = getSongCounterpartSources(sourceId, deps);
    return [{ sourceId, ...(unavailable ? { unavailable } : {}) }];
});

/**
 * 问 `targetSourceId`：这些歌你有没有对应的。答案和 `songs` 一一对应。
 * 一首歌只有在它是在线歌、来源在目标音源声明的范围里、且不是目标音源自己的歌时才会被拿去问；答回来的必须是
 * 目标音源自己的歌（别的一律当成没有）。
 */
export const resolveSongCounterparts = async (
    targetSourceId: string,
    songs: readonly SongResult[],
    overrides: Partial<SongCounterpartsDeps> = {},
): Promise<SongCounterpartsAnswer> => {
    const deps = { ...defaultDeps, ...overrides };
    const answer: (UnifiedSong | null)[] = songs.map(() => null);
    const { sources, unavailable } = getSongCounterpartSources(targetSourceId, deps);
    if (unavailable) return { songs: answer, unavailable, asked: 0, failed: 0 };
    const playback = deps.getProvider(targetSourceId)?.playback;
    if (!playback?.getCounterparts) return { songs: answer, unavailable: 'unsupported', asked: 0, failed: 0 };

    const allowed = new Set(sources);
    const pending: Array<{ index: number; query: ForeignSongQuery }> = [];
    songs.forEach((song, index) => {
        const query = toForeignSongQuery(song);
        if (query && allowed.has(query.sourceId)) pending.push({ index, query });
    });

    const perCall = Math.max(1, Math.floor(deps.perCall));
    const deadline = deps.now() + deps.totalTimeoutMs;
    let failed = 0;
    for (let start = 0; start < pending.length; start += perCall) {
        const batch = pending.slice(start, start + perCall);
        const remaining = deadline - deps.now();
        if (remaining <= 0) {
            failed += pending.length - start;
            break;
        }
        try {
            const found = await withTimeout(playback.getCounterparts(batch.map(item => item.query)), Math.min(deps.callTimeoutMs, remaining));
            batch.forEach((item, offset) => {
                const song = Array.isArray(found) ? found[offset] : null;
                const ref = song ? getPlaybackSourceRef(song) : null;
                // 只收目标音源自己的歌：别的来源的歌、没有 id 的东西都不算。
                if (song && ref && ref.kind === 'online' && ref.providerId === targetSourceId && ref.mediaId) answer[item.index] = song;
            });
        } catch (error) {
            console.warn(`[SongCounterparts] "${targetSourceId}" did not answer a batch of ${batch.length}:`, error);
            if (error instanceof CounterpartsTimeout) {
                failed += pending.length - start;
                break;
            }
            failed += batch.length;
        }
    }
    return { songs: answer, asked: pending.length, failed };
};
