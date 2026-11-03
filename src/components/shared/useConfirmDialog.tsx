import React, { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog, { type ConfirmDialogProps } from './ConfirmDialog';

// src/components/shared/useConfirmDialog.tsx
// A yes-or-no question asked from the middle of an async action, in place of the browser's own
// confirm box: `ask` opens ConfirmDialog and resolves to the answer. The caller renders `dialog`
// once, anywhere in what it returns.

type ConfirmQuestion = Pick<ConfirmDialogProps, 'title' | 'description' | 'confirmText' | 'cancelText' | 'confirmVariant'>;

export const useConfirmDialog = (isDaylight: boolean) => {
    const [question, setQuestion] = useState<ConfirmQuestion | null>(null);
    const answerRef = useRef<((answer: boolean) => void) | null>(null);

    const answer = (value: boolean) => {
        answerRef.current?.(value);
        answerRef.current = null;
        setQuestion(null);
    };

    const ask = useCallback((next: ConfirmQuestion) => new Promise<boolean>((resolve) => {
        // A second question over an open one answers the first with no.
        answerRef.current?.(false);
        answerRef.current = resolve;
        setQuestion(next);
    }), []);

    // A question left open when the asker goes away is answered with no, so the action waiting on it ends.
    useEffect(() => () => answerRef.current?.(false), []);

    const dialog = (
        <ConfirmDialog
            {...question}
            isOpen={question !== null}
            title={question?.title ?? ''}
            isDaylight={isDaylight}
            onConfirm={() => answer(true)}
            onClose={() => answer(false)}
        />
    );

    return { ask, dialog };
};

export default useConfirmDialog;
