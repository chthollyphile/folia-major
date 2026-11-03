import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { copyText } from '../../../../utils/system/clipboard';
import { KIT_MOTION } from './motion';
import { Tooltip } from './Tooltip';

// src/components/modal/settings/kit/CopyButton.tsx
// Copying. CopyButton puts a text on the clipboard and shows a tick in place of its icon for a
// moment (a cross when the copy failed); with a text of its own it is a text button, without one
// the copy icon alone. CopyValue is a read-only value with that button beside it: an address, a
// token, a link.

type CopyButtonProps = {
    /** What is copied; a function for a text that is only made when the button is pressed. */
    text: string | (() => string | Promise<string>);
    disabled?: boolean;
    /** Called once the clipboard has the text, e.g. to say what to do with it. Not called when the copy failed. */
    onCopied?: () => void;
    /** The button's text, e.g. "Copy the config code". Without it the button is the icon, named "Copy". */
    children?: React.ReactNode;
};

type CopyState = 'idle' | 'copied' | 'failed';

const STATE_ICON = { idle: Copy, copied: Check, failed: X } as const;

export const CopyButton: React.FC<CopyButtonProps> = ({ text, disabled, onCopied, children }) => {
    const { t } = useTranslation();
    const [state, setState] = useState<CopyState>('idle');
    const timerRef = useRef<number | undefined>(undefined);
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            window.clearTimeout(timerRef.current);
        };
    }, []);

    const copy = async () => {
        let next: CopyState = 'copied';
        try {
            await copyText(typeof text === 'function' ? await text() : text);
        } catch (error) {
            console.warn('[SettingsKit] Copy failed', error);
            next = 'failed';
        }
        if (next === 'copied') {
            onCopied?.();
        }
        // The text may arrive after the button is gone: nothing is left to show the tick on.
        if (!mountedRef.current) {
            return;
        }
        setState(next);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setState('idle'), KIT_MOTION.confirm * 1000);
    };

    return (
        <>
            <Button icon={STATE_ICON[state]} tip={children ? undefined : t('options.settingsCopy')} onClick={() => void copy()} disabled={disabled}>
                {children}
            </Button>
            {/* The tick is only seen; this says it. */}
            <span role="status" className="sr-only">
                {state === 'copied' ? t('status.copied') : state === 'failed' ? t('status.copyFailed') : ''}
            </span>
        </>
    );
};

type CopyValueProps = {
    /** What is copied, and what is shown unless `shown` is given. */
    value: string;
    /** Shown in place of the value: a token with most of it hidden. */
    shown?: string;
};

export const CopyValue: React.FC<CopyValueProps> = ({ value, shown }) => (
    <>
        {/* A long address is cut short; its whole text is in the tooltip. A hidden value stays hidden. */}
        <Tooltip text={shown === undefined ? value : undefined} className="max-w-[260px] truncate font-mono text-xs text-[color:var(--st-t2)]">
            {shown ?? value}
        </Tooltip>
        <CopyButton text={value} />
    </>
);

export default CopyButton;
