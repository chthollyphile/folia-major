import type { SongResult } from '@/types';
import type {
    AudioQualityPreference,
    OnlineExternalPlaybackProvider,
    OnlineMusicProvider,
    OnlinePlaybackProvider,
    OnlineSearchProvider,
    ProviderAudioSource,
    ProviderItemKind,
    ProviderPlaybackRoute,
    ProviderSongAvailability,
} from '@/types/onlineMusic';
import type {
    FoliumSourceAudioPlayback,
    FoliumSourceDef,
    FoliumSourceExternalPlayback,
    FoliumSourceReports,
    FoliumSourceSearch,
    FoliumSourceSongs,
    FoliumSourceSurfacePlayback,
} from '../../sources/contract';
import { toHostPage, toSourceSong } from '../sourceDtos';
import i18n from '@/i18n/config';
import { finite, list, record, type SourceAdapterKit } from './kit';
import type { FoliumSourceRoute } from './parts';

// src/mods/folium/registries/sourceAdapter/playback.ts
// search@1, songs@1 with playback.audio@1 (one internal `playback` object between them, matrix §4.2),
// playback.external@1 and playback.surface@1 (one internal `externalPlayback` between them, plan §4.2), the
// source's `routeOf` and `itemKinds`, and reports@1, as the host's internal sub-objects.

const QUALITY_LEVELS = new Set<unknown>(['standard', 'high', 'ultra', 'lossless', 'hires']);

export const buildSearch = (kit: SourceAdapterKit, search: FoliumSourceSearch): OnlineSearchProvider => {
    const searchAlbums = search.searchAlbums?.bind(search);
    const searchPlaylists = search.searchPlaylists?.bind(search);
    return {
        searchSongs: async (query, limit, offset, context) => toHostPage(
            await kit.run('searchSongs', () => search.searchSongs(query, limit, offset, context?.session ? { session: context.session } : undefined)),
            offset,
            kit.song,
        ),
        ...(searchAlbums ? {
            searchAlbums: async (query, limit, offset) => toHostPage(await kit.run('searchAlbums', () => searchAlbums(query, limit, offset)), offset, kit.collection),
        } : {}),
        ...(searchPlaylists ? {
            searchPlaylists: async (query, limit, offset) => toHostPage(await kit.run('searchPlaylists', () => searchPlaylists(query, limit, offset)), offset, kit.collection),
        } : {}),
    };
};

/*
 * A song's availability as the host's. Rows ask it while they are drawn, and a source answers with a few
 * constant objects: each is turned into the host's shape once for the UI language now (its label is a text in
 * that language), and again only when the language changes.
 */
// What a song's availability reads as when the source's own answer threw.
const UNKNOWN_AVAILABILITY: ProviderSongAvailability = Object.freeze({ state: 'unknown' });

const songAvailabilityOf = (kit: SourceAdapterKit) => {
    const kept = new WeakMap<object, { language: string; value: ProviderSongAvailability }>();
    const convert = (answer: unknown): ProviderSongAvailability => {
        const found = record(answer);
        const state = found?.state === 'playable' || found?.state === 'unavailable' ? found.state : 'unknown';
        const reason = found?.reason === 'taken-down' || found?.reason === 'restricted' ? found.reason : undefined;
        return {
            state,
            ...(reason ? { reason } : {}),
            ...(found?.label !== undefined ? { label: kit.now(found.label, 'availability.label') } : {}),
        };
    };
    return (answer: unknown): ProviderSongAvailability => {
        if (typeof answer !== 'object' || answer === null) return convert(answer);
        const language = i18n.language;
        const known = kept.get(answer);
        if (known?.language === language) return known.value;
        const value = convert(answer);
        kept.set(answer, { language, value });
        return value;
    };
};

const audioSourceOf = (answer: unknown, quality: AudioQualityPreference): ProviderAudioSource | null => {
    const found = record(answer);
    if (!found || typeof found.url !== 'string' || !found.url) return null;
    const replayGain = record(found.replayGain);
    const expiresAt = finite(found.expiresAt);
    const clipStartMs = finite(found.clipStartMs);
    return {
        url: found.url,
        fetchedAt: Date.now(),
        quality: QUALITY_LEVELS.has(found.quality) ? found.quality as AudioQualityPreference : quality,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(replayGain ? { replayGain: { ...replayGain } } : {}),
        ...(found.preview === true ? { preview: true } : {}),
        ...(clipStartMs !== undefined ? { clipStartMs } : {}),
    };
};

