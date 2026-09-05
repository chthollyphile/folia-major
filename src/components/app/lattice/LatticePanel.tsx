import { useEffect, useRef, useState } from 'react';
import { Focus, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeControlsStore } from '../../../stores/useLatticeControlsStore';
import './LatticePanel.css';

// src/components/app/lattice/LatticePanel.tsx
// A non-modal wall panel; its actions share the wall's capabilities with the command palette.
export default function LatticePanel() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const focusCurrentSong = useLatticeControlsStore(state => state.focusCurrentSong);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const containWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) event.preventDefault();
        };
        root.addEventListener('wheel', containWheel, { passive: false });
        return () => root.removeEventListener('wheel', containWheel);
    }, []);

    useEffect(() => {
        if (!open) return;
        closeRef.current?.focus({ preventScroll: true });
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open]);

    const close = () => {
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
    };

    return (
        <div ref={rootRef} className="lattice-tools" onKeyDown={event => {
            if (event.key !== 'Escape' || !open) return;
            event.preventDefault();
            event.stopPropagation();
            close();
        }}>
            {open && <aside id="lattice-panel" className="lattice-panel" role="dialog" aria-labelledby="lattice-panel-title">
                <header>
                    <span id="lattice-panel-title">{t('home.latticePanel')}</span>
                    <button ref={closeRef} type="button" onClick={close} aria-label={t('home.latticePanelClose')}><X size={16} /></button>
                </header>
                <button type="button" className="lattice-focus-action" disabled={!focusCurrentSong} onClick={() => {
                    setOpen(false);
                    focusCurrentSong?.();
                }}>
                    <Focus size={18} />
                    <span>{t('home.latticeFocusCurrent')}</span>
                </button>
                <div className="lattice-panel-space" aria-hidden="true" />
            </aside>}
            <button ref={triggerRef} type="button" className="lattice-panel-toggle" aria-label={t('home.latticePanel')}
                aria-expanded={open} aria-controls="lattice-panel" onClick={() => setOpen(value => !value)}>
                <SlidersHorizontal size={18} />
            </button>
        </div>
    );
}
