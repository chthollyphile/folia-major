// src/stores/useInteractionSettingsStore.ts
// How the listener drives the app rather than what it plays: what the grids' action button does,
// which keys the command palette answers to, the one shortcut they can define themselves, and the
// system-wide shortcuts of the desktop app.
//
// Separate from the chrome and playback stores because it is about input, not about what is on
// screen — and because the settings section that shows it is its own section for the same reason.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';

/** What the grid action button's leftward slide reaches. */
export type GridActionButtonSlideTarget = 'filter' | 'command-palette';

const SLIDE_TARGET_KEY = 'grid_action_button_slide_target';
const PALETTE_HOTKEY_KEY = 'grid_command_palette_hotkey';
const QUEUE_PALETTE_KEEP_OPEN_KEY = 'queue_palette_keep_open';
const CUSTOM_SHORTCUT_LETTER_KEY = 'custom_shortcut_letter';
const CUSTOM_SHORTCUT_COMMAND_KEY = 'custom_shortcut_command';
const GLOBAL_SHORTCUT_BINDINGS_KEY = 'global_shortcut_bindings';
const GLOBAL_SHORTCUT_PORTAL_KEY = 'global_shortcut_portal_enabled';

/** How many system-wide shortcuts there are. The settings rows and the registering hook use the same count. */
export const GLOBAL_SHORTCUT_SLOTS = 5;

/**
 * One system-wide shortcut: the key pressed with the fixed modifiers, and the command it runs.
 * Either half may be null while the listener is still filling it in. Which values actually get
 * registered is decided by command-palette/globalShortcuts/globalShortcutRules; this store only
 * keeps the shape.
 */
export type GlobalShortcutBinding = {
    key: string | null;
    commandId: string | null;
};

const EMPTY_BINDING: GlobalShortcutBinding = { key: null, commandId: null };

const readSlideTarget = (): GridActionButtonSlideTarget => (
    getStoredString(SLIDE_TARGET_KEY, 'filter') === 'command-palette' ? 'command-palette' : 'filter'
);

/** Stored empty means "unset"; a single lower-case letter is the only other legal value. */
const readShortcutLetter = (): string | null => {
    const stored = getStoredString(CUSTOM_SHORTCUT_LETTER_KEY, '').toLowerCase();
    return /^[a-z]$/.test(stored) ? stored : null;
};

/** Always exactly GLOBAL_SHORTCUT_SLOTS entries; anything unreadable is an empty slot. */
const readGlobalShortcutBindings = (): GlobalShortcutBinding[] => {
    let stored: unknown = null;
    try {
        stored = JSON.parse(getStoredString(GLOBAL_SHORTCUT_BINDINGS_KEY, 'null'));
    } catch {
        stored = null;
    }
    const entries = Array.isArray(stored) ? stored : [];
    return Array.from({ length: GLOBAL_SHORTCUT_SLOTS }, (_, slot) => {
        const entry = entries[slot] as { key?: unknown; commandId?: unknown } | null | undefined;
        const key = typeof entry?.key === 'string' && /^[a-z0-9]$/.test(entry.key) ? entry.key : null;
        const commandId = typeof entry?.commandId === 'string' && entry.commandId ? entry.commandId : null;
        return { key, commandId };
    });
};

const writeString = (key: string, value: string | null) => {
    if (typeof window === 'undefined') {
        return;
    }
    if (value) {
        localStorage.setItem(key, value);
    } else {
        localStorage.removeItem(key);
    }
};

