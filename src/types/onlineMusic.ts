import type { LyricData, SongResult, UnifiedSong } from '../types';

// src/types/onlineMusic.ts

export type MediaId = string | number;
export type OnlineProviderId = 'netease' | (string & {});
export type AudioQualityPreference = 'standard' | 'high' | 'lossless' | 'hires';
export type ProviderCatalogEntityKind = 'album' | 'artist' | 'playlist';

export interface ProviderCatalogRef {
    providerId: OnlineProviderId;
    kind: ProviderCatalogEntityKind;
    id: MediaId;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PlaybackSourceRef =
    | {
        kind: 'online';
        providerId: OnlineProviderId;
        mediaId: string;
        variant?: string;
        providerData?: Record<string, JsonValue>;
    }
    | { kind: 'local'; mediaId: string }
    | { kind: 'navidrome'; mediaId: string }
    | { kind: 'stage'; mediaId: string };

export interface ProviderCapabilities {
    search: boolean;
    playback: boolean;
    lyrics: boolean;
    auth: boolean;
    userLibrary: boolean;
    playlists: boolean;
    albums: boolean;
    artists: boolean;
    recommendations: boolean;
    mutations: boolean;
    wordByWordLyrics: boolean;
    userCloud?: boolean;
    historyRecommendations?: boolean;
    playlistSubscription?: boolean;
    playlistTrackMutations?: boolean;
    likes?: boolean;
    userAlbums?: boolean;
}

export interface ProviderAvailability {
    configured: boolean;
    reason?: 'not-configured' | 'runtime-unavailable';
}

export interface ProviderAccountSummary {
    providerId: OnlineProviderId;
    displayName: string;
    shortName: string;
    availability: ProviderAvailability;
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    user: ProviderUser | null;
    collections: ProviderCollection[];
    error?: string;
    hydration?: 'loading' | 'ready';
    freshness?: 'stale' | 'refreshing' | 'fresh' | 'error';
    lastUpdatedAt?: number;
}

export interface ProviderPage<T> {
    items: T[];
    total?: number;
    hasMore: boolean;
    nextOffset: number;
}

export interface ProviderAudioSource {
    url: string;
    fetchedAt: number;
    expiresAt?: number;
    quality: AudioQualityPreference;
}

export type ProviderSongAvailabilityState = 'playable' | 'unavailable' | 'unknown';

export interface ProviderSongAvailability {
    state: ProviderSongAvailabilityState;
    label?: string;
}

export interface ProviderSongReplacement {
    song: UnifiedSong;
    label?: string;
}

export interface ChorusRange {
    startTime: number;
    endTime: number;
}

export interface ProviderLyricsResult {
    lyrics: LyricData | null;
    mainText?: string | null;
    wordByWordText?: string | null;
    translationText?: string | null;
    isPureMusic: boolean;
    chorusRanges?: ChorusRange[];
}

export interface ProviderAlbumSummary {
    id: MediaId;
    name: string;
    coverUrl?: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

export interface ProviderSongMetadata {
    artists: ProviderArtistSummary[];
    album: ProviderAlbumSummary;
    durationMs: number;
    coverUrl?: string;
    aliases: string[];
    translatedNames: string[];
}

export interface ProviderUser {
    id: MediaId;
    nickname: string;
    avatarUrl?: string;
    backgroundUrl?: string;
    vipType?: number;
}

export interface ProviderArtistSummary {
    id: MediaId;
    name: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

export interface ProviderHistoryEntry {
    id: string;
    label: string;
    providerData?: Record<string, JsonValue>;
}

export interface ProviderCollection {
    providerId: OnlineProviderId;
    id: MediaId;
    name: string;
    type: 'playlist' | 'album' | 'artist' | 'radio' | 'cloud' | string;
    coverUrl?: string;
    description?: string;
    trackCount?: number;
    albumCount?: number;
    isOwned?: boolean;
    creator?: ProviderUser;
    artists?: ProviderArtistSummary[];
    aliases?: string[];
    publishedAt?: number;
    publisher?: string;
    playCount?: number;
    updatedAt?: number;
    tracksUpdatedAt?: number;
    isLiked?: boolean;
    providerData?: Record<string, JsonValue>;
}

export type QrLoginState =
    | { state: 'waiting' }
    | { state: 'scanned' }
    | { state: 'confirmed' }
    | { state: 'expired' }
    | { state: 'error'; message?: string };

export type ProviderErrorCode =
    | 'auth-required'
    | 'unsupported'
    | 'unavailable'
    | 'not-playable'
    | 'network'
    | 'invalid-response';

export class OnlineProviderError extends Error {
    constructor(
        public readonly code: ProviderErrorCode,
        message: string,
        public readonly providerId?: OnlineProviderId,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'OnlineProviderError';
    }
}

export interface OnlineSearchProvider {
    searchSongs(query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;
}

export interface OnlinePlaybackProvider {
    getSongDetail(id: MediaId): Promise<UnifiedSong | null>;
    getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<ProviderAudioSource | null>;
    getAvailability?(song: SongResult): ProviderSongAvailability;
    getReplacement?(song: SongResult): Promise<ProviderSongReplacement | null>;
}

export interface OnlineLyricsProvider {
    getLyrics(song: SongResult, context?: { userId?: MediaId | null }): Promise<ProviderLyricsResult>;
    getChorusRanges?(songId: MediaId): Promise<ChorusRange[]>;
}

export interface OnlineSongMetadataProvider {
    getSongMetadata(song: SongResult): ProviderSongMetadata;
}

export interface OnlineAuthProvider {
    getLoginStatus(): Promise<ProviderUser | null>;
    logout(): Promise<void>;
    getQrKey?(): Promise<string>;
    createQr?(key: string): Promise<string>;
    checkQr?(key: string): Promise<QrLoginState>;
}

export interface OnlineLibraryProvider {
    getUserPlaylists(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getLikedSongIds?(userId: MediaId): Promise<MediaId[]>;
    getUserAlbums?(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getCloudCollection?(user?: ProviderUser): Promise<ProviderCollection | null>;
}

export interface OnlineCatalogProvider {
    canResolveSongCatalogRefs?(song: UnifiedSong): boolean;
    resolveSongCatalogRefs?(song: UnifiedSong): Promise<UnifiedSong>;
    getPlaylistTracks?(id: MediaId, limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getPlaylistDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;
    getCloudTracks?(limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getAlbumTracks?(id: MediaId, limit?: number, offset?: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getAlbumDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;
    getArtistSongs?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;
    getArtistAlbums?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getArtistDetail?(id: MediaId): Promise<ProviderCollection | null>;
    getSubscriptionStatus?(type: 'playlist' | 'album', id: MediaId, collection?: ProviderCollection): Promise<boolean>;
}

export interface OnlineRecommendationProvider {
    getDailySongs?(refresh?: boolean): Promise<UnifiedSong[]>;
    getPersonalFm?(): Promise<UnifiedSong[]>;
    getRecommendedCollections?(limit: number): Promise<ProviderCollection[]>;
    getHistoryEntries?(): Promise<ProviderHistoryEntry[]>;
    getHistoryDates?(): Promise<string[]>;
    getHistorySongs?(entry: ProviderHistoryEntry | string): Promise<UnifiedSong[]>;
    dislikeSong?(id: MediaId): Promise<{ replacement?: UnifiedSong; limitReached?: boolean }>;
}

export interface OnlineMutationProvider {
    canAddToPlaylist?(playlist: ProviderCollection): boolean;
    likeSong?(song: MediaId | SongResult, liked: boolean): Promise<void>;
    updatePlaylistTracks?(
        operation: 'add' | 'del',
        playlist: MediaId | ProviderCollection,
        tracks: Array<MediaId | SongResult>,
    ): Promise<void>;
    subscribePlaylist?(playlist: MediaId | ProviderCollection, subscribed: boolean): Promise<void>;
    subscribeAlbum?(id: MediaId, subscribed: boolean): Promise<void>;
}

export interface OnlineMusicProvider {
    id: OnlineProviderId;
    displayName: string;
    shortName?: string;
    getAvailability?(): ProviderAvailability;
    capabilities: ProviderCapabilities;
    normalizeSong(raw: unknown): UnifiedSong;
    normalizeUser?(raw: unknown): ProviderUser;
    normalizeCollection?(raw: unknown, type?: string): ProviderCollection;
    songMetadata?: OnlineSongMetadataProvider;
    getSongPageUrl?(song: SongResult): string | null;
    search?: OnlineSearchProvider;
    playback?: OnlinePlaybackProvider;
    lyrics?: OnlineLyricsProvider;
    auth?: OnlineAuthProvider;
    library?: OnlineLibraryProvider;
    catalog?: OnlineCatalogProvider;
    recommendations?: OnlineRecommendationProvider;
    mutations?: OnlineMutationProvider;
}

// Public canonical contract consumed through the omni facade. Provider-prefixed
// names above remain internal adapter vocabulary while the migration completes.
export type OmniProviderId = OnlineProviderId;
export type OmniMediaId = MediaId;
export type OmniProviderCapabilities = ProviderCapabilities;
export type OmniProviderAvailability = ProviderAvailability;
export type OmniProviderSummary = ProviderAccountSummary;
export type OmniAccountState = ProviderAccountSummary;
export type OmniPage<T> = ProviderPage<T>;
export type OmniAudioSource = ProviderAudioSource;
export type OmniSongAvailability = ProviderSongAvailability;
export type OmniSongReplacement = ProviderSongReplacement;
export type OmniLyricsResult = ProviderLyricsResult;
export type OmniChorusRange = ChorusRange;
export type OmniAlbum = ProviderAlbumSummary;
export type OmniArtist = ProviderArtistSummary;
export type OmniUser = ProviderUser;
export type OmniCollection = ProviderCollection;
export type OmniHistoryEntry = ProviderHistoryEntry;
export { OnlineProviderError as OmniError };
