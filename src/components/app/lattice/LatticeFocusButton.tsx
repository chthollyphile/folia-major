import { Command, Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeControlsStore } from '../../../stores/useLatticeControlsStore';
import { openCommandPalette } from '../../../stores/useAppViewStore';
import { SlideActionButton } from '../../shared/SlideActionButton';
import './LatticeFocusButton.css';

// src/components/app/lattice/LatticeFocusButton.tsx
// The wall's one piece of utility chrome, built on the same slide control the grids use: tap to
// centre what is playing, slide to reach the command palette. The wall has no filter surface of its
// own, so unlike the grids the slide has a single destination and no setting to read.
export default function LatticeFocusButton({ isDaylight }: { isDaylight: boolean }) {
    const { t } = useTranslation();
    const focusCurrentSong = useLatticeControlsStore(state => state.focusCurrentSong);

    return (
        <div className="lattice-tools group">
            <SlideActionButton
                icon={Crosshair}
                title={t('home.latticeFocusCurrent')}
                onActivate={() => focusCurrentSong?.()}
                slideIcon={Command}
                slideTitle={t('options.gridSlideTargetCommandPalette')}
                onSlide={openCommandPalette}
                isDaylight={isDaylight}
                accentColor="var(--text-accent)"
                disabled={!focusCurrentSong}
            />
        </div>
    );
}
