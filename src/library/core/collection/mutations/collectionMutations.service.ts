import type { SongResult, UnifiedSong } from '../../../../types';
import type {
    DailyStyleGroup,
    DailyStyleSelection,
    OmniCollection,
    OmniProviderId,
    ProviderCapabilities,
} from '../../../../types/onlineMusic';
import type {
    CollectionMutationBranches,
    CollectionMutationCapabilities,
    CollectionMutationController,
    CollectionMutationInputs,
    CollectionMutationSnapshot,
    LibraryEntryRef,
    LibraryMutationFailureReason,
    LibraryMutationResult,
} from './mutations.contract';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { buildDuplicateOccurrences, entryKeyAt, findEntryIndex } from '../collectionEntries';
import {
    isSerializedRemoval,
    localPlaylistSongIdOf,
    localSongIdOf,
    resolveCollectionMutationBranches,
    resolveCollectionMutationCapabilities,
    resolveEntryRemovalKind,
    type CollectionEntryRemovalKind,
} from './collectionMutationCapabilities';
import { getProviderCacheKey } from '../../../../services/onlineMusic/providerStorage';
import { isCloudDriveCollection } from '../collectionIdentity';
import { supportsLocalCollectionCover } from '../cover/localCollectionCover';
import { errorMessage } from '../../../../utils/errorText';
import {
    askCollectionSaved,
    collectionSaveKey,
    collectionSaveMark,
    collectionSaveReadIsCurrent,
    collectionSaveUnderWay,
    watchCollectionSaves,
} from './collectionSaves.service';

// src/library/core/collection/mutations/collectionMutations.service.ts
// 集合的变更动作层：删条目、订阅、改名、删除集合、重扫、导出、加入 / 新建 Navidrome 歌单、
// 编辑实体、整理、匹配、每日推荐换日期与风格推荐。规则搬自 GridView，归属从网格实例挪到「集合会话」上：
// - 一个集合会话一个控制器，宿主持有、renderer 订阅；换 renderer 不丢进行中的状态；
// - 上游确认之后才改资源（权威提交，立即以 urgent 通知），动画只是 renderer 自己的事；
// - 同一条目 / 同一动作进行中再次提交返回 busy，只发一次请求；收藏（订阅）例外：星星一按就变，请求在后台发，
//   请求期间再按只改「要的」，请求跟着它走（core/collection/mutations/collectionSaves.service，按集合记，比控制器活得久）；
// - dispose 之后控制器的状态冻结、不再通知；已发出的上游请求照常完成，确认后的删除仍交给资源
//   （在线资源可能留在 LRU 里，重进时被复用，必须与上游一致；已销毁的资源没有订阅者，写入无副作用）。

/** 控制器用到的 omni 子集；单测注入假的，应用里由 collectionMutationDeps 装配。 */
export type CollectionMutationOmni = {
    canEditCollectionTracks(collection: OmniCollection): boolean;
    canSubscribeCollection(collection: OmniCollection): boolean;
    canDislikeCollectionSongs(collection: OmniCollection): boolean;
    getSubscriptionStatus(collection: OmniCollection): Promise<boolean>;
    subscribe(collection: OmniCollection, subscribed: boolean): Promise<void>;
    likeSong(song: SongResult, liked: boolean): Promise<void>;
    updateCollectionTracks(collection: OmniCollection, operation: 'add' | 'del', tracks: SongResult[]): Promise<void>;
    dislikeSong(song: SongResult): Promise<{ replacement?: SongResult; limitReached?: boolean }>;
    getRecommendationHistoryDates(): Promise<string[]>;
    getRecommendationHistorySongs(date: string): Promise<SongResult[]>;
    getDailySongs(refresh?: boolean): Promise<SongResult[]>;
    /** 风格推荐（#938）的三样；替身不给时没有风格推荐。 */
    getDailyStyleGroups?(): Promise<DailyStyleGroup[]>;
    getDailyStyleSongs?(): Promise<{ songs: SongResult[]; selection: DailyStyleSelection | null }>;
    setDailyStyle?(selection: DailyStyleSelection): Promise<void>;
    /**
     * 平台的能力（这里只看每日推荐有没有历史日期 historyRecommendations、有没有风格推荐 dailyStyleRecommendations）。
     * 单测的替身可以不给：那时历史日期当作有，风格推荐当作没有。
     */
    getProviderCapabilities?(providerId: OmniProviderId): Pick<ProviderCapabilities, 'historyRecommendations' | 'dailyStyleRecommendations'>;
};

