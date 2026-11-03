import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';
import type { SongResult } from '../../../../types';
import type { OmniCollection, OmniProviderId } from '../../../../types/onlineMusic';
import { exploreScroll, useExploreFeedStore } from '../../../../stores/useExploreFeedStore';
import { ExploreLight } from './ExploreLight';
import { EXPLORE_PILL, EXPLORE_TOKENS, ExploreSections } from './ExploreSections';
import { useExploreTilt } from './exploreTilt';
import { OWN_SECTION_IDS, listenedSongsOf, useOwnExploreSections } from './ownSections';

// src/components/app/home/explore/ExploreSurface.tsx
// The explore tab of the home screen, as sections one under another. A section is the same
// thing wherever it comes from (`OmniExploreSection`), and comes from one of two places:
//  - the app's own sections (ownSections.ts), made of what was played here: they stand first,
//    are the same under every provider, and are shown whatever state the provider's page is in
//    (being read, not read, empty), with that state under them;
//  - the active provider's recommendation page (useExploreFeedStore, behind it the provider's
//    `OnlineExploreProvider`). Reaching the end of the list reads the page's further sections.
// Nothing here knows which provider it is: another one needs its own `OnlineExploreProvider`.
// The page's own control ("refresh") is not part of the list: it stands over the list's top right
// corner, where the first heading row leaves it room, and stays there while the list scrolls
// under it. What passes under the list's top edge then fades out, so that a heading row's own
// buttons are dim where they pass under the control (they are not gone: the fade is whole only
// at the very edge).
// Two things belong to the page as a whole and not to any entry: its light (ExploreLight.tsx),
// which stands behind the list, and that a picture leans to the pointer over it (exploreTilt.ts).

// How far down from its top edge the list fades what has scrolled up to it, in pixels.
const TOP_FADE = 56;
// The mark that more is being read and the offer to try again, at the list's end, are one height: the list does not move under a listener who stands there when one takes the other's place. (It does once, by this much, when the list turns out to end there.)
const END = 'flex h-28 items-center justify-center';
const NO_BATCHES = {};

interface ExploreSurfaceProps {
    providerId: OmniProviderId;
    /** The account the page is read for; '' when nobody is signed in. */
    accountId: string;
    /** The account and the language the page is read for; another scope is another page. */
    scope: string;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    onOpenCollection: (collection: OmniCollection) => void;
}

