import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { SongResult } from '../../types';

interface CoverTabProps {
    currentSong: SongResult | null;
    onAlbumSelect: (albumId: number) => void;
    onSelectArtist: (artistId: number) => void;
    onOpenCurrentLocalAlbum: () => void;
    onOpenCurrentLocalArtist: (entityId?: string) => void;
    onOpenCurrentNavidromeAlbum: () => void;
    onOpenCurrentNavidromeArtist: () => void;
    onCopySongInfoSuccess: () => void;
}

const CoverTab: React.FC<CoverTabProps> = ({
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
    const displayArtists = currentSong?.ar?.length ? currentSong.ar : (currentSong?.artists || []);
    const displayAlbumName = currentSong?.al?.name || currentSong?.album?.name || '';
    const displayArtistNames = displayArtists.map((artist) => artist.name).join(', ');
    const copyTitleLine = currentSong
        ? `${currentSong.name || ''} - ${displayArtistNames} - ${displayAlbumName}`
        : '';
    const neteaseSongId = !isLocalSong && !isNavidromeSong && !isStageSong ? currentSong?.id : undefined;
    const copyPayload = copyTitleLine
        ? [copyTitleLine, neteaseSongId ? `https://music.163.com/#/song?id=${neteaseSongId}` : ''].filter(Boolean).join('\n')
        : '';
    const canCopySongInfo = Boolean(copyPayload);
    const neteaseSongUrl = neteaseSongId ? `https://music.163.com/#/song?id=${neteaseSongId}` : '';

    const copyText = async (text: string) => {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
    };

    const openNeteaseSongPage = () => {
        if (!neteaseSongUrl) {
            return;
        }

        const openSongPage = window.electron?.openExternalUrl
            ? window.electron.openExternalUrl(neteaseSongUrl)
            : Promise.resolve(Boolean(window.open(neteaseSongUrl, '_blank', 'noopener,noreferrer')));

        void openSongPage.catch((error) => {
            console.error('Failed to open Netease song page:', error);
        });
    };

    // Normal click copies song info; Ctrl+click opens the matched Netease song page when available.
    const handleSongTitleClick = (event: React.MouseEvent<HTMLHeadingElement>) => {
        if (event.ctrlKey && neteaseSongUrl) {
            openNeteaseSongPage();
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
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center text-center space-y-4 mt-4"
        >
            <div className="space-y-1 relative w-full">
                <div className="flex items-start justify-center gap-2">
                    <h2
                        className={canCopySongInfo
                            ? 'text-2xl font-bold line-clamp-2 cursor-pointer hover:opacity-80 transition-opacity'
                            : 'text-2xl font-bold line-clamp-2'}
                        onClick={handleSongTitleClick}
                    >
                        {currentSong?.name || t('ui.noTrack')}
                    </h2>
                </div>
                <div className="text-sm opacity-60 space-y-1">
                    <div className="font-medium">
                        {displayArtists.map((a, i) => (
                            <React.Fragment key={`${a.entityId || a.id}-${i}`}>
                                {i > 0 && ", "}
                                <span
                                    className={isStageSong ? '' : 'cursor-pointer hover:underline hover:opacity-100 transition-opacity'}
                                    onClick={() => {
                                        if (isStageSong) {
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
                                        onSelectArtist(a.id);
                                    }}
                                >
                                    {a.name}
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                    <div
                        className={isStageSong ? 'opacity-60' : 'opacity-60 cursor-pointer hover:opacity-100 hover:underline transition-all'}
                        onClick={() => {
                            if (isStageSong) {
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
                            const albumId = currentSong?.al?.id || currentSong?.album?.id;
                            if (albumId) {
                                onAlbumSelect(albumId);
                            }
                        }}
                    >
                        {displayAlbumName}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default CoverTab;
