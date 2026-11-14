import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import {
    IPC, cleanHarness, clearModRecords, confirmMod, dialogAnswer, dialogs, electronCalls, harness, invoke, launch,
    modRecord, persisted, resetHarness, sentToWindow, sourceManifest, stateOf, writeAppPackage, writeMod,
} from './loaderHarness';

// test/unit/mod-system/folium2Lifecycle.test.ts
// Folium 2.0 S2, the lifecycle edges a review of the stage turned up (dev/folium/folium-2-plan.md §5.1–§5.3):
// what starts before the window, one reload at a time, a copy that wound down is not kept, a source that throws
// in activate releases what it registered, "clear data" (asked in the main process) leaves the source signed
// out, the quit runs onBeforeQuit once, handing a taken-over id over asks first, and the app's package.json is
// read through the asar-aware fs.

const require = createRequire(import.meta.url);
const { readBundledSources } = require('../../../electron/modSystem/builtinSources.cjs');

beforeEach(() => {
    resetHarness();
    clearModRecords();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
});

const ROOT = path.resolve(__dirname, '../../..');

describe('before the window', () => {
    it('starts the built-in tier only: a source mod of the user\'s folders waits for the start and its question', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const directory = writeMod('user', sourceManifest('radio', ['station']), { main: true });
        confirmMod(directory, 'radio');
        const system = launch({ load: false });
        system.startSources();
        expect(modRecord('netease')?.activations).toBe(1);
        expect(modRecord('radio')).toBeUndefined();
        expect(stateOf(system, 'radio')).toBeUndefined();
        system.start();
        expect(modRecord('radio')?.activations).toBe(1);
        expect(modRecord('netease')?.activations).toBe(1);
    });

    it('reads foliaBundledSources from the app\'s package.json with the asar-aware fs', () => {
        writeAppPackage({ foliaBundledSources: ['kugou'] });
        expect(readBundledSources(harness().appPath)).toEqual({ ids: ['kugou'], declared: true });
        const text = fs.readFileSync(path.join(ROOT, 'electron/modSystem/builtinSources.cjs'), 'utf8');
        expect(text).toContain("const fs = require('fs');");
        expect(text).not.toContain('rawFs');
    });
});

describe('reloads one at a time', () => {
    it('restarts a source that was switched off and on while its onBeforeUnload ran, instead of keeping the wound-down copy', async () => {
        writeMod('builtin', sourceManifest('ytm', ['ytm']), {
            main: `'use strict';
module.exports = function activate(api) {
    const record = (globalThis.__s2Mods ??= {})[api.manifest.id] ??= { activations: 0, deactivations: 0, unloads: 0 };
    record.activations += 1;
    api.onBeforeUnload(() => new Promise((resolve) => setTimeout(() => { record.unloads += 1; resolve(); }, 20)));
    return () => { record.deactivations += 1; };
};`,
        });
        const system = launch();
        const off = system.setSourceState('ytm', 'disabled');
        // The first switch is inside the source's onBeforeUnload when the second one comes.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const on = system.setSourceState('ytm', 'enabled');
        await Promise.all([off, on]);
        expect(stateOf(system, 'ytm')!.status).toBe('loaded');
        expect(modRecord('ytm')).toMatchObject({ activations: 2, deactivations: 1, unloads: 1 });
    });
});

describe('a source whose activate() throws', () => {
    it('releases its media rules, diagnostics and hidden windows at once', () => {
        writeMod('builtin', sourceManifest('radio', ['station']), {
            main: `'use strict';
module.exports = function activate(api) {
    api.media.allow({ hosts: ['cdn.example.com'] });
    api.windows.hidden({});
    throw new Error('broken');
};`,
        });
        const system = launch();
        expect(stateOf(system, 'radio')).toMatchObject({ status: 'error', error: 'broken' });
        expect(system.mediaRules.allows({ url: 'https://cdn.example.com/a', resourceType: 'media', method: 'GET' })).toBe(false);
        expect(electronCalls.some(([name]) => name === 'BrowserWindow.destroy')).toBe(true);
    });
});

describe('media rules', () => {
    it('lets a source add an address it issued to its rule later', () => {
        writeMod('builtin', sourceManifest('bodian', ['bodian']), {
            main: `'use strict';
module.exports = function activate(api) {
    const rule = api.media.allow({ ttlMs: 60000, followRedirects: true });
    rule.add('https://audio.example.com/track.mp3?sig=1');
};`,
        });
        const system = launch();
        expect(system.mediaRules.allows({ url: 'https://audio.example.com/track.mp3?sig=1', resourceType: 'media', method: 'GET' })).toBe(true);
        expect(system.mediaRules.allows({ url: 'https://audio.example.com/other.mp3', resourceType: 'media', method: 'GET' })).toBe(false);
    });
});

