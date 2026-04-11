import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, Loader2, RefreshCw, User, ListMusic, Shuffle, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Carousel3D from '../Carousel3D';
import NavidromeAlbumView from './NavidromeAlbumView';
import NavidromeCollectionView from './NavidromeCollectionView';
import NavidromeArtistView from './NavidromeArtistView';
import { SubsonicAlbum, NavidromeSong, NavidromeConfig, SubsonicPlaylist, SubsonicSong, SubsonicArtist, NavidromeViewSelection } from '../../types/navidrome';
import { navidromeApi, getNavidromeConfig } from '../../services/navidromeService';
import { Theme } from '../../types';
import { createCoverPlaceholder, pickRandomSongCoverUrl } from '../../utils/coverPlaceholders';

interface NavidromeMusicViewProps {
    onPlaySong: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onAddSongsToQueue?: (songs: NavidromeSong[]) => void;
    onOpenSettings: () => void;
    onMatchSong?: (song: NavidromeSong) => void;
    theme: Theme;
    isDaylight: boolean;
    focusedAlbumIndex?: number;
    setFocusedAlbumIndex?: (index: number) => void;
    externalSelection?: NavidromeViewSelection | null;
    onExternalSelectionHandled?: () => void;
}

type NaviSection = 'albums' | 'playlists' | 'artists';
type NaviSelection =
    | { type: 'album'; album: SubsonicAlbum; }
    | { type: 'playlist'; playlist: SubsonicPlaylist; songs: SubsonicSong[]; }
    | { type: 'random'; songs: SubsonicSong[]; }
    | { type: 'favorites'; songs: SubsonicSong[]; }
    | { type: 'artist'; artist: SubsonicArtist; };

