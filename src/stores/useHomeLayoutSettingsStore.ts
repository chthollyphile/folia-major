// src/stores/useHomeLayoutSettingsStore.ts
// Home surface layout: which grid style the home page uses and which tabs it offers.
//
// Split out of useSettingsUiStore.

import { create } from 'zustand';
import i18n from '../i18n/config';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { useHomeCardPositionStore } from './useHomeCardPositionStore';
import { setStatusMessage } from './useStatusMessageStore';

const readStoredHomeLayoutStyle = (): 'carousel' | 'grid' => {
    if (typeof window === 'undefined') {
        return 'grid';
    }

    const saved = localStorage.getItem('home_layout_style');
    if (saved === 'carousel' || saved === 'desktop') {
        localStorage.setItem('home_layout_style', 'grid');
    }
    return 'grid';
};

const readStoredGrid3dCardStyle = (): 'image' | 'card' => {
    if (typeof window === 'undefined') {
        return 'card';
    }

    const saved = localStorage.getItem('grid3d_card_style');
    return saved === 'image' ? 'image' : 'card';
};

export type HomeLayoutSettingsState = {
    rememberHomeCardPosition: boolean;
    handleToggleRememberHomeCardPosition: (remember: boolean) => void;
    grid3dCardStyle: 'image' | 'card';
    handleSetGrid3dCardStyle: (style: 'image' | 'card') => void;
    homeLayoutStyle: 'carousel' | 'grid';
    showHomeTabPlaylist: boolean;
    showHomeTabRadio: boolean;
    showHomeTabDiscover: boolean;
    showHomeTabAlbums: boolean;
    showHomeTabLocal: boolean;
    handleSetHomeLayoutStyle: (style: 'carousel' | 'grid') => void;
    handleToggleHomeTabPlaylist: (show: boolean) => void;
    handleToggleHomeTabRadio: (show: boolean) => void;
    handleToggleHomeTabDiscover: (show: boolean) => void;
    handleToggleHomeTabAlbums: (show: boolean) => void;
    handleToggleHomeTabLocal: (show: boolean) => void;
};

export const useHomeLayoutSettingsStore = create<HomeLayoutSettingsState>((set, get) => ({
    rememberHomeCardPosition: getStoredBoolean('remember_home_card_position', true),
    handleToggleRememberHomeCardPosition: (remember) => {
        set({ rememberHomeCardPosition: remember });
        setStoredBoolean('remember_home_card_position', remember);
        if (!remember) useHomeCardPositionStore.getState().clear();
    },
    grid3dCardStyle: readStoredGrid3dCardStyle(),
    handleSetGrid3dCardStyle: (style) => {
        set({ grid3dCardStyle: style });
        if (typeof window !== 'undefined') localStorage.setItem('grid3d_card_style', style);
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (style === 'image' ? 'cardStyleImage' : 'cardStyleCard')),
        });
    },
    homeLayoutStyle: readStoredHomeLayoutStyle(),
    showHomeTabPlaylist: getStoredBoolean('show_home_tab_playlist', true),
    showHomeTabRadio: getStoredBoolean('show_home_tab_radio', true),
    showHomeTabDiscover: getStoredBoolean('show_home_tab_discover', true),
    showHomeTabAlbums: getStoredBoolean('show_home_tab_albums', true),
    showHomeTabLocal: getStoredBoolean('show_home_tab_local', true),
    handleSetHomeLayoutStyle: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('home_layout_style', 'grid');
        }
        set({ homeLayoutStyle: 'grid' });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.homeLayoutGrid'),
        });
    },
    handleToggleHomeTabPlaylist: (show) => {
        set({ showHomeTabPlaylist: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_playlist', show.toString());
    },
    handleToggleHomeTabRadio: (show) => {
        set({ showHomeTabRadio: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_radio', show.toString());
    },
    handleToggleHomeTabDiscover: (show) => {
        set({ showHomeTabDiscover: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_discover', show.toString());
    },
    handleToggleHomeTabAlbums: (show) => {
        set({ showHomeTabAlbums: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_albums', show.toString());
    },
    handleToggleHomeTabLocal: (show) => {
        set({ showHomeTabLocal: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_local', show.toString());
    },
}));

/**
 * The HomeLayoutSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectHomeLayoutSettingsSnapshot = (state: HomeLayoutSettingsState) => ({
    rememberHomeCardPosition: state.rememberHomeCardPosition,
    handleToggleRememberHomeCardPosition: state.handleToggleRememberHomeCardPosition,
    grid3dCardStyle: state.grid3dCardStyle,
    handleSetGrid3dCardStyle: state.handleSetGrid3dCardStyle,
    homeLayoutStyle: state.homeLayoutStyle,
    showHomeTabPlaylist: state.showHomeTabPlaylist,
    showHomeTabRadio: state.showHomeTabRadio,
    showHomeTabDiscover: state.showHomeTabDiscover,
    showHomeTabAlbums: state.showHomeTabAlbums,
    showHomeTabLocal: state.showHomeTabLocal,
    handleSetHomeLayoutStyle: state.handleSetHomeLayoutStyle,
    handleToggleHomeTabPlaylist: state.handleToggleHomeTabPlaylist,
    handleToggleHomeTabRadio: state.handleToggleHomeTabRadio,
    handleToggleHomeTabAlbums: state.handleToggleHomeTabAlbums,
    handleToggleHomeTabLocal: state.handleToggleHomeTabLocal,
});
