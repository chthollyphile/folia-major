import {
    getLatticeGeometry,
    layoutExpandedBlock,
    layoutLattice,
    locateNearestInstance,
    locateStepCandidates,
    type Bounds,
    type QueueInstance,
    type WallMetrics,
    type WallRect,
} from '../../wall/layout';
import type { WallEntryKind } from './latticeModel';

// src/components/app/lattice/wallLayout.ts
// What Lattice asks of its layout, whichever it is: the queue wall's lattice of blocks (the wall
// engine's geometry, components/wall/layout.ts) or the explore wall's lots (exploreLayout.ts).
// The engine knows no sections and no kinds of entries; these are Lattice's.

/**
 * One section of the explore page as the explore wall lays it out: its heading, and its entries
 * in the page's order, each by its place in the wall's list and by what it is.
 */
export type WallSection = {
    /** The section's own id: stays the section's while its entries are swapped for others. */
    key: string;
    /** May be empty. */
    heading: string;
    entries: Array<{ index: number; kind: WallEntryKind }>;
};

/**
 * A section's heading, drawn as a tile of its own. A section of more than one lot has one on
 * each: `part` of `parts`, from 0. `section` is its place in the layout's `sections`.
 */
export type WallHeading = WallRect & { instanceId: string; section: number; part: number; parts: number };

/**
 * What the wall asks of its layout, whichever it is: the queue wall's lattice of blocks
 * (`createQueueLayout`) or the explore wall's lots (`createExploreLayout` in exploreLayout.ts).
 * A poster is known by its place in the wall's list (`queueIndex`).
 */
export type WallLayout = {
    /** The sections the wall is laid out by, in the page's order. None on the queue wall. */
    sections: WallSection[];
    /** The size of a section's lot. Null on the queue wall. */
    lotSize: { width: number; height: number } | null;
    /** The posters and the headings that reach into `bounds` widened by `overscan`, no more than MAX_RENDERED_INSTANCES of them together. */
    near: (bounds: Bounds, overscan: number) => { posters: QueueInstance[]; headings: WallHeading[] };
    /** The copy of one entry's poster that is closest to a point. */
    nearest: (queueIndex: number, point: { x: number; y: number }) => QueueInstance | null;
    /** Where the posters around `active` stand while it is grown, `active` among them. A poster that is not named keeps its place. */
    grown: (active: QueueInstance) => Map<string, WallRect>;
    /** The posters a directional step from `from` may land on (wallNavigation.ts picks one). */
    stepCandidates: (from: QueueInstance) => QueueInstance[];
    /** The section a point stands in, as its place in `sections`; null between sections, and on the queue wall. */
    sectionAt: (point: { x: number; y: number }) => number | null;
    /** The top left of a section's heading, of the copy closest to a point. */
    sectionStart: (section: number, point: { x: number; y: number }) => { x: number; y: number } | null;
};

const NO_SECTIONS: WallSection[] = [];

/** The queue wall's layout: the lattice of this file behind `WallLayout`, for a list of `totalEntries`. */
export const createQueueLayout = (totalEntries: number, metrics: WallMetrics): WallLayout => {
    const geometry = getLatticeGeometry(totalEntries, metrics);
    return {
        sections: NO_SECTIONS,
        lotSize: null,
        near: (bounds, overscan) => ({ posters: layoutLattice(geometry, totalEntries, bounds, overscan, metrics), headings: [] }),
        nearest: (queueIndex, point) => locateNearestInstance(geometry, totalEntries, queueIndex, point, metrics),
        grown: active => layoutExpandedBlock(geometry, totalEntries, active, metrics),
        stepCandidates: from => locateStepCandidates(geometry, totalEntries, from, metrics),
        sectionAt: () => null,
        sectionStart: () => null,
    };
};
