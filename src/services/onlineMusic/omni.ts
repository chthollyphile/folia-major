import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OmniAudioSource,
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

// src/services/onlineMusic/omni.ts

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
            };
        });
    },

    getActiveProviderSummary(): OmniProviderSummary | undefined {
        const providerId = activeProviderId();
        return this.getProviderSummaries().find(provider => provider.providerId === providerId);
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
        return provider.lyrics.getLyrics(song, context);
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
