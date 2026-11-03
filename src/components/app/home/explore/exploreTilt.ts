import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';

// src/components/app/home/explore/exploreTilt.ts
// A picture leans to the pointer that is over its entry, and a sheen on it follows the pointer.
// One listener on the list follows the pointer and writes onto the picture of the entry it is
// over where the pointer stands, once a frame, as CSS variables: nothing renders with it, and
// index.css draws from them. An entry marks what of it leans with `data-explore-tilt`, which
// holds how many degrees that leans at most. With reduced motion nothing leans.
// A picture leans only while it carries `data-explore-tilting`; the variables stay written on it
// afterwards (its sheen fades where the pointer last stood).

const within = (value: number) => Math.min(1, Math.max(-1, value));

/** Has the pictures of the entries in `list` lean to the pointer. */
export const useExploreTilt = (list: RefObject<HTMLElement | null>): void => {
    const calm = useReducedMotionFor('uiMicroMotion');
    useEffect(() => {
        const element = list.current;
        if (!element || calm) return undefined;
        let leaning: HTMLElement | null = null;
        let frame = 0;
        let pointer = { x: 0, y: 0 };
        const rest = () => {
            leaning?.removeAttribute('data-explore-tilting');
            leaning = null;
        };
        const lean = () => {
            frame = 0;
            if (!leaning) return;
            // Where the pointer stands over the picture, from -1 at its left and top edges to 1 at
            // its right and bottom ones. From its middle and its size as it is laid out: its box
            // on screen changes as it leans.
            const box = leaning.getBoundingClientRect();
            const across = within((pointer.x - (box.left + box.width / 2)) / (leaning.offsetWidth / 2 || 1));
            const down = within((pointer.y - (box.top + box.height / 2)) / (leaning.offsetHeight / 2 || 1));
            const most = Number(leaning.dataset.exploreTilt) || 0;
            // The side under the pointer goes back.
            leaning.style.setProperty('--ex-ry', `${(across * most).toFixed(2)}deg`);
            leaning.style.setProperty('--ex-rx', `${(-down * most).toFixed(2)}deg`);
            leaning.style.setProperty('--ex-px', across.toFixed(3));
            leaning.style.setProperty('--ex-py', down.toFixed(3));
        };
        const follow = (event: PointerEvent) => {
            const over = event.pointerType === 'touch' || !(event.target instanceof Element)
                ? null
                : event.target.closest('[data-explore-card]')?.querySelector<HTMLElement>('[data-explore-tilt]') ?? null;
            if (over !== leaning) {
                rest();
                leaning = over;
                leaning?.setAttribute('data-explore-tilting', '');
            }
            if (!leaning) return;
            pointer = { x: event.clientX, y: event.clientY };
            if (!frame) frame = requestAnimationFrame(lean);
        };
        element.addEventListener('pointermove', follow);
        element.addEventListener('pointerleave', rest);
        // The list, or a row of it, scrolled under a pointer that stands still takes the picture away
        // from it, and no pointer move says so. (Heard on its way down: a scroll does not come up.)
        element.addEventListener('scroll', rest, { capture: true, passive: true });
        return () => {
            element.removeEventListener('pointermove', follow);
            element.removeEventListener('pointerleave', rest);
            element.removeEventListener('scroll', rest, { capture: true });
            cancelAnimationFrame(frame);
            rest();
        };
    }, [list, calm]);
};
