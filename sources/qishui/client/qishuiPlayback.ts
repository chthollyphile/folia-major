import type {
    FoliumSourceAudio,
    FoliumSourceAudioPlayback,
    FoliumSourceSong,
    FoliumSourceSongAvailability,
    FoliumSourceSongs,
    FoliumText,
} from '@folia/folium';
import type { QishuiTrackCheck } from 'qishui-music-api';
import { normalizeQishuiSong } from './qishuiNormalize';
import { qishuiRefusalOf, requestQishui } from './qishuiTransport';

// sources/qishui/client/qishuiPlayback.ts
// 汽水的播放面：按 id 读一首歌、它的明文音频地址、以及能不能播的检查（songs@1 + playback.audio@1）。
// 明确的可播检查是短命的账号事实（一分钟）；播放失败从不改它们。

const PLAYABLE = Object.freeze({ state: 'playable' } as const);
const RESTRICTED = Object.freeze({ state: 'unknown', reason: 'restricted' } as const);
const UNKNOWN = Object.freeze({ state: 'unknown' } as const);
const checks = new Map<string, { at: number; availability: FoliumSourceSongAvailability }>();
let revision = 0;
export function clearQishuiPlayback() { revision++; checks.clear(); }

/** Songs from raw track records, with their playability checked in one request where that can be read. */
export async function readQishuiSongs(raw: unknown[]): Promise<FoliumSourceSong[]> {
    const songs = raw.map(normalizeQishuiSong);
    if (!songs.length) return songs;
    const mine = revision;
    try {
        const data = await requestQishui<{ statuses: QishuiTrackCheck[] }>('check_tracks', { ids: songs.map(song => song.id) });
        if (mine !== revision) return songs;
        const wanted = new Set(songs.map(song => song.id));
        for (const row of data.statuses) {
            if (!wanted.has(row.id) || !Number.isInteger(row.riskResult) || row.riskResult < 0) continue;
            checks.delete(row.id);
            checks.set(row.id, { at: Date.now(), availability: row.riskResult === 0 ? PLAYABLE : RESTRICTED });
        }
        while (checks.size > 500) checks.delete(checks.keys().next().value!);
    } catch (error) {
        // A failed optional check must not hide otherwise readable songs or imply a takedown.
        console.warn('[Qishui] Track availability check failed', error);
    }
    return songs;
}

// The package's sentence when the service answered a look-up without the track (qishui-music-api@0.2.2,
// src/catalog.cjs `track`). For song_detail it is the only not-playable there is: the other failures of
// that operation are network, auth-required, unavailable or invalid-response.
const TRACK_NOT_RETURNED = 'Qishui did not return the track';

export const qishuiSongs: FoliumSourceSongs = {
    async getSong(id) {
        let raw: unknown;
        try { raw = await requestQishui('song_detail', { id }); }
        catch (error) {
            // Qishui answered and has no such track: the song is missing, the request did not fail.
            const code = (error as { code?: unknown } | null)?.code;
            if (qishuiRefusalOf(error) && code === 'not-playable' && (error as Error).message === TRACK_NOT_RETURNED) return null;
            throw error;
        }
        return (await readQishuiSongs([raw]))[0];
    },
    getAvailability(song) {
        const check = checks.get(song.id);
        return check && Date.now() - check.at < 60_000 ? check.availability : UNKNOWN;
    },
    getPageUrl: song => `https://music.douyin.com/qishui/share/track?track_id=${encodeURIComponent(song.id)}`,
};

/**
 * playback.audio@1. A VIP song's clip plays because third-party players get its whole audio encrypted only, not
 * because of the account: the notice says so in the mod's own words.
 */
export const createQishuiAudio = (previewNotice: FoliumText): FoliumSourceAudioPlayback => ({
    audioQualityLevels: ['standard'],
    previewNotice,
    getAudioSource: (song, quality) => requestQishui<FoliumSourceAudio>('audio', { id: song.id, quality }),
});
