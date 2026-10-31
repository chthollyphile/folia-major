import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import type { SongResult } from '../../../../types';
import type { OmniCollection, OmniExploreItem, OmniExploreSection } from '../../../../types/onlineMusic';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { LeadBody } from './ExploreLead';
import { EXPLORE_PILL, EXPLORE_SERIF, keysOf } from './ExploreParts';
import { RowBody, SoloBody } from './ExploreRow';
import { RULE, SECTION, TITLE, sectionBase, sectionLeave, type Arrival } from './exploreMotion';

// src/components/app/home/explore/ExploreSections.tsx
// The sections of the explore tab, one under another. The page's first section opens it
// (ExploreLead.tsx); every other one is a row of pictures, or a band where it holds a single
// entry (ExploreRow.tsx). A section is one height whatever it holds: what does not fit beside
// what is shown stands to the right, and the section's arrows scroll to it. A song plays with the songs of its section as the queue; any other
// entry opens its collection.
// A section is its heading: the heading stays where it is from one read of the page to the
// next, and what stands under it is exchanged (exploreMotion.ts says how everything moves).

export { EXPLORE_PILL, EXPLORE_TOKENS } from './ExploreParts';

// How far a row's cards fade out at an end that hides more of them.
const FADE = '56px';

type Form = 'solo' | 'lead' | 'row';

interface ShelfProps {
    section: OmniExploreSection;
    form: Form;
    /** Which read the section's entries are of: entries of another read take these ones' place. */
    batch: string;
    /** How the section itself arrives. */
    arrival: Arrival;
    /** Seconds the section's entries wait before the first of them arrives, and before they leave. */
    base: number;
    leave: number;
    /** The entries the section holds when it is first shown arrive, rather than being there. */
    enters: boolean;
    /** Another page is being read in place of this one. */
    isStale: boolean;
    isLoadingMore: boolean;
    /** What ends the heading row of the page's first section: room for the page's own controls. */
    pageControls?: React.ReactNode;
    onSelect: (item: OmniExploreItem, section: OmniExploreSection) => void;
    onLoadMore: (sectionId: string) => void;
}

