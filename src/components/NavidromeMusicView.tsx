import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Carousel3D from './Carousel3D';
import NavidromeAlbumView from './NavidromeAlbumView';
import { SubsonicAlbum, NavidromeSong, NavidromeConfig } from '../types/navidrome';
import { navidromeApi, getNavidromeConfig } from '../services/navidromeService';
import { Theme } from '../types';

interface NavidromeMusicViewProps {
    onPlaySong: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onOpenSettings: () => void;
    onMatchSong?: (song: NavidromeSong) => void;
    theme: Theme;
    isDaylight: boolean;
    focusedAlbumIndex?: number;
    setFocusedAlbumIndex?: (index: number) => void;
}

const NavidromeMusicView: React.FC<NavidromeMusicViewProps> = ({
    onPlaySong,
    onOpenSettings,
    onMatchSong,
    theme,
    isDaylight,
    focusedAlbumIndex = 0,
    setFocusedAlbumIndex
}) => {
    const { t } = useTranslation();

    // Config state
    const [config, setConfig] = useState<NavidromeConfig | null>(null);
    const [isConfigured, setIsConfigured] = useState(false);

    // Data state
    const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedAlbum, setSelectedAlbum] = useState<SubsonicAlbum | null>(null);

    // Sort mode
    const [sortMode, setSortMode] = useState<'alphabeticalByName' | 'newest' | 'recent'>('alphabeticalByName');

    // Check configuration on mount
    useEffect(() => {
        const storedConfig = getNavidromeConfig();
        if (storedConfig && storedConfig.serverUrl && storedConfig.username && storedConfig.passwordHash) {
            setConfig(storedConfig);
            setIsConfigured(true);
        } else {
            setIsConfigured(false);
        }
    }, []);

    // Fetch albums when config is ready
    const fetchAlbums = useCallback(async () => {
        if (!config) return;

        setIsLoading(true);
        try {
            const fetchedAlbums = await navidromeApi.getAlbumList2(config, sortMode, 500);
            setAlbums(fetchedAlbums);
        } catch (error) {
            console.error('[NavidromeMusicView] Failed to fetch albums:', error);
        } finally {
            setIsLoading(false);
        }
    }, [config, sortMode]);

    useEffect(() => {
        if (isConfigured && config) {
            fetchAlbums();
        }
    }, [isConfigured, config, fetchAlbums]);

    // Convert SubsonicAlbum to Carousel3D item format
    const carouselItems = albums.map(album => ({
        id: album.id,
        name: album.name,
        coverUrl: album.coverArt && config
            ? navidromeApi.getCoverArtUrl(config, album.coverArt, 600)
            : undefined,
        trackCount: album.songCount,
        description: album.artist
    }));

    // Handle album selection
    const handleAlbumSelect = (item: { id: string | number; name: string }) => {
        const album = albums.find(a => a.id === item.id);
        if (album) {
            setSelectedAlbum(album);
        }
    };

    // Style variants based on theme
    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/10 hover:bg-white/20';
    const textColor = isDaylight ? 'text-black' : 'text-white';

    // If an album is selected, show the album view
    if (selectedAlbum && config) {
        return (
            <NavidromeAlbumView
                album={selectedAlbum}
                config={config}
                onBack={() => setSelectedAlbum(null)}
                onPlaySong={onPlaySong}
                onMatchSong={onMatchSong}
                theme={theme}
                isDaylight={isDaylight}
            />
        );
    }

    // Not configured state
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

    return (
        <div className="w-full h-full flex flex-col p-6 pb-32 overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center justify-center gap-3 mb-4 z-10">
                <div className="text-sm font-medium uppercase tracking-widest" style={{ color: 'var(--text-primary)' }}>
                    {t('navidrome.albums')}
                </div>

                {/* Refresh Button */}
                <button
                    onClick={fetchAlbums}
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

                <span className="opacity-30" style={{ color: 'var(--text-primary)' }}>|</span>

                {/* Sort Options */}
                <div className="flex gap-2 text-xs">
                    {(['alphabeticalByName', 'newest', 'recent'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSortMode(mode)}
                            className={`px-2 py-1 rounded transition-opacity ${sortMode === mode ? 'opacity-100' : 'opacity-40 hover:opacity-80'
                                }`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {mode === 'alphabeticalByName' && (t('navidrome.allAlbums') || 'A-Z')}
                            {mode === 'newest' && (t('navidrome.recentlyAdded') || 'New')}
                            {mode === 'recent' && (t('navidrome.recents') || 'Recent')}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content - Carousel3D */}
            <div className="flex-1 relative overflow-hidden">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={sortMode}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-full h-full"
                    >
                        <Carousel3D
                            items={carouselItems}
                            onSelect={handleAlbumSelect}
                            isLoading={isLoading}
                            emptyMessage={t('navidrome.noAlbumsFound')}
                            textBottomClass="-bottom-1"
                            initialFocusedIndex={focusedAlbumIndex}
                            onFocusedIndexChange={setFocusedAlbumIndex}
                            isDaylight={isDaylight}
                        />
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default NavidromeMusicView;
