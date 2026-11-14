import type { SongResult } from '@/types';
import type {
    AudioQualityPreference,
    OnlineExternalPlaybackProvider,
    OnlineMusicProvider,
    OnlinePlaybackProvider,
    OnlineSearchProvider,
    ProviderAudioSource,
    ProviderSongAvailability,
} from '@/types/onlineMusic';
import type {
    FoliumSourceAudioPlayback,
    FoliumSourceExternalPlayback,
    FoliumSourceReports,
    FoliumSourceSearch,
    FoliumSourceSongs,
} from '../../sources/contract';
import { toHostPage, toSourceSong } from '../sourceDtos';
import i18n from '@/i18n/config';
import { finite, list, record, type SourceAdapterKit } from './kit';

// src/mods/folium/registries/sourceAdapter/playback.ts
// search@1, songs@1 with playback.audio@1 (one internal `playback` object between them, matrix §4.2),
// playback.external@1 and reports@1, as the host's internal sub-objects.

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
        ...(keepAudio ? { keepAudio: async (url) => Boolean(await kit.run('keepAudio', () => keepAudio(url))) } : {}),
        ...(hasKeptAudio ? { hasKeptAudio: async (url) => Boolean(await kit.run('hasKeptAudio', () => hasKeptAudio(url))) } : {}),
    };
    // Read where the host reads them, so a getter of the source's answers for its account now.
    Object.defineProperties(playback, {
        songDetailsPerRequest: { enumerable: true, get: () => songs?.songsPerRequest },
        audioQualityLevels: { enumerable: true, get: () => audio?.audioQualityLevels },
        previewNoticeKey: { enumerable: true, get: () => (audio?.previewNotice === undefined ? undefined : kit.key(audio.previewNotice, 'previewNotice')) },
    });
    return playback;
};

export const buildExternal = (kit: SourceAdapterKit, external: FoliumSourceExternalPlayback): OnlineExternalPlaybackProvider => {
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
    };
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
