import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LocalPlaylist, NeteasePlaylist, SongResult } from '../../types';
import PlaylistSelectionDialog from '../shared/PlaylistSelectionDialog';

interface CoverTabProps {
    currentSong: SongResult | null;
    onAlbumSelect: (albumId: number) => void;
    onSelectArtist: (artistId: number) => void;
    localPlaylists: LocalPlaylist[];
    neteasePlaylists: NeteasePlaylist[];
    onAddCurrentSongToLocalPlaylist: (playlistId: string) => Promise<void>;
    onAddCurrentSongToNeteasePlaylist: (playlistId: number) => Promise<void>;
    onOpenCurrentLocalAlbum: () => void;
    onOpenCurrentLocalArtist: () => void;
    isDaylight?: boolean;
    openPlaylistPickerSignal?: number;
}

const CoverTab: React.FC<CoverTabProps> = ({
    currentSong,
    onAlbumSelect,
    onSelectArtist,
    localPlaylists,
    neteasePlaylists,
    onAddCurrentSongToLocalPlaylist,
    onAddCurrentSongToNeteasePlaylist,
    onOpenCurrentLocalAlbum,
    onOpenCurrentLocalArtist,
    isDaylight = false,
    openPlaylistPickerSignal = 0,
}) => {
    const { t } = useTranslation();
    const [isPlaylistPickerOpen, setIsPlaylistPickerOpen] = React.useState(false);
    const lastHandledOpenSignalRef = React.useRef(openPlaylistPickerSignal);
    const isLocalSong = Boolean(currentSong && (((currentSong as any).isLocal === true) || (currentSong as any).localData));
    const isNavidromeSong = Boolean(currentSong && (currentSong as any).isNavidrome === true);
    const isNeteaseSong = Boolean(currentSong && !isLocalSong && !isNavidromeSong);
    const availablePlaylists = React.useMemo(() => {
        if (isLocalSong) {
            return localPlaylists.map((playlist) => ({
                id: playlist.id,
                name: playlist.name,
                description: `${playlist.songIds.length} ${t('playlist.tracks')}`,
            }));
        }

        if (isNeteaseSong) {
            return neteasePlaylists.map((playlist) => ({
                id: playlist.id,
                name: playlist.name,
                description: `${playlist.trackCount || 0} ${t('playlist.tracks')}`,
            }));
        }

        return [];
    }, [isLocalSong, isNeteaseSong, localPlaylists, neteasePlaylists, t]);

    React.useEffect(() => {
        if (openPlaylistPickerSignal === lastHandledOpenSignalRef.current) {
            return;
        }

        lastHandledOpenSignalRef.current = openPlaylistPickerSignal;

        if (openPlaylistPickerSignal > 0 && availablePlaylists.length > 0) {
            setIsPlaylistPickerOpen(true);
        }
    }, [availablePlaylists.length, openPlaylistPickerSignal]);

    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center text-center space-y-4 mt-4"
            >
                <div className="space-y-1 relative w-full">
                    <div className="flex items-start justify-center gap-2">
                        <h2 className="text-2xl font-bold line-clamp-2">{currentSong?.name || t('ui.noTrack')}</h2>
                    </div>
                    <div className="text-sm opacity-60 space-y-1">
                        <div className="font-medium">
                            {currentSong?.ar?.map((a, i) => (
                                <React.Fragment key={a.id}>
                                    {i > 0 && ", "}
                                    <span
                                        className="cursor-pointer hover:underline hover:opacity-100 transition-opacity"
                                        onClick={() => {
                                            if (isLocalSong) {
                                                onOpenCurrentLocalArtist();
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
                            className="opacity-60 cursor-pointer hover:opacity-100 hover:underline transition-all"
                            onClick={() => {
                                if (isLocalSong) {
                                    onOpenCurrentLocalAlbum();
                                    return;
                                }
                                if (currentSong?.al?.id || currentSong?.album?.id) {
                                    onAlbumSelect(currentSong?.al?.id || currentSong?.album?.id);
                                }
                            }}
                        >
                            {currentSong?.al?.name || currentSong?.album?.name}
                        </div>
                    </div>
                </div>
            </motion.div>

            <PlaylistSelectionDialog
                isOpen={isPlaylistPickerOpen}
                onClose={() => setIsPlaylistPickerOpen(false)}
                isDaylight={isDaylight}
                title={t('localMusic.addToPlaylist') || '添加到歌单'}
                description={t('home.playlists') || 'Playlists'}
                playlists={availablePlaylists}
                onSelect={async (playlistId) => {
                    try {
                        if (isLocalSong) {
                            await onAddCurrentSongToLocalPlaylist(String(playlistId));
                            return;
                        }

                        if (isNeteaseSong) {
                            await onAddCurrentSongToNeteasePlaylist(Number(playlistId));
                        }
                    } catch (error) {
                        console.error('Failed to add song to playlist', error);
                    }
                }}
            />
        </>
    );
};

export default CoverTab;
