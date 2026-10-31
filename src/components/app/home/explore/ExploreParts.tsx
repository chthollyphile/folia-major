import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Disc, Play } from 'lucide-react';
import type { OmniExploreItem } from '../../../../types/onlineMusic';
import { exploreScroll } from '../../../../stores/useExploreFeedStore';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { CARD_TITLE_ATTR, MORPH_SOURCE_ATTR } from '../../../collectionFlight';
import { PICTURE, type Arrival } from './exploreMotion';

// src/components/app/home/explore/ExploreParts.tsx
// The small pieces every form of a section of the explore tab shares. How an entry reads (its
// title, its picture and that picture's shape) is in exploreFace.ts.

// The tab colours itself from the theme's text colour, so it follows any theme.
export const EXPLORE_TOKENS = {
    color: 'var(--text-primary)',
    '--ex-soft': 'color-mix(in srgb, var(--text-primary) 60%, transparent)',
    '--ex-faint': 'color-mix(in srgb, var(--text-primary) 52%, transparent)',
    '--ex-line': 'color-mix(in srgb, var(--text-primary) 12%, transparent)',
    '--ex-tint': 'color-mix(in srgb, var(--text-primary) 5%, transparent)',
    '--ex-tint-strong': 'color-mix(in srgb, var(--text-primary) 10%, transparent)',
} as React.CSSProperties;

// What the tab's headings are set in: the serif the app already ships (index.css) for what is
// written in Chinese, and the system's own for the rest.
export const EXPLORE_SERIF = '"Microsoft Yahei","Folia Noto Serif SC", "Iowan Old Style", Georgia, "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif';

export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--text-primary)]';
export const EXPLORE_PILL = `rounded-full border border-[color:var(--ex-line)] text-xs font-medium text-[color:var(--ex-soft)] transition-colors hover:bg-[var(--ex-tint)] hover:text-[color:var(--text-primary)] disabled:cursor-default ${FOCUS_RING}`;

/** The mark of an entry that opens a collection: its cover flies to the page that opens, and back
 * to this entry (found again by the mark's value) when the page is left. See gridMorphContract. */
export const morphSourceOf = (item: OmniExploreItem) => (
    item.kind === 'collection' ? { [MORPH_SOURCE_ATTR]: `${item.collection.type}:${item.collection.id}` } : {}
);

/** The mark of an entry's title line, which flies with its cover. */
export const MORPH_TITLE = { [CARD_TITLE_ATTR]: '' };

/** A name for each entry that stays its own wherever the entry stands; one listed again is numbered. */
export const keysOf = (items: OmniExploreItem[]): string[] => {
    const met = new Map<string, number>();
    return items.map(item => {
        const key = item.kind === 'song' ? `song:${item.song.id}` : `${item.collection.type}:${item.collection.id}`;
        const times = met.get(key) ?? 0;
        met.set(key, times + 1);
        return times === 0 ? key : `${key}#${times}`;
    });
};

