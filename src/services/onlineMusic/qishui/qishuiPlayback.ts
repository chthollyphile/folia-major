import type { QishuiTrackCheck } from 'qishui-music-api';
import type { OnlinePlaybackProvider, ProviderAudioSource, ProviderSongAvailability } from '../../../types/onlineMusic';
import { normalizeQishuiSong } from './qishuiNormalize';
import { qishuiSongId } from './qishuiMutations';
import { QishuiRequestError, requestQishui } from './qishuiTransport';
import { TAKEN_DOWN_CONFIRMED, TRACK_NOT_RETURNED } from './qishuiSentences';

// Qishui's playback side: one song's detail by id, its plaintext audio address, and its playability checks.
// Explicit playability checks are short-lived account facts; playback failures never change them.
const checks = new Map<string, { at: number; availability: ProviderSongAvailability }>();
let revision = 0;
export function clearQishuiPlayback() { revision++; checks.clear(); }
// The service's own record for one media (`/media/mcheck/`, `check_tracks`): `status` 0 is served, 20 is a
// media it will not serve at all — `/media/mget/` answers with an empty list, so the song has no detail, no
// lyrics read and no address, and `/search/` no longer returns it; 10 ships encrypted audio only, which
// this app never decrypts. `riskResult` is a separate check that answered -2 for every row in the car
// service responses measured so far, so it cannot be the only reading.
const NOT_SERVED_STATUS = 20;
// What the service itself says it will not serve, or null when it says it serves the media.
const statusAvailabilityOf = (status: number): ProviderSongAvailability | null => {
    // The platform's record that the song is not available: the one reason `getAvailability` needs.
    if (status === NOT_SERVED_STATUS) return { state: 'unavailable', reason: 'taken-down' };
    // Encrypted audio only (or a status this file does not know): a restriction, not a takedown.
    if (status !== 0) return { state: 'unknown', reason: 'restricted' };
    return null;
};
// `riskResult` alone: 0 is an explicit pass, a positive code a restriction, and a negative code — what the
// car client answers for every row — says nothing.
const riskAvailabilityOf = (riskResult: number): ProviderSongAvailability | null => {
    if (!Number.isInteger(riskResult) || riskResult < 0) return null;
    return riskResult === 0 ? { state: 'playable' } : { state: 'unknown', reason: 'restricted' };
};
export async function readQishuiSongs(raw: unknown[]) {
    const songs = raw.map(normalizeQishuiSong);
    if (!songs.length) return songs;
    const mine = revision;
    try {
        const data = await requestQishui<{ statuses: QishuiTrackCheck[] }>('check_tracks', { ids: songs.map(song => String(song.id)) });
        if (mine !== revision) return songs;
        const wanted = new Set(songs.map(song => String(song.id)));
        for (const row of data.statuses) {
            if (!wanted.has(row.id)) continue;
            // What the service says it will not serve comes first; `riskResult` still answers for the rest.
            const said = Number.isInteger(row.status) ? statusAvailabilityOf(row.status) : null;
            const availability = said ?? riskAvailabilityOf(row.riskResult);
            if (!availability) continue;
            checks.delete(row.id);
            checks.set(row.id, { at: Date.now(), availability });
        }
        while (checks.size > 500) checks.delete(checks.keys().next().value!);
    } catch (error) {
        // A failed optional check must not hide otherwise readable songs or imply a takedown.
        console.warn('[Qishui] Track availability check failed', error);
    }
    return songs;
}
// The service's own record for one media, asked once after an audio request came back empty: only `status`
// 20 is the service saying it will not serve this media at all (see statusAvailabilityOf above). Any other
// answer, and a failed check, leaves the original failure as it was — an empty audio answer is never on its
// own a takedown, and must not gain the label from a guess.
const notServedByService = async (id: string): Promise<boolean> => {
    try {
        const data = await requestQishui<{ statuses: QishuiTrackCheck[] }>('check_tracks', { ids: [id] });
        return data.statuses.some(row => String(row.id) === id && row.status === NOT_SERVED_STATUS);
    } catch (error) {
        // A failed optional check must not replace the failure that made the address request fail.
        console.warn('[Qishui] Playability re-check failed', error);
        return false;
    }
};
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
    async getAudioSource(song, quality) {
        const id = qishuiSongId(song);
        try { return await requestQishui<ProviderAudioSource>('audio', { id, quality }); }
        catch (error) {
            // The service answered without the media: ask its own record for this one before calling it a
            // takedown. The same sentence is also what a look-up by id means by "missing" (getSongDetail).
            if (!(error instanceof QishuiRequestError) || error.code !== 'not-playable' || error.message !== TRACK_NOT_RETURNED) throw error;
            if (!await notServedByService(id)) throw error;
            throw new QishuiRequestError('not-playable', TAKEN_DOWN_CONFIRMED, null);
        }
    },
    getAvailability(song) {
        const check = checks.get(qishuiSongId(song));
        return check && Date.now() - check.at < 60_000 ? check.availability : { state: 'unknown' };
    },
};
