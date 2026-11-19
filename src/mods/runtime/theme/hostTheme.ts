import i18n from '@/i18n/config';
import { FALLBACK_AI_DUAL_THEME, sanitizeDualTheme } from '@/services/themeSanitizer';
import { setStatusMessage } from '@/stores/useStatusMessageStore';
import { useThemeOverrideStore, type ThemeOverrideChangeOrigin } from '@/stores/useThemeOverrideStore';
import type { DualTheme, Theme } from '@/types';
import type { ModRuntimeInfo } from '../../types';
import type { FoliumTheme, FoliumThemeOverride, FoliumThemeOverrideChangeOrigin } from '../../folium/contract';
import { toFoliumTheme } from '../../folium/dto';
import { emitFoliumEvent, hasFoliumEventHandlers } from '../../folium/events';
import { registerFoliumThemeSource, type FoliumThemeOverrideInput, type FoliumThemeSource } from '../../folium/theme/service';
import { getFoliumModList, onFoliumModListChanged } from '../clientLoader';

// src/mods/runtime/theme/hostTheme.ts
// The main window's source of `folium.theme` (Folium 1.10) and of the `theme.overrideChanged` event. A mod's
// theme goes into the theme override store (stores/useThemeOverrideStore.ts), which the theme controller lays
// over the song's theme; the user's own themes, the song theme cache and sync are never written here. The theme
// on screen is App state, so the host bridge hands it in (noteFoliumCurrentTheme) as it renders.
//
// A mod's theme ends when its mod is disabled or removed, by the mod list's enabled state, never by whether
// the mod's client runs right now: a reload (any edit of the mod reloads it) keeps it.

let currentTheme: Theme | null = null;
let currentIsDaylight = false;
let frozenCurrent: FoliumTheme | null = null;

/** The host bridge's report of the theme the App renders now (runtime/hostBridge.ts). */
export const noteFoliumCurrentTheme = (theme: Theme, isDaylight: boolean) => {
    if (theme === currentTheme && isDaylight === currentIsDaylight) return;
    currentTheme = theme;
    currentIsDaylight = isDaylight;
    frozenCurrent = null;
};

const readCurrent = (): FoliumTheme => {
    frozenCurrent ??= Object.freeze(toFoliumTheme(currentTheme, currentIsDaylight));
    return frozenCurrent;
};

let frozenOverride: FoliumThemeOverride | null = null;
let frozenOverrideKey = '';

/** Whose theme is on screen, frozen: the same object while nothing it reports changed. */
export const buildFoliumThemeOverride = (): FoliumThemeOverride => {
    const { override, customPreferred } = useThemeOverrideStore.getState();
    const modId = override?.modId ?? null;
    const key = JSON.stringify([modId, !customPreferred]);
    if (!frozenOverride || key !== frozenOverrideKey) {
        frozenOverrideKey = key;
        frozenOverride = Object.freeze({ modId, writable: !customPreferred });
    }
    return frozenOverride;
};

/*
 * A mod's checked theme as the host's theme: the sanitizer the AI and custom themes go through, over the
 * host's fallback colors, named after the mod when the mod gave no name.
 */
const toHostDualTheme = (mod: ModRuntimeInfo, theme: FoliumThemeOverrideInput): DualTheme => {
    const provider = `mod:${mod.id}`;
    return sanitizeDualTheme(theme, {
        light: { ...FALLBACK_AI_DUAL_THEME.light, name: mod.name, description: '', provider },
        dark: { ...FALLBACK_AI_DUAL_THEME.dark, name: mod.name, description: '', provider },
    });
};

const sameDualTheme = (left: DualTheme, right: DualTheme) => JSON.stringify(left) === JSON.stringify(right);

