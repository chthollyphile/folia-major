import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/wallpaperEntryConfirm.test.ts
// Entering wallpaper mode is confirmed once, in useDesktopSettingsStore, and every user-initiated
// entry funnels into that gate. After the first successful entry the warning is spent; cancelling
// does not spend it. Programmatic entries (startup restore, main-process recovery) never touch
// the gate, otherwise they would block startup behind a dialog nobody can see.

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

describe('wallpaper mode entry confirmation (store behaviour)', () => {
    let values: Map<string, string>;
    let saveSettings: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        values = new Map();
        saveSettings = vi.fn().mockResolvedValue(undefined);
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage, electron: { saveSettings } });
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    const loadStore = async () => (await import('@/stores/useDesktopSettingsStore')).useDesktopSettingsStore;

    it('asks on the first entry and does not enter yet', async () => {
        const store = await loadStore();

        store.getState().handleToggleWallpaperMode(true);

        expect(store.getState().wallpaperEntryConfirmOpen).toBe(true);
        expect(store.getState().wallpaperMode).toBe(false);
        expect(store.getState().wallpaperEntryConfirmed).toBe(false);
        expect(saveSettings).not.toHaveBeenCalled();
        expect(values.get('wallpaper_mode')).toBeUndefined();
        expect(values.get('wallpaper_entry_confirmed')).toBeUndefined();
    });

    it('cancelling leaves the first-entry warning for the next attempt', async () => {
        const store = await loadStore();

        store.getState().handleToggleWallpaperMode(true);
        store.getState().cancelWallpaperEntry();

        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(store.getState().wallpaperMode).toBe(false);
        expect(store.getState().wallpaperEntryConfirmed).toBe(false);
        expect(saveSettings).not.toHaveBeenCalled();
        expect(values.get('wallpaper_mode')).toBeUndefined();
        expect(values.get('wallpaper_entry_confirmed')).toBeUndefined();

        // Cancelling is not "using" the mode, so the next attempt asks again.
        store.getState().handleToggleWallpaperMode(true);
        expect(store.getState().wallpaperEntryConfirmOpen).toBe(true);
    });

    it('records the warning as seen when the confirmation enters wallpaper mode', async () => {
        const store = await loadStore();

        store.getState().handleToggleWallpaperMode(true);
        store.getState().confirmWallpaperEntry();

        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(store.getState().wallpaperMode).toBe(true);
        expect(store.getState().wallpaperEntryConfirmed).toBe(true);
        expect(values.get('wallpaper_mode')).toBe('true');
        expect(values.get('wallpaper_entry_confirmed')).toBe('true');
        // The confirmation flag reaches the main process first, so the tray cannot race the
        // relaunch and ask again for a dialog that was just accepted.
        expect(saveSettings).toHaveBeenNthCalledWith(1, 'wallpaper_entry_confirmed', true);
        expect(saveSettings).toHaveBeenNthCalledWith(2, 'wallpaper_mode', true);
        expect(saveSettings).toHaveBeenCalledTimes(2);
    });

    it('enters directly on later entries once the first entry succeeded', async () => {
        const store = await loadStore();

        store.getState().handleToggleWallpaperMode(true);
        store.getState().confirmWallpaperEntry();
        store.getState().handleToggleWallpaperMode(false);
        saveSettings.mockClear();

        store.getState().handleToggleWallpaperMode(true);

        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(store.getState().wallpaperMode).toBe(true);
        expect(store.getState().wallpaperEntryConfirmed).toBe(true);
        expect(saveSettings).toHaveBeenCalledWith('wallpaper_entry_confirmed', true);
        expect(saveSettings).toHaveBeenCalledWith('wallpaper_mode', true);
    });

    it('ignores a confirm that arrives after the dialog was already answered', async () => {
        const store = await loadStore();

        // Confirm without an open dialog (e.g. a click during the exit animation after Cancel).
        store.getState().confirmWallpaperEntry();
        expect(store.getState().wallpaperMode).toBe(false);
        expect(store.getState().wallpaperEntryConfirmed).toBe(false);
        expect(saveSettings).not.toHaveBeenCalled();

        store.getState().handleToggleWallpaperMode(true);
        store.getState().cancelWallpaperEntry();
        store.getState().confirmWallpaperEntry();
        expect(store.getState().wallpaperMode).toBe(false);
        expect(store.getState().wallpaperEntryConfirmed).toBe(false);
        expect(saveSettings).not.toHaveBeenCalled();

        // A double click on Confirm applies once.
        store.getState().handleToggleWallpaperMode(true);
        store.getState().confirmWallpaperEntry();
        store.getState().confirmWallpaperEntry();
        expect(store.getState().wallpaperMode).toBe(true);
        expect(saveSettings).toHaveBeenCalledTimes(2);
    });

    it('leaves wallpaper mode without any confirmation', async () => {
        values.set('wallpaper_mode', 'true');
        const store = await loadStore();
        expect(store.getState().wallpaperMode).toBe(true);

        store.getState().handleToggleWallpaperMode(false);

        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(store.getState().wallpaperMode).toBe(false);
        expect(store.getState().wallpaperEntryConfirmed).toBe(false);
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(saveSettings).toHaveBeenCalledWith('wallpaper_mode', false);
    });

    it('does not ask again when wallpaper mode is already on', async () => {
        values.set('wallpaper_mode', 'true');
        const store = await loadStore();

        store.getState().handleToggleWallpaperMode(true);

        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
    });

    it('restores the stored mode and confirmation flag at startup without asking', async () => {
        values.set('wallpaper_mode', 'true');
        values.set('wallpaper_entry_confirmed', 'true');
        const store = await loadStore();

        // Startup restore: the persisted values are read straight into state.
        expect(store.getState().wallpaperMode).toBe(true);
        expect(store.getState().wallpaperEntryConfirmed).toBe(true);
        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(saveSettings).not.toHaveBeenCalled();

        // A later user-initiated entry does not reopen the warning.
        store.getState().handleToggleWallpaperMode(false);
        store.getState().handleToggleWallpaperMode(true);
        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(store.getState().wallpaperMode).toBe(true);
    });

    it('accepts the confirmation flag from the main-process snapshot', async () => {
        const store = await loadStore();

        store.getState().setDesktopPreferenceSnapshot({ wallpaper_entry_confirmed: true });

        expect(store.getState().wallpaperEntryConfirmed).toBe(true);
        expect(values.get('wallpaper_entry_confirmed')).toBe('true');
        store.getState().handleToggleWallpaperMode(true);
        expect(store.getState().wallpaperEntryConfirmOpen).toBe(false);
        expect(store.getState().wallpaperMode).toBe(true);
    });

    it('keeps a locally recorded confirmation when a stale snapshot says false', async () => {
        values.set('wallpaper_entry_confirmed', 'true');
        const store = await loadStore();

        store.getState().setDesktopPreferenceSnapshot({ wallpaper_entry_confirmed: false });

        expect(store.getState().wallpaperEntryConfirmed).toBe(true);
        expect(values.get('wallpaper_entry_confirmed')).toBe('true');
    });
});