/** The internal `playback`: songs by id from songs@1, audio from playback.audio@1. */
export const buildPlayback = (
    kit: SourceAdapterKit,
    songs: FoliumSourceSongs | undefined,
    audio: FoliumSourceAudioPlayback | undefined,
): OnlinePlaybackProvider => {
    const getSong = songs?.getSong.bind(songs);
    const getSongs = songs?.getSongs?.bind(songs);
    const getAvailability = songs?.getAvailability?.bind(songs);
    const getReplacement = songs?.getReplacement?.bind(songs);
    const getPlayedSong = songs?.getPlayedSong?.bind(songs);
    const getCounterparts = songs?.getCounterparts?.bind(songs);
    const getAudioSource = audio?.getAudioSource.bind(audio);
    const keepAudio = audio?.keepAudio?.bind(audio);
    const hasKeptAudio = audio?.hasKeptAudio?.bind(audio);
    const availabilityOf = songAvailabilityOf(kit);
    const playback: OnlinePlaybackProvider = {
        getSongDetail: async (id) => (getSong ? kit.song(await kit.run('getSong', () => getSong(String(id)))) : null),
        ...(getSongs ? {
            getSongDetails: async (ids) => {
                const answer = list(await kit.run('getSongs', () => getSongs(ids.map(String))));
                return ids.map((_, index) => kit.song(answer[index]));
            },
        } : {}),
        getAudioSource: async (song, quality) => (
            getAudioSource ? audioSourceOf(await kit.run('getAudioSource', () => getAudioSource(toSourceSong(song), quality)), quality) : null
        ),
        ...(getAvailability ? {
            getAvailability: kit.sync('getAvailability', (song: SongResult) => availabilityOf(getAvailability(toSourceSong(song))), () => UNKNOWN_AVAILABILITY),
        } : {}),
        ...(getReplacement ? {
            getReplacement: async (song) => {
                const answer = record(await kit.run('getReplacement', () => getReplacement(toSourceSong(song))));
                const replacement = answer ? kit.song(answer.song) : null;
                if (!answer || !replacement) return null;
                return { song: replacement, ...(answer.label !== undefined ? { label: kit.now(answer.label, 'replacement.label') } : {}) };
            },
        } : {}),
        ...(getPlayedSong ? {
            getPlayedSong: async (song) => kit.song(await kit.run('getPlayedSong', () => getPlayedSong(toSourceSong(song)))),
        } : {}),
        ...(getCounterparts ? {
            // The source gets plain copies (it cannot reach the host's objects through them); what it answers is read
            // as its own songs, and anything that is not one is null.
            getCounterparts: async (queries) => {
                const answer = list(await kit.run('getCounterparts', () => getCounterparts(queries.map(query => ({ ...query, artists: [...query.artists] })))));
                return queries.map((_, index) => kit.song(answer[index]));
            },
        } : {}),
        ...(keepAudio ? { keepAudio: async (url) => Boolean(await kit.run('keepAudio', () => keepAudio(url))) } : {}),
        ...(hasKeptAudio ? { hasKeptAudio: async (url) => Boolean(await kit.run('hasKeptAudio', () => hasKeptAudio(url))) } : {}),
    };
    // Read where the host reads them, so a getter of the source's answers for its account now.
    Object.defineProperties(playback, {
        songDetailsPerRequest: { enumerable: true, get: () => songs?.songsPerRequest },
        counterpartSources: {
            enumerable: true,
            get: () => {
                // A getter of the mod's: one that throws is a source that declares none.
                let declared: unknown;
                try {
                    declared = getCounterparts ? songs?.counterpartSources : undefined;
                } catch {
                    declared = undefined;
                }
                return Array.isArray(declared) ? declared.filter((id): id is string => typeof id === 'string' && id !== '') : undefined;
            },
        },
        audioQualityLevels: { enumerable: true, get: () => audio?.audioQualityLevels },
        audioQualityNoticeKey: {
            enumerable: true,
            get: () => {
                // A getter of the mod's: one that throws says nothing, and the pick list shows.
                try {
                    return kit.key(audio?.audioQualityNotice, 'audioQualityNotice');
                } catch {
                    return undefined;
                }
            },
        },
        previewNoticeKey: { enumerable: true, get: () => (audio?.previewNotice === undefined ? undefined : kit.key(audio.previewNotice, 'previewNotice')) },
    });
    return playback;
};