// A section: its heading, with "more" beside it where the section has further entries, and
// under it the entries of the read at hand.
const Shelf: React.FC<ShelfProps> = ({ section, form, batch, arrival, base, leave, enters, isStale, isLoadingMore, pageControls, onSelect, onLoadMore }) => {
    const { t } = useTranslation();
    const keys = useMemo(() => keysOf(section.items), [section.items]);
    // The element that scrolls sideways (a band has none), and which of its ends hide further entries.
    const row = useRef<HTMLDivElement | null>(null);
    const [hidden, setHidden] = useState({ before: false, after: false });
    const measure = useCallback(() => {
        const element = row.current;
        const before = Boolean(element) && element!.scrollLeft > 1;
        const after = Boolean(element) && element!.scrollLeft + element!.clientWidth < element!.scrollWidth - 1;
        setHidden(current => (current.before === before && current.after === after ? current : { before, after }));
    }, []);
    const scrollRow = (direction: -1 | 1) => {
        const element = row.current;
        if (element) element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: 'smooth' });
    };
    const fade = hidden.before || hidden.after
        ? `linear-gradient(to right, ${hidden.before ? `transparent, black ${FADE}` : 'black, black'}, ${hidden.after ? `black calc(100% - ${FADE}), transparent` : 'black, black'})`
        : undefined;
    // The entries of a later read come as soon as the ones before them have left, and turn in where those turned away.
    const firstBatch = useRef(batch);
    const isFirstBatch = batch === firstBatch.current;
    const body = {
        items: section.items, keys, base: isFirstBatch ? base : 0, leave, calm: arrival.calm, there: !enters && isFirstBatch, turns: !isFirstBatch, isLoadingMore,
        onSelect: (item: OmniExploreItem) => onSelect(item, section),
    };

    return (
        <motion.section data-explore-shelf data-explore-order={arrival.order} variants={SECTION} custom={arrival} initial="away" animate="here" exit="gone">
            {/* More room after the section that opens the page than between the others. */}
            <div className={form === 'lead' ? 'pb-[72px]' : 'pb-14'}>
                <div className="mb-2 flex items-center gap-2.5 font-['Microsoft Yahei']">
                    {/* The heading is what its title comes up from under. It is higher than the row, so that no stroke
                        of the title is cut, and takes the row's height of it: the row is as high as its buttons. */}
                    <h2 className="-my-1 min-w-0 overflow-hidden text-[28px] font-medium leading-10 tracking-[0.01em]" style={{ fontFamily: EXPLORE_SERIF, textShadow: '0 0 8px #fff' }}>
                        <motion.span variants={TITLE} custom={arrival} className="block truncate">{section.title}</motion.span>
                    </h2>
                    <motion.span aria-hidden variants={RULE} custom={arrival} data-explore-rule className="ml-1 h-px min-w-6 flex-1 origin-left bg-[var(--ex-line)]" />
                    {section.moreCursor && (
                        <button type="button" data-explore-more disabled={isLoadingMore || isStale} onClick={() => onLoadMore(section.id)} className={`flex h-8 shrink-0 items-center gap-1.5 px-3.5 ${EXPLORE_PILL}`}>
                            {isLoadingMore ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                            <span>{t('home.exploreMore')}</span>
                        </button>
                    )}
                    {(hidden.before || hidden.after) && ([-1, 1] as const).map(direction => (
                        <button
                            key={direction}
                            type="button"
                            data-explore-scroll={direction < 0 ? 'left' : 'right'}
                            disabled={direction < 0 ? !hidden.before : !hidden.after}
                            onClick={() => scrollRow(direction)}
                            aria-label={t(direction < 0 ? 'home.exploreScrollLeft' : 'home.exploreScrollRight')}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-30 ${EXPLORE_PILL}`}
                        >
                            {direction < 0 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                        </button>
                    ))}
                    {pageControls}
                </div>
                {/* The entries wait, dimmed and out of reach, while the ones that will take their place are read. */}
                <motion.div
                    data-explore-waiting={isStale || undefined}
                    inert={isStale}
                    initial={false}
                    animate={{ opacity: isStale ? 0.6 : 1 }}
                    transition={{ duration: 0.3 }}
                    className={isStale ? 'explore-waiting pointer-events-none' : undefined}
                >
                    {/* Whether the first entries arrive is told to them (`there`), not to this: told here, it
                        would also hold for every entry that joins the body later. */}
                    <AnimatePresence mode="wait">
                        {/* (Where a body was left is kept apart for each form, a place among columns being none among pictures, and
                            for each read: a provider may name a section of its next page as it named one of this page.) */}
                        {form === 'row' ? <RowBody key={`${batch}:row`} {...body} sectionId={`${section.id}:${batch}:row`} holder={row} fade={fade} onMeasure={measure} />
                            : form === 'lead' ? <LeadBody key={`${batch}:lead`} {...body} sectionId={`${section.id}:${batch}:lead`} holder={row} fade={fade} onMeasure={measure} />
                                : <SoloBody key={`${batch}:solo`} {...body} />}
                    </AnimatePresence>
                </motion.div>
            </div>
        </motion.section>
    );
};

// The page that was last drawn in, section after section. Coming back to a page (the home screen is taken down
// while the player covers it) shows it as it was left, at once.
let risenPage = -1;

/** A name for each section that it keeps from one read to the next: its heading. */
// (One of the app's own sections is the same section in whichever language its heading is.)
const namesOf = (sections: OmniExploreSection[], ownSectionIds?: ReadonlySet<string>): string[] => {
    const met = new Map<string, number>();
    return sections.map(section => {
        const name = ownSectionIds?.has(section.id) ? section.id : section.title || section.id;
        const times = met.get(name) ?? 0;
        met.set(name, times + 1);
        return times === 0 ? name : `${name}#${times}`;
    });
};

interface ExploreSectionsProps {
    /** Which read of the page these are the sections of. */
    page: number;
    /** Each holds at least one entry; the first one opens the page. */
    sections: OmniExploreSection[];
    /** Which batch of its entries each section of a read shows, by the section's id: the entries of another batch take the place of the ones shown. */
    batches: Readonly<Record<string, { batch: number }>>;
    /** The sections that are the app's own, not of any read: they stay through a read of the page and do not wait for it. */
    ownSectionIds?: ReadonlySet<string>;
    /** Another page is being read in place of this one. */
    isStale: boolean;
    loadingSectionIds: string[];
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    onOpenCollection: (collection: OmniCollection) => void;
    onLoadMoreOf: (sectionId: string) => void;
    /** What the first heading row ends with: room for the page's own controls, which stand over it. */
    pageControls: React.ReactNode;
}

export const ExploreSections: React.FC<ExploreSectionsProps> = ({ page, sections, batches, ownSectionIds, isStale, loadingSectionIds, onPlaySong, onOpenCollection, onLoadMoreOf, pageControls }) => {
    const calm = useReducedMotionFor('uiMicroMotion');
    const [rises] = useState(() => page !== risenPage);
    useEffect(() => { risenPage = page; }, [page]);
    const names = namesOf(sections, ownSectionIds);
    // How each section arrives: the ones the page is first shown with are drawn in one after another;
    // one that joins later (again, too, after it had left) opens its room where it stands.
    const told = useRef<Map<string, Arrival> | null>(null);
    const before = told.current;
    const arrivals = new Map<string, Arrival>();
    let late = 0;
    // (The ones after the last section that was there join at the list's end.)
    const lastThere = names.reduce((last, name, index) => (before?.has(name) ? index : last), -1);
    names.forEach((name, index) => {
        arrivals.set(name, before?.get(name) ?? (before ? { order: late++, base: 0, calm, late: true, last: index > lastThere } : { order: index, base: sectionBase(index, calm), calm }));
    });
    told.current = arrivals;
    const select = useCallback((item: OmniExploreItem, section: OmniExploreSection) => {
        if (item.kind === 'collection') { onOpenCollection(item.collection); return; }
        onPlaySong(item.song, section.items.flatMap(entry => (entry.kind === 'song' ? [entry.song] : [])));
    }, [onOpenCollection, onPlaySong]);

    return (
        <div>
            <AnimatePresence initial={rises}>
                {sections.map((section, index) => {
                    const arrival = arrivals.get(names[index])!;
                    const isOwn = Boolean(ownSectionIds?.has(section.id));
                    return (
                        <Shelf
                            key={names[index]}
                            section={section}
                            form={section.items.length === 1 && !section.moreCursor ? 'solo' : index === 0 ? 'lead' : 'row'}
                            batch={isOwn ? 'own' : String(batches[section.id]?.batch ?? 0)}
                            arrival={arrival}
                            // (One that opens its room shows its entries once the room is there.)
                            base={arrival.last ? sectionBase(arrival.order, calm) : arrival.late ? 0.14 : sectionBase(index, calm)}
                            leave={sectionLeave(index, calm)}
                            enters={rises || Boolean(arrival.late)}
                            isStale={isStale && !isOwn}
                            isLoadingMore={loadingSectionIds.includes(section.id)}
                            pageControls={index === 0 ? pageControls : undefined}
                            onSelect={select}
                            onLoadMore={onLoadMoreOf}
                        />
                    );
                })}
            </AnimatePresence>
        </div>
    );
};
