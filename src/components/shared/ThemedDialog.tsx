import React from 'react';
import Sheet, { type SheetSize } from './Sheet';

interface ThemedDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isDaylight?: boolean;
    title: string;
    description?: string;
    headerActions?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    /** A note, a state or a quiet action at the left of the footer. */
    footerNote?: React.ReactNode;
    /** s: a question or a short notice. m: a dialog with content of its own. l: a work window. */
    size?: SheetSize;
    /** The children scroll a part of themselves (a list under a fixed line); the dialog's body then does not. */
    fill?: boolean;
    /**
     * Blocks the close paths this dialog owns - the X, the backdrop and Escape - while the caller is
     * mid-way through work a close would leave half-applied. Also dims the X so the wait shows:
     * a caller wrapping `onClose` instead would leave it looking live while it does nothing.
     */
    closeDisabled?: boolean;
    /** The tip of the dimmed X, naming the run that has to finish before closing. */
    closeDisabledTitle?: string;
}

// A dialog with a title, a description and a body, drawn in the shared sheet.
const ThemedDialog: React.FC<ThemedDialogProps> = ({
    isOpen,
    onClose,
    isDaylight = false,
    title,
    description,
    headerActions,
    children,
    footer,
    footerNote,
    size = 's',
    fill = false,
    closeDisabled = false,
    closeDisabledTitle,
}) => (
    <Sheet
        isOpen={isOpen}
        onClose={onClose}
        isDaylight={isDaylight}
        size={size}
        body={fill ? 'fill' : 'scroll'}
        title={title}
        headerActions={headerActions}
        footer={footer}
        footerNote={footerNote}
        closeDisabled={closeDisabled}
        closeDisabledTip={closeDisabledTitle}
    >
        {description && (
            // pre-line so a description can break where its meaning does rather
            // than wherever the width happens to run out.
            <p className="mb-3.5 shrink-0 whitespace-pre-line text-[13px] leading-[21px] text-[color:var(--st-t2)] last:mb-0">{description}</p>
        )}
        {children}
    </Sheet>
);

export default ThemedDialog;