/**
 * 每日推荐上次看的是哪一种（#938，core/collection/useDailyRecommendationModeStore）。资源按它加载，控制器按它定
 * 开始时是不是风格推荐；切换成功后写回。styleSelection 是资源加载的风格推荐答复说的风格。
 */
export type DailyRecommendationModePort = {
    read(): { prefersStyle: boolean; styleSelection: DailyStyleSelection | null };
    setPrefersStyle(prefersStyle: boolean): void;
    /** 控制器换成功的风格推荐是哪些风格（下一个控制器起步时用）。 */
    noteStyleSelection(selection: DailyStyleSelection | null): void;
    subscribe(listener: () => void): () => void;
};

export type CollectionMutationDeps = {
    omni: CollectionMutationOmni;
    /** 删一条应用缓存（在线歌单删歌后作废 `playlist_detail_${id}`）。 */
    removeCacheEntry: (key: string) => Promise<void>;
    /** 单测可以不给：那时每日推荐总是从默认推荐开始，也不记。 */
    dailyMode?: DailyRecommendationModePort;
};

export type CollectionMutationControllerOptions = CollectionMutationInputs & CollectionMutationDeps;

const OK: LibraryMutationResult = { ok: true };
const fail = (reason: LibraryMutationFailureReason, message?: string): LibraryMutationResult => (
    message === undefined ? { ok: false, reason } : { ok: false, reason, message }
);
const failed = (error: unknown) => fail('failed', errorMessage(error));

/** 资源当前曲目里这个条目的原始下标（重复序号按 collectionEntries 的规则）；不在了返回 -1。 */
const resolveRawIndex = (tracks: readonly SongResult[], entryKey: string): number => (
    findEntryIndex(tracks, buildDuplicateOccurrences(tracks as SongResult[], null).occurrences, entryKey)
);
const entryKeyAtRawIndex = (tracks: readonly SongResult[], index: number): string | null => (
    entryKeyAt(tracks, buildDuplicateOccurrences(tracks as SongResult[], null).occurrences, index)
);

/** 跟随的善后（刷新曲库、刷新账户、作废缓存）失败不影响结果：上游已经改了。 */
const followUp = (label: string, run: () => Promise<void> | void) => {
    try {
        void Promise.resolve(run()).catch(error => console.warn(`[LibraryUi] ${label} failed:`, error));
    } catch (error) {
        console.warn(`[LibraryUi] ${label} failed:`, error);
    }
};

const sameShallow = <T extends object>(left: T, right: T) => {
    const keys = Object.keys(left) as Array<keyof T>;
    return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
};
const sameList = (left: readonly unknown[], right: readonly unknown[]) => (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
);
const sameCapabilities = (left: CollectionMutationCapabilities, right: CollectionMutationCapabilities) => (
    (Object.keys(left) as Array<keyof CollectionMutationCapabilities>).every(key => sameShallow(left[key], right[key]))
);