const NO_PICTURE = (): void => undefined;

/*
 * `mount` of playback.surface@1: the source puts its picture into the host's box. A throw leaves the box empty
 * (the sound plays on) and answers null, so the host keeps its own background; what it answers takes the picture
 * out, and a throw there is only logged.
 */
const buildMount = (kit: SourceAdapterKit, surface: FoliumSourceSurfacePlayback): NonNullable<OnlineExternalPlaybackProvider['mount']> => {
    const mount = surface.mount.bind(surface);
    return kit.sync('mount', (container: HTMLElement, song: SongResult) => {
        const disposer: unknown = mount(container, { song: toSourceSong(song) });
        if (typeof disposer !== 'function') return NO_PICTURE;
        return () => {
            try {
                (disposer as () => void)();
            } catch (error) {
                console.warn(`[Folium] ${kit.label} taking the picture out threw`, error);
            }
        };
    }, () => null);
};

/** playback.external@1, or playback.surface@1 (the same members and `mount`), as the host's `externalPlayback`. */
export const buildExternal = (kit: SourceAdapterKit, external: FoliumSourceExternalPlayback | FoliumSourceSurfacePlayback): OnlineExternalPlaybackProvider => {
    const canPlay = external.canPlay?.bind(external);
    const prepareNext = external.prepareNext?.bind(external);
    const isPrepared = external.isPrepared?.bind(external);
    const adopt = external.adopt?.bind(external);
    const setVolume = external.setVolume?.bind(external);
    const setRepeatOne = external.setRepeatOne?.bind(external);
    const isStatusForSong = external.isStatusForSong.bind(external);
    return {
        ...(canPlay ? { canPlay: kit.sync('canPlay', (song: SongResult) => canPlay(toSourceSong(song)), () => false) } : {}),
        ...(prepareNext ? {
            prepareNext: async (song, upcoming) => {
                await kit.run('prepareNext', () => prepareNext(toSourceSong(song), upcoming.map(toSourceSong)));
            },
        } : {}),
        ...(isPrepared ? { isPrepared: kit.sync('isPrepared', (song: SongResult) => isPrepared(toSourceSong(song)), () => false) } : {}),
        play: async (song, startSec) => {
            await kit.run('play', () => external.play(toSourceSong(song), startSec));
        },
        ...(adopt ? { adopt: kit.sync('adopt', (song: SongResult) => { adopt(toSourceSong(song)); }, () => undefined) } : {}),
        pause: async () => {
            await kit.run('pause', () => external.pause());
        },
        resume: async () => {
            await kit.run('resume', () => external.resume());
        },
        seek: async (seconds) => {
            await kit.run('seek', () => external.seek(seconds));
        },
        ...(setVolume ? {
            setVolume: async (volume) => {
                await kit.run('setVolume', () => setVolume(volume));
            },
        } : {}),
        ...(setRepeatOne ? {
            setRepeatOne: async (enabled) => {
                await kit.run('setRepeatOne', () => setRepeatOne(enabled));
            },
        } : {}),
        // The status is the host's to hand on: its shape is the contract's FoliumSourceExternalStatus.
        getStatus: async (song) => await kit.run('getStatus', () => external.getStatus(toSourceSong(song))) as Awaited<ReturnType<OnlineExternalPlaybackProvider['getStatus']>>,
        isStatusForSong: kit.sync('isStatusForSong', (song: SongResult, status: Parameters<FoliumSourceExternalPlayback['isStatusForSong']>[1]) => isStatusForSong(toSourceSong(song), status), () => false),
        ...('mount' in external && typeof external.mount === 'function' ? { mount: buildMount(kit, external) } : {}),
    };
};

/** The host's `routeOf` of a source that plays (`routes`: its ways, in the order it lists them); none without one. */
export const buildRouteOf = (
    kit: SourceAdapterKit,
    def: Pick<FoliumSourceDef, 'routeOf'>,
    routes: readonly FoliumSourceRoute[],
): ((song: SongResult) => ProviderPlaybackRoute) | undefined => {
    if (routes.length === 0) return undefined;
    const first = routes[0];
    const routeOf = def.routeOf?.bind(def);
    if (!routeOf || routes.length === 1) return () => first;
    // A way it does not play is not taken from it: the song plays its first way.
    return kit.sync('routeOf', (song: SongResult) => {
        const answer = routeOf(toSourceSong(song));
        return routes.includes(answer) ? answer : first;
    }, () => first);
};

