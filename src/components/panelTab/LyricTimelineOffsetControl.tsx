import React from 'react';
import { RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDebouncedFocusSync } from '../../hooks/useDebouncedFocusSync';

// src/components/panelTab/LyricTimelineOffsetControl.tsx

type LyricTimelineOffsetControlProps = {
    offsetMs: number;
    onOffsetChange: (offsetMs: number) => void;
    isDaylight: boolean;
};

const STEP_MS = 250;


const LyricTimelineOffsetControl: React.FC<LyricTimelineOffsetControlProps> = ({
    offsetMs,
    onOffsetChange,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const [localOffsetMs, setLocalOffsetMs] = useDebouncedFocusSync(offsetMs, onOffsetChange, 20);
    const [inputValue, setInputValue] = React.useState(localOffsetMs.toString());

    React.useEffect(() => {
        setInputValue(localOffsetMs.toString());
    }, [localOffsetMs]);

    const buttonHover = isDaylight ? 'hover:bg-black/10 active:bg-black/15' : 'hover:bg-white/10 active:bg-white/15';

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold opacity-50 uppercase tracking-wider">
                    {t('localMusic.lyricTimelineOffset')}
                </label>
                <button
                    type="button"
                    onClick={() => setLocalOffsetMs(0)}
                    className={`p-1 rounded-md transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'} ${localOffsetMs === 0 ? 'opacity-30' : 'opacity-80'}`}
                    title={t('localMusic.resetLyricTimelineOffset')}
                    disabled={localOffsetMs === 0}
                >
                    <RotateCcw size={13} />
                </button>
            </div>
            <div className="flex items-center">
                <button
                    type="button"
                    onClick={() => setLocalOffsetMs(localOffsetMs - STEP_MS)}
                    className={`p-1.5 rounded-md transition-colors opacity-70 hover:opacity-100 ${buttonHover}`}
                    title="-250ms"
                >
                    <ChevronLeft size={16} />
                </button>

                <div className="flex-1 flex items-center bg-transparent">
                    <input
                        type="number"
                        step={STEP_MS}
                        value={inputValue}
                        onChange={(event) => {
                            const val = event.target.value;
                            setInputValue(val);
                            if (val === '' || val === '-') {
                                return;
                            }
                            const parsed = Number.parseInt(val, 10);
                            if (Number.isFinite(parsed)) {
                                setLocalOffsetMs(parsed);
                            }
                        }}
                        className="w-full min-w-0 bg-transparent px-2 py-1 text-center text-sm font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        aria-label={t('localMusic.lyricTimelineOffset')}
                    />
                </div>

                <button
                    type="button"
                    onClick={() => setLocalOffsetMs(localOffsetMs + STEP_MS)}
                    className={`p-1.5 rounded-md transition-colors opacity-70 hover:opacity-100 ${buttonHover}`}
                    title="+250ms"
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
};

export default LyricTimelineOffsetControl;
