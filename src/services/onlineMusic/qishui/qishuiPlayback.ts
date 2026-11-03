import type { QishuiTrackCheck } from 'qishui-music-api';
import type { OnlinePlaybackProvider, ProviderAudioSource, ProviderSongAvailability } from '../../../types/onlineMusic';
import { normalizeQishuiSong } from './qishuiNormalize';
import { qishuiSongId } from './qishuiMutations';
import { QishuiRequestError, requestQishui } from './qishuiTransport';

// Qishui's playback side: one song's detail by id, its plaintext audio address, and its playability checks.
// Explicit playability checks are short-lived account facts; playback failures never change them.
const checks = new Map<string, { at: number; availability: ProviderSongAvailability }>();
let revision = 0;
export function clearQishuiPlayback() { revision++; checks.clear(); }
export async function readQishuiSongs(raw: unknown[]) {
    const songs = raw.map(normalizeQishuiSong);
    if (!songs.length) return songs;
    const mine = revision;
    try {
        const data = await requestQishui<{ statuses: QishuiTrackCheck[] }>('check_tracks', { ids: songs.map(song => String(song.id)) });
        if (mine !== revision) return songs;
        const wanted = new Set(songs.map(song => String(song.id)));
        for (const row of data.statuses) {
            if (!wanted.has(row.id) || !Number.isInteger(row.riskResult) || row.riskResult < 0) continue;
            checks.delete(row.id);
            checks.set(row.id, { at: Date.now(), availability: row.riskResult === 0
                ? { state: 'playable' } : { state: 'unknown', reason: 'restricted' } });
        }
        while (checks.size > 500) checks.delete(checks.keys().next().value!);
    } catch (error) {
        // A failed optional check must not hide otherwise readable songs or imply a takedown.
        console.warn('[Qishui] Track availability check failed', error);
    }
    return songs;
}
// The package's sentence when the service answered a look-up without the track (qishui-music-api@0.2.1,
// src/catalog.cjs `track`). For song_detail it is the only not-playable there is: the other failures of
// that operation are network, auth-required, unavailable or invalid-response.
const TRACK_NOT_RETURNED = 'Qishui did not return the track';
export const qishuiPlayback: OnlinePlaybackProvider = {
    audioQualityLevels: ['standard'],
    // A VIP song's clip plays because third-party players get its whole audio encrypted only, not because of the account.
    previewNoticeKey: 'status.songVipFullUnavailable',
    async getSongDetail(id) {
        let raw: unknown;
        try { raw = await requestQishui('song_detail', { id: String(id) }); }
        catch (error) {
            // Qishui answered and has no such track: the song is missing, the request did not fail.
            if (error instanceof QishuiRequestError && error.code === 'not-playable' && error.message === TRACK_NOT_RETURNED) return null;
            throw error;
        }
        return (await readQishuiSongs([raw]))[0];
    },
    getAudioSource: (song, quality) => requestQishui<ProviderAudioSource>('audio', { id: qishuiSongId(song), quality }),
    getAvailability(song) {
        const check = checks.get(qishuiSongId(song));
        return check && Date.now() - check.at < 60_000 ? check.availability : { state: 'unknown' };
    },
};