describe('wallpaper mode entry classification (source contract)', () => {
    // Interactive entries: every one must reach the store's gated handleToggleWallpaperMode.
    it('settings card and command palette use the gated store action', () => {
        // The settings card is the wallpaper row of the desktop page, which takes the action from the store itself.
        const desktopPage = read('src/components/modal/settings/pages/DesktopPage.tsx');
        expect(desktopPage).toMatch(/setWallpaperMode:\s*state\.handleToggleWallpaperMode/);
        expect(desktopPage).toMatch(/option=\{O\.wallpaperMode\}[^]*?onChange=\{desktop\.setWallpaperMode\}/);

        const commandContext = read('src/components/app/command-palette-context/buildSettingsCommandContext.ts');
        expect(commandContext).toMatch(/toggleWallpaperMode:\s*\(\)\s*=>\s*desktop\.handleToggleWallpaperMode\(/);

        const commands = read('src/components/command-palette/commands/settingsCommands.ts');
        expect(commands).toMatch(/context\.settings\.toggleWallpaperMode\(\)/);
    });

    it('the tray asks the renderer only until the first entry was recorded', () => {
        const preferences = read('src/hooks/useAppPreferences.ts');
        expect(preferences).toMatch(/onWallpaperEntryRequested\?\.\(\(\) => \{\s*useDesktopSettingsStore\.getState\(\)\.handleToggleWallpaperMode\(true\);/);

        const main = read('electron/main.cjs');
        const trayClick = main.slice(main.indexOf('label: locale.trayToggleWallpaperMode'));
        const requestAt = trayClick.indexOf('requestWallpaperEntryConfirmation(');
        const directEntryAt = trayClick.indexOf('store.set(WALLPAPER_MODE_SETTING_KEY, nextEnabled)');
        expect(requestAt).toBeGreaterThan(-1);
        expect(requestAt).toBeLessThan(directEntryAt);

        // Only entering is asked about, and only while the one-time flag is still false.
        const guard = trayClick.slice(trayClick.indexOf('if ('), requestAt);
        expect(guard).toMatch(/nextEnabled/);
        expect(guard).toMatch(/!readStoredBoolean\(WALLPAPER_ENTRY_CONFIRMED_SETTING_KEY, false\)/);

        // A direct entry still counts as the first use, so the next click goes straight in.
        const directEntry = trayClick.slice(directEntryAt, trayClick.indexOf('refreshTrayMenu();', directEntryAt));
        expect(directEntry).toMatch(/store\.set\(WALLPAPER_ENTRY_CONFIRMED_SETTING_KEY, true\)/);
    });

    it('the main process publishes the confirmation flag', () => {
        const main = read('electron/main.cjs');
        expect(main).toMatch(/\[WALLPAPER_ENTRY_CONFIRMED_SETTING_KEY\]: readStoredBoolean\(WALLPAPER_ENTRY_CONFIRMED_SETTING_KEY, false\)/);
        expect(main).toMatch(/key === WALLPAPER_ENTRY_CONFIRMED_SETTING_KEY/);
    });

    // Programmatic entries must stay ungated: nothing outside the store may call the ungated apply
    // or write wallpaper_mode itself, and the renderer has no startup-restore path through the gate.
    it('only the store applies wallpaper mode unconfirmed', () => {
        const store = read('src/stores/useDesktopSettingsStore.ts');
        const confirm = store.slice(store.indexOf('confirmWallpaperEntry: () => {'), store.indexOf('applyWallpaperMode: (enable) => {'));
        expect(confirm).toMatch(/get\(\)\.applyWallpaperMode\(true\)/);

        const offenders: string[] = [];
        const files = [
            'src/App.tsx',
            'src/hooks/useAppPreferences.ts',
            'src/components/modal/SettingsModal.tsx',
            'src/components/modal/settings/pages/DesktopPage.tsx',
            'src/components/app/command-palette-context/buildSettingsCommandContext.ts',
            'src/components/command-palette/commands/settingsCommands.ts',
            'src/components/app/dialogs/useAppDialogsModel.ts',
        ];
        for (const file of files) {
            const source = read(file);
            if (/applyWallpaperMode/.test(source)) offenders.push(`${file}: applyWallpaperMode`);
            if (/saveSettings\(\s*'wallpaper_mode'/.test(source)) offenders.push(`${file}: saveSettings('wallpaper_mode')`);
        }
        expect(offenders).toEqual([]);
    });

    it('the confirmation dialog is rendered by AppDialogs and wired to the store', () => {
        const dialogs = read('src/components/app/dialogs/AppDialogs.tsx');
        expect(dialogs).toMatch(/wallpaperEntryConfirmDialog && <ConfirmDialog/);

        const model = read('src/components/app/dialogs/useAppDialogsModel.ts');
        expect(model).toMatch(/confirmWallpaperEntry\(\)/);
        expect(model).toMatch(/cancelWallpaperEntry\(\)/);
    });
});
