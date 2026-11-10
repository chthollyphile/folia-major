import React, { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OmniExploreItem } from '../../../../types/onlineMusic';
import { ActionMark, DurationChip, EXPLORE_SERIF, FOCUS_RING, Hairline, Picture, Record, Sheen, Uncovered, MORPH_TITLE, formatDuration, morphSourceOf, useRow, type RowBodyProps } from './ExploreParts';
import { faceOf } from './exploreFace';
import { BeatRing, LEVELS_CHIP, Levels, usePlaying, useSound } from './ExplorePlaying';
import { BODY, CAPTION, LARGE, LINE, SETTLE, atOnce, fromAfar, useArrivals, useRevealGrowth, type Arrival } from './exploreMotion';

// src/components/app/home/explore/ExploreLead.tsx
// The body of the section that opens the page: its first entry large, and the others listed
// beside it in columns of five. (The page's light lies under the large entry until something
// else is pointed at: ExploreLight.tsx.) The section is as high as
// that, however many entries it holds: further columns stand to the right, out of sight, and the
// list scrolls sideways to them as a row of pictures does (ExploreRow.tsx). Unlike a row it shows
// whole columns only, two or one as it has room, so it has no edge to fade its entries out at.

// How many entries a column of the list holds: about the large entry's height.
const LEAD_LISTED = 5;
/** How many degrees the large entry's picture leans to the pointer at most: less than a row's, being larger. */
const LARGE_TILT = 4;
// A line that joins the list where nothing was read for it (a song just played) waits this
// long, in seconds: the lines it pushes aside are on their way by then.
const JOIN_WAIT = 0.13;

// Where the entry at `place` of the list stands: the columns fill from the top, one after another.
const cellOf = (place: number): React.CSSProperties => ({ gridColumn: Math.floor(place / LEAD_LISTED) + 1, gridRow: (place % LEAD_LISTED) + 1 });

// One of the entries listed beside the large one. `hasWideSlot` gives its picture the
// room of a wide one, whatever its own shape: the section holds wide pictures, and the titles
// of a list start on one line. A line whose place changes moves there (with reduced motion it is there).
const LeadLine: React.FC<{ item: OmniExploreItem; place: number; hasWideSlot: boolean; arrival: Arrival; onSelect: () => void }> = ({ item, place, hasWideSlot, arrival, onSelect }) => {
    const { t } = useTranslation();
    const face = faceOf(item, t);
    const own = useRef<HTMLButtonElement>(null);
    const playing = usePlaying(item);
    useSound(own, playing);
    return (
        <motion.button
            ref={own}
            type="button"
            layout={arrival.calm ? false : 'position'}
            transition={{ layout: SETTLE }}
            variants={LINE}
            custom={arrival}
            {...morphSourceOf(item)}
            data-explore-card={face.kind}
            data-explore-order={arrival.order}
            data-explore-playing={playing ?? undefined}
            aria-current={playing ? 'true' : undefined}
            title={face.title}
            onClick={onSelect}
            className={`group flex w-full items-center gap-4 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--ex-tint)] ${FOCUS_RING}`}
            style={cellOf(place)}
        >
            <span className={`flex shrink-0 justify-center ${hasWideSlot ? 'w-24' : 'w-[54px]'}`}>
                <span data-explore-beat className={`relative block h-[54px] overflow-hidden bg-[var(--ex-tint)] ${face.shape === 'wide' ? 'w-24 rounded-xl' : face.shape === 'round' ? 'w-[54px] rounded-full' : 'w-[54px] rounded-xl'}`}>
                    <Picture url={face.pictureUrl} size={200} className="h-full w-full" />
                    {item.kind === 'song' && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                            <Play size={16} fill="currentColor" />
                        </span>
                    )}
                    <Hairline />
                </span>
            </span>
            <span className="block min-w-0 flex-1">
                <span {...MORPH_TITLE} className="block truncate text-sm font-medium">{face.title}</span>
                {face.subtitle && <span className="mt-0.5 block truncate text-xs text-[color:var(--ex-soft)]">{face.subtitle}</span>}
            </span>
            {playing
                ? <Levels className="shrink-0" />
                : face.durationMs > 0 && <span className="shrink-0 font-mono text-[11px] text-[color:var(--ex-faint)]">{formatDuration(face.durationMs)}</span>}
        </motion.button>
    );
};