export const ExploreSurface: React.FC<ExploreSurfaceProps> = ({ providerId, accountId, scope, onPlaySong, onOpenCollection }) => {
    const { t } = useTranslation();
    const key = `${providerId}:${scope}`;
    const keptKey = useExploreFeedStore(state => state.key);
    const feed = useExploreFeedStore(state => (state.key === key ? state.feed : null));
    const show = useExploreFeedStore(state => state.show);
    const refresh = useExploreFeedStore(state => state.refresh);
    const loadMore = useExploreFeedStore(state => state.loadMore);
    const loadMoreOf = useExploreFeedStore(state => state.loadMoreOf);
    const list = useRef<HTMLDivElement>(null);
    const end = useRef<HTMLDivElement>(null);
    const pin = useRef<HTMLDivElement>(null);
    useExploreTilt(list);
    // What follows the scroll without a render: how far the list's top edge fades what passes
    // under it (nothing while the list stands at its top), and that the control now floats over
    // the list.
    const follow = useCallback(() => {
        const top = list.current?.scrollTop ?? 0;
        list.current?.style.setProperty('--ex-top-fade', `${Math.min(top, TOP_FADE)}px`);
        pin.current?.toggleAttribute('data-floating', top > 0);
    }, []);
    // The width of the list's scrollbar, which comes and goes with what the list holds: the
    // control keeps clear of it, in line with the heading rows.
    const [barWidth, setBarWidth] = useState(0);
    useLayoutEffect(() => {
        const element = list.current;
        if (!element || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => setBarWidth(element.offsetWidth - element.clientWidth);
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        if (element.firstElementChild) observer.observe(element.firstElementChild);
        measure();
        return () => observer.disconnect();
    }, []);

    // What the listener played here, as it is when the provider's page is read: the provider may make sections out of it.
    const listened = useCallback(() => listenedSongsOf(providerId, accountId), [providerId, accountId]);
    const readAgain = useCallback(() => refresh(listened()), [refresh, listened]);
    // Also when the store let go of this key: a read overtaken by a provider switch leaves nothing kept.
    useEffect(() => { show(key, listened()); }, [key, keptKey, show, listened]);

    // A section that holds nothing is not shown; a page of such sections is an empty page.
    const provided = (feed?.sections ?? []).filter(section => section.items.length > 0);
    const own = useOwnExploreSections(providerId, accountId);
    const sections = own.length > 0 ? [...own, ...provided] : provided;
    const hasMore = Boolean(feed?.nextCursor);
    const hasSections = sections.length > 0;
    // Back where the listener left the kept page; another page starts from its top.
    useLayoutEffect(() => {
        if (hasSections && list.current) list.current.scrollTop = exploreScroll.top;
        follow();
        // (`feed?.status`: the control is put over the list when the provider's page has arrived, which with sections of the app's own on screen is none of the other moments.)
    }, [follow, hasSections, feed?.status, feed?.read]);

    // Not while another page is being read in place of this one: its end asks for nothing then.
    const awaitsMore = hasMore && !feed?.loadingMore && !feed?.moreFailed && !feed?.refreshing;
    // Watched anew after every answer: an end that is still in view then asks for the next page.
    useEffect(() => {
        if (!awaitsMore || !end.current || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) void loadMore();
        }, { root: list.current, rootMargin: '200px' });
        observer.observe(end.current);
        return () => observer.disconnect();
    }, [awaitsMore, loadMore, sections.length]);

    const isLoading = !feed || feed.status === 'loading';
    const failed = (
        <div className="flex flex-col items-center gap-4 py-24 text-sm text-[color:var(--ex-soft)]">
            <span>{t('home.exploreFailed')}</span>
            <button type="button" data-explore-retry-page onClick={readAgain} className={`h-8 px-4 ${EXPLORE_PILL}`}>{t('home.exploreRetry')}</button>
        </div>
    );
    // The page's own control: read the provider's page anew. The page shown stays while the next
    // one is read; a read that failed leaves a mark on the control, which then tries again.
    const hasRefresh = !isLoading && feed.status !== 'error';
    const refreshLabel = t(feed?.refreshFailed ? 'home.exploreRetry' : 'home.exploreRefresh');
    return (
        <div className="relative h-full w-full self-stretch" style={EXPLORE_TOKENS}>
            {hasRefresh && (
                // Laid out as the list's own content is, so that the control ends where the heading rows end.
                // Before the list, so that the keyboard reaches it before the list's own buttons, as it did in its row.
                <motion.div
                    ref={pin}
                    // It comes with the page it belongs to, as quietly as the page's first heading does.
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="group pointer-events-none absolute inset-x-0 top-2 z-10"
                    style={{ paddingRight: barWidth }}
                >
                    <div className="mx-auto flex w-full max-w-7xl justify-end px-4 md:px-8">
                        <button
                            type="button"
                            data-explore-refresh
                            disabled={feed.refreshing}
                            title={feed.refreshFailed ? t('home.exploreFailed') : refreshLabel}
                            aria-label={refreshLabel}
                            onClick={readAgain}
                            // In its heading row it is one of the row's buttons; over the list it is a pane of glass.
                            className={`pointer-events-auto relative flex h-8 w-8 items-center justify-center duration-300 group-data-[floating]:bg-[var(--ex-tint-strong)] group-data-[floating]:shadow-lg group-data-[floating]:backdrop-blur-md ${EXPLORE_PILL}`}
                            style={{ transitionProperty: 'color, background-color, box-shadow, backdrop-filter' }}
                        >
                            <RefreshCw size={14} className={feed.refreshing ? 'animate-spin' : ''} />
                            {feed.refreshFailed && <span data-explore-refresh-failed className="absolute right-0 top-0 h-2 w-2 rounded-full bg-amber-400" />}
                        </button>
                    </div>
                </motion.div>
            )}
            {/* Before the list, which is drawn over it. */}
            <ExploreLight list={list} />
            <motion.div
                ref={list}
                data-explore-surface
                // Entries that change places are followed from where they stood in this list.
                layoutScroll
                onScroll={event => {
                    if (hasSections) exploreScroll.top = event.currentTarget.scrollTop;
                    follow();
                }}
                className="h-full w-full overflow-y-auto"
                style={{ maskImage: 'linear-gradient(to bottom, transparent, black var(--ex-top-fade, 0px))' }}
            >
                <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-2 md:px-8">
                    {sections.length === 0 ? (
                        // No section to show: the state of the provider's page stands alone.
                        isLoading ? (
                            <div className="flex justify-center py-24" aria-busy="true"><Loader2 size={28} className="animate-spin opacity-30" /></div>
                        ) : feed.status === 'error' ? failed : (
                            <div className="flex justify-center py-24 text-sm text-[color:var(--ex-soft)]">{t('home.exploreEmpty')}</div>
                        )
                    ) : (
                        <>
                            <ExploreSections
                                page={feed?.read ?? 0}
                                sections={sections}
                                batches={feed?.kept ?? NO_BATCHES}
                                ownSectionIds={OWN_SECTION_IDS}
                                isStale={Boolean(feed?.refreshing)}
                                loadingSectionIds={feed?.loadingSectionIds ?? []}
                                onPlaySong={onPlaySong}
                                onOpenCollection={onOpenCollection}
                                onLoadMoreOf={sectionId => void loadMoreOf(sectionId)}
                                // Room for the control that stands over this corner of the list.
                                pageControls={hasRefresh ? <span data-explore-controls-room aria-hidden className="h-8 w-8 shrink-0" /> : undefined}
                            />
                            {/* Under the sections, the state of the provider's page: what the app keeps itself is shown through all of it. */}
                            {isLoading ? (
                                <div className={END} aria-busy="true"><Loader2 size={20} className="animate-spin opacity-30" /></div>
                            ) : feed.status === 'error' ? failed : hasMore && (feed.moreFailed ? (
                                <div className={END}>
                                    <button type="button" data-explore-retry onClick={() => void loadMore()} className={`h-8 px-4 ${EXPLORE_PILL}`}>{t('home.exploreRetry')}</button>
                                </div>
                            ) : (
                                <div ref={end} className={END}><Loader2 size={20} className="animate-spin opacity-30" /></div>
                            ))}
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default ExploreSurface;