export type InteractionSettingsState = {
    gridActionButtonSlideTarget: GridActionButtonSlideTarget;
    /**
     * Whether bare `s` on a filtering surface opens the command list instead of being read as
     * filter input. Off by default: typing a letter on a grid has always meant "filter", and the
     * listener who wants the other meaning is the one who should have to ask for it.
     */
    gridCommandPaletteHotkey: boolean;
    /** Keep the queue surface and its query after choosing a song. */
    queuePaletteKeepOpen: boolean;
    /** Alt + this letter runs `customShortcutCommandId`. Null means no shortcut is defined. */
    customShortcutLetter: string | null;
    customShortcutCommandId: string | null;
    globalShortcutBindings: GlobalShortcutBinding[];
    /**
     * Native Wayland only: whether the playback commands are handed to the desktop's shortcut
     * portal. Off until the listener asks, because registering makes the desktop show its own
     * prompt or list; the bindings above are not used there, the desktop picks the keys.
     */
    globalShortcutPortalEnabled: boolean;

    setGridActionButtonSlideTarget: (target: GridActionButtonSlideTarget) => void;
    handleToggleGridCommandPaletteHotkey: (enable: boolean) => void;
    setQueuePaletteKeepOpen: (enable: boolean) => void;
    setCustomShortcutLetter: (letter: string | null) => void;
    setCustomShortcutCommandId: (commandId: string | null) => void;
    setGlobalShortcutBinding: (slot: number, patch: Partial<GlobalShortcutBinding>) => void;
    setGlobalShortcutPortalEnabled: (enable: boolean) => void;
};

export const useInteractionSettingsStore = create<InteractionSettingsState>((set) => ({
    gridActionButtonSlideTarget: readSlideTarget(),
    gridCommandPaletteHotkey: getStoredBoolean(PALETTE_HOTKEY_KEY, false),
    queuePaletteKeepOpen: getStoredBoolean(QUEUE_PALETTE_KEEP_OPEN_KEY, false),
    customShortcutLetter: readShortcutLetter(),
    customShortcutCommandId: getStoredString(CUSTOM_SHORTCUT_COMMAND_KEY, '') || null,
    globalShortcutBindings: readGlobalShortcutBindings(),
    globalShortcutPortalEnabled: getStoredBoolean(GLOBAL_SHORTCUT_PORTAL_KEY, false),

    setGridActionButtonSlideTarget: (target) => {
        writeString(SLIDE_TARGET_KEY, target);
        set({ gridActionButtonSlideTarget: target });
    },
    handleToggleGridCommandPaletteHotkey: (enable) => {
        setStoredBoolean(PALETTE_HOTKEY_KEY, enable);
        set({ gridCommandPaletteHotkey: enable });
    },
    setQueuePaletteKeepOpen: (enable) => {
        setStoredBoolean(QUEUE_PALETTE_KEEP_OPEN_KEY, enable);
        set({ queuePaletteKeepOpen: enable });
    },
    setCustomShortcutLetter: (letter) => {
        const normalised = letter && /^[a-z]$/i.test(letter) ? letter.toLowerCase() : null;
        writeString(CUSTOM_SHORTCUT_LETTER_KEY, normalised);
        set({ customShortcutLetter: normalised });
    },
    setCustomShortcutCommandId: (commandId) => {
        writeString(CUSTOM_SHORTCUT_COMMAND_KEY, commandId);
        set({ customShortcutCommandId: commandId });
    },
    setGlobalShortcutBinding: (slot, patch) => set((state) => {
        if (slot < 0 || slot >= GLOBAL_SHORTCUT_SLOTS) {
            return state;
        }
        const key = patch.key === undefined ? undefined : (patch.key && /^[a-z0-9]$/i.test(patch.key) ? patch.key.toLowerCase() : null);
        const bindings = state.globalShortcutBindings.map((binding, index) => (
            index === slot
                ? { ...EMPTY_BINDING, ...binding, ...patch, ...(key === undefined ? {} : { key }) }
                : binding
        ));
        writeString(GLOBAL_SHORTCUT_BINDINGS_KEY, bindings.some(binding => binding.key || binding.commandId) ? JSON.stringify(bindings) : null);
        return { globalShortcutBindings: bindings };
    }),
    setGlobalShortcutPortalEnabled: (enable) => {
        setStoredBoolean(GLOBAL_SHORTCUT_PORTAL_KEY, enable);
        set({ globalShortcutPortalEnabled: enable });
    },
}));
