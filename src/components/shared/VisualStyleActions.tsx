import React from 'react';
import { Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import { randomizeVisualStyle } from '../visualizer/randomVisualStyle';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { settingsToggleOffClassFor } from '../modal/settings/settingsCardClasses';

// src/components/shared/VisualStyleActions.tsx
// The shared scope switch and manual reroll for appearance controls.
interface VisualStyleActionsProps {
    theme?: Theme;
    isDaylight: boolean;
    compact?: boolean;
    onBeforeRandomize?: () => void;
}

const VisualStyleActions: React.FC<VisualStyleActionsProps> = ({ theme, isDaylight, compact = false, onBeforeRandomize }) => {
    const { t } = useTranslation();
    const randomizeAllEnabled = useVisualizerSettingsStore(state => state.randomizeAllEnabled);
    const handleToggleRandomizeAll = useVisualizerSettingsStore(state => state.handleToggleRandomizeAll);
    const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
    return (
        <div className={`flex min-w-0 items-center gap-2 ${compact ? 'text-[11px]' : 'text-sm'}`}>
            <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap font-medium">
                <Shuffle size={compact ? 13 : 15} className="shrink-0 opacity-55" aria-hidden="true" />
                <span>{t('options.randomizeAll')}</span>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={randomizeAllEnabled}
                onClick={() => handleToggleRandomizeAll(!randomizeAllEnabled)}
                title={t('options.randomizeAllDesc')}
                aria-label={t('options.randomizeAll')}
                className={`h-5 w-9 shrink-0 rounded-full p-1 transition-colors ${focusClass} ${!randomizeAllEnabled ? settingsToggleOffClassFor(isDaylight) : ''}`}
                style={{ backgroundColor: randomizeAllEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
            >
                <span className={`block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${randomizeAllEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <button
                type="button"
                onClick={() => {
                    onBeforeRandomize?.();
                    const scope = useVisualizerSettingsStore.getState().randomizeAllEnabled ? 'all' : 'lyrics';
                    randomizeVisualStyle({ scope });
                }}
                title={t('options.randomizeOnce')}
                aria-label={t('options.randomizeOnce')}
                className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2 transition-colors ${compact ? 'h-6' : 'h-7'} ${focusClass} ${isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/10 hover:bg-white/20'}`}
                style={{ color: theme?.primaryColor }}
            >
                {t('options.randomizeOnce')}
            </button>
        </div>
    );
};

export default VisualStyleActions;
