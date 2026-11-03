// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});
import i18n from '@/i18n/config';
import type { FoliumBeforePlayEvent } from '@/mods/folium/contract';
import type { ModRuntimeInfo } from '@/mods/types';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useSettingsModalStore } from '@/stores/useSettingsModalStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { createFoliumClientApi } from '@/mods/folium/api';
import { clientApiOptions } from './clientApiOptions';
import { addFoliumEventHandler, dispatchFoliumHookAsync, removeFoliumEventHandlers } from '@/mods/folium/events';
import { installFoliumFaultNotice } from '@/mods/runtime/faultNotice';
import { callFoliumMod, gateFoliumCallback } from '@/mods/runtime/guard';
import { commandsRegistry, runFoliumCommand } from '@/mods/folium/registries/commands';
import { omniProvidersRegistry } from '@/mods/folium/registries/omniProviders';
import {
    announceFoliumSlowStart,
    clearFoliumIssues,
    getFoliumIssues,
    isFoliumFaultNoticeMuted,
    setFoliumFaultNoticeMuted,
    useFoliumStatusStore,
    type FoliumFaultPiece,
} from '@/mods/runtime/status';
import { useModsStore } from '@/mods/useModsStore';

// test/unit/mod-system/foliumFaultNotice.test.ts
// The notice a failing mod raises, through the app's real toast store: one
// per mod per run of the app however often it fails, none for a failure that
// is an ordinary result, none for a mod the user asked not to be told about
// (and that choice is stored), and what its two buttons do. Each test uses
// mod ids of its own, because "already told" lasts for the whole window.

const NOTICE_MS = 12000;
const MUTED_KEY = 'folia_folium_fault_notice_muted_v1';

installFoliumFaultNotice();

