// src/utils/system/clipboard.ts
// Putting a text on the clipboard, the one place that knows how: through the clipboard API where
// the page may use it, and through a hidden field and the copy command where it may not (a page
// served over plain http).

/** Copies `text`; rejects when neither way worked. */
export const copyText = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';
    document.body.appendChild(field);
    // Selecting the field takes focus to it; it goes back to what had it (the copy button).
    const focused = document.activeElement;
    field.select();
    try {
        if (!document.execCommand('copy')) {
            throw new Error('The copy command was refused');
        }
    } finally {
        field.remove();
        if (focused instanceof HTMLElement) {
            focused.focus({ preventScroll: true });
        }
    }
};
