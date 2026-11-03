import React from 'react';
import { useTranslation } from 'react-i18next';
import { Album, Artist, SongResult, UnifiedSong } from '../../../types';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { getProviderSongMetadata, getProviderSongPageUrl } from '../../../services/onlineMusic/songMetadata';
import { copyText } from '../../../utils/system/clipboard';
import { openOutsideLink } from '../../../utils/system/outsideLink';

// src/components/panelTab/shell/SongCredits.tsx
// The playing song in words, under the large cover: its title, its artists and its album. A click
// on the title copies the song's line, Ctrl+click opens its page on the platform; an artist or the
// album opens its page in the app.

interface SongCreditsProps {
    currentSong: SongResult | null;
    onAlbumSelect: (song: SongResult, album: Album) => void;
    onSelectArtist: (song: SongResult, artist: Artist) => void;
    onOpenCurrentLocalAlbum: () => void;
    onOpenCurrentLocalArtist: (entityId?: string) => void;
    onOpenCurrentNavidromeAlbum: () => void;
    onOpenCurrentNavidromeArtist: () => void;
    onCopySongInfoSuccess: () => void;
}

const LINK_CLASS = 'st-t-fast cursor-pointer transition-colors hover:text-[color:var(--st-t1)]';

const SongCredits: React.FC<SongCreditsProps> = ({
    currentSong,
    onAlbumSelect,
    onSelectArtist,
    onOpenCurrentLocalAlbum,
    onOpenCurrentLocalArtist,
    onOpenCurrentNavidromeAlbum,
    onOpenCurrentNavidromeArtist,
    onCopySongInfoSuccess,
}) => {
    const { t } = useTranslation();
    const isLocalSong = Boolean(currentSong && (((currentSong as any).isLocal === true) || (currentSong as any).localRef?.songId));
    const isNavidromeSong = Boolean(currentSong && (currentSong as any).isNavidrome === true);
    const isStageSong = Boolean(currentSong && (currentSong as any).isStage === true);
    const songMetadata = currentSong ? getProviderSongMetadata(currentSong) : null;
    const displayArtists = songMetadata?.artists || [];
    const displayAlbumName = songMetadata?.album?.name || '';
    const canOpenAlbum = Boolean(currentSong && !isStageSong && (
        isLocalSong
        || isNavidromeSong
        || canResolveSongCatalogRef(currentSong as UnifiedSong, 'album', currentSong.album)
    ));
    const displayArtistNames = displayArtists.map((artist) => artist.name).join(', ');
    const copyTitleLine = currentSong
        ? `${currentSong.name || ''} - ${displayArtistNames} - ${displayAlbumName}`
        : '';
    const songPageUrl = getProviderSongPageUrl(currentSong);
    const copyPayload = copyTitleLine
        ? [copyTitleLine, songPageUrl || ''].filter(Boolean).join('\n')
        : '';
    const canCopySongInfo = Boolean(copyPayload);

    const openProviderSongPage = () => {
        if (!songPageUrl) {
            return;
        }

        void openOutsideLink(songPageUrl).catch((error) => {
            console.error('Failed to open provider song page:', error);
        });
    };

    // Normal click copies song info; Ctrl+click opens the provider song page when available.
    const handleSongTitleClick = (event: React.MouseEvent<HTMLHeadingElement>) => {
        if (event.ctrlKey && songPageUrl) {
            openProviderSongPage();
            return;
        }

        if (!copyPayload) {
            return;
        }

        void copyText(copyPayload)
            .then(() => {
                onCopySongInfoSuccess();
            })
            .catch((error) => {
                console.error('Failed to copy current song info:', error);
            });
    };

    return (
        // A new song's lines come in as a page of the kit does.
        <div key={currentSong?.id ?? ''} className="st-page-in">
            <h2
                className={`line-clamp-2 text-lg font-semibold leading-[26px]${canCopySongInfo ? ' st-t-fast cursor-pointer transition-opacity hover:opacity-80' : ''}`}
                onClick={handleSongTitleClick}
            >
                {currentSong?.name || t('ui.noTrack')}
            </h2>
            {displayArtists.length > 0 && (
                <p className="mt-0.5 truncate text-[13px] leading-5 text-[color:var(--st-t2)]">
                    {displayArtists.map((a, i) => {
                        const canOpenArtist = Boolean(currentSong && !isStageSong && (
                            isLocalSong
                            || isNavidromeSong
                            || canResolveSongCatalogRef(currentSong as UnifiedSong, 'artist', a)
                        ));
                        return (
                            <React.Fragment key={`${a.entityId || a.id}-${i}`}>
                                {i > 0 && <span className="mx-1.5 text-[color:var(--st-t3)]">/</span>}
                                <span
                                    className={canOpenArtist ? LINK_CLASS : undefined}
                                    onClick={() => {
                                        if (!canOpenArtist) {
                                            return;
                                        }
                                        if (isLocalSong) {
                                            onOpenCurrentLocalArtist(a.entityId);
                                            return;
                                        }
                                        if (isNavidromeSong) {
                                            onOpenCurrentNavidromeArtist();
                                            return;
                                        }
                                        if (currentSong) onSelectArtist(currentSong, a);
                                    }}
                                >
                                    {a.name}
                                </span>
                            </React.Fragment>
                        );
                    })}
                </p>
            )}
            {displayAlbumName && (
                <p className="truncate text-xs leading-[18px] text-[color:var(--st-t3)]">
                    <span
                        className={canOpenAlbum ? LINK_CLASS : undefined}
                        onClick={() => {
                            if (!canOpenAlbum) {
                                return;
                            }
                            if (isLocalSong) {
                                onOpenCurrentLocalAlbum();
                                return;
                            }
                            if (isNavidromeSong) {
                                onOpenCurrentNavidromeAlbum();
                                return;
                            }
                            const album = currentSong?.album;
                            if (currentSong && album) onAlbumSelect(currentSong, album);
                        }}
                    >
                        {displayAlbumName}
                    </span>
                </p>
            )}
        </div>
    );
};

export default SongCredits;