// The place of a line that is being read.
const GhostLine: React.FC<{ place: number; hasWideSlot: boolean; arrival: Arrival }> = ({ place, hasWideSlot, arrival }) => (
    <motion.span variants={LINE} custom={arrival} data-explore-ghost className="flex items-center gap-4 px-2.5 py-2" style={cellOf(place)}>
        <span className={`h-[54px] shrink-0 animate-pulse rounded-xl bg-[var(--ex-tint-strong)] ${hasWideSlot ? 'w-24' : 'w-[54px]'}`} />
        <span className="block flex-1">
            <span className="block h-3 w-3/5 animate-pulse rounded-full bg-[var(--ex-tint-strong)]" />
            <span className="mt-2 block h-2.5 w-2/5 animate-pulse rounded-full bg-[var(--ex-tint)]" />
        </span>
    </motion.span>
);

// The large entry. (A component of its own, given its entry's key: what follows the sound for it
// then belongs to the one button it is drawn as.)
const LargeEntry: React.FC<{ item: OmniExploreItem; arrival: Arrival; onSelect: () => void }> = ({ item, arrival, onSelect }) => {
    const { t } = useTranslation();
    const face = faceOf(item, t);
    const own = useRef<HTMLButtonElement>(null);
    const playing = usePlaying(item);
    useSound(own, playing);
    return (
        <motion.button
            ref={own}
            type="button"
            variants={LARGE}
            custom={arrival}
            transformTemplate={fromAfar}
            {...morphSourceOf(item)}
            data-explore-card={face.kind}
            data-explore-order={arrival.order}
            data-explore-playing={playing ?? undefined}
            aria-current={playing ? 'true' : undefined}
            title={face.title}
            onClick={onSelect}
            className={`group w-full max-w-[384px] shrink-0 self-start rounded-3xl text-left ${FOCUS_RING}`}
        >
            {/* What leans to the pointer and takes the beat, as a row's picture does (ExploreRow.tsx). */}
            <span data-explore-tilt={LARGE_TILT} data-explore-beat className={`relative block ${face.shape === 'wide' ? 'w-full' : 'w-56'}`}>
                {face.kind === 'album' && face.pictureUrl && <Record />}
                {playing && <BeatRing round={face.shape === 'round' ? 'rounded-full' : 'rounded-3xl'} />}
                <span className={`relative block overflow-hidden bg-[var(--ex-tint)] shadow-[0_30px_60px_-28px_rgba(0,0,0,0.8)] ${face.shape === 'wide' ? 'aspect-video w-full rounded-3xl' : face.shape === 'round' ? 'aspect-square w-56 rounded-full' : 'aspect-square w-56 rounded-3xl'}`}>
                    <Uncovered arrival={arrival}><Picture url={face.pictureUrl} size={640} className="h-full w-full" /></Uncovered>
                    {face.shape !== 'round' && (playing
                        ? <Levels className={`bottom-4 left-4 ${LEVELS_CHIP}`} />
                        : <DurationChip durationMs={face.durationMs} className="bottom-4 left-4" />)}
                    {face.shape !== 'round' && <ActionMark isSong={item.kind === 'song'} className="explore-float absolute bottom-4 right-4 h-12 w-12 bg-white text-black" />}
                    <Hairline />
                    <Sheen />
                </span>
            </span>
            <motion.span variants={CAPTION} custom={arrival} className="mt-5 block px-1">
                <span {...MORPH_TITLE} className="line-clamp-2 text-[30px] font-medium leading-tight tracking-[0.01em]" style={{ fontFamily: EXPLORE_SERIF }}>{face.title}</span>
                {face.subtitle && <span className="mt-1.5 block truncate text-sm text-[color:var(--ex-soft)]">{face.subtitle}</span>}
            </motion.span>
        </motion.button>
    );
};

