import { useEffect, useState } from 'react';
import { NeteasePlaylist } from '../types';

type ViewState = 'home' | 'player';

export function useAppNavigation() {
    const [currentView, setCurrentView] = useState<ViewState>('home');
    const [selectedPlaylist, setSelectedPlaylist] = useState<NeteasePlaylist | null>(null);
    const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
    const [selectedArtistId, setSelectedArtistId] = useState<number | null>(null);

    useEffect(() => {
        window.history.replaceState({ view: 'home' }, '', '');

        const handlePopState = (event: PopStateEvent) => {
            const state = event.state;

            if (!state || state.view === 'home') {
                setCurrentView('home');
                setSelectedPlaylist(null);
                setSelectedAlbumId(null);
                setSelectedArtistId(null);
                return;
            }

            if (state.view === 'player') {
                setCurrentView('player');
                setSelectedPlaylist(null);
                setSelectedAlbumId(null);
                setSelectedArtistId(null);
                return;
            }

            if (state.view === 'playlist') {
                setCurrentView('home');
                setSelectedAlbumId(null);
                setSelectedArtistId(null);
                return;
            }

            if (state.view === 'album') {
                if (state.id) {
                    setSelectedAlbumId(state.id);
                    setCurrentView('home');
                    setSelectedArtistId(null);
                } else {
                    setCurrentView('home');
                    setSelectedAlbumId(null);
                }
                return;
            }

            if (state.view === 'artist') {
                if (state.id) {
                    setSelectedArtistId(state.id);
                    setCurrentView('home');
                } else {
                    setCurrentView('home');
                    setSelectedArtistId(null);
                }
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const navigateToPlayer = () => {
        if (currentView !== 'player') {
            window.history.pushState({ view: 'player' }, '', '#player');
            setCurrentView('player');
        }
    };

    const navigateToHome = () => {
        if (currentView !== 'home' || selectedPlaylist || selectedAlbumId) {
            window.history.back();
        }
    };

    const handlePlaylistSelect = (playlist: NeteasePlaylist | null) => {
        if (playlist) {
            window.history.pushState({ view: 'playlist', id: playlist.id }, '', `#playlist/${playlist.id}`);
            setSelectedPlaylist(playlist);
            setSelectedAlbumId(null);
            setSelectedArtistId(null);
            setCurrentView('home');
            return;
        }

        window.history.back();
    };

    const handleAlbumSelect = (id: number | null) => {
        if (id) {
            window.history.pushState({ view: 'album', id }, '', `#album/${id}`);
            setSelectedAlbumId(id);
            setSelectedArtistId(null);
            setCurrentView('home');
            return;
        }

        window.history.back();
    };

    const handleArtistSelect = (id: number | null) => {
        if (id) {
            window.history.pushState({ view: 'artist', id }, '', `#artist/${id}`);
            setSelectedArtistId(id);
            setCurrentView('home');
            return;
        }

        window.history.back();
    };

    return {
        currentView,
        selectedPlaylist,
        selectedAlbumId,
        selectedArtistId,
        navigateToPlayer,
        navigateToHome,
        handlePlaylistSelect,
        handleAlbumSelect,
        handleArtistSelect,
    };
}
