import type { UrlBackgroundItem } from '../types';

// src/utils/urlBackground.ts
// Normalizes and validates user-provided webpage backgrounds before storage or rendering.

export const normalizeUrlBackgroundUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.href
            : null;
    } catch {
        return null;
    }
};

export const sanitizeUrlBackgroundItem = (value: unknown): UrlBackgroundItem | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const item = value as Partial<UrlBackgroundItem>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const url = normalizeUrlBackgroundUrl(item.url);

    if (!id || !url) {
        return null;
    }

    const note = typeof item.note === 'string' && item.note.trim()
        ? item.note.trim()
        : url;

    return { id, url, note };
};

export const sanitizeUrlBackgroundList = (items: unknown): UrlBackgroundItem[] => {
    if (!Array.isArray(items)) {
        return [];
    }

    const next: UrlBackgroundItem[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
        const sanitized = sanitizeUrlBackgroundItem(item);
        if (!sanitized || seenIds.has(sanitized.id)) {
            continue;
        }

        seenIds.add(sanitized.id);
        next.push(sanitized);
    }

    return next;
};