export const formatDuration = (durationMs: number): string => {
    const seconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

// An entry's picture, filling its box; a disc where the entry has none.
export const Picture: React.FC<{ url: string; size: number; className?: string }> = ({ url, size, className = '' }) => (url
    ? <img src={getSizedCoverUrl(url, size)} alt="" loading="lazy" decoding="async" draggable={false} className={`select-none object-cover ${className}`} />
    : <span className={`flex items-center justify-center ${className}`}><Disc size={28} className="opacity-20" /></span>);

// An entry's picture as it arrives: uncovered in the frame it fills (exploreMotion.ts).
export const Uncovered: React.FC<{ arrival: Arrival; children: React.ReactNode }> = ({ arrival, children }) => (
    <motion.span variants={PICTURE} custom={arrival} className="relative block h-full w-full">{children}</motion.span>
);

export const Hairline = () => <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />;

// What pointing at an entry does to its picture, besides making it lean (exploreTilt.ts; index.css draws all three).
// The sheen that follows the pointer over a picture: the last thing in the picture's frame.
export const Sheen = () => <span aria-hidden className="explore-sheen" />;

// The record an album's picture is the sleeve of. It stands out of sight behind the picture and
// comes out to the right; the entry after it in a row is drawn over what reaches it.
export const Record = () => (
    <span
        aria-hidden
        className="explore-record absolute right-0 top-[5%] block aspect-square h-[90%] rounded-full opacity-0 transition-[translate,rotate,opacity] duration-500 ease-out group-hover:translate-x-[22%] group-hover:rotate-[50deg] group-hover:opacity-100 group-focus-visible:translate-x-[22%] group-focus-visible:rotate-[50deg] group-focus-visible:opacity-100"
    />
);

export const DurationChip: React.FC<{ durationMs: number; className: string }> = ({ durationMs, className }) => (durationMs > 0
    ? <span className={`absolute rounded-md bg-black/70 px-1.5 py-1 font-mono text-[10px] leading-none text-white/90 ${className}`}>{formatDuration(durationMs)}</span>
    : null);

// What selecting an entry does, drawn as a round button: play for a song, open for a card.
// (With `explore-float` it stands over a picture that leans, and moves a little with the pointer.)
export const ActionMark: React.FC<{ isSong: boolean; className: string; style?: React.CSSProperties }> = ({ isSong, className, style }) => (
    <span className={`flex shrink-0 items-center justify-center rounded-full shadow-xl ${className}`} style={style}>
        {isSong ? <Play size={18} fill="currentColor" className="translate-x-px" /> : <ArrowUpRight size={19} />}
    </span>
);

/** What a section's body is given, whatever its form. */
export interface BodyProps {
    /** The section's entries, and a name for each (`keysOf`). */
    items: OmniExploreItem[];
    keys: string[];
    /** Seconds the body's entries wait before the first of them arrives, and before they leave. */
    base: number;
    leave: number;
    calm: boolean;
    /** The entries the body is first shown with are of a page come back to: there at once. */
    there: boolean;
    /** The entries the body is first shown with take the place of another read's: they turn in. */
    turns: boolean;
    /** Further entries are being read: their places are held open. */
    isLoadingMore: boolean;
    onSelect: (item: OmniExploreItem) => void;
}

/** What a body whose entries scroll sideways is given besides. */
export interface RowBodyProps extends BodyProps {
    /** The section these entries are of: where the row was left is kept under it. */
    sectionId: string;
    /** Given the row's element while it is shown: the section's own buttons scroll and measure it. */
    holder: React.MutableRefObject<HTMLDivElement | null>;
    /** The mask that fades the row's entries out at an end that hides more of them (a body that shows whole columns only has no use for it). */
    fade: string | undefined;
    /** The row's entries, its width or how far it is scrolled changed. */
    onMeasure: () => void;
}

// What makes an element the row of such a body: it is shown where the listener left it, and is
// watched for as long as it is shown. Gives the row's ref and what it does when it is scrolled.
// When the body goes, where it stood is kept (a read of the page forgets every row's place, and a
// body that outlives the read, the app's own section, would otherwise come back at its start),
// and the section is told that nothing is hidden any more: what takes the body's place may be no row.
export const useRow = ({ items, isLoadingMore, sectionId, holder, onMeasure }: RowBodyProps) => {
    const own = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const element = own.current;
        if (!element) return undefined;
        element.scrollLeft = exploreScroll.rows.get(sectionId) ?? 0;
        holder.current = element;
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onMeasure);
        observer?.observe(element);
        return () => {
            observer?.disconnect();
            exploreScroll.rows.set(sectionId, element.scrollLeft);
            if (holder.current === element) holder.current = null;
            onMeasure();
        };
        // Once for each body: a body is of one section, and the section's own functions do not change.
    }, []);
    useEffect(onMeasure, [items.length, isLoadingMore, onMeasure]);
    const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
        exploreScroll.rows.set(sectionId, event.currentTarget.scrollLeft);
        onMeasure();
    };
    return { own, onScroll };
};