/*
 * A source with both playback.external@1 and playback.surface@1: one host `externalPlayback` over the two
 * players. Every call goes to the player of the song it is about (`routeOf`): the host names the song even where
 * the contract's member takes none (pause, resume, seek, the level, the repeat); only a call that names none goes
 * to the player last told to play or take a song. A start in the other player pauses the one it leaves, as the host
 * stops another provider's player before it starts this one; a start overtaken by one in the other player (while
 * either waited) pauses its own player once it is through, so the two never sound at once.
 */
export const dispatchExternal = (
    kit: SourceAdapterKit,
    routeOf: (song: SongResult) => ProviderPlaybackRoute,
    external: OnlineExternalPlaybackProvider,
    surface: OnlineExternalPlaybackProvider,
    first: 'external' | 'surface',
): OnlineExternalPlaybackProvider => {
    const of = (song: SongResult) => (routeOf(song) === 'surface' ? surface : external);
    let current = first === 'surface' ? surface : external;
    const playerFor = (song?: SongResult) => (song ? of(song) : current);
    const quiet = async (player: OnlineExternalPlaybackProvider, why: string) => {
        await player.pause().catch((error: unknown) => {
            console.warn(`[Folium] ${kit.label}: ${why}`, error);
        });
    };
    return {
        canPlay: (song) => of(song).canPlay?.(song) !== false,
        prepareNext: async (song, upcoming) => {
            await of(song).prepareNext?.(song, upcoming);
        },
        isPrepared: (song) => of(song).isPrepared?.(song) === true,
        play: async (song, startSec) => {
            const target = of(song);
            const left = current === target ? null : current;
            current = target;
            if (left) await quiet(left, 'the player left for the other one could not be paused');
            await target.play(song, startSec);
            if (current !== target) await quiet(target, 'a start overtaken by the other player could not be paused');
        },
        adopt: (song) => {
            current = of(song);
            current.adopt?.(song);
        },
        pause: (song) => playerFor(song).pause(song),
        resume: (song) => playerFor(song).resume(song),
        seek: (seconds, song) => playerFor(song).seek(seconds, song),
        ...(external.setVolume || surface.setVolume ? {
            setVolume: async (volume: number, song?: SongResult) => {
                await playerFor(song).setVolume?.(volume, song);
            },
        } : {}),
        ...(external.setRepeatOne || surface.setRepeatOne ? {
            setRepeatOne: async (enabled: boolean, song?: SongResult) => {
                await playerFor(song).setRepeatOne?.(enabled, song);
            },
        } : {}),
        getStatus: (song) => of(song).getStatus(song),
        isStatusForSong: (song, status) => of(song).isStatusForSong(song, status),
        ...(surface.mount ? { mount: (container: HTMLElement, song: SongResult) => surface.mount?.(container, song) ?? (() => undefined) } : {}),
    };
};

const ITEM_LYRICS = new Set<unknown>(['none', 'own', 'match']);

/** A source's `itemKinds` as the host's: the traits it wrote of each kind, read now (one named `song` is left out). */
export const itemKindsOf = (value: unknown): Record<string, ProviderItemKind> | undefined => {
    const kinds = record(value);
    if (!kinds) return undefined;
    const out: Record<string, ProviderItemKind> = {};
    for (const [kind, traits] of Object.entries(kinds)) {
        const found = record(traits);
        if (!kind || kind === 'song' || !found) continue;
        out[kind] = Object.freeze({
            ...(ITEM_LYRICS.has(found.lyrics) ? { lyrics: found.lyrics as ProviderItemKind['lyrics'] } : {}),
            ...(typeof found.likable === 'boolean' ? { likable: found.likable } : {}),
            ...(typeof found.reported === 'boolean' ? { reported: found.reported } : {}),
        });
    }
    return Object.keys(out).length > 0 ? Object.freeze(out) : undefined;
};

export const buildReports = (kit: SourceAdapterKit, reports: FoliumSourceReports): NonNullable<OnlineMusicProvider['playbackReports']> => {
    const canReport = reports.canReport?.bind(reports);
    return {
        ...(canReport ? { canReport: kit.sync('canReport', (song: SongResult) => canReport(toSourceSong(song)), () => false) } : {}),
        reportPlayback: async (song, report) => {
            await kit.run('report', () => reports.report(toSourceSong(song), { ...report }));
        },
    };
};
