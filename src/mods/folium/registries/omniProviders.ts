import type { SongResult, UnifiedSong } from '@/types';
import type { AudioQualityPreference, OnlineMusicProvider, ProviderCapabilities } from '@/types/onlineMusic';
import {
    getOnlineMusicProvider,
    registerOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '@/services/onlineMusic/providerRegistry';
import { parseLRC } from '@/utils/lyrics/parserCore';
import type { FoliumOmniProviderDef, FoliumProviderSong } from '../contract';
import { createFoliumRegistry } from '../registry';

// src/mods/folium/registries/omniProviders.ts
// EXPERIMENTAL `omni.providers`: a mod's online music source, adapted to the
// host OnlineMusicProvider contract so Omni routes to it like to any built-in
// provider (search, playback, lyrics; nothing account-related). Host provider
// id is `folium.<modid>.<name>`: dots, because ':' already carries meaning in
// other host ids, and a dot can never collide with a built-in provider id.
//
// Songs keep the mod's own id as `sourceRef.mediaId`, so queues and history
// that outlive the mod still name the song; they become unplayable, not
// corrupt, while the mod is off.

export const foliumProviderId = (id: string) => `folium.${id.replace(':', '.')}`;

const toUnifiedSong = (providerId: string, song: FoliumProviderSong): UnifiedSong => ({
    id: song.id,
    name: song.title,
    artists: (song.artists ?? []).map((name, index) => ({ id: `${song.id}#artist${index}`, name })),
    album: { id: `${song.id}#album`, name: song.album ?? '', ...(song.coverUrl ? { coverUrl: song.coverUrl } : {}) },
    durationMs: Number.isFinite(song.durationMs) ? Number(song.durationMs) : 0,
    sourceRef: { kind: 'online', providerId, mediaId: song.id },
});

const toProviderSong = (song: SongResult): FoliumProviderSong => {
    const ref = song.sourceRef;
    return {
        id: ref?.kind === 'online' ? ref.mediaId : String(song.id),
        title: song.name,
        artists: (song.artists ?? []).map((artist) => artist.name),
        ...(song.album?.name ? { album: song.album.name } : {}),
        ...(song.album?.coverUrl ? { coverUrl: song.album.coverUrl } : {}),
        ...(song.durationMs ? { durationMs: song.durationMs } : {}),
    };
};

const isProviderSong = (value: unknown): value is FoliumProviderSong => (
    Boolean(value) && typeof (value as FoliumProviderSong).id === 'string' && typeof (value as FoliumProviderSong).title === 'string'
);

const buildProvider = (providerId: string, def: FoliumOmniProviderDef): OnlineMusicProvider => {
    const capabilities: ProviderCapabilities = {
        search: typeof def.search === 'function',
        playback: typeof def.getAudioUrl === 'function',
        lyrics: typeof def.getLyrics === 'function',
        auth: false,
        userLibrary: false,
        playlists: false,
        albums: false,
        artists: false,
        recommendations: false,
        mutations: false,
        wordByWordLyrics: false,
    };
    return {
        id: providerId,
        displayName: String(def.displayName || def.id),
        ...(def.shortName ? { shortName: def.shortName } : {}),
        capabilities,
        normalizeSong: (raw) => {
            const candidate = raw as UnifiedSong;
            if (candidate?.sourceRef?.kind === 'online' && candidate.sourceRef.providerId === providerId) return candidate;
            if (isProviderSong(raw)) return toUnifiedSong(providerId, raw);
            throw new Error(`${providerId}: cannot normalize song`);
        },
        ...(capabilities.search ? {
            search: {
                searchSongs: async (query, limit, offset) => {
                    const page = await def.search!(query, { limit, offset });
                    const items = (page?.items ?? []).filter(isProviderSong).map((song) => toUnifiedSong(providerId, song));
                    return {
                        items,
                        hasMore: Boolean(page?.hasMore),
                        ...(Number.isFinite(page?.total) ? { total: page.total } : {}),
                        nextOffset: offset + items.length,
                    };
                },
            },
        } : {}),
        ...(capabilities.playback ? {
            playback: {
                getSongDetail: async (id) => {
                    const song = def.getSong ? await def.getSong(String(id)) : null;
                    return song && isProviderSong(song) ? toUnifiedSong(providerId, song) : null;
                },
                getAudioSource: async (song, quality: AudioQualityPreference) => {
                    const source = await def.getAudioUrl!(toProviderSong(song), quality);
                    if (!source || typeof source.url !== 'string') return null;
                    return {
                        url: source.url,
                        fetchedAt: Date.now(),
                        ...(Number.isFinite(source.expiresAt) ? { expiresAt: source.expiresAt } : {}),
                        quality,
                    };
                },
            },
        } : {}),
        ...(capabilities.lyrics ? {
            lyrics: {
                getLyrics: async (song) => {
                    const result = await def.getLyrics!(toProviderSong(song));
                    if (!result || typeof result.lrc !== 'string' || !result.lrc.trim()) {
                        return { lyrics: null, isPureMusic: false };
                    }
                    return {
                        lyrics: parseLRC(result.lrc, result.translationLrc ?? ''),
                        mainText: result.lrc,
                        translationText: result.translationLrc ?? null,
                        isPureMusic: false,
                    };
                },
            },
        } : {}),
    };
};

export const omniProvidersRegistry = createFoliumRegistry<FoliumOmniProviderDef, { def: FoliumOmniProviderDef; providerId: string }>('omni.providers', {
    validate: (def, { id }) => {
        if (!def.search && !def.getAudioUrl && !def.getLyrics) {
            throw new Error('omni.providers.register: implement at least one of search / getAudioUrl / getLyrics');
        }
        const providerId = foliumProviderId(id);
        if (getOnlineMusicProvider(providerId)) {
            throw new Error(`omni.providers.register: provider "${providerId}" already exists`);
        }
        return { def, providerId };
    },
    onAdd: (entry) => registerOnlineMusicProvider(buildProvider(entry.def.providerId, entry.def.def)),
    onRemove: (entry) => unregisterOnlineMusicProvider(entry.def.providerId),
});
