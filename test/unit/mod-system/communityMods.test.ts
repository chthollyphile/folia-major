import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipSync } from 'fflate';
import {
    IPC, cleanHarness, clearModRecords, confirmMod, dialogAnswer, dialogs, harness, invoke, launch, modRecord, resetHarness,
    sentToWindow, sourceManifest, stateOf, writeMod,
} from './loaderHarness';

// test/unit/mod-system/communityMods.test.ts
// Folium 2.0, the community mods switch (electron/modSystem/communityMods.cjs):
//   - the once-per-profile migration: a profile whose master switch was explicitly on keeps its mods (community on),
//     any other starts with it off, and a profile that has the record is left alone;
//   - which mods it lets through while off: an official (verified) source mod from the user's folders, and anything
//     not from them (built-in copies, the source tree's mods/ of a development build);
//   - the loader: a community mod while it is off is listed with 'community-off' and does not run, cannot be enabled,
//     and is not installed from a zip; the switch is turned on only after the native confirmation.

const require = createRequire(import.meta.url);
const {
    COMMUNITY_MODS_SETTING_KEY, MOD_SYSTEM_SETTING_KEY, isAllowedWithoutCommunity, isOfficialSourceMod, migrateCommunityModsSetting,
} = require('../../../electron/modSystem/communityMods.cjs');

const mapStore = (entries: Record<string, unknown> = {}) => {
    const map = new Map<string, unknown>(Object.entries(entries));
    return { map, get: (key: string) => map.get(key), set: (key: string, value: unknown) => { map.set(key, value); } };
};

describe('migrateCommunityModsSetting', () => {
    it('turns community mods on for a profile whose master switch was explicitly on', () => {
        for (const on of [true, 'true', ' TRUE ', 1]) {
            const store = mapStore({ [MOD_SYSTEM_SETTING_KEY]: on });
            expect(migrateCommunityModsSetting(store)).toBe(true);
            expect(store.map.get(COMMUNITY_MODS_SETTING_KEY)).toBe(true);
        }
    });

    it('starts it off for a fresh profile, one never switched, and one switched off', () => {
        for (const entries of [{}, { [MOD_SYSTEM_SETTING_KEY]: false }, { [MOD_SYSTEM_SETTING_KEY]: 'false' }, { [MOD_SYSTEM_SETTING_KEY]: 0 }, { [MOD_SYSTEM_SETTING_KEY]: 'maybe' }]) {
            const store = mapStore(entries);
            expect(migrateCommunityModsSetting(store)).toBe(false);
            expect(store.map.get(COMMUNITY_MODS_SETTING_KEY)).toBe(false);
        }
    });

    it('runs once: a second run, or a profile that has the record, changes nothing', () => {
        const store = mapStore({ [MOD_SYSTEM_SETTING_KEY]: true });
        expect(migrateCommunityModsSetting(store)).toBe(true);
        // The user turns community mods off afterwards; the master switch is still on.
        store.set(COMMUNITY_MODS_SETTING_KEY, false);
        expect(migrateCommunityModsSetting(store)).toBeNull();
        expect(migrateCommunityModsSetting(store)).toBeNull();
        expect(store.map.get(COMMUNITY_MODS_SETTING_KEY)).toBe(false);

        const turnedOn = mapStore({ [MOD_SYSTEM_SETTING_KEY]: false, [COMMUNITY_MODS_SETTING_KEY]: 'true' });
        expect(migrateCommunityModsSetting(turnedOn)).toBeNull();
        expect(turnedOn.map.get(COMMUNITY_MODS_SETTING_KEY)).toBe('true');
    });
});

