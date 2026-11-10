import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { OmniExploreItem } from '../../../../types/onlineMusic';
import { ActionMark, DurationChip, FOCUS_RING, Hairline, Picture, Record, Sheen, Uncovered, MORPH_TITLE, morphSourceOf, useRow, type BodyProps, type RowBodyProps } from './ExploreParts';
import { faceOf, type Face } from './exploreFace';
import { BeatRing, LEVELS_CHIP, Levels, usePlaying, useSound } from './ExplorePlaying';
import { BAND, BODY, CAPTION, TILE, fromAfar, useArrivals, useRevealGrowth, type Arrival } from './exploreMotion';

// src/components/app/home/explore/ExploreRow.tsx
// The bodies of every section but the one that opens the page. A row of pictures that scrolls
// sideways, each picture in its own proportions (a video still wide, an artist round, any
// other cover square) and all of one height; and, for a section of a single entry, a band.

const CARD_WIDTH = { wide: 'w-[288px]', square: 'w-[162px]', round: 'w-[162px]' } as const;
// How many places a row holds open while further entries are read.
const GHOST_TILES = 4;
/** How many degrees a row's picture leans to the pointer at most. */
const TILT = 6;

// A place in a row. What stands in it moves inside it: a row comes to rest on the edges of its
// places, and it would follow one that moved itself.
const Place: React.FC<{ shape: Face['shape']; children: React.ReactNode }> = ({ shape, children }) => (
    <div data-explore-place className={`shrink-0 snap-start ${CARD_WIDTH[shape]}`}>{children}</div>
);

const Card: React.FC<{ item: OmniExploreItem; arrival: Arrival; onSelect: () => void }> = ({ item, arrival, onSelect }) => {
    const { t } = useTranslation();
    const face = faceOf(item, t);
    const isRound = face.shape === 'round';
    const round = isRound ? 'rounded-full' : 'rounded-2xl';
    const own = useRef<HTMLButtonElement>(null);
    const playing = usePlaying(item);
    useSound(own, playing);
    return (
        <Place shape={face.shape}>
        <motion.button
            ref={own}
            type="button"
            variants={TILE}
            custom={arrival}
            transformTemplate={fromAfar}
            {...morphSourceOf(item)}
            data-explore-card={face.kind}
            data-explore-order={arrival.order}
            data-explore-playing={playing ?? undefined}
            aria-current={playing ? 'true' : undefined}
            title={face.title}
            onClick={onSelect}
            className="group block w-full text-left outline-none"
        >
            {/* What leans to the pointer and takes the beat: the picture in its frame, and what stands behind and around it. */}
            <span data-explore-tilt={TILT} data-explore-beat className="relative block h-[162px] group-hover:-translate-y-1">
                {face.kind === 'album' && face.pictureUrl && <Record />}
                {playing && <BeatRing round={round} />}
                <span className={`relative block h-full overflow-hidden bg-[var(--ex-tint)] transition-shadow duration-300 ease-out group-hover:shadow-[0_24px_40px_-24px_rgba(0,0,0,0.75)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--text-primary)] ${round}`}>
                    <Uncovered arrival={arrival}><Picture url={face.pictureUrl} size={480} className="h-full w-full" /></Uncovered>
                    {item.kind === 'song' && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:opacity-100">
                            <ActionMark isSong className="explore-float h-11 w-11 bg-white text-black" />
                        </span>
                    )}
                    {playing
                        ? <Levels className={`bottom-2 right-2 ${LEVELS_CHIP}`} />
                        : <DurationChip durationMs={face.durationMs} className="bottom-2 right-2 transition-opacity duration-300 group-hover:opacity-0" />}
                    <Hairline />
                    <Sheen />
                </span>
            </span>
            <motion.span variants={CAPTION} custom={arrival} className={`mt-3 block ${isRound ? 'text-center' : 'pr-2'}`}>
                <span {...MORPH_TITLE} className="line-clamp-2 text-sm font-medium leading-snug">{face.title}</span>
                {face.subtitle && <span className="mt-1 block truncate text-xs text-[color:var(--ex-soft)]">{face.subtitle}</span>}
            </motion.span>
        </motion.button>
        </Place>
    );
};

