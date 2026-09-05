import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Command, Crosshair, ListMusic, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeControlsStore } from '../../../stores/useLatticeControlsStore';
import { openCommandPalette, openCommandPaletteCommand } from '../../../stores/useAppViewStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import { SlideActionButton } from '../../shared/SlideActionButton';
import './LatticeFocusButton.css';

// src/components/app/lattice/LatticeFocusButton.tsx
// A compact Lattice-only utility panel. It borrows UnifiedPanel's anchored glass surface without
// bringing its cover, tabs or player-only state into the poster wall.
export default function LatticeFocusButton({ isDaylight }: { isDaylight: boolean }) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const focusCurrentSong = useLatticeControlsStore(state => state.focusCurrentSong);
    const queueShortcut = `${PRIMARY_MODIFIER_LABEL}+P`;

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const handleFocusCurrentSong = () => {
        focusCurrentSong?.();
        setIsOpen(false);
    };

    const handleOpenQueueCommand = () => {
        setIsOpen(false);
        openCommandPaletteCommand('queue');
    };

    const handleOpenCommandPalette = () => {
        setIsOpen(false);
        openCommandPalette();
    };

    const panelId = 'lattice-tools-panel';

    return (
        <div ref={rootRef} className={`lattice-tools group ${isDaylight ? 'is-daylight' : ''}`}>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        id={panelId}
                        role="menu"
                        aria-label={t('home.latticeTools')}
                        initial={{ opacity: 0, scale: 0.9, originX: 1, originY: 1 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="lattice-tools-panel"
                    >
                        <button
                            type="button"
                            role="menuitem"
                            className="lattice-tools-action"
                            onClick={handleFocusCurrentSong}
                            disabled={!focusCurrentSong}
                        >
                            <Crosshair aria-hidden="true" />
                            <span>{t('home.latticeFocusCurrent')}</span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            className="lattice-tools-action"
                            onClick={handleOpenQueueCommand}
                        >
                            <ListMusic aria-hidden="true" />
                            <span>{t('home.latticeOpenQueueCommand')}</span>
                            <kbd>{queueShortcut}</kbd>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <SlideActionButton
                icon={isOpen ? X : Settings2}
                title={t('home.latticeTools')}
                onActivate={() => setIsOpen(open => !open)}
                slideIcon={Command}
                slideTitle={t('options.gridSlideTargetCommandPalette')}
                onSlide={handleOpenCommandPalette}
                isDaylight={isDaylight}
                accentColor="var(--text-accent)"
            />
        </div>
    );
}