describe('what community mods off lets through', () => {
    const source = sourceManifest('qq-pack', ['qq']);
    const plain = { id: 'lyric-skin', folium: 1, name: 'x', version: '1.0.0' };

    it('is an official source mod: a source mod verified against an official key', () => {
        expect(isOfficialSourceMod(source, { status: 'verified' })).toBe(true);
        expect(isOfficialSourceMod(source, { status: 'beta' })).toBe(false);
        expect(isOfficialSourceMod(source, { status: 'unsigned' })).toBe(false);
        expect(isOfficialSourceMod(source, { status: 'invalid' })).toBe(false);
        expect(isOfficialSourceMod(plain, { status: 'verified' })).toBe(false);
        expect(isOfficialSourceMod(null, { status: 'verified' })).toBe(false);
    });

    it('gates the user folder and resources/mods, not built-in copies or the source tree mods/', () => {
        expect(isAllowedWithoutCommunity({ tier: 'user', manifest: source, signature: { status: 'verified' } })).toBe(true);
        expect(isAllowedWithoutCommunity({ tier: 'user', manifest: source, signature: { status: 'unsigned' } })).toBe(false);
        expect(isAllowedWithoutCommunity({ tier: 'user', manifest: plain, signature: { status: 'verified' } })).toBe(false);
        expect(isAllowedWithoutCommunity({ tier: 'resources', manifest: plain, signature: { status: 'unsigned' } })).toBe(false);
        expect(isAllowedWithoutCommunity({ manifest: plain, signature: { status: 'unsigned' } })).toBe(false);
        expect(isAllowedWithoutCommunity({ tier: 'repo', manifest: plain, signature: { status: 'unsigned' } })).toBe(true);
        expect(isAllowedWithoutCommunity({ tier: 'builtin', manifest: source, signature: null })).toBe(true);
    });
});