/** What `folium.theme` goes through in the main window: the theme override store. */
export const FOLIUM_HOST_THEME_SOURCE: FoliumThemeSource = Object.freeze({
    getCurrent: readCurrent,
    getOverride: buildFoliumThemeOverride,
    wouldChange: (mod: ModRuntimeInfo, theme: FoliumThemeOverrideInput) => {
        const { override } = useThemeOverrideStore.getState();
        return !(override?.modId === mod.id && sameDualTheme(override.theme, toHostDualTheme(mod, theme)));
    },
    apply: (mod: ModRuntimeInfo, theme: FoliumThemeOverrideInput) => {
        const store = useThemeOverrideStore.getState();
        if (store.customPreferred) return false;
        const previous = store.override;
        const next = toHostDualTheme(mod, theme);
        if (previous?.modId === mod.id && sameDualTheme(previous.theme, next)) return false;
        store.setModOverride({ modId: mod.id, modName: mod.name, theme: next });
        console.info(`[FoliumTheme] ${mod.id} laid its theme over the song's theme: ${next.dark.backgroundColor} / ${next.light.backgroundColor}`);
        // Announced once when the mod takes the theme over, not at every theme it lays after that.
        if (previous?.modId !== mod.id) {
            setStatusMessage({ type: 'info', text: i18n.t('notifications.themeModOverride', { mod: mod.name }) });
        }
        return true;
    },
    release: (mod: ModRuntimeInfo) => {
        const store = useThemeOverrideStore.getState();
        if (store.override?.modId !== mod.id) return false;
        const released = store.clearOverride({ kind: 'mod', modId: mod.id });
        if (released) console.info(`[FoliumTheme] ${mod.id} took its theme off; the song's theme shows again`);
        return released;
    },
});

/* A mod counts as running when the list has it installed and enabled, and this run did not skip the mods. */
const isModEnabledInList = (list: readonly ModRuntimeInfo[], modId: string) => list.some((mod) => (
    mod.id === modId && mod.enabled && mod.status !== 'skipped'
));

/* Ends a mod's theme once its mod is disabled or removed. Before the first list nothing is changed. */
const syncOverrideWithModList = () => {
    const { override, clearOverride } = useThemeOverrideStore.getState();
    const list = getFoliumModList();
    if (!override || list === null || isModEnabledInList(list, override.modId)) return;
    clearOverride({ kind: 'host' });
    console.info(`[FoliumTheme] the theme of ${override.modId} ended: the mod is disabled or removed`);
};

let lastSignature = '';
// The origins of the changes of this task, in order; emptied when the event of the task is made.
let pendingOrigins: ThemeOverrideChangeOrigin[] = [];

/* The origin a task's changes report: the last that was not the host's, or the host when all were. */
const originOfTask = (origins: readonly ThemeOverrideChangeOrigin[]): FoliumThemeOverrideChangeOrigin => {
    const last = [...origins].reverse().find((origin) => origin.kind !== 'host') ?? { kind: 'host' as const };
    return Object.freeze({ kind: last.kind, modId: last.kind === 'mod' ? last.modId : null });
};

/*
 * theme.overrideChanged: one event for all the changes of a task, a microtask after the first, read from the
 * state as it settled. Another theme from the mod already in place is no change of whose theme it is (the
 * theme itself is reported by `theme.changed`).
 */
const emitOverrideChange = () => {
    const origins = pendingOrigins;
    pendingOrigins = [];
    const override = buildFoliumThemeOverride();
    const signature = JSON.stringify(override);
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (!hasFoliumEventHandlers('theme.overrideChanged')) return;
    emitFoliumEvent('theme.overrideChanged', { override, origin: originOfTask(origins) });
};

const noteChange = (origin: ThemeOverrideChangeOrigin) => {
    pendingOrigins.push(origin);
    if (pendingOrigins.length === 1) queueMicrotask(emitOverrideChange);
};

type OverrideState = ReturnType<typeof useThemeOverrideStore.getState>;

const onOverrideStoreChange = (state: OverrideState, previous: OverrideState) => {
    if (state.override !== previous.override) noteChange(state.origin);
    else if (state.customPreferred !== previous.customPreferred) noteChange({ kind: 'host' });
};

let installed = false;

/** Installs the theme source, the end of a theme with its mod, and `theme.overrideChanged` (main window only; idempotent). */
export const installFoliumHostTheme = () => {
    if (installed) return;
    installed = true;
    registerFoliumThemeSource(FOLIUM_HOST_THEME_SOURCE);
    lastSignature = JSON.stringify(buildFoliumThemeOverride());
    onFoliumModListChanged(syncOverrideWithModList);
    useThemeOverrideStore.subscribe(onOverrideStoreChange);
};