export const createCollectionMutationController = (
    options: CollectionMutationControllerOptions,
): CollectionMutationController => {
    const { omni, removeCacheEntry, dailyMode } = options;
    let inputs: CollectionMutationInputs = {
        descriptor: options.descriptor,
        resource: options.resource,
        port: options.port,
        currentUserId: options.currentUserId,
    };
    let disposed = false;
    const listeners = new Set<() => void>();

    /** 平台上一次确认（或答复）的收藏状态；星星显示的是进行中的请求要的那个（collectionSaveUnderWay），没有请求时是它。 */
    let subscribed: boolean | null = null;
    let subscriptionRequested = false;
    let historyRequested = false;
    let dailyHistoryDates: readonly string[] = [];
    let dailyDate = '';
    let dailyDatePending = false;
    let dailyStyleShown = false;
    let stopWatchingDailyMode: (() => void) | null = null;
    let dailyStyleGroupsPrefetched = false;
    let dailyStyleGroups: readonly DailyStyleGroup[] = [];
    let dailyStyleGroupsRequested = false;
    let dailyStyleGroupsFailed = false;
    let dailyStyleSelection: DailyStyleSelection | null = null;
    let dailyLimitReached = false;
    let sourceActionPending = false;
    /**
     * 改名成功之后、宿主的描述还没跟上之前的新名字。描述本身不改（它可能是导航栈里共用的对象）；
     * 宿主的描述一旦变了（刷新带回新名字，或者别处改了名），以宿主为准，这条记录作废。
     */
    let renamed: { from: string; to: string } | null = null;
    /** 进行中的删除：条目键 → 去重范围（同一首歌 / 整个集合）。 */
    const pendingRemovals = new Map<string, string>();

    const resolveBranches = (): CollectionMutationBranches => {
        const { descriptor, resource, port, currentUserId } = inputs;
        const online = descriptor.source === 'online' ? descriptor : null;
        return resolveCollectionMutationBranches({
            descriptor,
            resourceKind: resource?.kind ?? null,
            currentUserId,
            canEditCollectionTracks: online ? omni.canEditCollectionTracks(online) : false,
            canSubscribeCollection: online ? omni.canSubscribeCollection(online) : false,
            canDislikeCollectionSongs: online ? omni.canDislikeCollectionSongs(online) : false,
            isCloudDrive: isCloudDriveCollection(descriptor),
            dailyDate,
            dailyStyleShown,
            port,
        });
    };

    const currentRename = () => (renamed && inputs.descriptor.name === renamed.from ? renamed.to : null);

    /** 这个集合在收藏请求登记处的键（只有在线集合有）。 */
    const saveKey = () => (inputs.descriptor.source === 'online' ? collectionSaveKey(inputs.descriptor) : null);
    /** 每日推荐有没有历史日期可看：平台说了才算；单测的替身不说时当作有（与原来一样）。 */
    const historyAvailable = () => {
        const { descriptor } = inputs;
        if (descriptor.source !== 'online' || descriptor.type !== 'daily_recommendations') return false;
        const capabilities = omni.getProviderCapabilities?.(descriptor.providerId);
        return capabilities ? capabilities.historyRecommendations === true : true;
    };
    /** 每日推荐有没有风格推荐：平台说了、omni 也有这几样才算。 */
    const styleAvailable = () => {
        const { descriptor } = inputs;
        if (descriptor.source !== 'online' || descriptor.type !== 'daily_recommendations') return false;
        if (!omni.getDailyStyleSongs || !omni.setDailyStyle) return false;
        return omni.getProviderCapabilities?.(descriptor.providerId)?.dailyStyleRecommendations === true;
    };
    // 每日推荐的资源按上次看的那种加载（dailyRecommendationLoad.service），控制器从同一处起步。
    dailyStyleShown = Boolean(dailyMode?.read().prefersStyle) && styleAvailable();
    /** 正在看的风格：控制器自己换来的为准；开始时那份是资源加载的，风格记在 dailyMode 里。 */
    const currentStyleSelection = () => (
        dailyStyleSelection ?? (dailyStyleShown ? dailyMode?.read().styleSelection ?? null : null)
    );

    const compute = (previous: CollectionMutationSnapshot | null): CollectionMutationSnapshot => {
        const branches = resolveBranches();
        const capabilities = resolveCollectionMutationCapabilities({
            descriptor: inputs.descriptor,
            branches,
            port: inputs.port,
            state: {
                hasResource: Boolean(inputs.resource),
                pendingRemovalCount: pendingRemovals.size,
                subscribing: false,
                sourceActionPending,
                dailyLimitReached,
                dailyDatePending,
            },
        });
        const pendingEntryKeys = [...pendingRemovals.keys()];
        const availablePlaylists = inputs.port.navidrome?.availablePlaylists ?? [];
        // 没变的部分沿用旧引用：renderer 可以按引用比较，宿主每次渲染 update 也不会白通知。
        const key = saveKey();
        const wanted = key ? collectionSaveUnderWay(key) : undefined;
        return {
            subscribed: wanted ?? subscribed,
            subscribing: wanted !== undefined,
            pendingEntryKeys: previous && sameList(previous.pendingEntryKeys, pendingEntryKeys) ? previous.pendingEntryKeys : pendingEntryKeys,
            dailyLimitReached,
            sourceActionPending,
            dailyDate,
            dailyHistoryDates,
            dailyHistoryAvailable: historyAvailable(),
            dailyStyleAvailable: styleAvailable(),
            dailyStyleShown,
            dailyStyleGroups,
            dailyStyleGroupsFailed,
            dailyStyleSelection: currentStyleSelection(),
            renamedTo: currentRename(),
            availablePlaylists: previous && sameList(previous.availablePlaylists, availablePlaylists) ? previous.availablePlaylists : availablePlaylists,
            branches: previous && sameShallow(previous.branches, branches) ? previous.branches : branches,
            capabilities: previous && sameCapabilities(previous.capabilities, capabilities) ? previous.capabilities : capabilities,
        };
    };

    let snapshot = compute(null);

    // 重算快照，有变化才通知。dispose 之后什么都不做：快照停在销毁那一刻。
    const emit = () => {
        if (disposed) return;
        const next = compute(snapshot);
        if (sameShallow(snapshot, next)) return;
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    // 订阅状态与历史日期都是「有人看才需要」：第一个订阅者到来（或能力后来才出现）时各取一次。
    const prefetch = () => {
        if (disposed || listeners.size === 0) return;
        const { descriptor } = inputs;
        if (!subscriptionRequested && snapshot.capabilities.subscribe.supported && descriptor.source === 'online') {
            subscriptionRequested = true;
            // An answer is left aside when a request to save or take out is under way, or has ended
            // since the asking began: it may be of before the change.
            const key = collectionSaveKey(descriptor);
            const mark = collectionSaveMark(key);
            omni.getSubscriptionStatus(descriptor)
                .then(status => {
                    if (disposed || !collectionSaveReadIsCurrent(key, mark) || typeof status !== 'boolean') return;
                    subscribed = status;
                    emit();
                })
                .catch(error => console.warn('[LibraryUi] Failed to fetch collection subscription status:', error));
        }
        // 开始时就是风格推荐：选中的风格要分组才写得出名字；资源加载完记下的风格到了也要通知。
        // 自动只取一次；没取到之后由选择器（打开、重试）再取，宿主每次 update 不跟着重发。
        if (dailyStyleShown && !dailyStyleGroupsPrefetched) {
            dailyStyleGroupsPrefetched = true;
            loadDailyStyleGroups();
        }
        if (!stopWatchingDailyMode && dailyMode && styleAvailable()) stopWatchingDailyMode = dailyMode.subscribe(emit);
        if (!historyRequested && snapshot.branches.isDailyRecommendationsCollection && historyAvailable()) {
            historyRequested = true;
            omni.getRecommendationHistoryDates()
                .then(dates => {
                    if (disposed) return;
                    dailyHistoryDates = dates || [];
                    emit();
                })
                .catch(error => console.error('[LibraryUi] Failed to load daily recommendation history dates:', error));
        }
    };

    /** 执行时重新判定：快照可能还没跟上最新的输入。 */
    const currentCapabilities = () => compute(null).capabilities;

    // ---- 删条目 ----

    const removeDaily = async (entry: LibraryEntryRef): Promise<LibraryMutationResult> => {
        const result = await omni.dislikeSong(entry.track);
        if (result?.replacement) {
            const resource = inputs.resource;
            const tracks = resource?.getSnapshot().tracks ?? [];
            const index = resolveRawIndex(tracks, entry.entryKey);
            if (!resource || index < 0) return fail('stale');
            return resource.replaceTrackAt(index, getPlaybackSongKey(entry.track), result.replacement) ? OK : fail('stale');
        }
        if (result?.limitReached) {
            dailyLimitReached = true;
            return fail('limit-reached');
        }
        return fail('failed');
    };

    type RemovePlaylistSongs<T> = (playlistId: string, items: T[]) => Promise<void> | void;

    const removeLocal = async (
        entry: LibraryEntryRef,
        playlistId: string,
        removePlaylistSongs: RemovePlaylistSongs<string>,
    ): Promise<LibraryMutationResult> => {
        const songId = localPlaylistSongIdOf(entry.track);
        await removePlaylistSongs(playlistId, [songId]);
        // 歌单按 songId 删（同一首出现几次都删掉），资源也删掉同 songId 的全部条目。
        // 本地集合的资源会随曲库刷新换新，所以提交给此刻的那一个。
        try {
            await inputs.resource?.removeTracks(track => localPlaylistSongIdOf(track) === songId);
        } catch (error) {
            console.warn('[LibraryUi] Failed to commit local playlist removal:', error);
        }
        followUp('Refreshing local library', () => inputs.port.local?.refresh?.());
        return OK;
    };

    const removeNavidrome = async (
        entry: LibraryEntryRef,
        playlistId: string,
        rawIndex: number,
        removePlaylistSongs: RemovePlaylistSongs<number>,
    ): Promise<LibraryMutationResult> => {
        await removePlaylistSongs(playlistId, [rawIndex]);
        // 请求期间列表可能变了（重新加载、别的编辑）：那个下标处已经不是这个条目就不动资源。
        const resource = inputs.resource;
        const tracks = resource?.getSnapshot().tracks ?? [];
        if (!resource || entryKeyAtRawIndex(tracks, rawIndex) !== entry.entryKey) return fail('stale');
        return resource.removeAt(rawIndex, getPlaybackSongKey(entry.track)) ? OK : fail('stale');
    };

    const removeOnline = async (entry: LibraryEntryRef): Promise<LibraryMutationResult> => {
        const { descriptor } = inputs;
        if (descriptor.source !== 'online') return fail('unsupported');
        if (descriptor.isLiked === true) {
            await omni.likeSong(entry.track, false);
        } else {
            await omni.updateCollectionTracks(descriptor, 'del', [entry.track]);
        }
        // 上游按歌删，资源也删掉这首的全部条目，并记墓碑、作废曲目缓存（之后到达的分页不会带回来）。
        // 集合给每一行起了名字时（collectionRowId，YouTube Music 的歌单），上游只删了这一行：这首歌的别的行留着。
        const playbackKey = getPlaybackSongKey(entry.track);
        const rowId = (entry.track as UnifiedSong).collectionRowId;
        try {
            await inputs.resource?.removeTracks(track => getPlaybackSongKey(track) === playbackKey
                && (rowId === undefined || (track as UnifiedSong).collectionRowId === rowId));
        } catch (error) {
            console.warn('[LibraryUi] Failed to invalidate collection tracks cache:', error);
        }
        try {
            await removeCacheEntry(getProviderCacheKey(descriptor.providerId, `playlist_detail_${descriptor.id}`));
        } catch (error) {
            console.warn('[LibraryUi] Failed to remove playlist detail cache:', error);
        }
        followUp('Refreshing collections after removal', () => inputs.port.onCollectionMutated?.());
        return OK;
    };

    // 同一首歌（在线 / 本地按歌删）或整个集合（串行的删除）作为去重范围。
    const removalScope = (kind: CollectionEntryRemovalKind, entry: LibraryEntryRef) => {
        if (isSerializedRemoval(kind)) return 'collection';
        return kind === 'local-playlist'
            ? `local:${localPlaylistSongIdOf(entry.track)}`
            : `song:${getPlaybackSongKey(entry.track)}`;
    };

    const removeEntry = async (entry: LibraryEntryRef): Promise<LibraryMutationResult> => {
        if (disposed) return fail('stale');
        const { descriptor, port } = inputs;
        const kind = resolveEntryRemovalKind(resolveBranches(), port);
        if (!kind) return fail('unsupported');
        // 与 GridView 一致：次数用完时先告诉用户，不再发请求。
        if (kind === 'daily-dislike' && dailyLimitReached) return fail('limit-reached');
        const scope = removalScope(kind, entry);
        if (pendingRemovals.has(entry.entryKey) || [...pendingRemovals.values()].includes(scope)) return fail('busy');
        if (isSerializedRemoval(kind) && pendingRemovals.size > 0) return fail('busy');

        let run: () => Promise<LibraryMutationResult>;
        const removeLocalSongs = port.local?.removePlaylistSongs;
        const removeNavidromeSongs = port.navidrome?.removePlaylistSongs;
        if (kind === 'daily-dislike') {
            run = () => removeDaily(entry);
        } else if (kind === 'local-playlist' && descriptor.source === 'local' && descriptor.playlistId && removeLocalSongs) {
            const playlistId = descriptor.playlistId;
            run = () => removeLocal(entry, playlistId, removeLocalSongs);
        } else if (kind === 'navidrome-playlist' && removeNavidromeSongs) {
            // 发请求前先在资源当前的曲目里解出原始下标：不用界面上的显示下标。
            const rawIndex = resolveRawIndex(inputs.resource?.getSnapshot().tracks ?? [], entry.entryKey);
            if (rawIndex < 0) return fail('stale');
            const playlistId = String(descriptor.id);
            run = () => removeNavidrome(entry, playlistId, rawIndex, removeNavidromeSongs);
        } else if (kind === 'online-playlist') {
            run = () => removeOnline(entry);
        } else {
            return fail('unsupported');
        }

        pendingRemovals.set(entry.entryKey, scope);
        emit();
        try {
            return await run();
        } catch (error) {
            console.error('[LibraryUi] Failed to remove collection entry:', error);
            return failed(error);
        } finally {
            pendingRemovals.delete(entry.entryKey);
            emit();
        }
    };

    // ---- 订阅 ----

    // 星星显示的状态立即翻过来；请求在后台发（collectionSaves），请求期间再按只改「要的」。发起的那一次在平台
    // 停在要的状态（或拒绝）时才有结果：拒绝时星星回到平台上的样子，返回 failed，由 renderer 说一句。
    const toggleSubscribe = async (): Promise<LibraryMutationResult> => {
        if (disposed) return fail('stale');
        const { descriptor } = inputs;
        if (!currentCapabilities().subscribe.supported || descriptor.source !== 'online') return fail('unsupported');
        const key = collectionSaveKey(descriptor);
        const isAlbum = resolveBranches().isOnlineAlbum;
        // 状态还不知道时按「未订阅」处理（与 GridView 的 !null 一致）。
        const wanted = !(collectionSaveUnderWay(key) ?? subscribed);
        const outcome = askCollectionSaved(key, wanted, {
            send: next => omni.subscribe(descriptor, next),
            onChanged: (saved) => {
                // 控制器可能已经随集合会话放掉了：跟随的善后照常做（上游已经改了），自己的状态不再动。
                if (!disposed) subscribed = saved;
                const port = inputs.port;
                port.onCollectionSaved?.(descriptor, saved);
                if (isAlbum) followUp('Notifying favorite albums', () => port.notifyFavoriteAlbumsChanged?.());
                followUp('Refreshing collections after subscription', () => port.onCollectionMutated?.());
            },
        });
        emit();
        const ended = await outcome;
        return ended.failed ? fail('failed') : OK;
    };
    // 任何一页发起的收藏请求结束时，平台停在的状态就是这个集合此刻的状态。
    const stopWatchingSaves = watchCollectionSaves((key, saved) => {
        if (disposed || key !== saveKey()) return;
        subscribed = saved;
        emit();
    });

    // ---- 来源动作 ----

    /**
     * 共用一个 pending 标记（与 GridView 的 isSourceActionPending 一致：进行中时这些按钮都不可点），
     * 进行中再次提交任何一个都返回 busy。只打开对话框的动作不占这个标记。
     */
    const runSourceAction = async (
        capability: keyof CollectionMutationCapabilities,
        run: () => Promise<void> | void,
        { exclusive = true }: { exclusive?: boolean } = {},
    ): Promise<LibraryMutationResult> => {
        if (disposed) return fail('stale');
        if (!currentCapabilities()[capability].supported) return fail('unsupported');
        if (!exclusive) {
            try {
                await run();
                return OK;
            } catch (error) {
                console.error(`[LibraryUi] Collection action ${capability} failed:`, error);
                return failed(error);
            }
        }
        if (sourceActionPending) return fail('busy');
        sourceActionPending = true;
        emit();
        try {
            await run();
            return OK;
        } catch (error) {
            console.error(`[LibraryUi] Collection action ${capability} failed:`, error);
            return failed(error);
        } finally {
            sourceActionPending = false;
            emit();
        }
    };

    const rename = async (name: string): Promise<LibraryMutationResult> => {
        if (disposed) return fail('stale');
        const { descriptor, port } = inputs;
        if (!currentCapabilities().rename.supported) return fail('unsupported');
        const nextName = name.trim();
        // 与当前显示的名字比：刚改过名、宿主还没跟上时，改回原名不是空操作。
        if (!nextName || nextName === (currentRename() ?? descriptor.name)) return OK;
        return runSourceAction('rename', async () => {
            if (descriptor.source === 'local' && descriptor.playlistId) {
                await port.local?.renamePlaylist?.(descriptor.playlistId, nextName);
            } else if (descriptor.source === 'navidrome') {
                await port.navidrome?.renamePlaylist?.(String(descriptor.id), nextName);
            } else {
                return;
            }
            // 按此刻宿主的描述记：请求期间宿主已经带回新名字的话就不用再记。
            const hostName = inputs.descriptor.name;
            renamed = hostName === nextName ? null : { from: hostName, to: nextName };
        });
    };

    const deleteCollection = () => {
        const { descriptor, port } = inputs;
        const branches = resolveBranches();
        return runSourceAction('deleteCollection', () => {
            if (branches.isLocalFolderCollection && descriptor.source === 'local') {
                return port.local?.deleteFolder?.(descriptor);
            }
            if (branches.isLocalPlaylistCollection && descriptor.source === 'local' && descriptor.playlistId) {
                return port.local?.deletePlaylist?.(descriptor.playlistId);
            }
            if (branches.isNavidromePlaylistCollection) {
                return port.navidrome?.deletePlaylist?.(String(descriptor.id));
            }
        });
    };

    const setDailyDate = async (date: string, { afresh = false }: { afresh?: boolean } = {}): Promise<LibraryMutationResult> => {
        if (disposed) return fail('stale');
        const resource = inputs.resource;
        if (!currentCapabilities().dailyDate.supported || !resource) return fail('unsupported');
        // 历史日期只给有这个功能的平台；今天（'' ）的刷新谁都有。
        if (date && !historyAvailable()) return fail('unsupported');
        if (dailyDatePending) return fail('busy');
        dailyDatePending = true;
        emit();
        try {
            // 整表替换交给资源（加载中状态、作废晚到结果都在那里）；失败时保持原样，日期也不切。
            const replaced = await resource.replaceAll(() => (
                date ? omni.getRecommendationHistorySongs(date) : omni.getDailySongs(afresh)
            ));
            if (!replaced) return fail('failed');
            dailyDate = date;
            dailyStyleShown = false;
            dailyMode?.setPrefersStyle(false);
            return OK;
        } finally {
            dailyDatePending = false;
            emit();
        }
    };

    // ---- 风格推荐（#938） ----

    /**
     * 风格分组取到一次就不再取，不挡着换歌。没取到（失败或一组都没有）时记成失败，选择器据此给重试，
     * 再调一次就再取。
     */
    const loadDailyStyleGroups = () => {
        if (disposed || dailyStyleGroupsRequested || !omni.getDailyStyleGroups || !styleAvailable()) return;
        dailyStyleGroupsRequested = true;
        if (dailyStyleGroupsFailed) {
            dailyStyleGroupsFailed = false;
            emit();
        }
        omni.getDailyStyleGroups()
            .then(groups => {
                if (disposed) return;
                dailyStyleGroups = groups || [];
                if (dailyStyleGroups.length === 0) {
                    dailyStyleGroupsRequested = false;
                    dailyStyleGroupsFailed = true;
                    console.warn('[LibraryUi] Daily style groups came back empty');
                }
                emit();
            })
            .catch(error => {
                if (disposed) return;
                dailyStyleGroupsRequested = false;
                dailyStyleGroupsFailed = true;
                console.warn('[LibraryUi] Failed to load daily style groups:', error);
                emit();
            });
    };

    /**
     * 换成风格推荐的歌；saving 是要先存到账号上的新风格，存失败时什么都不换。选中的风格只在歌换成功之后才改：
     * 存成功、取歌失败时界面仍是原来的风格和歌，同一组风格可以再确认一次重试。
     */
    const replaceWithDailyStyle = async (saving?: DailyStyleSelection): Promise<LibraryMutationResult> => {
        if (disposed) return fail('stale');
        const resource = inputs.resource;
        if (!currentCapabilities().dailyDate.supported || !resource || !styleAvailable()) return fail('unsupported');
        if (dailyDatePending) return fail('busy');
        dailyDatePending = true;
        emit();
        loadDailyStyleGroups();
        try {
            if (saving) {
                try {
                    await omni.setDailyStyle?.(saving);
                } catch (error) {
                    console.warn('[LibraryUi] Failed to save the daily style:', error);
                    return failed(error);
                }
            }
            const answer: { selection: DailyStyleSelection | null } = { selection: null };
            const replaced = await resource.replaceAll(async () => {
                const result = await omni.getDailyStyleSongs?.();
                answer.selection = result?.selection ?? null;
                return result?.songs ?? [];
            });
            if (!replaced) return fail('failed');
            dailyDate = '';
            dailyStyleShown = true;
            dailyMode?.setPrefersStyle(true);
            const shownFor = answer.selection ?? saving;
            dailyStyleSelection = shownFor ? { groupId: shownFor.groupId, tagIds: [...shownFor.tagIds] } : null;
            dailyMode?.noteStyleSelection(dailyStyleSelection);
            return OK;
        } finally {
            dailyDatePending = false;
            emit();
        }
    };

    const showDailyStyle = () => replaceWithDailyStyle();

    const setDailyStyle = (selection: DailyStyleSelection): Promise<LibraryMutationResult> => {
        if (!selection.groupId || selection.tagIds.length === 0) return Promise.resolve(fail('unsupported'));
        return replaceWithDailyStyle(selection);
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            if (disposed) return () => {};
            listeners.add(listener);
            prefetch();
            return () => {
                listeners.delete(listener);
            };
        },
        update: (next) => {
            if (disposed) return;
            inputs = { ...inputs, ...next };
            // 宿主的描述换了名字：记录作废（之后即使又变回旧名，也不再拿出来）。
            if (renamed && inputs.descriptor.name !== renamed.from) renamed = null;
            emit();
            prefetch();
        },
        removeEntry,
        toggleSubscribe,
        rename,
        deleteCollection,
        resyncFolder: () => {
            const { descriptor, port } = inputs;
            return runSourceAction('resyncFolder', () => (
                descriptor.source === 'local' ? port.local?.resyncFolder?.(descriptor) : undefined
            ));
        },
        resyncAllFolders: () => runSourceAction('resyncAllFolders', () => inputs.port.local?.resyncAllFolders?.()),
        exportPlaylist: () => {
            const { descriptor, port } = inputs;
            return runSourceAction('exportPlaylist', () => (
                descriptor.source === 'local' && descriptor.playlistId
                    ? port.local?.exportPlaylist?.(descriptor.playlistId)
                    : undefined
            ));
        },
        addToPlaylist: (playlistId, tracks) => runSourceAction(
            'addToPlaylist',
            () => inputs.port.navidrome?.addToPlaylist?.(playlistId, tracks),
        ),
        createPlaylist: (name, tracks) => runSourceAction(
            'createPlaylist',
            () => inputs.port.navidrome?.createPlaylist?.(name, tracks),
        ),
        editEntity: () => {
            const { descriptor, port } = inputs;
            return runSourceAction('editEntity', () => (
                descriptor.source === 'local' && descriptor.entityId
                    ? port.local?.editEntity?.(String(descriptor.entityId))
                    : undefined
            ), { exclusive: false });
        },
        setCover: () => {
            const { descriptor, port } = inputs;
            return runSourceAction('setCover', () => (
                descriptor.source === 'local' && supportsLocalCollectionCover(descriptor)
                    ? port.local?.editCover?.(descriptor)
                    : undefined
            ), { exclusive: false });
        },
        organizeSongInfo: () => {
            const { descriptor, port } = inputs;
            return runSourceAction('organizeSongInfo', () => (
                descriptor.source === 'local' ? port.local?.organizeFolder?.(descriptor) : undefined
            ), { exclusive: false });
        },
        matchSong: async (track) => {
            const songId = localSongIdOf(track);
            if (!songId) return fail('unsupported');
            return runSourceAction('matchSong', () => inputs.port.local?.matchSong?.(songId), { exclusive: false });
        },
        setDailyDate,
        showDailyStyle,
        setDailyStyle,
        loadDailyStyleGroups,
        dispose: () => {
            disposed = true;
            stopWatchingSaves();
            stopWatchingDailyMode?.();
            stopWatchingDailyMode = null;
            listeners.clear();
        },
    };
};
