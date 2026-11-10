import { memo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { summaryOfSection } from './exploreWall';
import type { WallRect } from '../../wall/layout';
import type { WallSection } from './wallLayout';
import { WallTitle } from '../../wall/WallTitle';
import { ENTRANCE_LIFT, LEAVING } from './tileMotion';
import './LatticeSections.css';

// src/components/app/lattice/LatticeHeading.tsx
// The heading of a section of the explore wall, drawn as a tile of the wall: the same gap, the
// same square corners, the same landing and leaving as a poster (LatticePoster), and no picture.
// On it: the section's number of the wall's sections, the heading in the posters' title face,
// fitted as a poster's title is (WallTitle) to two lines, and one line saying how many
// entries the section has and of which kinds. A section that takes more than one lot shows on
// each which part it is. The tile is not chosen, does not grow and takes no focus; a drag that
// starts on it pans the wall.

type LatticeHeadingProps = {
    rect: WallRect;
    section: WallSection;
    /** The section's number among the wall's sections, from 1, and how many there are. */
    number: number;
    count: number;
    /** Which of the section's lots this heading stands on, from 1, and how many lots the section takes. */
    part: number;
    parts: number;
    /** As a poster's: seconds before the tile drops into its slot, or null outside the opening wave. */
    entranceDelay: number | null;
    /** As a poster's: mounted as it is drawn, with no entrance. Read at the mount only. */
    mountsInPlace: boolean;
    /** As a poster's: the reverse-wave delay for the moment the wall leaves; identity must stay stable. */
    getExitDelay: (rect: { x: number; y: number }) => number | null;
    reducedMotion: boolean | null;
};

const twoDigits = (value: number) => String(value).padStart(2, '0');

// `rect` is rebuilt at every cull: compared by its numbers. `mountsInPlace` is read at the mount only.
const areHeadingPropsEqual = (previous: LatticeHeadingProps, next: LatticeHeadingProps) => {
    for (const key of Object.keys(next) as (keyof LatticeHeadingProps)[]) {
        if (key === 'rect' || key === 'mountsInPlace') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return previous.rect.x === next.rect.x && previous.rect.y === next.rect.y
        && previous.rect.width === next.rect.width && previous.rect.height === next.rect.height;
};

function LatticeHeading({
    rect,
    section,
    number,
    count,
    part,
    parts,
    entranceDelay,
    mountsInPlace,
    getExitDelay,
    reducedMotion,
}: LatticeHeadingProps) {
    const { t } = useTranslation();
    const position = `${twoDigits(number)} / ${twoDigits(count)}`;
    // Frozen at mount: the wave's own delay must not follow later camera moves.
    const landingDelay = useRef(entranceDelay).current;
    const landing = entranceDelay === null ? null : landingDelay;
    // (The wall hands over a heading of its layout, which carries more than the four numbers.)
    const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };

    return (
        <motion.article
            className={`lattice-heading ${section.heading ? '' : 'is-untitled'}`}
            // The landing, the fade-up outside the wave and the leaving are a poster's (LatticePoster).
            initial={reducedMotion || mountsInPlace
                ? false
                : landing === null
                    ? { ...box, opacity: 0, scale: 0.94 }
                    : { ...box, y: box.y - ENTRANCE_LIFT, opacity: 0, scale: 0.88 }}
            animate={{ ...box, opacity: 1, scale: 1 }}
            variants={LEAVING}
            custom={() => ({ y: rect.y - ENTRANCE_LIFT, delay: getExitDelay(rect) })}
            exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : 'leaving'}
            transition={reducedMotion
                ? { duration: 0 }
                : landing === null
                    ? { type: 'spring', stiffness: 300, damping: 34, opacity: { duration: 0.26, ease: 'easeOut' } }
                    : { type: 'spring', stiffness: 360, damping: 24, delay: landing, opacity: { duration: 0.24, delay: landing } }}
            aria-label={section.heading || position}
        >
            <span className="lattice-poster-badge">{position}</span>
            {parts > 1 && <span className="lattice-poster-badge lattice-heading-part">{part}/{parts}</span>}
            <span className="lattice-heading-copy">
                {section.heading && <WallTitle title={section.heading} expanded={false} targetPosterWidth={rect.width} maxLines={2} />}
                <small>{summaryOfSection(section, t)}</small>
            </span>
        </motion.article>
    );
}

export default memo(LatticeHeading, areHeadingPropsEqual);
