import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult, UnifiedSong } from '../../../../types';
import type { OmniExploreSection, OmniProviderId } from '../../../../types/onlineMusic';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { errorMessage } from '../../../../utils/errorText';
import { omni } from '../../../../services/onlineMusic/omni';
import { recentPlaysOf, replayedSongsOf, showRecordedSongsAs, watchRecentPlays } from './recentPlays';

// src/components/app/home/explore/ownSections.ts
// The explore page's own sections: what Folia itself knows of the listener, the same under
// every provider. Both are read from its own record of the songs played here (recentPlays.ts),
// for the provider and the account the page is shown for:
//  - "recently played": the songs played here in the last seven days, newest first;
//  - "play again": the songs listened to here more than once, those listened to most of late first.
// A provider's page brings neither (see `OnlineExploreProvider`). All of a section's songs are
// in it: there is nothing "more" could ask for.

const RECENT_SECTION_ID = 'folia-recent-plays';
const AGAIN_SECTION_ID = 'folia-play-again';
/** The ids of the app's own sections, which no read of a provider's page brings or takes away. */
export const OWN_SECTION_IDS: ReadonlySet<string> = new Set([RECENT_SECTION_ID, AGAIN_SECTION_ID]);

const sectionOf = (id: string, title: string, songs: SongResult[]): OmniExploreSection => ({
    id, title, items: songs.map(song => ({ kind: 'song', song: song as UnifiedSong })),
});

// The accounts of platforms whose songs played here were set right this run (see `setRightOnce`).
const setRight = new Set<string>();
// With the first read of a platform's page for an account in a run, the platform is asked which
// of the songs recorded as played it now shows as other ones, and the record is set right with
// them (`OnlineExploreProvider.songsShownAs`). It is asked again after a failure.
const setRightOnce = (providerId: OmniProviderId, accountId: string): void => {
    const scope = `${providerId}:${accountId}`;
    const shownAs = omni.exploreSongsShownAs(providerId);
    if (!shownAs || setRight.has(scope)) return;
    setRight.add(scope);
    void showRecordedSongsAs(providerId, accountId, songs => shownAs(songs as UnifiedSong[])).then(count => {
        if (count > 0) console.log(`[Explore] ${count} song(s) played here from ${providerId} recorded again as the song it shows them as`);
    }, error => {
        setRight.delete(scope);
        console.warn(`[Explore] The songs played here from ${providerId} could not be set right (${errorMessage(error)}); asked again with the next read`);
    });
};

// A provider is handed this many of the listener's songs with a read of its page.
const MAX_LISTENED = 30;
/**
 * The songs of the app's own sections as one list, each once, the ones listened to more than
 * once first: what a provider is handed with a read of its page (`OnlineExploreProvider.getFeed`).
 */
export const listenedSongsOf = (providerId: OmniProviderId, accountId: string): UnifiedSong[] => {
    setRightOnce(providerId, accountId);
    const songs = new Map<string, SongResult>();
    for (const song of [...replayedSongsOf(providerId, accountId), ...recentPlaysOf(providerId, accountId)]) {
        if (!songs.has(getPlaybackSongKey(song))) songs.set(getPlaybackSongKey(song), song);
    }
    return [...songs.values()].slice(0, MAX_LISTENED) as UnifiedSong[];
};

// The app's own sections that hold something, in the order they stand in.
const ownSectionsOf = (recent: SongResult[], replayed: SongResult[], t: (key: string) => string): OmniExploreSection[] => [
    sectionOf(RECENT_SECTION_ID, t('home.exploreRecent'), recent),
    sectionOf(AGAIN_SECTION_ID, t('home.exploreAgain'), replayed),
].filter(section => section.items.length > 0);

/** The app's own sections that hold something, in the order they stand in, followed as songs are played. */
export const useOwnExploreSections = (providerId: OmniProviderId, accountId: string): OmniExploreSection[] => {
    const { t } = useTranslation();
    const recent = useSyncExternalStore(watchRecentPlays, () => recentPlaysOf(providerId, accountId));
    const replayed = useSyncExternalStore(watchRecentPlays, () => replayedSongsOf(providerId, accountId));
    return useMemo(() => ownSectionsOf(recent, replayed, t), [recent, replayed, t]);
};

/** The app's own sections that hold something, as they are now: read once, they stay as they were while songs are played. */
export const readOwnExploreSections = (providerId: OmniProviderId, accountId: string, t: (key: string) => string): OmniExploreSection[] => (
    ownSectionsOf(recentPlaysOf(providerId, accountId), replayedSongsOf(providerId, accountId), t)
);
