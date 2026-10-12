import i18n from '../i18n/config';
import type { SongResult } from '../types';
import type { PlaybackNavigationOptions } from '../types/appPlayback';
import type { ProviderCollection } from '../types/onlineMusic';
import { useHeartbeatModeStore, type HeartbeatSession } from '../stores/useHeartbeatModeStore';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { getPlaybackSongKey, getPlaybackSourceRef, isSamePlaybackSong } from '../utils/appPlaybackGuards';
import { omni } from './onlineMusic/omni';
import { isSongUnavailable } from './onlineMusic/songAvailability';

// src/services/heartbeatPlayback.ts
// Owns the liked-playlist seed and async lifetime of Heartbeat recommendations. All provider IO uses Omni.

type PlaySong = (song: SongResult, queue?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => void | Promise<void>;
const notice = (key: string, type: 'info' | 'error' = 'info') => setStatusMessage({ type, text: i18n.t(`heartbeat.${key}`) });

const currentOwner = () => {
    const { activeProviderId: providerId, accounts } = useOnlineProviderAccountStore.getState();
    const account = accounts[providerId];
    return account?.status === 'authenticated' && account.user ? { providerId, userId: account.user.id, account } : null;
};
const currentSongKey = () => {
    const song = usePlaybackStore.getState().currentSong;
    return song ? getPlaybackSongKey(song) : null;
};

export const canStartHeartbeatMode = (): boolean => {
    const owner = currentOwner();
    if (!owner || usePlaybackStore.getState().activePlaybackContext !== 'main') return false;
    try { return Boolean(omni.getProviderCapabilities(owner.providerId).heartbeatRecommendations); }
    catch { return false; } // An account can outlive a removed provider registration.
};

const ownsSession = (session: Pick<HeartbeatSession, 'id' | 'providerId' | 'userId'>): boolean => {
    const owner = currentOwner();
    return useHeartbeatModeStore.getState().generation === session.id
        && owner?.providerId === session.providerId && String(owner.userId) === String(session.userId)
        && usePlaybackStore.getState().activePlaybackContext === 'main';
};

export const stopHeartbeatMode = (): void => {
    useHeartbeatModeStore.getState().stop();
};

const ownLikedPlaylist = (collection: ProviderCollection, providerId: string): boolean => (
    collection.providerId === providerId && collection.type === 'playlist' && collection.isLiked === true
);

const uniqueSongs = (songs: SongResult[], providerId: string, existing: SongResult[] = []): SongResult[] => {
    const seen = new Set(existing.map(getPlaybackSongKey));
    return songs.filter(song => {
        const source = getPlaybackSourceRef(song);
        const key = getPlaybackSongKey(song);
        if (source.kind !== 'online' || source.providerId !== providerId || seen.has(key) || isSongUnavailable(song)) return false;
        seen.add(key);
        return true;
    });
};

/** Starting is transactional: an empty/failed response never replaces the user's current queue. */
export async function startHeartbeatMode(playSong: PlaySong): Promise<boolean> {
    if (!canStartHeartbeatMode() || useHeartbeatModeStore.getState().loading) return false;
    const owner = currentOwner()!;
    const startingPlayback = usePlaybackStore.getState();
    const previous = useHeartbeatModeStore.getState();
    const originalPlayback = previous.originalPlayback ?? (previous.pendingReturn
        ? { queue: previous.pendingReturn.originalQueue, currentSong: previous.pendingReturn.originalCurrentSong }
        : { queue: [...startingPlayback.playQueue], currentSong: startingPlayback.currentSong });
    const startingSongKey = currentSongKey();
    const id = useHeartbeatModeStore.getState().begin();
    const sessionOwner = { id, providerId: owner.providerId, userId: owner.userId };
    const isStartCurrent = () => ownsSession(sessionOwner)
        && currentSongKey() === startingSongKey
        && usePlaybackStore.getState().playQueue === startingPlayback.playQueue;
    notice('loading');
    try {
        let playlist = owner.account.collections.find(item => ownLikedPlaylist(item, owner.providerId));
        let offset = 0;
        while (!playlist) {
            const page = await omni.getUserPlaylists(owner.userId, { limit: 100, offset });
            if (!isStartCurrent()) return false;
            playlist = page.items.find(item => ownLikedPlaylist(item, owner.providerId));
            if (!page.hasMore || page.nextOffset <= offset) break;
            offset = page.nextOffset;
        }
        if (!playlist) { notice('emptyLikes', 'error'); return false; }
        const page = await omni.getCollectionTracks(playlist, { limit: 100, offset: 0 });
        if (!isStartCurrent()) return false;
        const candidates = uniqueSongs(page.items, owner.providerId);
        const playing = usePlaybackStore.getState().currentSong;
        const seed = candidates.find(song => playing && isSamePlaybackSong(song, playing))
            ?? candidates[Math.floor(Math.random() * candidates.length)];
        if (!seed) { notice('emptyLikes', 'error'); return false; }
        const seedId = getPlaybackSourceRef(seed).mediaId;
        const session: HeartbeatSession = { ...sessionOwner, playlistId: playlist.id, seedSongId: seedId, startSongId: seedId };
        const songs = await omni.getHeartbeatSongs(session);
        if (!isStartCurrent()) return false;
        const recommendations = uniqueSongs(songs, owner.providerId, [seed]);
        if (!recommendations.length) { notice('emptyRecommendations', 'error'); return false; }
        useHeartbeatModeStore.setState({ session, loading: false });
        const queue = [seed, ...recommendations];
        let committed = false;
        const stopObserving = usePlaybackStore.subscribe(playback => {
            if (playback.playQueue.length === queue.length
                && queue.every((song, index) => isSamePlaybackSong(song, playback.playQueue[index]))) {
                committed = true;
                if (ownsSession(session)) useHeartbeatModeStore.setState({ originalPlayback });
            }
        });
        try { await playSong(seed, queue, false, { heartbeatSessionId: id }); }
        finally { stopObserving(); }
        if (!ownsSession(session)) return false;
        if (!committed) {
            // playSong may decline a play (extension hook, unavailable audio or replacement prompt).
            // Keep its own error and leave the original queue alone instead of announcing success.
            stopHeartbeatMode();
            return false;
        }
        notice('started');
        return true;
    } catch {
        if (isStartCurrent()) { stopHeartbeatMode(); notice('failed', 'error'); }
        return false;
    } finally {
        if (useHeartbeatModeStore.getState().generation === id) useHeartbeatModeStore.setState({ loading: false });
    }
}

let refill: { id: number; queue: SongResult[]; songKey: string | null; promise: Promise<SongResult[] | null> } | null = null;

/** A late request cannot append into a replaced queue, another account or a stopped session. */
export function refillHeartbeatQueue(queue: SongResult[]): Promise<SongResult[] | null> {
    const session = useHeartbeatModeStore.getState().session;
    if (!session || !ownsSession(session) || !queue.length) return Promise.resolve(null);
    const songKey = currentSongKey();
    if (refill?.id === session.id && refill.queue === queue && refill.songKey === songKey) return refill.promise;
    const isCurrent = () => ownsSession(session) && usePlaybackStore.getState().playQueue === queue
        && currentSongKey() === songKey;
    const promise = (async () => {
        try {
            const songs = await omni.getHeartbeatSongs({ ...session, seedSongId: getPlaybackSourceRef(queue[queue.length - 1]).mediaId });
            if (!isCurrent()) return null;
            const additions = uniqueSongs(songs, session.providerId, queue);
            if (!additions.length) notice('emptyRecommendations', 'error');
            return additions.length ? [...queue, ...additions] : queue;
        } catch {
            if (!isCurrent()) return null;
            notice('failed', 'error');
            return queue;
        } finally {
            if (refill?.id === session.id && refill.queue === queue && refill.songKey === songKey) refill = null;
        }
    })();
    refill = { id: session.id, queue, songKey, promise };
    return promise;
}

/** Synchronous subscriptions close sessions before a provider/logout or Stage transition can finish an old request. */
export function watchHeartbeatLifetime(): () => void {
    let ownerKey = ownerIdentity();
    const invalidate = () => {
        const state = useHeartbeatModeStore.getState();
        const playback = usePlaybackStore.getState();
        if (state.session && (!ownsSession(state.session) || playback.isFmMode)) stopHeartbeatMode();
        else if (state.loading && !canStartHeartbeatMode()) stopHeartbeatMode();
    };
    const offAccount = useOnlineProviderAccountStore.subscribe(() => {
        const nextOwnerKey = ownerIdentity();
        if (nextOwnerKey !== ownerKey) stopHeartbeatMode();
        ownerKey = nextOwnerKey;
        invalidate();
    });
    const offPlayback = usePlaybackStore.subscribe((playback, previous) => {
        const pending = useHeartbeatModeStore.getState().pendingReturn;
        if (pending && (playback.activePlaybackContext !== 'main' || playback.isFmMode
            || !playback.currentSong || getPlaybackSongKey(playback.currentSong) !== pending.songKey)) {
            useHeartbeatModeStore.setState({ pendingReturn: null });
        }
        const session = useHeartbeatModeStore.getState().session;
        if (session && playback.currentSong !== previous.currentSong && playback.currentSong) {
            const source = getPlaybackSourceRef(playback.currentSong);
            if (source.kind !== 'online' || source.providerId !== session.providerId) stopHeartbeatMode();
        }
        invalidate();
    });
    return () => { offAccount(); offPlayback(); stopHeartbeatMode(); };
}

function ownerIdentity(): string | null {
    const owner = currentOwner();
    return owner ? JSON.stringify([owner.providerId, String(owner.userId)]) : null;
}