const NavidromeMusicView: React.FC<NavidromeMusicViewProps> = ({
    onPlaySong,
    onAddSongsToQueue,
    onOpenSettings,
    onMatchSong,
    theme,
    isDaylight,
    focusedAlbumIndex = 0,
    setFocusedAlbumIndex,
    externalSelection = null,
    onExternalSelectionHandled,
}) => {
    const { t } = useTranslation();

    const [config, setConfig] = useState<NavidromeConfig | null>(null);
    const [isConfigured, setIsConfigured] = useState(false);

    const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
    const [playlists, setPlaylists] = useState<SubsonicPlaylist[]>([]);
    const [artists, setArtists] = useState<SubsonicArtist[]>([]);
    const [favoriteSongs, setFavoriteSongs] = useState<SubsonicSong[]>([]);
    const [randomSongs, setRandomSongs] = useState<SubsonicSong[]>([]);
    const [selectedItem, setSelectedItem] = useState<NaviSelection | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [section, setSection] = useState<NaviSection>('albums');

    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    const [focusedArtistIndex, setFocusedArtistIndex] = useState(0);

    useEffect(() => {
        const storedConfig = getNavidromeConfig();
        if (storedConfig && storedConfig.serverUrl && storedConfig.username && storedConfig.passwordHash) {
            setConfig(storedConfig);
            setIsConfigured(true);
        } else {
            setIsConfigured(false);
        }
    }, []);

    const fetchLibrary = useCallback(async () => {
        if (!config) {
            return;
        }

        setIsLoading(true);
        try {
            const [fetchedAlbums, fetchedPlaylists, fetchedArtists, fetchedFavorites, fetchedRandom] = await Promise.all([
                navidromeApi.getAlbumList2(config, 'alphabeticalByName', 500),
                navidromeApi.getPlaylists(config),
                navidromeApi.getArtists(config),
                navidromeApi.getStarred2(config),
                navidromeApi.getRandomSongs(config, 100),
            ]);

            setAlbums(fetchedAlbums);
            setPlaylists(fetchedPlaylists);
            setArtists(fetchedArtists);
            setFavoriteSongs(fetchedFavorites);
            setRandomSongs(fetchedRandom);
        } catch (error) {
            console.error('[NavidromeMusicView] Failed to fetch library:', error);
        } finally {
            setIsLoading(false);
        }
    }, [config]);

    useEffect(() => {
        if (isConfigured && config) {
            void fetchLibrary();
        }
    }, [config, fetchLibrary, isConfigured]);

    const openAlbumById = useCallback(async (albumId: string) => {
        if (!config) {
            return;
        }

        const existingAlbum = albums.find(entry => entry.id === albumId);
        if (existingAlbum) {
            setSelectedItem({ type: 'album', album: existingAlbum });
            return;
        }

        const fetchedAlbum = await navidromeApi.getAlbum(config, albumId);
        if (fetchedAlbum) {
            setSelectedItem({ type: 'album', album: fetchedAlbum });
        }
    }, [albums, config]);

    const openArtistById = useCallback(async (artistId: string) => {
        if (!config) {
            return;
        }

        const existingArtist = artists.find(entry => entry.id === artistId);
        if (existingArtist) {
            setSelectedItem({ type: 'artist', artist: existingArtist });
            return;
        }

        const fetchedArtist = await navidromeApi.getArtist(config, artistId);
        if (fetchedArtist) {
            setSelectedItem({ type: 'artist', artist: fetchedArtist });
        }
    }, [artists, config]);

    useEffect(() => {
        if (!config || !externalSelection) {
            return;
        }

        let cancelled = false;

        const openExternalSelection = async () => {
            if (externalSelection.type === 'album') {
                const existingAlbum = albums.find(entry => entry.id === externalSelection.albumId);
                const album = existingAlbum ?? await navidromeApi.getAlbum(config, externalSelection.albumId);
                if (!cancelled && album) {
                    setSelectedItem({ type: 'album', album });
                }
            } else {
                const existingArtist = artists.find(entry => entry.id === externalSelection.artistId);
                const artist = existingArtist ?? await navidromeApi.getArtist(config, externalSelection.artistId);
                if (!cancelled && artist) {
                    setSelectedItem({ type: 'artist', artist });
                }
            }

            if (!cancelled) {
                onExternalSelectionHandled?.();
            }
        };

        void openExternalSelection();

        return () => {
            cancelled = true;
        };
    }, [albums, artists, config, externalSelection, onExternalSelectionHandled]);

    const albumItems = useMemo(() => albums.map(album => ({
        id: album.id,
        name: album.name,
        coverUrl: album.coverArt && config
            ? navidromeApi.getCoverArtUrl(config, album.coverArt, 600)
            : undefined,
        trackCount: album.songCount,
        description: album.artist,
    })), [albums, config]);

    const playlistItems = useMemo(() => {
        if (!config) {
            return [];
        }

        const getCoverUrl = (coverArtId: string, size?: number) => navidromeApi.getCoverArtUrl(config, coverArtId, size);
        const randomCoverUrl = pickRandomSongCoverUrl(randomSongs, getCoverUrl, 600, 3)
            || createCoverPlaceholder(t('navidrome.random') || '随机音乐', 'playlist');
        const favoriteCoverUrl = pickRandomSongCoverUrl(favoriteSongs, getCoverUrl, 600, 3)
            || createCoverPlaceholder(t('navidrome.favorites') || '收藏', 'playlist');

        const virtualItems = [
            {
                id: '__navi_random__',
                name: t('navidrome.random') || '随机音乐',
                coverUrl: randomCoverUrl,
                trackCount: randomSongs.length,
                description: t('navidrome.randomDesc') || '即时随机播放列表',
            },
            {
                id: '__navi_favorites__',
                name: t('navidrome.favorites') || '收藏',
                coverUrl: favoriteCoverUrl,
                trackCount: favoriteSongs.length,
                description: t('navidrome.favoritesDesc') || '已标星歌曲',
            },
        ];

        const playlistCards = playlists.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            coverUrl: playlist.coverArt ? navidromeApi.getCoverArtUrl(config, playlist.coverArt, 600) : undefined,
            trackCount: playlist.songCount,
            description: playlist.owner || t('home.playlists'),
        }));

        return [...virtualItems, ...playlistCards];
    }, [config, favoriteSongs, playlists, randomSongs, t]);

    const playlistDialogItems = useMemo(() => playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: `${playlist.songCount} ${t('playlist.tracks')}`,
    })), [playlists, t]);

    const artistItems = useMemo(() => artists.map(artist => ({
        id: artist.id,
        name: artist.name,
        coverUrl: createCoverPlaceholder(artist.name, 'artist'),
        trackCount: artist.albumCount,
        description: t('navidrome.artists'),
    })), [artists, config, t]);

    const handleAlbumSelect = (item: { id: string | number; }) => {
        const album = albums.find(entry => entry.id === item.id);
        if (album) {
            setSelectedItem({ type: 'album', album });
        }
    };

    const handlePlaylistSelect = async (item: { id: string | number; name: string; }) => {
        if (!config) {
            return;
        }

        if (item.id === '__navi_random__') {
            const songs = randomSongs.length > 0 ? randomSongs : await navidromeApi.getRandomSongs(config, 100);
            setRandomSongs(songs);
            setSelectedItem({ type: 'random', songs });
            return;
        }

        if (item.id === '__navi_favorites__') {
            const songs = favoriteSongs.length > 0 ? favoriteSongs : await navidromeApi.getStarred2(config);
            setFavoriteSongs(songs);
            setSelectedItem({ type: 'favorites', songs });
            return;
        }

        const playlist = playlists.find(entry => entry.id === item.id);
        if (!playlist) {
            return;
        }

        const playlistDetail = await navidromeApi.getPlaylist(config, playlist.id);
        setSelectedItem({
            type: 'playlist',
            playlist: playlistDetail || playlist,
            songs: playlistDetail?.entry || [],
        });
    };

    const handleArtistSelect = (item: { id: string | number; }) => {
        const artist = artists.find(entry => entry.id === item.id);
        if (artist) {
            setSelectedItem({ type: 'artist', artist });
        }
    };

    const handleAddSongsToPlaylist = useCallback(async (playlistId: string | number, songsToAdd: NavidromeSong[]) => {
        if (!config || songsToAdd.length === 0) {
            return;
        }

        await navidromeApi.updatePlaylist(config, String(playlistId), {
            songIdsToAdd: songsToAdd.map(song => song.navidromeData.id),
        });
        void fetchLibrary();
    }, [config, fetchLibrary]);

    const handleCreatePlaylist = useCallback(async (name: string, songsToAdd: NavidromeSong[]) => {
        if (!config) {
            return;
        }

        await navidromeApi.createPlaylist(
            config,
            name,
            songsToAdd.map(song => song.navidromeData.id)
        );
        void fetchLibrary();
    }, [config, fetchLibrary]);

    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/10 hover:bg-white/20';
    const textColor = isDaylight ? 'text-black' : 'text-white';

    if (selectedItem && config) {
        if (selectedItem.type === 'album') {
            return (
                <NavidromeAlbumView
                    album={selectedItem.album}
                    config={config}
                    onBack={() => setSelectedItem(null)}
                    onPlaySong={onPlaySong}
                    onAddAllToQueue={onAddSongsToQueue}
                    onMatchSong={onMatchSong}
                    onSelectArtist={openArtistById}
                    availablePlaylists={playlistDialogItems}
                    onAddToPlaylist={handleAddSongsToPlaylist}
                    onCreatePlaylist={handleCreatePlaylist}
                    theme={theme}
                    isDaylight={isDaylight}
                />
            );
        }

        if (selectedItem.type === 'artist') {
            return (
                <NavidromeArtistView
                    artist={selectedItem.artist}
                    config={config}
                    onBack={() => setSelectedItem(null)}
                    onPlaySong={onPlaySong}
                    onAddAllToQueue={onAddSongsToQueue}
                    onSelectAlbum={openAlbumById}
                    availablePlaylists={playlistDialogItems}
                    onAddToPlaylist={handleAddSongsToPlaylist}
                    onCreatePlaylist={handleCreatePlaylist}
                    theme={theme}
                    isDaylight={isDaylight}
                />
            );
        }

        return (
            <NavidromeCollectionView
                title={selectedItem.type === 'playlist'
                    ? selectedItem.playlist.name
                    : selectedItem.type === 'favorites'
                        ? (t('navidrome.favorites') || '收藏')
                        : (t('navidrome.random') || '随机音乐')}
                subtitle={selectedItem.type === 'playlist'
                    ? (selectedItem.playlist.owner || t('home.playlists'))
                    : selectedItem.type === 'favorites'
                        ? (t('navidrome.favoritesDesc') || '已标星歌曲')
                        : (t('navidrome.randomDesc') || '即时随机播放列表')}
                coverUrl={selectedItem.type === 'playlist'
                    ? (selectedItem.playlist.coverArt
                        ? navidromeApi.getCoverArtUrl(config, selectedItem.playlist.coverArt, 600)
                        : createCoverPlaceholder(selectedItem.playlist.name, 'playlist'))
                    : selectedItem.type === 'favorites'
                        ? (pickRandomSongCoverUrl(
                            selectedItem.songs,
                            (coverArtId, size) => navidromeApi.getCoverArtUrl(config, coverArtId, size),
                            600,
                            3
                        ) || createCoverPlaceholder(t('navidrome.favorites') || '收藏', 'playlist'))
                        : (pickRandomSongCoverUrl(
                            selectedItem.songs,
                            (coverArtId, size) => navidromeApi.getCoverArtUrl(config, coverArtId, size),
                            600,
                            3
                        ) || createCoverPlaceholder(t('navidrome.random') || '随机音乐', 'playlist'))}
                placeholderVariant="playlist"
                songs={selectedItem.songs}
                config={config}
                onBack={() => setSelectedItem(null)}
                onPlaySong={onPlaySong}
                onAddAllToQueue={onAddSongsToQueue}
                onSelectArtist={openArtistById}
                onSelectAlbum={openAlbumById}
                availablePlaylists={playlistDialogItems}
                onAddToPlaylist={handleAddSongsToPlaylist}
                onCreatePlaylist={handleCreatePlaylist}
                theme={theme}
                isDaylight={isDaylight}
            />
        );
    }

    if (!isConfigured) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center p-8">
                <div className="text-center space-y-6">
                    <div className={`w-20 h-20 mx-auto rounded-2xl ${buttonBg} flex items-center justify-center`}>
                        <Settings2 size={40} className="opacity-40" style={{ color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold opacity-80 mb-2" style={{ color: 'var(--text-primary)' }}>
                            {t('navidrome.notConfigured')}
                        </h2>
                        <p className="text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('navidrome.configureInSettings')}
                        </p>
                    </div>
                    <button
                        onClick={onOpenSettings}
                        className={`px-6 py-3 ${buttonBg} rounded-full font-medium text-sm transition-colors ${textColor}`}
                    >
                        {t('navidrome.goToSettings')}
                    </button>
                </div>
            </div>
        );
    }

    const currentItems = section === 'albums' ? albumItems : section === 'playlists' ? playlistItems : artistItems;
    const currentSelect = section === 'albums' ? handleAlbumSelect : section === 'playlists' ? handlePlaylistSelect : handleArtistSelect;
    const currentFocusedIndex = section === 'albums' ? focusedAlbumIndex : section === 'playlists' ? focusedPlaylistIndex : focusedArtistIndex;
    const currentFocusedSetter = section === 'albums' ? setFocusedAlbumIndex : section === 'playlists' ? setFocusedPlaylistIndex : setFocusedArtistIndex;
    const currentEmptyMessage = section === 'albums'
        ? t('navidrome.noAlbumsFound')
        : section === 'playlists'
            ? (t('navidrome.noPlaylistsFound') || 'No playlists found')
            : (t('navidrome.noArtistsFound') || 'No artists found');

    return (
        <div className="w-full h-full flex flex-col p-6 pb-32 overflow-hidden relative">
            <div className="flex items-center justify-center gap-3 mb-4 z-10 flex-wrap">
                <div className="flex gap-2 text-xs">
                    <button
                        onClick={() => setSection('albums')}
                        className={`px-3 py-1.5 rounded-full transition-all ${section === 'albums' ? 'bg-white/10 opacity-100' : 'opacity-40 hover:opacity-80'}`}
                    >
                        {t('navidrome.albums')}
                    </button>
                    <button
                        onClick={() => setSection('playlists')}
                        className={`px-3 py-1.5 rounded-full transition-all ${section === 'playlists' ? 'bg-white/10 opacity-100' : 'opacity-40 hover:opacity-80'}`}
                    >
                        <span className="inline-flex items-center gap-1"><ListMusic size={12} />{t('home.playlists')}</span>
                    </button>
                    <button
                        onClick={() => setSection('artists')}
                        className={`px-3 py-1.5 rounded-full transition-all ${section === 'artists' ? 'bg-white/10 opacity-100' : 'opacity-40 hover:opacity-80'}`}
                    >
                        <span className="inline-flex items-center gap-1"><User size={12} />{t('navidrome.artists')}</span>
                    </button>
                </div>

                <button
                    onClick={fetchLibrary}
                    className={`p-1.5 rounded-full ${buttonBg} transition-colors`}
                    disabled={isLoading}
                    title="Refresh"
                >
                    {isLoading ? (
                        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-primary)' }} />
                    ) : (
                        <RefreshCw size={14} style={{ color: 'var(--text-primary)' }} />
                    )}
                </button>
            </div>

            {section === 'playlists' && (
                <div className="flex items-center justify-center gap-4 mb-2 opacity-50 text-xs">
                    <span className="inline-flex items-center gap-1"><Shuffle size={12} />{t('navidrome.random') || '随机音乐'}</span>
                    <span className="inline-flex items-center gap-1"><Heart size={12} />{t('navidrome.favorites') || '收藏'}</span>
                </div>
            )}

            <div className="flex-1 relative overflow-hidden">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={section}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-full h-full"
                    >
                        <Carousel3D
                            items={currentItems}
                            onSelect={currentSelect}
                            isLoading={isLoading}
                            emptyMessage={currentEmptyMessage}
                            textBottomClass="-bottom-1"
                            initialFocusedIndex={currentFocusedIndex}
                            onFocusedIndexChange={currentFocusedSetter}
                            isDaylight={isDaylight}
                        />
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default NavidromeMusicView;
