import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

// src/components/app/lattice/useLatticeChromeDisclosure.ts
// Mouse hover, keyboard focus and touch taps reveal details without treating a pan as a tap.
export function useLatticeChromeDisclosure(expanded: boolean) {
    const articleRef = useRef<HTMLElement>(null);
    const pointerTypeRef = useRef('mouse');
    const [hovered, setHovered] = useState(false);
    const [touchOpen, setTouchOpen] = useState(false);
    const [keyboardFocus, setKeyboardFocus] = useState(false);

    useEffect(() => {
        if (!expanded) setTouchOpen(false);
    }, [expanded]);
    useEffect(() => {
        if (!touchOpen) return;
        const dismiss = (event: globalThis.PointerEvent) => {
            if (event.target instanceof Node && !articleRef.current?.contains(event.target)) setTouchOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [touchOpen]);

    return {
        articleRef,
        // Pointer hover is tracked here already, so the poster's own lift reads it rather than
        // running a second gesture; touch pointers are filtered out below, as they must be.
        hovered,
        revealed: expanded && (hovered || touchOpen || keyboardFocus),
        toggleTouch: () => { if (pointerTypeRef.current === 'touch') setTouchOpen(value => !value); },
        toggleKeyboard: () => setTouchOpen(value => !value),
        onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
            pointerTypeRef.current = event.pointerType;
            setKeyboardFocus(false);
        },
        onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== 'touch') setHovered(true); },
        onPointerLeave: () => setHovered(false),
        onFocusCapture: (event: FocusEvent<HTMLElement>) => {
            if (event.target !== event.currentTarget && event.target.matches(':focus-visible')) setKeyboardFocus(true);
        },
        onBlurCapture: (event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
        },
    };
}
