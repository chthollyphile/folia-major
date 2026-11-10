import React from 'react';
import { useTranslation } from 'react-i18next';
import { SheetButton } from './Sheet';
import ThemedDialog from './ThemedDialog';

interface TextInputDialogProps {
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    confirmLabel?: string;
    initialValue?: string;
    isDaylight?: boolean;
    onClose: () => void;
    onConfirm: (value: string) => Promise<void> | void;
}

const TextInputDialog: React.FC<TextInputDialogProps> = ({
    isOpen,
    title,
    description,
    placeholder,
    confirmLabel,
    initialValue = '',
    isDaylight = false,
    onClose,
    onConfirm,
}) => {
    const { t } = useTranslation();
    const [value, setValue] = React.useState(initialValue);
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    React.useEffect(() => {
        if (isOpen) {
            setValue(initialValue);
            setIsSubmitting(false);
        }
    }, [initialValue, isOpen]);

    const handleConfirm = async () => {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return;
        }

        try {
            setIsSubmitting(true);
            await onConfirm(trimmedValue);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={title}
            description={description}
            footer={(
                <>
                    <SheetButton onClick={onClose} disabled={isSubmitting}>
                        {t('localMusic.cancel')}
                    </SheetButton>
                    <SheetButton variant="primary" onClick={handleConfirm} disabled={isSubmitting || !value.trim()}>
                        {confirmLabel || t('localMusic.save')}
                    </SheetButton>
                </>
            )}
        >
            <input
                // The sheet puts focus here when it opens.
                data-autofocus
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleConfirm();
                    }
                }}
                placeholder={placeholder}
                className="st-t-fast h-9 w-full rounded-lg border border-transparent bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus:border-[var(--st-accent)]"
            />
        </ThemedDialog>
    );
};

export default TextInputDialog;
