import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OmniAudioSource,
    OmniChorusRange,
    OmniCollection,
    OmniHistoryEntry,
    OmniLyricsResult,
    OmniPage,
    OmniPlaybackReport,
    OmniProviderCapabilities,
    OmniProviderId,
    OmniProviderSummary,
    OmniSongAvailability,
    OmniSongReplacement,
    OmniUser,
    OnlineMusicProvider,
    OnlineSearchSuggestion,
    PersonalFmRequestOptions,
    ProviderCatalogEntityKind,
    LoginSelfCheckResult,
    ProviderComment,
    QrLoginMethod,
    QrLoginState,
} from '../../types/onlineMusic';
import { resolveProviderLyricsChorus } from '../../utils/lyrics/chorusResolver';
import { OnlineProviderError } from '../../types/onlineMusic';
import type { ProviderSongListCategoryGroup } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { saveSongReplayGain } from './resourceCache';
import {
    getOnlineMusicProvider,
    getOnlineMusicProviderForSong,
    getOnlineMusicProviderRegistryVersion,
    listOnlineMusicProviders,
    providerSupports,
    requireOnlineMusicProvider,
    subscribeOnlineMusicProviderRegistry,
} from './providerRegistry';
import { saveProviderAccountSnapshot } from './providerAccountCache';
import { applyOmniAudioHook, applyOmniLyricsHook } from '../hostExtensionHooks';

// 与各 provider 的 errorFields 同构：把错误抑制成可日志化的字段，不把错误对象本身扔进日志（可能带 cookie）。
const errorFields = (error: unknown) => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
});

// src/services/onlineMusic/omni.ts
// Online Music Network Interface (Omni) - a unified interface for interacting with multiple online music providers.


type PageInput = { limit: number; offset: number };

const activeProviderId = (): OmniProviderId => {
    const storedProviderId = useOnlineProviderAccountStore.getState().activeProviderId;
    // A persisted selection can outlive its provider when switching builds or branches.
    return getOnlineMusicProvider(storedProviderId) ? storedProviderId : 'netease';
};

const activeProvider = () => requireOnlineMusicProvider(activeProviderId());

const providerForSong = (song: SongResult) => {
    const provider = getOnlineMusicProviderForSong(song);
    if (!provider) throw new OnlineProviderError('unsupported', 'Song is not owned by an online provider');
    return provider;
};

const providerForCollection = (collection: OmniCollection) => requireOnlineMusicProvider(collection.providerId);

const unsupported = (providerId: OmniProviderId, capability: string): never => {
    throw new OnlineProviderError('unsupported', `${capability} is not supported by ${providerId}`, providerId);
};

const emptyPage = <T>(offset: number): OmniPage<T> => ({ items: [], hasMore: false, nextOffset: offset });

// 点赞状态改完要落盘：只更内存的话，重启后靠快照 hydration 的那一帧会恢复旧心形，
// 后台刷新再失败就一直是旧的。行号是会话级的，不进快照。
const persistProviderLikedSongIds = async (providerId: OmniProviderId): Promise<void> => {
    const account = useOnlineProviderAccountStore.getState().accounts[providerId];
    if (!account?.user) return;
    try {
        await saveProviderAccountSnapshot(providerId, {
            user: account.user,
            collections: account.collections || [],
            likedSongIds: account.likedSongIds || [],
        });
    } catch (error) {
        // 落盘失败不能把一次成功的 mutation 变成失败，下一次刷新会补上。
        console.warn('[Omni] Failed to persist liked songs after a like mutation', {
            providerId,
            name: error instanceof Error ? error.name : 'Error',
        });
    }
};

// 歌单内的行号（KuGou fileid）只在解析它的那一刻有效，失败后必须丢掉，下次重新解析。
const dropProviderLikedFileId = (providerId: OmniProviderId, songKey: string): void => {
    const account = useOnlineProviderAccountStore.getState().accounts[providerId];
    if (!account?.likedSongFileIds || account.likedSongFileIds[songKey] === undefined) return;
    const likedSongFileIds = { ...account.likedSongFileIds };
    delete likedSongFileIds[songKey];
    useOnlineProviderAccountStore.getState().updateAccount(providerId, { likedSongFileIds });
};

let activeRequestGeneration = 0;

// Rejects late active-provider responses after an account switch transaction begins.
const withActiveProvider = async <T>(run: (provider: OnlineMusicProvider) => Promise<T>): Promise<T> => {
    const providerId = activeProviderId();
    const generation = activeRequestGeneration;
    const result = await run(requireOnlineMusicProvider(providerId));
    if (generation !== activeRequestGeneration || providerId !== activeProviderId()) {
        throw new DOMException('Active online provider changed', 'AbortError');
    }
    return result;
};

