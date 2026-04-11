import React, { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { NavidromeConfig, SubsonicAlbum, SubsonicArtist, SubsonicSong } from '../../types/navidrome';
import { navidromeApi } from '../../services/navidromeService';
import { Theme } from '../../types';
import NavidromeCollectionView from './NavidromeCollectionView';
import { createCoverPlaceholder } from '../../utils/coverPlaceholders';

interface NavidromeArtistViewProps {
    artist: SubsonicArtist;
    config: NavidromeConfig;
    onBack: () => void;
    onPlaySong: (song: any, queue?: any[]) => void;
    onAddAllToQueue?: (songs: any[]) => void;
    onSelectAlbum?: (albumId: string) => void;
    availablePlaylists?: Array<{ id: string | number; name: string; description?: string; }>;
    onAddToPlaylist?: (playlistId: string | number, songs: any[]) => Promise<void> | void;
    onCreatePlaylist?: (name: string, songs: any[]) => Promise<void> | void;
    theme: Theme;
    isDaylight: boolean;
}

const NavidromeArtistView: React.FC<NavidromeArtistViewProps> = ({
    artist,
    config,
    onBack,
    onPlaySong,
    onAddAllToQueue,
    onSelectAlbum,
    availablePlaylists = [],
    onAddToPlaylist,
    onCreatePlaylist,
    theme,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const [songs, setSongs] = useState<SubsonicSong[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const coverUrl = createCoverPlaceholder(artist.name, 'artist');

    useEffect(() => {
        const loadArtistSongs = async () => {
            setIsLoading(true);
            try {
                const artistDetail = await navidromeApi.getArtist(config, artist.id);
                const albums = artistDetail?.album || [];
                const albumResults = await Promise.all(albums.map(album => navidromeApi.getAlbum(config, album.id)));
                const nextSongs = albumResults.flatMap(album => album?.song || []);
                setSongs(nextSongs);
            } catch (error) {
                console.error('[NavidromeArtistView] Failed to load artist songs', error);
            } finally {
                setIsLoading(false);
            }
        };

        void loadArtistSongs();
    }, [artist.id, config]);

    if (isLoading) {
        const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
        const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20';
        const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';

        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={`fixed inset-0 z-50 flex items-center justify-center ${glassBg} font-sans`}
                style={{ color: 'var(--text-primary)' }}
            >
                <div className={`w-full h-full md:max-w-6xl md:h-[90vh] ${panelBg} md:rounded-3xl relative flex items-center justify-center`}>
                    <button
                        onClick={onBack}
                        className={`fixed md:absolute top-6 left-6 z-30 w-10 h-10 rounded-full ${closeBtnBg} flex items-center justify-center transition-colors backdrop-blur-md`}
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <div className="flex flex-col items-center gap-4 opacity-60">
                        <User size={48} />
                        <Loader2 className="animate-spin" size={24} />
                        <span>{t('playlist.loading')}</span>
                    </div>
                </div>
            </motion.div>
        );
    }

    return (
        <NavidromeCollectionView
            title={artist.name}
            subtitle={t('navidrome.artists') || 'Artists'}
            coverUrl={coverUrl}
            placeholderVariant="artist"
            songs={songs}
            config={config}
            onBack={onBack}
            onPlaySong={onPlaySong}
            onAddAllToQueue={onAddAllToQueue}
            onSelectAlbum={onSelectAlbum}
            availablePlaylists={availablePlaylists}
            onAddToPlaylist={onAddToPlaylist}
            onCreatePlaylist={onCreatePlaylist}
            theme={theme}
            isDaylight={isDaylight}
        />
    );
};

export default NavidromeArtistView;
