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
    OmniProviderCapabilities,
    OmniProviderId,
    OmniProviderSummary,
    OmniSongAvailability,
    OmniSongReplacement,
    OmniUser,
    OnlineMusicProvider,
    ProviderCatalogEntityKind,
    QrLoginState,
} from '../../types/onlineMusic';
import { resolveProviderLyricsChorus } from '../../utils/lyrics/chorusResolver';
import { OnlineProviderError } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import {
    getOnlineMusicProvider,
    getOnlineMusicProviderForSong,
    listOnlineMusicProviders,
    providerSupports,
    requireOnlineMusicProvider,
} from './providerRegistry';
import { saveProviderAccountSnapshot } from './providerAccountCache';

// src/services/onlineMusic/omni.ts
// Online Music Network Interface (Omni) - a unified interface for interacting with multiple online music providers.


type PageInput = { limit: number; offset: number };

const activeProviderId = (): OmniProviderId => useOnlineProviderAccountStore.getState().activeProviderId;

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
    getProviderSummaries(): OmniProviderSummary[] {
        const accounts = useOnlineProviderAccountStore.getState().accounts;
        return listOnlineMusicProviders().map(provider => {
            const account = accounts[provider.id];
            return {
                providerId: provider.id,
                displayName: provider.displayName,
                shortName: provider.shortName || provider.displayName,
                availability: provider.getAvailability?.() ?? { configured: true },
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
        return Array.from(likedSongIds).some(id => String(id) === String(source.mediaId));
    },

    // Toggles a song through its source provider and keeps the provider account cache in sync.
    async toggleSongLike(song: SongResult, fallbackLikedSongIds?: Iterable<MediaId>): Promise<boolean> {
        const source = getPlaybackSourceRef(song);
        const nextLiked = !this.isSongLiked(song, fallbackLikedSongIds);
        await this.likeSong(song, nextLiked);
        if (source.kind !== 'online') return nextLiked;

        const account = useOnlineProviderAccountStore.getState().accounts[source.providerId];
        const likedSongIds = (account?.likedSongIds || []).filter(id => String(id) !== String(source.mediaId));
        useOnlineProviderAccountStore.getState().updateAccount(source.providerId, {
            likedSongIds: nextLiked ? [...likedSongIds, source.mediaId] : likedSongIds,
        });
        return nextLiked;
    },

    getActiveCapabilities(): OmniProviderCapabilities {
        return activeProvider().capabilities;
    },

    getProviderCapabilities(providerId: OmniProviderId): OmniProviderCapabilities {
        return requireOnlineMusicProvider(providerId).capabilities;
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

    async createQrLogin(providerId: OmniProviderId): Promise<{ key: string; imageUrl: string }> {
        const provider = requireOnlineMusicProvider(providerId);
        const auth = provider.auth;
        if (!auth?.getQrKey || !auth.createQr) return unsupported(providerId, 'qr-login');
        const key = await auth.getQrKey();
        return { key, imageUrl: await auth.createQr(key) };
    },

    async checkQrLogin(providerId: OmniProviderId, key: string): Promise<QrLoginState> {
        const provider = requireOnlineMusicProvider(providerId);
        if (!provider.auth?.checkQr) return unsupported(providerId, 'qr-login');
        return provider.auth.checkQr(key);
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
        const collections = useOnlineProviderAccountStore.getState().accounts[source.providerId]?.collections || [];
        return collections.filter(collection => (
            collection.type === 'playlist'
            && (provider?.mutations?.canAddToPlaylist?.(collection) ?? true)
        ));
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

    async getHomeFeed(limit = 35): Promise<{
        personalFm: UnifiedSong[];
        dailySongs: UnifiedSong[];
        recommendedCollections: OmniCollection[];
    }> {
        return withActiveProvider(async provider => {
            const recommendations = provider.recommendations;
            const [personalFm, dailySongs, recommendedCollections] = await Promise.all([
                recommendations?.getPersonalFm?.() ?? [],
                recommendations?.getDailySongs?.() ?? [],
                recommendations?.getRecommendedCollections?.(limit) ?? [],
            ]);
            return { personalFm, dailySongs, recommendedCollections };
        });
    },

    async getPersonalFm(): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getPersonalFm?.() ?? []);
    },

    async getDailySongs(refresh?: boolean): Promise<UnifiedSong[]> {
        return withActiveProvider(async provider => provider.recommendations?.getDailySongs?.(refresh) ?? []);
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
        return Boolean(providerForSong(song).playback);
    },

    async getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<OmniAudioSource | null> {
        return providerForSong(song).playback?.getAudioSource(song, quality) ?? null;
    },

    async getLyrics(song: SongResult, context?: { userId?: MediaId | null }): Promise<OmniLyricsResult> {
        const provider = providerForSong(song);
        if (!provider.lyrics) return unsupported(provider.id, 'lyrics');
        const providerUserId = useOnlineProviderAccountStore.getState().accounts[provider.id]?.user?.id ?? context?.userId;
        const providerResult = await provider.lyrics.getLyrics(song, { ...context, userId: providerUserId });
        return (await resolveProviderLyricsChorus(providerResult, {
            providerId: provider.id,
            songId: song.id,
        })).result;
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
        if (collection.type === 'album') {
            if (!mutations?.subscribeAlbum) return unsupported(collection.providerId, 'album-subscription');
            return mutations.subscribeAlbum(collection.id, subscribed);
        }
        if (!mutations?.subscribePlaylist) return unsupported(collection.providerId, 'playlist-subscription');
        return mutations.subscribePlaylist(collection, subscribed);
    },

    async updateCollectionTracks(collection: OmniCollection, operation: 'add' | 'del', tracks: SongResult[]): Promise<void> {
        const mutations = providerForCollection(collection).mutations;
        if (!mutations?.updatePlaylistTracks) return unsupported(collection.providerId, 'playlist-track-mutations');
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
        const provider = providerForCollection(playlist);
        if (provider.mutations?.canAddToPlaylist && !provider.mutations.canAddToPlaylist(playlist)) {
            throw new OnlineProviderError('unsupported', 'Playlist does not accept track mutations', source.providerId);
        }
        await this.updateCollectionTracks(playlist, 'add', [song]);
        try {
            await this.refreshProviderPlaylists(playlist.providerId);
        } catch (error) {
            console.warn('[Omni] Failed to refresh provider playlists after mutation', {
                providerId: playlist.providerId,
                name: error instanceof Error ? error.name : 'Error',
            });
        }
    },

    async likeSong(song: SongResult, liked: boolean): Promise<void> {
        const provider = providerForSong(song);
        if (!provider.mutations?.likeSong) return unsupported(provider.id, 'likes');
        return provider.mutations.likeSong(song, liked);
    },

    async dislikeSong(song: SongResult): Promise<{ replacement?: UnifiedSong; limitReached?: boolean }> {
        return providerForSong(song).recommendations?.dislikeSong?.(song.id) ?? {};
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
