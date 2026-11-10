import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// src/components/remote/useRemoteSleeve.ts
// Which of the remote window's two looks is on screen: the card in use, or the idle look (no
// keys, the line in their place, and with "expand cover" on, the sleeve: the large cover on the
// left, the song and the line on the right). The looks slide into each other in remote.css; with
// reduced motion nothing slides, and this hook swaps them behind a short fade of the whole card
// instead.

const SWAP_OUT_MS = 90;
const SWAP_IN_MS = 140;

/** Returns whether the idle look is shown. Without reduced motion that is `wantIdle` itself. */
export const useRemoteSleeve = (
    wantIdle: boolean,
    reduceMotion: boolean,
    cardRef: RefObject<HTMLElement | null>,
): boolean => {
    const [shownSleeve, setShownSleeve] = useState(wantIdle);

    useEffect(() => {
        const card = cardRef.current;
        if (wantIdle === shownSleeve) {
            return;
        }
        if (!reduceMotion || !card) {
            setShownSleeve(wantIdle);
            return;
        }

        // Kept at nothing until the swapped look is in the page; the fade back in then covers it.
        const fadeOut = card.animate({ opacity: 0 }, { duration: SWAP_OUT_MS, easing: 'ease-in', fill: 'forwards' });
        fadeOut.onfinish = () => setShownSleeve(wantIdle);
        return () => fadeOut.cancel();
    }, [wantIdle, shownSleeve, reduceMotion, cardRef]);

    // Before the first paint of the swapped look.
    const swappedRef = useRef(shownSleeve);
    useLayoutEffect(() => {
        if (swappedRef.current === shownSleeve) {
            return;
        }
        swappedRef.current = shownSleeve;
        if (reduceMotion) {
            cardRef.current?.animate({ opacity: [0, 1] }, { duration: SWAP_IN_MS, easing: 'ease-out' });
        }
    }, [shownSleeve, reduceMotion, cardRef]);

    return reduceMotion ? shownSleeve : wantIdle;
};
