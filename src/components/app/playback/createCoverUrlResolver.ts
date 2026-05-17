import type { SongResult } from '../../../types';
import { toSafeRemoteUrl } from '../../../utils/appPlaybackHelpers';

// src/components/app/playback/createCoverUrlResolver.ts

// Resolves the effective cover URL by preferring the cached cover over remote metadata.
export const createCoverUrlResolver = (
    cachedCoverUrl: string | null,
    currentSong: SongResult | null,
) => {
    return () => {
        if (cachedCoverUrl) return cachedCoverUrl;
        let url = null;
        if (currentSong?.al?.picUrl) url = currentSong.al.picUrl;
        else if (currentSong?.album?.picUrl) url = currentSong.album.picUrl;
        return toSafeRemoteUrl(url) || null;
    };
};
