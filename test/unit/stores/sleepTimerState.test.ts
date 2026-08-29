import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsUiStore } from '@/stores/useSettingsUiStore';

// test/unit/stores/sleepTimerState.test.ts

describe('sleep timer settings state', () => {
    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useSettingsUiStore.setState({
            sleepTimerEnabled: false,
            sleepTimerHours: 0,
            sleepTimerMinutes: 0,
            sleepTimerDeadlineMs: null,
            sleepTimerActivationId: 0,
            statusSetter: vi.fn(),
        });
    });

    afterEach(() => {
        useSettingsUiStore.setState({
            sleepTimerEnabled: false,
            sleepTimerHours: 0,
            sleepTimerMinutes: 0,
            sleepTimerDeadlineMs: null,
            sleepTimerActivationId: 0,
            statusSetter: null,
        });
        vi.unstubAllGlobals();
    });

    it('does not arm a zero-duration timer or persist the armed state', () => {
        useSettingsUiStore.getState().handleToggleSleepTimer(true);

        expect(useSettingsUiStore.getState().sleepTimerEnabled).toBe(false);
        expect(useSettingsUiStore.getState().statusSetter).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(values.has('sleep_timer_enabled')).toBe(false);
    });

    it('keeps the preferred duration but disarms when it becomes zero', () => {
        useSettingsUiStore.getState().handleSetSleepTimerMinutes(30);
        useSettingsUiStore.getState().handleToggleSleepTimer(true);
        expect(useSettingsUiStore.getState()).toMatchObject({ sleepTimerEnabled: true, sleepTimerMinutes: 30 });

        useSettingsUiStore.getState().handleSetSleepTimerMinutes(0);

        expect(useSettingsUiStore.getState()).toMatchObject({
            sleepTimerEnabled: false,
            sleepTimerHours: 0,
            sleepTimerMinutes: 0,
        });
        expect(values.get('sleep_timer_minutes')).toBe('0');
        expect(values.has('sleep_timer_enabled')).toBe(false);
    });

    it('creates a new activation when an enabled timer is started with the same duration', () => {
        useSettingsUiStore.getState().handleSetSleepTimerMinutes(30);
        useSettingsUiStore.getState().handleToggleSleepTimer(true);
        const firstActivationId = useSettingsUiStore.getState().sleepTimerActivationId;

        useSettingsUiStore.getState().handleToggleSleepTimer(true);

        expect(useSettingsUiStore.getState()).toMatchObject({
            sleepTimerEnabled: true,
            sleepTimerMinutes: 30,
            sleepTimerActivationId: firstActivationId + 1,
        });
    });
});
