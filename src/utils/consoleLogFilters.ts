// src/utils/consoleLogFilters.ts
// Remembers which log lines the reader has muted, across sessions.
//
// Muting is only worth anything if it lasts. The noise in this app's log is not evenly spread -
// one prefetch pass writes forty lines saying it had nothing to do, and they sit between the two
// lines somebody actually opened the panel to read. Deciding "not Prefetch" once and having it
// hold is the difference between a readable log and re-doing the same triage every session.
//
// Storage follows the project convention (direct localStorage, snake_case key, never throws).

import type { ConsoleLevel } from './consoleLogBuffer';

const STORAGE_KEY = 'console_log_filters';

export interface ConsoleLogFilters {
    /** Scopes the reader has muted. Anything not named here is shown. */
    hiddenScopes: string[];
    /** Levels the reader has muted. Same rule. */
    hiddenLevels: ConsoleLevel[];
}

const EMPTY: ConsoleLogFilters = { hiddenScopes: [], hiddenLevels: [] };

/**
 * Deliberately stores what is HIDDEN rather than what is shown.
 *
 * A subsystem that starts logging next month is one this file has never heard of. Stored as a
 * shown-list it would be filtered out on arrival and stay invisible forever - the panel would be
 * hiding exactly the new thing, which is the one case where silence is indistinguishable from
 * working. Stored as a hidden-list, anything new shows up.
 */
export const readConsoleLogFilters = (): ConsoleLogFilters => {
    if (typeof window === 'undefined') return EMPTY;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return EMPTY;
        const parsed = JSON.parse(raw) as Partial<ConsoleLogFilters>;
        return {
            hiddenScopes: Array.isArray(parsed.hiddenScopes)
                ? parsed.hiddenScopes.filter((item): item is string => typeof item === 'string')
                : [],
            hiddenLevels: Array.isArray(parsed.hiddenLevels)
                ? parsed.hiddenLevels.filter((item): item is ConsoleLevel => typeof item === 'string')
                : [],
        };
    } catch {
        // Corrupt or blocked storage: show everything, which is the state before this file existed.
        return EMPTY;
    }
};

export const writeConsoleLogFilters = (filters: ConsoleLogFilters): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
        // Storage full or blocked: the filters still apply for this session, they just don't last.
    }
};
