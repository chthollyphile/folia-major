import i18n from '@/i18n/config';
import type { StatusMessage } from '@/types';
import { settingsAnchorSubview } from '@/components/modal/settings/navigation/settingsAnchorModel';
import { openSettings } from '@/stores/useSettingsModalStore';
import { setStatusMessage, useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { modSettingsRowId, useModsStore } from '../useModsStore';
import { FOLIUM_START_LIMIT_MS, foliumModName } from './clientLoader';
import { FOLIUM_ENTRY_NOTICE_WORDS } from '../folium/kinds';
import { setFoliumFaultNoticeMuted, setFoliumFaultNotifier, type FoliumNoticeKind } from './status';

// src/mods/runtime/faultNotice.ts
// The notice a failing mod raises (status.ts decides when: once per mod per
// run, unless the user asked not to be told), and the one for a mod that has
// not finished starting within its limit, which says just that and not that
// it failed. It is the app's own toast with two actions: one opens Settings at
// that mod's row, the other is "do not tell me again" for that mod. Nothing
// about the mod is changed by either.
//
// The app has one toast at a time, and other messages may come and go around
// this one. So a notice waits until no other message is up, and one that was
// pushed aside before its time comes back when the place is free again.

// Long enough to read one sentence and choose between two buttons.
const NOTICE_DURATION_MS = 12000;
// A notice pushed aside this many times is given up; the mod's row still has the failures.
const MAX_SHOWS = 3;

/**
 * The words for each kind of notice (keys under mods.faultNotice). Those for a piece of a mod
 * come from the kinds table; the two about a mod's start are the loader's.
 */
const PIECE_KEYS: Record<FoliumNoticeKind, string> = {
    ...FOLIUM_ENTRY_NOTICE_WORDS,
    start: 'start',
    'slow-start': 'slowStart',
};

interface PendingNotice {
    modId: string;
    piece: FoliumNoticeKind | undefined;
    shows: number;
}

interface ShownNotice {
    notice: PendingNotice;
    /** The very object handed to the toast: while it is the current message, the notice is up. */
    message: StatusMessage;
    at: number;
    /** The user pressed one of the two buttons. */
    answered: boolean;
}

const waiting: PendingNotice[] = [];
let shown: ShownNotice | null = null;
let stopWatching: (() => void) | null = null;

/* Opens Settings on the mods page with this mod's row open and in view. */
const openModRow = async (modId: string) => {
    try {
        // Read first, so the row is on the page when the settings window lands on it.
        await useModsStore.getState().refresh();
    } catch {
        // Without the list the window still opens on the mods page.
    }
    useModsStore.getState().selectMod(modId);
    openSettings('options', settingsAnchorSubview('modList'), null, 'modList', modSettingsRowId(modId));
};

const show = ({ modId, piece, shows }: PendingNotice) => {
    const at = Date.now();
    const answer = () => {
        if (shown?.message === message) shown.answered = true;
        setStatusMessage(null);
    };
    const message: StatusMessage = {
        // A mod that is slow to start has not failed: its notice has the toast's plain look.
        type: piece === 'slow-start' ? 'info' : 'error',
        text: i18n.t(`mods.faultNotice.${piece ? PIECE_KEYS[piece] : 'other'}`, {
            name: foliumModName(modId),
            // Only the slow-start sentence names the limit.
            seconds: FOLIUM_START_LIMIT_MS / 1000,
        }),
        durationMs: NOTICE_DURATION_MS,
        nonce: at,
        actionLabel: i18n.t('mods.faultNoticeOpen'),
        onAction: () => {
            answer();
            void openModRow(modId);
        },
        cancelLabel: i18n.t('mods.faultNoticeMute'),
        onCancel: () => {
            answer();
            setFoliumFaultNoticeMuted(modId, true);
        },
    };
    shown = { notice: { modId, piece, shows: shows + 1 }, message, at, answered: false };
    setStatusMessage(message);
};

/* Runs on every change of the app's toast while a notice is up or waiting. */
const pump = () => {
    const current = useStatusMessageStore.getState().message;
    if (shown) {
        if (current === shown.message) return;
        const seen = shown.answered || Date.now() - shown.at >= NOTICE_DURATION_MS;
        if (!seen && shown.notice.shows < MAX_SHOWS) waiting.unshift(shown.notice);
        shown = null;
    }
    // Another message is up: the notice waits for it to go rather than replace it.
    if (current !== null) return;
    const next = waiting.shift();
    if (!next) {
        stopWatching?.();
        stopWatching = null;
        return;
    }
    show(next);
};

/** Main-window bootstrap: from now on a mod's fault is announced through the app's toast. */
export const installFoliumFaultNotice = () => {
    setFoliumFaultNotifier((modId, piece) => {
        waiting.push({ modId, piece, shows: 0 });
        stopWatching ??= useStatusMessageStore.subscribe(pump);
        pump();
    });
};
