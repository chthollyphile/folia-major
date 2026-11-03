import { useEffect, type RefObject } from 'react';

// src/components/remote/useRemoteTextShade.ts
// Transparent background with the settings switch "text shade" on (off by default): sizes the
// soft dark shade behind the type to the type that is showing, so a short line does not leave a
// wide grey patch on the picture behind the window.
// The pieces to cover mark themselves with `data-remote-shade`.

// The left side is held by the window's edge; the right side has room, and the shade's blurred
// rim is too thin to carry the last letters, so it reaches further there.
const LEFT_MARGIN_PX = 14;
const RIGHT_MARGIN_PX = 40;
const TOP_MARGIN_PX = 4;
const BOTTOM_MARGIN_PX = 10;
/** The shade only shows when idle, and there everything starts here: the song in the sleeve, the small cover outside it. */
const SLEEVE_TEXT_LEFT_PX = 22;
/** What changes the size of the type without adding or removing a node. */
const WATCHED_ATTRIBUTES = ['data-remote-shade', 'data-size', 'data-lines', 'data-mode'];

export const useRemoteTextShade = (
    isActive: boolean,
    stageRef: RefObject<HTMLDivElement | null>,
    shadeRef: RefObject<HTMLDivElement | null>,
    /** A change of look moves the song; with reduced motion no transition ends to say so. */
    isSleeve: boolean,
): void => {
    useEffect(() => {
        const stage = stageRef.current;
        const shade = shadeRef.current;
        if (!isActive || !stage || !shade) {
            return;
        }

        let frameId = 0;
        const measure = () => {
            frameId = 0;
            const base = stage.getBoundingClientRect();
            let left = Number.POSITIVE_INFINITY;
            let top = Number.POSITIVE_INFINITY;
            let right = Number.NEGATIVE_INFINITY;
            let bottom = Number.NEGATIVE_INFINITY;
            stage.querySelectorAll<HTMLElement>('[data-remote-shade]').forEach(piece => {
                const rect = piece.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) {
                    return;
                }
                left = Math.min(left, rect.left);
                top = Math.min(top, rect.top);
                right = Math.max(right, rect.right);
                bottom = Math.max(bottom, rect.bottom);
            });

            if (!Number.isFinite(left)) {
                shade.dataset.empty = 'true';
                return;
            }

            // The song slides to that start for 0.6 s after the look changes; the shade does not wait for it.
            left = Math.min(left, base.left + SLEEVE_TEXT_LEFT_PX);
            shade.dataset.empty = 'false';
            shade.style.left = `${left - base.left - LEFT_MARGIN_PX}px`;
            shade.style.top = `${top - base.top - TOP_MARGIN_PX}px`;
            shade.style.width = `${right - left + LEFT_MARGIN_PX + RIGHT_MARGIN_PX}px`;
            shade.style.height = `${bottom - top + TOP_MARGIN_PX + BOTTOM_MARGIN_PX}px`;
        };
        // A line change is several mutations; measure once, after they have all landed.
        const schedule = () => {
            if (!frameId) {
                frameId = requestAnimationFrame(measure);
            }
        };

        const observer = new MutationObserver(schedule);
        observer.observe(stage, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: WATCHED_ATTRIBUTES,
        });
        // The song moves when the look changes, and between the song line and the title card.
        stage.addEventListener('transitionend', schedule);
        measure();

        return () => {
            observer.disconnect();
            stage.removeEventListener('transitionend', schedule);
            cancelAnimationFrame(frameId);
        };
    }, [isActive, stageRef, shadeRef, isSleeve]);
};
