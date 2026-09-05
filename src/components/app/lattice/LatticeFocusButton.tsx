import { Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeControlsStore } from '../../../stores/useLatticeControlsStore';
import './LatticeFocusButton.css';

// src/components/app/lattice/LatticeFocusButton.tsx
// A single quiet wall action; it shares the focus capability with the command palette.
export default function LatticeFocusButton() {
    const { t } = useTranslation();
    const focusCurrentSong = useLatticeControlsStore(state => state.focusCurrentSong);

    return (
        <div className="lattice-tools">
            <button type="button" className="lattice-focus-toggle" disabled={!focusCurrentSong}
                aria-label={t('home.latticeFocusCurrent')} title={t('home.latticeFocusCurrent')}
                onClick={() => focusCurrentSong?.()}>
                <Crosshair size={18} />
            </button>
        </div>
    );
}