const toast = () => useStatusMessageStore.getState().message;
const setToast = useStatusMessageStore.getState().setMessage;
const fail = (modId: string, where: string, piece?: FoliumFaultPiece) => {
    callFoliumMod(modId, where, () => { throw new Error('boom'); }, undefined, piece);
};
/* What the app does with a toast whose time is up. */
const expire = () => {
    vi.advanceTimersByTime(NOTICE_MS);
    setToast(null);
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    for (let round = 0; round < 6 && toast(); round += 1) expire();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the notice a failing mod raises', () => {
    it('names a mod that fails 1,000 times in a row once, and writes the store at most once a second', () => {
        let writes = 0;
        const stopWrites = useFoliumStatusStore.subscribe(() => { writes += 1; });
        let notices = 0;
        const stopNotices = useStatusMessageStore.subscribe((state, previous) => {
            if (state.message && state.message !== previous.message) notices += 1;
        });
        let thrown = 0;
        const draw = gateFoliumCallback('fault-flood', 'visualizer fault-flood:mode onFrame', () => {
            thrown += 1;
            throw new Error(`boom ${thrown}`);
        }, 'visualizer');

        for (let frame = 0; frame < 1000; frame += 1) draw(frame);
        expect(notices).toBe(1);
        expect(writes).toBe(1);
        expect(toast()).toMatchObject({
            type: 'error',
            text: i18n.t('mods.faultNotice.visualizer', { name: 'fault-flood' }),
            actionLabel: i18n.t('mods.faultNoticeOpen'),
            cancelLabel: i18n.t('mods.faultNoticeMute'),
        });
        expect(toast()!.text).toContain('fault-flood');
        expect(toast()!.text).not.toContain('faultNotice');
        expect(getFoliumIssues('fault-flood')).toMatchObject([{ count: 1000, message: 'boom 1000', piece: 'visualizer' }]);

        // Ten more seconds of a failure every 5 ms, the notice long gone.
        expire();
        const writesBefore = writes;
        for (let frame = 0; frame < 2000; frame += 1) {
            vi.advanceTimersByTime(5);
            draw(frame);
        }
        expect(notices).toBe(1);
        expect(toast()).toBeNull();
        expect(writes - writesBefore).toBeLessThanOrEqual(10);
        expect(getFoliumIssues('fault-flood')[0].count).toBe(3000);
        stopWrites();
        stopNotices();
    });

    it('names a mod once per run, whatever fails next and after the mod was started again', () => {
        fail('fault-once', 'progress button fault-once:like mount', 'progress-button');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.progressButton', { name: 'fault-once' }));
        expire();
        expect(toast()).toBeNull();

        fail('fault-once', 'progress layer fault-once:marks onTime', 'progress-layer');
        // What a new activation of the mod does.
        clearFoliumIssues('fault-once');
        fail('fault-once', 'client activate', 'start');
        expect(toast()).toBeNull();
        expect(getFoliumIssues('fault-once')).toMatchObject([{ where: 'client activate', count: 1 }]);
    });

    it('stores "do not tell me again" per mod: it stops the notice and not the record', async () => {
        fail('fault-mute', 'panel tab fault-mute:notes mount', 'panel-tab');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.panelTab', { name: 'fault-mute' }));
        toast()!.onCancel!();
        expect(toast()).toBeNull();
        expect(isFoliumFaultNoticeMuted('fault-mute')).toBe(true);
        expect(useFoliumStatusStore.getState().mutedNotices).toEqual(['fault-mute']);
        expect(JSON.parse(localStorage.getItem(MUTED_KEY)!)).toEqual(['fault-mute']);

        // Another mod is still announced.
        fail('fault-mute-other', 'background fault-mute-other:sky mount', 'background');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.background', { name: 'fault-mute-other' }));
        expire();

        // A mod silenced before it ever failed is recorded and not announced; turned back on, it is
        // announced at its next failure.
        setFoliumFaultNoticeMuted('fault-quiet', true);
        fail('fault-quiet', 'visualizer fault-quiet:mode mount', 'visualizer');
        expect(toast()).toBeNull();
        expect(getFoliumIssues('fault-quiet')).toMatchObject([{ where: 'visualizer fault-quiet:mode mount', count: 1 }]);
        setFoliumFaultNoticeMuted('fault-quiet', false);
        fail('fault-quiet', 'visualizer fault-quiet:mode mount', 'visualizer');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.visualizer', { name: 'fault-quiet' }));
        expect(getFoliumIssues('fault-quiet')[0].count).toBe(2);
        expect(JSON.parse(localStorage.getItem(MUTED_KEY)!)).toEqual(['fault-mute']);

        // Stored: the next run of the app reads the choice back.
        vi.resetModules();
        const nextRun = await import('@/mods/runtime/status');
        expect(nextRun.isFoliumFaultNoticeMuted('fault-mute')).toBe(true);
        expect(nextRun.isFoliumFaultNoticeMuted('fault-quiet')).toBe(false);
    });

    it('announces a mod again in the same run once "do not tell me again" is switched back on', () => {
        fail('fault-unmute', 'visualizer fault-unmute:mode mount', 'visualizer');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.visualizer', { name: 'fault-unmute' }));
        toast()!.onCancel!();
        expect(toast()).toBeNull();
        fail('fault-unmute', 'visualizer fault-unmute:mode mount', 'visualizer');
        expect(toast()).toBeNull();

        // The switch on the mod's row, turned back on.
        setFoliumFaultNoticeMuted('fault-unmute', false);
        fail('fault-unmute', 'visualizer fault-unmute:mode mount', 'visualizer');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.visualizer', { name: 'fault-unmute' }));
        // And still once: the next failure raises nothing new.
        expire();
        fail('fault-unmute', 'visualizer fault-unmute:mode mount', 'visualizer');
        expect(toast()).toBeNull();
        expect(getFoliumIssues('fault-unmute')[0].count).toBe(4);
    });

    it('says a mod has not finished starting, once, in words that are not about a failure, and still names a later failure', () => {
        announceFoliumSlowStart('fault-slow');
        const text = toast()!.text;
        expect(text).toBe(i18n.t('mods.faultNotice.slowStart', { name: 'fault-slow', seconds: 5 }));
        expect(text).toContain('fault-slow');
        expect(text).toContain('5');
        expect(text).not.toBe(i18n.t('mods.faultNotice.start', { name: 'fault-slow' }));
        // Nor in the look of a failure.
        expect(toast()!.type).toBe('info');
        // Not a failure: nothing on the mod's row.
        expect(getFoliumIssues('fault-slow')).toEqual([]);
        expire();

        // Once per run, like a failure's notice.
        announceFoliumSlowStart('fault-slow');
        expect(toast()).toBeNull();

        // Being slow did not use up the notice of a failure.
        fail('fault-slow', 'client activate', 'start');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.start', { name: 'fault-slow' }));
        expect(toast()!.type).toBe('error');
        expire();

        // "Do not tell me again" for a mod covers this notice too.
        setFoliumFaultNoticeMuted('fault-slow-quiet', true);
        announceFoliumSlowStart('fault-slow-quiet');
        expect(toast()).toBeNull();
        setFoliumFaultNoticeMuted('fault-slow-quiet', false);
    });

    it('raises no notice for a failure that is an ordinary result', async () => {
        const mod = { id: 'fault-ordinary', name: 'Ordinary', permissions: [], experimental: [] } as unknown as ModRuntimeInfo;
        // A command that fails: its card shows the failure.
        commandsRegistry.register('fault-ordinary', { id: 'export', label: { en: 'Export' }, run: () => { throw new Error('no disk'); } });
        expect(await runFoliumCommand(commandsRegistry.get('fault-ordinary:export')!, {})).toMatchObject({ ok: false, error: 'no disk' });
        // A music source that fails: a rejection is how it says so.
        omniProvidersRegistry.register('fault-ordinary', {
            id: 'radio',
            displayName: 'Radio',
            search: async () => { throw new Error('offline'); },
        });
        await expect(getOnlineMusicProvider('folium.fault-ordinary.radio')!.search!.searchSongs('q', 10, 0)).rejects.toThrow('offline');
        // A hook that fails: the song plays on.
        addFoliumEventHandler('fault-ordinary', 'playback.beforePlay', async () => { throw new Error('hook failed'); });
        await dispatchFoliumHookAsync('playback.beforePlay', { song: {}, cancelled: false } as FoliumBeforePlayEvent);
        // The mod's own log.error.
        createFoliumClientApi(mod, clientApiOptions('main')).log.error('could not reach my server');

        expect(toast()).toBeNull();
        expect(getFoliumIssues('fault-ordinary').map((issue) => [issue.where, issue.message])).toEqual([
            ['command fault-ordinary:export', 'no disk'],
            ['hook playback.beforePlay', 'hook failed'],
            ['log', 'could not reach my server'],
        ]);

        // A fault of the same mod is still announced afterwards.
        fail('fault-ordinary', 'visualizer fault-ordinary:mode mount', 'visualizer');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.visualizer', { name: 'fault-ordinary' }));

        commandsRegistry.unregisterAll('fault-ordinary');
        omniProvidersRegistry.unregisterAll('fault-ordinary');
        removeFoliumEventHandlers('fault-ordinary');
    });

    it('waits for another message to go, comes back when pushed aside, and shows two mods one after the other', () => {
        setToast({ type: 'info', text: 'now playing' });
        fail('fault-wait', 'stage layer fault-wait:rain mount', 'stage-layer');
        fail('fault-wait-second', 'event playback.songChanged');
        expect(toast()!.text).toBe('now playing');

        // The other message's time is up.
        setToast(null);
        const first = i18n.t('mods.faultNotice.stageLayer', { name: 'fault-wait' });
        expect(toast()!.text).toBe(first);

        // Two seconds in, another message takes the place; when it goes the notice is back.
        vi.advanceTimersByTime(2000);
        setToast({ type: 'success', text: 'saved' });
        expect(toast()!.text).toBe('saved');
        setToast(null);
        expect(toast()!.text).toBe(first);

        expire();
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.other', { name: 'fault-wait-second' }));
        expire();
        expect(toast()).toBeNull();
    });

    it('opens Settings on the mods page at that mod\'s row', async () => {
        vi.spyOn(useModsStore.getState(), 'refresh').mockResolvedValue();
        fail('fault-open', 'settings section fault-open:prefs mount', 'settings-section');
        expect(toast()!.text).toBe(i18n.t('mods.faultNotice.settings', { name: 'fault-open' }));
        toast()!.onAction!();
        expect(toast()).toBeNull();
        await Promise.resolve();
        await Promise.resolve();

        expect(useModsStore.getState().selectedModId).toBe('fault-open');
        expect(useSettingsModalStore.getState().settingsModalState).toMatchObject({
            isOpen: true,
            initialTab: 'options',
            initialSubview: 'mods',
            initialAnchor: { id: 'modList', rowId: 'mod:fault-open' },
        });
        expect(isFoliumFaultNoticeMuted('fault-open')).toBe(false);
        useSettingsModalStore.getState().closeSettings();
    });
});
