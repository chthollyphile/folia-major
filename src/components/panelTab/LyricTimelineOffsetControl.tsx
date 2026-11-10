import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDebouncedFocusSync } from '../../hooks/useDebouncedFocusSync';
import { PanelIconButton } from './shell/PanelIconButton';
import { PanelRow } from './shell/PanelRow';
import { Stepper } from './shell/Stepper';

// src/components/panelTab/LyricTimelineOffsetControl.tsx
// One row of the song's tab: how many milliseconds the playing song's lyrics are moved, in steps of
// 250 or typed, and a button that puts it back to 0.

type LyricTimelineOffsetControlProps = {
    offsetMs: number;
    onOffsetChange: (offsetMs: number) => void;
};

const STEP_MS = 250;


const LyricTimelineOffsetControl: React.FC<LyricTimelineOffsetControlProps> = ({
    offsetMs,
    onOffsetChange,
}) => {
    const { t } = useTranslation();
    const [localOffsetMs, setLocalOffsetMs] = useDebouncedFocusSync(offsetMs, onOffsetChange, 20);
    const hasOffset = localOffsetMs !== 0;

    return (
        <PanelRow label={t('localMusic.lyricTimelineOffset')}>
            {/* Keeps its place at 0, where there is nothing to put back, so the number beside it does not move. */}
            <span
                inert={!hasOffset}
                className={`st-t-move inline-flex transition-[opacity,scale,visibility] ${hasOffset ? '' : 'invisible scale-[0.8] opacity-0'}`}
            >
                <PanelIconButton size="s" label={t('localMusic.resetLyricTimelineOffset')} onClick={() => setLocalOffsetMs(0)}>
                    <RotateCcw size={15} />
                </PanelIconButton>
            </span>
            <Stepper
                value={localOffsetMs}
                onChange={next => setLocalOffsetMs(Math.round(next))}
                step={STEP_MS}
                unit="ms"
                signed
                label={t('localMusic.lyricTimelineOffset')}
            />
        </PanelRow>
    );
};

export default LyricTimelineOffsetControl;
