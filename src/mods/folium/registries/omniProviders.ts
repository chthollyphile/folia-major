import type { SongResult, UnifiedSong } from '@/types';
import type { AudioQualityPreference, OnlineMusicProvider, ProviderCapabilities } from '@/types/onlineMusic';
import {
    getOnlineMusicProvider,
    registerOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '@/services/onlineMusic/providerRegistry';
import type { FoliumOmniProviderDef, FoliumProviderSong } from '../contract';
import { isFoliumLegacyLyricsResult, resolveFoliumLyricsResult } from '../lyricsSource';
import { FOLIUM_OLD_CLIENT_NAMES } from '../deprecated/oldNames';
import { sayFoliumOldNameOnce } from '../deprecated/warnings';
import { createFoliumRegistry } from '../../runtime/registry';
import { timeFoliumMod } from '../../runtime/guard';
import { foliumProviderId } from '../omni/providerIds';

// src/mods/folium/registries/omniProviders.ts
// EXPERIMENTAL `omni.providers`: a mod's online music source, adapted to the
// host OnlineMusicProvider contract so Omni routes to it like to any built-in
// provider (search, playback, lyrics; nothing account-related). The lyrics
// answer is the stable FoliumLyricsResult shape (lyricsSource.ts), even though this
// registry itself is not. Host provider id is `folium.<modid>.<name>`: dots,
// because ':' already carries meaning in other host ids, and a dot can never
// collide with a built-in provider id.
//
// Songs keep the mod's own id as `sourceRef.mediaId`, so queues and history
// that outlive the mod still name the song; they become unplayable, not
// corrupt, while the mod is off.
//
// The provider id is made in omni/providerIds.ts (`foliumProviderId`), which others read without
// loading this registry.

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

/*
 * The mod's four methods are called through the gate in its timing mode: a
 * rejection is how a source says "failed", and Omni already handles it.
 */
const buildProvider = (modId: string, providerId: string, def: FoliumOmniProviderDef): OnlineMusicProvider => {
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
        // A provider's tracks can be word-timed. Declarative only: nothing in the host reads this flag.
        wordByWordLyrics: typeof def.getLyrics === 'function',
        // Songs are looked up by id only through the mod's `getSong`. Without it `playback.getSongDetail`
        // still answers (null), so the flag tells such a source apart before anything is asked.
        songDetail: typeof def.getSong === 'function',
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
                    const page = await timeFoliumMod(modId, `provider ${providerId} search`, () => def.search!(query, { limit, offset }));
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
                    const song = def.getSong
                        ? await timeFoliumMod(modId, `provider ${providerId} getSong`, () => def.getSong!(String(id)))
                        : null;
                    return song && isProviderSong(song) ? toUnifiedSong(providerId, song) : null;
                },
                getAudioSource: async (song, quality: AudioQualityPreference) => {
                    // For the type: a mod's provider lists no levels, so it is never asked at 'ultra',
                    // which is no level of the mod contract (omni asks at 'high' in its place).
                    const source = await timeFoliumMod(modId, `provider ${providerId} getAudioUrl`, () => (
                        def.getAudioUrl!(toProviderSong(song), quality === 'ultra' ? 'high' : quality)
                    ));
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
                    const answer = await timeFoliumMod(modId, `provider ${providerId} getLyrics`, () => def.getLyrics!(toProviderSong(song)));
                    // Until Folium 2: the 1.3 answer still reads, and is said once in the mod's row.
                    if (isFoliumLegacyLyricsResult(answer)) sayFoliumOldNameOnce(modId, FOLIUM_OLD_CLIENT_NAMES.lyricsLrc);
                    return resolveFoliumLyricsResult(answer, providerId);
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
    onAdd: (entry) => registerOnlineMusicProvider(buildProvider(entry.modId, entry.def.providerId, entry.def.def)),
    onRemove: (entry) => unregisterOnlineMusicProvider(entry.def.providerId),
});
