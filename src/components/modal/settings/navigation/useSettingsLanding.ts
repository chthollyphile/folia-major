import { useCallback, useEffect, useRef } from 'react';
import { openFoldedGroup } from '../kit/FoldedGroup';
import { KIT_MOTION, useKitReducedMotion } from '../kit/motion';
import type { SettingsAnchor } from './settingsAnchorStore';

// src/components/modal/settings/navigation/useSettingsLanding.ts
// Lands the settings dialog on one group or one row rather than at the top of a page: scrolls to
// it, opens the folded group it is in, and outlines the row or the group for a moment. A click on a
// group's tab in the page header lands the same way.
//
// The landing cannot happen when the request arrives. A group registers in a layout effect, so the
// target does not exist until its page has mounted and rendered; some groups arrive later still,
// once an async status lands. The registry changing is the signal to look again. A request waits
// for that a few seconds and is then given up: a group drawn long after (the user flips the switch
// it depends on) must not pull the page to it.

/** How long a request waits for a place that is not drawn yet. */
const LANDING_WAIT_MS = 3000;

export type SettingsLandingTarget = {
    /** A group's anchor id or a row's option id. */
    id: string;
    /** The group to land on when the row is not shown (the switch it depends on is off). */
    groupId?: string;
    /** Asking for the same place twice has to land twice. */
    seq: number;
};

/** Runs `then` once the folded group `fold` is open, or at once when there is none. */
const afterOpening = (fold: Element | null | undefined, then: () => void) => {
    if (fold) {
        openFoldedGroup(fold, then);
    } else {
        then();
    }
};

const accentOf = (node: HTMLElement) => getComputedStyle(node).getPropertyValue('--st-accent').trim() || 'currentColor';

/** Shows where a landing went: `node` wears the ring `ring` for a moment, then goes back to `rest`. */
const outline = (node: HTMLElement, ring: string, rest: string, borderRadius: string, reduced: boolean) => {
    node.animate?.([
        { boxShadow: ring, borderRadius },
        { boxShadow: ring, borderRadius, offset: 0.7 },
        { boxShadow: rest, borderRadius },
    ], {
        duration: KIT_MOTION.flash * 1000,
        // With reduced motion the outline stays its time and goes, without fading.
        easing: reduced ? 'steps(1, end)' : 'ease-out',
    });
};

/** A row fills its card from edge to edge, so its ring is drawn inside it. */
const outlineRow = (row: HTMLElement, reduced: boolean) => {
    // The outline follows the corners of what it is drawn in: the card's for a row, and its own for
    // a smaller part such as a chip.
    const card = row.matches('.st-row') ? row.closest('.st-card') : null;
    const ring = `inset 0 0 0 2px ${accentOf(row)}`;
    outline(row, ring, 'inset 0 0 0 2px transparent', getComputedStyle(card ?? row).borderRadius, reduced);
};

/** A group's card turns its hairline into the ring; a group drawn without a kit card is ringed whole. */
const outlineGroup = (section: HTMLElement, reduced: boolean) => {
    const card = section.querySelector<HTMLElement>(':scope > .st-card');
    const node = card ?? section;
    const shadow = getComputedStyle(node).boxShadow;
    const rest = shadow && shadow !== 'none' ? shadow : '0 0 0 2px transparent';
    // 12px is the kit card's corner (rounded-xl).
    outline(node, `0 0 0 2px ${accentOf(node)}`, rest, card ? getComputedStyle(card).borderRadius : '12px', reduced);
};

export const useSettingsLanding = (
    target: SettingsLandingTarget | null,
    containerRef: React.RefObject<HTMLElement | null>,
    anchors: SettingsAnchor[],
    scrollToAnchor: (anchorId: string) => void,
    /** Jump instead of gliding, when the settings-scroll motion surface is reduced. */
    reducedMotion: boolean,
) => {
    // Keyed on the request's seq: a re-render that merely re-registers the groups must not land again.
    const servedSeqRef = useRef<number | null>(null);
    // The request that is waiting, and since when.
    const waitingRef = useRef({ seq: -1, since: 0 });
    const reducedOutline = useKitReducedMotion();

    /** Scrolls to the group `anchorId` and outlines it; what a click on its tab in the page header does. */
    const landOnGroup = useCallback((anchorId: string) => {
        scrollToAnchor(anchorId);
        const section = containerRef.current?.querySelector<HTMLElement>(`[data-settings-anchor="${anchorId}"]`);
        if (section) {
            outlineGroup(section, reducedOutline);
        }
    }, [containerRef, reducedOutline, scrollToAnchor]);

    useEffect(() => {
        const container = containerRef.current;
        if (!target || !container || servedSeqRef.current === target.seq) {
            return;
        }
        if (waitingRef.current.seq !== target.seq) {
            waitingRef.current = { seq: target.seq, since: performance.now() };
        } else if (performance.now() - waitingRef.current.since > LANDING_WAIT_MS) {
            servedSeqRef.current = target.seq;
            return;
        }

        const row = container.querySelector<HTMLElement>(`[data-settings-row="${target.id}"]`);
        if (row) {
            servedSeqRef.current = target.seq;
            afterOpening(row.closest('[data-settings-fold]'), () => {
                row.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
                outlineRow(row, reducedOutline);
            });
            return;
        }

        // A row that is not there has a group to fall back on once that group is on the page; until
        // the group registers, the page may simply not have rendered yet.
        const groupId = [target.id, target.groupId].find(id => id && anchors.some(anchor => anchor.id === id));
        if (!groupId) {
            return;
        }
        servedSeqRef.current = target.seq;
        afterOpening(
            container.querySelector(`[data-settings-anchor="${groupId}"] > [data-settings-fold]`),
            () => landOnGroup(groupId),
        );
    }, [anchors, containerRef, landOnGroup, reducedMotion, reducedOutline, target]);

    return landOnGroup;
};
