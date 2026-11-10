import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { summaryOfSection } from './exploreWall';
import type { WallSection } from './wallLayout';
import './LatticeSections.css';

// src/components/app/lattice/LatticeSectionFinder.tsx
// The explore wall's way to a section: a pill beside the wall's own buttons that names the
// section the window stands in ('3/9 · heading'), and, pressed, the list of all sections in the
// page's order. Choosing one takes the wall there (useWallSections.ts). The queue wall has none.
// A press with the mouse leaves the focus where it is, as the wall's "refresh" does: the wall's
// keys are handled on .lattice-field and reach it only while the focus is inside it.

type LatticeSectionFinderProps = {
    sections: WallSection[];
    /** The section the window stands in, as its place in `sections`. */
    current: number;
    onChoose: (section: number) => void;
};

export default function LatticeSectionFinder({ sections, current, onChoose }: LatticeSectionFinderProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const pillRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // A press anywhere else closes the list: on the wall it starts a drag, and the list would be in its way.
    useEffect(() => {
        if (!isOpen) return;
        const closeFromOutside = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && (pillRef.current?.contains(target) || listRef.current?.contains(target))) return;
            setIsOpen(false);
        };
        window.addEventListener('pointerdown', closeFromOutside, true);
        return () => window.removeEventListener('pointerdown', closeFromOutside, true);
    }, [isOpen]);

    const section = sections[current];
    if (!section) return null;

    // Escape, with the focus on the pill or in the list, closes the list and nothing else.
    const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Escape' || !isOpen) return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        pillRef.current?.focus({ preventScroll: true });
    };
    const position = `${current + 1}/${sections.length}`;
    const name = section.heading ? `${position} · ${section.heading}` : position;

    return (
        <>
            <button ref={pillRef} type="button" className="lattice-back lattice-sections-pill"
                aria-haspopup="menu" aria-expanded={isOpen}
                aria-label={`${t('home.latticeSections')}: ${name}`} title={t('home.latticeSections')}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setIsOpen(open => !open)}
                onKeyDown={closeOnEscape}>
                <span className="lattice-sections-name">{name}</span>
                <ChevronDown size={16} />
            </button>
            {isOpen && (
                <div ref={listRef} className="lattice-sections-list" role="menu" aria-label={t('home.latticeSections')} onKeyDown={closeOnEscape}>
                    {sections.map((entry, index) => (
                        <button key={`${index}:${entry.key}`} type="button" role="menuitem"
                            className={index === current ? 'is-current' : ''}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => {
                                setIsOpen(false);
                                onChoose(index);
                            }}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            {/* A section without a heading is told by what it holds. */}
                            <span>{entry.heading || summaryOfSection(entry, t)}</span>
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}
