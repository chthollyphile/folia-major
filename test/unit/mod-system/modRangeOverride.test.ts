import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    IPC, cleanHarness, clearModRecords, confirmMod, dialogAnswer, dialogs, electronCalls, harness, invoke, launch, modRecord,
    persisted, resetHarness, sourceManifest, stateOf, writeMod,
} from './loaderHarness';

// test/unit/mod-system/modRangeOverride.test.ts
// Folium 2.1 (the mod market plan, B4): a mod whose `folia` range only ran out above stops at 'host-range-expired'
// instead of 'host-version-mismatch', and loads once the user lets it through in a native dialog. The approval is
// bound to the files, so new files ask again; a range the host is too old for is never let through. Uninstalling
// (B1) moves a user-folder mod to the trash after a native confirmation and touches nothing else.

const require = createRequire(import.meta.url);
const { classifyHostRange } = require('../../../electron/modSystem/manifest.cjs') as { classifyHostRange: (version: string | null, range: string) => string };

describe('classifyHostRange', () => {
    it.each([
        ['0.8.0', '>=0.7.0', 'ok'],
        ['0.8.0', '*', 'ok'],
        ['0.8.0', '>=0.7.0 <0.8.0', 'expired'],
        ['0.8.0', '<=0.7.29', 'expired'],
        ['1.0.0', '^0.7.0', 'expired'],
        ['0.8.0', '0.7.29', 'expired'],
        ['0.7.20', '>=0.7.29', 'too-old'],
        ['0.7.20', '>=0.7.29 <0.8.0', 'too-old'],
        ['0.7.29', '>0.7.29', 'too-old'],
        ['0.6.0', '^0.7.0', 'too-old'],
        ['0.7.0', '0.7.29', 'too-old'],
        ['0.8.0', 'latest', 'invalid'],
        ['0.8.0', '', 'invalid'],
        [null, '>=0.7.0', 'invalid'],
        // A Cielo or release-candidate build counts as its base version.
        ['0.7.29-alpha.1795177495', '>=0.7.20 <0.8.0', 'ok'],
        ['0.8.0-rc.2', '>=0.7.0 <0.8.0', 'expired'],
        ['0.7.29+build.7', '>=0.7.29', 'ok'],
        ['0.7.29-', '>=0.7.0', 'invalid'],
    ])('Folia %s against "%s" is %s', (version, range, state) => {
        expect(classifyHostRange(version, range)).toBe(state);
    });
});

