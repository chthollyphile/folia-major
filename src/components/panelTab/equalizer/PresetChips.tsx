import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AudioEqualizerModeId } from '../../../utils/audioEqualizer';
import PanelIconButton from '../shell/PanelIconButton';

// src/components/panelTab/equalizer/PresetChips.tsx
// The presets of the audio effect window: a line of chips that wraps, the chosen one in the accent
// colour, and at its right end the button that clears the chosen custom slot.

type PresetChipsProps = {
    presetIds: readonly AudioEqualizerModeId[];
    /** Null while a mod's curve plays: no chip is lit, and choosing one is the listener's choice that ends it. */
    chosen: AudioEqualizerModeId | null;
    onChoose: (presetId: AudioEqualizerModeId) => void;
    /** False while a built-in preset is chosen: there is nothing to clear, and the button is dimmed. */
    canReset: boolean;
    onReset: () => void;
};

const PresetChips: React.FC<PresetChipsProps> = ({ presetIds, chosen, onChoose, canReset, onReset }) => {
    const { t } = useTranslation();

    return (
        <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-wrap gap-1.5">
                {presetIds.map(presetId => (
                    <button
                        key={presetId}
                        type="button"
                        onClick={() => onChoose(presetId)}
                        aria-pressed={chosen === presetId}
                        className={`st-t-fast h-7 whitespace-nowrap rounded-lg px-3 text-[13px] transition-[background-color,color,scale] active:scale-[0.96] ${chosen === presetId
                            ? 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]'
                            : 'bg-[var(--st-fill)] text-[color:var(--st-t2)] hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-t1)]'}`}
                    >
                        {t(`ui.equalizerPreset.${presetId}`)}
                    </button>
                ))}
            </div>
            <PanelIconButton label={t('ui.equalizerReset')} disabled={!canReset} onClick={onReset}>
                <RotateCcw size={16} />
            </PanelIconButton>
        </div>
    );
};

export default PresetChips;