describe('the loader with community mods off', () => {
    const community = { on: false };
    const written: boolean[] = [];
    const launchGated = () => launch({
        extra: {
            isCommunityEnabled: () => community.on,
            writeCommunityEnabled: (value: boolean) => { written.push(value); community.on = value; },
        },
    });

    beforeEach(() => {
        resetHarness();
        clearModRecords();
        community.on = false;
        written.length = 0;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        cleanHarness();
        clearModRecords();
        vi.restoreAllMocks();
    });

    it('lists a confirmed community mod as community-off and does not run it; turning them on runs it', async () => {
        const directory = writeMod('user', { id: 'lyric-skin' }, { main: true });
        confirmMod(directory, 'lyric-skin');
        const system = launchGated();
        expect(stateOf(system, 'lyric-skin')).toMatchObject({ status: 'error', error: 'community-off', enabled: true });
        expect(modRecord('lyric-skin')).toBeUndefined();

        dialogAnswer.response = 1;
        expect(await invoke(IPC.setCommunity, true)).toMatchObject({ ok: true, enabled: true });
        expect(written).toEqual([true]);
        expect(dialogs).toHaveLength(1);
        expect(stateOf(system, 'lyric-skin')).toMatchObject({ status: 'loaded', error: null });
        expect(modRecord('lyric-skin')?.activations).toBe(1);

        // Off again: no dialog, and the mod stops.
        expect(await invoke(IPC.setCommunity, false)).toMatchObject({ ok: true, enabled: false });
        expect(dialogs).toHaveLength(1);
        expect(stateOf(system, 'lyric-skin')).toMatchObject({ status: 'error', error: 'community-off' });
        expect(modRecord('lyric-skin')?.deactivations).toBe(1);
    });

    it('keeps the switch off when the confirmation is declined', async () => {
        launchGated();
        dialogAnswer.response = 0;
        expect(await invoke(IPC.setCommunity, true)).toMatchObject({ ok: false, error: 'community-declined', enabled: false });
        expect(written).toEqual([]);
        expect(community.on).toBe(false);
    });

    it('tells every window that runs the app when the switch changed, and nobody when it did not', async () => {
        const told = (name: string, log: Array<[string, unknown]>) => ({
            isDestroyed: () => false,
            webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => { log.push([`${name}:${channel}`, payload]); } },
        });
        const log: Array<[string, unknown]> = [];
        const closed = { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: () => { throw new Error('a closed window was written to'); } } };
        launch({
            extra: {
                isCommunityEnabled: () => community.on,
                writeCommunityEnabled: (value: boolean) => { community.on = value; },
                // The main window, the remote-control window, one that is closed and one that never opened.
                getFirstPartyWindows: () => [told('main', log), told('remote', log), closed, null],
            },
        });
        const notices = () => log.filter(([channel]) => channel.endsWith(IPC.fCommunityChanged));
        dialogAnswer.response = 0;
        await invoke(IPC.setCommunity, true);
        expect(notices()).toEqual([]);
        dialogAnswer.response = 1;
        await invoke(IPC.setCommunity, true);
        expect(notices()).toEqual([
            [`main:${IPC.fCommunityChanged}`, { enabled: true }],
            [`remote:${IPC.fCommunityChanged}`, { enabled: true }],
        ]);
        // Already on: nothing changed, nothing is said.
        await invoke(IPC.setCommunity, true);
        expect(notices()).toHaveLength(2);
        await invoke(IPC.setCommunity, false);
        expect(notices().slice(2)).toEqual([
            [`main:${IPC.fCommunityChanged}`, { enabled: false }],
            [`remote:${IPC.fCommunityChanged}`, { enabled: false }],
        ]);
    });

    it('tells the main window alone when the host names no other window', async () => {
        sentToWindow.length = 0;
        launchGated();
        dialogAnswer.response = 1;
        await invoke(IPC.setCommunity, true);
        expect(sentToWindow.filter(([channel]) => channel === IPC.fCommunityChanged)).toEqual([[IPC.fCommunityChanged, { enabled: true }]]);
    });

    it('does not offer the enable dialog for a community mod', async () => {
        writeMod('user', { id: 'lyric-skin' });
        const system = launchGated();
        expect(await system.setModEnabled('lyric-skin', true)).toMatchObject({ ok: false, error: 'community-off' });
        expect(dialogs).toHaveLength(0);
        // Switching it off is still allowed.
        expect(await system.setModEnabled('lyric-skin', false)).toMatchObject({ ok: true });
    });

    it('does not let a community source mod take over or override anything', () => {
        const directory = writeMod('user', sourceManifest('qq', ['qq'], { version: '9.0.0' }), { main: true });
        confirmMod(directory, 'qq');
        const system = launchGated();
        expect(stateOf(system, 'qq')).toMatchObject({ status: 'error', error: 'community-off' });
        expect(system.listSourceStates().sources.find((source) => source.modId === 'qq')).toBeUndefined();
    });

    it('refuses a zip that is not an official source mod, and installs it once community mods are on', async () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-community-'));
        try {
            const zipPath = path.join(work, 'mod.zip');
            fs.writeFileSync(zipPath, zipSync({
                'mod.json': Buffer.from(JSON.stringify({ folium: 2, id: 'zipped-source', name: 'z', version: '1.0.0', main: 'index.cjs', client: 'client.mjs', sources: [{ id: 'main', name: 'Z' }] })),
                'index.cjs': Buffer.from('module.exports = () => {};\n'),
                'client.mjs': Buffer.from('export default function activate() {}\n'),
            }));
            launchGated();
            expect(await invoke(IPC.installZip, zipPath)).toEqual({ ok: false, error: 'install-community-off' });
            const installed = path.join(harness().userModsDir, 'zipped-source');
            expect(fs.existsSync(installed)).toBe(false);
            // Nothing left behind in the staging folder either.
            const staging = path.join(harness().userModsDir, '.staging');
            expect(fs.existsSync(staging) ? fs.readdirSync(staging) : []).toEqual([]);

            community.on = true;
            expect(await invoke(IPC.installZip, zipPath)).toMatchObject({ ok: true, id: 'zipped-source' });
            expect(fs.existsSync(path.join(installed, 'mod.json'))).toBe(true);
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });

    it('leaves the folders as they were when the host passes no switch (tests, tools)', () => {
        const directory = writeMod('user', { id: 'lyric-skin' }, { main: true });
        confirmMod(directory, 'lyric-skin');
        const system = launch();
        expect(stateOf(system, 'lyric-skin')).toMatchObject({ status: 'loaded' });
    });
});
