import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import shared from '../../../electron/modSystem/foliumShared.json';
import { FOLIUM_VERSION } from '@/mods/folium/contract';
import { FOLIUM_KINDS } from '@/mods/folium/kinds';

// test/unit/mod-system/foliumShared.test.ts
// The Folium version, the permission names and the IPC channel names are
// written once, in electron/modSystem/foliumShared.json, and read from there by
// the main process and by the window side. Two files cannot read it and keep a
// copy: the contract (it imports nothing, so the docs and the editor type file
// can be made from it alone) and the preload script (it runs sandboxed, where
// `require` reaches no file of the app). These tests hold the two copies to
// the source.

const root = path.resolve(__dirname, '../../..');

describe('the copies of what foliumShared.json holds', () => {
    it('the contract states the same Folium version', () => {
        expect({ major: FOLIUM_VERSION.major, minor: FOLIUM_VERSION.minor }).toEqual(shared.version);
    });

    // Each preload method of the mods bridge, with the key of the channel it must use. Comparing
    // only the sets of names would let two methods swap channels (restoreFile and releaseFile) and
    // still pass, while every call went to the other handler.
    const CHANNEL_KEY_OF_METHOD: Record<string, keyof typeof shared.channels> = {
        listMods: 'list',
        setModEnabled: 'setEnabled',
        reloadMods: 'reload',
        invokeModRpc: 'rpc',
        invokeModStorage: 'storage',
        invokeModSecrets: 'secrets',
        invokeModNetFetch: 'netFetch',
        invokeModPickFile: 'pickFile',
        invokeModRestoreFile: 'restoreFile',
        invokeModReleaseFile: 'releaseFile',
        cancelExport: 'exportCancel',
        pushRuntimeSnapshot: 'pushRuntimeSnapshot',
        getFfmpegStatus: 'ffmpegStatus',
        openModsDirectory: 'openDirectory',
        installModFromZip: 'installZip',
        getModStorageUsage: 'storageUsage',
        clearModCache: 'clearCache',
        getModCallStats: 'callStats',
        reportModsStartSettled: 'startSettled',
        reportModsStartAlive: 'startAlive',
        onModsStateChanged: 'fStateChanged',
        onExportProgress: 'fExportProgress',
        onModLog: 'fLog',
        onModRpcMessage: 'fRpcMessage',
        onModSecretChanged: 'fSecretChanged',
    };

    it('each preload method of the mods bridge uses the channel of its own key, and every channel has its method', () => {
        const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
        const bridge = /^ {4}mods: \{\n([\s\S]*?)^ {4}\},$/m.exec(preload)?.[1] ?? '';
        // One method per `        name: (` line, up to the next one.
        const methods = Array.from(bridge.matchAll(/^ {8}(\w+): \([\s\S]*?(?=^ {8}\w+: \(|(?![\s\S]))/gm), (match) => ({
            name: match[1],
            channels: [...new Set(Array.from(match[0].matchAll(/'(folia-mods:[a-z-]+)'/g), (channel) => channel[1]))],
        }));
        expect(methods.map((method) => method.name)).toEqual(Object.keys(CHANNEL_KEY_OF_METHOD));
        methods.forEach((method) => expect(method.channels, method.name).toEqual([shared.channels[CHANNEL_KEY_OF_METHOD[method.name]]]));
        expect(Object.values(CHANNEL_KEY_OF_METHOD).sort()).toEqual(Object.keys(shared.channels).sort());
        // And nothing outside the mods bridge uses a mods channel.
        expect(preload.replace(bridge, '')).not.toMatch(/folia-mods:/);
    });
});

describe('the permissions in foliumShared.json', () => {
    // Each permission lists the members it unlocks: `folium.*` on the client, `api.*` in the main entry.
    it('each name the members they guard, and no member is guarded twice', () => {
        const guarded = Object.entries(shared.permissions).flatMap(([id, permission]) => {
            expect(permission.guards.length, id).toBeGreaterThan(0);
            return permission.guards;
        });
        guarded.forEach((member) => expect(member).toMatch(/^(folium|api)\.[A-Za-z]+(\.[A-Za-z]+)*$/));
        expect(new Set(guarded).size).toBe(guarded.length);
    });

    // The registries' gate and `folium:check` read a registry's permission from the kinds table; the
    // guards lists say it again, for the docs and the rest of the check. The two must agree.
    it('guard a registry exactly when the kinds table gives it that permission', () => {
        const fromGuards = Object.entries(shared.permissions).flatMap(([id, permission]) => permission.guards
            .filter((member) => member.startsWith('folium.registries.'))
            .map((member) => `${member.slice('folium.registries.'.length)}:${id}`));
        const fromKinds = Object.entries(FOLIUM_KINDS)
            .filter(([, kind]) => kind.permission !== null)
            .map(([name, kind]) => `${name}:${kind.permission}`);
        expect(fromGuards.sort()).toEqual(fromKinds.sort());
    });
});
