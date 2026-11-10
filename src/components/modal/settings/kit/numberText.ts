// src/components/modal/settings/kit/numberText.ts
// Reading a number a person typed. The number field uses it, and so does whatever saves a number
// that is kept as text, so the two cannot disagree about what was typed.

/**
 * The number `text` says, or null when it is not one plain number. A decimal comma counts as a
 * point, also the full-width comma and full stop a Chinese keyboard types. Anything else beside the
 * digits ("0.7abc", "1e3", "1,234.5") makes it not a number, where parseFloat would read its start.
 */
export const parseNumberText = (text: string): number | null => {
    const normalized = text.trim().replace(/[,，。．]/g, '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) {
        return null;
    }
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
};
