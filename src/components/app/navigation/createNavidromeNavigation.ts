import type { NavidromeViewSelection } from '../../../types/navidrome';
import type { SongResult } from '../../../types';

// src/components/app/navigation/createNavidromeNavigation.ts

type CreateNavidromeNavigationParams = {
    currentSong: SongResult | null;
    setPendingNavidromeSelection: (selection: NavidromeViewSelection) => void;
    setHomeViewTab: (tab: string) => void;
    navigateDirectHome: (options?: { clearContext?: boolean }) => void;
};

// Creates current-track Navidrome navigation helpers for album and artist jumps.
export const createNavidromeNavigation = ({
    currentSong,
    setPendingNavidromeSelection,
    setHomeViewTab,
    navigateDirectHome,
}: CreateNavidromeNavigationParams) => {
    const openNavidromeSelection = (selection: NavidromeViewSelection) => {
        setPendingNavidromeSelection(selection);
        setHomeViewTab('navidrome');
        navigateDirectHome({ clearContext: false });
    };

    const resolveCurrentNavidromeTargetIds = () => {
        const currentNavidromeSong = (currentSong as SongResult & { navidromeData?: any } | null)?.navidromeData;
        const playbackCarrier = currentNavidromeSong?.navidromeData;

        return {
            albumId: currentNavidromeSong?.albumId || playbackCarrier?.albumId,
            artistId: currentNavidromeSong?.artistId || playbackCarrier?.artistId,
        } as { albumId?: string; artistId?: string };
    };

    const openCurrentNavidromeAlbum = () => {
        const { albumId } = resolveCurrentNavidromeTargetIds();
        if (albumId) {
            openNavidromeSelection({ type: 'album', albumId });
        }
    };

    const openCurrentNavidromeArtist = () => {
        const { artistId } = resolveCurrentNavidromeTargetIds();
        if (artistId) {
            openNavidromeSelection({ type: 'artist', artistId });
        }
    };

    return {
        openCurrentNavidromeAlbum,
        openCurrentNavidromeArtist,
    };
};