export const LeadBody: React.FC<RowBodyProps> = props => {
    const { items, keys, base, leave, calm, there, turns, isLoadingMore, onSelect } = props;
    const { t } = useTranslation();
    const { own, onScroll } = useRow(props);
    // Lines that take the places held for them come at once.
    const wasLoading = useRef(isLoadingMore);
    const arrivalOf = useArrivals(keys, base, calm, wasLoading.current ? 0 : JOIN_WAIT, there, turns);
    useLayoutEffect(() => { wasLoading.current = isLoadingMore; }, [isLoadingMore]);
    // The large entry the body was first shown with arrives with the rest; one that takes its place
    // later (a song just played) waits for nothing: it is there, and its picture is uncovered.
    const firstShown = useRef(keys[0]);
    const largeArrival = keys[0] === firstShown.current ? arrivalOf(keys[0]) : atOnce(calm);
    const [first, ...others] = items;
    const hasWideSlot = others.some(item => faceOf(item, t).shape === 'wide');
    const places = others.length + (isLoadingMore ? LEAD_LISTED : 0);
    // The column of the first place held is brought to the list's start (the large entry is no place of the list).
    // Places held only: entries also join this list unasked (a song that was just played here).
    useRevealGrowth(keys, isLoadingMore, before => {
        own.current?.querySelectorAll('[data-explore-post]')[Math.floor((before - 1) / LEAD_LISTED)]
            ?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest', inline: 'start' });
    }, true);

    return (
        <motion.div data-explore-body variants={BODY} custom={leave} initial="away" animate="here" exit="gone">
            <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
                <LargeEntry key={keys[0]} item={first} arrival={largeArrival} onSelect={() => onSelect(first)} />
                {/* Columns of five. Two are in view where each then has 340px for its lines (a list of 704px), one where not,
                    and they fill the list's width to the pixel: wherever the list rests, at its end too, whole columns are in
                    view. A column alone takes all of the width. Lines that change places are followed from where they stood
                    in this list. (The margin leaves room for the focus ring of a line at its edge.)
                    Beside the large entry, a place without a line keeps a line's height (its picture's 54px and its padding):
                    a batch of fewer entries leaves the section as high as it was, and the list below it where it was. */}
                <div className="@container min-w-0 flex-1 lg:[--ex-line:4.375rem]">
                <motion.div
                    ref={own}
                    data-explore-row
                    layoutScroll
                    onScroll={onScroll}
                    className="-m-1 grid snap-x scroll-px-1 auto-cols-[minmax(100%,1fr)] content-start gap-x-6 overflow-x-auto p-1 [scrollbar-width:none] @min-[704px]:auto-cols-[minmax(calc((100%_-_1.5rem)/2),1fr)] [&::-webkit-scrollbar]:hidden"
                    style={{ gridTemplateRows: `repeat(${LEAD_LISTED}, minmax(var(--ex-line, 0px), auto))` }}
                >
                    {/* What the list comes to rest on: the head of each column. Not the lines: a list keeps to the one it
                        rests on, and would follow a line that a song just played pushes along. */}
                    {Array.from({ length: Math.ceil(places / LEAD_LISTED) }, (_, column) => (
                        <span key={`post-${column}`} data-explore-post aria-hidden className="pointer-events-none snap-start" style={cellOf(column * LEAD_LISTED)} />
                    ))}
                    {others.map((item, index) => (
                        <LeadLine key={keys[index + 1]} item={item} place={index} hasWideSlot={hasWideSlot} arrival={arrivalOf(keys[index + 1])} onSelect={() => onSelect(item)} />
                    ))}
                    {isLoadingMore && Array.from({ length: LEAD_LISTED }, (_, index) => (
                        <GhostLine key={`ghost-${index}`} place={others.length + index} hasWideSlot={hasWideSlot} arrival={{ order: index, base: 0, calm }} />
                    ))}
                </motion.div>
                </div>
            </div>
        </motion.div>
    );
};