export const omni = {
    invalidateActiveRequests(): void {
        activeRequestGeneration += 1;
    },

    getActiveRequestGeneration(): number {
        return activeRequestGeneration;
    },

    // The provider list changes at runtime (Folium mods). A useSyncExternalStore pair for the UI.
    subscribeProviders(listener: () => void): () => void {
        return subscribeOnlineMusicProviderRegistry(listener);
    },

    getProviderRegistryVersion(): number {
        return getOnlineMusicProviderRegistryVersion();
    },

    getProviderSummaries(): OmniProviderSummary[] {
        const accounts = useOnlineProviderAccountStore.getState().accounts;
        return listOnlineMusicProviders().map(provider => {
            const account = accounts[provider.id];
            return {
                providerId: provider.id,
                displayName: provider.displayName,
                shortName: provider.shortName || provider.displayName,
                availability: provider.getAvailability?.() ?? { configured: true },
                requiresAccount: provider.capabilities.auth,
                status: account?.status || 'unknown',
                user: account?.user || null,
                collections: account?.collections || [],
                error: account?.error,
                hydration: account?.hydration || 'loading',
                freshness: account?.freshness || 'stale',
                lastUpdatedAt: account?.lastUpdatedAt,
            };
        });
    },

    getActiveProviderSummary(): OmniProviderSummary | undefined {
        const providerId = activeProviderId();
        return this.getProviderSummaries().find(provider => provider.providerId === providerId);
    },

    // Reads cached like state through Omni while preserving Netease's local state during account refreshes.
    isSongLiked(song: SongResult, fallbackLikedSongIds?: Iterable<MediaId>): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;

        const accountLikedSongIds = useOnlineProviderAccountStore.getState().accounts[source.providerId]?.likedSongIds;
        const likedSongIds = source.providerId === 'netease' && fallbackLikedSongIds
            ? fallbackLikedSongIds
            : accountLikedSongIds || [];
        const songKey = String(source.mediaId);
        for (const id of likedSongIds) {
            if (String(id) === songKey) return true;
        }
        return false;
    },

    // Toggles a song through its source provider. `likeSong` is what keeps the account cache in
    // sync, so every entry point - this one, the liked grid, a command - lands in the same state.
    async toggleSongLike(song: SongResult, fallbackLikedSongIds?: Iterable<MediaId>): Promise<boolean> {
        const nextLiked = !this.isSongLiked(song, fallbackLikedSongIds);
        await this.likeSong(song, nextLiked);
        return nextLiked;
    },

    getActiveCapabilities(): OmniProviderCapabilities {
        return activeProvider().capabilities;
    },

    getProviderCapabilities(providerId: OmniProviderId): OmniProviderCapabilities {
        return requireOnlineMusicProvider(providerId).capabilities;
    },

    supportsDailySongs(providerId: OmniProviderId): boolean {
        return typeof requireOnlineMusicProvider(providerId).recommendations?.getDailySongs === 'function';
    },

    getProviderAvailability(providerId: OmniProviderId) {
        return requireOnlineMusicProvider(providerId).getAvailability?.() ?? { configured: true };
    },

    getProviderLabel(providerId: OmniProviderId): string {
        const provider = getOnlineMusicProvider(providerId);
        return provider?.shortName || provider?.displayName || providerId;
    },

    async searchSongs(query: string, page: PageInput): Promise<OmniPage<UnifiedSong>> {
        return withActiveProvider(async provider => {
            if (!providerSupports(provider, 'search') || !provider.search) return emptyPage(page.offset);
            return provider.search.searchSongs(query, page.limit, page.offset);
        });
    },

    async searchProviderSongs(providerId: OmniProviderId, query: string, page: PageInput): Promise<OmniPage<UnifiedSong>> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!providerSupports(provider, 'search') || !provider.search) return emptyPage(page.offset);
        return provider.search.searchSongs(query, page.limit, page.offset);
    },

    /** 搜索框输入联想；provider 没实现就返回空，调用方按「没有联想」处理。 */
    async searchSmartboxSuggestions(providerId: OmniProviderId, query: string): Promise<OnlineSearchSuggestion[]> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!providerSupports(provider, 'search') || !provider.search?.getSmartboxSuggestions) return [];
        return provider.search.getSmartboxSuggestions(query);
    },

    /** 专辑/歌单类型搜索，返回集合卡；provider 没实现就返回空页。 */
    async searchProviderCollections(providerId: OmniProviderId, query: string, page: PageInput): Promise<OmniPage<OmniCollection>> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!providerSupports(provider, 'search') || !provider.search?.searchCollections) return emptyPage(page.offset);
        return provider.search.searchCollections(query, page.limit, page.offset);
    },

    async getLoginStatus(providerId: OmniProviderId): Promise<OmniUser | null> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!provider.auth) return unsupported(providerId, 'auth');
        return provider.auth.getLoginStatus();
    },

    async logout(providerId: OmniProviderId): Promise<void> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!provider.auth) return unsupported(providerId, 'auth');
        await provider.auth.logout();
    },

    // 没有这个能力就回空数组，UI 据此走单步流程；netease / kugou 完全不受影响。
    getQrLoginMethods(providerId: OmniProviderId): QrLoginMethod[] {
        return requireOnlineMusicProvider(providerId).auth?.getQrLoginMethods?.() ?? [];
    },

    async resolveQrLoginMethods(providerId: OmniProviderId): Promise<QrLoginMethod[]> {
        const auth = requireOnlineMusicProvider(providerId).auth;
        if (!auth) return [];
        return auth.resolveQrLoginMethods?.() ?? auth.getQrLoginMethods?.() ?? [];
    },

    async createQrLogin(providerId: OmniProviderId, methodId?: string): Promise<{ key: string; imageUrl: string }> {
        const provider = requireOnlineMusicProvider(providerId);
        const auth = provider.auth;
        if (!auth?.getQrKey || !auth.createQr) return unsupported(providerId, 'qr-login');
        const key = await auth.getQrKey(methodId);
        return { key, imageUrl: await auth.createQr(key) };
    },

    async checkQrLogin(providerId: OmniProviderId, key: string): Promise<QrLoginState> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!provider.auth?.checkQr) return unsupported(providerId, 'qr-login');
        return provider.auth.checkQr(key);
    },

    // 没有这个能力就静默 no-op：netease / kugou 的扫码流程完全不受影响。
    async cancelQrLogin(providerId: OmniProviderId, key: string): Promise<void> {
        await requireOnlineMusicProvider(providerId).auth?.cancelQr?.(key);
    },

    // 诊断是失败之后的补救手段，自己不能再失败：provider 没实现就回空，抛错就把错误写进报告。
    async getQrLoginDiagnostics(providerId: OmniProviderId): Promise<string[]> {
        try {
            return await requireOnlineMusicProvider(providerId).auth?.getQrLoginDiagnostics?.() ?? [];
        } catch (error) {
            return [`provider diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`];
        }
    },

    // 扫码失败后的主动自检：没有这个能力的 provider（kugou、bodian、mod 源）回 false / null。
    // 自检本身出错时照常抛出，由登录会话记进时间线与报告。
    canRunQrLoginSelfCheck(providerId: OmniProviderId): boolean {
        return Boolean(requireOnlineMusicProvider(providerId).auth?.canRunQrLoginSelfCheck?.());
    },

    async runQrLoginSelfCheck(providerId: OmniProviderId): Promise<LoginSelfCheckResult | null> {
        return await requireOnlineMusicProvider(providerId).auth?.runQrLoginSelfCheck?.() ?? null;
    },

    // 只有明确声明了二维码寿命的 provider 才由前端计时；其余照旧只认后端报出的过期状态。
    getQrTtlMs(providerId: OmniProviderId): number | null {
        const ttlMs = requireOnlineMusicProvider(providerId).auth?.getQrTtlMs?.();
        return typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : null;
    },

    async getUserPlaylists(userId: MediaId, page: PageInput): Promise<OmniPage<OmniCollection>> {
        return withActiveProvider(async provider => provider.library?.getUserPlaylists?.(userId, page.limit, page.offset) ?? emptyPage(page.offset));
    },

    async getProviderUserPlaylists(providerId: OmniProviderId, userId: MediaId, page: PageInput): Promise<OmniPage<OmniCollection>> {
        const library = requireOnlineMusicProvider(providerId).library;
        if (!library?.getUserPlaylists) return emptyPage(page.offset);
        return library.getUserPlaylists(userId, page.limit, page.offset);
    },

    // Refreshes one provider's playlist catalog and keeps the Omni account cache current.
    async refreshProviderPlaylists(providerId: OmniProviderId): Promise<OmniCollection[]> {
        const account = useOnlineProviderAccountStore.getState().accounts[providerId];
        const userId = account?.user?.id;
        if (userId === undefined || userId === null) return [];
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            freshness: 'refreshing',
            error: undefined,
        });

        try {
            const playlists: OmniCollection[] = [];
            const limit = 50;
            let offset = 0;
            let hasMore = true;
            while (hasMore && offset < 1000) {
                const page = await this.getProviderUserPlaylists(providerId, userId, { limit, offset });
                playlists.push(...page.items.filter(collection => collection.type === 'playlist'));
                hasMore = page.hasMore && page.nextOffset > offset;
                offset = page.nextOffset;
            }

            const existingCollections = account.collections || [];
            const collections = [
                ...existingCollections.filter(collection => collection.type !== 'playlist'),
                ...playlists,
            ];
            const snapshot = await saveProviderAccountSnapshot(providerId, {
                user: account.user!,
                collections,
                likedSongIds: account.likedSongIds || [],
            });
            useOnlineProviderAccountStore.getState().updateAccount(providerId, {
                collections,
                freshness: 'fresh',
                lastUpdatedAt: snapshot.savedAt,
            });
            return playlists;
        } catch (error) {
            useOnlineProviderAccountStore.getState().updateAccount(providerId, {
                freshness: 'error',
                error: error instanceof Error ? error.message : 'provider_playlist_refresh_failed',
            });
            throw error;
        }
    },

    // Returns the cached playlists owned by the provider that owns the current song.
    getPlaylistsForSong(song: SongResult): OmniCollection[] {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return [];
        const provider = getOnlineMusicProvider(source.providerId);
        if (
            !providerSupports(provider, 'mutations')
            || !providerSupports(provider, 'playlistTrackMutations')
            || !provider?.mutations?.updatePlaylistTracks
        ) {
            return [];
        }
        const collections = useOnlineProviderAccountStore.getState().accounts[source.providerId]?.collections || [];
        return collections.filter(collection => (
            collection.type === 'playlist'
            && (provider.mutations?.canAddToPlaylist?.(collection) ?? true)
        ));
    },

    canAddSongToPlaylist(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'mutations')
            && providerSupports(provider, 'playlistTrackMutations')
            && Boolean(provider?.mutations?.updatePlaylistTracks);
    },

    /** Whether the provider can create an owned playlist in the account at all. */
    canCreatePlaylist(providerId: OmniProviderId): boolean {
        const provider = getOnlineMusicProvider(providerId);
        return providerSupports(provider, 'mutations')
            && Boolean(provider?.mutations?.createPlaylist);
    },

    canLikeSong(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'mutations')
            && providerSupports(provider, 'likes')
            && Boolean(provider?.mutations?.likeSong);
    },

    canEditCollectionTracks(collection: OmniCollection): boolean {
        const provider = getOnlineMusicProvider(collection.providerId);
        if (!providerSupports(provider, 'mutations')) return false;
        if (collection.isLiked === true) {
            return providerSupports(provider, 'likes') && Boolean(provider?.mutations?.likeSong);
        }
        return providerSupports(provider, 'playlistTrackMutations')
            && Boolean(provider?.mutations?.updatePlaylistTracks);
    },

    canDislikeSong(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'recommendations')
            && Boolean(provider?.recommendations?.dislikeSong);
    },

    canBrowseSongListCategories(providerId: OmniProviderId): boolean {
        const provider = getOnlineMusicProvider(providerId);
        return providerSupports(provider, 'playlists')
            && Boolean(provider?.catalog?.getSongListCategories);
    },

    async getSongListCategories(providerId: OmniProviderId): Promise<ProviderSongListCategoryGroup[]> {
        const provider = getOnlineMusicProvider(providerId);
        if (!provider || !this.canBrowseSongListCategories(providerId) || !provider.catalog?.getSongListCategories) {
            return [];
        }
        return provider.catalog.getSongListCategories();
    },

    async getCategorySongLists(
        providerId: OmniProviderId,
        categoryId: string,
        page: PageInput,
    ): Promise<OmniPage<OmniCollection>> {
        const provider = getOnlineMusicProvider(providerId);
        if (!provider || !provider.catalog?.getCategorySongLists) {
            return emptyPage(page.offset);
        }
        return provider.catalog.getCategorySongLists(categoryId, page.limit, page.offset);
    },

    canCommentSong(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'comments')
            && Boolean(provider?.comments?.getSongComments);
    },

    async getSongComments(
        song: SongResult,
        page: PageInput,
    ): Promise<OmniPage<ProviderComment>> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return emptyPage(page.offset);
        const provider = getOnlineMusicProvider(source.providerId);
        if (!provider || !this.canCommentSong(song) || !provider.comments?.getSongComments) {
            return emptyPage(page.offset);
        }
        return provider.comments.getSongComments(song, page.limit, page.offset);
    },

    canThreadCommentReplies(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'comments')
            && Boolean(provider?.comments?.getCommentReplies);
    },

    async getSongCommentReplies(
        song: SongResult,
        commentId: ProviderComment['id'],
        page: PageInput,
    ): Promise<OmniPage<ProviderComment>> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return emptyPage(page.offset);
        const provider = getOnlineMusicProvider(source.providerId);
        if (!provider || !this.canThreadCommentReplies(song) || !provider.comments?.getCommentReplies) {
            return emptyPage(page.offset);
        }
        return provider.comments.getCommentReplies(song, commentId, page.limit, page.offset);
    },

    canLikeComment(song: SongResult): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const provider = getOnlineMusicProvider(source.providerId);
        return providerSupports(provider, 'comments')
            && Boolean(provider?.comments?.likeComment);
    },

    async likeComment(song: SongResult, commentId: ProviderComment['id'], liked: boolean): Promise<void> {
        const source = getPlaybackSourceRef(song);
        const provider = source.kind === 'online' ? getOnlineMusicProvider(source.providerId) : null;
        if (!provider || !this.canLikeComment(song) || !provider.comments?.likeComment) {
            throw new OnlineProviderError('unsupported', 'Comment likes are not supported here', source.kind === 'online' ? source.providerId : 'online');
        }
        return provider.comments.likeComment(song, commentId, liked);
    },

    canSubscribeCollection(collection: OmniCollection): boolean {
        const provider = getOnlineMusicProvider(collection.providerId);
        if (
            !providerSupports(provider, 'mutations')
            || !providerSupports(provider, 'playlistSubscription')
        ) {
            return false;
        }
        return collection.type === 'album'
            ? Boolean(provider?.mutations?.subscribeAlbum)
            : Boolean(provider?.mutations?.subscribePlaylist);
    },

    async getUserAlbums(userId: MediaId, page: PageInput): Promise<OmniPage<OmniCollection>> {
        return withActiveProvider(async provider => provider.library?.getUserAlbums?.(userId, page.limit, page.offset) ?? emptyPage(page.offset));
    },

    async getLikedSongIds(userId: MediaId): Promise<MediaId[]> {
        return withActiveProvider(async provider => provider.library?.getLikedSongIds?.(userId) ?? []);
    },

    async getProviderLikedSongIds(providerId: OmniProviderId, userId: MediaId): Promise<MediaId[]> {
        return requireOnlineMusicProvider(providerId).library?.getLikedSongIds?.(userId) ?? [];
    },

    async getProviderLikedSongs(providerId: OmniProviderId, userId: MediaId): Promise<UnifiedSong[]> {
        const library = requireOnlineMusicProvider(providerId).library;
        if (library?.getLikedSongs) return library.getLikedSongs(userId);
        return [];
    },

    async getCloudCollection(user?: OmniUser): Promise<OmniCollection | null> {
        return withActiveProvider(async provider => provider.library?.getCloudCollection?.(user) ?? null);
    },

    async getProviderCloudCollection(providerId: OmniProviderId, user?: OmniUser): Promise<OmniCollection | null> {
        return requireOnlineMusicProvider(providerId).library?.getCloudCollection?.(user) ?? null;
    },

    normalizeCachedUser(providerId: OmniProviderId, raw: unknown): OmniUser | null {
        return requireOnlineMusicProvider(providerId).normalizeUser?.(raw) ?? null;
    },

    normalizeCachedCollection(providerId: OmniProviderId, raw: unknown, type?: string): OmniCollection | null {
        return requireOnlineMusicProvider(providerId).normalizeCollection?.(raw, type) ?? null;
    },

    async getHomeFeed(limit = 35, context?: { seedSongId?: MediaId; from?: number; scope?: 'personalized' | 'editorial' | 'all' }): Promise<{
        personalFm: UnifiedSong[];
        dailySongs: UnifiedSong[];
        recommendedCollections: OmniCollection[];
    }> {
        return withActiveProvider(async provider => {
            const recommendations = provider.recommendations;
            // editorial 槽位只消费歌单广场，personalFm 那 862ms 的调用是纯浪费 —— 跳过它，
            // 电台页的进入时间就从「最慢的一段」降到「歌单广场本身」。
            const wantPersonalFm = context?.scope !== 'editorial';
            // 三路各自兑底：Promise.all 会让任何一路失败把整个首页拉空（电台页就得到一个全白屏），
            // 而现实里最常见的故障就是其中一路被限流。走失的那一段就不出，其余段照常。
            const swallow = (label: string) => (error: unknown) => {
                console.warn('[Omni] home feed section failed', { label, ...errorFields(error) });
                return [] as never[];
            };
            const [personalFm, dailySongs, recommendedCollections] = await Promise.all([
                (wantPersonalFm ? recommendations?.getPersonalFm?.() : undefined)?.catch(swallow('personalFm'))
                    ?? Promise.resolve([] as UnifiedSong[]),
                (recommendations?.getDailySongs?.() ?? Promise.resolve([] as UnifiedSong[])).catch(swallow('dailySongs')),
                (recommendations?.getRecommendedCollections?.(limit, context) ?? Promise.resolve([] as OmniCollection[]))
                    .catch(swallow('recommendedCollections')),
            ]);
            return { personalFm, dailySongs, recommendedCollections };
        });
    },

    async getPersonalFm(options?: PersonalFmRequestOptions): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getPersonalFm?.(options) ?? []);
    },

    async getDailySongs(refresh?: boolean): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getDailySongs?.(refresh) ?? []);
    },

    /** 取某一段推荐的具体歌曲，`section` 的取值由各 provider 自己定义。 */
    async getRecommendationRowSongs(
        section: string,
        options?: { seedSongId?: MediaId; limit?: number },
    ): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => (
            provider.recommendations?.getRecommendationRowSongs?.(section, options) ?? []
        ));
    },

    /**
     * 按当前这首推同类。走 song-aware 的方式，与 dislikeSong 同一套身份判定：
     * 种子用的是 `song.id`（provider 自己认的那个 id），不是跨 provider 可比的裸数字。
     */
    async getSimilarSongs(song: SongResult, limit = 20): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => (
            provider.recommendations?.getSimilarSongs?.(song.id, limit) ?? []
        ));
    },

    async getRecommendationHistory(): Promise<OmniHistoryEntry[]> {
        return withActiveProvider(async provider => provider.recommendations?.getHistoryEntries?.() ?? []);
    },

    async getRecommendationHistoryDates(): Promise<string[]> {
        return withActiveProvider(async provider => provider.recommendations?.getHistoryDates?.() ?? []);
    },

    async getRecommendationHistorySongs(entry: OmniHistoryEntry | string): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getHistorySongs?.(entry) ?? []);
    },

    async getSongDetail(providerId: OmniProviderId, id: MediaId): Promise<UnifiedSong | null> {
        return requireOnlineMusicProvider(providerId).playback?.getSongDetail(id) ?? null;
    },

    canPlaySong(song: SongResult): boolean {
        return Boolean(getOnlineMusicProviderForSong(song)?.playback);
    },

    async getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<OmniAudioSource | null> {
        const source = await (providerForSong(song).playback?.getAudioSource(song, quality) ?? null);
        // Written here rather than at either caller because this is the only moment a provider ever
        // states a track's ReplayGain, and both callers - the prefetch pass and playback itself -
        // may be the one that happens to see it. See getCachedSongReplayGain for what is lost
        // otherwise: the URL is never fetched again once the bytes are cached.
        if (source?.replayGain) void saveSongReplayGain(song, source.replayGain);
        // Extension layers (Folium omni hooks) may swap the URL; the ReplayGain above stays the provider's.
        return applyOmniAudioHook(song, source);
    },

    // Asked once per track, including for local and Navidrome songs, so an unsupported source is a
    // plain `false` rather than the throw `providerForSong` would raise.
    canReportPlayback(song: SongResult): boolean {
        const provider = getOnlineMusicProviderForSong(song);
        return providerSupports(provider, 'playbackReports') && Boolean(provider?.playbackReports);
    },

    async reportPlayback(song: SongResult, report: OmniPlaybackReport): Promise<void> {
        const provider = providerForSong(song);
        if (!provider.playbackReports) return unsupported(provider.id, 'playbackReports');
        await provider.playbackReports.reportPlayback(song, report);
    },

    async getLyrics(song: SongResult, context?: { userId?: MediaId | null }): Promise<OmniLyricsResult> {
        const provider = providerForSong(song);
        if (!provider.lyrics) return unsupported(provider.id, 'lyrics');
        const providerUserId = useOnlineProviderAccountStore.getState().accounts[provider.id]?.user?.id ?? context?.userId;
        const providerResult = await provider.lyrics.getLyrics(song, { ...context, userId: providerUserId });
        const resolved = (await resolveProviderLyricsChorus(providerResult, {
            providerId: provider.id,
            songId: song.id,
        })).result;
        // Extension layers (Folium omni hooks) may rewrite the lyrics after the provider answered.
        return applyOmniLyricsHook(song, resolved);
    },

    async getChorusRanges(song: SongResult): Promise<OmniChorusRange[]> {
        const provider = providerForSong(song);
        return provider.lyrics?.getChorusRanges?.(song.id) ?? [];
    },

    getSongAvailability(song: SongResult): OmniSongAvailability {
        return providerForSong(song).playback?.getAvailability?.(song) ?? { state: 'unknown' };
    },

    async getSongReplacement(song: SongResult): Promise<OmniSongReplacement | null> {
        return providerForSong(song).playback?.getReplacement?.(song) ?? null;
    },

    async getCollectionTracks(collection: OmniCollection, page: PageInput): Promise<OmniPage<UnifiedSong>> {
        const provider = providerForCollection(collection);
        if (collection.type === 'album') {
            return provider.catalog?.getAlbumTracks?.(collection.id, page.limit, page.offset, collection) ?? emptyPage(page.offset);
        }
        if (collection.type === 'cloud') {
            return provider.catalog?.getCloudTracks?.(page.limit, page.offset, collection) ?? emptyPage(page.offset);
        }
        return provider.catalog?.getPlaylistTracks?.(collection.id, page.limit, page.offset, collection) ?? emptyPage(page.offset);
    },

    async getAlbumDetail(collection: OmniCollection): Promise<OmniCollection | null> {
        return providerForCollection(collection).catalog?.getAlbumDetail?.(collection.id, collection) ?? null;
    },

    async getCollectionDetail(collection: OmniCollection): Promise<OmniCollection | null> {
        const catalog = providerForCollection(collection).catalog;
        if (collection.type === 'album') return catalog?.getAlbumDetail?.(collection.id, collection) ?? collection;
        if (collection.type === 'playlist') return catalog?.getPlaylistDetail?.(collection.id, collection) ?? collection;
        return collection;
    },

    async getArtistDetail(collection: OmniCollection): Promise<OmniCollection | null> {
        return providerForCollection(collection).catalog?.getArtistDetail?.(collection.id) ?? null;
    },

    async getArtistSongs(collection: OmniCollection, page: PageInput): Promise<OmniPage<UnifiedSong>> {
        return providerForCollection(collection).catalog?.getArtistSongs?.(collection.id, page.limit, page.offset) ?? emptyPage(page.offset);
    },

    async getArtistAlbums(collection: OmniCollection, page: PageInput): Promise<OmniPage<OmniCollection>> {
        return providerForCollection(collection).catalog?.getArtistAlbums?.(collection.id, page.limit, page.offset) ?? emptyPage(page.offset);
    },

    async getSubscriptionStatus(collection: OmniCollection): Promise<boolean> {
        const type = collection.type === 'album' ? 'album' : 'playlist';
        return providerForCollection(collection).catalog?.getSubscriptionStatus?.(type, collection.id, collection) ?? false;
    },

    async subscribe(collection: OmniCollection, subscribed: boolean): Promise<void> {
        const mutations = providerForCollection(collection).mutations;
        if (!this.canSubscribeCollection(collection)) {
            return unsupported(collection.providerId, 'collection-subscription');
        }
        if (collection.type === 'album') {
            if (!mutations?.subscribeAlbum) return unsupported(collection.providerId, 'album-subscription');
            return mutations.subscribeAlbum(collection.id, subscribed);
        }
        if (!mutations?.subscribePlaylist) return unsupported(collection.providerId, 'playlist-subscription');
        return mutations.subscribePlaylist(collection, subscribed);
    },

    async updateCollectionTracks(collection: OmniCollection, operation: 'add' | 'del', tracks: SongResult[]): Promise<void> {
        const provider = providerForCollection(collection);
        const mutations = provider.mutations;
        if (
            !providerSupports(provider, 'mutations')
            || !providerSupports(provider, 'playlistTrackMutations')
            || !mutations?.updatePlaylistTracks
        ) {
            return unsupported(collection.providerId, 'playlist-track-mutations');
        }
        return mutations.updatePlaylistTracks(operation, collection, tracks);
    },

    async addSongToPlaylist(song: SongResult, playlist: OmniCollection): Promise<void> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') {
            throw new OnlineProviderError('unsupported', 'Only online songs can be added to online playlists');
        }
        if (playlist.providerId !== source.providerId || playlist.type !== 'playlist') {
            throw new OnlineProviderError('unsupported', 'Playlist does not belong to the song provider', source.providerId);
        }
        if (!this.canAddSongToPlaylist(song)) {
            throw new OnlineProviderError('unsupported', 'Song provider does not support playlist track mutations', source.providerId);
        }
        const provider = providerForCollection(playlist);
        if (provider.mutations?.canAddToPlaylist && !provider.mutations.canAddToPlaylist(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist does not accept track mutations', source.providerId);
        }
        await this.updateCollectionTracks(playlist, 'add', [song]);
        try {
            await this.refreshProviderPlaylists(playlist.providerId);
            // Netease owns its liked state in useNeteaseLibrary; avoid its cached /likelist here.
            if (playlist.isLiked === true && playlist.providerId !== 'netease' && providerSupports(provider, 'likes')) {
                const account = useOnlineProviderAccountStore.getState().accounts[playlist.providerId];
                if (account?.user?.id !== undefined && account?.user?.id !== null) {
                    const userId = account.user.id;
                    // A full liked list may be large. Do not delay success or overwrite a newer account/mutation.
                    void this.getProviderLikedSongIds(playlist.providerId, userId).then(async likedSongIds => {
                        const latest = useOnlineProviderAccountStore.getState().accounts[playlist.providerId];
                        if (latest?.user?.id !== userId || latest.likedSongIds !== account.likedSongIds) return;
                        useOnlineProviderAccountStore.getState().updateAccount(playlist.providerId, { likedSongIds });
                        await persistProviderLikedSongIds(playlist.providerId);
                    }).catch(error => {
                        console.warn('[Omni] Failed to refresh liked songs after playlist mutation', {
                            providerId: playlist.providerId,
                            name: error instanceof Error ? error.name : 'Error',
                        });
                    });
                }
            }
        } catch (error) {
            console.warn('[Omni] Failed to refresh provider playlists after mutation', {
                providerId: playlist.providerId,
                name: error instanceof Error ? error.name : 'Error',
            });
        }
    },

    /** Creates an owned playlist in the given provider's account and returns it normalized. */
    async createPlaylist(providerId: OmniProviderId, dirName: string): Promise<OmniCollection> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!providerSupports(provider, 'mutations') || !provider.mutations?.createPlaylist) {
            return unsupported(providerId, 'playlist-create');
        }
        const created = await provider.mutations.createPlaylist(dirName);
        try {
            await this.refreshProviderPlaylists(providerId);
        } catch (error) {
            console.warn('[Omni] Failed to refresh provider playlists after create', {
                providerId,
                name: error instanceof Error ? error.name : 'Error',
            });
        }
        return created;
    },

    async likeSong(song: SongResult, liked: boolean): Promise<void> {
        const provider = providerForSong(song);
        if (!this.canLikeSong(song) || !provider.mutations?.likeSong) return unsupported(provider.id, 'likes');

        // canLikeSong 已经保证了这一点，这里只是把类型收窄；真走到就说明上面的判断被绕过了。
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return unsupported(provider.id, 'likes');

        const songKey = String(source.mediaId);
        const account = useOnlineProviderAccountStore.getState().accounts[source.providerId];
        const cachedFileId = account?.likedSongFileIds?.[songKey];

        try {
            if (cachedFileId === undefined) {
                await provider.mutations.likeSong(song, liked);
            } else {
                await provider.mutations.likeSong(song, liked, { likedFileId: cachedFileId });
            }
        } catch (error) {
            // 失败时只丢掉可能已经失效的 fileId，点赞状态保持原样——调用方会把错误往上抛。
            dropProviderLikedFileId(source.providerId, songKey);
            throw error;
        }

        // 成功之后 likedSongIds 和 likedSongFileIds 一次提交：直接调 likeSong 的入口（例如"我喜欢"
        // 网格里删歌）也必须让账号缓存跟着走，否则和 toggleSongLike 两个入口语义不同。
        // 加收藏拿不到新的 fileId，取消收藏让旧的失效，两种情况都得把这一行删掉，下次取消时重新解析。
        //
        // @note 网易云是例外：它的点赞集合由 useNeteaseLibrary 的本地 state 当家，再单向镜像到这个
        // store（见 useNeteaseLibrary 里的 updateProviderAccount effect），而 isSongLiked 对网易云
        // 优先读调用方传进来的那一份。所以从 GridView 直接调用这里，网易云的播放器心形不会跟着变，
        // 要等下一次账号刷新。真要统一得把那份 state 挪进 store，不在这次改动范围内。
        const latest = useOnlineProviderAccountStore.getState().accounts[source.providerId];
        const likedSongIds = (latest?.likedSongIds || []).filter(id => String(id) !== songKey);
        const likedSongFileIds = { ...(latest?.likedSongFileIds || {}) };
        delete likedSongFileIds[songKey];
        useOnlineProviderAccountStore.getState().updateAccount(source.providerId, {
            likedSongIds: liked ? [...likedSongIds, source.mediaId] : likedSongIds,
            likedSongFileIds,
        });
        await persistProviderLikedSongIds(source.providerId);
    },

    async dislikeSong(song: SongResult): Promise<{ replacement?: UnifiedSong; limitReached?: boolean }> {
        const provider = providerForSong(song);
        if (!this.canDislikeSong(song) || !provider.recommendations?.dislikeSong) {
            return unsupported(provider.id, 'recommendation-dislike');
        }
        return provider.recommendations.dislikeSong(song.id);
    },

    canResolveCatalogRef(song: UnifiedSong, _kind: ProviderCatalogEntityKind): boolean {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return false;
        const catalog = getOnlineMusicProvider(source.providerId)?.catalog;
        return Boolean(catalog?.resolveSongCatalogRefs || catalog?.canResolveSongCatalogRefs?.(song));
    },

    async resolveCatalogRefs(song: UnifiedSong): Promise<UnifiedSong> {
        const source = getPlaybackSourceRef(song);
        if (source.kind !== 'online') return song;
        return getOnlineMusicProvider(source.providerId)?.catalog?.resolveSongCatalogRefs?.(song) ?? song;
    },

    getSongPageUrl(song: SongResult): string | null {
        return providerForSong(song).getSongPageUrl?.(song) ?? null;
    },
};

export type OmniService = typeof omni;
