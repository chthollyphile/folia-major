import React from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The adjustment toolbar follows the player bottom-bar editor's existing visual language.
export const NowPlayingCardPositioner: React.FC<{
    isDaylight: boolean;
    onSave: () => void;
    onCancel: () => void;
    onReset: () => void;
}> = ({ isDaylight, onSave, onCancel, onReset }) => {
    const { t } = useTranslation();
    return (
        <div role="toolbar" aria-label={t('options.stageTrackPillReposition')}
            className={`pointer-events-auto fixed left-1/2 top-8 z-[70] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-2xl border px-3 py-2 text-sm shadow-xl backdrop-blur-xl ${isDaylight ? 'border-black/10 bg-white/90 text-black' : 'border-white/15 bg-black/80 text-white'}`}>
            <span className="min-w-0 flex-1 select-none">{t('options.stageTrackPillPositioningHint')}</span>
            {[
                { action: onReset, label: t('options.stageTrackPillResetPosition'), Icon: RotateCcw },
                { action: onCancel, label: t('ui.cancel'), Icon: X },
                { action: onSave, label: t('options.save'), Icon: Check },
            ].map(({ action, label, Icon }) => (
                <button key={label} type="button" onClick={action} aria-label={label} title={label}
                    className="shrink-0 rounded-full p-2 hover:bg-current/10 focus-visible:outline focus-visible:outline-2">
                    <Icon size={16} />
                </button>
            ))}
        </div>
    );
};
