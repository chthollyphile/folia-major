import { DEFAULT_PERSONAL_FM_CATALOG, getPersonalFmSceneEntry, type PersonalFmCatalog } from '../../../services/onlineMusic/fmModes';
import { buildPersonalFmMatches, readPersonalFmOption } from '../commands/fmModeOptions';
import type { CommandPaletteMatch } from '../types';
import type { CommandPaletteSurface, CommandSurfaceArgs } from './types';

// src/components/command-palette/surfaces/fmModeSurface.ts
// Personal FM mode picker: the input filters, arrows move, Enter or a click applies. Pills wrap
// freely and each category wraps a different number of times, so — unlike the fixed-column icon
// picker — rows can only be known by measuring what was actually laid out. Left/right walks the
// flat list, which already runs in visual order; up/down reads the rendered rows.

export type PersonalFmSection = {
    key: string;
    labelKey: string;
    labelFallback: string;
    /** Indices into the match list, so navigation and rendering share one source of truth. */
    indices: number[];
};

const sectionOrder = (catalog: PersonalFmCatalog) => [
    { key: 'mode', labelKey: 'personalFmMode.category.mode', labelFallback: 'Mode' },
    ...catalog.categories.map(category => ({
        key: category.id as string,
        labelKey: category.labelKey,
        labelFallback: category.labelFallback,
    })),
];

const sectionKeyOf = (match: CommandPaletteMatch, catalog: PersonalFmCatalog): string | null => {
    const option = readPersonalFmOption(match.command.id);
    if (!option) return null;
    if (option.kind === 'mode') return 'mode';
    return getPersonalFmSceneEntry(option.id, catalog)?.category ?? null;
};

/** Only sections with surviving matches are kept, so a filtered list has no empty headers. */
export const buildPersonalFmSections = (matches: CommandPaletteMatch[], catalog = DEFAULT_PERSONAL_FM_CATALOG): PersonalFmSection[] => {
    const byKey = new Map<string, number[]>();
    matches.forEach((match, index) => {
        const key = sectionKeyOf(match, catalog);
        if (!key) return;
        const existing = byKey.get(key);
        if (existing) {
            existing.push(index);
        } else {
            byKey.set(key, [index]);
        }
    });
    return sectionOrder(catalog)
        .map(section => ({ ...section, indices: byKey.get(section.key) ?? [] }))
        .filter(section => section.indices.length > 0);
};

const HORIZONTAL_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
const VERTICAL_STEPS: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 };

const PILL_SELECTOR = '[data-fm-option]';
// Pills in one flex row share a top to the pixel; the tolerance only absorbs sub-pixel layout.
const ROW_TOLERANCE_PX = 4;

type PillRow = { indices: number[]; centers: number[] };

/**
 * Groups the rendered pills into their real rows. Returns null when there is nothing measurable
 * (no DOM, or the view has not painted yet), so the caller can fall back to the section hop.
 */
const readVisualRows = (matches: CommandPaletteMatch[]): PillRow[] | null => {
    if (typeof document === 'undefined') {
        return null;
    }

    const indexByCommandId = new Map(matches.map((match, index) => [match.command.id, index]));
    const pills = Array.from(document.querySelectorAll<HTMLElement>(PILL_SELECTOR))
        .map(node => ({ index: indexByCommandId.get(node.dataset.fmOption ?? ''), rect: node.getBoundingClientRect() }))
        .filter((pill): pill is { index: number; rect: DOMRect } => pill.index !== undefined)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

    if (pills.length === 0) {
        return null;
    }

    const rows: PillRow[] = [];
    let rowTop = Number.NEGATIVE_INFINITY;
    pills.forEach(pill => {
        const center = pill.rect.left + pill.rect.width / 2;
        if (rows.length === 0 || pill.rect.top - rowTop > ROW_TOLERANCE_PX) {
            rows.push({ indices: [pill.index], centers: [center] });
            rowTop = pill.rect.top;
            return;
        }
        const row = rows[rows.length - 1];
        row.indices.push(pill.index);
        row.centers.push(center);
    });
    return rows;
};

/** Section hop, used only when the rows cannot be measured. */
const navigateSections = (step: number, { matches, activeIndex, setActiveIndex, context }: CommandSurfaceArgs) => {
    const sections = buildPersonalFmSections(matches, context.playback.personalFmCatalog);
    const currentSection = sections.findIndex(section => section.indices.includes(activeIndex));
    if (currentSection < 0) {
        setActiveIndex(0);
        return;
    }

    const nextSection = sections[currentSection + step];
    if (!nextSection) {
        return;
    }
    const offset = sections[currentSection].indices.indexOf(activeIndex);
    setActiveIndex(nextSection.indices[Math.min(offset, nextSection.indices.length - 1)]);
};

const navigate = (event: KeyboardEvent, args: CommandSurfaceArgs) => {
    const { matches, activeIndex, setActiveIndex } = args;
    if (matches.length === 0) {
        return false;
    }

    const horizontalStep = HORIZONTAL_STEPS[event.key];
    if (horizontalStep !== undefined) {
        // Clamping rather than wrapping: jumping from the last language back to the first mode
        // reads as a glitch when the two are far apart on screen.
        setActiveIndex(Math.max(0, Math.min(matches.length - 1, activeIndex + horizontalStep)));
        return true;
    }

    const verticalStep = VERTICAL_STEPS[event.key];
    if (verticalStep === undefined) {
        return false;
    }

    const rows = readVisualRows(matches);
    if (!rows) {
        navigateSections(verticalStep, args);
        return true;
    }

    const rowIndex = rows.findIndex(row => row.indices.includes(activeIndex));
    if (rowIndex < 0) {
        setActiveIndex(0);
        return true;
    }

    const targetRow = rows[rowIndex + verticalStep];
    if (!targetRow) {
        return true;
    }

    // Landing on the horizontally nearest pill keeps the movement reading as a column walk even
    // though every row has a different pill count and different pill widths.
    const currentRow = rows[rowIndex];
    const currentCenter = currentRow.centers[currentRow.indices.indexOf(activeIndex)];
    let nearest = 0;
    targetRow.centers.forEach((center, position) => {
        if (Math.abs(center - currentCenter) < Math.abs(targetRow.centers[nearest] - currentCenter)) {
            nearest = position;
        }
    });
    setActiveIndex(targetRow.indices[nearest]);
    return true;
};

export const fmModeSurface: CommandPaletteSurface = {
    load: () => import('./FmModeSurfaceView'),
    useLiveQuery: true,
    buildMatches: ({ context, query }) => buildPersonalFmMatches(context, query),
    onKeyDown: navigate,
    mapProps: ({ context, matches, activeIndex, setActiveIndex, executeMatch, isDaylight, theme, isExecuting }) => ({
        matches,
        activeIndex,
        setActiveIndex,
        executeMatch,
        isDaylight,
        isExecuting,
        theme,
        selection: context.playback.personalFmSelection,
        catalog: context.playback.personalFmCatalog,
    }),
};
