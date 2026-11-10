import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { OmniExploreSection, OmniProviderId } from '../../../types/onlineMusic';
import { useExploreFeedStore } from '../../../stores/useExploreFeedStore';
import { OWN_SECTION_IDS, listenedSongsOf } from '../home/explore/ownSections';
import {
    buildExploreTiles,
    furtherReadsAsked,
    furtherReadsOf,
    handedEntriesOf,
    markPlayingTile,
    MAX_FURTHER_READS,
    pageEntryCountOf,
    sectionsOfTiles,
    withOneMoreRead,
    type FurtherReadCount,
    type HandedEntries,
} from './exploreWall';
import type { WallSection } from './wallLayout';
import type { LatticeTile } from './latticeModel';

// src/components/app/lattice/useExploreWall.ts
// What a wall opened from the explore tab takes from the explore page's store
// (useExploreFeedStore): its tiles and the sections they stand in, the page's own "refresh", and
// a few further pages of sections where the page was left with few entries. The home screen,
// and the explore tab with it, is taken down while the wall is up: the page that tab read stays
// in the store, and the wall is then the only one to ask it for more.
// Those further pages reach the wall as one change, when the last of them is read: the number
// of lots sets which lot stands where beside the first column, and a change of it puts other
// posters there. When the wall asks and what it is handed are rules of exploreWall.ts.
// The app's own sections are not in the store: a wall that shows them is handed them by its
// caller, read when the caller chooses (Bravais' explore tab: when it is opened and at a refresh).
// The wall renders from this when the page's content changes, never for a camera move.

const NO_SECTIONS: OmniExploreSection[] = [];
// The further reads the wall asked for, counted for one read of the page. Not in the hook: the
// wall is mounted anew at every Back from a collection's page, and the limit is the page's.
let counted: FurtherReadCount | null = null;

export type ExploreWall = {
    tiles: LatticeTile[];
    /** The sections those tiles stand in, by which the wall is laid out. The same list for as long as the wall has the same entries. */
    sections: WallSection[];
    /** The page's own refresh: other entries under the headings that stand. */
    refresh: () => void;
    isRefreshing: boolean;
    canRefresh: boolean;
    /** What a wall without tiles says, as an i18n key; null while the page is being read. */
    emptyText: string | null;
};

export const useExploreWall = ({ isOn, currentSong, providerId, accountId, pageKey, ownSections = NO_SECTIONS }: {
    /** False on the queue wall, which takes nothing from here. */
    isOn: boolean;
    currentSong: SongResult | null;
    /** The provider and the account the explore tab shows its page for. */
    providerId: OmniProviderId | undefined;
    accountId: string;
    /** The store's key of the page this wall shows (explorePageKey); without it, whatever page the store holds. */
    pageKey?: string | null;
    /** The app's own sections (ownSections.ts), to stand before the page's, as the caller read them; none unless given. */
    ownSections?: OmniExploreSection[];
}): ExploreWall => {
    const { t } = useTranslation();
    // (Off, this answers null whatever the store holds: the queue wall is never rendered by it.)
    // Given a page key, only the store's page of that key: right after a switch the store still
    // holds the one before.
    const feed = useExploreFeedStore(state => (isOn && (pageKey == null || state.key === pageKey) ? state.feed : null));
    const sections = feed?.sections ?? NO_SECTIONS;
    const own = isOn ? ownSections : NO_SECTIONS;
    const read = feed?.read ?? null;
    const entries = useMemo(() => buildExploreTiles([...own, ...sections], t, OWN_SECTION_IDS), [own, sections, t]);
    const pageEntryCount = pageEntryCountOf(entries, OWN_SECTION_IDS);
    const further = furtherReadsOf(feed, pageEntryCount, furtherReadsAsked(counted, read));
    // The entries the wall has (`handedEntriesOf`): the page's, or the ones it was handed before
    // while further sections are being read. Set while rendering, as the wall's selection is
    // (useLatticePosterSelection): no render shows a list the wall is not to have.
    const [kept, setKept] = useState<HandedEntries>(() => ({ read, entries }));
    const handed = handedEntriesOf(kept, read, entries, further);
    if (handed !== kept) setKept(handed);
    // In two steps: a song change marks another tile and leaves the rest as they are.
    const tiles = useMemo(() => markPlayingTile(handed.entries, currentSong), [handed.entries, currentSong]);
    // Of the entries and not of `tiles`: a song change is no reason to lay the wall out anew.
    const wallSections = useMemo(() => sectionsOfTiles(handed.entries), [handed.entries]);

    useEffect(() => {
        if (isOn) console.log(`[Lattice] Explore wall opened with ${useExploreFeedStore.getState().feed?.sections.length ?? 0} sections`);
    }, [isOn]);

    // One line for every list the wall is handed: the one it opens with, the whole one after its
    // further reads, the answer to a refresh.
    useEffect(() => {
        if (isOn) console.log(`[Lattice] Explore wall shows ${handed.entries.length} entries in ${wallSections.length} sections`);
    }, [isOn, handed, wallSections]);

    useEffect(() => {
        if (further !== 'ask') return;
        // (Of the store as it is now: at a mount in development React runs an effect twice, and
        // the second run finds the read asked for.)
        const { feed: now, loadMore } = useExploreFeedStore.getState();
        if (!now || now.loadingMore) return;
        counted = withOneMoreRead(counted, now.read);
        console.log(`[Lattice] Explore wall has ${pageEntryCount} entries of the page: reading further sections (${counted.count} of ${MAX_FURTHER_READS})`);
        void loadMore();
    }, [further, pageEntryCount]);

    // As the page's own control does (`readAgain` in ExploreSurface): with what the listener
    // played here, which a provider may make sections of.
    const refresh = useCallback(() => {
        useExploreFeedStore.getState().refresh(providerId ? listenedSongsOf(providerId, accountId) : undefined);
    }, [providerId, accountId]);

    return {
        tiles,
        sections: wallSections,
        refresh,
        isRefreshing: Boolean(feed?.refreshing),
        canRefresh: Boolean(feed) && feed?.status !== 'loading' && !feed?.refreshing,
        emptyText: !feed || feed.status === 'ready' ? 'home.exploreEmpty' : feed.status === 'error' ? 'home.exploreFailed' : null,
    };
};
