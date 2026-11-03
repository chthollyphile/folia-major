import React from 'react';
import { useTranslation } from 'react-i18next';
import { SheetButton } from './Sheet';
import ThemedDialog from './ThemedDialog';

// src/components/shared/ConfirmDialog.tsx

export interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    description?: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: 'primary' | 'danger';
    isDaylight?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

// 渲染应用内统一样式的确认弹窗
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    description,
    confirmText,
    cancelText,
    confirmVariant = 'primary',
    isDaylight = false,
    onConfirm,
    onClose,
}) => {
    const { t } = useTranslation();

    const defaultConfirmLabel = t('status.confirm') !== 'status.confirm' ? t('status.confirm') : t('ui.confirm');
    const defaultCancelLabel = t('status.cancel') !== 'status.cancel' ? t('status.cancel') : t('ui.cancel');
    // Focus starts on the answer, so that Enter gives it; on the way out when the answer destroys something.
    const focusOnCancel = confirmVariant === 'danger';

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={title}
            description={typeof description === 'string' ? description : undefined}
            footer={(
                <>
                    <SheetButton data-autofocus={focusOnCancel || undefined} onClick={onClose}>
                        {cancelText || defaultCancelLabel}
                    </SheetButton>
                    <SheetButton data-autofocus={!focusOnCancel || undefined} variant={confirmVariant} onClick={() => onConfirm()}>
                        {confirmText || defaultConfirmLabel}
                    </SheetButton>
                </>
            )}
        >
            {typeof description !== 'string' && description}
        </ThemedDialog>
    );
};

export default ConfirmDialog;