describe('loading past an expired range', () => {
    beforeEach(() => {
        resetHarness();
        clearModRecords();
    });
    afterEach(() => cleanHarness());

    it('holds an expired mod back with its own error, and loads it once let through', async () => {
        const dir = writeMod('user', { id: 'old-mod', folia: '>=0.7.0 <0.8.0' }, { main: true });
        confirmMod(dir, 'old-mod');
        const system = launch({ appVersion: '0.8.0' });
        expect(stateOf(system, 'old-mod')).toMatchObject({ status: 'error', error: 'host-range-expired' });
        expect(modRecord('old-mod')).toBeUndefined();

        const answer = await invoke(IPC.allowExpiredRange, ['old-mod']) as { ok: boolean };
        expect(answer.ok).toBe(true);
        expect(dialogs.at(-1)?.detail).toContain('<0.8.0');
        expect(stateOf(system, 'old-mod')).toMatchObject({ status: 'loaded', error: null });
        expect((stateOf(system, 'old-mod') as unknown as { rangeOverridden: boolean }).rangeOverridden).toBe(true);
        expect(modRecord('old-mod')?.activations).toBe(1);
    });

    it('keeps it held back when the dialog is declined', async () => {
        const dir = writeMod('user', { id: 'old-mod', folia: '<0.8.0' }, { main: true });
        confirmMod(dir, 'old-mod');
        const system = launch({ appVersion: '0.8.0' });
        dialogAnswer.response = 0;
        expect(await invoke(IPC.allowExpiredRange, ['old-mod'])).toMatchObject({ ok: false, error: 'range-override-declined' });
        expect(stateOf(system, 'old-mod')).toMatchObject({ error: 'host-range-expired' });
    });

    it('asks again after the files change', async () => {
        const dir = writeMod('user', { id: 'old-mod', folia: '<0.8.0' }, { main: true });
        confirmMod(dir, 'old-mod');
        const system = launch({ appVersion: '0.8.0' });
        await invoke(IPC.allowExpiredRange, ['old-mod']);
        expect(stateOf(system, 'old-mod')?.status).toBe('loaded');

        fs.appendFileSync(path.join(dir, 'client.mjs'), '// changed\n');
        confirmMod(dir, 'old-mod');
        system.loadAll({ differential: false });
        expect(stateOf(system, 'old-mod')).toMatchObject({ status: 'error', error: 'host-range-expired' });
    });

    it('lets several through with one dialog', async () => {
        for (const id of ['old-a', 'old-b']) confirmMod(writeMod('user', { id, folia: '>=0.7.0 <0.8.0' }), id);
        const system = launch({ appVersion: '0.8.0' });
        const before = dialogs.length;
        expect(await invoke(IPC.allowExpiredRange, ['old-a', 'old-b'])).toMatchObject({ ok: true });
        expect(dialogs.length - before).toBe(1);
        expect(stateOf(system, 'old-a')?.status).toBe('loaded');
        expect(stateOf(system, 'old-b')?.status).toBe('loaded');
    });

    it('never lets a mod through that needs a newer Folia', async () => {
        confirmMod(writeMod('user', { id: 'new-mod', folia: '>=0.9.0' }), 'new-mod');
        const system = launch({ appVersion: '0.8.0' });
        expect(stateOf(system, 'new-mod')).toMatchObject({ status: 'error', error: 'host-version-mismatch' });
        expect(await invoke(IPC.allowExpiredRange, ['new-mod'])).toMatchObject({ ok: false, error: 'no-expired-range' });
    });

    it('takes the approval back', async () => {
        confirmMod(writeMod('user', { id: 'old-mod', folia: '<0.8.0' }, { main: true }), 'old-mod');
        const system = launch({ appVersion: '0.8.0' });
        await invoke(IPC.allowExpiredRange, ['old-mod']);
        expect(stateOf(system, 'old-mod')?.status).toBe('loaded');
        await invoke(IPC.revokeExpiredRange, 'old-mod');
        expect(stateOf(system, 'old-mod')).toMatchObject({ status: 'error', error: 'host-range-expired' });
        expect(modRecord('old-mod')?.deactivations).toBe(1);
    });

    it('stops a running source mod when the approval is taken back', async () => {
        // A source copy is kept running by every load unless something it is keyed on changes; the approval is one.
        const directory = writeMod('user', sourceManifest('old-source', ['station'], { folia: '>=0.7.0 <0.8.0' }), { main: true });
        confirmMod(directory, 'old-source');
        const system = launch({ appVersion: '0.8.0' });
        await invoke(IPC.allowExpiredRange, ['old-source']);
        expect(stateOf(system, 'old-source')?.status).toBe('loaded');
        expect(modRecord('old-source')?.activations).toBe(1);
        await invoke(IPC.revokeExpiredRange, 'old-source');
        expect(stateOf(system, 'old-source')).toMatchObject({ status: 'error', error: 'host-range-expired' });
        expect(modRecord('old-source')?.deactivations).toBe(1);
    });

    it('folds the range into the enable dialog of an expired mod', async () => {
        writeMod('user', { id: 'old-mod', folia: '>=0.7.0 <0.8.0' });
        const system = launch({ appVersion: '0.8.0' });
        const answer = await system.setModEnabled('old-mod', true);
        expect(answer.ok).toBe(true);
        expect(dialogs.at(-1)?.detail).toContain('<0.8.0');
        expect(stateOf(system, 'old-mod')?.status).toBe('loaded');
    });
});

describe('uninstalling', () => {
    beforeEach(() => {
        resetHarness();
        clearModRecords();
    });
    afterEach(() => cleanHarness());

    it('moves a user-folder mod to the trash after the dialog, and drops its approval', async () => {
        const dir = writeMod('user', { id: 'gone-mod' }, { main: true });
        confirmMod(dir, 'gone-mod');
        const system = launch();
        expect(stateOf(system, 'gone-mod')?.status).toBe('loaded');
        expect((stateOf(system, 'gone-mod') as unknown as { uninstallable: boolean }).uninstallable).toBe(true);
        const answer = await invoke(IPC.uninstall, 'gone-mod') as { ok: boolean; error?: string };
        expect(answer.error).toBeUndefined();
        expect(answer.ok).toBe(true);
        expect(fs.existsSync(dir)).toBe(false);
        expect(electronCalls.some(([name, target]) => name === 'shell.trashItem' && target === dir)).toBe(true);
        expect(modRecord('gone-mod')?.deactivations).toBe(1);
        expect(stateOf(system, 'gone-mod')).toBeUndefined();
        expect((persisted.get('mods.enabled.gone-mod') as { enabled?: boolean } | undefined)?.enabled ?? false).toBe(false);
    });

    it('does nothing when the dialog is declined', async () => {
        const dir = writeMod('user', { id: 'kept-mod' });
        launch();
        dialogAnswer.response = 0;
        expect(await invoke(IPC.uninstall, 'kept-mod')).toMatchObject({ ok: false, error: 'uninstall-declined' });
        expect(fs.existsSync(dir)).toBe(true);
    });

    it('refuses a built-in mod', async () => {
        const dir = writeMod('builtin', { id: 'builtin-mod' });
        const system = launch();
        // The panel shows no uninstall button for it either.
        expect((stateOf(system, 'builtin-mod') as unknown as { uninstallable: boolean }).uninstallable).toBe(false);
        const before = dialogs.length;
        expect(await invoke(IPC.uninstall, 'builtin-mod')).toMatchObject({ ok: false, error: 'uninstall-not-user-mod' });
        expect(dialogs.length).toBe(before);
        expect(fs.existsSync(dir)).toBe(true);
        expect(harness().builtinDir).toBe(path.dirname(dir));
    });
});