describe('"clear data"', () => {
    const writeSignedIn = () => writeMod('builtin', sourceManifest('radio', ['station'], { secrets: ['token'] }), {
        main: `'use strict';
module.exports = async function activate(api) {
    const record = (globalThis.__s2Mods ??= {})[api.manifest.id] ??= { activations: 0, deactivations: 0 };
    record.activations += 1;
    record.api = api;
    api.net.session('login');
};`,
    });

    it('asks in the main process, then leaves the source signed out: its secrets, its own partitions, its folders', async () => {
        writeSignedIn();
        const system = launch();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await (modRecord('radio')!.api as { secrets: { set: (key: string, value: string) => Promise<void> } }).secrets.set('token', 'signed-in');
        dialogAnswer.response = 1;
        expect(await system.clearSourceData('folium.radio.station')).toMatchObject({ ok: true });
        expect(dialogs.at(-1)).toMatchObject({ title: 'Clear source data' });
        expect(dialogs.at(-1)!.detail).toContain('partition persist:folium.radio.login');
        expect(electronCalls).toContainEqual(['session.clearStorageData', 'persist:folium.radio.login']);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const api = modRecord('radio')!.api as { secrets: { get: (key: string) => Promise<string | null> } };
        expect(await api.secrets.get('token')).toBeNull();
        expect(fs.existsSync(path.join(harness().userData, 'mods-data', 'radio'))).toBe(false);
    });

    it('clears nothing when the user says no', async () => {
        writeSignedIn();
        const system = launch();
        await new Promise((resolve) => setTimeout(resolve, 0));
        dialogAnswer.response = 0;
        expect(await system.clearSourceData('folium.radio.station')).toEqual({ ok: false, error: 'clear-declined' });
        expect(electronCalls.some(([name]) => name === 'session.clearStorageData')).toBe(false);
        expect(modRecord('radio')?.activations).toBe(1);
    });
});

describe('the quit', () => {
    it('runs onBeforeQuit once, even when the held quit is asked for again', async () => {
        writeMod('builtin', sourceManifest('ytm', ['ytm']), {
            main: `'use strict';
module.exports = function activate(api) {
    const record = (globalThis.__s2Mods ??= {})[api.manifest.id] ??= { activations: 0, deactivations: 0, quits: 0 };
    api.onBeforeQuit(() => { record.quits += 1; });
};`,
        });
        const system = launch();
        await system.prepareQuit();
        await system.prepareQuit();
        expect((modRecord('ytm') as unknown as { quits: number }).quits).toBe(1);
    });
});

describe('handing a taken-over id to another mod', () => {
    it('asks with that mod\'s takeover confirmation first', async () => {
        writeAppPackage({ foliaBundledSources: [] });
        const first = writeMod('user', sourceManifest('aaa-qq', [{ id: 'qq', claims: { id: 'qq', storeKeys: ['QQ_API_AUTH_SESSION_V1'] } }]));
        writeMod('user', sourceManifest('bbb-qq', [{ id: 'qq', claims: { id: 'qq', storeKeys: ['QQ_API_AUTH_SESSION_V1'] } }]));
        confirmMod(first, 'aaa-qq');
        persisted.set('mods.sourceClaims', { qq: 'aaa-qq' });
        const system = launch();
        dialogAnswer.response = 0;
        expect(await system.assignSourceClaim('qq', 'bbb-qq')).toEqual({ ok: false, error: 'enable-declined' });
        expect(persisted.get('mods.sourceClaims')).toEqual({ qq: 'aaa-qq' });
        dialogAnswer.response = 1;
        expect(await system.assignSourceClaim('qq', 'bbb-qq')).toMatchObject({ ok: true });
        expect(dialogs.at(-1)!.detail).toContain('takes over sources this installation does not carry: qq');
        expect(dialogs.at(-1)!.detail).toContain('QQ_API_AUTH_SESSION_V1');
        expect(stateOf(system, 'bbb-qq')!.status).toBe('loaded');
    });
});

describe('the source states channel', () => {
    it('says whether a source mod runs', async () => {
        launch();
        expect(await invoke(IPC.sourceStates)).toMatchObject({ ok: true, hasSourceMods: false });
        writeMod('builtin', sourceManifest('netease', ['netease']));
        launch();
        expect(await invoke(IPC.sourceStates)).toMatchObject({ ok: true, hasSourceMods: true });
    });
});

describe('round 2 of the review', () => {
    it('holds the quit only for a source that registered onBeforeQuit', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const system = launch();
        expect(system.prepareQuit()).toBeNull();
    });

    it('does not start a built-in copy before the window when an override of it was confirmed', () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: true });
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        persisted.set('mods.overriddenBuiltins', { qq: 'qq' });
        const system = launch({ load: false });
        system.startSources();
        expect(modRecord('qq')).toBeUndefined();
        expect(modRecord('netease')?.activations).toBe(1);
        // The full start decides (here no override copy is there, so the built-in one runs then).
        system.start();
        expect(modRecord('qq')?.activations).toBe(1);
    });

    it('remembers a partition the client named through folium.net.fetch, so clear data reaches it', async () => {
        writeMod('builtin', sourceManifest('radio', ['station']), { main: true });
        const system = launch();
        await invoke(IPC.netFetch, 'radio', 'https://example.com/login', { session: 'login' });
        expect(system.describeSourceData('folium.radio.station')).toMatchObject({ partitions: ['persist:folium.radio.login'] });
    });

    it('tells the window which sources are about to stop, on every reload path', async () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const directory = writeMod('user', sourceManifest('radio', ['station']), { main: true });
        confirmMod(directory, 'radio');
        const system = launch();
        sentToWindow.length = 0;
        await system.setSourceState('netease', 'disabled');
        await system.setModEnabled('radio', false);
        const notices = sentToWindow.filter(([channel]) => channel === IPC.fSourcesStopping).map(([, payload]) => payload);
        expect(notices).toEqual([{ sourceIds: ['netease'] }, { sourceIds: ['folium.radio.station'] }]);
    });
});
