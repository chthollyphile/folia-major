import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsAnchor } from '../components/modal/settings/navigation/settingsAnchorStore';

// src/hooks/useSettingsScrollSpy.ts
// Keeps the settings page header's contents line in step with the content column's scroll position.

/**
 * How far down the column a section has to reach before it counts as the current one. Near the top:
 * a page that opens on a short first group must still mark that group, not the one under it.
 */
const ACTIVE_LINE_RATIO = 0.1;
/** Gap left above a section after scrolling to it. */
const SCROLL_TOP_PADDING = 12;
/** Longest we keep ignoring observer updates after a click, if the scroll never settles. */
const CLICK_LOCK_MS = 800;
/** Slack when deciding the column has bottomed out. */
const BOTTOM_EPSILON_PX = 2;

interface ScrollSpyOptions {
    containerRef: React.RefObject<HTMLElement | null>;
    anchors: SettingsAnchor[];
    enabled: boolean;
    /** Jump instead of animating, when the settings-scroll motion surface is reduced. */
    reducedMotion: boolean;
}

interface ScrollSpyResult {
    activeAnchorId: string | null;
    scrollToAnchor: (anchorId: string) => void;
}

/**
 * Tracks which section is currently in view and exposes a click-to-scroll helper.
 *
 * An IntersectionObserver drives this rather than a scroll listener: it only fires when a section
 * crosses an edge, so the work stays off the scroll path entirely. Each callback then measures the
 * sections against their live viewport position instead of trusting positions reported earlier — a
 * section can travel right past the viewport without ever reporting, and a cached offset for one of
 * those goes stale and wins the comparison forever. Only the resulting id — a single string,
 * compared before it is written — reaches React state.
 */
export const useSettingsScrollSpy = ({ containerRef, anchors, enabled, reducedMotion }: ScrollSpyOptions): ScrollSpyResult => {
    const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
    const lockRef = useRef<{ target: string; until: number } | null>(null);
    const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** The section a click scrolled to, until the user scrolls the column by hand. */
    const pickedRef = useRef<string | null>(null);

    const resolveActiveId = useCallback((): string | null => {
        const container = containerRef.current;
        if (!container) {
            return null;
        }

        const nodes = [...container.querySelectorAll<HTMLElement>('[data-settings-anchor]')];
        if (nodes.length === 0) {
            return null;
        }

        // At the end of the column the last sections can all sit below the active line, so nothing
        // would ever select them. Once scrolling has bottomed out, the last one is the answer. A
        // page that fits without scrolling has not bottomed out: it is still at its top.
        if (container.scrollTop > 0 && container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_EPSILON_PX) {
            // Several sections are in view there and their places do not tell which one a click
            // was for: the one it scrolled to keeps the mark while it is in view.
            const picked = nodes.find(node => node.dataset.settingsAnchor === pickedRef.current);
            if (picked) {
                const view = container.getBoundingClientRect();
                const rect = picked.getBoundingClientRect();
                if (rect.bottom > view.top && rect.top < view.bottom) {
                    return pickedRef.current;
                }
            }
            return nodes[nodes.length - 1].dataset.settingsAnchor ?? null;
        }

        const activeLine = container.getBoundingClientRect().top + container.clientHeight * ACTIVE_LINE_RATIO;
        let current = nodes[0];
        for (const node of nodes) {
            if (node.getBoundingClientRect().top <= activeLine) {
                current = node;
            }
        }

        return current.dataset.settingsAnchor ?? null;
    }, [containerRef]);

    const applyActiveId = useCallback(() => {
        const next = resolveActiveId();
        setActiveAnchorId(current => (current === next ? current : next));
    }, [resolveActiveId]);

    // Release the click lock, and forget which section the click was for, as soon as the user takes
    // over the scroll themselves: with the wheel, a finger, the scrollbar or a key. These handlers
    // only write refs, so even wheel events cost nothing in React terms.
    useEffect(() => {
        const container = containerRef.current;
        if (!enabled || !container) {
            return;
        }

        const release = () => {
            lockRef.current = null;
            pickedRef.current = null;
        };

        container.addEventListener('wheel', release, { passive: true });
        container.addEventListener('touchstart', release, { passive: true });
        container.addEventListener('pointerdown', release, { passive: true });
        container.addEventListener('keydown', release, { passive: true });
        return () => {
            container.removeEventListener('wheel', release);
            container.removeEventListener('touchstart', release);
            container.removeEventListener('pointerdown', release);
            container.removeEventListener('keydown', release);
        };
    }, [containerRef, enabled]);

    useEffect(() => {
        const container = containerRef.current;

        if (!enabled || !container || anchors.length === 0 || typeof IntersectionObserver === 'undefined') {
            setActiveAnchorId(null);
            return;
        }

        const observer = new IntersectionObserver(() => {
            const lock = lockRef.current;
            if (lock) {
                if (performance.now() <= lock.until && resolveActiveId() !== lock.target) {
                    return;
                }
                lockRef.current = null;
            }

            applyActiveId();
        }, { root: container, threshold: 0 });

        for (const anchor of anchors) {
            observer.observe(anchor.node as unknown as Element);
        }

        return () => observer.disconnect();
    }, [containerRef, anchors, enabled, resolveActiveId, applyActiveId]);

    const scrollToAnchor = useCallback((anchorId: string) => {
        const container = containerRef.current;
        const node = container?.querySelector<HTMLElement>(`[data-settings-anchor="${anchorId}"]`);
        if (!container || !node) {
            return;
        }

        // Show the destination immediately; a smooth scroll would otherwise light up every section
        // it travels through on the way there.
        setActiveAnchorId(anchorId);
        pickedRef.current = anchorId;
        lockRef.current = { target: anchorId, until: performance.now() + CLICK_LOCK_MS };

        // The observer can go quiet before the lock expires — a programmatic scroll fires no wheel or
        // pointer event to release it — so settle on whatever is actually in view once it lapses.
        if (lockTimerRef.current) {
            clearTimeout(lockTimerRef.current);
        }
        lockTimerRef.current = setTimeout(() => {
            lockRef.current = null;
            applyActiveId();
        }, CLICK_LOCK_MS);

        // Measured against the container rather than read from offsetTop: the subviews differ in
        // whether anything between the section and the column establishes a positioning context.
        const offset = node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;

        container.scrollTo({
            top: Math.max(0, offset - SCROLL_TOP_PADDING),
            behavior: reducedMotion ? 'auto' : 'smooth',
        });
    }, [containerRef, reducedMotion, applyActiveId]);

    useEffect(() => () => {
        if (lockTimerRef.current) {
            clearTimeout(lockTimerRef.current);
        }
    }, []);

    return { activeAnchorId, scrollToAnchor };
};

export default useSettingsScrollSpy;
