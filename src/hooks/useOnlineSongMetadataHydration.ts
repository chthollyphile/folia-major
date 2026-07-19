import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SongResult, UnifiedSong } from '../types';
import { getOnlineMusicProvider } from '../services/onlineMusic/providerRegistry';

// src/hooks/useOnlineSongMetadataHydration.ts

const isSameOnlineSong = (left: SongResult | null, right: SongResult): boolean => {
    const leftRef = left?.sourceRef;
    const rightRef = right.sourceRef;
    return leftRef?.kind === 'online'
        && rightRef?.kind === 'online'
        && leftRef.providerId === rightRef.providerId
        && String(leftRef.mediaId) === String(rightRef.mediaId);
};

// Hydrates provider-owned display metadata without allowing an older request to replace a newer song.
export const useOnlineSongMetadataHydration = (
    currentSong: SongResult | null,
    setCurrentSong: Dispatch<SetStateAction<SongResult | null>>,
): void => {
    const attemptedSongRef = useRef<SongResult | null>(null);

    useEffect(() => {
        if (!currentSong || attemptedSongRef.current === currentSong) return;

        const sourceRef = currentSong.sourceRef;
        if (sourceRef?.kind !== 'online') return;

        const catalog = getOnlineMusicProvider(sourceRef.providerId)?.catalog;
        const resolver = catalog?.resolveSongCatalogRefs;
        if (!resolver || catalog?.canResolveSongCatalogRefs?.(currentSong as UnifiedSong) === false) return;

        attemptedSongRef.current = currentSong;
        let cancelled = false;

        void resolver(currentSong as UnifiedSong)
            .then(resolvedSong => {
                if (cancelled || resolvedSong === currentSong) return;

                setCurrentSong(existingSong => {
                    if (!existingSong || !isSameOnlineSong(existingSong, currentSong)) return existingSong;

                    const hydratedSong: SongResult = {
                        ...existingSong,
                        ...resolvedSong,
                        album: { ...existingSong.album, ...resolvedSong.album },
                        al: resolvedSong.al
                            ? { ...existingSong.al, ...resolvedSong.al }
                            : existingSong.al,
                    };
                    attemptedSongRef.current = hydratedSong;
                    return hydratedSong;
                });
            })
            .catch(error => {
                console.warn('[OnlineMetadata] Failed to hydrate current song metadata:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [currentSong, setCurrentSong]);
};
