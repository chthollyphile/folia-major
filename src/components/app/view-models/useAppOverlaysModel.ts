import { useMemo } from 'react';
import type React from 'react';
import type FloatingPlayerControls from '../../FloatingPlayerControls';
import type SearchResultsOverlay from '../../SearchResultsOverlay';
import type DevDebugOverlay from '../../DevDebugOverlay';
import type PlaylistView from '../views/PlaylistView';
import type AlbumView from '../views/AlbumView';
import type ArtistView from '../views/ArtistView';

// Overlay view model centralizes app-level overlay mounts and their props.
type SearchOverlayProps = React.ComponentProps<typeof SearchResultsOverlay>;
type FloatingControlsProps = React.ComponentProps<typeof FloatingPlayerControls>;
type DebugOverlayProps = React.ComponentProps<typeof DevDebugOverlay>;
type PlaylistOverlayProps = React.ComponentProps<typeof PlaylistView>;
type AlbumOverlayProps = React.ComponentProps<typeof AlbumView>;
type ArtistOverlayProps = React.ComponentProps<typeof ArtistView>;

type AppOverlaysModelInput = {
    homeOverlay?: {
        isVisible: boolean;
        content: React.ReactNode;
    } | null;
    searchOverlay?: SearchOverlayProps | null;
    detailOverlay?: (
        | { type: 'playlist'; props: PlaylistOverlayProps; }
        | { type: 'album'; props: AlbumOverlayProps; }
        | { type: 'artist'; props: ArtistOverlayProps; }
    ) | null;
    debugOverlay?: DebugOverlayProps | null;
    floatingControls?: FloatingControlsProps | null;
};

export type AppOverlaysModel = AppOverlaysModelInput;

export const useAppOverlaysModel = (input: AppOverlaysModelInput): AppOverlaysModel => {
    return useMemo(() => input, [input]);
};