// The place of a picture that is being read, in the shape of the row's last one.
const GhostTile: React.FC<{ shape: Face['shape']; arrival: Arrival }> = ({ shape, arrival }) => (
    <Place shape={shape}>
        <motion.span variants={TILE} custom={arrival} transformTemplate={fromAfar} data-explore-ghost className="block">
            <span className={`block h-[162px] animate-pulse bg-[var(--ex-tint-strong)] ${shape === 'round' ? 'rounded-full' : 'rounded-2xl'}`} />
            <span className="mt-3 block h-3 w-4/5 animate-pulse rounded-full bg-[var(--ex-tint-strong)]" />
            <span className="mt-2 block h-2.5 w-1/2 animate-pulse rounded-full bg-[var(--ex-tint)]" />
        </motion.span>
    </Place>
);

export const RowBody: React.FC<RowBodyProps> = props => {
    const { items, keys, base, leave, calm, there, turns, isLoadingMore, onSelect, fade } = props;
    const { t } = useTranslation();
    const { own, onScroll } = useRow(props);
    const arrivalOf = useArrivals(keys, base, calm, 0, there, turns);
    // The first of the places asked for is brought to the row's start.
    useRevealGrowth(keys, isLoadingMore, before => {
        own.current?.querySelectorAll('[data-explore-place]')[before]
            ?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest', inline: 'start' });
    });
    const lastShape = faceOf(items[items.length - 1], t).shape;

    return (
        <motion.div
            ref={own}
            data-explore-row
            data-explore-body
            variants={BODY}
            custom={leave}
            initial="away"
            animate="here"
            exit="gone"
            onScroll={onScroll}
            className="-mx-2 flex snap-x scroll-px-2 items-start gap-5 overflow-x-auto px-2 pb-7 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ maskImage: fade, WebkitMaskImage: fade }}
        >
            {items.map((item, index) => <Card key={keys[index]} item={item} arrival={arrivalOf(keys[index])} onSelect={() => onSelect(item)} />)}
            {isLoadingMore && Array.from({ length: GHOST_TILES }, (_, index) => (
                <GhostTile key={`ghost-${index}`} shape={lastShape} arrival={{ order: index, base: 0, calm }} />
            ))}
        </motion.div>
    );
};

// A section of one entry: the entry as a band.
export const SoloBody: React.FC<BodyProps> = ({ items, base, leave, calm, there, turns, onSelect }) => {
    const { t } = useTranslation();
    const [only] = items;
    const face = faceOf(only, t);
    const arrival: Arrival = { order: 0, base, calm, there, turns };
    const own = useRef<HTMLButtonElement>(null);
    const playing = usePlaying(only);
    useSound(own, playing);
    return (
        <motion.div data-explore-body variants={BODY} custom={leave} initial="away" animate="here" exit="gone">
        <motion.button
            ref={own}
            type="button"
            {...morphSourceOf(only)}
            data-explore-card={face.kind}
            data-explore-playing={playing ?? undefined}
            aria-current={playing ? 'true' : undefined}
            variants={BAND}
            custom={arrival}
            title={face.title}
            onClick={() => onSelect(only)}
            className={`group flex w-full max-w-3xl items-center gap-5 rounded-3xl bg-[var(--ex-tint)] p-3.5 pr-6 text-left transition-colors duration-300 hover:bg-[var(--ex-tint-strong)] ${FOCUS_RING}`}
        >
            <span data-explore-beat className={`relative block h-[108px] shrink-0 overflow-hidden bg-[var(--ex-tint)] ${face.shape === 'wide' ? 'w-48 rounded-2xl' : face.shape === 'round' ? 'w-[108px] rounded-full' : 'w-[108px] rounded-2xl'}`}>
                <Uncovered arrival={arrival}><Picture url={face.pictureUrl} size={480} className="h-full w-full" /></Uncovered>
                {playing ? <Levels className={`bottom-2 right-2 ${LEVELS_CHIP}`} /> : <DurationChip durationMs={face.durationMs} className="bottom-2 right-2" />}
                <Hairline />
            </span>
            <motion.span variants={CAPTION} custom={arrival} className="block min-w-0 flex-1">
                <span {...MORPH_TITLE} className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight">{face.title}</span>
                {face.subtitle && <span className="mt-1 block truncate text-sm text-[color:var(--ex-soft)]">{face.subtitle}</span>}
            </motion.span>
            <ActionMark
                isSong={only.kind === 'song'}
                className="h-12 w-12 transition-transform duration-300 group-hover:scale-110"
                style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
            />
        </motion.button>
        </motion.div>
    );
};
