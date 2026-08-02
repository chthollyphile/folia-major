import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../shared/ThemedDialog';

// src/components/modal/SonnetPerformanceWarningDialog.tsx
// Confirms entry into Sonnet before the high-cost Pixi runtime is created.
export interface SonnetPerformanceWarningDialogProps {
    isOpen: boolean;
    isDaylight: boolean;
    dontShowAgain: boolean;
    onDontShowAgainChange: (enabled: boolean) => void;
    onConfirm: () => void;
    onClose: () => void;
}

const SonnetPerformanceWarningDialog: React.FC<SonnetPerformanceWarningDialogProps> = ({
    isOpen,
    isDaylight,
    dontShowAgain,
    onDontShowAgainChange,
    onConfirm,
    onClose,
}) => {
    const { t } = useTranslation();
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-600' : 'text-zinc-300';
    const cancelClass = isDaylight
        ? 'bg-zinc-100/80 hover:bg-zinc-200 border-zinc-200 text-zinc-700'
        : 'bg-white/5 hover:bg-white/10 border-white/10 text-white';
    const confirmClass = isDaylight
        ? 'bg-zinc-900 hover:bg-zinc-800 text-white shadow-lg shadow-zinc-900/20'
        : 'bg-white hover:bg-zinc-100 text-zinc-900 shadow-lg shadow-white/20';

    const confirmLabel = t('status.confirm') !== 'status.confirm' ? t('status.confirm') : '确定';
    const cancelLabel = t('status.cancel') !== 'status.cancel' ? t('status.cancel') : '取消';

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={t('options.sonnetPerformanceWarningTitle')}
            description={t('options.sonnetPerformanceWarningDescription')}
            footer={(
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`rounded-full border px-5 py-2.5 text-sm font-medium transition-colors ${cancelClass}`}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${confirmClass}`}
                    >
                        {confirmLabel}
                    </button>
                </>
            )}
        >
            <label className={`flex cursor-pointer items-center gap-3 text-sm ${textSecondary}`}>
                <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={event => onDontShowAgainChange(event.target.checked)}
                    className="h-4 w-4 accent-current"
                />
                <span className="flex items-center gap-2">
                    <AlertTriangle size={15} className={textPrimary} />
                    {t('options.sonnetPerformanceWarningDontShowAgain')}
                </span>
            </label>
        </ThemedDialog>
    );
};

export default SonnetPerformanceWarningDialog;
