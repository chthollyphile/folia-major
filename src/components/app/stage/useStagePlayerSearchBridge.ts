import { useEffect } from 'react';
import { omni } from '../../../services/onlineMusic/omni';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { errorMessage } from '../../../utils/errorText';
import type { StagePlayerSearchRequest, StageSearchResult, UnifiedSong } from '../../../types';

// src/components/app/stage/useStagePlayerSearchBridge.ts
// Answers the Stage API's searches at one omni provider (`POST /stage/player/search` with a
// `provider`): the main process hands them here, where the providers and their sessions live.

// Its own paging, apart from the search page's.
const STAGE_SEARCH_CONTEXT = { session: 'stage-api' };

const toStageSearchResult = (providerId: string, song: UnifiedSong): StageSearchResult => {
    const metadata = getProviderSongMetadata(song, providerId);
    return {
        songId: song.id,
        title: song.name || 'Unknown Song',
        artists: metadata.artists.map(artist => artist.name).filter(Boolean),
        album: metadata.album?.name || '',
        durationMs: metadata.durationMs > 0 ? metadata.durationMs : null,
        coverUrl: metadata.coverUrl || null,
        provider: providerId,
        songRef: `${providerId}:${song.id}`,
    };
};

export const answerStageSearch = async (request: StagePlayerSearchRequest): Promise<void> => {
    try {
        const page = await omni.searchProviderSongs(
            request.providerId,
            request.query,
            { limit: request.limit, offset: 0 },
            STAGE_SEARCH_CONTEXT,
        );
        await window.electron?.completeStagePlayerSearchRequest?.({
            requestId: request.requestId,
            ok: true,
            songs: page.items.map(song => toStageSearchResult(request.providerId, song)),
        });
    } catch (error) {
        console.warn(`[Stage] Failed to search ${request.providerId} for the Stage API`, error);
        await window.electron?.completeStagePlayerSearchRequest?.({
            requestId: request.requestId,
            ok: false,
            error: errorMessage(error),
        });
    }
};

// Listens for the Stage API's provider searches for as long as the app is mounted.
export const useStagePlayerSearchBridge = (): void => {
    useEffect(() => {
        if (!window.electron?.onStagePlayerSearchRequest) {
            return;
        }

        return window.electron.onStagePlayerSearchRequest((request) => {
            void answerStageSearch(request).catch((error) => {
                console.warn('[Stage] Failed to hand a search result back to the Stage API', error);
            });
        });
    }, []);
};
