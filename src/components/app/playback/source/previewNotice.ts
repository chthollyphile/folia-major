import { omni } from '../../../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { askedSongKeyRef, startOfAskedSong } from '../currentSong';

// src/components/app/playback/source/previewNotice.ts
// The notice for an online song whose platform gave this account a preview clip of it: the clip
// plays, and this says so (with the platform's mark).
//
// Told from one place, the player starting to play: the active deck's `playing` (App.tsx), with the
// address it plays. So every route that hands the player a clip is covered (a play, the restore of
// the last song, the next song of a blend, which plays the prefetched address), and the notice
// shows when the clip is heard, not when it is loaded: a restore that does not play shows nothing
// until play is pressed. Once per start of a song (`startOfAskedSong`): a pause, a stall, the
// recovery giving the same song a new address, or a blend cancelled back onto the song does not
// tell it again; playing the song again does.

// The start of each song the notice was told for, a few songs back: a cancelled blend puts back the
// song before the one it was going to.
const told = new Map<string, number>();
const TOLD_LIMIT = 8;

const addressOf = (url: string): string => {
    try {
        return new URL(url).href;
    } catch {
        return url;
    }
};

/** The active deck started playing `src`: tells the listener once per start of a song if it is a preview clip. */
export const notePreviewPlaying = (src: string, t: (key: string) => string): void => {
    if (!src || !omni.isPreviewAudioSource(src)) return;
    // Only what the store shows and asks for, from the address it names. Between a new song being
    // asked for and its address being written, the deck can still report `playing` for the source
    // before it; that is not the new song's start, and must not use its notice up.
    const { currentSong, audioSrc } = usePlaybackStore.getState();
    const songKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    if (!songKey || songKey !== askedSongKeyRef.current || !audioSrc || addressOf(audioSrc) !== addressOf(src)) return;
    const start = startOfAskedSong();
    if (told.get(songKey) === start) return;
    told.delete(songKey);
    told.set(songKey, start);
    while (told.size > TOLD_LIMIT) {
        const oldest = told.keys().next().value;
        if (oldest === undefined) break;
        told.delete(oldest);
    }
    const providerId = getOnlineProviderIdForSong(currentSong);
    setStatusMessage({
        type: 'info',
        text: t(providerId ? omni.previewNoticeKey(providerId) : 'status.songPreviewOnly'),
        ...(providerId ? { providerId } : {}),
    });
};
