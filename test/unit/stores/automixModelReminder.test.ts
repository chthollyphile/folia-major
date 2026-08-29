import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/automixModelReminder.test.ts
// When switching Folia transitions on is worth interrupting for.
//
// Three separate ways to answer no, and they are the three the prompt was asked for: a browser
// build cannot fix it, an install that already has the weights has nothing to fix, and a listener
// who said "don't remind me" has answered. Each is locked on its own, because they fail
// differently - the first two are facts about the machine that must not be remembered, the third
// is a preference that must be.

const present = { beat_this: false, htdemucs: false };

vi.mock('@/services/automix/modelAvailability', () => ({
    modelsPresent: () => present,
}));

// Statically imported on purpose. A dynamic `await import()` per test resolves instantly on its
// own and takes over five seconds inside the full suite - this store pulls in the visualizer
// registries and half of services/ - so the first version of this file passed alone and timed out
// in CI. `vi.mock` is hoisted above the imports either way, so the mock still lands.
import { AUTOMIX_MODEL_REMINDER_MUTED_KEY, shouldRemindAboutModels, useSettingsUiStore } from '@/stores/useSettingsUiStore';


describe('the analysis model reminder', () => {
    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        vi.stubGlobal('localStorage', storage);
        // `separateStems` present = a desktop build. The bridge rather than the weights, which is
        // the same question `transitionCapabilities` asks for the engine badge.
        vi.stubGlobal('window', { localStorage: storage, electron: { separateStems: () => {} } });
        present.beat_this = false;
        present.htdemucs = false;
    });

    afterEach(() => vi.unstubAllGlobals());

    it('asks when a desktop build has neither model', () => {
        expect(shouldRemindAboutModels()).toBe(true);
    });

    it('still asks when only one model is missing', () => {
        // Half-installed is the state a failed download leaves behind, and the beat grid alone is
        // worth the prompt: the crossfade mode reads it too.
        present.beat_this = true;
        expect(shouldRemindAboutModels()).toBe(true);
    });

    it('stays quiet once both models are on disk', () => {
        present.beat_this = true;
        present.htdemucs = true;
        expect(shouldRemindAboutModels()).toBe(false);
    });

    it('stays quiet in a browser build, which cannot run either model whatever it downloads', () => {
        vi.stubGlobal('window', { localStorage: localStorage });
        expect(shouldRemindAboutModels()).toBe(false);
    });

    it('stays quiet once the listener has muted it, even with both models missing', () => {
        localStorage.setItem(AUTOMIX_MODEL_REMINDER_MUTED_KEY, 'true');
        expect(shouldRemindAboutModels()).toBe(false);
    });

    it('only mutes when the mute button was the one pressed', () => {
        // "Got it" closes the prompt for now; it must not be a silent forever.
        useSettingsUiStore.getState().dismissAutomixModelReminder(false);
        expect(localStorage.getItem(AUTOMIX_MODEL_REMINDER_MUTED_KEY)).toBeNull();
        expect(useSettingsUiStore.getState().isAutomixModelReminderOpen).toBe(false);

        useSettingsUiStore.getState().dismissAutomixModelReminder(true);
        expect(localStorage.getItem(AUTOMIX_MODEL_REMINDER_MUTED_KEY)).toBe('true');
    });

    it('opens on the switch going on, and never on it going off', () => {
        useSettingsUiStore.getState().handleToggleAutomix(true);
        expect(useSettingsUiStore.getState().isAutomixModelReminderOpen).toBe(true);

        useSettingsUiStore.getState().handleToggleAutomix(false);
        expect(useSettingsUiStore.getState().isAutomixModelReminderOpen).toBe(false);

        present.beat_this = true;
        present.htdemucs = true;
        useSettingsUiStore.getState().handleToggleAutomix(true);
        expect(useSettingsUiStore.getState().isAutomixModelReminderOpen).toBe(false);
    });
});
