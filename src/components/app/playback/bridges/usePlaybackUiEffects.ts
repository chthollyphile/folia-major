import { useEffect } from 'react';
import type React from 'react';

// App-level UI side effects that do not own playback business logic.
type UsePlaybackUiEffectsOptions = {

    loadLocalSongs: () => void | Promise<void>;
    loadFoliaPlaylists: () => Promise<void>;
    localMusicUpdatedEvent: string;
    blobUrlRef: React.RefObject<string | null>;
    volumePreviewFrameRef: React.RefObject<number | null>;
    onClearPendingUnavailableSkip?: () => void;
};

export const usePlaybackUiEffects = ({
    loadLocalSongs,
    loadFoliaPlaylists,
    localMusicUpdatedEvent,
    blobUrlRef,
    volumePreviewFrameRef,
    onClearPendingUnavailableSkip,
}: UsePlaybackUiEffectsOptions) => {
    useEffect(() => {
        const handleLocalMusicUpdated = () => {
            void loadLocalSongs();
            void loadFoliaPlaylists();
        };

        window.addEventListener(localMusicUpdatedEvent, handleLocalMusicUpdated);
        return () => window.removeEventListener(localMusicUpdatedEvent, handleLocalMusicUpdated);
    }, [loadFoliaPlaylists, loadLocalSongs, localMusicUpdatedEvent]);

    useEffect(() => {
        return () => {
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
            }
            if (volumePreviewFrameRef.current !== null) {
                cancelAnimationFrame(volumePreviewFrameRef.current);
            }
        };
    }, [blobUrlRef, volumePreviewFrameRef]);

    useEffect(() => {
        return () => onClearPendingUnavailableSkip?.();
    }, [onClearPendingUnavailableSkip]);
};
